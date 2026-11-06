/**
 * Strategy style search probe (research spike for issue #431). Runs with vite-node, no new dependency, no key.
 *
 *   npx vite-node docs/spikes/strategy-style-search/probe.ts --self-check                  offline, seeded synthetic data
 *   npx vite-node docs/spikes/strategy-style-search/probe.ts --list [--stage lower|widen]  slices per stage, timeframe, group
 *   npx vite-node docs/spikes/strategy-style-search/probe.ts --stage lower --slice 0       one slice (network, cached)
 *   npx vite-node docs/spikes/strategy-style-search/probe.ts --report                      results.csv + output.txt
 *
 * (`npx vite-node <file> --flag` passes the flags through.)
 * Flags: --workers <W> with --worker <w> (instead of --slice: every W-th series, so W processes share the work), --stage lower|widen (default lower), --group crypto|stocks|indices, --timeframe <tf>, --slice <k>, --per-slice <n> (series per
 *        slice, default 6), --budget <seconds> (default 420; a slice that runs out of time stops cleanly between series
 *        and a rerun of the same slice carries on), --cache <dir> (candles and raw results; default
 *        <os temp>/vost-strategy-style-search), --max-bars <n> (default 4000).
 *
 * What it does: for a series (one market on one timeframe) it tries every signal family except Composed on the strategy
 * maker's grids, plus Composed (entry rules 1 to 6, trend and ADX filters, trend multiples 4 and 12), long only and
 * short only, each with 12 exits, on the first 70% of bars. A strategy is SELECTED when it has at least 30 trades there
 * and beats buy and hold; it is HELD when it also has at least 30 trades on the last 30% and beats buy and hold there.
 * The same search runs on a shuffled copy of the series. Everything is computed by the app's own modules
 * (`buildSignals`, `runBacktest`, `sweepConfig`, `figuresOf`, `buyHoldOf`, `exitsOf`, `candidatesOf`,
 * `composedSettings`, `shuffledCopy`); `--self-check` proves the figures equal the market search's (`runSweep`).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { Candle, Interval } from '../../../shared/market.ts';
import { runBacktest } from '../../../client/src/lib/backtest/engine';
import { buildSignals, DEFAULT_PARAMS } from '../../../client/src/lib/backtest/strategies';
import { mulberry32 } from '../../../client/src/lib/random';
import { candidatesOf, DEFAULT_SPACE, SELECTION_PCT, type Raw } from '../../../client/src/strategyMaker/engine/search';
import { SIGNAL_FAMILIES } from '../../../client/src/strategyMaker/engine/types';
import { composedCount, composedSettings, composedWords } from '../../../client/src/strategyMaker/sweep/composedSpace';
import { exitsOf, exitWords, typicalRangePct } from '../../../client/src/strategyMaker/sweep/exits';
import { shuffledCopy, seedOf } from '../../../client/src/strategyMaker/sweep/shuffle';
import { beatsBuyHold, buyHoldOf, figuresOf, runSweep, sweepConfig } from '../../../client/src/strategyMaker/sweep/sweep';
import type { ExitGrid, SweepComposed, SweepInput, SweepRisk } from '../../../client/src/strategyMaker/sweep/types';

/* ----------------------------- the rules of the run ----------------------------- */

/** $1000, 2% of equity risked at the stop, 10 bps fee and 5 bps slippage a side (the market search's defaults). */
const RISK: SweepRisk = { initialCapital: 1000, riskPct: 2, feeBps: 10, slippageBps: 5 };
/** Fewest trades, on the searched part and on the unseen part. */
const MIN_TRADES = 30;
/** Exits: range, ATR and trailing ATR stops, stop multiples 1 and 2, take profit multiples 1.5 and 3 = 12. */
const EXIT_GRID: ExitGrid = { stopMults: [1, 2], tpMults: [1.5, 3], kinds: ['range', 'atr', 'atr_trail'] };
/** Composed: entry rules 1 to 6, trend and ADX filters, trend multiples 4 and 12 (1 is always tried). */
const COMPOSED: SweepComposed = { entryRules: [1, 2, 3, 4, 5, 6], filters: ['trend', 'adx'], trendTfs: [4, 12] };
const PLAIN_FAMILIES = SIGNAL_FAMILIES.filter((f) => f !== 'composed');
const DIRECTIONS = [
  { name: 'long', value: 1 },
  { name: 'short', value: 2 },
] as const;
const ALPHA = 0.05;
/**
 * The latest bars searched per series. The brief allows up to 20,000; at that length one Binance series takes about
 * 8 CPU minutes (real and shuffled), 132 of them about 17 CPU hours on the 4 cores this run had, so the run uses the
 * latest 4,000 (see the README).
 */
const MAX_BARS_DEFAULT = 4000;
/** Held strategies kept per series for results.csv (the counts always cover all of them). */
const KEEP_PER_SERIES = 40;

