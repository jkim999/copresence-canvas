import { useEffect, useMemo, useState } from 'react';
import { useSceneStore } from '../state/sceneStore';
import { replaceBoard } from '../state/boardChange';
import { clearPendingShare, usePendingShare } from '../data/pendingShare';
import { isAgent, me } from '../state/actors';
import { useHostStore } from '../agent/webmcp';
import { usePeerStore } from '../sync/peers';
import { crediting } from '../agent/credit';
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

  const waitingBoard = usePendingShare((s) => (s.displaced ? s.scene : null));
  const loadScene = useSceneStore((s) => s.loadScene);

  // A board that came in a link, held back because this room already had one.
  const openShared = () => {
    if (!waitingBoard) return;
    void replaceBoard(
      {
        title: 'Open the shared board for everyone?',
        body: `This board was already open when you followed that link, so the link's board is waiting. Opening it replaces what is here now, for every person on it.`,
      },
      () => {
        loadScene(waitingBoard, 'Opened the board from the link you followed.');
        clearPendingShare();
      },
    );
  };

  // Reset throws away everyone's board, not just this tab's view of it.
  const onReset = () =>
    void replaceBoard(
      {
        title: 'Reset the board for everyone?',
        body: 'This puts the starting board back and discards everything on the canvas — for every person here, not only you.',
      },
      resetScene,
    );
  const scene = useSceneStore((s) => s.scene);
  const pushLog = useSceneStore((s) => s.pushLog);
  const [copied, flashCopied] = useFlash();
  const [shared, flashShared] = useFlash();
  const peers = usePeerStore((s) => s.peers);
  // Resolved, not taken from the wire: the chip named a seat ("Ochre") that
  // appeared nowhere else on screen, because each tab mints its own name before
  // it knows who else is in the room.
  const credit = useMemo(() => crediting(), [peers]);
  const seatOf = (actor: string) => credit(actor).seat;

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

      {peers.length > 0 ? (
        <span
          className="status here"
          title={
            peers.length === 1
              ? `${seatOf(peers[0].actor)} is on this board, with an agent of their own.`
              : `${peers.map((p) => seatOf(p.actor)).join(', ')} are on this board, each with an agent of their own.`
          }
        >
          <span className="led" />
          <span className="long">{seatOf(peers[0].actor)}</span>
          {peers.length > 1 ? <span className="count">+{peers.length - 1}</span> : null}
        </span>
      ) : null}

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

      {waitingBoard !== null && (
        <button
          className="btn waiting"
          onClick={openShared}
          title={`The link you followed carries a board of ${waitingBoard.nodes.length} notes. This board was already open, so it was not replaced.`}
        >
          Shared board waiting
        </button>
      )}

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
        onClick={onReset}
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
