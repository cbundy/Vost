import type { Tool } from './brush';

interface Props {
  tool: Tool | null;
  canUndo: boolean;
  canRedo: boolean;
  hasTrades: boolean;
  onTool: (t: Tool | null) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
}

const isBrush = (t: Tool | null, side: 'long' | 'short') => t?.kind === 'brush' && t.side === side;

export function BrushToolbar({ tool, canUndo, canRedo, hasTrades, onTool, onUndo, onRedo, onClear }: Props) {
  const toggle = (next: Tool, on: boolean) => onTool(on ? null : next);
  return (
    <div className="sm-toolbar" role="toolbar" aria-label="Marking tools">
      <button type="button" className="sm-long" aria-pressed={isBrush(tool, 'long')} onClick={() => toggle({ kind: 'brush', side: 'long' }, isBrush(tool, 'long'))} title="Paint a long trade (B)">
        Brush long
      </button>
      <button type="button" className="sm-short" aria-pressed={isBrush(tool, 'short')} onClick={() => toggle({ kind: 'brush', side: 'short' }, isBrush(tool, 'short'))} title="Paint a short trade (B)">
        Brush short
      </button>
      <button type="button" aria-pressed={tool?.kind === 'eraser'} onClick={() => toggle({ kind: 'eraser' }, tool?.kind === 'eraser')} title="Erase trades (E)">
        Eraser
      </button>
      <button type="button" onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">
        Undo
      </button>
      <button type="button" onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
        Redo
      </button>
      <button type="button" onClick={onClear} disabled={!hasTrades} title="Remove every trade of this chart">
        Clear
      </button>
    </div>
  );
}
