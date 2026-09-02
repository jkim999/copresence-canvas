import { memo, useEffect, useRef, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useSceneStore } from '../state/sceneStore';
import { me } from '../state/actors';
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
}

const NoteNodeInner = ({ data, selected }: NodeProps) => {
  const { node, fresh, pending, traced } = data as unknown as NoteData;
  const setNodeText = useSceneStore((s) => s.setNodeText);
  const pushLog = useSceneStore((s) => s.pushLog);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.text);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) setDraft(node.text);
  }, [node.text, editing]);

  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
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
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={classes}
      style={{ background: node.color }}
      onDoubleClick={() => setEditing(true)}
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
              setEditing(false);
            }
          }}
        />
      ) : (
        <span className="note-text">{node.text}</span>
      )}
      {fresh && !editing && <span className="stamp">agent</span>}
      <Handle type="source" position={Position.Right} />
    </div>
  );
};

export const NoteNode = memo(NoteNodeInner);
