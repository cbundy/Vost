/**
 * Pine Script runtime. Feeds Vost candles to PineTS (AGPL-3.0-only, see
 * docs/PINE.md) and maps its context into plain typed data. Never throws:
 * compile and runtime failures resolve to `{ ok: false, error }`.
 */
import { Indicator, PineTS } from 'pinets';
import type { Candle } from '../../types';
import type {
  PineInput,
  PineInputValue,
  PinePlot,
  PineRunOutcome,
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

function toPineData(candles: Candle[]) {
  const n = candles.length;
  const step = n > 1 ? Math.max(1, candles[n - 1].time - candles[n - 2].time) : 86400;
  return candles.map((c, i) => {
    const next = i + 1 < n ? candles[i + 1].time : c.time + step;
    return {
      openTime: c.time * 1000,
      closeTime: next * 1000 - 1,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    };
  });
}

function mapPlots(plots: Record<string, any>, candles: Candle[], overlay: boolean): PinePlot[] {
  const out: PinePlot[] = [];
  for (const [key, plot] of Object.entries(plots)) {
    if (key.startsWith('__') || !plot || !Array.isArray(plot.data)) continue;
    const byTime = new Map<number, number | null>();
    for (const p of plot.data) byTime.set(p.time, toNum(p.value));
    const opts = plot.options ?? {};
    const pineOverlay = typeof opts.overlay === 'boolean' ? opts.overlay : overlay;
    out.push({
      name: plot.title ?? key,
      values: candles.map((c) => byTime.get(c.time * 1000) ?? null),
      color: typeof opts.color === 'string' ? opts.color : COLOR_NA,
      style: typeof opts.style === 'string' ? opts.style.replace(/^style_/, '') : 'line',
      pane: pineOverlay ? 'price' : 'separate',
    });
  }
  return out;
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

/** Run a Pine script over candles (time in seconds). `inputs` override defaults by input title. */
export async function runPine(
  source: string,
  candles: Candle[],
  inputs: Record<string, PineInputValue> = {},
): Promise<PineRunOutcome> {
  try {
    if (candles.length === 0) return { ok: false, error: { message: 'No candles to run the script on' } };
    const indicator = new Indicator(source, inputs);
    const metas = indicator.getInputsMeta();
    const ctx: any = await new PineTS(toPineData(candles), 'VOST', 'D').run(indicator);

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
    };
  } catch (err) {
    return { ok: false, error: parseError(err) };
  }
}
