import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  applyNodeChanges,
  useReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  type OnNodeDrag,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useSceneStore } from '../state/sceneStore';
import { isAgent, me } from '../state/actors';
import { releaseHand, takeHand } from '../state/hands';
import type { SceneNode } from '../state/types';
import { NoteNode, PROVENANCE_MS, type NoteData } from './NoteNode';
import { AgentCursor } from './AgentCursor';
import { HumanCursor } from './HumanCursor';
import { AnnotationLayer, RegionLayer } from './Overlays';
import { PeerCursors } from './PeerCursors';
import { reportCursor } from '../sync/bind';
import { useTick } from './useTick';
import { useCursorStore } from '../agent/motion';
import { pendingFrom, useHeldStore, type PendingKind } from '../agent/announcements';
import { useSpotlightStore } from '../ui/spotlight';
import { usePeerStore } from '../sync/peers';
import { selectionsOf } from '../sync/presence';
import { crediting } from '../agent/credit';
import { Ledger } from '../ui/Ledger';
import { Happening } from '../ui/Happening';
import { IconRunning } from '../ui/icons';

const DOING: Record<string, string> = {
  travelling: 'Agent is moving notes',
  grabbing: 'Agent is picking up a note',
  writing: 'Agent is writing',
  thinking: 'Agent is reading the board',
};

const nodeTypes = { note: NoteNode };

/** ~22 pointer samples a second: enough to read as a hand, not a firehose. */
const CURSOR_SAMPLE_MS = 45;

type RFNode = Node<NoteData>;

const buildNode = (
  n: SceneNode,
  fresh: boolean,
  pending: PendingKind | null,
  traced: boolean,
  pointedAt: string | null,
  previous?: RFNode,
): RFNode => ({
  // Spreading the previous node preserves React Flow's own internals — most
  // importantly `measured`, without which it renders the node invisible.
  ...(previous ?? { id: n.id, type: 'note' as const }),
  id: n.id,
  type: 'note',
  position: { x: n.x, y: n.y },
  selected: n.selected,
  style: { width: n.w, height: n.h },
  data: { node: n, fresh, pending, traced, pointedAt },
});

interface CanvasProps {
  /**
   * Rendered inside the board's own box rather than the workspace's.
   *
   * Anything centred over "the canvas" has to live here: anchored to the
   * workspace it is centred on the panel as well, and drifts right by half the
   * panel's width — the same way the announcement strip did before it moved.
   */
  children?: ReactNode;
}

