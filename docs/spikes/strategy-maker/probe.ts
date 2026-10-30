/**
 * Strategy maker probe (research spike for issue #284). Run: `node docs/spikes/strategy-maker/probe.ts`.
 * No network, no new dependency, exits 0, seeded so every number is identical between runs except the lines
 * tagged `[perf]` (wall time and memory).
 *
 * It imports only pure client modules (backtest engine, strategy table, metrics, indicators, csv, seeded random).
 *
 * Steps, on two series (the 200-bar sample CSV and a seeded 100,000-bar synthetic series):
 *  1. A hidden built-in strategy produces entries and exits. They are degraded like a human would mark them
 *     (some dropped, some shifted by a few bars) and become the "highlights".
 *  2. Approach A: search every built-in strategy over a param grid, score by entry/exit match against the
 *     highlights (F1 within a bar tolerance), keep candidates that meet the R:R / win rate / drawdown targets,
 *     check the winner on a held-out last 30% of bars.
 *  3. Approach B: a small decision tree (written here) over indicator features, trained on the highlights.
 */
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import type { Candle } from '../../../shared/market.ts';
import { registerHooks } from 'node:module';

// The app's modules import each other without file extensions (the bundler resolves them). Plain `node` does not,
// so a synchronous resolve hook retries a failed relative import with `.ts` / `/index.ts`. Nothing is copied or
// changed in the app; the modules load as they are. Imports below are dynamic so the hook is in place first.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (!specifier.startsWith('.')) throw err;
      for (const suffix of ['.ts', '/index.ts']) {
        try {
          return nextResolve(specifier + suffix, context);
        } catch {
          /* try the next suffix */
        }
      }
      throw err;
    }
  },
});

const { runBacktest } = await import('../../../client/src/lib/backtest/engine.ts');
const { computeMetrics } = await import('../../../client/src/lib/backtest/metrics.ts');
const { buildSignals, strategies } = await import('../../../client/src/lib/backtest/strategies.ts');
const { atr, bollinger, ema, highest, lowest, macd, rsi, sma } = await import('../../../client/src/lib/indicators.ts');
const { candlesFromCsvText } = await import('../../../client/src/lib/csv.ts');
const { mulberry32 } = await import('../../../client/src/lib/random.ts');
import type { BacktestConfig, Metrics, Signal } from '../../../client/src/lib/backtest/types.ts';

/* ----------------------------- settings ----------------------------- */

const HIDDEN = { strategyId: 'sma_cross', params: { fast: 8, slow: 34, direction: 1 } };
const DROP_RATE = 0.15; // highlights the user forgot
const SHIFT_RATE = 0.3; // highlights placed a few bars off
const MAX_SHIFT = 3;
const TOLERANCE = 3; // bars within which a found entry/exit counts as the same as a highlight
const TARGETS = { minRR: 1.0, minWinRatePct: 30, maxDrawdownPct: 60 };
const TRAIN_FRACTION = 0.7;
const SYNTH_BARS = 100_000;

const BASE_CONFIG: BacktestConfig = {
  strategyId: HIDDEN.strategyId,
  params: HIDDEN.params,
  initialCapital: 10000,
  positionSizePct: 100,
  feeBps: 10,
  slippageBps: 5,
  allowShort: false,
  stopLossPct: null,
  takeProfitPct: null,
};

/* ----------------------------- helpers ------------------------------ */

const perf = (label: string, t0: number): void => {
  const mem = process.memoryUsage();
  const peakKb = process.resourceUsage().maxRSS;
  console.log(
    `  [perf] ${label}: ${(performance.now() - t0).toFixed(0)} ms, heapUsed ${(mem.heapUsed / 1048576).toFixed(0)} MB, rss ${(mem.rss / 1048576).toFixed(0)} MB, peak rss so far ${(peakKb / 1024).toFixed(0)} MB`,
  );
};

const f = (v: number | null, d = 2): string => (v == null || !Number.isFinite(v) ? 'n/a' : v.toFixed(d));