const STAGES = { lower: ['1m', '5m', '15m', '30m'], widen: ['1h', '4h'] } as const;
type Stage = keyof typeof STAGES;
const GROUPS = ['crypto', 'stocks', 'indices'] as const;
type Group = (typeof GROUPS)[number];
const YAHOO_INTERVAL: Record<string, string> = { '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '60m' };

/** What a search tries: the plain families and Composed. Narrowed only by `--self-check`, to keep it fast. */
interface Grid {
  families: readonly string[];
  composed: SweepComposed | undefined;
  exits: ExitGrid;
}
const FULL_GRID: Grid = { families: PLAIN_FAMILIES, composed: COMPOSED, exits: EXIT_GRID };

const settingsCache = new Map<string, Raw[]>();
/** The signal settings of one direction on a timeframe, plain families first. */
function settingsOf(grid: Grid, timeframe: Interval, direction: number): Raw[] {
  const key = `${grid.families.join(',')}|${JSON.stringify(grid.composed)}|${timeframe}|${direction}`;
  let list = settingsCache.get(key);
  if (!list) {
    list = [];
    for (const id of grid.families) for (const c of candidatesOf(id, DEFAULT_SPACE[id], direction)) list.push(c);
    list.push(...composedSettings(grid.composed, timeframe, direction));
    settingsCache.set(key, list);
  }
  return list;
}

/* ----------------------------- one search ----------------------------- */

/** The figures of one part kept for a held strategy. */
interface Part {
  trades: number;
  signalsPerDay: number | null;
  hitPct: number | null;
  rr: number | null;
  drawdownPct: number;
  returnPct: number;
  buyHoldPct: number;
}

interface HeldRow {
  direction: 'long' | 'short';
  family: string;
  settings: string;
  exit: string;
  searched: Part;
  unseen: Part;
}

interface PassResult {
  /** No setting reached the trade minimum on the searched part (or the series could not be split). */
  tooShort: boolean;
  tried: number;
  selected: number;
  held: number;
  /** The best held strategies by how far they beat buy and hold on the unseen part (at most KEEP_PER_SERIES). */
  rows: HeldRow[];
}

type Figures = ReturnType<typeof figuresOf>;
const partOf = (f: Figures, bh: { buyHoldPct: number }): Part => ({
  trades: f.trades,
  signalsPerDay: f.signalsPerDay,
  hitPct: f.winRatePct,
  rr: f.rr,
  drawdownPct: f.maxDrawdownPct,
  returnPct: f.totalReturnPct,
  buyHoldPct: bh.buyHoldPct,
});

const num = (n: number): string => String(Number(n.toFixed(4)));
/** A setting in words: the family and its own settings (Composed through `composedWords`). */
function wordsOf(s: Raw): string {
  if (s.strategyId === 'composed') return composedWords(s.params);
  const own = Object.entries(s.params).filter(([k]) => k !== 'direction' && k in (DEFAULT_PARAMS[s.strategyId] ?? {}));
  return own.map(([k, v]) => `${k} ${num(v)}`).join(', ');
}

/**
 * Every setting with every exit on the first 70% of `candles`; the ones selected there are run on the last 30%.
 * Signals are built fresh on each part, as the market search does.
 */
function searchPass(candles: Candle[], timeframe: Interval, grid: Grid): PassResult {
  const res: PassResult = { tooShort: true, tried: 0, selected: 0, held: 0, rows: [] };
  const cut = Math.floor((candles.length * SELECTION_PCT) / 100);
  const sel = candles.slice(0, cut);
  const out = candles.slice(cut);
  if (sel.length < 2 || out.length < 2) return res;
  const range = typicalRangePct(sel);
  if (!(range > 0)) return res;
  const exits = exitsOf(range, grid.exits);
  const selHold = buyHoldOf(sel);
  const outHold = buyHoldOf(out);
  const kept: Array<{ score: number; row: HeldRow }> = [];
  for (const d of DIRECTIONS) {
    for (const s of settingsOf(grid, timeframe, d.value)) {
      const selSignals = buildSignals(sel, s.strategyId, s.params);
      let outSignals: unknown[] | null = null;
      for (const x of exits) {
        const config = sweepConfig(RISK, s.strategyId, s.params, x);
        const a = figuresOf(runBacktest(sel, selSignals, config), RISK.initialCapital);
        res.tried++;
        if (a.trades < MIN_TRADES) continue;
        res.tooShort = false;
        if (!beatsBuyHold('return', a, selHold)) continue;
        res.selected++;
        outSignals ??= buildSignals(out, s.strategyId, s.params);
        const b = figuresOf(runBacktest(out, outSignals, config), RISK.initialCapital);
        if (b.trades < MIN_TRADES || !beatsBuyHold('return', b, outHold)) continue;
        res.held++;
        kept.push({
          score: b.totalReturnPct - outHold.buyHoldPct,
          row: { direction: d.name, family: s.strategyId, settings: wordsOf(s), exit: exitWords(x), searched: partOf(a, selHold), unseen: partOf(b, outHold) },
        });
      }
    }
  }
  kept.sort((p, q) => q.score - p.score);
  res.rows = kept.slice(0, KEEP_PER_SERIES).map((k) => k.row);
  return res;
}

/** The shuffled copy of a series: the app's `shuffledCopy`, seeded from the series' name. */
const shuffleSeed = (provider: string, symbol: string, timeframe: string): number => seedOf(`${provider}|${symbol}|${timeframe}`);
const shuffledOf = (candles: Candle[], provider: string, symbol: string, timeframe: string): Candle[] =>
  shuffledCopy(candles, shuffleSeed(provider, symbol, timeframe));

interface SeriesResult {
  provider: string;
  symbol: string;
  timeframe: string;
  group: Group;
  stage: Stage;
  bars: number;
  real: PassResult;
  shuffled: PassResult;
  seconds: number;
}

function searchSeries(candles: Candle[], provider: string, symbol: string, timeframe: Interval, grid: Grid): Pick<SeriesResult, 'bars' | 'real' | 'shuffled'> {
  return {
    bars: candles.length,
    real: searchPass(candles, timeframe, grid),
    shuffled: searchPass(shuffledOf(candles, provider, symbol, timeframe), timeframe, grid),
  };
}

/* ----------------------------- the test ----------------------------- */

const logFact: number[] = [0];
for (let i = 1; i <= 2000; i++) logFact[i] = logFact[i - 1] + Math.log(i);
const logChoose = (n: number, k: number): number => logFact[n] - logFact[k] - logFact[n - k];

/** One-sided Fisher exact test: the chance of `r` or more of `n` real series against `s` of `n` shuffled ones, if they were alike. */
export function fisherOneSided(r: number, n: number, s: number, m: number): number {
  const total = n + m;
  const k = r + s;
  let p = 0;
  for (let x = r; x <= Math.min(n, k); x++) {
    if (k - x > m) continue;
    p += Math.exp(logChoose(k, x) + logChoose(total - k, n - x) - logChoose(total, n));
  }
  return Math.min(1, p);
}

interface Cell {
  stage: Stage;
  timeframe: string;
  group: Group;
  markets: number;
  tooShort: number;
  /** Series searched (long enough). */
  n: number;
  realSeries: number;
  shuffledSeries: number;
  realHeld: number;
  shuffledHeld: number;
  realSelected: number;
  shuffledSelected: number;
  realTried: number;
  shuffledTried: number;
  p: number;
  found: boolean;
  medianSignalsPerDay: number | null;
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** The cell of a timeframe and group from the series results in it. */
export function cellOf(stage: Stage, timeframe: string, group: Group, results: SeriesResult[]): Cell {
  const long = results.filter((r) => !r.real.tooShort);
  const sum = (f: (r: SeriesResult) => number): number => long.reduce((a, r) => a + f(r), 0);
  const realSeries = long.filter((r) => r.real.held > 0).length;
  const shuffledSeries = long.filter((r) => r.shuffled.held > 0).length;
  const n = long.length;
  const p = n > 0 ? fisherOneSided(realSeries, n, shuffledSeries, n) : 1;
  const fired = long.flatMap((r) => r.real.rows.map((x) => x.unseen.signalsPerDay)).filter((v): v is number => v != null);
  return {
    stage,
    timeframe,
    group,
    markets: results.length,
    tooShort: results.length - n,
    n,
    realSeries,
    shuffledSeries,
    realHeld: sum((r) => r.real.held),
    shuffledHeld: sum((r) => r.shuffled.held),
    realSelected: sum((r) => r.real.selected),
    shuffledSelected: sum((r) => r.shuffled.selected),
    realTried: sum((r) => r.real.tried),
    shuffledTried: sum((r) => r.shuffled.tried),
    p,
    found: realSeries > shuffledSeries && p < ALPHA,
    medianSignalsPerDay: median(fired),
  };
}

/** Whether the widening to 1h and 4h bars may run: stage 1 is complete and no cell of it found anything. */
export function mayWiden(stage1: { complete: boolean; cells: Array<Pick<Cell, 'found'>> }): boolean {
  return stage1.complete && !stage1.cells.some((c) => c.found);
}

/* ----------------------------- data ----------------------------- */

const UA = { 'user-agent': 'Mozilla/5.0 (Vost strategy-style-search spike)' };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string, tries = 5): Promise<unknown> {
  let last: unknown;
  for (let a = 0; a < tries; a++) {
    try {
      const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
      if (res.status === 429 || res.status === 418) {
        await sleep(Number(res.headers.get('retry-after') ?? 5) * 1000 + 500);
        last = new Error(`HTTP ${res.status}`);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return await res.json();
    } catch (err) {
      last = err;
      await sleep(1000 * (a + 1));
    }
  }
  throw last;
}

async function binanceCandles(symbol: string, tf: string, maxBars: number): Promise<Candle[]> {
  const out: Candle[] = [];
  let end: number | null = null;
  const nowMs = Date.now();
  while (out.length < maxBars) {
    const q: string = `symbol=${symbol}&interval=${tf}&limit=1000${end != null ? `&endTime=${end}` : ''}`;
    let rows: unknown;
    try {
      rows = await getJson(`https://api.binance.com/api/v3/klines?${q}`, 3);
    } catch {
      rows = await getJson(`https://data-api.binance.vision/api/v3/klines?${q}`);
    }
    const arr = rows as Array<[number, string, string, string, string, string, number]>;
    if (!arr.length) break;
    const part: Candle[] = arr.filter((k) => k[6] <= nowMs).map((k) => ({ time: k[0] / 1000, open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }));
    out.unshift(...part);
    if (arr.length < 1000) break;
    end = arr[0][0] - 1;
  }
  return out.slice(-maxBars);
}

/** The window Yahoo is asked for: the app's depth for intraday intervals (server/providers/yahoo.ts). */
const yahooRange = (interval: string): string => ({ '1m': '7d', '5m': '1mo', '15m': '1mo', '30m': '1mo', '60m': '2y' })[interval] ?? '2y';

async function yahooCandles(symbol: string, tf: string, maxBars: number): Promise<Candle[]> {
  const interval = YAHOO_INTERVAL[tf];
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${yahooRange(interval)}&includePrePost=false`;
  const j = (await getJson(url)) as { chart: { result?: Array<{ timestamp?: number[]; indicators: { quote: Array<Record<string, Array<number | null>>> } }> } };
  const r = j.chart.result?.[0];
  if (!r?.timestamp) return [];
  const q = r.indicators.quote[0];
  const out: Candle[] = [];
  r.timestamp.forEach((t, i) => {
    const o = q.open[i];
    const h = q.high[i];
    const l = q.low[i];
    const c = q.close[i];
    if (o == null || h == null || l == null || c == null || !(c > 0)) return;
    out.push({ time: t, open: o, high: h, low: l, close: c, volume: q.volume?.[i] ?? 0 });
  });
  out.pop(); // the last bar is still forming
  return out.slice(-maxBars);
}

/** Candles from the cache folder, fetched and stored on first use. */
async function loadCandles(cache: string, provider: 'binance' | 'yahoo', symbol: string, tf: string, maxBars: number): Promise<Candle[]> {
  const dir = join(cache, 'candles');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${provider}-${symbol.replace(/[^A-Za-z0-9.-]/g, '_')}-${tf}.json`);
  if (existsSync(file)) {
    const flat = JSON.parse(readFileSync(file, 'utf8')) as number[][];
    return flat.slice(-maxBars).map((k) => ({ time: k[0], open: k[1], high: k[2], low: k[3], close: k[4], volume: k[5] }));
  }
  const cs = provider === 'binance' ? await binanceCandles(symbol, tf, maxBars) : await yahooCandles(symbol, tf, maxBars);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(cs.map((c) => [c.time, c.open, c.high, c.low, c.close, c.volume])));
  renameSync(tmp, file);
  return cs;
}

