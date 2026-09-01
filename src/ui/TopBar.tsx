import { useEffect, useState } from 'react';
import { useSceneStore } from '../state/sceneStore';
import { useHostStore } from '../agent/webmcp';
import { toMarkdown } from '../data/exportMarkdown';
import {
  IconCheck,
  IconCopy,
  IconImport,
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
  onImport: () => void;
}

type CopyState = 'idle' | 'done' | 'failed';

export const TopBar = ({ panelOpen, onTogglePanel, onImport }: Props) => {
  const transport = useHostStore((s) => s.transport);
  const connected = useHostStore((s) => s.connected);
  const registered = useHostStore((s) => s.registered);
  const showProvenance = useSceneStore((s) => s.showProvenance);
  const toggleProvenance = useSceneStore((s) => s.toggleProvenance);
  const undoLast = useSceneStore((s) => s.undoLast);
  const undoLastAgentAction = useSceneStore((s) => s.undoLastAgentAction);
  const history = useSceneStore((s) => s.history);
  const resetScene = useSceneStore((s) => s.resetScene);
  const scene = useSceneStore((s) => s.scene);
  const pushLog = useSceneStore((s) => s.pushLog);
  const [copied, setCopied] = useState<CopyState>('idle');

  const hasAgentAction = history.some((h) => h.by === 'agent');

  useEffect(() => {
    if (copied === 'idle') return;
    const t = setTimeout(() => setCopied('idle'), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  // The board has to be able to leave the page, or the agent's work dies on reload.
  const copyBoard = async () => {
    const markdown = toMarkdown(scene);
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied('done');
      pushLog('human', `Copied the board as Markdown (${scene.nodes.length} notes).`);
    } catch {
      // Clipboard access can be denied outright; say so rather than failing silently.
      setCopied('failed');
      pushLog('system', 'The browser blocked clipboard access — nothing was copied.');
    }
  };

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

      <button className="btn" onClick={onImport} title="Replace the board with your own notes">
        <IconImport />
        <span className="label">Your notes</span>
      </button>
      <button
        className={`btn ${copied === 'done' ? 'on' : ''}`}
        onClick={copyBoard}
        title="Copy the organised board as Markdown"
      >
        {copied === 'done' ? <IconCheck /> : <IconCopy />}
        <span className="label">
          {copied === 'done' ? 'Copied' : copied === 'failed' ? 'Blocked' : 'Copy'}
        </span>
      </button>

      <span className="sep" />

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
