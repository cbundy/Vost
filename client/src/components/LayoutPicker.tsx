import { useEffect, useRef, useState } from 'react';
import { ARRANGEMENTS, DEFAULT_ARRANGEMENT_ID, LAYOUT_COUNTS, arrangementsWithCount, getArrangement, type Arrangement } from '../lib/layouts';
import { useTopKeydown } from '../lib/useDialogKeys';
import { useStore } from '../state/store';

const W = 24;
const H = 18;
const PAD = 1.5;

/** An arrangement drawn from its cell data: a rounded frame and the edges shared by two cells. */
export function ArrangementIcon({ arrangement: a }: { arrangement: Arrangement }) {
  const x = (col: number) => PAD + (col / a.cols) * (W - 2 * PAD);
  const y = (row: number) => PAD + (row / a.rows) * (H - 2 * PAD);
  const edges: Array<[number, number, number, number]> = [];
  for (const c of a.cells) {
    if (c.col + c.colSpan < a.cols) edges.push([x(c.col + c.colSpan), y(c.row), x(c.col + c.colSpan), y(c.row + c.rowSpan)]);
    if (c.row + c.rowSpan < a.rows) edges.push([x(c.col), y(c.row + c.rowSpan), x(c.col + c.colSpan), y(c.row + c.rowSpan)]);
  }
  return (
    <svg className="layout-icon" width={W} height={H} viewBox={`0 0 ${W} ${H}`} fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true" focusable="false">
      <rect x={PAD} y={PAD} width={W - 2 * PAD} height={H - 2 * PAD} rx="2.5" />
      {edges.map((e, i) => (
        <line key={i} x1={e[0]} y1={e[1]} x2={e[2]} y2={e[3]} />
      ))}
    </svg>
  );
}

/** The top bar's "Select layout" button and its menu of the arrangements, grouped by chart count. */
export function LayoutPicker() {
  const arrangementId = useStore((s) => s.arrangementId);
  const setArrangement = useStore((s) => s.setArrangement);
  const current = getArrangement(arrangementId) ?? getArrangement(DEFAULT_ARRANGEMENT_ID) ?? ARRANGEMENTS[0];
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (ev: MouseEvent) => {
      if (!wrapRef.current?.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useTopKeydown(open, (ev) => {
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    setOpen(false);
    btnRef.current?.focus();
  });

  return (
    <div className="layout-picker" ref={wrapRef}>
      <button
        ref={btnRef}
        className="ghost icon layout-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Select layout"
        title="Select layout"
        onClick={() => setOpen((v) => !v)}
      >
        <ArrangementIcon arrangement={current} />
      </button>
      {open && (
        <div className="layout-menu" role="dialog" aria-label="Select layout">
          {LAYOUT_COUNTS.map((n) => (
            <div className="layout-row" key={n}>
              <span className="layout-count">{n}</span>
              <div className="layout-options">
                {arrangementsWithCount(n).map((a) => (
                  <button
                    key={a.id}
                    className={`layout-option${a.id === current.id ? ' selected' : ''}`}
                    aria-label={a.label}
                    aria-pressed={a.id === current.id}
                    title={a.label}
                    onClick={() => {
                      setArrangement(a.id);
                      setOpen(false);
                    }}
                  >
                    <ArrangementIcon arrangement={a} />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
