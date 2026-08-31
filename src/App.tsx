import { useEffect, useMemo, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';

import { Canvas } from './canvas/Canvas';
import { Panel } from './ui/Panel';
import { TopBar } from './ui/TopBar';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { buildTools } from './agent/tools';
import { exposeForConsole, instrument, registerTools } from './agent/webmcp';
import { useCursorStore } from './agent/motion';

const CURSOR_LABEL: Record<string, string> = {
  travelling: 'Agent is moving notes',
  grabbing: 'Agent is picking up a note',
  writing: 'Agent is writing',
  thinking: 'Agent is reading the board',
};

export const App = () => {
  const [panelOpen, setPanelOpen] = useState(true);
  const cursorVisible = useCursorStore((s) => s.visible);
  const cursorMode = useCursorStore((s) => s.mode);

  // One instrumented set of handlers, shared by the WebMCP host, the in-page
  // console and window.__copresence. There is exactly one code path.
  const tools = useMemo(() => buildTools().map(instrument), []);

  useEffect(() => {
    const unregister = registerTools(tools);
    exposeForConsole(tools);
    return unregister;
  }, [tools]);

  return (
    <div className="app">
      <TopBar panelOpen={panelOpen} onTogglePanel={() => setPanelOpen((v) => !v)} />
      <div className="workspace">
        <ReactFlowProvider>
          <Canvas />
        </ReactFlowProvider>
        <Panel tools={tools} open={panelOpen} />

        {cursorVisible && CURSOR_LABEL[cursorMode] && (
          <div className="copresence-banner">
            <span className="spin" />
            {CURSOR_LABEL[cursorMode]} — keep dragging, you are not blocked
          </div>
        )}

        <div className="footer-hint">
          <kbd>double-click</kbd> empty canvas to add a note · <kbd>double-click</kbd> a note to edit
          · <kbd>drag</kbd> anything, any time — even while the agent is working
        </div>
      </div>
      <ConfirmDialog />
    </div>
  );
};
