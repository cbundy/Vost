import { describe, expect, it, vi } from 'vitest';
import { CountdownPrimitive, LABEL_HEIGHT, type CountdownBar } from './countdownPrimitive';

const OPEN = Date.UTC(2024, 0, 10, 12, 0, 0) / 1000;
const NOW = OPEN * 1000 + 23000;

function make(over: { bar?: CountdownBar | null; enabled?: boolean; y?: number | null; tf?: string } = {}) {
  const state = { bar: over.bar === undefined ? ({ time: OPEN, close: 50, up: true } as CountdownBar | null) : over.bar, enabled: over.enabled ?? true, y: over.y === undefined ? 100 : over.y };
  const prim = new CountdownPrimitive(() => state.bar, () => over.tf ?? '1m', () => state.enabled, '#00ff00', '#ff0000', () => NOW);
  const requestUpdate = vi.fn();
  prim.attached({ series: { priceToCoordinate: () => state.y }, requestUpdate } as never);
  return { prim, state, requestUpdate, view: () => prim.priceAxisViews()[0] };
}

describe('CountdownPrimitive', () => {
  it('has one view with the formatted time and sits one label under the close', () => {
    const { view, prim } = make();
    expect(prim.priceAxisViews()).toHaveLength(1);
    expect(view().text()).toBe('00:37');
    expect(view().coordinate()).toBe(100 + LABEL_HEIGHT);
    expect(view().visible?.()).toBe(true);
  });
  it('hides when disabled, off the scale, or with nothing to count', () => {
    expect(make({ enabled: false }).view().visible?.()).toBe(false);
    expect(make({ y: null }).view().visible?.()).toBe(false);
    expect(make({ bar: null }).view().visible?.()).toBe(false);
    expect(make({ bar: { time: OPEN - 3600, close: 1, up: true } }).view().visible?.()).toBe(false);
    expect(make({ tf: 'zz' }).view().visible?.()).toBe(false);
  });
  it('takes its colour from the bar: up, down or a Pine colour', () => {
    expect(make().view().backColor()).toBe('#00ff00');
    expect(make({ bar: { time: OPEN, close: 1, up: false } }).view().backColor()).toBe('#ff0000');
    const pine = make({ bar: { time: OPEN, close: 1, up: false, color: '#ffff00' } }).view();
    expect(pine.backColor()).toBe('#ffff00');
    expect(pine.textColor()).toBe('#000000');
  });
  it('tick asks the chart to repaint', () => {
    const { prim, requestUpdate } = make();
    prim.tick();
    expect(requestUpdate).toHaveBeenCalledTimes(1);
  });
});
