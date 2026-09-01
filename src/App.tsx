import { useEffect, useMemo, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';

import { Canvas } from './canvas/Canvas';
import { Panel, TABS, type Tab } from './ui/Panel';
import { TopBar } from './ui/TopBar';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { buildTools } from './agent/tools';
import { exposeForConsole, instrument, registerTools } from './agent/webmcp';
export const App = () => {
  const [panelOpen, setPanelOpen] = useState(true);
  const [tab, setTab] = useState<Tab>('console');

  // One instrumented set of handlers, shared by the WebMCP host, the in-page
  // console and window.__copresence. There is exactly one code path.
  const tools = useMemo(() => buildTools().map(instrument), []);

  useEffect(() => {
    const unregister = registerTools(tools);
    exposeForConsole(tools);
    return unregister;
  }, [tools]);

  const openAt = (next: Tab) => {
    setTab(next);
    setPanelOpen(true);
  };

  return (
    <div className="app">
      <TopBar panelOpen={panelOpen} onTogglePanel={() => setPanelOpen((v) => !v)} />
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
      <ConfirmDialog />
    </div>
  );
};
