/**
 * The exits of a Pine export that go beyond a percent stop and a percent target: stops and targets sized by the
 * ATR, a target as a multiple of the stop, and a trailing stop. The script follows Vost bar for bar: it computes
 * the ATR as Vost does, fixes the levels once at the entry fill, and moves the trail at each bar close.
 */
import { readExitSettings, type ExitSettings } from '../lib/backtest/exits';
import type { FindInputs } from './run';

type Risk = FindInputs['risk'];

export interface PineExits {
  settings: ExitSettings;
  /** The input.* lines of every exit that is on. */
  inputs: string[];
  /** The Vost ATR, as top-level `var` state, ending with `atrV` and `atrOk` (empty without an ATR mode). */
  atrLines: string[];
  /** The condition a new entry also needs (the ATR is known), or null. */
  entryGate: string | null;
  /** Statements run just before an entry order, to capture the ATR of the signal bar. */
  captureLines: string[];
  /** The distance a risk-sized entry risks: the tighter of every stop that is on, or null without a stop. */
  riskDistance: string | null;
  /** The level, trail and strategy.exit lines, after the entry orders. */
  exitLines: string[];
}

const tighter = (parts: string[]): string => (parts.length === 1 ? parts[0] : `math.min(${parts.join(', ')})`);

/** Null when the run has no ATR, times-the-stop or trailing exit: the percent-only script applies. */
export function pineExits(risk: Risk): PineExits | null {
  const s = readExitSettings(risk);
  const stopKind = s.stop?.kind;
  const hasTrail = s.trail != null;
  const rTarget = s.target?.kind === 'r';
  if (stopKind !== 'atr' && !hasTrail && s.target?.kind !== 'atr' && !rTarget) return null;

  const hasStop = s.stop != null;
  // A times-the-stop target with no stop and no trail has nothing to multiply: no target, as in the engine.
  const target = rTarget && !hasStop && !hasTrail ? null : s.target;

  const inputs: string[] = [];
  if (s.stop?.kind === 'pct') inputs.push(`stopPct = input.float(${s.stop.pct}, "Stop loss %", minval=0.01)`);
  if (s.stop?.kind === 'atr') inputs.push(`stopAtr = input.float(${s.stop.mult}, "Stop loss ATR multiple", minval=0.01)`);
  if (target?.kind === 'pct') inputs.push(`takePct = input.float(${target.pct}, "Take profit %", minval=0.01)`);
  if (target?.kind === 'atr') inputs.push(`takeAtr = input.float(${target.mult}, "Take profit ATR multiple", minval=0.01)`);
  if (target?.kind === 'r') inputs.push(`takeR = input.float(${target.r}, "Take profit (times the stop)", minval=0.01)`);
  if (s.trail?.kind === 'pct') inputs.push(`trailPct = input.float(${s.trail.pct}, "Trailing stop %", minval=0.01)`);
  if (s.trail?.kind === 'atr') inputs.push(`trailAtr = input.float(${s.trail.mult}, "Trailing stop ATR multiple", minval=0.01)`);
  if (s.needsAtr) inputs.push(`atrLength = input.int(${s.atrLength}, "ATR length", minval=1, maxval=500)`);

  const atrLines = s.needsAtr
    ? [
        '// ATR as Vost computes it, not ta.atr: the true range starts at bar 1, the first value (at bar atrLength) is the mean of',
        '// bars 1..atrLength, then Wilder smoothing. ta.atr seeds from bar 0, so its values differ.',
        'var float atrState = na',
        'var float trSum = 0.0',
        'float trueRange = bar_index >= 1 ? math.max(high - low, math.abs(high - close[1]), math.abs(low - close[1])) : na',
        'if bar_index >= 1 and bar_index <= atrLength',
        '    trSum := trSum + trueRange',
        '    if bar_index == atrLength',
        '        atrState := trSum / atrLength',
        'else if bar_index > atrLength',
        '    atrState := (atrState * (atrLength - 1) + trueRange) / atrLength',
        'float atrV = atrState',
        'bool atrOk = not na(atrV) and atrV > 0',
        '// the ATR of the bar that placed the latest entry order',
        'var float orderAtr = na',
        '',
      ]
    : [];

  // The distances (in price) from the entry price to each stop that is on.
  const stopDist = s.stop?.kind === 'atr' ? 'stopAtr * posAtr' : s.stop?.kind === 'pct' ? 'avg * stopPct / 100' : null;
  const trailDistExpr = s.trail?.kind === 'atr' ? 'trailAtr * posAtr' : s.trail?.kind === 'pct' ? 'avg * trailPct / 100' : null;
  const sizeParts = [
    s.stop?.kind === 'atr' ? 'stopAtr * orderAtr' : s.stop?.kind === 'pct' ? 'close * stopPct / 100' : null,
    s.trail?.kind === 'atr' ? 'trailAtr * orderAtr' : s.trail?.kind === 'pct' ? 'close * trailPct / 100' : null,
  ].filter((x): x is string => x != null);

  const level: string[] = [];
  if (stopDist) level.push(`    stopDist = ${stopDist}`, '    stopLvl := avg - side * stopDist');
  if (trailDistExpr) level.push(`    trailDist := ${trailDistExpr}`, '    trailLvl := avg - side * trailDist', '    bestPx := avg');
  if (target?.kind === 'pct') level.push('    targetLvl := avg * (1 + side * takePct / 100)');
  if (target?.kind === 'atr') level.push('    targetLvl := avg + side * takeAtr * posAtr');
  if (target?.kind === 'r') {
    const dists = [stopDist ? 'stopDist' : null, trailDistExpr ? 'trailDist' : null].filter((x): x is string => x != null);
    level.push(`    targetLvl := avg + side * takeR * ${tighter(dists)}`);
  }

  const stopOf = (long: boolean): string | null => {
    if (hasStop && hasTrail) return `math.${long ? 'max' : 'min'}(stopLvl, trailLvl)`;
    return hasStop ? 'stopLvl' : hasTrail ? 'trailLvl' : null;
  };
  const exitCall = (long: boolean): string => {
    const stop = stopOf(long);
    const args = `${stop ? `, stop=${stop}` : ''}${target ? ', limit=targetLvl' : ''}`;
    return `    strategy.exit("Exit ${long ? 'Long' : 'Short'}", "${long ? 'Long' : 'Short'}"${args})`;
  };

  const exitLines = [
    '',
    '// Exit levels are fixed once, on the first bar of a new position, from the entry price and the ATR of the bar that placed the order.',
    ...(hasTrail
      ? [
          '// The trailing stop is a stop this script moves at each bar close (never back), not the built-in trailing order, so it trades like Vost:',
          '// the trail is tested before it moves, then moves with the bar\'s high or low.',
        ]
      : []),
    '// Known difference, as for every stop and target here: the exit counts from the bar after the entry, while Vost also checks the entry bar.',
    'var int lvlSide = 0',
    ...(s.needsAtr ? ['var float posAtr = na'] : []),
    ...(hasStop ? ['var float stopLvl = na'] : []),
    ...(hasTrail ? ['var float trailLvl = na', 'var float trailDist = na', 'var float bestPx = na'] : []),
    ...(target ? ['var float targetLvl = na'] : []),
    'int posSide = strategy.position_size > 0 ? 1 : strategy.position_size < 0 ? -1 : 0',
    'if posSide == 0',
    '    lvlSide := 0',
    'else if posSide != lvlSide',
    '    lvlSide := posSide',
    '    side = posSide',
    '    avg = strategy.position_avg_price',
    ...(s.needsAtr ? ['    posAtr := orderAtr'] : []),
    ...level,
    ...(hasTrail
      ? [
          'if posSide > 0 and not na(trailLvl)',
          '    bestPx := math.max(bestPx, high)',
          '    trailLvl := math.max(trailLvl, bestPx - trailDist)',
          'if posSide < 0 and not na(trailLvl)',
          '    bestPx := math.min(bestPx, low)',
          '    trailLvl := math.min(trailLvl, bestPx + trailDist)',
        ]
      : []),
    'if posSide > 0',
    exitCall(true),
    'if posSide < 0',
    exitCall(false),
  ];

  return {
    settings: s,
    inputs,
    atrLines,
    entryGate: s.needsAtr ? 'atrOk' : null,
    captureLines: s.needsAtr ? ['orderAtr := atrV'] : [],
    riskDistance: sizeParts.length ? tighter(sizeParts) : null,
    exitLines,
  };
}
