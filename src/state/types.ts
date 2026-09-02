/** What kind of participant something is. Drives provenance tinting and undo. */
export type ActorKind = 'human' | 'agent';

/**
 * Who last touched a piece of the scene. An id, never an object: ids are what
 * survive a share link, a history snapshot and a merge, while names and colours
 * are presentation. See state/actors.ts for the registry that resolves them.
 */
export type ActorId = string;

export interface Actor {
  id: ActorId;
  kind: ActorKind;
  /** shown on a cursor label and in provenance; not stable across sessions. */
  name: string;
  /** CSS colour for this participant's cursor, label and provenance ring. */
  color: string;
}

export type LayoutKind = 'cluster' | 'timeline_horizontal' | 'grid' | 'hierarchy';

export const LAYOUT_KINDS: readonly LayoutKind[] = [
  'cluster',
  'timeline_horizontal',
  'grid',
  'hierarchy',
];

export interface SceneNode {
  id: string;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  /** id of the region this node currently belongs to, or null. */
  cluster: string | null;
  kind: 'idea' | 'summary';
  lastEditedBy: ActorId;
  /** epoch ms of the last edit — used to fade the provenance tint. */
  editedAt: number;
  selected: boolean;
}

export interface SceneEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  lastEditedBy: ActorId;
  editedAt: number;
}

export interface Annotation {
  id: string;
  text: string;
  /** anchored to a node, or free-floating over a region. */
  nodeId: string | null;
  x: number;
  y: number;
  lastEditedBy: ActorId;
  editedAt: number;
}

export interface Region {
  id: string;
  label: string;
  layout: LayoutKind;
  nodeIds: string[];
  lastEditedBy: ActorId;
  editedAt: number;
}

export interface Scene {
  nodes: SceneNode[];
  edges: SceneEdge[];
  annotations: Annotation[];
  regions: Region[];
}

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One entry on the undo stack: a full (small) scene snapshot plus a label. */
export interface HistoryEntry {
  id: string;
  label: string;
  by: ActorId;
  at: number;
  scene: Scene;
}

/**
 * An act announced before it is carried out.
 *
 * Lives here rather than beside the agent because it is shared vocabulary: the
 * agent declares one, presence carries it over the wire, and the canvas draws
 * it. Kept small on purpose — it crosses the wire on every heartbeat.
 */
export interface Intent {
  /** Present participle, so it reads as a sentence: "arranging", "linking". */
  verb: string;
  /** The object of that verb: "8 notes into a timeline". */
  what: string;
  /** What it expects to touch, so a reader can see the target, not just the act. */
  ids: string[];
  /** When it was declared, so a reader can tell a fresh claim from a stuck one. */
  at: number;
}

export interface LogEntry {
  id: string;
  at: number;
  by: ActorId | 'system';
  text: string;
}
