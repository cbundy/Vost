import { useCallback, useEffect, useRef, useState } from 'react';
import { BottomDock } from './components/BottomDock';
import { ChartPanel } from './components/ChartPanel';
import { Inbox } from './components/Inbox';
import { CsvImportModal } from './components/CsvImportModal';
import { Sidebar } from './components/Sidebar';
import { Toasts } from './components/Toasts';
import { TopBar } from './components/TopBar';
import { SideRail } from './components/SideRail';
import { Splitter } from './components/Splitter';
import { DRAWER_QUERY, SIDEBAR_DEFAULT, clamp, sidebarLimits } from './lib/paneSizes';
import { useMediaQuery } from './lib/useMediaQuery';
import { useViewportSize } from './lib/useViewportSize';
import { useStore } from './state/store';

export default function App() {
  const init = useStore((s) => s.init);
  const [csvOpen, setCsvOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  // The desktop panel's collapsed state is a saved pref; the narrow-screen drawer's open state is local.
  const panelCollapsed = useStore((s) => s.sidePanelCollapsed);
  const setPanelCollapsed = useStore((s) => s.setSidePanelCollapsed);
  const desktopSidebarOpen = !panelCollapsed;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isDrawer = useMediaQuery(DRAWER_QUERY);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const drawerShown = isDrawer && drawerOpen;

  const sidebarWidth = useStore((s) => s.sidebarWidth);
  const setSidebarWidth = useStore((s) => s.setSidebarWidth);
  const viewport = useViewportSize();
  const limits = sidebarLimits(viewport.width);
  const effectiveSidebar = clamp(sidebarWidth, limits.min, limits.max);

  useEffect(() => {
    if (!isDrawer) setDrawerOpen(false);
  }, [isDrawer]);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    toggleRef.current?.focus();
  }, []);

  useEffect(() => {
    init();
  }, [init]);

  return (
    <div className="app" style={{ ['--sidebar-width' as string]: `${effectiveSidebar}px` }}>
      <TopBar onImportCsv={() => setCsvOpen(true)}
        onToggleSidebar={() => (isDrawer ? setDrawerOpen((v) => !v) : setPanelCollapsed(desktopSidebarOpen))}
        sidebarExpanded={isDrawer ? drawerShown : desktopSidebarOpen}
        toggleRef={toggleRef}
        onOpenInbox={() => setInboxOpen(true)}
      />
      <div className="app-body">
        {drawerShown && <div className="drawer-backdrop" onMouseDown={(e) => { e.preventDefault(); closeDrawer(); }} />}
        {drawerShown && (
          <Sidebar
            drawer={{ onClose: closeDrawer }}
            onImportCsv={() => {
              setDrawerOpen(false);
              setCsvOpen(true);
            }}
          />
        )}
        <main className="chart-area">
          <ChartPanel onImportCsv={() => setCsvOpen(true)} />
        </main>
        {!isDrawer && desktopSidebarOpen && (
          <Splitter
            orientation="vertical"
            grow="start"
            label="Resize sidebar"
            value={effectiveSidebar}
            min={limits.min}
            max={limits.max}
            onChange={(n) => setSidebarWidth(clamp(n, limits.min, limits.max))}
            onReset={() => setSidebarWidth(SIDEBAR_DEFAULT)}
          />
        )}
        {!isDrawer && desktopSidebarOpen && <Sidebar onImportCsv={() => setCsvOpen(true)} />}
        {!isDrawer && <SideRail />}
      </div>
      <BottomDock />
      {csvOpen && <CsvImportModal onClose={() => setCsvOpen(false)} />}
      {inboxOpen && <Inbox onClose={() => setInboxOpen(false)} />}
      <Toasts />
    </div>
  );
}
