import { describe, expect, it } from 'vitest';
import { pineIndicatorName, pineSourceTitle } from './title';
import { DEFAULT_PINE_SOURCE } from '../indicatorCompute';

describe('pineSourceTitle', () => {
  it('reads positional and title= strings', () => {
    expect(pineSourceTitle('indicator("My Ind", overlay=true)')).toBe('My Ind');
    expect(pineSourceTitle("strategy(title='Strat X')")).toBe('Strat X');
  });
  it('skips a version line and whitespace', () => {
    expect(pineSourceTitle('//@version=6\n  indicator( "  Spaced " )')).toBe('Spaced');
  });
  it('returns empty when there is none', () => {
    expect(pineSourceTitle('indicator("  ")')).toBe('');
    expect(pineSourceTitle('plot(close)')).toBe('');
    expect(pineSourceTitle('indicator(t)')).toBe('');
  });
});

describe('pineIndicatorName', () => {
  it('prefers the source title over a stale run title', () => {
    expect(pineIndicatorName('indicator("New")', 'Old')).toBe('New');
  });
  it('uses the run title when the source has none parseable', () => {
    expect(pineIndicatorName('indicator(t)', 'From run')).toBe('From run');
  });
  it('falls back to the kind name', () => {
    expect(pineIndicatorName('indicator(t)')).toBe('Pine indicator');
    expect(pineIndicatorName('', '  ')).toBe('Pine indicator');
  });
  it('names the default script', () => {
    expect(pineIndicatorName(DEFAULT_PINE_SOURCE)).toBe('EMA cross');
  });
});
