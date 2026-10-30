import { describe, expect, it } from 'vitest';
import { drawingBox, placeToolbar } from './toolbarPlacement';

const pane = { width: 800, height: 400 };
const size = { width: 200, height: 32 };
const area = { width: 800, height: 400 };

describe('drawingBox', () => {
  it('is the bounding box of the points', () => {
    expect(drawingBox([{ x: 100, y: 50 }, { x: 300, y: 150 }], {}, pane)).toEqual({ left: 100, right: 300, top: 50, bottom: 150 });
  });
  it('spans the pane width at a price-only or full-width tool', () => {
    expect(drawingBox([{ x: 0, y: 120 }], { priceOnly: true }, pane)).toEqual({ left: 0, right: 800, top: 120, bottom: 120 });
    expect(drawingBox([{ x: 5, y: 120 }], { fullWidth: true }, pane)).toEqual({ left: 0, right: 800, top: 120, bottom: 120 });
  });
  it('spans the pane height at a time-only or full-height tool', () => {
    expect(drawingBox([{ x: 300, y: 0 }], { timeOnly: true }, pane)).toEqual({ left: 300, right: 300, top: 0, bottom: 400 });
    expect(drawingBox([{ x: 300, y: 9 }], { fullHeight: true }, pane)).toEqual({ left: 300, right: 300, top: 0, bottom: 400 });
  });
  it('uses the pane points of a pane-anchored tool as they are', () => {
    expect(drawingBox([{ x: 80, y: 40 }, { x: 160, y: 120 }], {}, pane)).toEqual({ left: 80, right: 160, top: 40, bottom: 120 });
  });
  it('is null with no points', () => {
    expect(drawingBox([], {}, pane)).toBeNull();
  });
});

describe('placeToolbar', () => {
  const box = { left: 300, right: 500, top: 200, bottom: 260 };
  it('is centred and 8px above when there is room', () => {
    expect(placeToolbar(box, size, area)).toEqual({ left: 300, top: 200 - 8 - 32, side: 'above' });
  });
  it('goes 8px below when there is no room above', () => {
    expect(placeToolbar({ ...box, top: 20, bottom: 80 }, size, area)).toEqual({ left: 300, top: 88, side: 'below' });
  });
  it('is clamped 4px inside the left and right edges', () => {
    expect(placeToolbar({ ...box, left: 0, right: 40 }, size, area).left).toBe(4);
    expect(placeToolbar({ ...box, left: 760, right: 800 }, size, area).left).toBe(800 - 200 - 4);
  });
  it('is clamped inside the bottom edge', () => {
    const r = placeToolbar({ left: 300, right: 500, top: 10, bottom: 395 }, size, area);
    expect(r.top).toBeLessThanOrEqual(400 - 32 - 4);
    expect(r.top).toBeGreaterThanOrEqual(4);
  });
  it('sits at the top for a box that spans the pane height', () => {
    expect(placeToolbar({ left: 300, right: 300, top: 0, bottom: 400 }, size, area)).toEqual({ left: 200, top: 4, side: 'above' });
  });
  it('centres and clamps a box wider than the area', () => {
    const r = placeToolbar({ left: -100, right: 1000, top: 200, bottom: 220 }, size, area);
    expect(r.left).toBe(350);
  });
  it('keeps the margin when the toolbar is wider than the area', () => {
    expect(placeToolbar(box, { width: 900, height: 32 }, area).left).toBe(4);
  });
});
