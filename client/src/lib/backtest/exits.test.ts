import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types';
import { generateDemoCandles } from '../providers/demo';
import { runBacktest } from './engine';
import { activeStop, activeTarget, exitContext, exitModeLabels, hasAnyStop, hitTest, levelsAtEntry, rTargetNeedsStop, readExitSettings, updateTrail } from './exits';
import { buildSignals } from './strategies';
import { defaultBacktestConfig, type BacktestConfig, type Signal } from './types';

type Bar = [open: number, high: number, low: number, close: number];
function bars(rows: Bar[]): Candle[] {
  return rows.map(([open, high, low, close], i) => ({ time: 1700000000 + i * 86400, open, high, low, close, volume: 1000 }));
}
function cfg(over: Partial<BacktestConfig> = {}): BacktestConfig {
  return { ...defaultBacktestConfig(), feeBps: 0, slippageBps: 0, strategyId: 'buy_hold', params: {}, ...over };
}
const flat: Bar = [100, 105, 95, 100]; // true range 10, so ATR is 10
const long = (n: number): Signal[] => new Array(n).fill(1);
const short = (n: number): Signal[] => new Array(n).fill(-1);

describe('readExitSettings', () => {
  it('reads no new fields as the percent behaviour', () => {
    const s = readExitSettings(cfg({ stopLossPct: 2, takeProfitPct: 4 }));
    expect(s.stop).toEqual({ kind: 'pct', pct: 2 });
    expect(s.target).toEqual({ kind: 'pct', pct: 4 });
    expect(s.trail).toBeNull();
    expect(s.needsAtr).toBe(false);
    expect(s.atrLength).toBe(14);
  });
  it('reads bad saved values as off or percent', () => {
    const bad = readExitSettings(
      cfg({
        stopLossPct: 2,
        stopMode: 'atr',
        stopAtrMult: Number.NaN,
        takeProfitMode: 'r',
        takeProfitR: -1,
        takeProfitPct: null,
        trailMode: 'atr',
        trailAtrMult: 0,
        atrLength: 1000,
      }),
    );
    expect(bad.stop).toEqual({ kind: 'pct', pct: 2 });
    expect(bad.target).toBeNull();
    expect(bad.trail).toBeNull();
    expect(bad.atrLength).toBe(14);
    const unknown = readExitSettings(cfg({ stopMode: 'x' as never, trailMode: 'zig' as never, takeProfitMode: 'q' as never, atrLength: 2.5 }));
    expect(unknown.stop).toBeNull();
    expect(unknown.trail).toBeNull();
    expect(unknown.atrLength).toBe(14);
  });
  it('reads valid ATR settings', () => {
    const s = readExitSettings(cfg({ stopMode: 'atr', stopAtrMult: 2, takeProfitMode: 'r', takeProfitR: 3, trailMode: 'atr', trailAtrMult: 1.5, atrLength: 5 }));
    expect(s).toMatchObject({ stop: { kind: 'atr', mult: 2 }, target: { kind: 'r', r: 3 }, trail: { kind: 'atr', mult: 1.5 }, atrLength: 5, needsAtr: true });
  });
});

describe('levelsAtEntry', () => {
  it('sets ATR stop and target from the entry', () => {
    const s = readExitSettings(cfg({ stopMode: 'atr', stopAtrMult: 2, takeProfitMode: 'atr', takeProfitAtrMult: 3 }));
    expect(levelsAtEntry(s, 1, 100, 10)).toMatchObject({ stop: 80, target: 130, stopFrac: 0.2 });
    expect(levelsAtEntry(s, -1, 100, 10)).toMatchObject({ stop: 120, target: 70 });
  });
  it('returns null while a needed ATR is unknown', () => {
    const s = readExitSettings(cfg({ stopMode: 'atr', stopAtrMult: 2 }));
    expect(levelsAtEntry(s, 1, 100, null)).toBeNull();
  });
  it('sets the R target from the stop distance, and none without a stop', () => {
    const s = readExitSettings(cfg({ stopLossPct: 5, takeProfitMode: 'r', takeProfitR: 2 }));
    expect(levelsAtEntry(s, 1, 100, null)?.target).toBeCloseTo(110, 9);
    expect(levelsAtEntry(s, -1, 100, null)?.target).toBeCloseTo(90, 9);
    const none = readExitSettings(cfg({ stopLossPct: null, takeProfitMode: 'r', takeProfitR: 2 }));
    expect(levelsAtEntry(none, 1, 100, null)?.target).toBeNull();
  });
  it('starts the trail at the distance and uses the tighter distance for sizing', () => {
    const s = readExitSettings(cfg({ stopLossPct: 10, trailMode: 'pct', trailPct: 4 }));
    const lv = levelsAtEntry(s, 1, 100, null)!;
    expect(lv.trail).toBeCloseTo(96, 9);
    expect(lv.stopFrac).toBeCloseTo(0.04, 9);
    expect(activeStop(1, lv)).toEqual({ price: lv.trail, reason: 'trailing_stop' });
  });
});

