import { useSceneStore } from '../state/sceneStore';
import { PAPER } from '../data/palette';
import type { ActorId, LayoutKind, SceneNode } from '../state/types';
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
  whoTook,
  type TweenOutcome,
} from './motion';
import { crediting } from './credit';
import { useConfirmStore } from './confirm';
import { me, myAgent, seatName } from '../state/actors';
import { stopRequested } from './intent';
import { splitRepeats, type Repeat } from './dedupe';

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

/**
 * The agent's own narration, for the things the record cannot derive.
 *
 * It used to narrate every act — "Arranging 3 notes into a grid" — and the
 * journal now derives that from the board itself, more accurately and for every
 * participant rather than just this one. Two accounts of one act, in slightly
 * different words, is less legible than one. What survives here is what leaves
 * no trace on the board: a refusal, and work declined as a duplicate. A change
 * nobody can see in the scene is the only kind worth saying out loud.
 */
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
  /** notes never reached, because the human called the act off part way. */
  notReached: string[];
  /** whether the human stopped this act before it finished. */
  stopped: boolean;
}

export const animateAgentCursorThrough = async (
  nodeIds: string[],
  options: CursorThroughOptions = {},
): Promise<CursorThroughResult> => {
  const { targets, speed = 1.7, grabPause = 55, carryDuration = 440, onVisit } = options;
  const nodes = resolveNodes(nodeIds);
  if (nodes.length === 0) {
    return { moved: 0, yieldedToHuman: [], notReached: [], stopped: false };
  }

  const path = visitOrder(nodes, cursorPoint());
  const carries: Promise<{ id: string; outcome: TweenOutcome }>[] = [];
  let visitedWithoutTarget = 0;

  let stoppedAt = -1;
  for (const [index, node] of path.entries()) {
    // Checked between notes rather than mid-flight. A note dropped halfway to
    // somewhere is a position nobody chose; a note that never left is exactly
    // where its owner last put it.
    if (stopRequested()) {
      stoppedAt = index;
      break;
    }
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
        tweenNodeTo(node.id, target.x, target.y, carryDuration).then((outcome) => ({
          id: node.id,
          outcome,
        })),
      );
    } else {
      visitedWithoutTarget += 1;
    }
    setCursorMode('travelling');
  }

  const settled = await Promise.all(carries);
  hideCursor();
  // Only a hand on the note counts as yielding. A tween the agent replaced is
  // its own business and must not be reported to the model as a refusal.
  const yieldedToHuman = settled.filter((c) => c.outcome === 'yielded').map((c) => c.id);
  announceYields(yieldedToHuman);
  const notReached = stoppedAt < 0 ? [] : path.slice(stoppedAt).map((n) => n.id);
  if (stoppedAt >= 0) {
    // Attributed to the human, because the human did it. This is the one line
    // in the record where a person overruled a machine mid-act, and burying it
    // under the agent's name would make the record say the opposite.
    useSceneStore
      .getState()
      .pushLog(
        me(),
        `Stopped the agent after ${stoppedAt} of ${path.length} note${
          path.length === 1 ? '' : 's'
        }.`,
      );
  }
  return {
    moved: settled.filter((c) => c.outcome === 'landed').length + visitedWithoutTarget,
    yieldedToHuman,
    notReached,
    stopped: stoppedAt >= 0,
  };
};

/**
 * Tell the human when the page let go of a note on their behalf.
 *
 * This is the moment the whole canvas is built around — a hand closes on a note
 * and the machine gives it up — and it was reported only to the agent. The
 * person it was done for felt a note not moving and was told nothing, while the
 * model got a sentence about it. That is the wrong way round: the human is the
 * one being defended.
 *
 * Named, because a seat name is what everything else here says. "Someone took
 * it" is the half-answer this board keeps having to fix.
 */
