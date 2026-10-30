import type { AxisLabels } from './types';

/** Axis labels at every anchor's price and time, shown only while the drawing is selected. */
export const axisAtAnchors = (anchors: readonly { time: number; price: number }[], _style: unknown, selected: boolean): AxisLabels =>
  selected ? { price: anchors.map((a) => a.price), time: anchors.map((a) => a.time) } : {};
