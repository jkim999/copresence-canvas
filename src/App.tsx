import { useEffect, useMemo, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';

import { Canvas } from './canvas/Canvas';
import { Panel, TABS, type Tab } from './ui/Panel';
import { TopBar } from './ui/TopBar';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { ImportDialog } from './ui/ImportDialog';
import { buildTools } from './agent/tools';
import { exposeForConsole, instrument, registerTools } from './agent/webmcp';
import { connectBoard } from './sync/bind';
import { watchScene } from './state/journal';
import { watchAnnouncements } from './agent/announcements';
export const App = () => {
  const [panelOpen, setPanelOpen] = useState(true);
  const [importOpen, setImportOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('console');

  // One instrumented set of handlers, shared by the WebMCP host, the in-page
  // console and window.__copresence. There is exactly one code path.
  const tools = useMemo(() => buildTools().map(instrument), []);

  useEffect(() => {
    const unregister = registerTools(tools);
    exposeForConsole(tools);
    return unregister;
  }, [tools]);

  // What happened, kept whoever caused it — this tab, its agent, or a peer
  // whose edit arrived over the wire. Deliberately not inside the connection:
  // a board with no peers still owes its human an account of its own history.
  useEffect(watchScene, []);

  // What is about to happen, held on screen long enough to actually be seen —
  // one list, so the strip's count and the rings on the notes cannot disagree.
  useEffect(watchAnnouncements, []);

  // Every tab on this URL is a peer. No room to name, no server to join: the
  // second tab you open is already a second person, with its own agent.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const connection = connectBoard();
    return connection.stop;
  }, []);

  const openAt = (next: Tab) => {
    setTab(next);
    setPanelOpen(true);
  };

  return (
    <div className="app">
      <TopBar
        panelOpen={panelOpen}
        onTogglePanel={() => setPanelOpen((v) => !v)}
        onImport={() => setImportOpen(true)}
      />
      <div className="workspace">
        <ReactFlowProvider>
          <Canvas />
        </ReactFlowProvider>

        {panelOpen ? (
          <Panel tools={tools} tab={tab} onTab={setTab} />
        ) : (
          <nav className="rail chrome-surface" aria-label="Open the console">
            {TABS.map(({ id, label, Icon }) => (
              <button key={id} onClick={() => openAt(id)} title={label} aria-label={label}>
                <Icon size={16} />
              </button>
            ))}
          </nav>
        )}

      </div>
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
      <ConfirmDialog />
    </div>
  );
};