/* ----------------------------- the universe ----------------------------- */

interface Unit {
  stage: Stage;
  timeframe: Interval;
  group: Group;
  provider: 'binance' | 'yahoo';
  /** The symbol to fetch. */
  symbol: string;
}

interface UniverseList {
  date: string;
  entries: Array<{ symbol: string; binance?: string }>;
}
interface Universe {
  cryptoCap: UniverseList;
  cryptoVolume: UniverseList;
  stocksCap: UniverseList;
  stocksVolume: UniverseList;
  indices: UniverseList;
}

const UNIVERSE_FILE = new URL('../strategy-search/universe.json', import.meta.url);
const loadUniverse = (): Universe => JSON.parse(readFileSync(UNIVERSE_FILE, 'utf8')) as Universe;

/** The markets of each group, each once, in list order. */
function marketsOf(u: Universe): Record<Group, Array<{ provider: 'binance' | 'yahoo'; symbol: string }>> {
  const dedupe = (syms: string[], provider: 'binance' | 'yahoo'): Array<{ provider: 'binance' | 'yahoo'; symbol: string }> =>
    [...new Set(syms)].map((symbol) => ({ provider, symbol }));
  return {
    crypto: dedupe([...u.cryptoCap.entries, ...u.cryptoVolume.entries].map((e) => e.binance ?? e.symbol), 'binance'),
    stocks: dedupe([...u.stocksCap.entries, ...u.stocksVolume.entries].map((e) => e.symbol), 'yahoo'),
    indices: dedupe(u.indices.entries.map((e) => e.symbol), 'yahoo'),
  };
}

