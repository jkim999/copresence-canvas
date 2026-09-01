import { useSceneStore } from '../state/sceneStore';
import { useHostStore } from '../agent/webmcp';
import {
  IconPanelClose,
  IconPanelOpen,
  IconProvenance,
  IconReset,
  IconUndo,
  IconUndoAgent,
} from './icons';

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
    <header className="topbar chrome-surface">
      <div className="brand">
        <span className="mark">
          <i />
          <i />
        </span>
        Co-Presence Canvas
        <em>one board, two hands</em>
      </div>

      <div className="topbar-spacer" />

      <span
        className={`status ${connected ? 'live' : ''}`}
        title={
          connected
            ? `${registered.length} tools registered through ${transport}`
            : 'No WebMCP host detected — the built-in console drives the same tool handlers.'
        }
      >
        <span className="led" />
        {connected ? (
          <>
            <span className="long">WebMCP live · </span>
            <code>{transport}</code>
          </>
        ) : (
          <span className="long">No WebMCP host</span>
        )}
        <span className="count">
          {registered.length} tool{registered.length === 1 ? '' : 's'}
        </span>
      </span>

      <button
        className={`btn ${showProvenance ? 'on' : ''}`}
        onClick={toggleProvenance}
        aria-pressed={showProvenance}
        title="Ring anything the agent touched in the last few seconds"
      >
        <IconProvenance />
        <span className="label">Provenance</span>
      </button>
      <button
        className="btn"
        onClick={() => undoLastAgentAction()}
        disabled={!hasAgentAction}
        title="Revert the agent's most recent action, leaving yours alone"
      >
        <IconUndoAgent />
        <span className="label">Undo agent</span>
      </button>
      <button
        className="btn icon"
        onClick={() => undoLast()}
        disabled={history.length === 0}
        title="Undo the last change by either of you"
        aria-label="Undo the last change"
      >
        <IconUndo />
      </button>
      <button
        className="btn icon"
        onClick={resetScene}
        title="Restore the starting board"
        aria-label="Reset the board"
      >
        <IconReset />
      </button>

      <span className="sep" />

      <button
        className="btn icon"
        onClick={onTogglePanel}
        title={panelOpen ? 'Collapse the console' : 'Open the console'}
        aria-label={panelOpen ? 'Collapse the console' : 'Open the console'}
      >
        {panelOpen ? <IconPanelClose /> : <IconPanelOpen />}
      </button>
    </header>
  );
};
