import { describe, expect, it } from 'vitest';
import { railClick, railPressed } from './sideRail';

describe('railClick', () => {
  it('panel: the active open section collapses the panel', () => {
    expect(railClick('panel', { active: 'watchlist', collapsed: false }, 'watchlist')).toEqual({ section: 'watchlist', collapsed: true });
  });
  it('panel: another section switches and opens the panel', () => {
    expect(railClick('panel', { active: 'watchlist', collapsed: false }, 'data')).toEqual({ section: 'data', collapsed: false });
  });
  it('panel: a click while collapsed opens the panel, even on the stored section', () => {
    expect(railClick('panel', { active: 'watchlist', collapsed: true }, 'watchlist')).toEqual({ section: 'watchlist', collapsed: false });
    expect(railClick('panel', { active: 'watchlist', collapsed: true }, 'indicators')).toEqual({ section: 'indicators', collapsed: false });
  });
  it('drawer: always opens the drawer on that section and never sets collapsed', () => {
    for (const collapsed of [true, false]) {
      for (const id of ['watchlist', 'data', 'indicators', 'objects']) {
        const r = railClick('drawer', { active: 'watchlist', collapsed }, id);
        expect(r).toEqual({ section: id, openDrawer: true });
        expect('collapsed' in r).toBe(false);
      }
    }
  });
});

describe('railPressed', () => {
  it('panel: pressed only for the active section of an open panel', () => {
    expect(railPressed('panel', { active: 'data', collapsed: false }, 'data')).toBe(true);
    expect(railPressed('panel', { active: 'data', collapsed: false }, 'watchlist')).toBe(false);
    expect(railPressed('panel', { active: 'data', collapsed: true }, 'data')).toBe(false);
  });
  it('drawer: false while the drawer is closed', () => {
    expect(railPressed('drawer', { active: 'data', collapsed: false, drawerOpen: false }, 'data')).toBe(false);
  });
});
