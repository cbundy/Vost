import { describe, expect, it } from 'vitest';
import {
  DRAWER_MAX_WIDTH, DRAWER_QUERY, isDrawerWidth, topbarTier,
  CHART_BAR_HEIGHT, CHART_MIN_HEIGHT, DOCK_COLLAPSE_BELOW, DOCK_DEFAULT, DOCK_MIN, SIDEBAR_DEFAULT, TOPBAR_HEIGHT,
  clamp, dockLimits, dragDelta, resolveDockResize, sanitizeStoredSize, shouldCollapseDock, sidebarLimits, step,
} from './paneSizes';

describe('sidebarLimits', () => {
  it('allows 40% of the viewport width', () => {
    expect(sidebarLimits(1440)).toEqual({ min: 200, max: 576 });
  });
  it('never drops the maximum below the minimum', () => {
    expect(sidebarLimits(390).max).toBe(200);
    expect(sidebarLimits(0).max).toBe(200);
  });
  it('clamps a stored 900px sidebar on a 1280px viewport to 512px', () => {
    const l = sidebarLimits(1280);
    expect(clamp(900, l.min, l.max)).toBe(512);
    expect(clamp(50, l.min, l.max)).toBe(200);
  });
});

describe('dockLimits', () => {
  it('keeps 200px of chart on 720px and 600px viewports', () => {
    for (const h of [720, 600, 900]) {
      const l = dockLimits(h);
      expect(h - TOPBAR_HEIGHT - CHART_BAR_HEIGHT - l.max).toBeGreaterThanOrEqual(CHART_MIN_HEIGHT);
    }
    expect(dockLimits(720).max).toBe(450);
    expect(dockLimits(600).max).toBe(330);
  });
  it('never goes below the tab strip', () => {
    expect(dockLimits(100)).toEqual({ min: DOCK_MIN, max: DOCK_MIN });
  });
});

describe('step', () => {
  const l = { min: 200, max: 500 };
  it('arrow keys step by 16 and Shift by 64', () => {
    expect(step(300, 'ArrowRight', false, l)).toBe(316);
    expect(step(300, 'ArrowUp', false, l)).toBe(316);
    expect(step(300, 'ArrowLeft', false, l)).toBe(284);
    expect(step(300, 'ArrowDown', false, l)).toBe(284);
    expect(step(300, 'ArrowRight', true, l)).toBe(364);
    expect(step(300, 'ArrowLeft', true, l)).toBe(236);
  });
  it('clamps, and Home and End go to the limits', () => {
    expect(step(495, 'ArrowRight', true, l)).toBe(500);
    expect(step(205, 'ArrowLeft', true, l)).toBe(200);
    expect(step(300, 'Home', false, l)).toBe(200);
    expect(step(300, 'End', false, l)).toBe(500);
  });
  it('ignores other keys', () => {
    expect(step(300, 'a', false, l)).toBeNull();
  });
});

describe("step with grow 'start'", () => {
  const l = { min: 200, max: 500 };
  it('ArrowLeft grows and ArrowRight shrinks, Shift steps 64', () => {
    expect(step(300, 'ArrowLeft', false, l, 'start')).toBe(316);
    expect(step(300, 'ArrowRight', false, l, 'start')).toBe(284);
    expect(step(300, 'ArrowLeft', true, l, 'start')).toBe(364);
    expect(step(300, 'ArrowRight', true, l, 'start')).toBe(236);
  });
  it('keeps vertical arrows, Home and End', () => {
    expect(step(300, 'ArrowUp', false, l, 'start')).toBe(316);
    expect(step(300, 'ArrowDown', false, l, 'start')).toBe(284);
    expect(step(300, 'Home', false, l, 'start')).toBe(200);
    expect(step(300, 'End', false, l, 'start')).toBe(500);
  });
  it("leaves the default 'end' unchanged", () => {
    expect(step(300, 'ArrowRight', false, l, 'end')).toBe(316);
  });
});