describe('updateTrail and hitTest', () => {
  const s = readExitSettings(cfg({ trailMode: 'pct', trailPct: 10 }));
  it('ratchets up for a long and never loosens', () => {
    const lv = levelsAtEntry(s, 1, 100, null)!;
    expect(lv.trail).toBeCloseTo(90, 9);
    updateTrail(1, lv, { high: 120, low: 100 });
    expect(lv.trail).toBeCloseTo(110, 9); // distance 10 (10% of entry) behind the best high 120
    updateTrail(1, lv, { high: 110, low: 90 });
    expect(lv.trail).toBeCloseTo(110, 9);
  });
  it('ratchets down for a short', () => {
    const lv = levelsAtEntry(s, -1, 100, null)!;
    updateTrail(-1, lv, { high: 100, low: 80 });
    expect(lv.trail).toBeCloseTo(90, 9);
    updateTrail(-1, lv, { high: 99, low: 95 });
    expect(lv.trail).toBeCloseTo(90, 9);
  });
  it('gaps through at the open and checks the stop before the target', () => {
    const t = readExitSettings(cfg({ stopLossPct: 5, takeProfitPct: 5 }));
    const lv = levelsAtEntry(t, 1, 100, null)!;
    expect(hitTest(1, lv, { open: 90, high: 92, low: 88 })).toEqual({ price: 90, reason: 'stop_loss' });
    expect(hitTest(1, lv, { open: 100, high: 110, low: 90 })).toEqual({ price: lv.stop, reason: 'stop_loss' });
    expect(hitTest(1, lv, { open: 110, high: 112, low: 108 })).toEqual({ price: 110, reason: 'take_profit' });
  });
});

