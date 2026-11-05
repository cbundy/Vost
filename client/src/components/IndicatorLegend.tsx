import { useCallback, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { LegendRow } from '../lib/paneLegend';
import { useStore } from '../state/store';
import { useChart } from '../state/chartContext';
import { IndicatorLegendMenu } from './IndicatorLegendMenu';
import type { OverlayReg } from './usePaneLegends';

const icon = (children: ReactNode) => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {children}
  </svg>
);
const EYE = icon(
  <>
    <path d="M1.5 8s2.3-4.5 6.5-4.5S14.5 8 14.5 8 12.2 12.5 8 12.5 1.5 8 1.5 8z" />
    <circle cx="8" cy="8" r="2" />
  </>,
);
const EYE_OFF = icon(
  <>
    <path d="M1.5 8s2.3-4.5 6.5-4.5S14.5 8 14.5 8 12.2 12.5 8 12.5 1.5 8 1.5 8z" />
    <path d="M2.5 13.5l11-11" />
  </>,
);
const GEAR = icon(
  <>
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
  </>,
);
const CODE = icon(<path d="M5.5 3C4 3 4 4 4 5.5S4 7.5 2.5 8c1.5.5 1.5 1 1.5 2.5S4 13 5.5 13M10.5 3C12 3 12 4 12 5.5S12 7.5 13.5 8c-1.5.5-1.5 1-1.5 2.5S12 13 10.5 13" />);
const TRASH = icon(<path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.7 8.5h6.6l.7-8.5M6.7 7v4M9.3 7v4" />);
const MORE = icon(
  <>
    <circle cx="3.5" cy="8" r="0.6" fill="currentColor" />
    <circle cx="8" cy="8" r="0.6" fill="currentColor" />
    <circle cx="12.5" cy="8" r="0.6" fill="currentColor" />
  </>,
);

/**
 * The buttons of one indicator's legend row: the eye, the gear, `{}` (Pine only), the trash and the "more" menu.
 * They are icon-only (an aria-label and a title carry the words) and shown while the row is hovered or focused.
 */
export function LegendActions({ id, label, hidden, pine, onSettings }: { id: string; label: string; hidden: boolean; pine: boolean; onSettings: (id: string) => void }) {
  const updateIndicator = useChart((s) => s.updateIndicator);
  const removeIndicator = useChart((s) => s.removeIndicator);
  const openPineEditor = useStore((s) => s.openPineEditor);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const [menu, setMenu] = useState(false);
  const closeMenu = useCallback(() => setMenu(false), []);

  const toggle = () => updateIndicator(id, { visible: hidden });
  const settings = () => onSettings(id);
  const source = () => openPineEditor(id);
  const remove = () => removeIndicator(id);
  const toggleWord = hidden ? 'Show' : 'Hide';

  const btn = (word: string, onClick: () => void, glyph: ReactNode, cls = '') => (
    <button type="button" className={`legend-btn ${cls}`.trim()} aria-label={`${label} - ${word}`} title={`${word} ${label}`} onClick={onClick}>
      {glyph}
    </button>
  );

  return (
    <span className={`legend-actions${menu ? ' open' : ''}`} onPointerDown={(e) => e.stopPropagation()}>
      {btn(toggleWord, toggle, hidden ? EYE_OFF : EYE)}
      {btn('Settings', settings, GEAR)}
      {pine && btn('Source code', source, CODE)}
      {btn('Remove', remove, TRASH)}
      <button
        ref={moreRef}
        type="button"
        className="legend-btn"
        aria-label={`${label} - More`}
        title={`More for ${label}`}
        aria-haspopup="menu"
        aria-expanded={menu}
        onClick={() => setMenu((m) => !m)}
      >
        {MORE}
      </button>
      {menu && moreRef.current && (
        <IndicatorLegendMenu
          anchor={moreRef.current}
          onClose={closeMenu}
          items={[
            { label: 'Settings...', onChoose: settings },
            ...(pine ? [{ label: 'Source code...', onChoose: source }] : []),
            { label: toggleWord, onChoose: toggle },
            { label: 'Remove', onChoose: remove },
          ]}
        />
      )}
    </span>
  );
}

/** The buttons of each sub-pane legend, drawn into the element the pane legends keep for them. */
export function PaneLegendActions({
  hosts,
  pineIds,
  onSettings,
  labels,
}: {
  hosts: ReadonlyMap<string, HTMLElement>;
  pineIds: ReadonlySet<string>;
  labels: ReadonlyMap<string, string>;
  onSettings: (id: string) => void;
}) {
  return (
    <>
      {[...hosts].map(([id, el]) =>
        createPortal(<LegendActions id={id} label={labels.get(id) ?? 'indicator'} hidden={false} pine={pineIds.has(id)} onSettings={onSettings} />, el, id),
      )}
    </>
  );
}

/**
 * The rows of the price pane's legend, one per indicator drawn there (and per hidden indicator). The value spans are
 * written imperatively on every crosshair move (see usePaneLegends), so moving the crosshair never renders React.
 */
export function PriceLegendRows({
  rows,
  overlays,
  onSettings,
  rowsRef,
}: {
  rows: readonly LegendRow[];
  overlays: ReadonlyMap<string, OverlayReg>;
  onSettings: (id: string) => void;
  rowsRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="legend-rows" ref={rowsRef}>
      {rows.map((r) => {
        const entries = r.hidden || r.pending ? [] : (overlays.get(r.id)?.entries ?? []);
        const label = [r.name, ...r.params].join(' ');
        return (
          <div key={r.id} className={`legend-row${r.hidden ? ' is-hidden' : ''}`} data-ind-id={r.id}>
            <span className="legend-row-name" onDoubleClick={() => onSettings(r.id)}>
              {r.name}
            </span>{' '}
            {r.params.length > 0 && <span className="legend-row-params">{r.params.join(' ')}</span>}{' '}
            {entries.map((e, i) => (
              <span key={i}>
                <span className="legend-row-entry" style={{ color: e.color }}>
                  {e.title && <span className="legend-row-plot">{e.title}</span>} <b data-ov={`${r.id}:${i}`}>-</b>
                </span>{' '}
              </span>
            ))}
            {r.hidden && <b className="legend-row-na">-</b>}{' '}
            <LegendActions id={r.id} label={label} hidden={r.hidden} pine={r.kind === 'pine'} onSettings={onSettings} />
          </div>
        );
      })}
    </div>
  );
}
