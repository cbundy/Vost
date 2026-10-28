import { CURSOR } from './chart/useDrawings';
import { TOOLS } from './chart/tools';
import { DRAWING_ICONS } from './DrawingIcons';

const ENTRIES = [{ id: CURSOR, label: 'Cursor' }, ...TOOLS.map((t) => ({ id: t.id, label: t.label }))];

/** The vertical tool rail at the chart's left edge: Cursor plus one button per drawing tool. */
export function DrawingRail({ tool, onPick, disabled }: { tool: string; onPick: (id: string) => void; disabled: boolean }) {
  return (
    <div className="drawing-rail" role="toolbar" aria-label="Drawing tools" aria-orientation="vertical">
      {ENTRIES.map((t) => {
        const pressed = tool === t.id;
        return (
          <button
            key={t.id}
            type="button"
            className={`ghost icon rail-btn${pressed ? ' active' : ''}`}
            title={t.label}
            aria-label={t.label}
            aria-pressed={pressed}
            disabled={disabled && t.id !== CURSOR}
            onClick={() => onPick(t.id)}
          >
            {DRAWING_ICONS[t.id]}
          </button>
        );
      })}
    </div>
  );
}