/** Every series of a stage: timeframe outermost, then group, then market. Yahoo has no 4h bars. */
function unitsOf(u: Universe, stage: Stage): Unit[] {
  const markets = marketsOf(u);
  const out: Unit[] = [];
  for (const timeframe of STAGES[stage]) {
    for (const group of GROUPS) {
      for (const m of markets[group]) {
        if (m.provider === 'yahoo' && !(timeframe in YAHOO_INTERVAL)) continue;
        out.push({ stage, timeframe: timeframe as Interval, group, provider: m.provider, symbol: m.symbol });
      }
    }
  }
  return out;
}

/* ----------------------------- slices ----------------------------- */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string): boolean => process.argv.includes(`--${name}`);
const cacheDir = (): string => arg('cache') ?? join(tmpdir(), 'vost-strategy-style-search');
const stageArg = (): Stage => {
  const s = arg('stage') ?? 'lower';
  if (s !== 'lower' && s !== 'widen') throw new Error(`--stage must be lower or widen, not "${s}"`);
  return s;
};
const resultFile = (cache: string, u: Unit): string => join(cache, 'results', u.stage, u.timeframe, `${u.group}-${u.symbol.replace(/[^A-Za-z0-9.-]/g, '_')}.json`);
const fmt = (v: number | null | undefined, d = 2): string => (v == null || !Number.isFinite(v) ? 'n/a' : v.toFixed(d));

function readResults(cache: string, stage: Stage, units: Unit[]): { results: SeriesResult[]; missing: Unit[] } {
  const results: SeriesResult[] = [];
  const missing: Unit[] = [];
  for (const u of units) {
    const f = resultFile(cache, u);
    if (existsSync(f)) results.push(JSON.parse(readFileSync(f, 'utf8')) as SeriesResult);
    else missing.push(u);
  }
  return { results, missing };
}

function selectedUnits(): Unit[] {
  const group = arg('group');
  if (group && !(GROUPS as readonly string[]).includes(group)) throw new Error(`--group must be one of ${GROUPS.join(', ')}`);
  const tf = arg('timeframe');
  return unitsOf(loadUniverse(), stageArg()).filter((u) => (!group || u.group === group) && (!tf || u.timeframe === tf));
}

