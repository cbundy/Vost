import { describe, expect, it } from 'vitest';
import { PIN, TAIL, calloutHit, calloutWedge, commentHit, commentShape, inRect, keepInside, pinHit, pinPath, popupRect } from './notes';

const PANE = { width: 400, height: 300 };
const BOX = { width: 100, height: 40 };
const inside = (r: { x: number; y: number; width: number; height: number }, pane = PANE) =>
  r.x >= 0 && r.y >= 0 && r.x + r.width <= pane.width && r.y + r.height <= pane.height;

describe('pin', () => {
  const tip = { x: 100, y: 100 };
  it('has its tip on the anchor and a head above it', () => {
    const pin = pinPath(tip);
    expect(pin.tip).toEqual(tip);
    expect(pin.centre).toEqual({ x: 100, y: 100 - PIN.LIFT });
    // the sides are tangent to the head: the distance of each from the centre is the radius
    expect(Math.hypot(pin.left.x - pin.centre.x, pin.left.y - pin.centre.y)).toBeCloseTo(PIN.R);
    expect(Math.hypot(pin.right.x - pin.centre.x, pin.right.y - pin.centre.y)).toBeCloseTo(PIN.R);
    expect(pin.left.y).toBeLessThan(tip.y);
  });
  it('is hit on the head, along the body and at the tip, and not a little away', () => {
    expect(pinHit(tip, { x: 100, y: 80 }, 0)).toBe(true);
    expect(pinHit(tip, { x: 100, y: 99 }, 0)).toBe(true);
    expect(pinHit(tip, { x: 100, y: 100 }, 0)).toBe(true);
    expect(pinHit(tip, { x: 130, y: 80 }, 6)).toBe(false);
    expect(pinHit(tip, { x: 100, y: 130 }, 6)).toBe(false);
  });
});

describe('popup', () => {
  it('sits to the right of the head, centred on it', () => {
    const r = popupRect({ x: 100, y: 150 }, BOX, PANE);
    expect(r.x).toBeGreaterThan(100 + PIN.R);
    expect(r.y + r.height / 2).toBeCloseTo(150 - PIN.LIFT);
  });
  it('flips to the left at the right edge and stays inside at every edge', () => {
    const right = popupRect({ x: 390, y: 150 }, BOX, PANE);
    expect(right.x + right.width).toBeLessThan(390);
    for (const tip of [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 0, y: 300 }, { x: 400, y: 300 }, { x: 200, y: 5 }, { x: 200, y: 299 }, { x: -50, y: 500 }]) {
      expect(inside(popupRect(tip, BOX, PANE)), JSON.stringify(tip)).toBe(true);
    }
  });
  it('sits at the top-left corner in a pane smaller than the popup', () => {
    const r = popupRect({ x: 20, y: 20 }, { width: 200, height: 100 }, { width: 50, height: 40 });
    expect(r).toMatchObject({ x: 0, y: 0 });
    expect(popupRect({ x: 20, y: 20 }, BOX, { width: 0, height: 0 })).toMatchObject({ x: 0, y: 0 });
  });
  it('keepInside leaves a rectangle that fits where it is', () => {
    expect(keepInside(10, 20, BOX, PANE)).toEqual({ x: 10, y: 20, ...BOX });
  });
  it('inRect takes a tolerance', () => {
    const r = { x: 10, y: 10, width: 20, height: 20 };
    expect(inRect(r, { x: 5, y: 15 })).toBe(false);
    expect(inRect(r, { x: 5, y: 15 }, 6)).toBe(true);
  });
});

