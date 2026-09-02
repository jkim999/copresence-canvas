import { create } from 'zustand';
import type {
  ActorId,
  Annotation,
  HistoryEntry,
  LayoutKind,
  LogEntry,
  Region,
  Scene,
  SceneEdge,
  SceneNode,
} from './types';
import { seedScene } from '../data/seed';
import { sceneFromTexts } from '../data/importBoard';
import { LOCAL_HUMAN, isAgent } from './actors';
import { currentIntent } from '../agent/intent';

let counter = 0;
/**
 * The random tail is load-bearing, exactly as it is for actor ids: a clock and
 * a counter are both per-tab, so two tabs adding a note in the same millisecond
 * mint the same id — and the CRDT then merges two different notes into one.
 */
export const uid = (prefix: string): string => {
  counter += 1;
  const noise = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${noise}`;
};

const HISTORY_LIMIT = 40;
const LOG_LIMIT = 60;

export interface NewNodeSpec {
  text: string;
  x: number;
  y: number;
  color?: string;
  kind?: SceneNode['kind'];
}

interface SceneState {
  scene: Scene;
  history: HistoryEntry[];
  log: LogEntry[];
  /**
   * Who is physically holding which note right now, keyed by node id. Nobody
   * may move, retitle, recolour or delete a note in someone else's hand — this
   * is the invariant that makes concurrent editing safe, and it has to name the
   * holder, not just the note, once there can be more than one pair of hands.
   */
  grip: Record<string, ActorId>;
  /**
   * What each local actor's hands are on, as *asked for* rather than as
   * resolved. `grip` is the answer everyone agrees on; this is the question
   * this tab keeps asking. Losing a simultaneous grab must not retract the
   * claim, or the loser never contends again when the winner lets go.
   */
  claims: Record<ActorId, string[]>;
  showProvenance: boolean;
  /** bumped whenever the whole board is replaced, so the canvas can refit. */
  epoch: number;
  /**
   * Bumped whenever a rewind restores a snapshot.
   *
   * The journal derives what happened by diffing the scene, which is what makes
   * it impossible to forget an entry — and what makes a rewind lie. Restored
   * notes carry whoever last edited them, so the diff reads as those people
   * having just moved their work back, timestamped now. A live rewind produced
   * four such lines naming three colleagues who had done nothing.
   *
   * Separate from `epoch` because a rewind is not a new board: it must not
   * refit the viewport out from under someone who was looking at a corner of it.
   */
  rewound: number;

  // --- snapshots / undo -------------------------------------------------
  snapshot: (label: string, by: ActorId, act?: number) => void;
  undoLast: () => HistoryEntry | null;
  undoLastAgentAction: () => HistoryEntry | null;
  /**
   * Restore the board as it stood before a particular announced act, and drop
   * every snapshot from that one on. Returns what it went back to, or null when
   * no snapshot belongs to that act.
   */
  revertToAct: (act: number) => HistoryEntry | null;

  // --- reads ------------------------------------------------------------
  getNode: (id: string) => SceneNode | undefined;

  // --- human + agent mutations -----------------------------------------
  moveNode: (id: string, x: number, y: number, by: ActorId) => void;
  moveNodes: (positions: Record<string, { x: number; y: number }>, by: ActorId) => void;
  addNode: (spec: NewNodeSpec, by: ActorId) => SceneNode;
  addNodes: (specs: NewNodeSpec[], by: ActorId) => SceneNode[];
  setNodeText: (id: string, text: string, by: ActorId) => void;
  setNodeColor: (id: string, color: string, by: ActorId) => void;
  /** Deletes what it can and returns the ids it refused, held by someone else. */
  removeNodes: (ids: string[], by: ActorId) => string[];
  setSelected: (id: string, selected: boolean) => void;
  clearSelection: () => void;

  addEdge: (from: string, to: string, label: string, by: ActorId) => SceneEdge | null;
  removeEdges: (ids: string[]) => void;

  addAnnotation: (a: Omit<Annotation, 'id' | 'lastEditedBy' | 'editedAt'>, by: ActorId) => Annotation;
  removeAnnotation: (id: string) => void;

  upsertRegion: (r: Omit<Region, 'lastEditedBy' | 'editedAt'>, by: ActorId) => Region;
  removeRegion: (id: string) => void;

  /** Replace everything `by` is holding. A note already in another hand is not taken. */
  setGrip: (nodeIds: string[], by: ActorId) => void;
  clearGrip: () => void;
  heldBy: (nodeId: string) => ActorId | null;
  toggleProvenance: () => void;
  pushLog: (by: ActorId | 'system', text: string) => void;
  resetScene: () => void;
  /** Replace the board with the human's own material. */
  loadTexts: (texts: string[]) => void;
  /** Replace the board with one that arrived whole, from a shared link. */
  loadScene: (scene: Scene, note?: string) => void;
}

/** A note is off limits when someone *else* has a hand on it. */
const heldByOther = (grip: Record<string, ActorId>, nodeId: string, by: ActorId): boolean => {
  const holder = grip[nodeId];
  return holder !== undefined && holder !== by;
};

const cloneScene = (s: Scene): Scene => ({
  nodes: s.nodes.map((n) => ({ ...n })),
  edges: s.edges.map((e) => ({ ...e })),
  annotations: s.annotations.map((a) => ({ ...a })),
  regions: s.regions.map((r) => ({ ...r, nodeIds: [...r.nodeIds] })),
});

export const useSceneStore = create<SceneState>((set, get) => ({
  scene: seedScene(),
  history: [],
  rewound: 0,
  log: [{ id: uid('log'), at: Date.now(), by: 'system', text: 'Canvas ready.' }],
  grip: {},
  claims: {},
  showProvenance: true,
  epoch: 0,

  snapshot: (label, by, act) =>
    set((s) => ({
      history: [
        ...s.history.slice(-(HISTORY_LIMIT - 1)),
        {
          id: uid('h'),
          label,
          by,
          at: Date.now(),
          scene: cloneScene(s.scene),
          // Stamped from the running announcement when the caller does not name
          // one, exactly as the journal stamps its facts — so a snapshot and
          // the lines describing the same act carry the same id without every
          // call site having to remember to pass it.
          ...(act ?? currentIntent()?.at) !== undefined
            ? { act: act ?? currentIntent()?.at }
            : {},
        },
      ],
    })),

  undoLast: () => {
    const { history } = get();
    const entry = history[history.length - 1];
    if (!entry) return null;
    set({ scene: cloneScene(entry.scene), history: history.slice(0, -1) });
    get().pushLog('system', `Undid: ${entry.label}`);
    return entry;
  },

  undoLastAgentAction: () => {
    const { history } = get();
    for (let i = history.length - 1; i >= 0; i -= 1) {
      if (isAgent(history[i].by)) {
        const entry = history[i];
        set({ scene: cloneScene(entry.scene), history: history.slice(0, i) });
        get().pushLog('system', `Undid agent action: ${entry.label}`);
        return entry;
      }
    }
    return null;
  },

  revertToAct: (act) => {
    const { history } = get();
    // The last snapshot for the act, not the first: an act that snapshotted
    // more than once should return to the nearest board it can vouch for.
    let found = -1;
    for (let i = history.length - 1; i >= 0; i -= 1) {
      if (history[i].act === act) {
        found = i;
        break;
      }
    }
    if (found < 0) return null;
    const entry = history[found];
    // Everything after it describes a board that will not exist in a moment.
    // Keeping those would offer a way back to a state nothing ever passed
    // through.
    set({
      scene: cloneScene(entry.scene),
      history: history.slice(0, found),
      rewound: get().rewound + 1,
    });
    // The notice below is the record of this. One line saying the board was
    // rewound is the truth; seven lines naming bystanders is not.
    get().pushLog('system', `Rewound to before: ${entry.label}`);
    return entry;
  },

  getNode: (id) => get().scene.nodes.find((n) => n.id === id),

  moveNode: (id, x, y, by) =>
    set((s) => {
      // A refusal still publishes a fresh nodes array. The canvas mirrors the
      // scene only when that array changes identity, so returning nothing would
      // leave the note wherever the refused hand dragged it — refused in the
      // store, moved on screen, and no feedback either way.
      if (heldByOther(s.grip, id, by)) return { scene: { ...s.scene, nodes: [...s.scene.nodes] } };
      return {
        scene: {
          ...s.scene,
          nodes: s.scene.nodes.map((n) =>
            n.id === id ? { ...n, x, y, lastEditedBy: by, editedAt: Date.now() } : n,
          ),
        },
      };
    }),

  moveNodes: (positions, by) =>
    set((s) => {
      const at = Date.now();
      return {
        scene: {
          ...s.scene,
          nodes: s.scene.nodes.map((n) => {
            const p = positions[n.id];
            // Never fight a hand that is already on it.
            if (!p || heldByOther(s.grip, n.id, by)) return n;
            return { ...n, x: p.x, y: p.y, lastEditedBy: by, editedAt: at };
          }),
        },
      };
    }),

  addNode: (spec, by) => get().addNodes([spec], by)[0],

  addNodes: (specs, by) => {
    const at = Date.now();
    const created: SceneNode[] = specs.map((spec) => ({
      id: uid('n'),
      text: spec.text,
      x: spec.x,
      y: spec.y,
      w: spec.kind === 'summary' ? 220 : 176,
      h: spec.kind === 'summary' ? 96 : 84,
      color: spec.color ?? '#f8fafc',
      cluster: null,
      kind: spec.kind ?? 'idea',
      lastEditedBy: by,
      editedAt: at,
      selected: false,
    }));
    set((s) => ({ scene: { ...s.scene, nodes: [...s.scene.nodes, ...created] } }));
    return created;
  },

  setNodeText: (id, text, by) =>
    set((s) => (heldByOther(s.grip, id, by) ? {} : {
      scene: {
        ...s.scene,
        nodes: s.scene.nodes.map((n) =>
          n.id === id ? { ...n, text, lastEditedBy: by, editedAt: Date.now() } : n,
        ),
      },
    })),

  setNodeColor: (id, color, by) =>
    set((s) => (heldByOther(s.grip, id, by) ? {} : {
      scene: {
        ...s.scene,
        nodes: s.scene.nodes.map((n) =>
          n.id === id ? { ...n, color, lastEditedBy: by, editedAt: Date.now() } : n,
        ),
      },
    })),

  removeNodes: (ids, by) => {
    const { grip } = get();
    const refused = ids.filter((id) => heldByOther(grip, id, by));
    const gone = new Set(ids.filter((id) => !heldByOther(grip, id, by)));
    if (gone.size > 0) {
      set((s) => ({
        scene: {
          ...s.scene,
          nodes: s.scene.nodes.filter((n) => !gone.has(n.id)),
          edges: s.scene.edges.filter((e) => !gone.has(e.from) && !gone.has(e.to)),
          annotations: s.scene.annotations.filter((a) => !a.nodeId || !gone.has(a.nodeId)),
          regions: s.scene.regions
            .map((r) => ({ ...r, nodeIds: r.nodeIds.filter((id) => !gone.has(id)) }))
            .filter((r) => r.nodeIds.length > 0),
        },
      }));
    }
    return refused;
  },

  setSelected: (id, selected) =>
    set((s) => ({
      scene: {
        ...s.scene,
        nodes: s.scene.nodes.map((n) => (n.id === id ? { ...n, selected } : n)),
      },
    })),

  clearSelection: () =>
    set((s) => ({
      scene: { ...s.scene, nodes: s.scene.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)) },
    })),

  addEdge: (from, to, label, by) => {
    const { scene } = get();
    if (from === to) return null;
    if (!scene.nodes.some((n) => n.id === from) || !scene.nodes.some((n) => n.id === to)) return null;
    const exists = scene.edges.some(
      (e) => (e.from === from && e.to === to) || (e.from === to && e.to === from),
    );
    if (exists) return null;
    const edge: SceneEdge = { id: uid('e'), from, to, label, lastEditedBy: by, editedAt: Date.now() };
    set((s) => ({ scene: { ...s.scene, edges: [...s.scene.edges, edge] } }));
    return edge;
  },

  removeEdges: (ids) =>
    set((s) => {
      const gone = new Set(ids);
      return { scene: { ...s.scene, edges: s.scene.edges.filter((e) => !gone.has(e.id)) } };
    }),

  addAnnotation: (a, by) => {
    const annotation: Annotation = { ...a, id: uid('a'), lastEditedBy: by, editedAt: Date.now() };
    set((s) => ({ scene: { ...s.scene, annotations: [...s.scene.annotations, annotation] } }));
    return annotation;
  },

  removeAnnotation: (id) =>
    set((s) => ({
      scene: { ...s.scene, annotations: s.scene.annotations.filter((a) => a.id !== id) },
    })),

  upsertRegion: (r, by) => {
    const region: Region = { ...r, lastEditedBy: by, editedAt: Date.now() };
    set((s) => {
      const others = s.scene.regions.filter((x) => x.id !== region.id);
      const claimed = new Set(region.nodeIds);
      return {
        scene: {
          ...s.scene,
          // A node belongs to exactly one region; the newest claim wins.
          regions: [
            ...others
              .map((x) => ({ ...x, nodeIds: x.nodeIds.filter((id) => !claimed.has(id)) }))
              .filter((x) => x.nodeIds.length > 0),
            region,
          ],
          nodes: s.scene.nodes.map((n) =>
            claimed.has(n.id) ? { ...n, cluster: region.id } : n,
          ),
        },
      };
    });
    return region;
  },

  removeRegion: (id) =>
    set((s) => ({
      scene: {
        ...s.scene,
        regions: s.scene.regions.filter((r) => r.id !== id),
        nodes: s.scene.nodes.map((n) => (n.cluster === id ? { ...n, cluster: null } : n)),
      },
    })),

  setGrip: (nodeIds, by) =>
    set((s) => {
      // Drop everything this actor was holding, then claim only what is free:
      // a second pointer coming down on a held note must not steal the claim.
      const next: Record<string, ActorId> = {};
      for (const [nodeId, holder] of Object.entries(s.grip)) {
        if (holder !== by) next[nodeId] = holder;
      }
      // A person outranks a machine: a hand may take a note an agent is
      // carrying, because the canvas promises as much in so many words. No
      // other precedence exists — an agent never takes anything from anyone.
      const person = !isAgent(by);
      for (const nodeId of nodeIds) {
        const holder = next[nodeId];
        if (holder === undefined || (person && isAgent(holder))) next[nodeId] = by;
      }
      return { grip: next, claims: { ...s.claims, [by]: [...nodeIds] } };
    }),

  clearGrip: () => set({ grip: {}, claims: {} }),

  heldBy: (nodeId) => get().grip[nodeId] ?? null,

  toggleProvenance: () => set((s) => ({ showProvenance: !s.showProvenance })),

  pushLog: (by, text) =>
    set((s) => ({
      log: [...s.log.slice(-(LOG_LIMIT - 1)), { id: uid('log'), at: Date.now(), by, text }],
    })),

  resetScene: () =>
    set((s) => ({
      scene: seedScene(),
      history: [],
      // A grip is a claim on a note id, so a board that no longer has those
      // notes must not go on publishing holds over them.
      grip: {},
      claims: {},
      epoch: s.epoch + 1,
      log: [{ id: uid('log'), at: Date.now(), by: 'system', text: 'Canvas reset.' }],
    })),

  loadTexts: (texts) =>
    set((s) => ({
      scene: sceneFromTexts(texts),
      history: [],
      grip: {},
      claims: {},
      epoch: s.epoch + 1,
      log: [
        {
          id: uid('log'),
          at: Date.now(),
          by: LOCAL_HUMAN,
          text: `Loaded ${texts.length} of your own notes onto the board.`,
        },
      ],
    })),

  loadScene: (scene, note) =>
    set((s) => ({
      // Already validated by whoever decoded it; cloned so the caller's object
      // can never be mutated out from under the store.
      scene: cloneScene(scene),
      history: [],
      grip: {},
      claims: {},
      epoch: s.epoch + 1,
      log: [
        {
          id: uid('log'),
          at: Date.now(),
          by: 'system',
          text: note ?? `Opened a shared board (${scene.nodes.length} notes).`,
        },
      ],
    })),
}));

/** Non-hook access for the WebMCP tool handlers, which run outside React. */
export const sceneApi = {
  get: () => useSceneStore.getState(),
  scene: () => useSceneStore.getState().scene,
};

export type { LayoutKind };
