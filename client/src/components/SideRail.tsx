import type { ReactNode } from 'react';
import { useStore, type SidePanelSection } from '../state/store';
import { railClick, railPressed } from '../lib/sideRail';
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

export interface RailDrawer {
  open: boolean;
  onOpen: (opener: HTMLButtonElement) => void;
}

/**
 * The slim icon rail at the right edge. On desktop it picks the panel's section and collapses the panel on the
 * active one. On narrow screens (`drawer` set) a click opens the drawer on that section.
 */
export function SideRail({ drawer }: { drawer?: RailDrawer }) {
  const active = useStore((s) => s.sidePanel);
  const collapsed = useStore((s) => s.sidePanelCollapsed);
  const setSidePanel = useStore((s) => s.setSidePanel);
  const setCollapsed = useStore((s) => s.setSidePanelCollapsed);
  const mode = drawer ? 'drawer' : 'panel';
  const state = { active, collapsed, drawerOpen: drawer?.open };

  return (
    <div className="side-rail" role="toolbar" aria-label="Side panel" aria-orientation="vertical">
      {SIDE_SECTIONS.map((sec) => {
        const pressed = railPressed(mode, state, sec.id);
        return (
          <button
            key={sec.id}
            type="button"
            className={`ghost icon rail-btn${pressed ? ' active' : ''}`}
            title={sec.name}
            aria-label={sec.name}
            aria-pressed={pressed}
            {...(drawer ? { 'aria-haspopup': 'dialog' as const, 'aria-controls': 'sidebar', 'aria-expanded': drawer.open } : {})}
            onClick={(e) => {
              const r = railClick(mode, state, sec.id);
              setSidePanel(r.section);
              if (r.openDrawer) drawer?.onOpen(e.currentTarget);
              else setCollapsed(r.collapsed);
            }}
          >
            {sec.icon}
          </button>
        );
      })}
    </div>
  );
}
