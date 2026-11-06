/**
 * A result as text: the plain settings, and a Pine v6 `strategy()` script that trades like the built-in
 * strategy. Where Pine's own `ta.*` function and Vost's indicator would differ, the script follows Vost.
 */
import { getStrategy, type ParamSpec } from '../lib/backtest/strategies';
import { defaultBacktestConfig } from '../lib/backtest/types';
import type { Candidate } from './engine';
import type { FindInputs } from './run';

type Pick2 = Pick<Candidate, 'strategyId' | 'params'>;
type Run = Pick<FindInputs, 'direction' | 'risk'>;

const optionLabel = (p: ParamSpec, v: number): string => p.options?.find((o) => o.value === v)?.label ?? String(v);

/** A parameter's value as the user reads it: a select by its option name. */
function valueText(p: ParamSpec, v: number): string {
  return p.type === 'select' ? optionLabel(p, v) : String(v);
}

const onOff = (v: number | null, unit: string): string => (v == null ? 'off' : `${v}${unit}`);

/** Every setting of a result, one per line, for pasting anywhere. */
export function settingsPlain(c: Pick2, run: Run): string {
  const s = getStrategy(c.strategyId);
  const cfg = defaultBacktestConfig();
  return [
    s.name,
    ...s.params.map((p) => `${p.label}: ${valueText(p, c.params[p.key] ?? p.default)}`),
    `Fee: ${run.risk.feeBps} bps per side`,
    `Slippage: ${run.risk.slippageBps} bps per fill`,
    `Stop loss: ${onOff(run.risk.stopLossPct, '%')}`,
    `Take profit: ${onOff(run.risk.takeProfitPct, '%')}`,
    `Initial capital: ${cfg.initialCapital}`,
    run.risk.riskPct != null ? `Position size: risk ${run.risk.riskPct}% of equity at the stop` : `Position size: ${cfg.positionSizePct}% of equity`,
  ].join('\n');
}

const q = (s: string): string => JSON.stringify(s);

/** The input.* line for a parameter, with the result's value as its default. */
function inputLine(varName: string, p: ParamSpec, v: number): string {
  if (p.type === 'select') {
    const opts = (p.options ?? []).map((o) => q(o.label)).join(', ');
    return `${varName} = input.string(${q(optionLabel(p, v))}, ${q(p.label)}, options=[${opts}])`;
  }
  const bounds = `${p.min != null ? `, minval=${p.min}` : ''}${p.max != null ? `, maxval=${p.max}` : ''}`;
  return `${varName} = input.${p.type === 'int' ? 'int' : 'float'}(${v}, ${q(p.label)}${bounds})`;
}

