import { describe, expect, it } from 'vitest';
import { isTextInput, joinColor, layoutInputs, splitColor, timeframeOptions, timeToUtcText, utcTextToTime } from './inputs';
import type { PineInput } from './types';

const inp = (name: string, extra: Partial<PineInput> = {}): PineInput => ({ name, type: 'int', defval: 1, ...extra });
const names = (s: ReturnType<typeof layoutInputs>) => s.map((x) => [x.group, x.rows.map((r) => r.inputs.map((i) => i.name))]);

describe('layoutInputs', () => {
  it('puts ungrouped inputs first, then each group in the order it is first seen', () => {
    const out = layoutInputs([inp('a', { group: 'G2' }), inp('b'), inp('c', { group: 'G1' }), inp('d', { group: 'G2' }), inp('e')]);
    expect(names(out)).toEqual([
      [null, [['b'], ['e']]],
      ['G2', [['a'], ['d']]],
      ['G1', [['c']]],
    ]);
  });

  it('joins consecutive inputs of one group that share an inline value into a row', () => {
    const out = layoutInputs([
      inp('a', { group: 'G', inline: 'x' }),
      inp('b', { group: 'G', inline: 'x' }),
      inp('c', { group: 'G', inline: 'y' }),
      inp('d', { group: 'G', inline: 'x' }),
      inp('e', { group: 'G' }),
      inp('f', { group: 'G' }),
    ]);
    expect(names(out)).toEqual([['G', [['a', 'b'], ['c'], ['d'], ['e'], ['f']]]]);
  });

  it('never joins an inline row across groups', () => {
    const out = layoutInputs([inp('a', { group: 'G', inline: 'x' }), inp('b', { group: 'H', inline: 'x' }), inp('c', { group: 'G', inline: 'x' })]);
    expect(names(out)).toEqual([['G', [['a', 'c']]], ['H', [['b']]]]);
  });

  it('inline rows work among ungrouped inputs and an empty list gives no sections', () => {
    expect(names(layoutInputs([inp('a', { inline: 'x' }), inp('b', { inline: 'x' })]))).toEqual([[null, [['a', 'b']]]]);
    expect(layoutInputs([])).toEqual([]);
  });
});

describe('color', () => {
  it('splits and joins 8-digit values', () => {
    expect(splitColor('#2962FF80')).toEqual({ hex: '#2962ff', alpha: 128 });
    expect(joinColor('#2962ff', 128)).toBe('#2962FF80');
    expect(joinColor(splitColor('#F23645FF').hex, splitColor('#F23645FF').alpha)).toBe('#F23645FF');
  });

  it('counts a 6-digit value as opaque', () => {
    expect(splitColor('#00ff00')).toEqual({ hex: '#00ff00', alpha: 255 });
    expect(joinColor('#00ff00', 255)).toBe('#00FF00FF');
  });

  it('clamps the alpha and survives junk', () => {
    expect(joinColor('#000000', 999)).toBe('#000000FF');
    expect(joinColor('#000000', -5)).toBe('#00000000');
    expect(splitColor('red')).toEqual({ hex: '#000000', alpha: 255 });
  });
});

describe('time', () => {
  it('round-trips a UTC date-time', () => {
    expect(timeToUtcText(1704067200000)).toBe('2024-01-01T00:00');
    expect(utcTextToTime('2024-01-01T00:00')).toBe(1704067200000);
    expect(utcTextToTime(timeToUtcText(1718454300000))).toBe(1718454300000);
    expect(utcTextToTime('2024-01-01T13:45')).toBe(Date.UTC(2024, 0, 1, 13, 45));
  });

  it('rejects text that is not a date', () => {
    expect(utcTextToTime('')).toBeNull();
    expect(utcTextToTime('2024-13-45T00:00')).toBeNull();
    expect(timeToUtcText(Number.NaN)).toBe('');
  });
});

describe('timeframeOptions', () => {
  it('lists Chart then the picker intervals as Pine timeframes', () => {
    expect(timeframeOptions(['15m', '4h', '1d', '1w'], '')).toEqual([
      { value: '', label: 'Chart' },
      { value: '15', label: '15m' },
      { value: '240', label: '4h' },
      { value: 'D', label: '1d' },
      { value: 'W', label: '1w' },
    ]);
  });

  it('adds a current value that is not in the list as itself', () => {
    const out = timeframeOptions(['1h'], '45');
    expect(out[out.length - 1]).toEqual({ value: '45', label: '45' });
    expect(timeframeOptions(['1h'], '60').filter((o) => o.value === '60')).toHaveLength(1);
  });
});

describe('isTextInput', () => {
  it('is true for text types and string options, false for numbers', () => {
    expect(isTextInput(inp('a', { type: 'color', defval: '#fff' }))).toBe(true);
    expect(isTextInput(inp('a', { type: 'string', defval: 'x' }))).toBe(true);
    expect(isTextInput(inp('a', { type: 'enum', defval: 'a', options: ['a', 'b'] }))).toBe(true);
    expect(isTextInput(inp('a', { type: 'int', defval: 1, options: [1, 2] }))).toBe(false);
    for (const type of ['int', 'float', 'bool', 'time', 'price']) expect(isTextInput(inp('a', { type, defval: 1 }))).toBe(false);
  });
});
