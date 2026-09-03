import { memo, useEffect, useRef, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useSceneStore } from '../state/sceneStore';
import { me } from '../state/actors';
import { releaseHand, takeHand } from '../state/hands';
import type { SceneNode } from '../state/types';
import type { PendingKind } from '../agent/announcements';

export const PROVENANCE_MS = 7000;

export interface NoteData extends Record<string, unknown> {
  node: SceneNode;
  fresh: boolean;
  /** Named in an announcement that has not run yet, so it is about to change. */
  pending: PendingKind | null;
  /** Named by the history row the reader is pointing at right now. */
  traced: boolean;
  /**
   * The seat of a colleague who has this note selected, if one has.
   *
   * Pointing, not holding: it stops nothing and refuses nothing. It is here
   * because "these ones" is how people specify things on a canvas, and a
   * sentence like that is unreadable if you cannot see what the other person is
   * looking at.
   */
  pointedAt: string | null;
}

const NoteNodeInner = ({ data, selected }: NodeProps) => {
  const { node, fresh, pending, traced, pointedAt } = data as unknown as NoteData;
  const setNodeText = useSceneStore((s) => s.setNodeText);
  const pushLog = useSceneStore((s) => s.pushLog);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  /** The text this edit began from, to tell a no-op apart from a collision. */
  const base = useRef(node.text);

  /**
   * A caret is a hand. Without this the note is held only while it is being
   * dragged, so an agent would carry a note away mid-sentence — the textarea
   * travels with it and keeps focus, leaving somebody typing into a box sliding
   * across the board — and the blur that followed would write their draft over
   * whatever had arrived in the meantime. The grip refuses both: it goes out
   * over awareness, and the store declines a move or an edit to a note held by
   * anyone else.
   */
  const startEditing = () => {
    base.current = node.text;
    takeHand('edit', node.id);
    setEditing(true);
  };

  const stopEditing = () => {
    releaseHand('edit', node.id);
    setEditing(false);
  };

  useEffect(() => {
    if (!editing) setDraft(node.text);
  }, [node.text, editing]);

  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  const commit = () => {
    stopEditing();
    const next = draft.trim();
    // Somebody got in before the grip did — a peer whose claim crossed with
    // ours on the wire, or a board replaced underneath the edit. Rare, and the
    // right answer is still to leave their text alone: a draft is worth less
    // than work already on the board, and it is on screen to be retyped.
    if (node.text !== base.current) {
      setDraft(node.text);
      return;
    }
    if (next && next !== node.text) {
      setNodeText(node.id, next, me());
      pushLog(me(), `Edited note ${node.id}.`);
    } else {
      setDraft(node.text);
    }
  };

  const classes = [
    'note',
    node.kind === 'summary' ? 'summary' : '',
    selected ? 'selected' : '',
    fresh ? 'agent-fresh' : '',
    pending ? `pending pending-${pending}` : '',
    traced ? 'traced' : '',
    pointedAt ? 'pointed' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={classes}
      style={{ background: node.color }}
      onDoubleClick={startEditing}
      title={node.text}
    >
      <Handle type="target" position={Position.Left} />
      {editing ? (
        <textarea
          ref={ref}
          className="nodrag"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              commit();
            }
            if (e.key === 'Escape') {
              setDraft(node.text);
              stopEditing();
            }
          }}
        />
      ) : (
        <span className="note-text">{node.text}</span>
      )}
      {fresh && !editing && <span className="stamp">agent</span>}
      {pointedAt && !editing && <span className="pointer-tag">{pointedAt}</span>}
      <Handle type="source" position={Position.Right} />
    </div>
  );
};

export const NoteNode = memo(NoteNodeInner);
