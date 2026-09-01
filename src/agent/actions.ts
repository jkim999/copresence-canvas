import { useSceneStore } from '../state/sceneStore';
import { PAPER } from '../data/palette';
import type { LayoutKind, SceneNode } from '../state/types';
import {
  applyLayout,
  boundsOf,
  centroidOf,
  relaxOverlaps,
  visitOrder,
} from './layout';
import {
  hideCursor,
  moveCursorTo,
  setCursorMode,
  tweenNodeTo,
  useCursorStore,
  wait,
} from './motion';
import { useConfirmStore } from './confirm';
import { myAgent } from '../state/actors';

const centerOf = (n: SceneNode) => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });

const cursorPoint = () => {
  const c = useCursorStore.getState();
  return c.visible ? { x: c.x, y: c.y } : { x: 0, y: 0 };
};

const resolveNodes = (ids: string[]): SceneNode[] => {
  const { nodes } = useSceneStore.getState().scene;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return ids.map((id) => byId.get(id)).filter((n): n is SceneNode => Boolean(n));
};

const log = (text: string) => useSceneStore.getState().pushLog(myAgent(), text);

// ---------------------------------------------------------------------------
// animateAgentCursorThrough — the storytelling core. The cursor travels to a
// node, "grabs" it, and that node starts moving while the cursor moves on to
// the next one. Overlapping travel + carry is what makes it read as an actor.
// ---------------------------------------------------------------------------

export interface CursorThroughOptions {
  /** target position per node id; omit to just visit without moving anything. */
  targets?: Record<string, { x: number; y: number }>;
  speed?: number;
  grabPause?: number;
  carryDuration?: number;
  onVisit?: (node: SceneNode) => void;
}

export interface CursorThroughResult {
  /** notes that actually reached their target. */
  moved: number;
  /** notes the human grabbed mid-flight — the agent let go of these. */
  yieldedToHuman: string[];
}

export const animateAgentCursorThrough = async (
  nodeIds: string[],
  options: CursorThroughOptions = {},
): Promise<CursorThroughResult> => {
  const { targets, speed = 1.7, grabPause = 55, carryDuration = 440, onVisit } = options;
  const nodes = resolveNodes(nodeIds);
  if (nodes.length === 0) return { moved: 0, yieldedToHuman: [] };

  const path = visitOrder(nodes, cursorPoint());
  const carries: Promise<{ id: string; completed: boolean }>[] = [];
  let visitedWithoutTarget = 0;

  for (const node of path) {
    const live = useSceneStore.getState().getNode(node.id);
    if (!live) continue;
    await moveCursorTo(centerOf(live).x, centerOf(live).y, { speed, mode: 'travelling' });
    setCursorMode('grabbing');
    onVisit?.(live);
    await wait(grabPause);
    const target = targets?.[node.id];
    if (target) {
      // Not awaited: the note travels while the cursor moves to the next one.
      carries.push(
        tweenNodeTo(node.id, target.x, target.y, carryDuration).then((completed) => ({
          id: node.id,
          completed,
        })),
      );
    } else {
      visitedWithoutTarget += 1;
    }
    setCursorMode('travelling');
  }

  const settled = await Promise.all(carries);
  hideCursor();
  const yieldedToHuman = settled.filter((c) => !c.completed).map((c) => c.id);
  return {
    moved: settled.filter((c) => c.completed).length + visitedWithoutTarget,
    yieldedToHuman,
  };
};

/**
 * A group laid out in place can land on top of notes that were not part of it.
 * Rather than leave the board overlapping, the agent shoves the strays just
 * clear of the group — the way you would sweep an arm across a real whiteboard.
 * Notes the human is holding are never touched, and every nudge is reported so
 * the agent knows what else it disturbed.
 */