describe('engine with the new exits', () => {
  it('stops at an ATR multiple of the signal-bar ATR, and a bigger entry bar does not move it', () => {
    const rows: Bar[] = [flat, flat, flat, flat, [100, 101, 79, 90], flat];
    const base = runBacktest(bars(rows), long(rows.length), cfg({ stopMode: 'atr', stopAtrMult: 2, atrLength: 2 })).trades[0];
    expect(base).toMatchObject({ entryBar: 3, entryPrice: 100, exitBar: 4, exitPrice: 80, exitReason: 'stop_loss' });
    const wide = rows.slice();
    wide[3] = [100, 160, 40, 100]; // entry bar with a huge range: the level still comes from bar 2's ATR
    const t = runBacktest(bars(wide), long(wide.length), cfg({ stopMode: 'atr', stopAtrMult: 2, atrLength: 2 })).trades[0];
    expect(t.entryBar).toBe(3);
    expect(t.exitPrice).toBe(80);
    expect(t.exitBar).toBe(3); // the wide bar itself touches 80, proving the level was 80
  });
  it('opens no position during ATR warm-up and enters on the first later bar', () => {
    const rows: Bar[] = [flat, flat, flat, flat, flat, flat];
    const { trades } = runBacktest(bars(rows), long(rows.length), cfg({ stopMode: 'atr', stopAtrMult: 2, atrLength: 3 }));
    expect(trades).toHaveLength(1);
    expect(trades[0].entryBar).toBe(4); // first ATR at index 3, read on signal bar 3, entry on bar 4
  });
  it('does not enter on a later bar whose signal no longer asks for the side', () => {
    const rows: Bar[] = [flat, flat, flat, flat, flat, flat];
    const sig: Signal[] = [1, 1, 0, 0, 0, 0];
    expect(runBacktest(bars(rows), sig, cfg({ stopMode: 'atr', stopAtrMult: 2, atrLength: 3 })).trades).toHaveLength(0);
  });
  it('sets an ATR target, and an R target equal to R times the stop distance', () => {
    const rows: Bar[] = [flat, flat, flat, flat, [100, 131, 99, 125], flat];
    const atrTp = runBacktest(bars(rows), long(6), cfg({ takeProfitMode: 'atr', takeProfitAtrMult: 3, atrLength: 2 })).trades[0];
    expect(atrTp).toMatchObject({ exitPrice: 130, exitReason: 'take_profit' });
    const rTp = runBacktest(bars(rows), long(6), cfg({ stopMode: 'atr', stopAtrMult: 1, takeProfitMode: 'r', takeProfitR: 3, atrLength: 2 })).trades[0];
    expect(rTp).toMatchObject({ exitPrice: 130, exitReason: 'take_profit' });
  });
  it('takes the stop first when one bar touches stop and target', () => {
    const rows: Bar[] = [flat, flat, flat, flat, [100, 140, 70, 100], flat];
    const t = runBacktest(bars(rows), long(6), cfg({ stopMode: 'atr', stopAtrMult: 2, takeProfitMode: 'atr', takeProfitAtrMult: 3, atrLength: 2 })).trades[0];
    expect(t).toMatchObject({ exitPrice: 80, exitReason: 'stop_loss' });
  });
  it('trails: a bar own high does not tighten a stop that bar hits, then the trail exits with trailing_stop', () => {
    // Entry bar 1 at 100, trail 10%. Bar 1 rises to 130 and falls to 95: trail from earlier bars is 90, not hit.
    const rows: Bar[] = [flat, [100, 130, 95, 120], [125, 125, 110, 120], [120, 121, 100, 105], flat];
    const { trades } = runBacktest(bars(rows), long(5), cfg({ trailMode: 'pct', trailPct: 10 }));
    // after bar 1 the trail is 130 - 10 = 120; bar 2 opens at 125 and trades down to 110: exit at 120
    expect(trades[0]).toMatchObject({ entryBar: 1, exitBar: 2, exitPrice: 120, exitReason: 'trailing_stop' });
  });
  it('a bar high that would tighten the stop does not exit the same bar', () => {
    const rows: Bar[] = [flat, [100, 150, 100, 140], [145, 146, 141, 145]];
    const { trades } = runBacktest(bars(rows), long(3), cfg({ trailMode: 'pct', trailPct: 10 }));
    expect(trades[0].exitReason).toBe('end_of_data'); // bar 1 low 100 is above the trail of 90 even though its high moves the trail to 140 afterwards; bar 2 stays above 140
  });
  it('gaps through the trail at the open', () => {
    const rows: Bar[] = [flat, [100, 130, 100, 130], [100, 105, 98, 100]];
    const t = runBacktest(bars(rows), long(3), cfg({ trailMode: 'pct', trailPct: 10 })).trades[0];
    expect(t).toMatchObject({ exitBar: 2, exitPrice: 100, exitReason: 'trailing_stop' });
  });
  it('mirrors for shorts', () => {
    const rows: Bar[] = [flat, [100, 105, 70, 80], [80, 95, 79, 90], flat];
    const t = runBacktest(bars(rows), short(4), cfg({ allowShort: true, trailMode: 'pct', trailPct: 10 })).trades[0];
    expect(t.side).toBe('short');
    expect(t).toMatchObject({ exitBar: 2, exitPrice: 80, exitReason: 'trailing_stop' }); // best 70 + 10 (10% of entry)
  });
  it('reports stop_loss when the fixed stop is tighter than the trail', () => {
    const rows: Bar[] = [flat, [100, 101, 90, 95], flat];
    const t = runBacktest(bars(rows), long(3), cfg({ stopLossPct: 5, trailMode: 'pct', trailPct: 20 })).trades[0];
    expect(t).toMatchObject({ exitPrice: 95, exitReason: 'stop_loss' });
  });
  it('requires a signal reset after a trailing exit', () => {
    const rows: Bar[] = [flat, flat, [100, 101, 80, 85], flat, flat, flat];
    const { trades } = runBacktest(bars(rows), long(6), cfg({ trailMode: 'pct', trailPct: 10 }));
    expect(trades).toHaveLength(1);
  });
  it('sizes risk from the ATR stop and from the trail start', () => {
    const rows: Bar[] = [flat, flat, flat, flat, flat, flat];
    const a = runBacktest(bars(rows), long(6), cfg({ riskPct: 1, stopMode: 'atr', stopAtrMult: 2, atrLength: 2 })).trades[0];
    expect(a.entryPrice * a.qty).toBeCloseTo((10000 * 0.01) / 0.2, 6);
    expect(a.leverage).toBeCloseTo(0.05, 9);
    const b = runBacktest(bars(rows), long(6), cfg({ riskPct: 1, stopLossPct: 10, trailMode: 'pct', trailPct: 4 })).trades[0];
    expect(b.entryPrice * b.qty).toBeCloseTo((10000 * 0.01) / 0.04, 6);
  });
  it('keeps the percent sizing as before', () => {
    const rows: Bar[] = [flat, flat, flat];
    const t = runBacktest(bars(rows), long(3), cfg({ riskPct: 1, stopLossPct: 5 })).trades[0];
    expect(t.entryPrice * t.qty).toBeCloseTo(2000, 6);
    expect(t.leverage).toBeCloseTo(0.2, 9);
  });
});

