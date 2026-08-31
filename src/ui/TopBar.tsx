import { useSceneStore } from '../state/sceneStore';
import { useHostStore } from '../agent/webmcp';

interface Props {
  panelOpen: boolean;
  onTogglePanel: () => void;
}

export const TopBar = ({ panelOpen, onTogglePanel }: Props) => {
  const transport = useHostStore((s) => s.transport);
  const connected = useHostStore((s) => s.connected);
  const registered = useHostStore((s) => s.registered);
  const showProvenance = useSceneStore((s) => s.showProvenance);
  const toggleProvenance = useSceneStore((s) => s.toggleProvenance);
  const undoLast = useSceneStore((s) => s.undoLast);
  const undoLastAgentAction = useSceneStore((s) => s.undoLastAgentAction);
  const history = useSceneStore((s) => s.history);
  const resetScene = useSceneStore((s) => s.resetScene);

  const hasAgentAction = history.some((h) => h.by === 'agent');

  return (
    <header className="topbar">
      <div className="brand">
        <span className="dot" />
        Co-Presence Canvas
        <small>a board you and your agent draw on at the same time</small>
      </div>

      <div className="topbar-spacer" />

      <span
        className={`pill ${connected ? 'live' : 'local'}`}
        title={
          connected
            ? `${registered.length} tools registered via ${transport}`
            : 'No WebMCP host detected — the built-in agent console drives the same tool handlers.'
        }
      >
        <span className="led" />
        {connected ? (
          <>
            WebMCP live · <code>{transport}</code> · {registered.length} tools
          </>
        ) : (
          <>No WebMCP host · {registered.length} tools ready</>
        )}
      </span>

      <button
        className={`btn ${showProvenance ? 'on' : ''}`}
        onClick={toggleProvenance}
        title="Tint anything the agent touched recently"
      >
        Provenance
      </button>
      <button className="btn" onClick={() => undoLastAgentAction()} disabled={!hasAgentAction}>
        Undo agent
      </button>
      <button className="btn" onClick={() => undoLast()} disabled={history.length === 0}>
        Undo
      </button>
      <button className="btn ghost" onClick={resetScene} title="Restore the starting board">
        Reset
      </button>
      <button className="btn" onClick={onTogglePanel}>
        {panelOpen ? 'Hide panel' : 'Show panel'}
      </button>
    </header>
  );
};