const clearStrays = async (
  memberIds: string[],
  targets: Record<string, { x: number; y: number }>,
): Promise<string[]> => {
  const members = new Set(memberIds);
  const { grip } = useSceneStore.getState();
  const placed = memberIds
    .map((id) => {
      const n = useSceneStore.getState().getNode(id);
      const t = targets[id];
      return n && t ? { x: t.x, y: t.y, w: n.w, h: n.h } : null;
    })
    .filter((r): r is { x: number; y: number; w: number; h: number } => r !== null);
  if (placed.length === 0) return [];

  const PAD = 34;
  const box = {
    x: Math.min(...placed.map((r) => r.x)) - PAD,
    y: Math.min(...placed.map((r) => r.y)) - PAD,
    right: Math.max(...placed.map((r) => r.x + r.w)) + PAD,
    bottom: Math.max(...placed.map((r) => r.y + r.h)) + PAD,
  };

  const strays = useSceneStore
    .getState()
    .scene.nodes.filter(
      (n) =>
        !members.has(n.id) &&
        grip[n.id] === undefined &&
        n.x < box.right &&
        n.x + n.w > box.x &&
        n.y < box.bottom &&
        n.y + n.h > box.y,
    );
  if (strays.length === 0) return [];

  await Promise.all(
    strays.map((n) => {
      // Leave by the nearest edge, so nothing travels further than it must.
      const outLeft = box.x - (n.x + n.w);
      const outRight = box.right - n.x;
      const outUp = box.y - (n.y + n.h);
      const outDown = box.bottom - n.y;
      const best = [
        { dx: outLeft, dy: 0, d: Math.abs(outLeft) },
        { dx: outRight, dy: 0, d: Math.abs(outRight) },
        { dx: 0, dy: outUp, d: Math.abs(outUp) },
        { dx: 0, dy: outDown, d: Math.abs(outDown) },
      ].sort((a, b) => a.d - b.d)[0];
      return tweenNodeTo(n.id, n.x + best.dx, n.y + best.dy, 380);
    }),
  );

  return strays.map((n) => n.id);
};

// ---------------------------------------------------------------------------
// arrange_region
// ---------------------------------------------------------------------------

export interface ArrangeResult {
  moved: number;
  layout: LayoutKind;
  regionId: string | null;
  label: string | null;
  skipped: string[];
  yieldedToHuman: string[];
  nudgedAside: string[];
}

export const arrangeRegion = async (
  nodeIds: string[],
  layout: LayoutKind,
  label?: string,
): Promise<ArrangeResult> => {
  const store = useSceneStore.getState();
  const nodes = resolveNodes(nodeIds);
  const skipped = nodeIds.filter((id) => !nodes.some((n) => n.id === id));
  if (nodes.length === 0) {
    return {
      moved: 0,
      layout,
      regionId: null,
      label: label ?? null,
      skipped,
      yieldedToHuman: [],
      nudgedAside: [],
    };
  }

  store.snapshot(label ? `Arrange "${label}" as ${layout}` : `Arrange ${nodes.length} notes as ${layout}`, myAgent());
  log(`Arranging ${nodes.length} notes into a ${layout.replace('_', ' ')}${label ? ` — "${label}"` : ''}.`);

  const raw = applyLayout(nodes, layout, store.scene.edges);
  const targets = relaxOverlaps(
    nodes.map((n) => ({ id: n.id, x: raw[n.id].x, y: raw[n.id].y, w: n.w, h: n.h })),
  );

  const { moved, yieldedToHuman } = await animateAgentCursorThrough(nodeIds, { targets });
  const nudgedAside = await clearStrays(nodes.map((n) => n.id), targets);

  let regionId: string | null = null;
  if (label) {
    const region = useSceneStore.getState().upsertRegion(
      { id: `r_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`, label, layout, nodeIds: nodes.map((n) => n.id) },
      myAgent(),
    );
    regionId = region.id;
  }

  return { moved, layout, regionId, label: label ?? null, skipped, yieldedToHuman, nudgedAside };
};

// ---------------------------------------------------------------------------
// find_and_link
// ---------------------------------------------------------------------------

export interface LinkSpec {
  from: string;
  to: string;
  label: string;
}

export const findAndLink = async (
  criterion: string,
  links: LinkSpec[],
): Promise<{ created: number; skipped: LinkSpec[] }> => {
  const store = useSceneStore.getState();
  store.snapshot(`Link notes by "${criterion}"`, myAgent());
  log(`Linking notes by: ${criterion}`);

  const skipped: LinkSpec[] = [];
  let created = 0;

  for (const link of links) {
    const from = useSceneStore.getState().getNode(link.from);
    const to = useSceneStore.getState().getNode(link.to);
    if (!from || !to) {
      skipped.push(link);
      continue;
    }
    await moveCursorTo(centerOf(from).x, centerOf(from).y, { speed: 1.5 });
    setCursorMode('writing');
    await wait(70);
    await moveCursorTo(centerOf(to).x, centerOf(to).y, { speed: 1.05, mode: 'writing' });
    const edge = useSceneStore.getState().addEdge(link.from, link.to, link.label, myAgent());
    if (edge) created += 1;
    else skipped.push(link);
    await wait(60);
  }

  hideCursor();
  return { created, skipped };
};