describe('unchanged defaults', () => {
  const candles = generateDemoCandles({ bars: 1500, timeframe: '1h', seed: 7 });
  const off: Partial<BacktestConfig> = {
    stopMode: 'pct',
    stopAtrMult: null,
    takeProfitMode: 'pct',
    takeProfitAtrMult: null,
    takeProfitR: null,
    trailMode: 'off',
    trailPct: null,
    trailAtrMult: null,
  };
  const cases: Partial<BacktestConfig>[] = [
    {},
    { stopLossPct: 2 },
    { takeProfitPct: 3 },
    { stopLossPct: 1.5, takeProfitPct: 3 },
    { stopLossPct: 1.5, riskPct: 1 },
    { stopLossPct: 2, takeProfitPct: 4, riskPct: 2, allowShort: true },
    { stopLossPct: 2, takeProfitPct: 4, allowShort: true, feeBps: 10, slippageBps: 5 },
  ];
  for (const [k, c] of cases.entries()) {
    it(`case ${k} gives identical trades and equity with every new field off`, () => {
      const base = cfg({ strategyId: 'rsi_reversion', params: {}, allowShort: true, ...c });
      const signals = buildSignals(candles, base.strategyId, base.params);
      const a = runBacktest(candles, signals, base);
      const b = runBacktest(candles, signals, { ...base, ...off });
      expect(a.trades.length).toBeGreaterThan(0);
      expect(b).toEqual(a);
    });
  }
});

describe('settings helpers', () => {
  it('any stop counts a percent, ATR or trailing stop', () => {
    expect(hasAnyStop(cfg({ stopLossPct: null }))).toBe(false);
    expect(hasAnyStop(cfg({ stopLossPct: 2 }))).toBe(true);
    expect(hasAnyStop(cfg({ stopMode: 'atr', stopAtrMult: 2 }))).toBe(true);
    expect(hasAnyStop(cfg({ trailMode: 'pct', trailPct: 3 }))).toBe(true);
    expect(hasAnyStop(cfg({ stopMode: 'atr', stopAtrMult: 0, trailMode: 'atr', trailAtrMult: Number.NaN }))).toBe(false);
  });
  it('an R target needs a stop', () => {
    expect(rTargetNeedsStop(cfg({ takeProfitMode: 'r', takeProfitR: 2 }))).toBe(true);
    expect(rTargetNeedsStop(cfg({ takeProfitMode: 'r', takeProfitR: 2, trailMode: 'pct', trailPct: 2 }))).toBe(false);
    expect(rTargetNeedsStop(cfg({ takeProfitMode: 'r', takeProfitR: 0 }))).toBe(false);
  });
  it('names the modes and the optimizer context', () => {
    const c = cfg({ stopMode: 'atr', stopAtrMult: 2, takeProfitMode: 'r', takeProfitR: 3, trailMode: 'atr', trailAtrMult: 1.5, atrLength: 20 });
    expect(exitModeLabels(c)).toEqual({ stop: 'SL 2 ATR', target: 'TP 3R', trail: 'Trail 1.5 ATR', atrLength: 20, atrTimeframe: null });
    expect(exitModeLabels(cfg({ stopLossPct: 2, takeProfitPct: 4 }))).toEqual({ stop: 'SL 2%', target: 'TP 4%', trail: null, atrLength: null, atrTimeframe: null });
    expect(exitContext(c)).toEqual({ exits: { stopLoss: '2 x ATR', takeProfit: '3 x stop', trailingStop: '1.5 x ATR', atrLength: 20 } });
    expect(exitContext(cfg({ stopLossPct: 2 }))).toEqual({});
  });
});