function normal(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

function syntheticSeries(bars: number, seed: number): Candle[] {
  const rand = mulberry32(seed);
  const out: Candle[] = [];
  let price = 100;
  let trend = 0; // slowly varying drift (Ornstein-Uhlenbeck) so trend strategies have something to find
  const t0 = Date.UTC(2010, 0, 1) / 1000;
  for (let i = 0; i < bars; i++) {
    trend = trend * 0.98 + normal(rand) * 0.00012;
    const open = price;
    const ret = trend + normal(rand) * 0.006;
    const close = Math.max(0.5, open * (1 + ret));
    const wick = Math.abs(normal(rand)) * 0.003;
    out.push({
      time: t0 + i * 3600,
      open,
      high: Math.max(open, close) * (1 + wick),
      low: Math.min(open, close) * (1 - wick),
      close,
      volume: 1000 + Math.floor(rand() * 5000),
    });
    price = close;
  }
  return out;
}

interface Marks {
  entries: number[];
  exits: number[];
}

/** Bars where a long-only signal series turns on / off. Null counts as flat. */
function marksOf(signals: Signal[]): Marks {
  const entries: number[] = [];
  const exits: number[] = [];
  let prev = 0;
  for (let i = 0; i < signals.length; i++) {
    const cur = signals[i] === 1 ? 1 : 0;
    if (cur === 1 && prev === 0) entries.push(i);
    if (cur === 0 && prev === 1) exits.push(i);
    prev = cur;
  }
  return { entries, exits };
}

/** Degrade perfect marks the way a human would: forget some, place some a few bars off. */
function degrade(marks: number[], rand: () => number, n: number): number[] {
  const out: number[] = [];
  for (const m of marks) {
    if (rand() < DROP_RATE) continue;
    let b = m;
    if (rand() < SHIFT_RATE) {
      const d = 1 + Math.floor(rand() * MAX_SHIFT);
      b = m + (rand() < 0.5 ? -d : d);
    }
    out.push(Math.min(n - 1, Math.max(0, b)));
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/** Greedy one-to-one match of two sorted bar lists within a tolerance. */
function matchCount(found: number[], truth: number[], tol: number): number {
  let i = 0;
  let j = 0;
  let hit = 0;
  while (i < found.length && j < truth.length) {
    const d = found[i] - truth[j];
    if (Math.abs(d) <= tol) {
      hit++;
      i++;
      j++;
    } else if (d < 0) i++;
    else j++;
  }
  return hit;
}

function f1(found: Marks, truth: Marks, tol: number): { f1: number; precision: number; recall: number } {
  const hits = matchCount(found.entries, truth.entries, tol) + matchCount(found.exits, truth.exits, tol);
  const nf = found.entries.length + found.exits.length;
  const nt = truth.entries.length + truth.exits.length;
  const precision = nf ? hits / nf : 0;
  const recall = nt ? hits / nt : 0;
  return { f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0, precision, recall };
}

function backtest(candles: Candle[], signals: Signal[]): { metrics: Metrics; rr: number | null } {
  const { trades, equity, exposureBars } = runBacktest(candles, signals, BASE_CONFIG);
  const metrics = computeMetrics(candles, equity, trades, BASE_CONFIG.initialCapital, exposureBars);
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const avgWin = wins.length ? wins.reduce((a, t) => a + t.pnlPct, 0) / wins.length : 0;
  const avgLoss = losses.length ? Math.abs(losses.reduce((a, t) => a + t.pnlPct, 0) / losses.length) : 0;
  return { metrics, rr: avgLoss > 0 ? avgWin / avgLoss : null };
}

/* ------------------------- approach A: search ------------------------ */

interface Candidate {
  strategyId: string;
  params: Record<string, number>;
}

function range(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  for (let v = from; v <= to + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

/** Coarse grids over the built-in long-only strategies (the optimizer's MAX_GRID_COMBOS would cap a real run). */
function candidateGrid(): Candidate[] {
  const out: Candidate[] = [];
  const dir = 1;
  for (const fast of range(2, 30, 2))
    for (const slow of range(10, 80, 4))
      if (slow > fast) {
        out.push({ strategyId: 'sma_cross', params: { fast, slow, direction: dir } });
        out.push({ strategyId: 'ema_cross', params: { fast, slow, direction: dir } });
      }
  for (const fast of range(4, 20, 2))
    for (const slow of range(16, 40, 4))
      for (const signal of [5, 9, 13])
        if (slow > fast) out.push({ strategyId: 'macd_cross', params: { fast, slow, signal, direction: dir } });
  for (const length of range(5, 30, 5))
    for (const oversold of range(20, 40, 5))
      for (const overbought of range(60, 80, 5))
        out.push({ strategyId: 'rsi_reversion', params: { length, oversold, overbought, direction: dir } });
  for (const length of range(10, 50, 10))
    for (const mult of [1.5, 2, 2.5])
      for (const mode of [0, 1]) out.push({ strategyId: 'bollinger', params: { length, mult, mode, direction: dir } });
  for (const entry of range(10, 60, 5))
    for (const exit of range(5, 30, 5)) out.push({ strategyId: 'donchian', params: { entry, exit, direction: dir } });
  return out;
}

function approachA(label: string, candles: Candle[], truth: Marks): void {
  console.log(`\n-- Approach A (search) on ${label} --`);
  const split = Math.floor(candles.length * TRAIN_FRACTION);
  const train = candles.slice(0, split);
  const test = candles.slice(split);
  const trainTruth: Marks = { entries: truth.entries.filter((b) => b < split), exits: truth.exits.filter((b) => b < split) };
  const grid = candidateGrid();
  const t0 = performance.now();
  const scored = grid.map((c) => {
    // Signals are not kept: only the marks are scored, so memory stays flat however big the grid is.
    return { c, ...f1(marksOf(buildSignals(train, c.strategyId, c.params)), trainTruth, TOLERANCE) };
  });
  scored.sort((a, b) => b.f1 - a.f1);
  perf(`score ${grid.length} candidates by match`, t0);

  const t1 = performance.now();
  const top = scored.slice(0, 8);
  console.log(`  ${grid.length} candidates, tolerance ${TOLERANCE} bars, train bars ${train.length}, highlights ${trainTruth.entries.length} entries / ${trainTruth.exits.length} exits`);
  console.log(`  targets: R:R >= ${TARGETS.minRR}, win rate >= ${TARGETS.minWinRatePct}%, max drawdown <= ${TARGETS.maxDrawdownPct}%`);
  let firstOk: (typeof top)[number] | null = null;
  for (const s of top) {
    const bt = backtest(train, buildSignals(train, s.c.strategyId, s.c.params));
    const gaps: string[] = [];
    if (bt.rr == null || bt.rr < TARGETS.minRR) gaps.push(`R:R ${f(bt.rr)} < ${TARGETS.minRR}`);
    if ((bt.metrics.winRatePct ?? 0) < TARGETS.minWinRatePct) gaps.push(`win ${f(bt.metrics.winRatePct, 1)}% < ${TARGETS.minWinRatePct}%`);
    if (Math.abs(bt.metrics.maxDrawdownPct) > TARGETS.maxDrawdownPct) gaps.push(`dd ${f(Math.abs(bt.metrics.maxDrawdownPct), 1)}% > ${TARGETS.maxDrawdownPct}%`);
    if (!gaps.length && !firstOk) firstOk = s;
    console.log(
      `  F1 ${f(s.f1, 3)} (P ${f(s.precision, 2)} R ${f(s.recall, 2)}) ${s.c.strategyId} ${JSON.stringify(s.c.params)} | trades ${bt.metrics.trades}, R:R ${f(bt.rr)}, win ${f(bt.metrics.winRatePct, 1)}%, dd ${f(bt.metrics.maxDrawdownPct, 1)}% | ${gaps.length ? 'closest, gaps: ' + gaps.join('; ') : 'meets targets'}`,
    );
  }
  perf('backtest top 8 on train part', t1);

  const best = firstOk ?? top[0];
  const hiddenP = HIDDEN.params;
  const dist = Object.keys(hiddenP)
    .filter((k) => k !== 'direction')
    .map((k) => `${k} ${best.c.params[k] ?? 'n/a'} vs hidden ${hiddenP[k as keyof typeof hiddenP]}`)
    .join(', ');
  console.log(`  recovered hidden strategy (${HIDDEN.strategyId}): ${best.c.strategyId === HIDDEN.strategyId ? 'yes, same strategy' : 'no, a different strategy'}; params: ${dist}`);

  const t2 = performance.now();
  const testSig = buildSignals(test, best.c.strategyId, best.c.params);
  const oos = backtest(test, testSig);
  const hiddenOos = backtest(test, buildSignals(test, HIDDEN.strategyId, HIDDEN.params));
  console.log(
    `  out-of-sample (last ${test.length} bars): found trades ${oos.metrics.trades}, return ${f(oos.metrics.totalReturnPct, 1)}%, win ${f(oos.metrics.winRatePct, 1)}%, R:R ${f(oos.rr)}, dd ${f(oos.metrics.maxDrawdownPct, 1)}% | hidden strategy return ${f(hiddenOos.metrics.totalReturnPct, 1)}%, dd ${f(hiddenOos.metrics.maxDrawdownPct, 1)}%`,
  );
  perf('out-of-sample check', t2);
}

/* ---------------------- approach B: decision tree -------------------- */

const FEATURE_NAMES = [
  'close/sma10-1',
  'close/sma30-1',
  'sma10/sma30-1',
  'sma8/sma34-1',
  'ema12/ema26-1',
  'macd_hist/close',
  'rsi14',
  'rsi5',
  'bb_pctb20',
  'atr14/close',
  'donchian20_pos',
  'ret1',
  'ret5',
  'ret20',
];

function features(c: Candle[]): Float64Array[] {
  const closes = c.map((x) => x.close);
  const s8 = sma(closes, 8);
  const s10 = sma(closes, 10);
  const s30 = sma(closes, 30);
  const s34 = sma(closes, 34);
  const e12 = ema(closes, 12);
  const e26 = ema(closes, 26);
  const m = macd(closes, 12, 26, 9);
  const r14 = rsi(closes, 14);
  const r5 = rsi(closes, 5);
  const bb = bollinger(closes, 20, 2);
  const a14 = atr(c, 14);
  const hi = highest(closes, 20);
  const lo = lowest(closes, 20);
  const cols = FEATURE_NAMES.map(() => new Float64Array(c.length));
  const ratio = (a: number | null, b: number | null): number => (a == null || b == null || b === 0 ? 0 : a / b - 1);
  for (let i = 0; i < c.length; i++) {
    const k = [
      ratio(closes[i], s10[i]),
      ratio(closes[i], s30[i]),
      ratio(s10[i], s30[i]),
      ratio(s8[i], s34[i]),
      ratio(e12[i], e26[i]),
      m.histogram[i] == null ? 0 : (m.histogram[i] as number) / closes[i],
      r14[i] ?? 50,
      r5[i] ?? 50,
      bb.upper[i] != null && bb.lower[i] != null && (bb.upper[i] as number) > (bb.lower[i] as number)
        ? (closes[i] - (bb.lower[i] as number)) / ((bb.upper[i] as number) - (bb.lower[i] as number))
        : 0.5,
      a14[i] == null ? 0 : (a14[i] as number) / closes[i],
      hi[i] != null && lo[i] != null && (hi[i] as number) > (lo[i] as number) ? (closes[i] - (lo[i] as number)) / ((hi[i] as number) - (lo[i] as number)) : 0.5,
      i >= 1 ? closes[i] / closes[i - 1] - 1 : 0,
      i >= 5 ? closes[i] / closes[i - 5] - 1 : 0,
      i >= 20 ? closes[i] / closes[i - 20] - 1 : 0,
    ];
    k.forEach((v, j) => (cols[j][i] = v));
  }
  return cols;
}

interface TreeNode {
  leafClass?: number;
  counts: number[];
  feature?: number;
  threshold?: number;
  left?: TreeNode;
  right?: TreeNode;
}

const gini = (counts: number[], n: number): number => (n === 0 ? 0 : 1 - counts.reduce((a, c) => a + (c / n) * (c / n), 0));
const BINS = 64;

function trainTree(cols: Float64Array[], labels: Uint8Array, classes: number, rows: Int32Array, maxDepth: number, minLeaf: number, importance: number[], totalN: number): TreeNode {
  const counts = new Array<number>(classes).fill(0);
  for (const r of rows) counts[labels[r]]++;
  const node: TreeNode = { counts, leafClass: counts.indexOf(Math.max(...counts)) };
  const n = rows.length;
  const parentGini = gini(counts, n);
  if (maxDepth === 0 || n < minLeaf * 2 || parentGini === 0) return node;
  let best: { feature: number; threshold: number; gain: number } | null = null;
  for (let fi = 0; fi < cols.length; fi++) {
    const col = cols[fi];
    let min = Infinity;
    let max = -Infinity;
    for (const r of rows) {
      if (col[r] < min) min = col[r];
      if (col[r] > max) max = col[r];
    }
    if (!(max > min)) continue;
    const hist = Array.from({ length: BINS }, () => new Array<number>(classes).fill(0));
    const width = (max - min) / BINS;
    for (const r of rows) hist[Math.min(BINS - 1, Math.floor((col[r] - min) / width))][labels[r]]++;
    const left = new Array<number>(classes).fill(0);
    let nl = 0;
    for (let b = 0; b < BINS - 1; b++) {
      for (let k = 0; k < classes; k++) {
        left[k] += hist[b][k];
        nl += hist[b][k];
      }
      const nr = n - nl;
      if (nl < minLeaf || nr < minLeaf) continue;
      const right = counts.map((c, k) => c - left[k]);
      const gain = parentGini - (nl / n) * gini(left, nl) - (nr / n) * gini(right, nr);
      if (!best || gain > best.gain) best = { feature: fi, threshold: min + width * (b + 1), gain };
    }
  }
  if (!best || best.gain < 1e-6) return node;
  importance[best.feature] += best.gain * (n / totalN);
  const l: number[] = [];
  const r: number[] = [];
  for (const row of rows) (cols[best.feature][row] <= best.threshold ? l : r).push(row);
  node.feature = best.feature;
  node.threshold = best.threshold;
  node.left = trainTree(cols, labels, classes, Int32Array.from(l), maxDepth - 1, minLeaf, importance, totalN);
  node.right = trainTree(cols, labels, classes, Int32Array.from(r), maxDepth - 1, minLeaf, importance, totalN);
  return node;
}

function predict(node: TreeNode, cols: Float64Array[], row: number): number {
  let cur = node;
  while (cur.feature != null) cur = (cols[cur.feature][row] <= (cur.threshold as number) ? cur.left : cur.right) as TreeNode;
  return cur.leafClass as number;
}

function printRules(node: TreeNode, classNames: string[], indent = '    '): void {
  if (node.feature == null) {
    const n = node.counts.reduce((a, b) => a + b, 0);
    console.log(`${indent}=> ${classNames[node.leafClass as number]} (${n} bars, ${f((100 * node.counts[node.leafClass as number]) / Math.max(1, n), 0)}% pure)`);
    return;
  }
  console.log(`${indent}if ${FEATURE_NAMES[node.feature]} <= ${f(node.threshold as number, 5)}:`);
  printRules(node.left as TreeNode, classNames, indent + '  ');
  console.log(`${indent}else:`);
  printRules(node.right as TreeNode, classNames, indent + '  ');
}

/** Labels from highlights. `state`: 1 while held between a highlighted entry and the next highlighted exit. */
function stateLabels(n: number, h: Marks): Uint8Array {
  const out = new Uint8Array(n);
  const ex = h.exits;
  let xi = 0;
  for (const e of h.entries) {
    while (xi < ex.length && ex[xi] <= e) xi++;
    const end = xi < ex.length ? ex[xi] : n;
    for (let i = e; i < end; i++) out[i] = 1;
  }
  return out;
}

/** Event labels: 0 none, 1 entry, 2 exit (the highlighted bar only). */
function eventLabels(n: number, h: Marks): Uint8Array {
  const out = new Uint8Array(n);
  for (const e of h.entries) out[e] = 1;
  for (const x of h.exits) out[x] = 2;
  return out;
}

function approachB(label: string, candles: Candle[], truth: Marks): void {
  console.log(`\n-- Approach B (decision tree) on ${label} --`);
  const n = candles.length;
  const split = Math.floor(n * TRAIN_FRACTION);
  const t0 = performance.now();
  const cols = features(candles);
  perf(`compute ${FEATURE_NAMES.length} indicator features`, t0);

  const run = (name: string, labels: Uint8Array, classes: number, classNames: string[], depth: number): TreeNode => {
    const t1 = performance.now();
    const importance = new Array<number>(FEATURE_NAMES.length).fill(0);
    const rows = Int32Array.from({ length: split }, (_, i) => i);
    const tree = trainTree(cols, labels, classes, rows, depth, Math.max(5, Math.floor(split / 200)), importance, split);
    perf(`train ${name} tree (depth ${depth})`, t1);
    let ok = 0;
    for (let i = split; i < n; i++) if (predict(tree, cols, i) === labels[i]) ok++;
    console.log(`  ${name}: held-out accuracy ${f((100 * ok) / (n - split), 1)}% on ${n - split} bars`);
    const recall = new Array<number>(classes).fill(0);
    const support = new Array<number>(classes).fill(0);
    for (let i = split; i < n; i++) {
      support[labels[i]]++;
      if (predict(tree, cols, i) === labels[i]) recall[labels[i]]++;
    }
    console.log(`  per-class recall: ${classNames.map((c, k) => `${c} ${f((100 * recall[k]) / Math.max(1, support[k]), 0)}% of ${support[k]}`).join(', ')}`);
    const total = importance.reduce((a, b) => a + b, 0) || 1;
    const ranked = importance.map((v, i) => ({ name: FEATURE_NAMES[i], share: v / total })).filter((x) => x.share > 0).sort((a, b) => b.share - a.share);
    console.log(`  feature importance: ${ranked.map((r) => `${r.name} ${f(100 * r.share, 0)}%`).join(', ') || 'none'}`);
    console.log('  learned rules:');
    printRules(tree, classNames);
    return tree;
  };

  const highlights: Marks = { entries: truth.entries, exits: truth.exits };
  const stateTree = run('state tree (in a trade / flat)', stateLabels(n, highlights), 2, ['flat', 'in trade'], 3);
  // Turn the state tree back into entries and exits and compare with the highlights, held-out part only.
  const predSig: Signal[] = new Array<Signal>(n).fill(0);
  for (let i = split; i < n; i++) predSig[i] = predict(stateTree, cols, i) === 1 ? 1 : 0;
  const found = marksOf(predSig);
  const heldTruth: Marks = { entries: truth.entries.filter((b) => b >= split), exits: truth.exits.filter((b) => b >= split) };
  const m = f1(found, heldTruth, TOLERANCE);
  console.log(`  tree entries/exits vs highlights on held-out bars (tolerance ${TOLERANCE}): F1 ${f(m.f1, 3)} (P ${f(m.precision, 2)} R ${f(m.recall, 2)})`);

  const ev = eventLabels(n, highlights);
  run('event tree (none / entry / exit)', ev, 3, ['none', 'entry', 'exit'], 4);
}

/* ------------------------------- main ------------------------------- */

function runSeries(label: string, candles: Candle[]): void {
  console.log(`\n==== ${label}: ${candles.length} bars ====`);
  const hiddenSig = buildSignals(candles, HIDDEN.strategyId, HIDDEN.params);
  const perfect = marksOf(hiddenSig);
  const rand = mulberry32(12345);
  const truth: Marks = { entries: degrade(perfect.entries, rand, candles.length), exits: degrade(perfect.exits, rand, candles.length) };
  console.log(`hidden strategy ${HIDDEN.strategyId} ${JSON.stringify(HIDDEN.params)}: ${perfect.entries.length} entries / ${perfect.exits.length} exits`);
  console.log(`highlights after dropping ~${DROP_RATE * 100}% and shifting ~${SHIFT_RATE * 100}% by 1-${MAX_SHIFT} bars: ${truth.entries.length} entries / ${truth.exits.length} exits`);
  const t0 = performance.now();
  const hiddenBt = backtest(candles, hiddenSig);
  console.log(`hidden strategy full-series backtest: trades ${hiddenBt.metrics.trades}, return ${f(hiddenBt.metrics.totalReturnPct, 1)}%, win ${f(hiddenBt.metrics.winRatePct, 1)}%, R:R ${f(hiddenBt.rr)}, dd ${f(hiddenBt.metrics.maxDrawdownPct, 1)}%`);
  perf('one full backtest (engine + metrics)', t0);
  approachA(label, candles, truth);
  approachB(label, candles, truth);
}

const csv = candlesFromCsvText(readFileSync(new URL('../../../examples/sample-daily.csv', import.meta.url), 'utf8'));
console.log(`built-in strategies available: ${strategies.map((s) => s.id).join(', ')}`);
runSeries('sample-daily.csv', csv.candles);
const t = performance.now();
const synth = syntheticSeries(SYNTH_BARS, 20260101);
perf('generate synthetic series', t);
runSeries(`synthetic (seed 20260101)`, synth);
console.log(`\ndone. peak rss over the whole run: ${(process.resourceUsage().maxRSS / 1024).toFixed(0)} MB [perf]`);