// ---------------------------------------------------------------------------
// annotate_scene — the agent thinks in space without moving anything
// ---------------------------------------------------------------------------

export const annotateScene = async (
  text: string,
  nodeId?: string,
): Promise<{ annotationId: string; anchoredTo: string | null }> => {
  const store = useSceneStore.getState();
  store.snapshot('Add agent note', myAgent());

  let x: number;
  let y: number;
  const node = nodeId ? store.getNode(nodeId) : undefined;

  if (node) {
    await moveCursorTo(centerOf(node).x, centerOf(node).y, { speed: 1.4 });
    x = node.x + node.w + 24;
    y = node.y - 12;
  } else {
    const c = centroidOf(store.scene.nodes);
    const b = boundsOf(store.scene.nodes);
    x = c.x - 130;
    y = b.y - 150;
    await moveCursorTo(x + 130, y + 40, { speed: 1.4 });
  }

  setCursorMode('writing');
  log(`Annotating: "${text.slice(0, 70)}${text.length > 70 ? '…' : ''}"`);
  await wait(320);
  const annotation = useSceneStore
    .getState()
    .addAnnotation({ text, nodeId: node?.id ?? null, x, y }, myAgent());
  hideCursor(700);
  return { annotationId: annotation.id, anchoredTo: node?.id ?? null };
};

// ---------------------------------------------------------------------------
// summarize_cluster — collapse a spatial group into one labeled node in place
// ---------------------------------------------------------------------------

export const summarizeCluster = async (
  nodeIds: string[],
  summary: string,
): Promise<{ summaryNodeId: string | null; collapsed: number; keptInHand: string[] }> => {
  const store = useSceneStore.getState();
  const nodes = resolveNodes(nodeIds);
  if (nodes.length === 0) return { summaryNodeId: null, collapsed: 0, keptInHand: [] };

  store.snapshot(`Summarise ${nodes.length} notes`, myAgent());
  log(`Collapsing ${nodes.length} notes into "${summary}".`);

  const c = centroidOf(nodes);

  // Gather: every note converges on the centroid before the summary appears.
  await animateAgentCursorThrough(nodeIds, {
    targets: Object.fromEntries(
      nodes.map((n) => [n.id, { x: c.x - n.w / 2, y: c.y - n.h / 2 }]),
    ),
    speed: 1.9,
    grabPause: 40,
    carryDuration: 420,
  });
  await wait(140);

  const summaryNode = useSceneStore.getState().addNode(
    { text: summary, x: c.x - 110, y: c.y - 48, color: PAPER.summary, kind: 'summary' },
    myAgent(),
  );

  // Keep the source notes' relationships: rewire their outside edges to the
  // summary node, then retire the originals.
  const gone = new Set(nodes.map((n) => n.id));
  const outside = useSceneStore
    .getState()
    .scene.edges.filter((e) => gone.has(e.from) !== gone.has(e.to));
  for (const e of outside) {
    const other = gone.has(e.from) ? e.to : e.from;
    useSceneStore.getState().addEdge(summaryNode.id, other, e.label, myAgent());
  }

  // A note somebody is holding is not ours to retire. It stays on the board,
  // and the model is told which, so it does not report work it did not do.
  const keptInHand = useSceneStore.getState().removeNodes([...gone], myAgent());
  return {
    summaryNodeId: summaryNode.id,
    collapsed: nodes.length - keptInHand.length,
    keptInHand,
  };
};

// ---------------------------------------------------------------------------
// reorganize_board — the one gated, destructive whole-board action
// ---------------------------------------------------------------------------

export interface BoardGroup {
  label: string;
  nodeIds: string[];
  layout?: LayoutKind;
}

