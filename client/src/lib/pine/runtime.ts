/**
 * Pine Script runtime. Feeds Vost candles to PineTS (AGPL-3.0-only, see
 * docs/PINE.md) and maps its context into plain typed data. Never throws:
 * compile and runtime failures resolve to `{ ok: false, error }`.
 */
import { Indicator, type IImportResolver, type ImportResolverFn } from 'pinets';
import type { Candle } from '../../types';
import { mapDrawings } from './drawingObjects';
import { CurrencyRates, runWithRates } from './currencyRate';
import { createMarketProvider } from './market';
import { defaultMarketFeed, type MarketFeed } from './marketFeed';
import { RoutedPineTS, assertHooked } from './requestRouting';
import { createServerResolver, libraryMessage, missingLibraryPath } from './libraries';
import { mapMessages, takeLogs } from './messages';
import { detectPineVersion, legacyMessage } from './version';
import type {
  PineDrawings,
  PineInput,
  PineInputValue,
  PineMarket,
  PinePlot,
  PinePlotKind,
  PineRunOutcome,
  PineStrategyConfig,
  PineTrade,
} from './types';

const COLOR_NA = null;

function toNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** PineTS errors carry the position only in the message, as "at L:C". */
export function parseError(err: unknown): { message: string; line?: number; column?: number } {
  const message = err instanceof Error ? err.message : String(err);
  const m = /\bat (\d+):(\d+)/.exec(message);
  return m ? { message, line: Number(m[1]), column: Number(m[2]) } : { message };
}

/** plotarrow() is a `shape` plot with no plot-level shape, whose points carry arrow shapes or whose options carry its sizing. */
function isPlotArrow(opts: any, data: any[]): boolean {
  if (typeof opts.shape === 'string') return false;
  if (['colorup', 'colordown', 'minheight', 'maxheight'].some((k) => opts[k] !== undefined)) return true;
  return data.some((p) => /^(shape_)?arrow_?(up|down)$/i.test(String(p?.options?.shape ?? '')));
}

function plotKind(style: unknown, opts: any = {}, data: any[] = []): PinePlotKind {
  if (style === 'candle') return 'candle';
  if (style === 'bar') return 'bar';
  if (style === 'barcolor') return 'barcolor';
  if (style === 'shape' && isPlotArrow(opts, data)) return 'plotarrow';
  if (style === 'fill') return 'fill';
  if (style === 'hline') return 'hline';
  if (style === 'background') return 'bgcolor';
  if (style === 'shape' || style === 'char') return 'plotshape';
  return 'plot';
}

function mapPlots(plots: Record<string, any>, candles: Candle[], overlay: boolean): PinePlot[] {
  const out: PinePlot[] = [];
  /** PineTS plot key of each entry in `out`, and for a fill the keys it joins. */
  const keys: string[] = [];
  const joins: ([string, string] | null)[] = [];
  for (const [key, plot] of Object.entries(plots)) {
    if (key.startsWith('__') || !plot || !Array.isArray(plot.data)) continue;
    const opts = plot.options ?? {};
    const kind = plotKind(opts.style, opts, plot.data);
    // The gradient form of fill is not drawn.
    if (kind === 'fill' && opts.gradient) continue;
    keys.push(key);
    joins.push(kind === 'fill' ? [String(opts.plot1), String(opts.plot2)] : null);
    const byTime = new Map<number, { value: number | null; color: string | null; ohlc?: [number, number, number, number] | null; wick?: string | null; border?: string | null }>();
    const isOhlc = kind === 'candle' || kind === 'bar';
    for (const p of plot.data) {
      if (isOhlc) {
        const v = Array.isArray(p.value) ? p.value.map(toNum) : [];
        const ohlc = v.length === 4 && v.every((x: number | null) => x !== null) ? (v as [number, number, number, number]) : null;
        const str = (x: unknown) => (typeof x === 'string' ? x : null);
        byTime.set(p.time, { value: ohlc ? ohlc[3] : null, ohlc, color: str(p.options?.color), wick: str(p.options?.wickcolor), border: str(p.options?.bordercolor) });
        continue;
      }
      const absolute = String(p.options?.location ?? opts.location ?? '').toLowerCase() === 'absolute';
      const value =
        kind === 'plotshape' && absolute
          ? p.value === true ? 1 : toNum(p.value)
          : kind === 'bgcolor' || kind === 'plotshape' || kind === 'barcolor' ? (p.value === true ? 1 : null) : toNum(p.value);
      byTime.set(p.time, { value, color: typeof p.options?.color === 'string' ? p.options.color : null });
    }
    const pineOverlay = typeof opts.overlay === 'boolean' ? opts.overlay : overlay;
    const colors = candles.map((c) => byTime.get(c.time * 1000)?.color ?? null);
    const color = typeof opts.color === 'string' ? opts.color : kind === 'fill' ? colors.find((c) => c !== null) ?? COLOR_NA : COLOR_NA;
    const hasVaryingColor = colors.some((c) => c !== null && c !== color);
    out.push({
      name: plot.title ?? key,
      kind,
      values: candles.map((c) => byTime.get(c.time * 1000)?.value ?? null),
      color,
      ...(hasVaryingColor && { colors }),
      ...(isOhlc && {
        ohlc: candles.map((c) => byTime.get(c.time * 1000)?.ohlc ?? null),
        ...(kind === 'candle' && {
          wickColors: candles.map((c) => byTime.get(c.time * 1000)?.wick ?? null),
          borderColors: candles.map((c) => byTime.get(c.time * 1000)?.border ?? null),
        }),
      }),
      ...(kind === 'plotarrow' && {
        minHeight: toNum(opts.minheight) ?? 5,
        maxHeight: toNum(opts.maxheight) ?? 100,
      }),
      ...(kind === 'plotshape' && {
        shape: typeof opts.shape === 'string' ? opts.shape.replace(/^shape_/, '') : 'circle',
        location: typeof opts.location === 'string' ? opts.location : 'AboveBar',
      }),
      style: typeof opts.style === 'string' ? opts.style.replace(/^style_/, '') : 'line',
      pane: pineOverlay ? 'price' : 'separate',
    });
  }
  // A fill follows the plots it joins; one whose plots are missing or in different panes is dropped.
  const drop = new Set<number>();
  out.forEach((plot, i) => {
    const join = joins[i];
    if (!join) return;
    const a = keys.indexOf(join[0]);
    const b = keys.indexOf(join[1]);
    if (a < 0 || b < 0 || joins[a] || joins[b] || out[a].pane !== out[b].pane) {
      drop.add(i);
      return;
    }
    plot.plot1 = a;
    plot.plot2 = b;
    plot.pane = out[a].pane;
  });
  if (drop.size === 0) return out;
  const remap = new Map<number, number>();
  const kept = out.filter((_, i) => !drop.has(i));
  out.forEach((_, i) => { if (!drop.has(i)) remap.set(i, remap.size); });
  for (const plot of kept) {
    if (plot.kind === 'fill') {
      plot.plot1 = remap.get(plot.plot1!);
      plot.plot2 = remap.get(plot.plot2!);
    }
  }
  return kept;
}

