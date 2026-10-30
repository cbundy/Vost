import { describe, expect, it } from 'vitest';
import { drawingPriceRange, drawingsOfPane, mapDrawings, PINE_LABEL_COLOR, PINE_LABEL_TEXT_COLOR } from './drawingObjects';

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

const bars = [{ high: 11, low: 9 }, { high: 12, low: 10 }, { high: 13, low: 11 }, { high: 14, low: 12 }];
const lbl = (o: Record<string, unknown> = {}) => ({
  id: 1, x: 1, y: 5, text: 'Hi', xloc: 'bi', yloc: 'pr', color: '#FF0000', style: 'style_label_down', textcolor: '#FFFFFF', size: 'normal',
  textalign: 'center', tooltip: '', text_font_family: 'default', text_formatting: 'none', force_overlay: false, _deleted: false, ...o,
});
const tbl = (o: Record<string, unknown> = {}) => ({
  id: 0, position: 'top_right', columns: 2, rows: 1, bgcolor: '#11223344', frame_color: '', frame_width: 0, border_color: '#FFFFFF', border_width: 1,
  force_overlay: false, _deleted: false, cells: [[null, { text: 'a', text_color: '#000000', bgcolor: '', text_size: 'small', text_halign: 'left', text_valign: 'top', width: 20, height: 0, tooltip: 't', text_font_family: 'monospace', text_formatting: 'bold_italic', _merged: false, _merge_parent: null }]],
  merges: [{ startCol: 0, startRow: 0, endCol: 1, endRow: 0 }], ...o,
});

describe('mapDrawings labels', () => {
  it('places a bar_time label in seconds and a bar-index label on its bar, past the data too', () => {
    const d = mapDrawings({ __labels__: plot([lbl({ xloc: 'bt', x: 2500000 }), lbl({ x: 2 }), lbl({ x: 6 })]) }, times, bars)!;
    expect(d.labels.map((l) => l.time)).toEqual([2500, 3000, 7000]);
  });

  it('takes the bar high or low for abovebar and belowbar, and its own price past the data', () => {
    const d = mapDrawings(
      { __labels__: plot([lbl({ yloc: 'ab', x: 1 }), lbl({ yloc: 'bl', x: 1 }), lbl({ yloc: 'pr', x: 1 }), lbl({ yloc: 'ab', x: 9, y: 77 }), lbl({ yloc: 'bl', xloc: 'bt', x: 3000000 })]) },
      times,
      bars,
    )!;
    expect(d.labels.map((l) => [l.yloc, l.price])).toEqual([['abovebar', 12], ['belowbar', 10], ['price', 5], ['abovebar', 77], ['belowbar', 11]]);
    const noBars = mapDrawings({ __labels__: plot([lbl({ yloc: 'ab', x: 1 })]) }, times)!;
    expect(noBars.labels[0].price).toBe(5);
  });

  it('turns empty colours into the Pine defaults, keeps na, and reads sizes, alignment and font', () => {
    const d = mapDrawings(
      { __labels__: plot([lbl({ color: '', textcolor: '' }), lbl({ color: null, textcolor: null, size: 'large', textalign: 'left', text_formatting: 'bold_italic', text_font_family: 'monospace', tooltip: 'tip', style: 'style_circle' })]) },
      times,
    )!;
    expect([d.labels[0].color, d.labels[0].textColor]).toEqual([PINE_LABEL_COLOR, PINE_LABEL_TEXT_COLOR]);
    expect([PINE_LABEL_COLOR, PINE_LABEL_TEXT_COLOR]).toEqual(['#2962FF', '#FFFFFF']);
    expect(d.labels[1]).toMatchObject({ color: null, textColor: null, textSize: 16, textAlign: 'left', bold: true, italic: true, monospace: true, tooltip: 'tip', style: 'circle' });
  });

  it('drops a deleted label and puts an overlay-key label in the price pane', () => {
    const d = mapDrawings({ __labels__: plot([lbl(), lbl({ _deleted: true })], false), __labels_overlay__: plot([lbl()], true) }, times)!;
    expect(d.labels.map((l) => l.pane)).toEqual(['separate', 'price']);
  });
});

describe('mapDrawings tables', () => {
  it('maps cells (null stays null, bgcolor empty is transparent), merges and the table colours', () => {
    const d = mapDrawings({ __tables__: plot([tbl()]) }, times)!;
    const t = d.tables[0];
    expect(t).toMatchObject({ position: 'top_right', columns: 2, rows: 1, bgColor: '#11223344', frameColor: null, borderColor: '#FFFFFF', borderWidth: 1 });
    expect(t.cells[0][0]).toBeNull();
    expect(t.cells[0][1]).toEqual({
      text: 'a', textColor: '#000000', bgColor: null, textSize: 10, halign: 'left', valign: 'top', widthPct: 20, heightPct: 0, tooltip: 't',
      bold: true, italic: true, monospace: true, hidden: false,
    });
    expect(t.merges).toEqual([{ startCol: 0, startRow: 0, endCol: 1, endRow: 0 }]);
  });

  it('marks a merged-away cell hidden', () => {
    const t = tbl({ cells: [[{ text: '', _merged: true }]] });
    expect(mapDrawings({ __tables__: plot([t]) }, times)!.tables[0].cells[0][0]!.hidden).toBe(true);
  });

  it('puts a table in the price pane when force_overlay, else in the script pane by its key or declaration', () => {
    const d = mapDrawings({ __tables__: plot([tbl({ force_overlay: true }), tbl()], false) }, times)!;
    expect(d.tables.map((t) => t.pane)).toEqual(['price', 'separate']);
    // PineTS files every table under the overlay key: the script's own overlay then decides
    const e = mapDrawings({ __tables__: plot([tbl()], true) }, times, [], false)!;
    expect(e.tables[0].pane).toBe('separate');
    expect(mapDrawings({ __tables__: plot([tbl()], true) }, times, [], true)!.tables[0].pane).toBe('price');
  });

  it('gives drawings for a script with only a table, or only labels, and drops a deleted table', () => {
    expect(mapDrawings({ __tables__: plot([tbl()]) }, times)).toBeDefined();
    expect(mapDrawings({ __labels__: plot([lbl()]) }, times)).toBeDefined();
    expect(mapDrawings({ __tables__: plot([tbl({ _deleted: true })]) }, times)).toBeUndefined();
  });
});

describe('labels and tables by pane and price range', () => {
  it('splits labels and tables by pane and counts a pane holding only a table', () => {
    const d = mapDrawings({ __labels__: plot([lbl()], false), __tables__: plot([tbl({ force_overlay: true })], false) }, times)!;
    expect(drawingsOfPane(d, 'separate')).toMatchObject({ labels: [{ text: 'Hi' }], tables: [] });
    expect(drawingsOfPane(d, 'price')).toMatchObject({ labels: [], tables: [{ position: 'top_right' }] });
  });

  it('scales a pane to its label prices and ignores tables', () => {
    const d = mapDrawings({ __labels__: plot([lbl({ y: 3 }), lbl({ y: 8 })]), __tables__: plot([tbl()]) }, times)!;
    expect(drawingPriceRange(d)).toEqual({ min: 3, max: 8 });
    expect(drawingPriceRange({ ...d, labels: [] })).toBeNull();
  });
});