export const reorganizeBoard = async (
  groups: BoardGroup[],
  rationale: string,
): Promise<{ approved: boolean; groupsApplied: number; moved: number }> => {
  const total = groups.reduce((sum, g) => sum + g.nodeIds.length, 0);
  const approved = await useConfirmStore.getState().request({
    title: 'Reorganise the entire board?',
    body: `The agent wants to restructure ${total} notes into ${groups.length} groups. This moves everything on the canvas at once.`,
    detail: [rationale, ...groups.map((g) => `${g.label} — ${g.nodeIds.length} notes`)],
    confirmLabel: 'Let it reorganise',
    cancelLabel: 'Not now',
  });

  if (!approved) {
    useSceneStore.getState().pushLog('system', 'You declined the whole-board reorganisation.');
    return { approved: false, groupsApplied: 0, moved: 0 };
  }

  useSceneStore.getState().snapshot('Reorganise whole board', myAgent());

  const store = useSceneStore.getState();
  const origin = boundsOf(store.scene.nodes);

  // Lay each group out at the origin first, measure the shape it actually
  // wants, then pack the groups as blocks. Fixed columns would let a wide
  // timeline run straight through the group beside it.
  const GUTTER = 130;
  const ROW_LIMIT = 2600;

  interface Block {
    group: BoardGroup;
    nodes: SceneNode[];
    offsets: Record<string, { x: number; y: number }>;
    w: number;
    h: number;
  }

  const blocks: Block[] = [];
  for (const group of groups) {
    const nodes = resolveNodes(group.nodeIds);
    if (nodes.length === 0) continue;
    const layout = group.layout ?? 'grid';
    const staged = nodes.map((n) => ({ ...n, x: 0, y: 0 }));
    const raw = applyLayout(staged, layout, store.scene.edges);
    const spread = relaxOverlaps(
      nodes.map((n) => ({ id: n.id, x: raw[n.id].x, y: raw[n.id].y, w: n.w, h: n.h })),
    );
    const placed = nodes.map((n) => ({ ...n, x: spread[n.id].x, y: spread[n.id].y }));
    const box = boundsOf(placed);
    const offsets: Record<string, { x: number; y: number }> = {};
    for (const n of placed) offsets[n.id] = { x: n.x - box.x, y: n.y - box.y };
    blocks.push({ group: { ...group, layout }, nodes, offsets, w: box.w, h: box.h });
  }

  let cursorX = origin.x;
  let rowY = origin.y + 180;
  let rowHeight = 0;
  let moved = 0;

  for (const block of blocks) {
    if (cursorX > origin.x && cursorX + block.w > origin.x + ROW_LIMIT) {
      cursorX = origin.x;
      rowY += rowHeight + GUTTER + 60;
      rowHeight = 0;
    }

    const targets: Record<string, { x: number; y: number }> = {};
    for (const n of block.nodes) {
      targets[n.id] = {
        x: cursorX + block.offsets[n.id].x,
        y: rowY + block.offsets[n.id].y,
      };
    }

    const outcome = await animateAgentCursorThrough(block.group.nodeIds, {
      targets,
      speed: 2.6,
      grabPause: 18,
      carryDuration: 430,
    });
    moved += outcome.moved;

    useSceneStore.getState().upsertRegion(
      {
        id: `r_${block.group.label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
        label: block.group.label,
        layout: block.group.layout ?? 'grid',
        nodeIds: block.nodes.map((n) => n.id),
      },
      myAgent(),
    );

    cursorX += block.w + GUTTER;
    rowHeight = Math.max(rowHeight, block.h);
  }

  hideCursor();
  return { approved: true, groupsApplied: groups.length, moved };
};

// ---------------------------------------------------------------------------
// add_notes — lets the agent contribute material, not just rearrange it
// ---------------------------------------------------------------------------

export const addNotes = async (
  texts: string[],
  near?: string,
): Promise<{ created: string[] }> => {
  const store = useSceneStore.getState();
  store.snapshot(`Add ${texts.length} note${texts.length === 1 ? '' : 's'}`, myAgent());

  const anchorNode = near ? store.getNode(near) : undefined;
  const b = boundsOf(store.scene.nodes);
  const baseX = anchorNode ? anchorNode.x + anchorNode.w + 60 : b.x + b.w + 80;
  const baseY = anchorNode ? anchorNode.y : b.y;

  const created: string[] = [];
  for (let i = 0; i < texts.length; i += 1) {
    const x = baseX + (i % 2) * 216;
    const y = baseY + Math.floor(i / 2) * 108;
    await moveCursorTo(x + 88, y + 42, { speed: 1.6, mode: 'writing' });
    const node = useSceneStore.getState().addNode({ text: texts[i], x, y, color: PAPER.agentNote }, myAgent());
    created.push(node.id);
    await wait(110);
  }
  log(`Added ${created.length} note${created.length === 1 ? '' : 's'}.`);
  hideCursor();
  return { created };
};
