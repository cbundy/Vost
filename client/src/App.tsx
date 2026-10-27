import { useEffect, useState } from 'react';
import { BottomDock } from './components/BottomDock';
import { ChartPanel } from './components/ChartPanel';
import { Inbox } from './components/Inbox';
import { CsvImportModal } from './components/CsvImportModal';
import { Sidebar } from './components/Sidebar';
import { Toasts } from './components/Toasts';
import { TopBar } from './components/TopBar';
import { Splitter } from './components/Splitter';
import { SIDEBAR_DEFAULT, clamp, sidebarLimits } from './lib/paneSizes';
import { useViewportSize } from './lib/useViewportSize';
import { useStore } from './state/store';

export default function App() {
  const init = useStore((s) => s.init);
  const [csvOpen, setCsvOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const sidebarWidth = useStore((s) => s.sidebarWidth);
  const setSidebarWidth = useStore((s) => s.setSidebarWidth);
  const viewport = useViewportSize();
  const limits = sidebarLimits(viewport.width);
  const effectiveSidebar = clamp(sidebarWidth, limits.min, limits.max);

  useEffect(() => {
    init();
  }, [init]);

  return (
    <div className="app" style={{ ['--sidebar-width' as string]: `${effectiveSidebar}px` }}>
      <TopBar onImportCsv={() => setCsvOpen(true)} onToggleSidebar={() => setSidebarOpen((v) => !v)}
        onOpenInbox={() => setInboxOpen(true)}
      />
      <div className="app-body">
        {sidebarOpen && <Sidebar onImportCsv={() => setCsvOpen(true)} />}
        {sidebarOpen && (
          <Splitter
            orientation="vertical"
            label="Resize sidebar"
            value={effectiveSidebar}
            min={limits.min}
            max={limits.max}
            onChange={(n) => setSidebarWidth(clamp(n, limits.min, limits.max))}
            onReset={() => setSidebarWidth(SIDEBAR_DEFAULT)}
          />
        )}
        <main className="chart-area">
          <ChartPanel onImportCsv={() => setCsvOpen(true)} />
        </main>
      </div>
      <BottomDock />
      {csvOpen && <CsvImportModal onClose={() => setCsvOpen(false)} />}
      {inboxOpen && <Inbox onClose={() => setInboxOpen(false)} />}
      <Toasts />
    </div>
  );
}