function list(): void {
  const per = Number(arg('per-slice') ?? 6);
  const units = selectedUnits();
  const by = new Map<string, number>();
  for (const u of units) by.set(`${u.timeframe} ${u.group}`, (by.get(`${u.timeframe} ${u.group}`) ?? 0) + 1);
  for (const [k, v] of by) console.log(`${k}: ${v} series`);
  console.log(`stage ${stageArg()}: ${units.length} series, ${Math.ceil(units.length / per)} slices of ${per} (slices 0..${Math.ceil(units.length / per) - 1})`);
}

async function runSlice(slice: number): Promise<void> {
  const t0 = performance.now();
  const budgetMs = Number(arg('budget') ?? 420) * 1000;
  const maxBars = Number(arg('max-bars') ?? MAX_BARS_DEFAULT);
  const per = Number(arg('per-slice') ?? 6);
  const cache = cacheDir();
  const stage = stageArg();
  if (stage === 'widen') {
    const lower = unitsOf(loadUniverse(), 'lower');
    const state = readResults(cache, 'lower', lower);
    const cells = cellsOf(state.results);
    if (!mayWiden({ complete: state.missing.length === 0, cells })) {
      console.log(`stage widen is not allowed: stage lower has ${state.missing.length} series missing and ${cells.filter((c) => c.found).length} found cells. Run the rest of stage lower first, or stop: something held.`);
      process.exitCode = 2;
      return;
    }
  }
  // `--worker w --workers W` takes every W-th series instead of a slice, so W processes share the work evenly.
  const workers = Number(arg('workers') ?? 0);
  const all = selectedUnits();
  const units = workers > 0 ? all.filter((_, i) => i % workers === slice) : all.slice(slice * per, (slice + 1) * per);
  if (!units.length) {
    console.log(`stage ${stage} slice ${slice}: no series (nothing to do)`);
    return;
  }
  let slowest = 0;
  for (const u of units) {
    const file = resultFile(cache, u);
    if (existsSync(file)) continue;
    if (performance.now() - t0 + slowest > budgetMs) {
      console.log(`budget used up before ${u.timeframe} ${u.symbol}; run the slice again to carry on`);
      return;
    }
    const t1 = performance.now();
    let candles: Candle[];
    try {
      candles = await loadCandles(cache, u.provider, u.symbol, u.timeframe, maxBars);
    } catch (err) {
      console.log(`${u.timeframe} ${u.group} ${u.symbol}: could not fetch candles (${err instanceof Error ? err.message : String(err)}); rerun to retry`);
      continue;
    }
    const r = searchSeries(candles, u.provider, u.symbol, u.timeframe, FULL_GRID);
    const result: SeriesResult = { provider: u.provider, symbol: u.symbol, timeframe: u.timeframe, group: u.group, stage: u.stage, ...r, seconds: Math.round((performance.now() - t1) / 100) / 10 };
    mkdirSync(join(file, '..'), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(result));
    renameSync(tmp, file);
    slowest = Math.max(slowest, performance.now() - t1);
    const p = (x: PassResult): string => (x.tooShort ? 'too short' : `tried ${x.tried}, selected ${x.selected}, held ${x.held}`);
    console.log(`${u.timeframe} ${u.group} ${u.symbol}: ${r.bars} bars | real ${p(r.real)} | shuffled ${p(r.shuffled)} | ${result.seconds}s`);
  }
  console.log(`stage ${stage} slice ${slice} done`);
}

/* ----------------------------- the report ----------------------------- */

function cellsOf(results: SeriesResult[]): Cell[] {
  const cells: Cell[] = [];
  const stages = [...new Set(results.map((r) => r.stage))] as Stage[];
  for (const stage of stages) {
    for (const tf of STAGES[stage]) {
      for (const group of GROUPS) {
        const rs = results.filter((r) => r.stage === stage && r.timeframe === tf && r.group === group);
        if (rs.length) cells.push(cellOf(stage, tf, group, rs));
      }
    }
  }
  return cells;
}

const PER_SERIES_TRIES = (tf: Interval, grid: Grid = FULL_GRID): number =>
  DIRECTIONS.reduce((a, d) => a + settingsOf(grid, tf, d.value).length, 0) * exitsOf(1, grid.exits).length;