const announceYields = (ids: readonly string[]): void => {
  if (ids.length === 0) return;

  const byTaker = new Map<ActorId, number>();
  for (const id of ids) {
    const taker = whoTook(id);
    if (taker === null) continue;
    byTaker.set(taker, (byTaker.get(taker) ?? 0) + 1);
  }
  if (byTaker.size === 0) return;

  const credit = crediting([...byTaker.keys()]);
  for (const [taker, n] of byTaker) {
    const notes = n === 1 ? 'a note' : `${n} notes`;
    const who = taker === me() ? 'you had hold of' : `${credit(taker).seat} had hold of`;
    // A notice, not the agent narrating: the page did this, and it did it for
    // the person reading.
    useSceneStore
      .getState()
      .pushLog('system', `Your agent let go of ${notes} — ${who} ${n === 1 ? 'it' : 'them'}.`);
  }
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
  /** notes left where they were, because the human called the act off. */
  notReached: string[];
  stopped: boolean;
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
      notReached: [],
      stopped: false,
    };
  }

  store.snapshot(label ? `Arrange "${label}" as ${layout}` : `Arrange ${nodes.length} notes as ${layout}`, myAgent());

  const raw = applyLayout(nodes, layout, store.scene.edges);
  const targets = relaxOverlaps(
    nodes.map((n) => ({ id: n.id, x: raw[n.id].x, y: raw[n.id].y, w: n.w, h: n.h })),
  );

  const { moved, yieldedToHuman, notReached, stopped } = await animateAgentCursorThrough(
    nodeIds,
    { targets },
  );
  // Sweeping bystanders aside is tidying up after an arrangement. Once the act
  // has been called off there is no arrangement to tidy around, and shoving
  // uninvolved notes about after being told to stop is the opposite of obeying.
  const nudgedAside = stopped ? [] : await clearStrays(nodes.map((n) => n.id), targets);

  let regionId: string | null = null;
  // A labelled region drawn around notes that were never gathered is a claim
  // about the board that the board does not support. Stopped means stopped.
  if (label && !stopped) {
    const region = useSceneStore.getState().upsertRegion(
      { id: `r_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`, label, layout, nodeIds: nodes.map((n) => n.id) },
      myAgent(),
    );
    regionId = region.id;
  }

  return {
    moved,
    layout,
    regionId,
    label: label ?? null,
    skipped,
    yieldedToHuman,
    nudgedAside,
    notReached,
    stopped,
  };
};

// ---------------------------------------------------------------------------
// find_and_link
// ---------------------------------------------------------------------------

export interface LinkSpec {
  from: string;
  to: string;
  label: string;
}

/**
 * Why a link was not drawn.
 *
 * `{ created: 0, skipped: 4 }` was the old answer, and it is the shape of a
 * result an agent cannot act on: "the ids were wrong", "those notes are already
 * connected" and "you asked to link a note to itself" are three different
 * mistakes with three different corrections, and collapsing them into a count
 * leaves retrying blind as the only available move.
 */
export type SkipReason = 'no such note' | 'already linked' | 'same note twice';

export interface SkippedLink extends LinkSpec {
  reason: SkipReason;
  /** Which of the two ids the board could not find, when that is the problem. */
  missing?: string[];
}

