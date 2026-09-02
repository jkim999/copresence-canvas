import { useSceneStore } from '../state/sceneStore';
import { isAgent, kindOf, myAgent } from '../state/actors';
import { journalCursor } from '../state/journal';
import { LAYOUT_KINDS, type ActorId, type LayoutKind } from '../state/types';
import { boundsOf } from './layout';
import { boardContext } from './boardContext';
import { changesSince } from './changes';
import { crediting } from './credit';
import { announce } from './intent';
import {
  addNotes,
  annotateScene,
  arrangeRegion,
  findAndLink,
  reorganizeBoard,
  summarizeCluster,
} from './actions';
import type { ToolDefinition } from './webmcp';
import { withAgentBody } from './body';

const round = (n: number): number => Math.round(n);

const asStringArray = (value: unknown, field: string): string[] => {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new Error(`${field} must be an array of strings`);
  }
  return value as string[];
};

const asLayout = (value: unknown): LayoutKind => {
  if (typeof value !== 'string' || !LAYOUT_KINDS.includes(value as LayoutKind)) {
    throw new Error(`layout must be one of: ${LAYOUT_KINDS.join(', ')}`);
  }
  return value as LayoutKind;
};

/**
 * `get_scene` returns structured JSON, never a screenshot. That is what makes
 * the token story real and the agent reliable: it reads ~30 notes as a few
 * hundred tokens of text it can reason about by id.
 */
const readScene = () => {
  const { scene } = useSceneStore.getState();
  const bounds = boundsOf(scene.nodes);
  const who = crediting();
  const credit = (by: ActorId) => {
    const c = who(by);
    return { lastEditedBy: c.kind, seat: c.seat, mine: c.mine };
  };
  return {
    nodes: scene.nodes.map((n) => ({
      id: n.id,
      text: n.text,
      x: round(n.x),
      y: round(n.y),
      w: n.w,
      h: n.h,
      kind: n.kind,
      cluster: n.cluster,
      ...credit(n.lastEditedBy),
    })),
    edges: scene.edges.map((e) => ({
      id: e.id,
      from: e.from,
      to: e.to,
      label: e.label,
      ...credit(e.lastEditedBy),
    })),
    regions: scene.regions.map((r) => ({
      id: r.id,
      label: r.label,
      layout: r.layout,
      nodeIds: r.nodeIds,
    })),
    annotations: scene.annotations.map((a) => ({
      id: a.id,
      text: a.text,
      nodeId: a.nodeId,
    })),
    bounds: { x: round(bounds.x), y: round(bounds.y), w: round(bounds.w), h: round(bounds.h) },
    // A bookmark for this exact reading. Hand it to what_changed later and you
    // are told precisely what happened in between, instead of having to keep
    // this whole payload around and diff it yourself.
    asOf: journalCursor(),
    counts: {
      nodes: scene.nodes.length,
      edges: scene.edges.length,
      regions: scene.regions.length,
      annotations: scene.annotations.length,
    },
    note:
      'Coordinates are canvas units, y grows downward. Never send pixel positions back — ' +
      'address notes by id and state the layout you want; the page computes the geometry. ' +
      'Keep `asOf` and pass it to what_changed rather than re-reading and diffing this.',
  };
};

