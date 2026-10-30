import { resolveStyle } from '../../lib/drawingStyle';
import type { Anchor, Drawing } from '../../lib/drawings';
import { getTool } from './tools';

/** What the note editor is open on: a new note of a tool (id null) or an existing one, with the style it is typed in. */
export type EditorTarget = {
  id: string | null;
  /** The tool the note belongs to; a new note is written as this tool. */
  tool: string;
  /** The anchors the note is placed at: one, or two for Callout. */
  anchors: Anchor[];
  text: string;
  /** The tool's resolved style values (font, size, alignment, wrap) the text is typed in. */
  style: Readonly<Record<string, unknown>>;
  key: number;
  /** Set when a cell of the existing table `id` is being typed in. */
  cell?: { row: number; col: number };
};

/** The style a note is typed in: its own values, else the user's default for the tool, else the tool's. */
export function editorStyle(
  tool: string,
  own: Drawing['style'] | undefined,
  defaults: Readonly<Record<string, Record<string, unknown>>>,
): Readonly<Record<string, unknown>> {
  const userDefault = Object.prototype.hasOwnProperty.call(defaults, tool) ? defaults[tool] : undefined;
  return resolveStyle(getTool(tool)?.settings ?? [], own, userDefault).values;
}

/** Whether a tool is one the note editor opens for. */
export const isTextTool = (tool: string | undefined): boolean => getTool(tool ?? '')?.text === true;