describe('ATR timeframe', () => {
  const invalid: unknown[] = [undefined, 1, 5, 0, -4, 2.5, '4', Number.NaN, null, 48];
  const atrExits: Partial<BacktestConfig> = { stopMode: 'atr', stopAtrMult: 2, takeProfitMode: 'atr', takeProfitAtrMult: 3, trailMode: 'atr', trailAtrMult: 1.5, atrLength: 10 };

  it('reads 1 for every invalid value and the value for each listed multiple', () => {
    for (const v of invalid) expect(readExitSettings(cfg({ atrTimeframe: v as number })).atrTimeframe).toBe(1);
    for (const k of [1, 2, 3, 4, 6, 8, 12, 24]) expect(readExitSettings(cfg({ atrTimeframe: k })).atrTimeframe).toBe(k);
  });

  it('leaves every trade as it is with the field absent, 1 or invalid', () => {
    const candles = generateDemoCandles({ bars: 1500, timeframe: '1h', seed: 7 });
    const base = cfg({ strategyId: 'rsi_reversion', params: {}, allowShort: true, ...atrExits });
    const signals = buildSignals(candles, base.strategyId, base.params);
    const ref = runBacktest(candles, signals, base);
    expect(ref.trades.length).toBeGreaterThan(0);
    for (const v of invalid) expect(runBacktest(candles, signals, { ...base, atrTimeframe: v as number }).trades).toEqual(ref.trades);
    // a real multiple does change the trades, so the equality above is not vacuous
    expect(runBacktest(candles, signals, { ...base, atrTimeframe: 4 }).trades).not.toEqual(ref.trades);
  });

  // 1h bars from a 4h UTC boundary; 4h bucket b has bars [100, 100 + a, 100 - a, 100] with a = 5, 10, 15, 20 ...
  // so the 4h true range is 2a (10, 20, 30, 40) and the Wilder ATR(2) of the 4h bars is 25 at bucket 2 and 32.5 at bucket 3.
  const H = 3600;
  const T0 = 1_600_041_600;
  function hourly(n: number, over: Record<number, Bar> = {}): Candle[] {
    return Array.from({ length: n }, (_, h) => {
      const a = 5 * (Math.floor(h / 4) + 1);
      const [open, high, low, close] = over[h] ?? [100, 100 + a, 100 - a, 100];
      return { time: T0 + h * H, open, high, low, close, volume: 1000 };
    });
  }
  const from = (n: number, start: number): Signal[] => Array.from({ length: n }, (_, i) => (i >= start ? 1 : 0)) as Signal[];
  const c4 = (over: Partial<BacktestConfig>): BacktestConfig => cfg({ atrLength: 2, atrTimeframe: 4, ...over });

  it('trails by the closed 4h ATR of the signal bar', () => {
    const candles = hourly(20, { 12: [100, 100, 100, 100], 13: [100, 100, 40, 100] });
    const { trades } = runBacktest(candles, from(20, 0), c4({ trailMode: 'atr', trailAtrMult: 2 }));
    // third 4h bar closes at bar 11, so the first signal with an ATR is bar 11 and the trade opens on bar 12
    expect(trades[0]).toMatchObject({ entryBar: 12, entryPrice: 100, exitBar: 13, exitPrice: 50, exitReason: 'trailing_stop' });
    // on the loaded bars the ATR is known from bar 2, so the trade would open on bar 3
    const one = runBacktest(candles, from(20, 0), cfg({ atrLength: 2, trailMode: 'atr', trailAtrMult: 2 })).trades[0];
    expect(one.entryBar).toBe(3);
  });

  it('uses the 4h ATR for an ATR stop and an ATR take profit', () => {
    const stop = runBacktest(hourly(20, { 12: [100, 100, 100, 100], 13: [100, 100, 40, 100] }), from(20, 0), c4({ stopMode: 'atr', stopAtrMult: 2 }));
    expect(stop.trades[0]).toMatchObject({ entryBar: 12, exitPrice: 50, exitReason: 'stop_loss' });
    const tp = runBacktest(hourly(20, { 12: [100, 100, 100, 100], 13: [100, 170, 100, 100] }), from(20, 0), c4({ takeProfitMode: 'atr', takeProfitAtrMult: 2 }));
    expect(tp.trades[0]).toMatchObject({ entryBar: 12, exitPrice: 150, exitReason: 'take_profit' });
  });

  it('waits while no 4h bar has closed enough, then opens on the first later bar that still asks for long', () => {
    const candles = hourly(20, { 12: [100, 100, 100, 100], 13: [100, 100, 40, 100] });
    const early = Array.from({ length: 20 }, (_, i) => (i <= 10 ? 1 : 0)) as Signal[];
    expect(runBacktest(candles, early, c4({ stopMode: 'atr', stopAtrMult: 2 })).trades).toHaveLength(0);
    const late = runBacktest(candles, from(20, 5), c4({ stopMode: 'atr', stopAtrMult: 2 }));
    expect(late.trades[0].entryBar).toBe(12);
  });

  it('never lets bars after the signal bar move the levels, including the rest of its 4h bucket', () => {
    // signal bar 13 sits inside bucket 3, which is not closed; the ATR comes from buckets 0..2 only
    const calm = hourly(24, { 14: [100, 100, 100, 100], 15: [100, 100, 40, 100] });
    const wild = hourly(24, { 14: [100, 100, 100, 100], 15: [100, 900, 0, 100], 16: [100, 900, 0, 100], 17: [900, 900, 900, 900] });
    const pick = (cs: Candle[]) => runBacktest(cs, from(24, 13), c4({ stopMode: 'atr', stopAtrMult: 2 })).trades[0];
    const a = pick(calm);
    const b = pick(wild);
    expect(a).toMatchObject({ entryBar: 14, entryPrice: 100, exitPrice: 50 });
    expect({ entryBar: b.entryBar, entryPrice: b.entryPrice, exitPrice: b.exitPrice, exitReason: b.exitReason }).toEqual({
      entryBar: a.entryBar,
      entryPrice: a.entryPrice,
      exitPrice: a.exitPrice,
      exitReason: a.exitReason,
    });
  });

  it('uses the loaded bars when they are a week or longer', () => {
    const weekly: Candle[] = Array.from({ length: 12 }, (_, i) => ({ time: T0 + i * 604800, open: 100, high: 105, low: 95, close: 100, volume: 1 }));
    const run = (k?: number) => runBacktest(weekly, long(12), cfg({ stopMode: 'atr', stopAtrMult: 2, atrLength: 2, atrTimeframe: k })).trades;
    expect(run(4).length).toBeGreaterThan(0);
    expect(run(4)).toEqual(run(1));
  });

  it('names the multiple in the labels and the optimizer context only above 1', () => {
    expect(exitModeLabels(cfg({ ...atrExits })).atrTimeframe).toBeNull();
    expect(exitModeLabels(cfg({ ...atrExits, atrTimeframe: 4 })).atrTimeframe).toBe(4);
    expect(exitContext(cfg({ ...atrExits, atrTimeframe: 4 })).exits?.atrTimeframe).toBe(4);
    expect(exitContext(cfg({ ...atrExits, atrTimeframe: 1 })).exits).not.toHaveProperty('atrTimeframe');
    expect(exitContext(cfg({ stopLossPct: 2, atrTimeframe: 4 }))).toEqual({});
  });
});

