import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types';
import type { PineRunState } from '../../state/chart';
import { mergeBarColors, sameBarColors } from './barColors';
import type { PineResult } from './types';

const candles: Candle[] = [1, 2, 3].map((t) => ({ time: t * 60, open: 1, high: 2, low: 0, close: 1, volume: 1 }));

function run(colors: (string | null)[]): PineRunState {
  const result: PineResult = {
    ok: true, kind: 'indicator', declaration: { title: 't', overlay: true }, inputs: [], trades: [], position: [],
    plots: [{ name: 'bc', kind: 'barcolor', values: colors.map((c) => (c ? 1 : null)), colors, color: null, style: 'barcolor', pane: 'price' }],
  };
  return { running: false, result, candles };
}
const spec = (id: string, visible = true) => ({ id, kind: 'pine', visible, color: '#fff' });

describe('mergeBarColors', () => {
  it('the later script wins on shared bars', () => {
    const m = mergeBarColors(
      [spec('a'), spec('b')],
      { a: run(['red', 'red', null]), b: run([null, 'blue', 'blue']) },
      null,
    );
    expect([...m]).toEqual([[60, 'red'], [120, 'blue'], [180, 'blue']]);
  });

  it('a hidden script or one not fitting the replay cutoff contributes nothing', () => {
    const runs = { a: run(['red', 'red', 'red']) };
    expect(mergeBarColors([spec('a', false)], runs, null).size).toBe(0);
    expect(mergeBarColors([spec('a')], runs, 120).size).toBe(0);
    expect(mergeBarColors([spec('a')], runs, 180).size).toBe(3);
  });

  it('empty input gives an empty map', () => {
    expect(mergeBarColors([], {}, null).size).toBe(0);
    expect(mergeBarColors([spec('a')], {}, null).size).toBe(0);
  });

  it('sameBarColors compares content', () => {
    expect(sameBarColors(new Map([[1, 'a']]), new Map([[1, 'a']]))).toBe(true);
    expect(sameBarColors(new Map([[1, 'a']]), new Map([[1, 'b']]))).toBe(false);
    expect(sameBarColors(new Map(), new Map([[1, 'b']]))).toBe(false);
  });
});
