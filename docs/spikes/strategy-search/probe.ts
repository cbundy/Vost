/**
 * Strategy search probe (research spike for issue #409). Plain `node`, no new dependency, no key.
 *
 *   node docs/spikes/strategy-search/probe.ts --self-check                       offline, seeded synthetic data
 *   node docs/spikes/strategy-search/probe.ts --build-universe                   rewrites universe.json (network)
 *   node docs/spikes/strategy-search/probe.ts --list                             slices per group
 *   node docs/spikes/strategy-search/probe.ts --group <g> --slice <k>            one slice (network, cached)
 *   node docs/spikes/strategy-search/probe.ts --report                           results.csv + output.txt
 *
 * g is one of crypto-cap, crypto-volume, stocks-cap, stocks-volume, indices, baseline.
 * Flags: --cache <dir> (candles and raw results; default <os temp>/vost-strategy-search),
 *        --per-slice <n> (series per slice, default 20), --budget <seconds> (default 420; a slice that runs out of
 *        time stops cleanly and a rerun of the same slice carries on), --max-bars <n> (default 20000).
 *
 * What it does: for a series (one market on one timeframe) it tries the six built-in strategy families over the
 * strategy maker's grids, long only and short only, each with a stop and a take profit, on the first 70% of bars.
 * A combination that meets a target is run again on the last 30%. Sizing is 2% of equity risked at the stop,
 * compounding from $1000. The exits and fills follow the app's backtest engine (client/src/lib/backtest/engine.ts);
 * `--self-check` proves the fast simulator here gives the same trades as that engine.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { Candle } from '../../../shared/market.ts';
import type { Signal } from '../../../client/src/lib/backtest/types.ts';

// The app's modules import each other without file extensions (the bundler resolves them). Plain `node` does not,
// so a synchronous resolve hook retries a failed relative import with `.ts` / `/index.ts`. Nothing in the app is
// copied or changed. Imports below are dynamic so the hook is in place first.
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

const { buildSignals } = await import('../../../client/src/lib/backtest/strategies.ts');
const { runBacktest } = await import('../../../client/src/lib/backtest/engine.ts');
const { defaultBacktestConfig } = await import('../../../client/src/lib/backtest/types.ts');
const { mulberry32 } = await import('../../../client/src/lib/random.ts');

/* ----------------------------- settings ----------------------------- */