/** The bar-by-bar signal of each template, as Pine lines that end by setting `float raw` (na while warming up). */
const BODIES: Record<string, string[]> = {
  sma_cross: [
    'fast = ta.sma(close, fastLen)',
    'slow = ta.sma(close, slowLen)',
    'float raw = na',
    'if not na(fast) and not na(slow)',
    '    raw := levelSignal(fast > slow)',
  ],
  // Pine's ta.ema is seeded with the SMA of the first `length` bars, as Vost's is.
  ema_cross: [
    'fast = ta.ema(close, fastLen)',
    'slow = ta.ema(close, slowLen)',
    'float raw = na',
    'if not na(fast) and not na(slow)',
    '    raw := levelSignal(fast > slow)',
  ],
  macd_cross: [
    'macdLine = ta.ema(close, fastLen) - ta.ema(close, slowLen)',
    'signalLine = ta.ema(macdLine, signalLen)',
    'float raw = na',
    'if not na(macdLine) and not na(signalLine)',
    '    raw := levelSignal(macdLine - signalLine > 0)',
  ],
  rsi_reversion: [
    'r = ta.rsi(close, rsiLen)',
    'crossUp = ta.crossover(r, oversold)',
    'crossDown = ta.crossunder(r, overbought)',
    'var int pos = 0',
    'float raw = na',
    'if not na(r)',
    '    if dir != "Short only"',
    '        if pos == 0 and crossUp',
    '            pos := 1',
    '        else if pos == 1 and r > overbought',
    '            pos := 0',
    '    if dir != "Long only"',
    '        if pos == 0 and crossDown',
    '            pos := -1',
    '        else if pos == -1 and r < oversold',
    '            pos := 0',
    '    raw := pos',
  ],
  bollinger: [
    'middle = ta.sma(close, bbLen)',
    'band = mult * ta.stdev(close, bbLen)',
    'upper = middle + band',
    'lower = middle - band',
    'var int pos = 0',
    'float raw = na',
    'if not na(middle) and not na(band)',
    '    breakout = mode == "Breakout"',
    '    if dir != "Short only"',
    '        if pos == 0',
    '            if breakout ? close > upper : close < lower',
    '                pos := 1',
    '        else if pos == 1',
    '            if breakout ? close < middle : close > middle',
    '                pos := 0',
    '    if dir != "Long only"',
    '        if pos == 0',
    '            if breakout ? close < lower : close > upper',
    '                pos := -1',
    '        else if pos == -1',
    '            if breakout ? close > middle : close < middle',
    '                pos := 0',
    '    raw := pos',
  ],
  donchian: [
    'upLevel = ta.highest(high, entryLen)[1]',
    'downLevel = ta.lowest(low, exitLen)[1]',
    'downBreak = ta.lowest(low, entryLen)[1]',
    'upBreak = ta.highest(high, exitLen)[1]',
    'var int pos = 0',
    'float raw = na',
    'if not na(upLevel) and not na(downLevel) and not na(downBreak) and not na(upBreak)',
    '    if dir != "Short only"',
    '        if pos == 0 and close > upLevel',
    '            pos := 1',
    '        else if pos == 1 and close < downLevel',
    '            pos := 0',
    '    if dir != "Long only"',
    '        if pos == 0 and close < downBreak',
    '            pos := -1',
    '        else if pos == -1 and close > upBreak',
    '            pos := 0',
    '    raw := pos',
  ],
  pullback: [
    'trendEma = ta.ema(close, trendLen)',
    'r = ta.rsi(close, rsiLen)',
    'crossUp = ta.crossover(r, dip)',
    'crossDown = ta.crossunder(r, 100 - dip)',
    'var int pos = 0',
    'float raw = na',
    'if not na(r) and not na(trendEma)',
    '    if dir != "Short only"',
    '        if pos == 0 and close > trendEma and crossUp',
    '            pos := 1',
    '        else if pos == 1 and (r > exitLevel or close < trendEma)',
    '            pos := 0',
    '    if dir != "Long only"',
    '        if pos == 0 and close < trendEma and crossDown',
    '            pos := -1',
    '        else if pos == -1 and (r < 100 - exitLevel or close > trendEma)',
    '            pos := 0',
    '    raw := pos',
  ],
  reversal: [
    'middle = ta.sma(close, bbLen)',
    'band = mult * ta.stdev(close, bbLen)',
    'upper = middle + band',
    'lower = middle - band',
    'var int pos = 0',
    'float raw = na',
    'if not na(middle) and not na(band)',
    '    if dir != "Short only"',
    '        if pos == 0 and not na(lower[1]) and close[1] < lower[1] and close > lower',
    '            pos := 1',
    '        else if pos == 1 and close > middle',
    '            pos := 0',
    '    if dir != "Long only"',
    '        if pos == 0 and not na(upper[1]) and close[1] > upper[1] and close < upper',
    '            pos := -1',
    '        else if pos == -1 and close < middle',
    '            pos := 0',
    '    raw := pos',
  ],
  momentum_breakout: [
    'upLevel = ta.highest(high, entryLen)[1]',
    'downLevel = ta.lowest(low, exitLen)[1]',
    'downBreak = ta.lowest(low, entryLen)[1]',
    'upBreak = ta.highest(high, exitLen)[1]',
    'avgVol = ta.sma(volume, volLen)[1]',
    'var int pos = 0',
    'float raw = na',
    'if not na(upLevel) and not na(downLevel) and not na(downBreak) and not na(upBreak) and not na(avgVol)',
    '    loud = volume >= volMult * avgVol',
    '    if dir != "Short only"',
    '        if pos == 0 and close > upLevel and loud',
    '            pos := 1',
    '        else if pos == 1 and close < downLevel',
    '            pos := 0',
    '    if dir != "Long only"',
    '        if pos == 0 and close < downBreak and loud',
    '            pos := -1',
    '        else if pos == -1 and close > upBreak',
    '            pos := 0',
    '    raw := pos',
  ],
};

/** Variable names of each template's parameters in the script. */
const VARS: Record<string, Record<string, string>> = {
  sma_cross: { fast: 'fastLen', slow: 'slowLen', direction: 'dir' },
  ema_cross: { fast: 'fastLen', slow: 'slowLen', direction: 'dir' },
  macd_cross: { fast: 'fastLen', slow: 'slowLen', signal: 'signalLen', direction: 'dir' },
  rsi_reversion: { length: 'rsiLen', oversold: 'oversold', overbought: 'overbought', direction: 'dir' },
  bollinger: { length: 'bbLen', mult: 'mult', mode: 'mode', direction: 'dir' },
  donchian: { entry: 'entryLen', exit: 'exitLen', direction: 'dir' },
  pullback: { trend: 'trendLen', length: 'rsiLen', dip: 'dip', target: 'exitLevel', direction: 'dir' },
  reversal: { length: 'bbLen', mult: 'mult', direction: 'dir' },
  momentum_breakout: { entry: 'entryLen', exit: 'exitLen', volLen: 'volLen', volMult: 'volMult', direction: 'dir' },
};

