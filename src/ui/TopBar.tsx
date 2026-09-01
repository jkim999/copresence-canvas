import { useEffect, useState } from 'react';
import { useSceneStore } from '../state/sceneStore';
import { isAgent, me } from '../state/actors';
import { useHostStore } from '../agent/webmcp';
import { toMarkdown } from '../data/exportMarkdown';
import { shareUrlFor } from '../data/shareLink';
import {
  IconCheck,
  IconCopy,
  IconImport,
  IconLink,
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

type Flash = 'idle' | 'done' | 'failed';

/** A button that reports what happened, then goes quiet again. */
const useFlash = (): [Flash, (next: Flash) => void] => {
  const [state, setState] = useState<Flash>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const t = setTimeout(() => setState('idle'), 1800);
    return () => clearTimeout(t);
  }, [state]);

  return [state, setState];
};

const copyText = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard access can be denied outright — the caller says so out loud.
    return false;
  }
};

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
  const [copied, flashCopied] = useFlash();
  const [shared, flashShared] = useFlash();

  const hasAgentAction = history.some((h) => isAgent(h.by));

  const blocked = () => pushLog('system', 'The browser blocked clipboard access — nothing was copied.');

  // Markdown is the board for a human to read.
  const copyBoard = async () => {
    if (await copyText(toMarkdown(scene))) {
      flashCopied('done');
      pushLog(me(), `Copied the board as Markdown (${scene.nodes.length} notes).`);
      return;
    }
    flashCopied('failed');
    blocked();
  };

  // A link is the board itself — geometry, edges, regions and all. There is no
  // server, so the URL is the only place a board can be saved to.
  const shareBoard = async () => {
    const url = shareUrlFor(scene, window.location.href);
    // Put it in the address bar too, so what the human sees is what they sent.
    window.history.replaceState(null, '', url);
    if (await copyText(url)) {
      flashShared('done');
      pushLog(me(), `Copied a link to this board (${url.length} characters).`);
      return;
    }
    flashShared('failed');
    blocked();
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
      <button
        className={`btn ${shared === 'done' ? 'on' : ''}`}
        onClick={shareBoard}
        title="Copy a link that carries this exact board — positions, groups and all"
      >
        {shared === 'done' ? <IconCheck /> : <IconLink />}
        <span className="label">
          {shared === 'done' ? 'Link copied' : shared === 'failed' ? 'Blocked' : 'Share'}
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
