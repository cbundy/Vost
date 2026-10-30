import { HIT_TOLERANCE, pointInRect, type Pt } from '../../../lib/drawingGeometry';
import { cssColor } from '../../../lib/drawingStyle';
import { TABLE_DEFAULT_COLS, TABLE_DEFAULT_ROWS, emptyCells, tableLayout, tableOrigin, validateCells, type TableLayout } from '../../../lib/geometry/table';
import { noteFont } from '../../../lib/textLayout';
import { theme } from '../../../lib/theme';
import { Svg } from '../../DrawingIcons';
import { boolField, colorField, numberField, opacityField } from './fields';
import { boxOpts, measureWidth, textSettings } from './textBox';
import type { DrawingTool, ToolView } from './types';

/** Setting keys of the table that are not text ones. */
const OWN_KEYS = new Set(['backgroundColor', 'backgroundOpacity', 'borderColor']);

/** The text settings of a text box (wrap off) with the table's look: dark cells, a light grey grid, a header row. */
const SETTINGS = [
  ...textSettings(12, false)
    .filter((f) => !OWN_KEYS.has(f.key)),
  colorField('borderColor', 'Border colour', 'muted'),
  numberField('borderWidth', 'Border width', 1, 0, 5, 1),
  colorField('backgroundColor', 'Cell background', 'panel2'),
  opacityField('backgroundOpacity', 'Cell background opacity', 1),
  boolField('header', 'Header row', false),
  colorField('headerColor', 'Header background', 'panel3'),
];

/** The cells a view draws: a table stored without cells is the default empty one. */
export const cellsOf = (cells: readonly (readonly string[])[]): string[][] => (cells.length ? cells.map((r) => [...r]) : emptyCells(TABLE_DEFAULT_ROWS, TABLE_DEFAULT_COLS));

/** The layout of a table's cells in a style, measured on the canvas. */
export function layoutTable(cells: readonly (readonly string[])[], style: Readonly<Record<string, unknown>>): TableLayout {
  const opts = boxOpts(style);
  return tableLayout(cellsOf(cells), opts, style.header === true, (s, bold) => measureWidth(s, { ...opts, bold }));
}

/** Where the table's top-left is drawn: its anchor's pixel kept inside the pane. */
export function originOf(p: Pt, layout: TableLayout, view: Pick<ToolView, 'width' | 'height'>): Pt {
  return tableOrigin(p, layout, view);
}

export const table: DrawingTool = {
  id: 'table',
  label: 'Table',
  group: 'annotations',
  section: 'Text',
  icon: (
    <Svg>
      <path d="M5 6h14v12H5zM5 10h14M5 14h14M10 6v12M15 6v12" />
    </Svg>
  ),
  anchors: 1,
  cells: true,
  hoverPreview: true,
  settings: SETTINGS,
  validate(d) {
    if (d.cells === undefined) return d;
    const cells = validateCells(d.cells);
    return cells ? { ...d, cells } : null;
  },
  draw(ctx, [p], view, { selected }) {
    const layout = layoutTable(view.cells, view.style);
    const o = originOf(p, layout, view);
    const header = view.style.header === true;
    const opts = boxOpts(view.style);
    const bw = view.style.borderWidth as number;
    const cells = cellsOf(view.cells);
    cells.forEach((row, i) => {
      row.forEach((_, j) => {
        const x = o.x + layout.colX[j];
        const y = o.y + layout.rowY[i];
        const w = layout.colWidths[j];
        const h = layout.rowHeights[i];
        const fill = header && i === 0 ? view.style.headerColor : view.style.backgroundColor;
        ctx.fillStyle = cssColor(fill, view.style.backgroundOpacity as number);
        ctx.fillRect(x, y, w, h);
        if (bw > 0) {
          ctx.lineWidth = bw;
          ctx.strokeStyle = cssColor(view.style.borderColor);
          ctx.strokeRect(x, y, w, h);
        }
        const cell = layout.cells[i][j];
        ctx.font = noteFont({ ...opts, bold: opts.bold || (header && i === 0) });
        ctx.fillStyle = cssColor(view.style.color);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        cell.lines.forEach((l, k) => ctx.fillText(l, x + cell.offsets[k], y + opts.pad + layout.lineHeight * k + layout.lineHeight / 2));
      });
    });
    if (selected) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = !view.styled ? theme.accent2 : cssColor(view.style.borderColor);
      ctx.strokeRect(o.x, o.y, layout.width, layout.height);
    }
  },
  hit([p], at, view, tolerance = HIT_TOLERANCE) {
    const layout = layoutTable(view.cells, view.style);
    const o = originOf(p, layout, view);
    return pointInRect(at, o, { x: o.x + layout.width, y: o.y + layout.height }, tolerance);
  },
  handles: ([p], view) => [originOf(p, layoutTable(view.cells, view.style), view)],
};