const LEVEL_FN = [
  'levelSignal(bool level) =>',
  '    dir == "Long only" ? (level ? 1.0 : 0.0) : dir == "Short only" ? (level ? 0.0 : -1.0) : (level ? 1.0 : -1.0)',
];

/** True when the template is a plain signal template this module can write as Pine. */
export const hasPine = (strategyId: string): boolean => strategyId in BODIES;

/**
 * A Pine v6 strategy that takes the same trades as the built-in strategy: it decides on the bar close and
 * fills on the next open, goes flat or reverses as the signal says, and after a stop or target waits for the
 * signal to leave that side before it enters again. Slippage is not in the script: Pine counts it in ticks.
 */
export function pineStrategyText(c: Pick2, run: Run): string {
  const s = getStrategy(c.strategyId);
  const body = BODIES[c.strategyId];
  const names = VARS[c.strategyId];
  if (!body || !names) throw new Error(`No Pine export for ${c.strategyId}`);
  const cfg = defaultBacktestConfig();
  const { stopLossPct: stop, takeProfitPct: take, feeBps } = run.risk;
  const riskSized = run.risk.riskPct != null && stop != null;
  const qtyArg = riskSized ? ', qty=strategy.equity * riskPct / 100 / (close * stopPct / 100)' : '';
  const usesLevel = body.some((l) => l.includes('levelSignal'));
  const head = [
    '//@version=6',
    `// ${s.name} found by the Vost strategy maker. Fee ${feeBps} bps per side, slippage ${run.risk.slippageBps} bps (not applied here).`,
    ...(riskSized ? ['// Position size is by risk: each entry risks riskPct of the equity at the stop, with no cap on the size (leverage can be high).'] : []),
    `strategy(${q(`${s.name} (strategy maker)`)}, overlay=true, initial_capital=${cfg.initialCapital}, default_qty_type=strategy.percent_of_equity, default_qty_value=${cfg.positionSizePct}, commission_type=strategy.commission.percent, commission_value=${feeBps / 100}, margin_long=0, margin_short=0)`,
    '',
    ...s.params.map((p) => inputLine(names[p.key], p, c.params[p.key] ?? p.default)),
    ...(stop != null ? [`stopPct = input.float(${stop}, "Stop loss %", minval=0.01)`] : []),
    ...(riskSized ? [`riskPct = input.float(${run.risk.riskPct}, "Risk per trade %", minval=0.01, maxval=100)`] : []),
    ...(take != null ? [`takePct = input.float(${take}, "Take profit %", minval=0.01)`] : []),
    '',
    ...(usesLevel ? [...LEVEL_FN, ''] : []),
    ...body,
    '',
    '// Orders: decided on this close, filled on the next open. A stop or target counts from the bar after the entry.',
    'var float desired = 0',
    'var float resetSide = 0',
    '// we wanted a position and it is gone: a stop or target took it out',
    'if desired != 0 and strategy.position_size == 0',
    '    resetSide := desired',
    'float target = raw',
    'if not na(raw)',
    '    if resetSide != 0',
    '        if raw == resetSide',
    '            target := 0',
    '        else',
    '            resetSide := 0',
    '    if target != desired',
    '        if target > 0',
    `            strategy.entry("Long", strategy.long${qtyArg})`,
    '        else if target < 0',
    `            strategy.entry("Short", strategy.short${qtyArg})`,
    '        else if strategy.position_size > 0',
    '            strategy.close("Long")',
    '        else if strategy.position_size < 0',
    '            strategy.close("Short")',
    '        desired := target',
    ...(stop != null || take != null
      ? [
          '',
          'avg = strategy.position_avg_price',
          'if strategy.position_size > 0',
          `    strategy.exit("Exit Long", "Long"${stop != null ? ', stop=avg * (1 - stopPct / 100)' : ''}${take != null ? ', limit=avg * (1 + takePct / 100)' : ''})`,
          'if strategy.position_size < 0',
          `    strategy.exit("Exit Short", "Short"${stop != null ? ', stop=avg * (1 + stopPct / 100)' : ''}${take != null ? ', limit=avg * (1 - takePct / 100)' : ''})`,
        ]
      : []),
    '',
  ];
  return head.join('\n');
}
