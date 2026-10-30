/**
 * Pure maths of the Long position and Short position tools: risk, quantity, distances and profit or loss from a
 * position's prices and inputs, and what the bars after entry did to it. No chart or React imports.
 *
 * Quantity rule: the quantity is the risk amount divided by the loss one unit takes at the stop
 * (|entry - stop| x lot size), rounded DOWN to a whole unit, so the loss at the stop never exceeds the risk. The
 * quotient is first cleaned of float noise (rounded to 6 decimals) so that an exact fit such as 250 / 0.1 is not
 * pushed down a whole unit by the binary representation of 0.1.
 */
import type { OhlcBar } from '../drawingGeometry';

export type PositionSide = 'long' | 'short';
export type RiskUnit = 'percent' | 'amount';

export type PositionPrices = { entry: number; target: number; stop: number };

export type PositionInputs = { accountSize: number; lotSize: number; risk: number; riskUnit: RiskUnit };

export type PositionStats = {
  /** The most the position may lose, in account money. */
  riskAmount: number;
  /** Whole units; 0 when the stop sits on the entry or the risk cannot buy one unit. */
  quantity: number;
  /** Absolute distances in price. */
  targetDistance: number;
  stopDistance: number;
  /** Distances as a percentage of the entry price. */
  targetPct: number;
  stopPct: number;
  /** Distances in whole ticks; absent without a tick size. */
  targetTicks?: number;
  stopTicks?: number;
  /** Profit at the target (positive) and loss at the stop (negative), in account money. */
  targetPnl: number;
  stopPnl: number;
  /** Target distance over stop distance; null when the stop sits on the entry. */
  riskReward: number | null;
};

/** A number with the float noise of binary arithmetic removed (12 significant digits). */
export const clean = (n: number): number => (Number.isFinite(n) ? Number(n.toPrecision(12)) : n);

/** Whether the target and stop are on the right sides of the entry for the side. */
export function sidesValid(side: PositionSide, { entry, target, stop }: PositionPrices): boolean {
  if (![entry, target, stop].every(Number.isFinite)) return false;
  return side === 'long' ? target > entry && stop < entry : target < entry && stop > entry;
}

/** The most the position may lose. */
export function riskAmount(inputs: PositionInputs): number {
  return clean(inputs.riskUnit === 'percent' ? (inputs.accountSize * inputs.risk) / 100 : inputs.risk);
}

/** Whole units for a risk amount and the loss one unit takes at the stop (see the module's quantity rule). */
export function quantityFor(risk: number, stopDistance: number, lotSize: number): number {
  const perUnit = stopDistance * lotSize;
  if (!(perUnit > 0) || !(risk > 0)) return 0;
  return Math.floor(Math.round((risk / perUnit) * 1e6) / 1e6);
}

export function positionStats(prices: PositionPrices, inputs: PositionInputs, tickSize?: number): PositionStats {
  const { entry, target, stop } = prices;
  const targetDistance = clean(Math.abs(target - entry));
  const stopDistance = clean(Math.abs(entry - stop));
  const risk = riskAmount(inputs);
  const quantity = quantityFor(risk, stopDistance, inputs.lotSize);
  const units = quantity * inputs.lotSize;
  const ticks = tickSize !== undefined && tickSize > 0 ? (d: number) => Math.round(d / tickSize) : undefined;
  const pct = (d: number) => (entry !== 0 ? clean((d / Math.abs(entry)) * 100) : 0);
  return {
    riskAmount: risk,
    quantity,
    targetDistance,
    stopDistance,
    targetPct: pct(targetDistance),
    stopPct: pct(stopDistance),
    ...(ticks ? { targetTicks: ticks(targetDistance), stopTicks: ticks(stopDistance) } : {}),
    targetPnl: clean(targetDistance * units),
    stopPnl: clean(-stopDistance * units),
    riskReward: stopDistance > 0 ? clean(targetDistance / stopDistance) : null,
  };
}

export type PositionOutcome = { result: 'target' | 'stop' | 'open'; time?: number; price?: number };

/**
 * What the bars did to the position: the first bar after the entry time and up to the end time whose range reaches
 * the target (the high for a long, the low for a short) or the stop (the low for a long, the high for a short)
 * decides it. A bar that reaches both counts as the stop (the conservative reading, as the bar's inner order is
 * unknown). Neither reached, or no bar in range: open.
 */
export function positionOutcome(side: PositionSide, prices: PositionPrices, startTime: number, endTime: number, candles: readonly OhlcBar[]): PositionOutcome {
  const { target, stop } = prices;
  for (const c of candles) {
    if (c.time <= startTime) continue;
    if (c.time > endTime) break;
    const hitTarget = side === 'long' ? c.high >= target : c.low <= target;
    const hitStop = side === 'long' ? c.low <= stop : c.high >= stop;
    if (hitStop) return { result: 'stop', time: c.time, price: stop };
    if (hitTarget) return { result: 'target', time: c.time, price: target };
  }
  return { result: 'open' };
}

/** Money with two decimals and a sign (`+12.50`, `-3.00`); a zero has none. */
export function formatMoney(n: number): string {
  const v = Math.round(Math.abs(n) * 100) / 100;
  return `${n > 0 && v > 0 ? '+' : n < 0 && v > 0 ? '-' : ''}${v.toFixed(2)}`;
}