describe('TradingView indicator stop and target in the exit helpers', () => {
  const settings = readExitSettings(cfg({ stopLossPct: 5, takeProfitPct: 10 }));
  const withPlot = (stop: number | null, target: number | null, s = settings) => levelsAtEntry(s, 1, 100, null, { hasStop: true, stop, target })!;

  it('the plot stop competes with the fixed stop and the trail: the tightest wins, reason stop_loss', () => {
    expect(activeStop(1, withPlot(97, null))).toEqual({ price: 97, reason: 'stop_loss' });
    expect(activeStop(1, withPlot(90, null))).toEqual({ price: 95, reason: 'stop_loss' });
    const trailing = readExitSettings(cfg({ trailMode: 'pct', trailPct: 2 }));
    expect(activeStop(1, withPlot(99, null, trailing))).toEqual({ price: 99, reason: 'stop_loss' });
    expect(activeStop(1, withPlot(97, null, trailing))).toEqual({ price: 98, reason: 'trailing_stop' });
    const short = levelsAtEntry(settings, -1, 100, null, { hasStop: true, stop: 103, target: null })!;
    expect(activeStop(-1, short)).toEqual({ price: 103, reason: 'stop_loss' });
  });

  it('the plot target wins when nearer than the fixed target', () => {
    expect(activeTarget(1, withPlot(97, 104))).toBe(104);
    expect(activeTarget(1, withPlot(97, 120))).toBeCloseTo(110, 9);
    expect(hitTest(1, withPlot(97, 104), { open: 100, high: 105, low: 99 })).toEqual({ price: 104, reason: 'take_profit' });
  });

  it('stop before target on one bar; a gap through fills at the open', () => {
    expect(hitTest(1, withPlot(97, 104), { open: 100, high: 105, low: 96 })).toEqual({ price: 97, reason: 'stop_loss' });
    expect(hitTest(1, withPlot(97, 104), { open: 95, high: 96, low: 94 })).toEqual({ price: 95, reason: 'stop_loss' });
    expect(hitTest(1, withPlot(97, 104), { open: 106, high: 107, low: 105 })).toEqual({ price: 106, reason: 'take_profit' });
  });

  it('an indicator stop with no usable level opens no trade; a target without one does not matter', () => {
    expect(levelsAtEntry(settings, 1, 100, null, { hasStop: true, stop: null, target: null })).toBeNull();
    expect(levelsAtEntry(settings, 1, 100, null, { hasStop: false, stop: null, target: null })).not.toBeNull();
  });

  it('the plot stop distance sizes the risk and the R target', () => {
    const r = readExitSettings(cfg({ takeProfitMode: 'r', takeProfitR: 2, takeProfitPct: null }));
    const lv = levelsAtEntry(r, 1, 100, null, { hasStop: true, stop: 96, target: null })!;
    expect(lv.stopFrac).toBeCloseTo(0.04, 12);
    expect(lv.target).toBe(108);
  });

  it('hasAnyStop and rTargetNeedsStop count a stop role in use', () => {
    const role = { indicatorId: 'x', name: 'Supertrend', inputs: {}, role: 'stop', mode: 'trailing', rule: { type: 'level', plot: 'Line' } } as const;
    const c = cfg({ strategyId: 'composed', takeProfitMode: 'r', takeProfitR: 2, takeProfitPct: null });
    expect(hasAnyStop(c)).toBe(false);
    expect(rTargetNeedsStop(c)).toBe(true);
    expect(hasAnyStop({ ...c, pineRoles: [role] })).toBe(true);
    expect(rTargetNeedsStop({ ...c, pineRoles: [role] })).toBe(false);
    expect(hasAnyStop({ ...c, strategyId: 'sma_cross', pineRoles: [role] })).toBe(false);
  });

  it('labels and the optimizer context name the indicator stop and target', () => {
    const c = cfg({
      strategyId: 'composed',
      pineRoles: [
        { indicatorId: 'x', name: 'Supertrend', inputs: {}, role: 'stop', mode: 'trailing', rule: { type: 'level', plot: 'Line' } },
        { indicatorId: 'y', name: 'Pivots', inputs: {}, role: 'target', rule: { type: 'level', plot: 'R1' } },
      ],
    });
    expect(exitModeLabels(c)).toMatchObject({ indicatorStop: 'Trail Supertrend Line', indicatorTarget: 'TP Pivots R1' });
    const fixed = { ...c, pineRoles: [{ ...c.pineRoles![0], mode: 'at-entry' as const }] };
    expect(exitModeLabels(fixed).indicatorStop).toBe('SL Supertrend Line');
    expect(exitContext(c)).toEqual({ exits: { indicatorStop: 'Supertrend Line, trailing', indicatorTarget: 'Pivots R1' } });
    expect(exitContext(fixed)).toEqual({ exits: { indicatorStop: 'Supertrend Line, fixed at entry' } });
    expect(exitModeLabels(cfg({ stopLossPct: 2 }))).not.toHaveProperty('indicatorStop');
  });
});
