import { describe, expect, it } from 'vitest';
import { drawingsOfPane, mapDrawings } from './drawingObjects';

const times = [1000, 2000, 3000, 4000];
const plot = (value: unknown[], overlay = true) => ({ options: { overlay }, data: [{ time: 0, value }] });
const line = (o: Record<string, unknown> = {}) => ({
  id: 1, x1: 0, y1: 10, x2: 2, y2: 12, xloc: 'bi', extend: 'none', color: '#FF0000', style: 'style_solid', width: 1, _deleted: false, ...o,
});

describe('mapDrawings', () => {
  it('gives nothing for a script without drawing keys', () => {
    expect(mapDrawings({ Plot: { options: {}, data: [] }, __labels__: plot([]) }, times)).toBeUndefined();
  });

  it('drops a deleted object', () => {
    const d = mapDrawings({ __lines__: plot([line({ id: 1 }), line({ id: 2, _deleted: true })]) }, times)!;
    expect(d.lines).toHaveLength(1);
  });

  it('drops a linefill whose line is not among the final lines', () => {
    const l1 = line({ id: 1 });
    const l2 = line({ id: 2 });
    const gone = line({ id: 3 });
    const d = mapDrawings(
      {
        __lines__: plot([l1, l2]),
        __linefills__: plot([
          { line1: l1, line2: l2, color: '#00FF0033', _deleted: false },
          { line1: l1, line2: gone, color: '#00FF0033', _deleted: false },
        ]),
      },
      times,
    )!;
    expect(d.linefills).toHaveLength(1);
    expect(d.linefills[0].line2.price1).toBe(10);
  });

  it('keeps a null colour as na and turns the empty string into the default', () => {
    const d = mapDrawings({ __lines__: plot([line({ id: 1, color: null }), line({ id: 2, color: '' }), line({ id: 3, color: '#11223344' })]) }, times)!;
    expect(d.lines.map((l) => l.color)).toEqual([null, '#2962FF', '#11223344']);
  });

  it('places bar indices on bar times and indices past either end beyond the data', () => {
    const d = mapDrawings({ __lines__: plot([line({ x1: -2, x2: 5 }), line({ x1: 1, x2: 3 })]) }, times)!;
    expect([d.lines[0].time1, d.lines[0].time2]).toEqual([-1000, 6000]);
    expect([d.lines[1].time1, d.lines[1].time2]).toEqual([2000, 4000]);
  });

  it('turns bar_time milliseconds into seconds', () => {
    const d = mapDrawings({ __lines__: plot([line({ xloc: 'bt', x1: 1500000, x2: 2500000 })]) }, times)!;
    expect([d.lines[0].time1, d.lines[0].time2]).toEqual([1500, 2500]);
  });

  it('maps styles, arrows and extend', () => {
    const d = mapDrawings(
      {
        __lines__: plot([
          line({ style: 'style_dashed', extend: 'l' }),
          line({ style: 'style_dotted', extend: 'r' }),
          line({ style: 'style_arrow_left', extend: 'b' }),
          line({ style: 'style_arrow_right' }),
          line({ style: 'style_arrow_both' }),
        ]),
      },
      times,
    )!;
    expect(d.lines.map((l) => [l.style, l.arrows, l.extend])).toEqual([
      ['dashed', 'none', 'l'],
      ['dotted', 'none', 'r'],
      ['solid', 'left', 'b'],
      ['solid', 'right', 'none'],
      ['solid', 'both', 'none'],
    ]);
  });

  it('skips a polyline point without the coordinate its xloc needs', () => {
    const d = mapDrawings(
      {
        __polylines__: plot([
          { xloc: 'bi', points: [{ index: 0, price: 1 }, { time: 5, price: 2 }, { index: 2, price: 3 }], line_color: '#000000', fill_color: '', curved: false, closed: false },
          { xloc: 'bt', points: [{ index: 0, price: 1 }, { time: 2000000, price: 2 }], line_color: '#000000', fill_color: '#11111111', curved: true, closed: true },
        ]),
      },
      times,
    )!;
    expect(d.polylines[0].points).toEqual([{ time: 1000, price: 1 }, { time: 3000, price: 3 }]);
    expect(d.polylines[0].fillColor).toBeNull();
    expect(d.polylines[1].points).toEqual([{ time: 2000, price: 2 }]);
  });

  it('maps box text sizes and options', () => {
    const box = (text_size: unknown) => ({ left: 0, top: 2, right: 1, bottom: 1, xloc: 'bi', text: 'a', text_size, text_halign: 'right', text_valign: 'bottom', text_wrap: 'auto' });
    const d = mapDrawings({ __boxes__: plot(['tiny', 'small', 'auto', 'normal', 'large', 'huge', 30].map(box)) }, times)!;
    expect(d.boxes.map((b) => b.textSize)).toEqual([8, 10, 12, 12, 16, 22, 30]);
    expect(d.boxes[0]).toMatchObject({ halign: 'right', valign: 'bottom', wrap: true });
  });

  it('puts the overlay key in the price pane and the plain key of a separate-pane script in its pane', () => {
    const d = mapDrawings({ __lines__: plot([line()], false), __lines_overlay__: plot([line()], true) }, times)!;
    expect(d.lines.map((l) => l.pane)).toEqual(['separate', 'price']);
    expect(drawingsOfPane(d, 'price')!.lines).toHaveLength(1);
    expect(drawingsOfPane(d, 'separate')!.lines).toHaveLength(1);
    expect(drawingsOfPane({ ...d, lines: d.lines.slice(0, 1) }, 'price')).toBeNull();
  });
});