export const buildTools = (): ToolDefinition[] => [
  {
    name: 'get_scene',
    description:
      'Read the live canvas: every sticky note with its id and text, plus edges, regions, ' +
      'annotations and overall bounds, as structured JSON. Call this first — you cannot act ' +
      'on the board until you have seen it. This state lives only in the page; no server has it. ' +
      'Every note and edge carries `seat` (which participant last touched it) and `mine` (true ' +
      'when it was you or the human you sit beside), so you can tell your own work from a ' +
      'peer\'s without diffing snapshots. Re-read this after any pause: other people and their ' +
      'agents are editing the same board and nothing notifies you when they do.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, title: 'Read the canvas' },
    execute: async () => readScene(),
  },

  {
    name: 'what_changed',
    description:
      'Find out what happened on this board while you were not looking. Pass the `asOf` or ' +
      '`cursor` you were given last time as `since`, and you get back every change made in ' +
      'between — who made it, what it was, and which notes it touched — instead of having to ' +
      'keep an old get_scene and diff it by hand. Anything marked `mine: false` was another ' +
      'participant or their agent: it is their work, not a stale copy of yours, so read it ' +
      'before you rearrange or undo it. Call this after any pause, and after any call that ' +
      'took longer than you expected. Calling it with no `since` gives you a starting cursor ' +
      'rather than the whole session.',
    inputSchema: {
      type: 'object',
      properties: {
        since: {
          type: 'number',
          description: 'The cursor from a previous what_changed, or `asOf` from get_scene.',
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, title: 'What changed since I last looked' },
    execute: async (args) =>
      changesSince(typeof args?.since === 'number' ? args.since : undefined),
  },

  {
    name: 'get_board_context',
    description:
      'Find out who you are and who else is on this board. Returns your own seat name, the ' +
      'seat name and held notes of every other person connected, whether each of them has an ' +
      'agent of their own, and the rule that governs a whole-board change. Call this before ' +
      'your first change on any board you have not seen: without it you cannot tell your own ' +
      'work from a peer\'s, and you cannot interpret a refusal, which names a seat ' +
      '("Ochre declined") rather than describing one. It also reports whether this tab is in ' +
      'the background, which is the usual reason a call takes far longer than you expect.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, title: 'Who else is on this board' },
    execute: async () => boardContext(),
  },

  {
    name: 'get_human_activity',
    description:
      'See what the human has been doing on the canvas alongside you: which notes they ' +
      'have added, edited or moved recently, and which notes they are physically holding ' +
      'right now. You are both working on this board at the same time — check this before ' +
      'rearranging an area, and never move a note the human is currently holding. Other ' +
      'people, each with an agent of their own, may also be on this board; anything they ' +
      'or their agents have hold of is reported here and is not yours to move.',
    inputSchema: {
      type: 'object',
      properties: {
        sinceSeconds: {
          type: 'number',
          description: 'How far back to look, in seconds. Defaults to 120.',
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, title: 'See what the human is doing' },
    execute: async (args) => {
      const raw = typeof args?.sinceSeconds === 'number' ? args.sinceSeconds : 120;
      const window = Math.min(3600, Math.max(5, raw)) * 1000;
      const state = useSceneStore.getState();
      const cutoff = Date.now() - window;

      const touched = state.scene.nodes
        .filter((n) => kindOf(n.lastEditedBy) === 'human' && n.editedAt > 0 && n.editedAt >= cutoff)
        .sort((a, b) => b.editedAt - a.editedAt)
        .map((n) => ({
          id: n.id,
          text: n.text,
          secondsAgo: Math.round((Date.now() - n.editedAt) / 1000),
        }));

      // Agents take grip too, so "somebody has hold of this" and "a *person*
      // has hold of this" are no longer the same sentence. Only the second one
      // is what this tool exists to report; calling a machine's grip a human's
      // would have the agent deferring to nobody.
      const notesOf = (holder: (by: ActorId) => boolean) =>
        Object.entries(state.grip)
          .filter(([, by]) => holder(by))
          .map(([id]) => state.getNode(id))
          .filter((n): n is NonNullable<typeof n> => Boolean(n))
          .map((n) => ({ id: n.id, text: n.text }));

      const holding = notesOf((by) => !isAgent(by));
      const machines = notesOf((by) => isAgent(by) && by !== myAgent());

      return {
        holdingRightNow: holding,
        heldByOtherAgents: machines,
        recentlyTouched: touched.slice(0, 20),
        windowSeconds: Math.round(window / 1000),
        note:
          holding.length > 0
            ? 'The human is holding those notes right now. Leave them alone and work elsewhere.'
            : machines.length > 0
              ? 'Another agent has hold of those notes. It is working on this board too — ' +
                'leave them where they are and organise somewhere else.'
              : touched.length > 0
                ? 'The human is actively working on the notes listed. Consider helping around ' +
                  'them rather than rearranging the area they are in.'
                : 'The human has not changed anything recently. The board is yours to organise.',
      };
    },
  },

  {
    name: 'arrange_region',
    description:
      'Physically reposition a set of notes into a spatial layout. You choose WHAT belongs ' +
      'together and the shape it should take; the page computes where each note goes and ' +
      'animates a labelled agent cursor to move them. Use "cluster" for affinity groups, ' +
      '"timeline_horizontal" for anything sequenced or dated, "grid" for a matrix or ' +
      'even survey, "hierarchy" for parent/child structure. Pass a label to title the group.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Ids of the notes to arrange, from get_scene.',
        },
        layout: {
          type: 'string',
          enum: [...LAYOUT_KINDS],
          description: 'The spatial shape to impose on the group.',
        },
        label: {
          type: 'string',
          description: 'Optional title for the group, shown on the canvas.',
        },
      },
      required: ['nodeIds', 'layout'],
      additionalProperties: false,
    },
    annotations: { title: 'Arrange notes in space' },
    execute: async (args) => {
      const nodeIds = asStringArray(args?.nodeIds, 'nodeIds');
      const layout = asLayout(args?.layout);
      const label = typeof args?.label === 'string' ? args.label : undefined;
      if (nodeIds.length === 0) throw new Error('nodeIds must not be empty');
      const result = await withAgentBody(() =>
        announce(
          {
            verb: 'arranging',
            what: `${nodeIds.length} note${nodeIds.length === 1 ? '' : 's'}${
              label ? ` as "${label}"` : ''
            } into a ${layout.replace(/_/g, ' ')}`,
            ids: nodeIds,
          },
          () => arrangeRegion(nodeIds, layout, label),
        ),
      );
      return {
        moved: result.moved,
        layout: result.layout,
        regionId: result.regionId,
        label: result.label,
        unknownIds: result.skipped,
        // The human grabbed these mid-move and the agent let go. Leave them be.
        yieldedToHuman: result.yieldedToHuman,
        // Unrelated notes that were sitting where the group had to go.
        nudgedAside: result.nudgedAside,
        ...(result.yieldedToHuman.length > 0
          ? {
              note:
                'The human took those notes while you were moving them, so they are ' +
                'where the human put them. Do not move them back unless asked.',
            }
          : {}),
      };
    },
  },

  {
    name: 'find_and_link',
    description:
      'Draw labelled connections between notes you judge to be related. Read the note text ' +
      'with get_scene, decide the pairs yourself, and state the criterion you used ' +
      '(e.g. "cause and effect", "evidence supports hypothesis"). The agent cursor draws each edge.',
    inputSchema: {
      type: 'object',
      properties: {
        criterion: {
          type: 'string',
          description: 'The relationship you are asserting, in a few words.',
        },
        links: {
          type: 'array',
          description: 'The pairs to connect.',
          items: {
            type: 'object',
            properties: {
              from: { type: 'string', description: 'Source note id.' },
              to: { type: 'string', description: 'Target note id.' },
              label: { type: 'string', description: 'Short label for this specific edge.' },
            },
            required: ['from', 'to', 'label'],
            additionalProperties: false,
          },
        },
      },
      required: ['criterion', 'links'],
      additionalProperties: false,
    },
    annotations: { title: 'Link related notes' },
    execute: async (args) => {
      const criterion = String(args?.criterion ?? '').trim();
      if (!criterion) throw new Error('criterion is required');
      if (!Array.isArray(args?.links) || args.links.length === 0) {
        throw new Error('links must be a non-empty array');
      }
      const links: { from: string; to: string; label: string }[] = args.links.map((l: any) => ({
        from: String(l?.from ?? ''),
        to: String(l?.to ?? ''),
        label: String(l?.label ?? ''),
      }));
      const result = await withAgentBody(() =>
        announce(
          {
            verb: 'linking',
            what: `${links.length} pair${links.length === 1 ? '' : 's'} by "${criterion}"`,
            ids: [...new Set(links.flatMap((l) => [l.from, l.to]))],
          },
          () => findAndLink(criterion, links),
        ),
      );
      // Each skip carries its own reason. A bare count told an agent only that
      // something was wrong, and "the ids do not exist", "those two are already
      // connected" and "you linked a note to itself" need three different
      // corrections — so guessing, or retrying unchanged, was the only move left.
      return { created: result.created, skipped: result.skipped, criterion };
    },
  },

  {
    name: 'annotate_scene',
    description:
      'Attach a floating comment to the canvas without moving anything — an observation, a ' +
      'question, a gap you noticed. Anchor it to a note with nodeId, or leave nodeId out to ' +
      'pin it above the whole board. Cheap, non-destructive, and safe to use while the human works.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The comment to leave on the canvas.' },
        nodeId: { type: 'string', description: 'Optional note id to anchor the comment to.' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    annotations: { title: 'Leave a note on the canvas' },
    execute: async (args) => {
      const text = String(args?.text ?? '').trim();
      if (!text) throw new Error('text is required');
      const nodeId = typeof args?.nodeId === 'string' ? args.nodeId : undefined;
      return withAgentBody(() =>
        announce(
          { verb: 'writing', what: 'a comment on the board', ids: nodeId ? [nodeId] : [] },
          () => annotateScene(text, nodeId),
        ),
      );
    },
  },

  {
    name: 'summarize_cluster',
    description:
      'Collapse a group of notes into a single labelled summary note in the same place on the ' +
      'canvas. The originals gather to the centre and are replaced; edges to the outside world ' +
      'are rewired to the summary. Use this to reduce a solved area of the board to one idea.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Ids of the notes to collapse.',
        },
        summary: { type: 'string', description: 'The text of the resulting summary note.' },
      },
      required: ['nodeIds', 'summary'],
      additionalProperties: false,
    },
    annotations: { destructiveHint: true, title: 'Collapse a group into one note' },
    execute: async (args) => {
      const nodeIds = asStringArray(args?.nodeIds, 'nodeIds');
      const summary = String(args?.summary ?? '').trim();
      if (nodeIds.length === 0) throw new Error('nodeIds must not be empty');
      if (!summary) throw new Error('summary is required');
      return withAgentBody(() =>
        announce(
          {
            verb: 'collapsing',
            what: `${nodeIds.length} notes into "${summary}"`,
            ids: nodeIds,
          },
          () => summarizeCluster(nodeIds, summary),
        ),
      );
    },
  },

  {
    name: 'add_notes',
    description:
      'Write new sticky notes onto the canvas — missing evidence, open questions, next steps. ' +
      'Notes appear in the agent colour so the human can see exactly what you contributed. ' +
      'This call is NOT idempotent, and it is paced by an animation, so it can take tens of ' +
      'seconds in a background tab. Never send it again because it seems slow — it has not ' +
      'been dropped. If you do repeat yourself, text you wrote in the last minute is refused ' +
      'rather than written twice, and comes back under `alreadyPresent`.',
    inputSchema: {
      type: 'object',
      properties: {
        texts: {
          type: 'array',
          items: { type: 'string' },
          description: 'One string per note. Keep each under ~80 characters.',
        },
        near: { type: 'string', description: 'Optional note id to place them beside.' },
      },
      required: ['texts'],
      additionalProperties: false,
    },
    annotations: { title: 'Add notes to the canvas' },
    execute: async (args) => {
      const texts = asStringArray(args?.texts, 'texts');
      if (texts.length === 0) throw new Error('texts must not be empty');
      if (texts.length > 12) throw new Error('add at most 12 notes at a time');
      const near = typeof args?.near === 'string' ? args.near : undefined;
      return withAgentBody(() =>
        announce(
          {
            verb: 'adding',
            what: `${texts.length} note${texts.length === 1 ? '' : 's'}`,
            ids: near ? [near] : [],
          },
          () => addNotes(texts, near),
        ),
      );
    },
  },

  {
    name: 'reorganize_board',
    description:
      'Restructure the WHOLE board into named groups at once. This is the one destructive ' +
      'action: it moves every note you list, so the human is asked to approve it first and may ' +
      'decline. Give a short rationale — they will read it before deciding. Prefer ' +
      'arrange_region for anything smaller than a full restructure.',
    inputSchema: {
      type: 'object',
      properties: {
        rationale: {
          type: 'string',
          description: 'One sentence on why this structure is better. Shown to the human.',
        },
        groups: {
          type: 'array',
          description: 'The groups to build, laid out left to right.',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'Group title shown on the canvas.' },
              nodeIds: { type: 'array', items: { type: 'string' } },
              layout: { type: 'string', enum: [...LAYOUT_KINDS] },
            },
            required: ['label', 'nodeIds'],
            additionalProperties: false,
          },
        },
      },
      required: ['rationale', 'groups'],
      additionalProperties: false,
    },
    annotations: { destructiveHint: true, title: 'Reorganise the whole board (asks first)' },
    execute: async (args) => {
      const rationale = String(args?.rationale ?? '').trim();
      if (!rationale) throw new Error('rationale is required');
      if (!Array.isArray(args?.groups) || args.groups.length === 0) {
        throw new Error('groups must be a non-empty array');
      }
      const groups: { label: string; nodeIds: string[]; layout?: LayoutKind }[] =
        args.groups.map((g: any) => ({
          label: String(g?.label ?? 'Group'),
          nodeIds: asStringArray(g?.nodeIds, 'groups[].nodeIds'),
          layout: g?.layout ? asLayout(g.layout) : undefined,
        }));
      const total = groups.reduce((sum, g) => sum + g.nodeIds.length, 0);
      const result = await withAgentBody(() =>
        announce(
          {
            verb: 'proposing',
            what:
              `a reorganisation of ${total} notes into ${groups.length} ` +
              `group${groups.length === 1 ? '' : 's'}`,
            ids: groups.flatMap((g) => g.nodeIds),
          },
          () => reorganizeBoard(groups, rationale),
        ),
      );
      if (result.approved) return result;
      return {
        ...result,
        message:
          result.refusedBy !== null
            ? `${result.refusedBy} declined. Everyone on this board has to agree to a ` +
              'whole-board change, and one refusal is enough. Do not retry without new reasoning.'
            : 'Nobody on the board answered in time, so nothing was moved. Do not retry ' +
              'without new reasoning.',
      };
    },
  },

  {
    name: 'undo_last_agent_action',
    description:
      'Revert the most recent change you made to the canvas, restoring the board to how it ' +
      'looked before. Use this when the human says your last move was wrong.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { title: 'Undo my last change' },
    execute: async () => {
      const entry = useSceneStore.getState().undoLastAgentAction();
      return entry
        ? { undone: entry.label, at: entry.at }
        : { undone: null, message: 'No agent action left to undo.' };
    },
  },
];