function mapTrade(t: any, candles: Candle[], closed: boolean): PineTrade {
  const size = Number(t.size);
  const last = candles.length - 1;
  const at = (i: unknown) => candles[Math.min(Math.max(Number(i), 0), last)].time;
  return {
    id: String(t.entry_id ?? t.id),
    direction: size < 0 ? 'short' : 'long',
    size: Math.abs(size),
    entryIndex: Number(t.entry_bar_index),
    exitIndex: closed ? Number(t.exit_bar_index) : null,
    entryTime: at(t.entry_bar_index),
    exitTime: closed ? at(t.exit_bar_index) : null,
    entryPrice: Number(t.entry_price),
    exitPrice: closed ? toNum(t.exit_price) : null,
    profit: closed ? toNum(t.profit) : null,
    exitId: closed && t.exit_id != null ? String(t.exit_id) : null,
  };
}

function positionSeries(trades: PineTrade[], n: number): number[] {
  const pos = new Array<number>(n).fill(0);
  for (const t of trades) {
    const signed = t.direction === 'short' ? -t.size : t.size;
    const end = t.exitIndex ?? n;
    for (let i = Math.max(t.entryIndex, 0); i < Math.min(end, n); i++) pos[i] += signed;
  }
  return pos;
}

function mapStrategyConfig(decl: any, strategy: any): PineStrategyConfig {
  return {
    initialCapital: toNum(decl.initial_capital) ?? toNum(strategy?.initial_capital) ?? 0,
    commissionType: String(decl.commission_type ?? 'percent'),
    commissionValue: toNum(decl.commission_value) ?? 0,
    defaultQtyType: String(decl.default_qty_type ?? 'fixed'),
    defaultQtyValue: toNum(decl.default_qty_value) ?? 1,
  };
}

/** Callers (the optimizer, the panel) store bool inputs as 0/1; hand the script real booleans. */
async function coerceInputs(
  source: string,
  inputs: Record<string, PineInputValue>,
): Promise<Record<string, PineInputValue>> {
  const keys = Object.keys(inputs);
  if (keys.length === 0) return inputs;
  const metas = new Indicator(source, {}).getInputsMeta();
  const out = { ...inputs };
  for (const m of metas) {
    const name = m.title ?? m.name;
    if (m.type === 'bool' && typeof out[name] === 'number') out[name] = out[name] !== 0;
  }
  return out;
}

/** Page-by-page run for progress reporting. Each yielded page holds only its own slice, so the result is read from `fullContext`. */
async function runPaged(pine: RoutedPineTS, indicator: Indicator, n: number, onProgress: (pct: number) => void): Promise<any> {
  const pageSize = Math.max(1, Math.floor(n / 100));
  let last: any = null;
  let done = 0;
  for await (const page of pine.run(indicator, undefined, pageSize)) {
    last = page;
    done = Math.min(n, done + pageSize);
    if (done < n) onProgress(done / n);
  }
  if (!last) throw new Error('Pine run produced no result');
  onProgress(1);
  return last.fullContext ?? last;
}