describe('dragDelta', () => {
  it("grow 'start': a drag of -80px grows by 80, +80 shrinks", () => {
    expect(dragDelta('vertical', 'start', -80, 5)).toBe(80);
    expect(dragDelta('vertical', 'start', 80, 5)).toBe(-80);
  });
  it("grow 'end': follows x", () => {
    expect(dragDelta('vertical', 'end', 80, 5)).toBe(80);
  });
  it('horizontal grows upward whatever the grow', () => {
    expect(dragDelta('horizontal', 'end', 5, -40)).toBe(40);
  });
});

describe('collapse threshold and defaults', () => {
  it('collapses below the threshold only', () => {
    expect(shouldCollapseDock(DOCK_MIN)).toBe(true);
    expect(shouldCollapseDock(DOCK_COLLAPSE_BELOW - 1)).toBe(true);
    expect(shouldCollapseDock(DOCK_COLLAPSE_BELOW)).toBe(false);
  });
  it('has the documented defaults', () => {
    expect(SIDEBAR_DEFAULT).toBe(264);
    expect(DOCK_DEFAULT).toBe(320);
  });
});

describe('sanitizeStoredSize', () => {
  it('keeps a good number', () => {
    expect(sanitizeStoredSize(340, 264)).toBe(340);
  });
  it('falls back for non-numeric, negative, zero, NaN and Infinity', () => {
    for (const v of ['340', null, undefined, {}, -5, 0, NaN, Infinity, -Infinity]) {
      expect(sanitizeStoredSize(v, 264)).toBe(264);
    }
  });
});

describe('resolveDockResize', () => {
  const limits = dockLimits(900);
  it('keeps the drag-start height when a drag collapses the dock', () => {
    expect(resolveDockResize(30, 'drag', false, 400, limits)).toEqual({ height: 400, collapsed: true });
  });
  it('is idempotent for repeated moves below the threshold', () => {
    expect(resolveDockResize(20, 'drag', true, 400, limits)).toEqual({ height: null, collapsed: true });
  });
  it('follows the pointer when it moves back above the threshold', () => {
    expect(resolveDockResize(300, 'drag', true, 400, limits)).toEqual({ height: 300, collapsed: false });
  });
  it('expands a collapsed dock on arrow-up without changing the height', () => {
    expect(resolveDockResize(DOCK_MIN + 16, 'key', true, 400, limits)).toEqual({ height: null, collapsed: false });
  });
  it('keeps a collapsed dock collapsed on other keys', () => {
    expect(resolveDockResize(DOCK_MIN, 'key', true, 400, limits)).toEqual({ height: null, collapsed: true });
  });
  it('clamps the stored height', () => {
    expect(resolveDockResize(5000, 'drag', false, 400, limits)).toEqual({ height: limits.max, collapsed: false });
  });
});

describe('drawer breakpoint', () => {
  it('is on at 900px and below and off above', () => {
    expect(isDrawerWidth(899)).toBe(true);
    expect(isDrawerWidth(900)).toBe(true);
    expect(isDrawerWidth(901)).toBe(false);
  });
  it('builds the media query from the same number', () => {
    expect(DRAWER_MAX_WIDTH).toBe(900);
    expect(DRAWER_QUERY).toBe('(max-width: 900px)');
  });
});

describe('topbarTier', () => {
  it('switches at each boundary (inclusive on the narrower side)', () => {
    expect(topbarTier(1920)).toBe('full');
    expect(topbarTier(1281)).toBe('full');
    expect(topbarTier(1280)).toBe('compact');
    expect(topbarTier(1024)).toBe('compact');
    expect(topbarTier(961)).toBe('compact');
    expect(topbarTier(960)).toBe('narrow');
    expect(topbarTier(768)).toBe('narrow');
    expect(topbarTier(601)).toBe('narrow');
    expect(topbarTier(600)).toBe('tiny');
    expect(topbarTier(360)).toBe('tiny');
  });
});
