import { describe, expect, it } from 'vitest';
import { TOOLS } from '../components/chart/tools';
import {
  CURSOR,
  ERASER,
  GROUP_ORDER,
  allEntries,
  clampBarPos,
  entryPressed,
  flyoutStep,
  groupEntry,
  groupPressed,
  railGroups,
  sanitizeBarPos,
  sanitizeCursorKind,
  sanitizeFavorites,
  sanitizeLastTool,
} from './drawingRail';

describe('railGroups', () => {
  const groups = railGroups();

  it('gives every registered tool a known group and section, and lists it exactly once', () => {
    for (const t of TOOLS) {
      expect(GROUP_ORDER).toContain(t.group);
      expect(t.section.length).toBeGreaterThan(0);
    }
    const keys = allEntries(groups).map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const t of TOOLS) expect(keys.filter((k) => k === t.id)).toHaveLength(1);
  });

  it('orders families by the fixed order and leaves out empty ones', () => {
    expect(groups.map((g) => g.id)).toEqual(['cursors', 'lines', 'fib-gann', 'patterns', 'forecast-measure', 'shapes', 'annotations']);
    expect(groups.map((g) => g.id)).not.toContain('icons');
  });

  it('holds the chart patterns, then the cycle tools, in the Patterns family', () => {
    const patterns = groups.find((g) => g.id === 'patterns')!;
    expect(patterns.entries.map((e) => e.key)).toEqual(['xabcdPattern', 'cypherPattern', 'abcdPattern', 'headAndShoulders', 'trianglePattern', 'threeDrives', 'cyclicLines', 'timeCycles', 'sineLine']);
    expect(patterns.entries.slice(0, 6).every((e) => e.section === 'Chart patterns')).toBe(true);
    expect(patterns.entries.slice(6).every((e) => e.section === 'Cycles')).toBe(true);
  });

  it('opens the Shapes family with a Brushes section, Brush first', () => {
    const shapes = groups.find((g) => g.id === 'shapes')!;
    expect(shapes.sections.map((s) => s.title)).toEqual(['Brushes', 'Shapes']);
    expect(shapes.entries.slice(0, 2).map((e) => e.key)).toEqual(['brush', 'highlighter']);
  });

  it('holds Cross, Dot, Arrow and Eraser in the cursors family', () => {
    expect(groups[0].entries.map((e) => e.label)).toEqual(['Cross', 'Dot', 'Arrow', 'Eraser']);
    expect(groups[0].entries.at(-1)?.toolId).toBe(ERASER);
    expect(groups[0].entries.filter((e) => e.toolId === CURSOR)).toHaveLength(3);
  });

  it('keeps registry order within a family and groups it under section headings', () => {
    const lines = groups.find((g) => g.id === 'lines')!;
    expect(lines.entries.map((e) => e.key)).toEqual(['trendLine', 'ray', 'infoLine', 'extendedLine', 'trendAngle', 'horizontalLine', 'horizontalRay', 'verticalLine', 'crossLine', 'parallelChannel', 'regressionTrend', 'flatTopBottom', 'disjointChannel', 'pitchfork', 'schiffPitchfork', 'modifiedSchiffPitchfork', 'insidePitchfork']);
    expect(lines.sections.map((s) => s.title)).toEqual(['Lines', 'Channels', 'Pitchforks']);
  });

  it('shows a family by its last tool, else its first', () => {
    const lines = groups.find((g) => g.id === 'lines')!;
    expect(groupEntry(lines, {}).key).toBe('trendLine');
    expect(groupEntry(lines, { lines: 'ray' }).key).toBe('ray');
    expect(groupEntry(lines, { lines: 'rectangle' }).key).toBe('trendLine');
  });

  it('presses a family while the current tool is in it, and a cursor kind only for the current kind', () => {
    const [cursors, lines] = groups;
    expect(groupPressed(cursors, CURSOR)).toBe(true);
    expect(groupPressed(cursors, ERASER)).toBe(true);
    expect(groupPressed(lines, 'ray')).toBe(true);
    expect(groupPressed(lines, CURSOR)).toBe(false);
    const dot = cursors.entries[1];
    expect(entryPressed(dot, CURSOR, 'dot')).toBe(true);
    expect(entryPressed(dot, CURSOR, 'cross')).toBe(false);
    expect(entryPressed(cursors.entries[3], ERASER, 'dot')).toBe(true);
  });
});

describe('flyoutStep', () => {
  it('moves and wraps', () => {
    expect(flyoutStep(0, 4, 'ArrowDown')).toBe(1);
    expect(flyoutStep(3, 4, 'ArrowDown')).toBe(0);
    expect(flyoutStep(0, 4, 'ArrowUp')).toBe(3);
    expect(flyoutStep(2, 4, 'ArrowUp')).toBe(1);
    expect(flyoutStep(2, 4, 'Home')).toBe(0);
    expect(flyoutStep(1, 4, 'End')).toBe(3);
    expect(flyoutStep(1, 4, 'a')).toBeNull();
    expect(flyoutStep(0, 0, 'ArrowDown')).toBeNull();
  });
});

describe('sanitizers', () => {
  it('drops unknown and duplicate favourites', () => {
    expect(sanitizeFavorites(['ray', 'nope', 'ray', 3, 'eraser', 'trendLine'])).toEqual(['ray', 'eraser', 'trendLine']);
    expect(sanitizeFavorites('ray')).toEqual([]);
    expect(sanitizeFavorites(undefined)).toEqual([]);
  });
  it('drops a last tool that is not in its family', () => {
    expect(sanitizeLastTool({ lines: 'ray', shapes: 'ray', bogus: 'ray', cursors: 'eraser' })).toEqual({ lines: 'ray', cursors: 'eraser' });
    expect(sanitizeLastTool(null)).toEqual({});
    expect(sanitizeLastTool([1])).toEqual({});
  });
  it('falls back to cross for a bad cursor kind', () => {
    expect(sanitizeCursorKind('dot')).toBe('dot');
    expect(sanitizeCursorKind('arrow')).toBe('arrow');
    expect(sanitizeCursorKind('star')).toBe('cross');
    expect(sanitizeCursorKind(undefined)).toBe('cross');
  });
  it('falls back for a bad bar position', () => {
    expect(sanitizeBarPos({ x: 10, y: 20 })).toEqual({ x: 10, y: 20 });
    const d = sanitizeBarPos(undefined);
    expect(sanitizeBarPos({ x: 'a', y: 1 })).toEqual(d);
    expect(sanitizeBarPos({ x: NaN, y: 1 })).toEqual(d);
    expect(sanitizeBarPos({ x: -4, y: 1 })).toEqual(d);
  });
  it('clamps the bar inside the area', () => {
    const size = { w: 100, h: 30 };
    const area = { w: 400, h: 300 };
    expect(clampBarPos({ x: 999, y: 999 }, size, area)).toEqual({ x: 300, y: 270 });
    expect(clampBarPos({ x: -5, y: -5 }, size, area)).toEqual({ x: 0, y: 0 });
    expect(clampBarPos({ x: 10, y: 10 }, size, { w: 50, h: 10 })).toEqual({ x: 0, y: 0 });
  });
});
