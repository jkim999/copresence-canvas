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

let counter = 0;
export const uid = (prefix: string): string => {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}`;
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
  /** node ids the human is dragging right now — the agent must never fight these. */
  humanGrip: string[];
  showProvenance: boolean;
  /** bumped whenever the whole board is replaced, so the canvas can refit. */
  epoch: number;

  // --- snapshots / undo -------------------------------------------------
  snapshot: (label: string, by: ActorId) => void;
  undoLast: () => HistoryEntry | null;
  undoLastAgentAction: () => HistoryEntry | null;

  // --- reads ------------------------------------------------------------
  getNode: (id: string) => SceneNode | undefined;

  // --- human + agent mutations -----------------------------------------
  moveNode: (id: string, x: number, y: number, by: ActorId) => void;
  moveNodes: (positions: Record<string, { x: number; y: number }>, by: ActorId) => void;
  addNode: (spec: NewNodeSpec, by: ActorId) => SceneNode;
  addNodes: (specs: NewNodeSpec[], by: ActorId) => SceneNode[];
  setNodeText: (id: string, text: string, by: ActorId) => void;
  setNodeColor: (id: string, color: string, by: ActorId) => void;
  removeNodes: (ids: string[], by: ActorId) => void;
  setSelected: (id: string, selected: boolean) => void;
  clearSelection: () => void;

  addEdge: (from: string, to: string, label: string, by: ActorId) => SceneEdge | null;
  removeEdges: (ids: string[]) => void;

  addAnnotation: (a: Omit<Annotation, 'id' | 'lastEditedBy' | 'editedAt'>, by: ActorId) => Annotation;
  removeAnnotation: (id: string) => void;

  upsertRegion: (r: Omit<Region, 'lastEditedBy' | 'editedAt'>, by: ActorId) => Region;
  removeRegion: (id: string) => void;

  setHumanGrip: (ids: string[]) => void;
  toggleProvenance: () => void;
  pushLog: (by: ActorId | 'system', text: string) => void;
  resetScene: () => void;
  /** Replace the board with the human's own material. */
  loadTexts: (texts: string[]) => void;
  /** Replace the board with one that arrived whole, from a shared link. */
  loadScene: (scene: Scene, note?: string) => void;
}

const cloneScene = (s: Scene): Scene => ({
  nodes: s.nodes.map((n) => ({ ...n })),
  edges: s.edges.map((e) => ({ ...e })),
  annotations: s.annotations.map((a) => ({ ...a })),
  regions: s.regions.map((r) => ({ ...r, nodeIds: [...r.nodeIds] })),
});

export const useSceneStore = create<SceneState>((set, get) => ({
  scene: seedScene(),
  history: [],
  log: [{ id: uid('log'), at: Date.now(), by: 'system', text: 'Canvas ready.' }],
  humanGrip: [],
  showProvenance: true,
  epoch: 0,

  snapshot: (label, by) =>
    set((s) => ({
      history: [
        ...s.history.slice(-(HISTORY_LIMIT - 1)),
        { id: uid('h'), label, by, at: Date.now(), scene: cloneScene(s.scene) },
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

  getNode: (id) => get().scene.nodes.find((n) => n.id === id),

  moveNode: (id, x, y, by) =>
    set((s) => ({
      scene: {
        ...s.scene,
        nodes: s.scene.nodes.map((n) =>
          n.id === id ? { ...n, x, y, lastEditedBy: by, editedAt: Date.now() } : n,
        ),
      },
    })),

  moveNodes: (positions, by) =>
    set((s) => {
      const at = Date.now();
      const grip = new Set(s.humanGrip);
      return {
        scene: {
          ...s.scene,
          nodes: s.scene.nodes.map((n) => {
            const p = positions[n.id];
            // Never fight the human: a node under their cursor is theirs.
            if (!p || grip.has(n.id)) return n;
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
    set((s) => ({
      scene: {
        ...s.scene,
        nodes: s.scene.nodes.map((n) =>
          n.id === id ? { ...n, text, lastEditedBy: by, editedAt: Date.now() } : n,
        ),
      },
    })),

  setNodeColor: (id, color, by) =>
    set((s) => ({
      scene: {
        ...s.scene,
        nodes: s.scene.nodes.map((n) =>
          n.id === id ? { ...n, color, lastEditedBy: by, editedAt: Date.now() } : n,
        ),
      },
    })),

  removeNodes: (ids, _by) =>
    set((s) => {
      const gone = new Set(ids);
      return {
        scene: {
          ...s.scene,
          nodes: s.scene.nodes.filter((n) => !gone.has(n.id)),
          edges: s.scene.edges.filter((e) => !gone.has(e.from) && !gone.has(e.to)),
          annotations: s.scene.annotations.filter((a) => !a.nodeId || !gone.has(a.nodeId)),
          regions: s.scene.regions
            .map((r) => ({ ...r, nodeIds: r.nodeIds.filter((id) => !gone.has(id)) }))
            .filter((r) => r.nodeIds.length > 0),
        },
      };
    }),

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

  setHumanGrip: (ids) => set({ humanGrip: ids }),

  toggleProvenance: () => set((s) => ({ showProvenance: !s.showProvenance })),

  pushLog: (by, text) =>
    set((s) => ({
      log: [...s.log.slice(-(LOG_LIMIT - 1)), { id: uid('log'), at: Date.now(), by, text }],
    })),

  resetScene: () =>
    set((s) => ({
      scene: seedScene(),
      history: [],
      epoch: s.epoch + 1,
      log: [{ id: uid('log'), at: Date.now(), by: 'system', text: 'Canvas reset.' }],
    })),

  loadTexts: (texts) =>
    set((s) => ({
      scene: sceneFromTexts(texts),
      history: [],
      humanGrip: [],
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
      humanGrip: [],
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