export interface PineRunOptions {
  /** Finds the source of an imported library. The default asks the Vost server (`/api/pine/libraries`). */
  resolver?: ImportResolverFn | IImportResolver;
  /**
   * Called with the fraction of bars processed (0..1, never decreasing, last call 1). When given, the script runs
   * page by page (about 100 pages) and the outcome is read from the full context; without it the single unpaged
   * `run` is used, exactly as before.
   */
  onProgress?: (pct: number) => void;
  /**
   * The chart's symbol, timeframe and market details, which the script sees in `syminfo` and `timeframe`. Without it
   * the ticker is `VOST` and the timeframe is derived from the candle spacing. A request for other data fails the run.
   */
  market?: PineMarket;
  /** Where the chart's symbol at another timeframe comes from. The default is the realm's shared feed (provider registry plus cache). */
  feed?: MarketFeed;
}

const drawingsField = (drawings: PineDrawings | undefined) => (drawings ? { drawings } : {});

/** Run a Pine script over candles (time in seconds). `inputs` override defaults by input title. */
export async function runPine(
  source: string,
  candles: Candle[],
  inputs: Record<string, PineInputValue> = {},
  opts: PineRunOptions = {},
): Promise<PineRunOutcome> {
  // Fresh per run, so a library pasted after a miss is found on the next run.
  const server = opts.resolver ? null : createServerResolver();
  try {
    // PineTS reads a script with no //@version line as raw JavaScript and fails with a parser error.
    const { version, legacy } = detectPineVersion(source);
    if (legacy) return { ok: false, error: { message: legacyMessage(version) } };
    if (candles.length === 0) return { ok: false, error: { message: 'No candles to run the script on' } };
    const indicator = new Indicator(source, await coerceInputs(source, inputs));
    const metas = indicator.getInputsMeta();
    const { provider, ticker, timeframe, endTime } = createMarketProvider(candles, opts.market, opts.feed);
    const rates = new CurrencyRates(candles, opts.market, opts.feed ?? defaultMarketFeed());
    const ctx: any = await runWithRates(rates, async () => {
      // An end date marks the data as fixed: without it a paged run waits for live updates from the provider.
      const pine = new RoutedPineTS(provider, ticker, timeframe, undefined, undefined, endTime);
      pine.routing = { market: opts.market, rates };
      // By default PineTS records alerts only on the last bar; the pane lists every bar's.
      pine.setAlertMode('all');
      pine.setImportResolver(opts.resolver ?? ((libPath) => server!.resolve(libPath)));
      const out = opts.onProgress ? await runPaged(pine, indicator, candles.length, opts.onProgress) : await pine.run(indicator);
      assertHooked(pine);
      return out;
    });

    const isStrategy = indicator.getDeclarationType() === 'strategy';
    const decl = (isStrategy ? ctx.strategy?.config : ctx.indicator) ?? {};
    const overlay = Boolean(decl.overlay);

    const declaredInputs: PineInput[] = metas.map((m) => ({
      name: m.title ?? m.name,
      type: m.type,
      defval: (m.defval ?? null) as PineInputValue | null,
      ...(m.minval !== undefined && { minval: m.minval }),
      ...(m.maxval !== undefined && { maxval: m.maxval }),
      ...(m.step !== undefined && { step: m.step }),
      ...(m.options !== undefined && { options: m.options as PineInputValue[] }),
      ...(m.group && { group: String(m.group) }),
      ...(m.tooltip && { tooltip: String(m.tooltip) }),
      ...(m.inline && { inline: String(m.inline) }),
    }));

    let trades: PineTrade[] = [];
    if (isStrategy) {
      trades = [
        ...(ctx.strategy.closedtrades ?? []).map((t: any) => mapTrade(t, candles, true)),
        ...(ctx.strategy.opentrades ?? []).map((t: any) => mapTrade(t, candles, false)),
      ];
    }

    return {
      ok: true,
      kind: isStrategy ? 'strategy' : 'indicator',
      declaration: { title: String(decl.title ?? ''), overlay },
      inputs: declaredInputs,
      plots: mapPlots(ctx.plots ?? {}, candles, overlay),
      trades,
      position: isStrategy ? positionSeries(trades, candles.length) : [],
      ...(isStrategy && { strategyConfig: mapStrategyConfig(decl, ctx.strategy) }),
      messages: mapMessages(ctx, takeLogs(ctx)),
      ...drawingsField(mapDrawings(ctx.plots ?? {}, candles.map((c) => c.time), candles, overlay)),
    };
  } catch (err) {
    const error = parseError(err);
    const library = missingLibraryPath(error.message);
    if (library) return { ok: false, error: { message: libraryMessage(library, server?.misses.get(library)), library } };
    return { ok: false, error };
  }
}