const START_EQUITY = 1000;
const RISK = 0.02; // share of current equity lost when the stop is hit
const APP_DEFAULTS = defaultBacktestConfig();
const FEE_BPS = APP_DEFAULTS.feeBps; // 10 per side
const SLIPPAGE_BPS = APP_DEFAULTS.slippageBps; // 5 per fill
const SELECTION_PCT = 0.7; // same split as the strategy maker (engine/search.ts SELECTION_PCT = 70)
const MIN_SEL_TRADES = 30;
const MIN_TEST_TRADES = 10;
const STOP_MULTS = [1, 2, 4]; // stop = this many typical bar ranges
const TP_RATIOS = [1, 1.5, 2, 3, 4, 5]; // take profit = ratio x stop
const DIRECTIONS = [1, 2] as const; // 1 long only, 2 short only
const TARGET_NAMES = ['A', 'B'] as const; // A: hit >= 75% and R:R >= 1; B: hit >= 50% and R:R >= 4
const TARGETS = [
  { hit: 75, rr: 1 },
  { hit: 50, rr: 4 },
];
const GROUPS = ['crypto-cap', 'crypto-volume', 'stocks-cap', 'stocks-volume', 'indices', 'baseline'] as const;
const BINANCE_TFS = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'];
const YAHOO_INTERVAL: Record<string, string> = { '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '60m', '1d': '1d', '1w': '1wk', '1M': '1mo' };
const YAHOO_TFS = Object.keys(YAHOO_INTERVAL);
const BASELINE_SEED = 409;
const BASELINE_SAMPLE = { crypto: 28, stocks: 40, indices: 10 };

interface SweepParam {
  key: string;
  from: number;
  to: number;
  step: number;
}

/** Copied from client/src/strategyMaker/engine/search.ts (DEFAULT_SPACE and validParams) at 7e27557. That module
 *  cannot load under plain node (it pulls in the Pine runtime), so --self-check compares this copy with its text. */
const DEFAULT_SPACE: Record<string, SweepParam[]> = {
  sma_cross: [
    { key: 'fast', from: 2, to: 30, step: 2 },
    { key: 'slow', from: 10, to: 80, step: 4 },
  ],
  ema_cross: [
    { key: 'fast', from: 2, to: 30, step: 2 },
    { key: 'slow', from: 10, to: 80, step: 4 },
  ],
  macd_cross: [
    { key: 'fast', from: 4, to: 20, step: 2 },
    { key: 'slow', from: 16, to: 40, step: 4 },
    { key: 'signal', from: 5, to: 13, step: 4 },
  ],
  rsi_reversion: [
    { key: 'length', from: 5, to: 30, step: 5 },
    { key: 'oversold', from: 20, to: 40, step: 5 },
    { key: 'overbought', from: 60, to: 80, step: 5 },
  ],
  bollinger: [
    { key: 'length', from: 10, to: 50, step: 10 },
    { key: 'mult', from: 1.5, to: 2.5, step: 0.5 },
    { key: 'mode', from: 0, to: 1, step: 1 },
  ],
  donchian: [
    { key: 'entry', from: 10, to: 60, step: 5 },
    { key: 'exit', from: 5, to: 30, step: 5 },
  ],
};
const FAMILIES = Object.keys(DEFAULT_SPACE);

function validParams(strategyId: string, p: Record<string, number>): boolean {
  if (strategyId === 'sma_cross' || strategyId === 'ema_cross' || strategyId === 'macd_cross') return p.fast < p.slow;
  if (strategyId === 'rsi_reversion') return p.oversold < p.overbought;
  return true;
}

function paramValues(s: SweepParam): number[] {
  const n = Math.floor((s.to - s.from) / s.step + 1e-9) + 1;
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(Math.round((s.from + i * s.step) * 1e6) / 1e6);
  return out;
}

/** Every valid parameter set of a family (the direction is added by the caller). */
function paramSets(family: string): Array<Record<string, number>> {
  const sweeps = DEFAULT_SPACE[family];
  const axes = sweeps.map(paramValues);
  const out: Array<Record<string, number>> = [];
  const idx = new Array<number>(sweeps.length).fill(0);
  for (;;) {
    const p: Record<string, number> = {};
    sweeps.forEach((s, i) => (p[s.key] = axes[i][idx[i]]));
    if (validParams(family, p)) out.push(p);
    let a = sweeps.length - 1;
    while (a >= 0 && ++idx[a] === axes[a].length) idx[a--] = 0;
    if (a < 0) return out;
  }
}

const SETS = Object.fromEntries(FAMILIES.map((f) => [f, paramSets(f)])) as Record<string, Array<Record<string, number>>>;
const SIGNAL_SETS = FAMILIES.reduce((a, f) => a + SETS[f].length * DIRECTIONS.length, 0);
const COMBOS_PER_SERIES = SIGNAL_SETS * STOP_MULTS.length * TP_RATIOS.length;

/* ----------------------------- simulator ----------------------------- */

/**
 * The app's engine (single position, signal on the close of bar i fills at the open of bar i+1, stop and take profit
 * checked inside the bar with the stop first, gap-through fills at the open, fee and slippage per fill, a stop or
 * take profit needs the signal to leave that side before re-entering), reduced to what the search needs: the net
 * result of each trade as a fraction of its entry notional. Equals the engine's `pnlPct / 100` (self-check proves it).
 */
function simulate(
  open: ArrayLike<number>,
  high: ArrayLike<number>,
  low: ArrayLike<number>,
  close: ArrayLike<number>,
  sig: ArrayLike<Signal>,
  allowShort: boolean,
  stopPct: number,
  tpPct: number,
  out: number[],
  bars?: number[],
): void {
  const n = close.length;
  const fee = FEE_BPS / 10000;
  const slip = SLIPPAGE_BPS / 10000;
  let side = 0;
  let entry = 0;
  let entryBar = 0;
  let requireReset = 0;
  const closeAt = (raw: number, bar: number): void => {
    const fill = side === 1 ? raw * (1 - slip) : raw * (1 + slip);
    const r = fill / entry;
    out.push(side * (r - 1) - fee - fee * r);
    if (bars) bars.push(entryBar, bar);
    side = 0;
  };
  for (let i = 1; i < n; i++) {
    let target = sig[i - 1];
    if (target != null) {
      if (requireReset !== 0) {
        if (target === requireReset) target = 0;
        else requireReset = 0;
      }
      if (target === -1 && !allowShort) target = 0;
      if (target !== side) {
        if (side !== 0) closeAt(open[i], i);
        if (target !== 0) {
          side = target;
          entry = target === 1 ? open[i] * (1 + slip) : open[i] * (1 - slip);
          entryBar = i;
        }
      }
    }
    if (side !== 0) {
      const stopPrice = entry * (1 - (side === 1 ? stopPct : -stopPct) / 100);
      const tpPrice = entry * (1 + (side === 1 ? tpPct : -tpPct) / 100);
      let exit = -1;
      if (side === 1) {
        if (low[i] <= stopPrice) exit = open[i] <= stopPrice ? open[i] : stopPrice;
        else if (high[i] >= tpPrice) exit = open[i] >= tpPrice ? open[i] : tpPrice;
      } else {
        if (high[i] >= stopPrice) exit = open[i] >= stopPrice ? open[i] : stopPrice;
        else if (low[i] <= tpPrice) exit = open[i] <= tpPrice ? open[i] : tpPrice;
      }
      if (exit >= 0) {
        const s = side;
        closeAt(exit, i);
        requireReset = s;
      }
    }
  }
  if (side !== 0) closeAt(close[n - 1], n - 1);
}

interface Stats {
  trades: number;
  hit: number | null; // percent
  rr: number | null; // average win over average loss
  final: number;
  dd: number; // max drawdown of the closed-trade equity, percent (positive)
}

/** Hit rate, R:R (as engine/backtest.ts: a zero result is a loss; no loss gives no R:R), and the compounded $1000. */
function statsOf(fracs: number[], stopPct: number): Stats {
  const n = fracs.length;
  let wins = 0;
  let sumWin = 0;
  let sumLoss = 0;
  let eq = START_EQUITY;
  let peak = eq;
  let dd = 0;
  for (const f of fracs) {
    if (f > 0) {
      wins++;
      sumWin += f;
    } else sumLoss -= f;
    eq = Math.max(0, eq * (1 + (RISK * f) / (stopPct / 100)));
    if (eq > peak) peak = eq;
    if (peak > 0) dd = Math.max(dd, (1 - eq / peak) * 100);
  }
  const losses = n - wins;
  const avgLoss = losses ? sumLoss / losses : 0;
  return {
    trades: n,
    hit: n ? (wins / n) * 100 : null,
    rr: avgLoss > 0 ? sumWin / wins / avgLoss : wins === 0 && n > 0 ? 0 : null,
    final: eq,
    dd,
  };
}

/** Bit 1 = target A met, bit 2 = target B met; 0 when under the minimum trades or no target is met. */
function metMask(s: Stats, minTrades: number): number {
  if (s.trades < minTrades || s.hit == null || s.rr == null) return 0;
  let m = 0;
  TARGETS.forEach((t, i) => {
    if (s.hit! >= t.hit && s.rr! >= t.rr) m |= 1 << i;
  });
  return m;
}

/* ----------------------------- search ----------------------------- */

interface Row {
  family: string;
  dir: 'long' | 'short';
  params: string;
  stopPct: number;
  tpPct: number;
  ratio: number;
  lev: number; // position size the 2% risk needed, as a multiple of equity
  sel: Stats;
  test: Stats;
  met: number;
  held: number;
}

interface Counts {
  combos: number;
  metA: number;
  metB: number;
  heldA: number;
  heldB: number;
  maxSelTrades: number;
}

interface UnitResult {
  group: string;
  symbol: string;
  tf: string;
  bars: number;
  tooShort: boolean;
  counts: Counts;
  rows: Row[];
  /** baseline only: the real series this one was shuffled from. */
  of?: string;
}

interface Arrays {
  o: Float64Array;
  h: Float64Array;
  l: Float64Array;
  c: Float64Array;
}

const arraysOf = (cs: Candle[]): Arrays => ({
  o: Float64Array.from(cs, (x) => x.open),
  h: Float64Array.from(cs, (x) => x.high),
  l: Float64Array.from(cs, (x) => x.low),
  c: Float64Array.from(cs, (x) => x.close),
});

const round = (v: number, sig: number): number => Number(v.toPrecision(sig));

/** Typical bar range as a percent of the close: the median of (high - low) / close. */
function typicalRangePct(cs: Candle[]): number {
  const r = cs.map((x) => ((x.high - x.low) / x.close) * 100).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  return r.length ? r[Math.floor(r.length / 2)] : 0;
}

const paramText = (p: Record<string, number>): string =>
  Object.entries(p)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');

function searchSeries(candles: Candle[], group: string, symbol: string, tf: string, keepRows: boolean, deadline = Infinity): UnitResult | null {
  const counts: Counts = { combos: 0, metA: 0, metB: 0, heldA: 0, heldB: 0, maxSelTrades: 0 };
  const result: UnitResult = { group, symbol, tf, bars: candles.length, tooShort: false, counts, rows: [] };
  const split = Math.floor(candles.length * SELECTION_PCT);
  const selC = candles.slice(0, split);
  const testC = candles.slice(split);
  const typical = typicalRangePct(selC);
  if (selC.length < 100 || !(typical > 0)) {
    result.tooShort = true;
    return result;
  }
  const sel = arraysOf(selC);
  const test = arraysOf(testC);
  const exits = STOP_MULTS.flatMap((m) => TP_RATIOS.map((r) => ({ stopPct: round(m * typical, 3), ratio: r })));
  const fr: number[] = [];
  for (const family of FAMILIES) {
    for (const set of SETS[family]) {
      for (const dir of DIRECTIONS) {
        if (performance.now() > deadline) return null;
        const params = { ...set, direction: dir };
        const selSig = buildSignals(selC, family, params);
        let testSig: Signal[] | null = null;
        for (const ex of exits) {
          const tpPct = round(ex.stopPct * ex.ratio, 4);
          fr.length = 0;
          simulate(sel.o, sel.h, sel.l, sel.c, selSig, dir === 2, ex.stopPct, tpPct, fr);
          counts.combos++;
          if (fr.length > counts.maxSelTrades) counts.maxSelTrades = fr.length;
          if (fr.length < MIN_SEL_TRADES) continue;
          const s = statsOf(fr, ex.stopPct);
          const met = metMask(s, MIN_SEL_TRADES);
          if (!met) continue;
          testSig ??= buildSignals(testC, family, params);
          fr.length = 0;
          simulate(test.o, test.h, test.l, test.c, testSig, dir === 2, ex.stopPct, tpPct, fr);
          const t = statsOf(fr, ex.stopPct);
          const held = met & metMask(t, MIN_TEST_TRADES);
          if (met & 1) counts.metA++;
          if (met & 2) counts.metB++;
          if (held & 1) counts.heldA++;
          if (held & 2) counts.heldB++;
          if (keepRows) {
            result.rows.push({ family, dir: dir === 1 ? 'long' : 'short', params: paramText(set), stopPct: ex.stopPct, tpPct, ratio: ex.ratio, lev: RISK / (ex.stopPct / 100), sel: s, test: t, met, held });
          }
        }
      }
    }
  }
  result.tooShort = counts.maxSelTrades < MIN_SEL_TRADES;
  return result;
}

/* ----------------------------- data ----------------------------- */

const UA = { 'user-agent': 'Mozilla/5.0 (Vost strategy-search spike)' };
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

/** The window Yahoo is asked for: the app's depth for intraday intervals (server/providers/yahoo.ts), the whole
 *  history for the rest. `range=max` makes Yahoo coarsen daily bars, so the full history is a dated window from 0. */
function yahooWindow(interval: string): string {
  const range = { '1m': '7d', '5m': '1mo', '15m': '1mo', '30m': '1mo', '60m': '2y' }[interval];
  return range ? `range=${range}` : `period1=0&period2=${Math.floor(Date.now() / 1000) + 1}`;
}

async function yahooCandles(symbol: string, tf: string, maxBars: number): Promise<Candle[]> {
  const interval = YAHOO_INTERVAL[tf];
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&${yahooWindow(interval)}&includePrePost=false`;
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

/* ----------------------------- universe ----------------------------- */

interface UniverseList {
  source: string;
  date: string;
  note?: string;
  entries: Array<{ symbol: string; name?: string; rank?: number; marketCap?: number; volume?: number; binance?: string }>;
  excluded?: Array<{ symbol: string; reason: string }>;
  skipped?: Array<{ symbol: string; reason: string }>;
}
interface Universe {
  cryptoCap: UniverseList;
  cryptoVolume: UniverseList;
  stocksCap: UniverseList;
  stocksVolume: UniverseList;
  indices: UniverseList;
}

const UNIVERSE_FILE = new URL('./universe.json', import.meta.url);
const STABLE = new Set(['USDT', 'USDC', 'DAI', 'FDUSD', 'TUSD', 'USDE', 'USDS', 'BUSD', 'PYUSD', 'USD1', 'USDD', 'FRAX', 'EURI', 'AEUR', 'USDP', 'GUSD', 'XUSD', 'RLUSD', 'BFUSD', 'USDG', 'USDF', 'USDTB', 'SUSDE', 'SUSDS', 'USYC', 'BUIDL', 'EUR', 'EURC', 'GBP', 'TRY', 'BRL', 'XAUT', 'PAXG', 'U', 'RWUSD']);
const WRAPPED = new Set(['WBTC', 'WETH', 'WBETH', 'WSTETH', 'WEETH', 'STETH', 'CBBTC', 'BTCB', 'WBNB', 'WEETH', 'RETH', 'CBETH', 'METH', 'LBTC', 'SOLVBTC', 'JITOSOL', 'BNSOL', 'MSOL', 'ETHFI']);
const NAME_EXCLUDE = /wrapped|staked|bridged|restaked|liquid staking|stablecoin|tokenized|usd coin|^usd|\busd\b/i;
const exclusionReason = (symbol: string, name: string): string | null => {
  const s = symbol.toUpperCase();
  if (STABLE.has(s)) return 'stablecoin or pegged to a fiat currency or gold';
  if (WRAPPED.has(s)) return 'wrapped, bridged or staked token (tracks another coin)';
  if (s.length > 3 && s.endsWith('USD')) return 'pegged to the dollar';
  if (/(UP|DOWN|BULL|BEAR)$/.test(s) && s.length > 5) return 'leveraged token';
  if (NAME_EXCLUDE.test(name)) return 'wrapped, staked or pegged by name';
  return null;
};

async function buildUniverse(): Promise<void> {
  const date = new Date().toISOString().slice(0, 10);
  const info = (await getJson('https://api.binance.com/api/v3/exchangeInfo')) as { symbols: Array<{ symbol: string; baseAsset: string; quoteAsset: string; status: string }> };
  const trading = new Set(info.symbols.filter((s) => s.quoteAsset === 'USDT' && s.status === 'TRADING').map((s) => s.baseAsset.toUpperCase()));

  const cg = (await getJson('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1')) as Array<{ id: string; symbol: string; name: string; market_cap: number }>;
  const cryptoCap: UniverseList = { source: 'CoinGecko /api/v3/coins/markets (vs_currency=usd, order=market_cap_desc, first 100), mapped to Binance USDT pairs (/api/v3/exchangeInfo, TRADING)', date, entries: [], excluded: [], skipped: [] };
  let rank = 0;
  let kept = 0;
  for (const c of cg) {
    rank++;
    const sym = c.symbol.toUpperCase();
    const why = exclusionReason(sym, c.name);
    if (why) {
      cryptoCap.excluded!.push({ symbol: sym, reason: `${why} (${c.name}, market cap rank ${rank})` });
      continue;
    }
    if (kept >= 30) break;
    kept++;
    if (!trading.has(sym)) {
      cryptoCap.skipped!.push({ symbol: sym, reason: `no TRADING ${sym}USDT pair on Binance (${c.name}, market cap rank ${rank})` });
      continue;
    }
    cryptoCap.entries.push({ symbol: `${sym}USDT`, name: c.name, rank, marketCap: c.market_cap, binance: `${sym}USDT` });
  }

  const cmc = await (await fetch('https://companiesmarketcap.com/usa/largest-companies-in-the-usa-by-market-cap/', { headers: UA })).text();
  const stocksCap: UniverseList = { source: 'companiesmarketcap.com, largest companies in the USA by market cap (US-listed; tickers as Yahoo writes them)', date, entries: [] };
  for (const m of cmc.matchAll(/<div class="company-name">([^<]*)<\/div><div class="company-code"><span class="rank d-none"><\/span>([^<]+)<\/div><\/a><\/div><\/td><td class="td-right" data-sort="(\d+)"/g)) {
    if (stocksCap.entries.length >= 30) break;
    stocksCap.entries.push({ symbol: m[2].trim(), name: m[1].trim(), rank: stocksCap.entries.length + 1, marketCap: Number(m[3]) });
  }

  const scr = (await getJson('https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=most_actives&count=100')) as { finance: { result: Array<{ quotes: Array<{ symbol: string; shortName?: string; averageDailyVolume3Month?: number; quoteType?: string }> }> } };
  const act = scr.finance.result[0].quotes.filter((q) => q.quoteType === 'EQUITY' && q.averageDailyVolume3Month).sort((a, b) => b.averageDailyVolume3Month! - a.averageDailyVolume3Month! || (a.symbol < b.symbol ? -1 : 1));
  const stocksVolume: UniverseList = {
    source: 'Yahoo Finance screener "most_actives" (US equities, the 100 most traded that day), ranked by 3-month average daily volume',
    date,
    note: 'The screener only lists the day\'s most active names, so a steady high-volume stock that was quiet that day can be missing.',
    entries: act.slice(0, 30).map((q, i) => ({ symbol: q.symbol, name: q.shortName, rank: i + 1, volume: q.averageDailyVolume3Month })),
  };

  const stockRoots = new Set([...stocksCap.entries, ...stocksVolume.entries].map((e) => e.symbol));
  for (const x of ['SNDK', 'SOXL', 'CRCL', 'MSTR', 'COIN', 'HOOD']) stockRoots.add(x);

  const tick = (await getJson('https://api.binance.com/api/v3/ticker/24hr')) as Array<{ symbol: string; quoteVolume: string }>;
  const byVol = tick
    .filter((t) => t.symbol.endsWith('USDT') && trading.has(t.symbol.slice(0, -4)))
    .map((t) => ({ base: t.symbol.slice(0, -4), symbol: t.symbol, vol: Number(t.quoteVolume) }))
    .sort((a, b) => b.vol - a.vol || (a.symbol < b.symbol ? -1 : 1));
  const cryptoVolume: UniverseList = { source: 'Binance /api/v3/ticker/24hr, USDT pairs ranked by 24h quote volume', date, entries: [], excluded: [] };
  for (const t of byVol) {
    if (cryptoVolume.entries.length >= 30) break;
    const why = exclusionReason(t.base, '') ?? (t.base.endsWith('B') && (stockRoots.has(t.base.slice(0, -1)) || (t.base.length >= 4 && !trading.has(t.base.slice(0, -1)))) ? 'tokenized stock or ETF (a "B" pair whose root is a stock or fund ticker, not a coin)' : null);
    if (why) {
      cryptoVolume.excluded!.push({ symbol: t.base, reason: why });
      continue;
    }
    cryptoVolume.entries.push({ symbol: t.symbol, rank: cryptoVolume.entries.length + 1, volume: Math.round(t.vol), binance: t.symbol });
  }

  const indices: UniverseList = {
    source: 'Fixed list of major tradable indices, via Yahoo Finance',
    date,
    entries: [
      ['^GSPC', 'S&P 500'], ['^NDX', 'Nasdaq 100'], ['^DJI', 'Dow Jones Industrial Average'], ['^RUT', 'Russell 2000'], ['^FTSE', 'FTSE 100'],
      ['^GDAXI', 'DAX'], ['^FCHI', 'CAC 40'], ['^N225', 'Nikkei 225'], ['^HSI', 'Hang Seng'], ['^STOXX50E', 'Euro Stoxx 50'],
    ].map(([symbol, name]) => ({ symbol, name })),
  };
  const u: Universe = { cryptoCap, cryptoVolume, stocksCap, stocksVolume, indices };
  writeFileSync(UNIVERSE_FILE, JSON.stringify(u, null, 2) + '\n');
  console.log(`universe.json written: crypto cap ${cryptoCap.entries.length} (skipped ${cryptoCap.skipped!.length}), crypto volume ${cryptoVolume.entries.length}, stocks cap ${stocksCap.entries.length}, stocks volume ${stocksVolume.entries.length}, indices ${indices.entries.length}`);
}

const loadUniverse = (): Universe => JSON.parse(readFileSync(UNIVERSE_FILE, 'utf8')) as Universe;

interface Market {
  symbol: string;
  provider: 'binance' | 'yahoo';
  kind: 'crypto' | 'stocks' | 'indices';
}

function marketsOf(u: Universe, group: string): Market[] {
  const mk = (l: UniverseList, provider: 'binance' | 'yahoo', kind: Market['kind']): Market[] => l.entries.map((e) => ({ symbol: e.binance ?? e.symbol, provider, kind }));
  switch (group) {
    case 'crypto-cap': return mk(u.cryptoCap, 'binance', 'crypto');
    case 'crypto-volume': return mk(u.cryptoVolume, 'binance', 'crypto');
    case 'stocks-cap': return mk(u.stocksCap, 'yahoo', 'stocks');
    case 'stocks-volume': return mk(u.stocksVolume, 'yahoo', 'stocks');
    case 'indices': return mk(u.indices, 'yahoo', 'indices');
    default: throw new Error(`unknown group ${group}`);
  }
}

const tfsOf = (provider: 'binance' | 'yahoo'): string[] => (provider === 'binance' ? BINANCE_TFS : YAHOO_TFS);

interface Unit {
  group: string;
  market: Market;
  tf: string;
  /** baseline: the shuffle seed. */
  seed?: number;
}

function hashSeed(text: string): number {
  let h = 2166136261 ^ BASELINE_SEED;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The baseline sample: a seeded pick of markets from the real groups (unique symbols), every timeframe of each. */
function baselineMarkets(u: Universe): Market[] {
  const rand = mulberry32(BASELINE_SEED);
  const pick = (ms: Market[], k: number): Market[] => {
    const uniq = [...new Map(ms.map((m) => [m.symbol, m])).values()].sort((a, b) => (a.symbol < b.symbol ? -1 : 1));
    for (let i = uniq.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [uniq[i], uniq[j]] = [uniq[j], uniq[i]];
    }
    return uniq.slice(0, k);
  };
  return [
    ...pick([...marketsOf(u, 'crypto-cap'), ...marketsOf(u, 'crypto-volume')], BASELINE_SAMPLE.crypto),
    ...pick([...marketsOf(u, 'stocks-cap'), ...marketsOf(u, 'stocks-volume')], BASELINE_SAMPLE.stocks),
    ...pick(marketsOf(u, 'indices'), BASELINE_SAMPLE.indices),
  ];
}

function unitsOf(u: Universe, group: string): Unit[] {
  const ms = group === 'baseline' ? baselineMarkets(u) : marketsOf(u, group);
  return ms.flatMap((market) => tfsOf(market.provider).map((tf) => ({ group, market, tf, seed: group === 'baseline' ? hashSeed(`${market.symbol}|${tf}`) : undefined })));
}

/** Same bars, the order of their returns shuffled: the gap from the last close, the high, low and close relative to
 *  the open are moved together, so the spread of moves stays and any pattern in time is gone. */
function shuffledCopy(cs: Candle[], seed: number): Candle[] {
  if (cs.length < 3) return cs;
  const rand = mulberry32(seed);
  const tuples = cs.slice(1).map((c, i) => [c.open / cs[i].close, c.high / c.open, c.low / c.open, c.close / c.open]);
  for (let i = tuples.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [tuples[i], tuples[j]] = [tuples[j], tuples[i]];
  }
  const out: Candle[] = [cs[0]];
  let prev = cs[0].close;
  tuples.forEach((t, i) => {
    const open = prev * t[0];
    const close = open * t[3];
    out.push({ time: cs[i + 1].time, open, high: Math.max(open * t[1], open, close), low: Math.min(open * t[2], open, close), close, volume: cs[i + 1].volume });
    prev = close;
  });
  return out;
}

/* ----------------------------- slices ----------------------------- */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string): boolean => process.argv.includes(`--${name}`);
const cacheDir = (): string => arg('cache') ?? join(tmpdir(), 'vost-strategy-search');

const unitKey = (group: string, symbol: string, tf: string): string => `${group}|${symbol}|${tf}`;
const fmt = (v: number | null, d = 2): string => (v == null || !Number.isFinite(v) ? 'n/a' : v.toFixed(d));

function readResults(cache: string): UnitResult[] {
  const dir = join(cache, 'results');
  if (!existsSync(dir)) return [];
  const out: UnitResult[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.jsonl')).sort()) {
    for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) if (line.trim()) out.push(JSON.parse(line) as UnitResult);
  }
  return out;
}

async function runSlice(group: string, slice: number): Promise<void> {
  const t0 = performance.now();
  const budgetMs = Number(arg('budget') ?? 420) * 1000;
  const maxBars = Number(arg('max-bars') ?? 20000);
  const per = Number(arg('per-slice') ?? 20);
  const cache = cacheDir();
  const units = unitsOf(loadUniverse(), group).slice(slice * per, (slice + 1) * per);
  if (!units.length) {
    console.log(`${group} slice ${slice}: no series (nothing to do)`);
    return;
  }
  const dir = join(cache, 'results');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${group}-${String(slice).padStart(3, '0')}.jsonl`);
  const done = new Set<string>();
  if (existsSync(file)) for (const line of readFileSync(file, 'utf8').split('\n')) if (line.trim()) done.add((JSON.parse(line) as UnitResult).symbol + '|' + (JSON.parse(line) as UnitResult).tf);
  let ran = 0;
  let skipped = 0;
  for (const u of units) {
    if (done.has(`${u.market.symbol}|${u.tf}`)) {
      skipped++;
      continue;
    }
    if (performance.now() - t0 > budgetMs) {
      console.log(`${group} slice ${slice}: out of time after ${ran} series, run the same command again to carry on`);
      return;
    }
    let cs = await loadCandles(cache, u.market.provider, u.market.symbol, u.tf, maxBars);
    const real = cs.length;
    if (group === 'baseline') cs = shuffledCopy(cs, u.seed!);
    const tU = performance.now();
    const res = searchSeries(cs, group, u.market.symbol, u.tf, group !== 'baseline', t0 + budgetMs * 1.4);
    if (!res) {
      console.log(`${group} slice ${slice}: out of time inside ${u.market.symbol} ${u.tf}, run the same command again to carry on`);
      return;
    }
    if (group === 'baseline') res.of = unitKey('real', u.market.symbol, u.tf);
    appendFileSync(file, JSON.stringify(res) + '\n');
    ran++;
    console.log(`${group} ${u.market.symbol} ${u.tf}: ${real} bars${res.tooShort ? ' (too short)' : ''}, met ${res.counts.metA}/${res.counts.metB}, held ${res.counts.heldA}/${res.counts.heldB}  [perf] ${(performance.now() - tU).toFixed(0)} ms`);
  }
  console.log(`${group} slice ${slice}: complete (${ran} run, ${skipped} already done)  [perf] ${((performance.now() - t0) / 1000).toFixed(0)} s`);
}

