import { useCallback, useEffect, useRef, useState } from 'react';
import { BottomDock } from './components/BottomDock';
import { ChartPanel } from './components/ChartPanel';
import { AlertPopup } from './components/AlertPopup';
import { AlertsPanel } from './components/AlertsPanel';
import { Inbox } from './components/Inbox';
import { CsvImportModal } from './components/CsvImportModal';
import { PinePane } from './components/PinePane';
import { Sidebar } from './components/Sidebar';
import { Toasts } from './components/Toasts';
import { TopBar } from './components/TopBar';
import { SideRail } from './components/SideRail';
import { Splitter } from './components/Splitter';
import { DRAWER_QUERY, PINE_DEFAULT, SIDEBAR_DEFAULT, clamp, pineLimits, sidebarLimits } from './lib/paneSizes';
import { useMediaQuery } from './lib/useMediaQuery';
import { useViewportSize } from './lib/useViewportSize';
import { useAlerts } from './state/alerts';
import { useStore } from './state/store';

export default function App() {
  const init = useStore((s) => s.init);
  const [csvOpen, setCsvOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  // The Alerts panel; `level` is a price prefilled from the chart's right-click menu.
  const [alertsPanel, setAlertsPanel] = useState<{ level?: number } | null>(null);
  // The desktop panel's collapsed state is a saved pref; the narrow-screen drawer's open state is local.
  const panelCollapsed = useStore((s) => s.sidePanelCollapsed);
  const desktopSidebarOpen = !panelCollapsed;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isDrawer = useMediaQuery(DRAWER_QUERY);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const drawerShown = isDrawer && drawerOpen;

  const sidebarWidth = useStore((s) => s.sidebarWidth);
  const setSidebarWidth = useStore((s) => s.setSidebarWidth);
  const viewport = useViewportSize();
  const limits = sidebarLimits(viewport.width);
  const effectiveSidebar = clamp(sidebarWidth, limits.min, limits.max);

  const pineOpen = useStore((s) => s.pineOpen);
  const pineWidth = useStore((s) => s.pineWidth);
  const setPineWidth = useStore((s) => s.setPineWidth);
  const closePineEditor = useStore((s) => s.closePineEditor);
  const pineToggleRef = useRef<HTMLButtonElement>(null);
  const pineLim = pineLimits(viewport.width, !isDrawer && desktopSidebarOpen ? effectiveSidebar : 0);
  const effectivePine = clamp(pineWidth, pineLim.min, pineLim.max);
  const closePine = useCallback(() => {
    closePineEditor();
    if (isDrawer) pineToggleRef.current?.focus();
  }, [closePineEditor, isDrawer]);

  useEffect(() => {
    if (!isDrawer) setDrawerOpen(false);
  }, [isDrawer]);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    openerRef.current?.focus();
  }, []);

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    useAlerts.getState().start();
    return () => useAlerts.getState().stop();
  }, []);

  return (
    <div className="app" style={{ ['--sidebar-width' as string]: `${effectiveSidebar}px`, ['--pine-width' as string]: `${effectivePine}px` }}>
      <TopBar onImportCsv={() => setCsvOpen(true)}
        pineToggleRef={pineToggleRef}
        onOpenInbox={() => setInboxOpen(true)}
        onOpenAlerts={() => setAlertsPanel({})}
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
          <ChartPanel onImportCsv={() => setCsvOpen(true)} onAddAlert={(level) => setAlertsPanel({ level })} />
          {isDrawer && pineOpen && <PinePane dialog onClose={closePine} />}
        </main>
        {!isDrawer && pineOpen && (
          <Splitter
            orientation="vertical"
            grow="start"
            label="Resize Pine editor"
            value={effectivePine}
            min={pineLim.min}
            max={pineLim.max}
            onChange={(n) => setPineWidth(clamp(n, pineLim.min, pineLim.max))}
            onReset={() => setPineWidth(PINE_DEFAULT)}
          />
        )}
        {!isDrawer && pineOpen && <PinePane dialog={false} onClose={closePine} />}
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
        <SideRail
          drawer={isDrawer ? { open: drawerShown, onOpen: (btn) => { openerRef.current = btn; setDrawerOpen(true); } } : undefined}
        />
      </div>
      <BottomDock />
      {csvOpen && <CsvImportModal onClose={() => setCsvOpen(false)} />}
      {inboxOpen && <Inbox onClose={() => setInboxOpen(false)} />}
      {alertsPanel && <AlertsPanel key={alertsPanel.level ?? 'none'} initialLevel={alertsPanel.level} onClose={() => setAlertsPanel(null)} />}
      <AlertPopup onOpenAlerts={() => setAlertsPanel({})} />
      <Toasts />
    </div>
  );
}
