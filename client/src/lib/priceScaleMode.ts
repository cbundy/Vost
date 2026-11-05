import { PriceScaleMode } from 'lightweight-charts';

/** How the main chart's price scale maps prices to height. */
export type PriceScaleModeId = 'linear' | 'log' | 'percent' | 'indexed';

export const DEFAULT_PRICE_SCALE_MODE: PriceScaleModeId = 'linear';

export const PRICE_SCALE_MODES: readonly { id: PriceScaleModeId; label: string }[] = [
  { id: 'linear', label: 'Linear' },
  { id: 'log', label: 'Logarithmic' },
  { id: 'percent', label: 'Percent' },
  { id: 'indexed', label: 'Indexed to 100' },
];

const LW_MODE: Record<PriceScaleModeId, PriceScaleMode> = {
  linear: PriceScaleMode.Normal,
  log: PriceScaleMode.Logarithmic,
  percent: PriceScaleMode.Percentage,
  indexed: PriceScaleMode.IndexedTo100,
};

/** The lightweight-charts mode a mode id stands for. */
export function lightweightMode(id: PriceScaleModeId): PriceScaleMode {
  return LW_MODE[id];
}

/** A saved value as a mode id; anything unknown is linear. */
export function sanitizePriceScaleMode(v: unknown): PriceScaleModeId {
  return PRICE_SCALE_MODES.some((m) => m.id === v) ? (v as PriceScaleModeId) : DEFAULT_PRICE_SCALE_MODE;
}

/** What the "L" button sets: linear when logarithmic is on, otherwise logarithmic. */
export function toggleLogMode(current: PriceScaleModeId): PriceScaleModeId {
  return current === 'log' ? 'linear' : 'log';
}
