import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types';
import { generateDemoCandles } from '../providers/demo';
import { runBacktest } from './engine';
import { activeStop, exitContext, exitModeLabels, hasAnyStop, hitTest, levelsAtEntry, rTargetNeedsStop, readExitSettings, updateTrail } from './exits';
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
    expect(exitModeLabels(c)).toEqual({ stop: 'SL 2 ATR', target: 'TP 3R', trail: 'Trail 1.5 ATR', atrLength: 20 });
    expect(exitModeLabels(cfg({ stopLossPct: 2, takeProfitPct: 4 }))).toEqual({ stop: 'SL 2%', target: 'TP 4%', trail: null, atrLength: null });
    expect(exitContext(c)).toEqual({ exits: { stopLoss: '2 x ATR', takeProfit: '3 x stop', trailingStop: '1.5 x ATR', atrLength: 20 } });
    expect(exitContext(cfg({ stopLossPct: 2 }))).toEqual({});
  });
});
