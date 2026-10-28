import type { ReactNode } from 'react';
import { useStore, type SidePanelSection } from '../state/store';
import { DatabaseIcon, IndicatorIcon, ListIcon } from './Icons';

export interface SideSection {
  id: SidePanelSection;
  name: string;
  icon: ReactNode;
}

/** The side panel's sections in rail order. */
export const SIDE_SECTIONS: readonly SideSection[] = [
  { id: 'watchlist', name: 'Watchlist', icon: <ListIcon /> },
  { id: 'data', name: 'Data and library', icon: <DatabaseIcon /> },
  { id: 'indicators', name: 'Indicators', icon: <IndicatorIcon /> },
];

/** The slim icon rail at the right edge: picks the panel's section, and collapses the panel on the active one. */
export function SideRail() {
  const active = useStore((s) => s.sidePanel);
  const collapsed = useStore((s) => s.sidePanelCollapsed);
  const setSidePanel = useStore((s) => s.setSidePanel);
  const setCollapsed = useStore((s) => s.setSidePanelCollapsed);

  return (
    <div className="side-rail" role="toolbar" aria-label="Side panel" aria-orientation="vertical">
      {SIDE_SECTIONS.map((sec) => {
        const pressed = !collapsed && active === sec.id;
        return (
          <button
            key={sec.id}
            type="button"
            className={`ghost icon rail-btn${pressed ? ' active' : ''}`}
            title={sec.name}
            aria-label={sec.name}
            aria-pressed={pressed}
            onClick={() => {
              if (pressed) {
                setCollapsed(true);
              } else {
                setSidePanel(sec.id);
                setCollapsed(false);
              }
            }}
          >
            {sec.icon}
          </button>
        );
      })}
    </div>
  );
}
