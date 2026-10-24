import { useEffect, useState } from 'react';
import { BottomDock } from './components/BottomDock';
import { ChartPanel } from './components/ChartPanel';
import { Inbox } from './components/Inbox';
import { CsvImportModal } from './components/CsvImportModal';
import { Sidebar } from './components/Sidebar';
import { Toasts } from './components/Toasts';
import { TopBar } from './components/TopBar';
import { useStore } from './state/store';

export default function App() {
  const init = useStore((s) => s.init);
  const [csvOpen, setCsvOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    init();
  }, [init]);

  return (
    <div className="app">
      <TopBar onImportCsv={() => setCsvOpen(true)} onToggleSidebar={() => setSidebarOpen((v) => !v)}
        onOpenInbox={() => setInboxOpen(true)}
      />
      <div className="app-body">
        {sidebarOpen && <Sidebar onImportCsv={() => setCsvOpen(true)} />}
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