describe('callout wedge', () => {
  const box = { x: 100, y: 100, width: 80, height: 40 };
  it('points from the nearest edge to the target', () => {
    const [a, b, tip] = calloutWedge(box, { x: 300, y: 120 })!;
    expect(tip).toEqual({ x: 300, y: 120 });
    expect(a.x).toBe(180);
    expect(b.x).toBe(180);
    const [c, d, tip2] = calloutWedge(box, { x: 140, y: 20 })!;
    expect(tip2).toEqual({ x: 140, y: 20 });
    expect(c.y).toBe(100);
    expect(d.y).toBe(100);
    expect(calloutWedge(box, { x: 20, y: 120 })![0].x).toBe(100);
    expect(calloutWedge(box, { x: 140, y: 400 })![0].y).toBe(140);
  });
  it('keeps its base on the edge near a corner', () => {
    const [a, b] = calloutWedge(box, { x: 300, y: 99 })!;
    expect(Math.min(a.y, b.y)).toBeGreaterThanOrEqual(100);
    expect(Math.max(a.y, b.y)).toBeLessThanOrEqual(140);
  });
  it('has none when the target is inside the box, on it, or equal to the box anchor', () => {
    expect(calloutWedge(box, { x: 120, y: 110 })).toBeNull();
    expect(calloutWedge(box, { x: 100, y: 100 })).toBeNull();
    expect(calloutWedge(box, { x: 180, y: 140 })).toBeNull();
  });
  it('does not throw for a box of no size', () => {
    expect(() => calloutWedge({ x: 5, y: 5, width: 0, height: 0 }, { x: 50, y: 50 })).not.toThrow();
  });
  it('hits the box and the pointer and not a little away', () => {
    const target = { x: 300, y: 120 };
    expect(calloutHit(box, target, { x: 120, y: 120 }, 0)).toBe(true);
    expect(calloutHit(box, target, { x: 240, y: 120 }, 2)).toBe(true);
    expect(calloutHit(box, target, { x: 240, y: 150 }, 2)).toBe(false);
    expect(calloutHit(box, target, { x: 90, y: 90 }, 2)).toBe(false);
  });
});

describe('comment', () => {
  it('has its tail tip at the anchor and the bubble above and to the right', () => {
    const tip = { x: 100, y: 200 };
    const s = commentShape(tip, BOX, PANE);
    expect(s.tail[2]).toEqual(tip);
    expect(s.flipX).toBe(false);
    expect(s.flipY).toBe(false);
    expect(s.rect.y + s.rect.height).toBeCloseTo(tip.y - TAIL.LENGTH);
    expect(s.rect.x + s.rect.width).toBeGreaterThan(tip.x);
    expect(s.rect.x).toBeLessThanOrEqual(tip.x);
    // the tail's base is on the bubble's bottom edge
    expect(s.tail[0].y).toBe(s.rect.y + s.rect.height);
  });
  it('flips below at the top edge and to the left at the right edge', () => {
    const top = commentShape({ x: 100, y: 20 }, BOX, PANE);
    expect(top.flipY).toBe(true);
    expect(top.rect.y).toBeGreaterThan(20);
    expect(top.tail[0].y).toBe(top.rect.y);
    const right = commentShape({ x: 380, y: 200 }, BOX, PANE);
    expect(right.flipX).toBe(true);
    expect(right.rect.x + right.rect.width).toBeGreaterThan(380);
    expect(right.rect.x + right.rect.width).toBeLessThanOrEqual(PANE.width);
    expect(right.tail[2]).toEqual({ x: 380, y: 200 });
  });
  it('keeps the bubble inside the pane at every corner', () => {
    for (const tip of [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 0, y: 300 }, { x: 400, y: 300 }]) {
      expect(inside(commentShape(tip, BOX, PANE).rect), JSON.stringify(tip)).toBe(true);
    }
  });
  it('hits the bubble and the tail and not a little away', () => {
    const tip = { x: 100, y: 200 };
    const s = commentShape(tip, BOX, PANE);
    expect(commentHit(s, { x: s.rect.x + 10, y: s.rect.y + 10 }, 0)).toBe(true);
    expect(commentHit(s, { x: tip.x + 3, y: tip.y - 4 }, 0)).toBe(true);
    expect(commentHit(s, { x: tip.x - 30, y: tip.y }, 3)).toBe(false);
    expect(commentHit(s, { x: s.rect.x - 20, y: s.rect.y }, 3)).toBe(false);
  });
  it('does not throw in a pane smaller than the bubble or of no size', () => {
    expect(() => commentShape({ x: 5, y: 5 }, BOX, { width: 20, height: 10 })).not.toThrow();
    expect(() => commentShape({ x: 5, y: 5 }, { width: 0, height: 0 }, { width: 0, height: 0 })).not.toThrow();
  });
});