/* ----------------------------- report ----------------------------- */

const median = (v: number[]): number => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function report(): void {
  const cache = cacheDir();
  const all = readResults(cache);
  if (!all.length) throw new Error(`no results in ${cache}/results: run the slices first`);
  const real = all.filter((r) => r.group !== 'baseline').sort((a, b) => (unitKey(a.group, a.symbol, a.tf) < unitKey(b.group, b.symbol, b.tf) ? -1 : 1));
  const base = all.filter((r) => r.group === 'baseline').sort((a, b) => (a.symbol + a.tf < b.symbol + b.tf ? -1 : 1));
  const lines: string[] = [];
  const out = (s = ''): void => void lines.push(s);

  // results.csv
  const head = ['group', 'market', 'timeframe', 'bars', 'family', 'direction', 'params', 'stop_pct', 'take_profit_pct', 'tp_over_stop', 'met_targets', 'held_targets', 'size_x_equity',
    'sel_trades', 'sel_hit_pct', 'sel_rr', 'sel_final_equity', 'sel_max_dd_pct', 'test_trades', 'test_hit_pct', 'test_rr', 'test_final_equity', 'test_max_dd_pct'];
  const tn = (m: number): string => TARGET_NAMES.filter((_, i) => m & (1 << i)).join('+') || '-';
  const csv = [head.join(',')];
  for (const u of real) {
    for (const r of u.rows) {
      csv.push([u.group, u.symbol, u.tf, u.bars, r.family, r.dir, r.params, r.stopPct, r.tpPct, r.ratio, tn(r.met), tn(r.held), fmt(r.lev, 2),
        r.sel.trades, fmt(r.sel.hit, 1), fmt(r.sel.rr, 2), fmt(r.sel.final, 2), fmt(r.sel.dd, 1), r.test.trades, fmt(r.test.hit, 1), fmt(r.test.rr, 2), fmt(r.test.final, 2), fmt(r.test.dd, 1)].map(csvEscape).join(','));
    }
  }
  writeFileSync(new URL('./results.csv', import.meta.url), csv.join('\n') + '\n');

  const sum = (us: UnitResult[], k: keyof Counts): number => us.reduce((a, u) => a + u.counts[k], 0);
  const withHeld = (us: UnitResult[]): number => us.filter((u) => u.counts.heldA + u.counts.heldB > 0).length;
  const pct = (a: number, b: number): string => (b ? ((a / b) * 100).toFixed(1) : 'n/a');
  const tableOf = (title: string, groups: Map<string, UnitResult[]>, order: (k: string) => string = (k) => k): void => {
    out(title);
    out(`${'key'.padEnd(16)} ${'series'.padStart(7)} ${'tooShort'.padStart(9)} ${'combos'.padStart(11)} ${'metA'.padStart(7)} ${'metB'.padStart(7)} ${'heldA'.padStart(7)} ${'heldB'.padStart(7)} ${'series w/ held'.padStart(15)}`);
    for (const [k, us] of [...groups].sort((a, b) => (order(a[0]) < order(b[0]) ? -1 : 1))) {
      out(`${k.padEnd(16)} ${String(us.length).padStart(7)} ${String(us.filter((u) => u.tooShort).length).padStart(9)} ${String(sum(us, 'combos')).padStart(11)} ${String(sum(us, 'metA')).padStart(7)} ${String(sum(us, 'metB')).padStart(7)} ${String(sum(us, 'heldA')).padStart(7)} ${String(sum(us, 'heldB')).padStart(7)} ${String(withHeld(us)).padStart(15)}`);
    }
    out();
  };
  const groupBy = (us: UnitResult[], f: (u: UnitResult) => string): Map<string, UnitResult[]> => {
    const m = new Map<string, UnitResult[]>();
    for (const u of us) m.set(f(u), [...(m.get(f(u)) ?? []), u]);
    return m;
  };

  out('Strategy search report (issue 409). Targets: A = hit >= 75% and R:R >= 1, B = hit >= 50% and R:R >= 4.');
  out(`"met" = target reached on the first 70% of bars with >= ${MIN_SEL_TRADES} trades; "held" = same target on the last 30% with >= ${MIN_TEST_TRADES} trades.`);
  out(`Combinations per series: ${COMBOS_PER_SERIES} (${SIGNAL_SETS} signal sets x ${STOP_MULTS.length * TP_RATIOS.length} exits). $${START_EQUITY} start, ${RISK * 100}% risked at the stop, fees ${FEE_BPS} bps and slippage ${SLIPPAGE_BPS} bps per side.`);
  out();
  tableOf('By group (real data)', groupBy(real, (u) => u.group));
  const tfOrder = (tf: string): string => String(BINANCE_TFS.indexOf(tf)).padStart(2, '0');
  // The same market sits in more than one list (BTC in both crypto lists, NVDA in both stock lists): everything
  // below the group table counts each market and timeframe once, so nothing is counted twice.
  const seen = new Set<string>();
  const uniq = real.filter((u) => (seen.has(`${u.symbol}|${u.tf}`) ? false : (seen.add(`${u.symbol}|${u.tf}`), true)));
  out(`Distinct market-timeframe series: ${uniq.length} of ${real.length} (the lists overlap)`);
  out();
  tableOf('By timeframe (distinct series)', groupBy(uniq, (u) => u.tf), tfOrder);
  tableOf('Total (distinct series)', new Map([['all', uniq]]));

  // by family and direction, from rows (met rows only, so "combos" is not available)
  const rowsAll = uniq.flatMap((u) => u.rows.map((r) => ({ u, r })));
  out('Met and held results by family and direction (distinct series)');
  out(`${'key'.padEnd(22)} ${'met'.padStart(8)} ${'held'.padStart(8)} ${'held %'.padStart(8)}`);
  const fam = new Map<string, Array<{ u: UnitResult; r: Row }>>();
  for (const x of rowsAll) fam.set(`${x.r.family} ${x.r.dir}`, [...(fam.get(`${x.r.family} ${x.r.dir}`) ?? []), x]);
  for (const [k, xs] of [...fam].sort((a, b) => (a[0] < b[0] ? -1 : 1))) out(`${k.padEnd(22)} ${String(xs.length).padStart(8)} ${String(xs.filter((x) => x.r.held).length).padStart(8)} ${pct(xs.filter((x) => x.r.held).length, xs.length).padStart(8)}`);
  out();
  const kindOf = (u: UnitResult): string => (u.group.startsWith('crypto') ? 'crypto' : u.group.startsWith('stocks') ? 'stocks' : 'indices');
  const bySecurity = new Map<string, Array<{ u: UnitResult; r: Row }>>();
  for (const x of rowsAll.filter((x) => x.r.held)) bySecurity.set(`${x.u.symbol}`, [...(bySecurity.get(x.u.symbol) ?? []), x]);
  out('Markets with the most held results (top 15)');
  for (const [k, xs] of [...bySecurity].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1)).slice(0, 15)) out(`  ${k.padEnd(10)} ${String(xs.length).padStart(6)} held`);
  out();
  tableOf('By market kind (distinct series)', groupBy(uniq, kindOf));

  // held results: quality of the survivors
  const held = rowsAll.filter((x) => x.r.held);
  const heldProfitable = held.filter((x) => x.r.test.final > START_EQUITY);
  out(`Held results: ${held.length} (${heldProfitable.length} also ended the last 30% above $${START_EQUITY})`);
  const levs = held.map((x) => x.r.lev);
  const levAll = rowsAll.map((x) => x.r.lev);
  out(`Position size the 2% risk needed, as a multiple of equity: held results median ${fmt(median(levs), 2)}x, max ${fmt(Math.max(...levs), 2)}x; all met results median ${fmt(median(levAll), 2)}x, max ${fmt(Math.max(...levAll), 2)}x`);
  out(`Held results needing more than 1x equity (more than the app's backtester can place): ${levs.filter((l) => l > 1).length} of ${held.length}`);
  out();
  const best = [...held].sort((a, b) => b.r.test.final - a.r.test.final || (a.u.symbol + a.u.tf + a.r.params < b.u.symbol + b.u.tf + b.r.params ? -1 : 1)).slice(0, 25);
  out('Top 25 held results by final equity on the last 30%');
  for (const x of best) {
    const r = x.r;
    out(`  ${x.u.group} ${x.u.symbol} ${x.u.tf} ${r.family} ${r.dir} [${r.params}] stop ${r.stopPct}% tp ${r.tpPct}% | sel ${r.sel.trades} trades hit ${fmt(r.sel.hit, 1)} rr ${fmt(r.sel.rr, 2)} $${fmt(r.sel.final, 0)} | test ${r.test.trades} trades hit ${fmt(r.test.hit, 1)} rr ${fmt(r.test.rr, 2)} $${fmt(r.test.final, 0)} dd ${fmt(r.test.dd, 0)}% | size ${fmt(r.lev, 1)}x`);
  }
  out();
  const heldSeries = uniq.filter((u) => u.counts.heldA + u.counts.heldB > 0);
  out(`Series with at least one held result: ${heldSeries.length} of ${uniq.length}`);
  for (const u of heldSeries) out(`  ${u.symbol.padEnd(10)} ${u.tf.padEnd(3)} ${u.bars} bars: held A ${u.counts.heldA}, held B ${u.counts.heldB} (of ${u.counts.metA + u.counts.metB} met)`);
  out(`Trades on the last 30% in held results: median ${median(held.map((x) => x.r.test.trades))}, max ${Math.max(...held.map((x) => x.r.test.trades))}`);
  out();
  out('Every held result for target A (hit >= 75% and R:R >= 1)');
  for (const x of rowsAll.filter((x) => x.r.held & 1)) {
    const r = x.r;
    out(`  ${x.u.symbol} ${x.u.tf} ${r.family} ${r.dir} [${r.params}] stop ${r.stopPct}% tp ${r.tpPct}% | sel ${r.sel.trades} trades hit ${fmt(r.sel.hit, 1)} rr ${fmt(r.sel.rr, 2)} | test ${r.test.trades} trades hit ${fmt(r.test.hit, 1)} rr ${fmt(r.test.rr, 2)} $${fmt(r.test.final, 0)}`);
  }
  if (!rowsAll.some((x) => x.r.held & 1)) out('  none');
  out();
  const tooShort = uniq.filter((u) => u.tooShort);
  const shortBy = new Map<string, number>();
  for (const u of tooShort) shortBy.set(u.tf, (shortBy.get(u.tf) ?? 0) + 1);
  out(`Too short for ${MIN_SEL_TRADES} selection-part trades in any combination: ${tooShort.length} of ${uniq.length} distinct series; by timeframe: ${[...shortBy].sort().map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
  const bars = groupBy(uniq, (u) => u.tf);
  out('Bars per timeframe (median over series): ' + [...bars].sort((a, b) => BINANCE_TFS.indexOf(a[0]) - BINANCE_TFS.indexOf(b[0])).map(([k, us]) => `${k} ${median(us.map((u) => u.bars))}`).join(', '));
  out();

  // chance baseline
  out('Chance baseline (shuffled-return copies of a seeded sample of the same series)');
  if (!base.length) out('  no baseline results yet');
  else {
    const realByKey = new Map(uniq.map((u) => [`real|${u.symbol}|${u.tf}`, u]));
    const matched = base.map((b) => realByKey.get(b.of!)).filter((x): x is UnitResult => !!x);
    out(`  baseline series: ${base.length} (markets: ${[...new Set(base.map((b) => b.symbol))].length}); real counterparts found: ${matched.length}`);
    const line = (name: string, us: UnitResult[]): void => {
      const n = us.length || 1;
      out(`  ${name.padEnd(16)} series ${String(us.length).padStart(4)} | met A ${String(sum(us, 'metA')).padStart(6)} B ${String(sum(us, 'metB')).padStart(6)} | held A ${String(sum(us, 'heldA')).padStart(5)} B ${String(sum(us, 'heldB')).padStart(5)} | series with held ${String(withHeld(us)).padStart(4)} (${pct(withHeld(us), us.length)}%) | per series: met ${((sum(us, 'metA') + sum(us, 'metB')) / n).toFixed(2)}, held ${((sum(us, 'heldA') + sum(us, 'heldB')) / n).toFixed(3)}`);
    };
    line('shuffled', base.filter((b) => realByKey.has(b.of!)));
    line('real, same series', matched);
    line('real, all series', uniq);
    const bt = groupBy(base, (u) => u.tf);
    out('  shuffled by timeframe: ' + [...bt].sort((a, b) => (tfOrder(a[0]) < tfOrder(b[0]) ? -1 : 1)).map(([k, us]) => `${k} held ${sum(us, 'heldA') + sum(us, 'heldB')} of ${us.length} series`).join(', '));
  }
  writeFileSync(new URL('./output.txt', import.meta.url), lines.join('\n') + '\n');
  console.log(`results.csv: ${csv.length - 1} rows; output.txt: ${lines.length} lines`);
}

/* ----------------------------- self check ----------------------------- */

function normal(rand: () => number): number {
  return Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand());
}

function candleFrom(open: number, close: number, wickUp: number, wickDown: number, time: number): Candle {
  return { time, open, high: Math.max(open, close) * (1 + wickUp), low: Math.min(open, close) * (1 - wickDown), close, volume: 1000 };
}

/** Random walk where, every time the hidden strategy (SMA 8 over SMA 22, long) turns on, the next four bars rise
 *  0.8% each and never dip: that strategy with a take profit inside +3% wins every time. */
function hiddenSeries(bars: number, seed: number): Candle[] {
  const rand = mulberry32(seed);
  const out: Candle[] = [];
  const closes: number[] = [];
  let price = 100;
  let script = 0;
  let prevOn = false;
  for (let i = 0; i < bars; i++) {
    const t = 1_500_000_000 + i * 3600;
    let c: Candle;
    if (script > 0) {
      c = candleFrom(price, price * 1.008, 0.002, -0.0005 / 1, t);
      script--;
    } else {
      const close = Math.max(1, price * (1 + normal(rand) * 0.004));
      c = candleFrom(price, close, Math.abs(normal(rand)) * 0.002, Math.abs(normal(rand)) * 0.002, t);
    }
    out.push(c);
    closes.push(c.close);
    price = c.close;
    if (i >= 22) {
      const avg = (n: number): number => closes.slice(-n).reduce((a, b) => a + b, 0) / n;
      const on = avg(8) > avg(22);
      if (on && !prevOn) script = 4;
      prevOn = on;
    }
  }
  return out;
}

function randomWalk(bars: number, seed: number): Candle[] {
  const rand = mulberry32(seed);
  const out: Candle[] = [];
  let price = 100;
  for (let i = 0; i < bars; i++) {
    const close = Math.max(1, price * (1 + normal(rand) * 0.006));
    out.push(candleFrom(price, close, Math.abs(normal(rand)) * 0.003, Math.abs(normal(rand)) * 0.003, 1_500_000_000 + i * 3600));
    price = close;
  }
  return out;
}

function selfCheck(): void {
  const t0 = performance.now();
  let failed = 0;
  const check = (name: string, ok: boolean, detail = ''): void => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
    if (!ok) failed++;
  };

  // 1. the grids copied here are the strategy maker's
  const src = readFileSync(new URL('../../../client/src/strategyMaker/engine/search.ts', import.meta.url), 'utf8');
  const missing = FAMILIES.flatMap((f) => DEFAULT_SPACE[f].filter((s) => !src.includes(`{ key: '${s.key}', from: ${s.from}, to: ${s.to}, step: ${s.step} }`)).map((s) => `${f}.${s.key}`));
  check('grids match client/src/strategyMaker/engine/search.ts', missing.length === 0, missing.join(', ') || `${SIGNAL_SETS} signal sets, ${COMBOS_PER_SERIES} combinations per series`);
  check('app defaults are fee 10 bps, slippage 5 bps', FEE_BPS === 10 && SLIPPAGE_BPS === 5, `${FEE_BPS}/${SLIPPAGE_BPS}`);

  // 2. the sizing example from the issue: two losses from $1000 at 2%
  const two = statsOf([-0.01, -0.01], 1); // stop 1%, each trade loses exactly the stop
  const step1 = START_EQUITY * (1 - RISK);
  check('sizing: two losses from $1000 at 2% give $980.00 then $960.40', Math.abs(step1 - 980) < 1e-9 && Math.abs(two.final - 960.4) < 1e-9, `$${step1.toFixed(2)} then $${two.final.toFixed(2)}`);

  // 3. the fast simulator gives the engine's trades
  const walk = randomWalk(4000, 7);
  const a = arraysOf(walk);
  let compared = 0;
  let mismatches = 0;
  for (const [family, set] of [['sma_cross', { fast: 6, slow: 22 }], ['rsi_reversion', { length: 10, oversold: 30, overbought: 70 }], ['bollinger', { length: 20, mult: 2, mode: 0 }], ['donchian', { entry: 20, exit: 10 }], ['macd_cross', { fast: 8, slow: 24, signal: 9 }]] as const) {
    for (const dir of DIRECTIONS) {
      for (const [stop, tp] of [[0.5, 0.5], [1, 3], [2, 8], [0.3, 1.5]]) {
        const params = { ...set, direction: dir };
        const sig = buildSignals(walk, family, params);
        const fr: number[] = [];
        const bars: number[] = [];
        simulate(a.o, a.h, a.l, a.c, sig, dir === 2, stop, tp, fr, bars);
        const eng = runBacktest(walk, sig, { ...APP_DEFAULTS, strategyId: family, params, allowShort: dir === 2, stopLossPct: stop, takeProfitPct: tp });
        compared++;
        const same = eng.trades.length === fr.length && eng.trades.every((t, i) => Math.abs(t.pnlPct / 100 - fr[i]) < 1e-9 && t.entryBar === bars[2 * i] && t.exitBar === bars[2 * i + 1]);
        if (!same) mismatches++;
      }
    }
  }
  check('simulator equals the app engine, trade by trade', mismatches === 0 && compared > 0, `${compared - mismatches} of ${compared} settings identical`);

  // 4. a hidden strategy is found, and survives the hold-out
  const hidden = hiddenSeries(9000, 11);
  const found = searchSeries(hidden, 'self-check', 'HIDDEN', '1h', true);
  const hits = found!.rows.filter((r) => r.family === 'sma_cross' && r.dir === 'long' && r.params === 'fast=8 slow=22');
  const heldHits = hits.filter((r) => r.held & 1);
  check('hidden SMA 8/22 long strategy is found on the selection part and holds on the last 30%', heldHits.length > 0, `${hits.length} exits met, ${heldHits.length} held; ${found!.counts.heldA} held results over all families`);
  const best = heldHits.sort((x, y) => y.test.final - x.test.final)[0];
  if (best) console.log(`     best: stop ${best.stopPct}% tp ${best.tpPct}% sel ${best.sel.trades} trades hit ${fmt(best.sel.hit, 1)} rr ${fmt(best.sel.rr, 2)} | test ${best.test.trades} trades hit ${fmt(best.test.hit, 1)} rr ${fmt(best.test.rr, 2)} $${fmt(best.test.final, 0)} size ${fmt(best.lev, 1)}x`);

  // 5. a plain random walk (no pattern) gives almost nothing, and the shuffle is seeded
  const noise = searchSeries(randomWalk(9000, 5), 'self-check', 'NOISE', '1h', false)!;
  console.log(`     random walk: ${noise.counts.combos} combinations, met ${noise.counts.metA}/${noise.counts.metB}, held ${noise.counts.heldA}/${noise.counts.heldB}`);
  check('random walk has far fewer held results than the hidden strategy', noise.counts.heldA + noise.counts.heldB < found!.counts.heldA, `${noise.counts.heldA + noise.counts.heldB} vs ${found!.counts.heldA}`);
  const s1 = shuffledCopy(hidden, 3);
  const s2 = shuffledCopy(hidden, 3);
  const s3 = shuffledCopy(hidden, 4);
  check('shuffled copy is seeded and differs per seed', JSON.stringify(s1) === JSON.stringify(s2) && JSON.stringify(s1) !== JSON.stringify(s3) && s1.length === hidden.length);

  // 6. the same input twice gives the same digest
  const again = searchSeries(hidden, 'self-check', 'HIDDEN', '1h', true)!;
  check('two runs give identical results', JSON.stringify(again) === JSON.stringify(found));

  console.log(`  [perf] self-check: ${(performance.now() - t0).toFixed(0)} ms`);
  if (failed) {
    console.log(`${failed} check(s) failed`);
    process.exit(1);
  }
  console.log('all checks passed');
}

/* ----------------------------- main ----------------------------- */

if (has('self-check')) selfCheck();
else if (has('build-universe')) await buildUniverse();
else if (has('list')) {
  const u = loadUniverse();
  const per = Number(arg('per-slice') ?? 20);
  for (const g of GROUPS) {
    const n = unitsOf(u, g).length;
    console.log(`${g}: ${n} series, ${Math.ceil(n / per)} slices of up to ${per} (--slice 0..${Math.ceil(n / per) - 1})`);
  }
} else if (has('report')) report();
else if (arg('group') && arg('slice') != null && (GROUPS as readonly string[]).includes(arg('group')!)) await runSlice(arg('group')!, Number(arg('slice')));
else {
  console.log('usage: see the comment at the top of probe.ts (--self-check | --build-universe | --list | --group <g> --slice <k> | --report)');
  process.exit(2);
}