const tableOf = (cells: Cell[]): string[] => {
  const head = ['Timeframe', 'Group', 'Markets', 'Too short', 'Searched', 'Real series held', 'Shuffled series held', 'p', 'Found', 'Held strategies real / shuffled', 'Share of tries held real / shuffled', 'Median signals per day (held)'];
  const lines = [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`];
  const share = (h: number, t: number): string => (t ? `${((h / t) * 100).toFixed(3)}%` : 'n/a');
  for (const c of cells) {
    lines.push(
      `| ${c.timeframe} | ${c.group} | ${c.markets} | ${c.tooShort} | ${c.n} | ${c.realSeries} | ${c.shuffledSeries} | ${fmt(c.p, 3)} | ${c.found ? 'YES' : 'no'} | ${c.realHeld} / ${c.shuffledHeld} | ${share(c.realHeld, c.realTried)} / ${share(c.shuffledHeld, c.shuffledTried)} | ${fmt(c.medianSignalsPerDay)} |`,
    );
  }
  return lines;
};

const csvCell = (v: string | number | null): string => {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function report(): void {
  const cache = cacheDir();
  const u = loadUniverse();
  const lower = readResults(cache, 'lower', unitsOf(u, 'lower'));
  const lowerCells = cellsOf(lower.results);
  const lines: string[] = [];
  const say = (s = ''): void => void lines.push(s);
  say(`Strategy style search (issue #431). Universe dated ${u.cryptoCap.date} (today's winners at that date: survivorship).`);
  say(`Rule: found = real series with a held strategy r > shuffled series s, and a one-sided Fisher exact test p < ${ALPHA}, in a timeframe and group.`);
  say(`Held = at least ${MIN_TRADES} trades and beats buy and hold on the searched part (first ${SELECTION_PCT}%) and on the unseen part (last ${100 - SELECTION_PCT}%).`);
  say(`Tries per series (both directions, 12 exits): ${(['1m', '1h'] as Interval[]).map((tf) => `${PER_SERIES_TRIES(tf)} on ${tf}`).join(', ')}.`);
  say();
  const stages: Array<{ stage: Stage; cells: Cell[]; results: SeriesResult[]; missing: Unit[] }> = [{ stage: 'lower', cells: lowerCells, results: lower.results, missing: lower.missing }];
  say('== Stage 1: 1m, 5m, 15m, 30m ==');
  say(`Series: ${lower.results.length} done, ${lower.missing.length} missing.`);
  for (const m of lower.missing.slice(0, 20)) say(`  missing: ${m.timeframe} ${m.group} ${m.symbol}`);
  say();
  tableOf(lowerCells).forEach(say);
  say();
  const foundLower = lowerCells.filter((c) => c.found);
  say(foundLower.length ? `Stage 1 FOUND ${foundLower.length} cell(s): ${foundLower.map((c) => `${c.timeframe} ${c.group}`).join(', ')}. Stage 2 (1h, 4h) was not run.` : lower.missing.length ? 'Stage 1 is incomplete, so no decision on stage 2 yet.' : 'Stage 1 found nothing, so stage 2 (1h and 4h) is run.');
  say();
  if (mayWiden({ complete: lower.missing.length === 0, cells: lowerCells })) {
    const wide = readResults(cache, 'widen', unitsOf(u, 'widen'));
    const cells = cellsOf(wide.results);
    stages.push({ stage: 'widen', cells, results: wide.results, missing: wide.missing });
    say('== Stage 2: 1h and 4h (Yahoo has no 4h bars, so 4h is crypto only) ==');
    say(`Series: ${wide.results.length} done, ${wide.missing.length} missing.`);
    for (const m of wide.missing.slice(0, 20)) say(`  missing: ${m.timeframe} ${m.group} ${m.symbol}`);
    say();
    tableOf(cells).forEach(say);
    say();
    const foundWide = cells.filter((c) => c.found);
    say(foundWide.length ? `Stage 2 FOUND ${foundWide.length} cell(s): ${foundWide.map((c) => `${c.timeframe} ${c.group}`).join(', ')}.` : wide.missing.length ? 'Stage 2 is incomplete.' : 'Stage 2 found nothing. The run stops here.');
    say();
  }

  // results.csv: one row per held strategy of a real series.
  const header = ['stage', 'group', 'market', 'timeframe', 'direction', 'family', 'settings', 'exit'];
  const partCols = (p: string): string[] => ['trades', 'signals_per_day', 'hit_rate_pct', 'rr', 'max_drawdown_pct', 'return_pct', 'buy_hold_pct'].map((c) => `${p}_${c}`);
  const csv = [[...header, ...partCols('searched'), ...partCols('unseen'), 'cell_real_held', 'cell_shuffled_held', 'cell_real_series_held', 'cell_shuffled_series_held', 'cell_found'].join(',')];
  let rows = 0;
  let cut = 0;
  const partRow = (p: Part): Array<string | number | null> => [p.trades, p.signalsPerDay == null ? null : +p.signalsPerDay.toFixed(3), p.hitPct == null ? null : +p.hitPct.toFixed(1), p.rr == null ? null : +p.rr.toFixed(2), +p.drawdownPct.toFixed(2), +p.returnPct.toFixed(2), +p.buyHoldPct.toFixed(2)];
  for (const s of stages) {
    for (const r of s.results) {
      cut += r.real.held - r.real.rows.length;
      const cell = s.cells.find((c) => c.timeframe === r.timeframe && c.group === r.group);
      for (const x of r.real.rows) {
        rows++;
        csv.push([s.stage, r.group, r.symbol, r.timeframe, x.direction, x.family, x.settings, x.exit, ...partRow(x.searched), ...partRow(x.unseen), cell?.realHeld ?? 0, cell?.shuffledHeld ?? 0, cell?.realSeries ?? 0, cell?.shuffledSeries ?? 0, cell?.found ? 'yes' : 'no'].map(csvCell).join(','));
      }
    }
  }
  say(`results.csv: ${rows} held strategies of real series (the best ${KEEP_PER_SERIES} per series by unseen return over buy and hold; ${cut} more held strategies are counted in the tables but not listed).`);
  const outDir = new URL('.', import.meta.url).pathname;
  writeFileSync(join(outDir, 'results.csv'), `${csv.join('\n')}\n`);
  writeFileSync(join(outDir, 'output.txt'), `${lines.join('\n')}\n`);
  console.log(lines.join('\n'));
}

/* ----------------------------- self-check ----------------------------- */

let failed = 0;
function ok(cond: boolean, msg: string): void {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failed++;
}

/** Standard normal from a seeded uniform source. */
const normal = (rand: () => number): number => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());

/** A seeded series. With `edge`, the bar after a fast average (8) above a slow one (22) drifts up by `edge` percent and otherwise down by as much, so buy and hold gains little. */
function synthetic(seed: number, bars: number, edge: number, noise = 0.4, stepSeconds = 300): Candle[] {
  const rand = mulberry32(seed);
  const closes: number[] = [100];
  const out: Candle[] = [];
  const sma = (n: number): number => closes.slice(-n).reduce((a, b) => a + b, 0) / Math.min(n, closes.length);
  const t0 = 1_700_000_000;
  for (let i = 0; i < bars; i++) {
    const prev = closes[closes.length - 1];
    const inState = closes.length >= 22 && sma(8) > sma(22);
    const ret = (normal(rand) * noise + (inState ? edge : -edge)) / 100;
    const open = prev;
    const close = prev * (1 + ret);
    const wick = (): number => Math.abs(normal(rand)) * 0.003;
    out.push({ time: t0 + i * stepSeconds, open, high: Math.max(open, close) * (1 + wick()), low: Math.min(open, close) * (1 - wick()), close, volume: 1000 + Math.floor(rand() * 500) });
    closes.push(close);
  }
  return out;
}

/** The narrowed grid the self-check searches (the full grid would take minutes per series). */
const SMALL_GRID: Grid = { families: ['sma_cross', 'ema_cross', 'macd_cross', 'donchian'], composed: { entryRules: [1, 2], filters: ['trend'], trendTfs: [4] }, exits: EXIT_GRID };

async function selfCheck(): Promise<void> {
  // The grid: the numbers the README states.
  const per = (tf: Interval): number => PLAIN_FAMILIES.reduce((a, id) => a + [...candidatesOf(id, DEFAULT_SPACE[id], 1)].length, 0) + composedCount(COMPOSED, tf);
  const plain = PLAIN_FAMILIES.reduce((a, id) => a + [...candidatesOf(id, DEFAULT_SPACE[id], 1)].length, 0);
  console.log(`grid: ${plain} plain settings + ${composedCount(COMPOSED, '5m')} Composed = ${per('5m')} per direction, ${exitsOf(1, EXIT_GRID).length} exits, ${PER_SERIES_TRIES('5m')} tries per series`);
  ok(settingsOf(FULL_GRID, '5m', 1).length === per('5m'), 'the settings built equal the settings counted');
  ok(exitsOf(1, EXIT_GRID).length === 12, 'there are 12 exits');
  ok(settingsOf(FULL_GRID, '5m', 2).every((s) => s.params.direction === 2) && settingsOf(FULL_GRID, '5m', 1).every((s) => s.params.direction === 1), 'long and short settings carry their direction');

  // (1) A planted long edge is found and held.
  const planted = synthetic(11, 3000, 0.05);
  const edge = searchSeries(planted, 'synthetic', 'PLANTED', '5m', SMALL_GRID);
  const best = edge.real.rows[0];
  console.log(`planted edge: tried ${edge.real.tried}, selected ${edge.real.selected}, held ${edge.real.held}${best ? `; best ${best.direction} ${best.family} ${best.settings}; ${best.exit}` : ''}`);
  ok(edge.real.selected > 0 && edge.real.held > 0, 'planted edge: at least one strategy is selected and held');
  ok(!!best && best.searched.trades >= MIN_TRADES && best.unseen.trades >= MIN_TRADES, 'planted edge: the best has at least 30 trades on both parts');
  ok(!!best && best.searched.returnPct > best.searched.buyHoldPct && best.unseen.returnPct > best.unseen.buyHoldPct, 'planted edge: the best beats buy and hold on both parts');
  const edgeCell = cellOf('lower', '5m', 'crypto', [{ provider: 'synthetic', symbol: 'PLANTED', timeframe: '5m', group: 'crypto', stage: 'lower', seconds: 0, ...edge }]);
  ok(edgeCell.realSeries === 1, 'planted edge: the series counts as held');

  // (2) Random walks give no found cell: 12 seeded walks, real and shuffled.
  const walks: SeriesResult[] = [];
  for (let k = 0; k < 12; k++) {
    walks.push({ provider: 'synthetic', symbol: `WALK${k}`, timeframe: '5m', group: 'crypto', stage: 'lower', seconds: 0, ...searchSeries(synthetic(100 + k, 3000, 0), 'synthetic', `WALK${k}`, '5m', SMALL_GRID) });
  }
  const walkCell = cellOf('lower', '5m', 'crypto', walks);
  console.log(`random walks: ${walkCell.n} searched, real series held ${walkCell.realSeries}, shuffled series held ${walkCell.shuffledSeries}, p ${fmt(walkCell.p, 3)}, held strategies ${walkCell.realHeld} real / ${walkCell.shuffledHeld} shuffled`);
  ok(!walkCell.found, 'random walks: no found cell');

  // (3) The probe's figures equal the market search's for the same setting and exit.
  const series = synthetic(7, 4000, 0.05);
  const market = { provider: 'synthetic', symbol: 'EQ' };
  const input: SweepInput = {
    markets: [market],
    timeframes: ['5m'],
    families: ['sma_cross'],
    space: { sma_cross: [{ key: 'fast', from: 5, to: 5, step: 1 }, { key: 'slow', from: 15, to: 15, step: 1 }] },
    direction: 'long',
    targetSets: [{ minHitRatePct: 0, minRR: 0 }],
    risk: RISK,
    exits: EXIT_GRID,
    composed: { entryRules: [2], filters: ['trend'], trendTfs: [4] },
    beatBuyHold: 'off',
  };
  const swept = await runSweep(input, async () => series);
  const cut = Math.floor((series.length * SELECTION_PCT) / 100);
  const sel = series.slice(0, cut);
  const out = series.slice(cut);
  const exits = exitsOf(typicalRangePct(sel), EXIT_GRID);
  let compared = 0;
  let same = 0;
  for (const c of swept.candidates) {
    const x = exits.find((e) => e.kind === c.exit?.kind && e.stopMult === c.exit?.stopMult && e.tpMult === c.exit?.tpMult);
    if (!x) continue;
    const config = sweepConfig(RISK, c.strategyId, c.params, x);
    const a = figuresOf(runBacktest(sel, buildSignals(sel, c.strategyId, c.params), config), RISK.initialCapital);
    const b = figuresOf(runBacktest(out, buildSignals(out, c.strategyId, c.params), config), RISK.initialCapital);
    const eq = (p: Figures & { buyHoldPct?: number }, q: Part): boolean =>
      p.trades === q.trades && p.totalReturnPct === q.returnPct && p.winRatePct === q.hitPct && p.rr === q.rr && p.maxDrawdownPct === q.drawdownPct && p.signalsPerDay === q.signalsPerDay && p.buyHoldPct === q.buyHoldPct;
    compared++;
    if (eq({ ...c.selection }, partOf(a, buyHoldOf(sel))) && eq({ ...c.heldOut }, partOf(b, buyHoldOf(out)))) same++;
  }
  console.log(`market search: ${swept.candidates.length} candidates, ${compared} compared, ${same} equal`);
  ok(compared >= 12 && same === compared, 'figures equal runSweep\'s for the same setting and exit (SMA 5/15 and Composed EMA with trend)');
  ok(compared > 0 && swept.candidates.some((c) => c.strategyId === 'composed'), 'the comparison includes a Composed setting');
  // The probe's own pass sees the same selected strategies as the market search would, when asked for return over buy and hold only.
  const probeSel = searchPass(series, '5m', { families: ['sma_cross'], composed: undefined, exits: { stopMults: [1], tpMults: [3], kinds: ['range'] } });
  ok(probeSel.tried === 2 * settingsOf({ families: ['sma_cross'], composed: undefined, exits: EXIT_GRID }, '5m', 1).length, 'the pass tries every setting in both directions with every exit');

  // (4) The shuffled copy is the app's, with the stated seed.
  const copy = shuffledOf(series, 'binance', 'BTCUSDT', '1m');
  const again = shuffledCopy(series, seedOf('binance|BTCUSDT|1m'));
  ok(JSON.stringify(copy) === JSON.stringify(again), 'shuffled copy equals shuffledCopy(candles, seedOf("binance|BTCUSDT|1m"))');
  ok(JSON.stringify(copy) !== JSON.stringify(shuffledOf(series, 'binance', 'ETHUSDT', '1m')), 'a different series name gives a different shuffle');
  ok(copy.length === series.length && copy[0] === series[0] && JSON.stringify(copy) !== JSON.stringify(series), 'the shuffle keeps the length and first bar and changes the rest');

  // (5) Fisher.
  const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol;
  ok(near(fisherOneSided(5, 10, 0, 10), 0.0163, 0.0005), `Fisher 5 of 10 against 0 of 10: p ${fisherOneSided(5, 10, 0, 10).toFixed(4)} (about 0.016)`);
  ok(near(fisherOneSided(1, 10, 0, 10), 0.5, 1e-9), `Fisher 1 of 10 against 0 of 10: p ${fisherOneSided(1, 10, 0, 10).toFixed(4)} (0.5)`);
  ok(near(fisherOneSided(0, 10, 0, 10), 1, 1e-9), 'Fisher 0 against 0: p 1');
  ok(near(fisherOneSided(10, 10, 0, 10), 1 / 184756, 1e-9), 'Fisher 10 of 10 against 0 of 10: p 1/184756');
  ok(fisherOneSided(2, 10, 5, 10) > 0.5, 'Fisher: fewer real than shuffled is never significant');
  const mk = (realSeries: number, shuffledSeries: number): Cell => ({ ...walkCell, realSeries, shuffledSeries, n: 10, p: fisherOneSided(realSeries, 10, shuffledSeries, 10), found: realSeries > shuffledSeries && fisherOneSided(realSeries, 10, shuffledSeries, 10) < ALPHA });
  ok(mk(5, 0).found && !mk(1, 0).found && !mk(4, 4).found && !mk(3, 0).found && mk(4, 0).found, 'found needs more real than shuffled series and p below 0.05 (4 of 10 against 0: yes; 3 of 10: no)');

  // (6) The stage-2 rule.
  ok(mayWiden({ complete: true, cells: [mk(0, 0), mk(2, 2)] }), 'stage 2 runs when stage 1 is complete and has no found cell');
  ok(!mayWiden({ complete: true, cells: [mk(0, 0), mk(6, 0)] }), 'stage 2 does not run when stage 1 has a found cell');
  ok(!mayWiden({ complete: false, cells: [mk(0, 0)] }), 'stage 2 does not run while stage 1 is incomplete');

  if (failed) {
    console.log(`${failed} check(s) failed`);
    process.exitCode = 1;
  } else console.log('self-check passed');
}

/* ----------------------------- main ----------------------------- */

async function main(): Promise<void> {
  if (has('self-check')) return selfCheck();
  if (has('list')) return list();
  if (has('report')) return report();
  const slice = arg('slice') ?? arg('worker');
  if (slice != null) return runSlice(Number(slice));
  console.log('Give --self-check, --list, --slice <k> [--stage lower|widen] or --report. See the top of probe.ts.');
}

await main();
