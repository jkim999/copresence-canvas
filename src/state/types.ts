/** Who last touched a piece of the scene. Drives provenance tinting and undo. */
export type Actor = 'human' | 'agent';

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
  lastEditedBy: Actor;
  /** epoch ms of the last edit — used to fade the provenance tint. */
  editedAt: number;
  selected: boolean;
}

export interface SceneEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  lastEditedBy: Actor;
  editedAt: number;
}

export interface Annotation {
  id: string;
  text: string;
  /** anchored to a node, or free-floating over a region. */
  nodeId: string | null;
  x: number;
  y: number;
  lastEditedBy: Actor;
  editedAt: number;
}

export interface Region {
  id: string;
  label: string;
  layout: LayoutKind;
  nodeIds: string[];
  lastEditedBy: Actor;
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
  by: Actor;
  at: number;
  scene: Scene;
}

export interface LogEntry {
  id: string;
  at: number;
  by: Actor | 'system';
  text: string;
}