export const Canvas = ({ children }: CanvasProps) => {
  const scene = useSceneStore((s) => s.scene);
  const showProvenance = useSceneStore((s) => s.showProvenance);
  const moveNode = useSceneStore((s) => s.moveNode);
  const setSelected = useSceneStore((s) => s.setSelected);
  const addNode = useSceneStore((s) => s.addNode);
  const removeNodes = useSceneStore((s) => s.removeNodes);
  const snapshot = useSceneStore((s) => s.snapshot);
  const pushLog = useSceneStore((s) => s.pushLog);

  const cursorVisible = useCursorStore((s) => s.visible);
  const cursorMode = useCursorStore((s) => s.mode);

  const epoch = useSceneStore((s) => s.epoch);

  // What has been announced but has not happened yet. The strip above the board
  // says it in a sentence; this is the same claim laid on the notes themselves.
  const held = useHeldStore((s) => s.held);
  const pending = useMemo(() => pendingFrom(held), [held]);

  // Which notes the history row under the reader's pointer is about.
  const litIds = useSpotlightStore((s) => s.ids);
  const traced = useMemo(() => new Set(litIds), [litIds]);

  // What everyone else is pointing at. Resolved through the same crediting the
  // strip and the history use, so one colleague has one name everywhere.
  const peers = usePeerStore((s) => s.peers);
  const pointedAt = useMemo(() => {
    const credit = crediting();
    const byNote = selectionsOf(peers);
    const out = new Map<string, string>();
    for (const [id, actor] of Object.entries(byNote)) out.set(id, credit(actor).seat);
    return out;
  }, [peers]);

  const { screenToFlowPosition, fitView } = useReactFlow();
  const dragged = useRef<Set<string>>(new Set());

  // Keep the provenance clock idle unless something is actually tinted.
  const hasAgentEdit = scene.nodes.some((n) => isAgent(n.lastEditedBy));
  const now = useTick(showProvenance && hasAgentEdit ? 700 : 0);

  // A replaced board (reset, or the human's own notes) lands somewhere new.
  useEffect(() => {
    if (epoch === 0) return;
    fitView({ padding: 0.16, duration: 420 });
  }, [epoch, fitView]);

  const isFresh = useCallback(
    (n: SceneNode) =>
      showProvenance && isAgent(n.lastEditedBy) && Date.now() - n.editedAt < PROVENANCE_MS,
    [showProvenance],
  );

  // React Flow owns its node list so that measurements survive; the scene store
  // remains the source of truth and is mirrored into it on every change.
  const [rfNodes, setRfNodes] = useState<RFNode[]>(() =>
    scene.nodes.map((n) => buildNode(n, false, null, false, null)),
  );

  useEffect(() => {
    setRfNodes((previous) => {
      const byId = new Map(previous.map((n) => [n.id, n]));
      return scene.nodes.map((n) => {
        const prev = byId.get(n.id);
        const fresh = isFresh(n);
        const claim = pending.get(n.id) ?? null;
        const lit = traced.has(n.id);
        const pointer = pointedAt.get(n.id) ?? null;
        const unchanged =
          prev &&
          prev.position.x === n.x &&
          prev.position.y === n.y &&
          prev.selected === n.selected &&
          (prev.data as NoteData).node === n &&
          (prev.data as NoteData).fresh === fresh &&
          (prev.data as NoteData).pending === claim &&
          (prev.data as NoteData).traced === lit &&
          (prev.data as NoteData).pointedAt === pointer;
        return unchanged ? prev : buildNode(n, fresh, claim, lit, pointer, prev);
      });
    });
  }, [scene.nodes, isFresh, now, pending, traced, pointedAt]);

  const edges: Edge[] = useMemo(
    () =>
      scene.edges.map((e) => ({
        id: e.id,
        source: e.from,
        target: e.to,
        label: e.label,
        animated: isAgent(e.lastEditedBy) && Date.now() - e.editedAt < PROVENANCE_MS,
        className: isAgent(e.lastEditedBy) ? 'agent-edge' : '',
        style: { stroke: isAgent(e.lastEditedBy) ? '#0e6e64' : '#a89f8d' },
      })),
    [scene.edges, now],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<RFNode>[]) => {
      // Let React Flow apply everything (dimensions included) to its own list…
      setRfNodes((nds) => applyNodeChanges(changes, nds));
      // …then mirror only genuine human intent back into the scene.
      for (const change of changes) {
        if (change.type === 'position' && change.position && change.dragging) {
          moveNode(change.id, change.position.x, change.position.y, me());
        } else if (change.type === 'select') {
          setSelected(change.id, change.selected);
        }
      }
    },
    [moveNode, setSelected],
  );

  // A hand on a note is sacred: it is off limits to the agent's tweens and to
  // anyone else's edits. That guarantee is what makes simultaneous editing safe.
  //
  // Claimed through the union rather than the store directly, because a caret
  // is a hand too and this tab may be holding one note by each. Calling setGrip
  // from here would drop whatever the other hand had.
  const onNodeDragStart: OnNodeDrag<RFNode> = useCallback((_e, node) => {
    dragged.current.add(node.id);
    takeHand('drag', node.id);
  }, []);

  const onNodeDragStop: OnNodeDrag<RFNode> = useCallback(
    (_e, node) => {
      moveNode(node.id, node.position.x, node.position.y, me());
      dragged.current.delete(node.id);
      releaseHand('drag', node.id);
    },
    [moveNode],
  );

  // Pointer moves fire far faster than anyone can read, and each one is a
  // message on the wire, so they are sampled rather than streamed. The peer
  // cursor interpolates between samples in CSS, which is cheaper than sending
  // every frame and indistinguishable at this speed.
  const lastReport = useRef(0);
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const now = performance.now();
      if (now - lastReport.current < CURSOR_SAMPLE_MS) return;
      lastReport.current = now;
      const point = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      reportCursor({ x: point.x, y: point.y });
    },
    [screenToFlowPosition],
  );

  // Leaving the canvas takes your hand off the board, so it should take your
  // pointer off everyone else's too.
  const onPointerLeave = useCallback(() => reportCursor(null), []);

  const onDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      if ((event.target as HTMLElement).closest('.react-flow__node')) return;
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      snapshot('Add note', me());
      const node = addNode({ text: 'New note', x: position.x - 88, y: position.y - 42 }, me());
      pushLog(me(), `Added note ${node.id}.`);
    },
    [addNode, pushLog, screenToFlowPosition, snapshot],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== 'Backspace' && event.key !== 'Delete') return;
      if ((event.target as HTMLElement).tagName === 'TEXTAREA') return;
      const selected = scene.nodes.filter((n) => n.selected).map((n) => n.id);
      if (selected.length === 0) return;
      snapshot(`Delete ${selected.length} note(s)`, me());
      removeNodes(selected, me());
      pushLog(me(), `Deleted ${selected.length} note(s).`);
    },
    [pushLog, removeNodes, scene.nodes, snapshot],
  );

  return (
    <div
      className="canvas-wrap"
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      tabIndex={-1}
    >
      <ReactFlow
        nodes={rfNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        fitView
        fitViewOptions={{ padding: 0.16 }}
        minZoom={0.15}
        maxZoom={2.2}
        selectionOnDrag
        // Double-click is how you add a note, so React Flow must not also read
        // it as zoom — the note landed and the board jumped under it at once.
        zoomOnDoubleClick={false}
        // The wheel zooms rather than pans. On an infinite board with no edges
        // to scroll to, panning by wheel is motion without a destination, and
        // it left no way to zoom but the buttons in the corner.
        zoomOnScroll
        nodesConnectable={false}
        deleteKeyCode={null}
      >
        <Background variant={BackgroundVariant.Dots} gap={26} size={1.3} color="#cfc7b6" />
        <Controls showInteractive={false} position="bottom-right" />
        <MiniMap
          pannable
          zoomable
          position="top-right"
          style={{ width: 152, height: 104 }}
          nodeColor={(n) => ((n.data as NoteData)?.fresh ? '#4fbfb0' : '#6d675c')}
          maskColor="rgba(20,19,16,.55)"
        />
        <RegionLayer />
        <PeerCursors />
        <AnnotationLayer />
        <AgentCursor />
      </ReactFlow>
      <HumanCursor />

      {cursorVisible && DOING[cursorMode] && (
        <div className="banner" role="status">
          <span className="spin">
            <IconRunning />
          </span>
          {DOING[cursorMode]} <em>— keep dragging, you are not blocked</em>
        </div>
      )}

      <Happening />
      {children}
      <Ledger />

      <div className="hints">
        <kbd>double-click</kbd> the board to add a note · <kbd>double-click</kbd> a note to edit ·{' '}
        <kbd>drag</kbd> anything, any time — even while the agent is working
      </div>
    </div>
  );
};