export const findAndLink = async (
  criterion: string,
  links: LinkSpec[],
): Promise<{ created: number; skipped: SkippedLink[] }> => {
  const store = useSceneStore.getState();
  store.snapshot(`Link notes by "${criterion}"`, myAgent());

  const skipped: SkippedLink[] = [];
  let created = 0;

  for (const link of links) {
    const from = useSceneStore.getState().getNode(link.from);
    const to = useSceneStore.getState().getNode(link.to);
    if (!from || !to) {
      const missing = [!from ? link.from : null, !to ? link.to : null].filter(
        (id): id is string => id !== null,
      );
      skipped.push({ ...link, reason: 'no such note', missing });
      continue;
    }
    if (link.from === link.to) {
      skipped.push({ ...link, reason: 'same note twice' });
      continue;
    }
    await moveCursorTo(centerOf(from).x, centerOf(from).y, { speed: 1.5 });
    setCursorMode('writing');
    await wait(70);
    await moveCursorTo(centerOf(to).x, centerOf(to).y, { speed: 1.05, mode: 'writing' });
    const edge = useSceneStore.getState().addEdge(link.from, link.to, link.label, myAgent());
    if (edge) created += 1;
    // The store refuses a duplicate in either direction, and a self-link is
    // already caught above, so this is the one case left.
    else skipped.push({ ...link, reason: 'already linked' });
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
): Promise<{
  approved: boolean;
  groupsApplied: number;
  moved: number;
  refusedBy: string | null;
  stopped: boolean;
  /** groups never laid out, because the human called the act off. */
  groupsNotReached: string[];
}> => {
  const total = groups.reduce((sum, g) => sum + g.nodeIds.length, 0);
  // Everyone on this board is about to have their notes moved, so everyone is
  // asked. Any one of them can stop it; none of them can commit the others.
  const verdict = await useConfirmStore.getState().askEveryone({
    title: 'Reorganise the entire board?',
    body: `The agent wants to restructure ${total} notes into ${groups.length} group${groups.length === 1 ? '' : 's'}. This moves everything on the canvas at once.`,
    detail: [rationale, ...groups.map((g) => `${g.label} — ${g.nodeIds.length} notes`)],
    confirmLabel: 'Let it reorganise',
    cancelLabel: 'Not now',
  });

  if (!verdict.approved) {
    const who =
      verdict.declinedBy === 'you'
        ? 'You'
        : verdict.declinedBy !== null
          ? seatName(verdict.declinedBy)
          : null;
    const said =
      who !== null
        ? `${who} declined the whole-board reorganisation.`
        : `Nobody answered on ${verdict.unanswered.map(seatName).join(', ')}'s screen, so the board was left alone.`;
    useSceneStore.getState().pushLog('system', said);
    return {
      approved: false,
      groupsApplied: 0,
      moved: 0,
      refusedBy: who,
      stopped: false,
      groupsNotReached: [],
    };
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
  let groupsApplied = 0;
  let stoppedAfter = -1;

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
    // The board is restructured a group at a time, so stopping leaves the
    // groups already laid out standing and the rest untouched. Half-gathering
    // the group that was interrupted is why the region below is skipped too.
    if (outcome.stopped) {
      stoppedAfter = groupsApplied;
      break;
    }
    groupsApplied += 1;

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
  return {
    approved: true,
    groupsApplied,
    moved,
    refusedBy: null,
    stopped: stoppedAfter >= 0,
    groupsNotReached: stoppedAfter < 0 ? [] : groups.slice(stoppedAfter).map((g) => g.label),
  };
};

// ---------------------------------------------------------------------------
// add_notes — lets the agent contribute material, not just rearrange it
// ---------------------------------------------------------------------------

export const addNotes = async (
  texts: string[],
  near?: string,
): Promise<{ created: string[]; alreadyPresent: Repeat[]; note?: string }> => {
  const store = useSceneStore.getState();

  // A retry after a client-side timeout arrives here as the same texts a second
  // time, and the first call is usually still in flight rather than lost. The
  // page refuses the repeat and says which note it matched, instead of quietly
  // writing a duplicate the human then has to find and delete.
  const { fresh, repeats } = splitRepeats(texts, store.scene.nodes, myAgent(), Date.now());
  if (fresh.length === 0) {
    log(`Already written — ${repeats.length} note${repeats.length === 1 ? '' : 's'} kept.`);
    return {
      created: [],
      alreadyPresent: repeats,
      note:
        'Every one of those notes is already on the board — you wrote them moments ago. ' +
        'Nothing was added. If the earlier call seemed not to return, it was being paced ' +
        'by an animation, not dropped.',
    };
  }

  store.snapshot(`Add ${fresh.length} note${fresh.length === 1 ? '' : 's'}`, myAgent());

  const anchorNode = near ? store.getNode(near) : undefined;
  const b = boundsOf(store.scene.nodes);
  const baseX = anchorNode ? anchorNode.x + anchorNode.w + 60 : b.x + b.w + 80;
  const baseY = anchorNode ? anchorNode.y : b.y;

  const created: string[] = [];
  for (let i = 0; i < fresh.length; i += 1) {
    const x = baseX + (i % 2) * 216;
    const y = baseY + Math.floor(i / 2) * 108;
    await moveCursorTo(x + 88, y + 42, { speed: 1.6, mode: 'writing' });
    const node = useSceneStore.getState().addNode({ text: fresh[i], x, y, color: PAPER.agentNote }, myAgent());
    created.push(node.id);
    await wait(110);
  }
  hideCursor();
  return {
    created,
    alreadyPresent: repeats,
    ...(repeats.length > 0
      ? {
          note:
            `${repeats.length} of those were already on the board from a moment ago and ` +
            'were not written twice. The rest were added.',
        }
      : {}),
  };
};
