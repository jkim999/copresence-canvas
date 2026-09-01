import * as Y from 'yjs';
import type { Annotation, Region, Scene, SceneEdge, SceneNode } from '../state/types';
import { LOCAL_HUMAN } from '../state/actors';
import { repairScene } from '../state/repair';
import { LAYOUT_KINDS, type LayoutKind } from '../state/types';

/**
 * The board as a CRDT.
 *
 * Each collection is a Y.Map keyed by entity id, holding a Y.Map of fields, so
 * two people moving two different notes merge cleanly and two people moving the
 * *same* note settle last-writer-wins per field — which is exactly what the
 * store already did, with the grip covering the cases where that would be wrong.
 *
 * Two things a Y.Map cannot give us on its own:
 *
 *  - **Order.** `scene.nodes` is an array and its order is paint order, but a
 *    Y.Map is unordered. Each node therefore carries `o`, and reads sort by
 *    `(o, id)` so peers that merged concurrent inserts still stack their notes
 *    identically instead of quietly disagreeing about what is on top.
 *  - **The store's transactional invariants.** A merge does not re-run
 *    `removeNodes`'s cascade or `upsertRegion`'s exclusivity, so every read ends
 *    in `repairScene`.
 */

export const ORIGIN_LOCAL = 'local';
export const ORIGIN_REMOTE = 'remote';

type Fields = Record<string, unknown>;

const NODES = 'nodes';
const EDGES = 'edges';
const ANNOTATIONS = 'annotations';
const REGIONS = 'regions';

export const collections = (doc: Y.Doc) => ({
  nodes: doc.getMap<Y.Map<unknown>>(NODES),
  edges: doc.getMap<Y.Map<unknown>>(EDGES),
  annotations: doc.getMap<Y.Map<unknown>>(ANNOTATIONS),
  regions: doc.getMap<Y.Map<unknown>>(REGIONS),
});

// --- reading ---------------------------------------------------------------

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

const readNode = (id: string, f: Y.Map<unknown>): SceneNode => ({
  id,
  text: str(f.get('t')),
  x: num(f.get('x'), 0),
  y: num(f.get('y'), 0),
  w: num(f.get('w'), 176),
  h: num(f.get('h'), 84),
  color: str(f.get('c'), '#f5f2ea'),
  cluster: null,
  kind: f.get('k') === 'summary' ? 'summary' : 'idea',
  lastEditedBy: str(f.get('b'), LOCAL_HUMAN),
  editedAt: num(f.get('e'), 0),
  selected: false,
});

export const readScene = (doc: Y.Doc): Scene => {
  const c = collections(doc);

  const nodes: (SceneNode & { o: number })[] = [];
  c.nodes.forEach((f, id) => nodes.push({ ...readNode(id, f), o: num(f.get('o'), 0) }));
  // A tie on `o` means two peers appended concurrently; the id breaks it the
  // same way on every peer.
  nodes.sort((a, b) => (a.o === b.o ? (a.id < b.id ? -1 : 1) : a.o - b.o));

  const edges: SceneEdge[] = [];
  c.edges.forEach((f, id) =>
    edges.push({
      id,
      from: str(f.get('s')),
      to: str(f.get('d')),
      label: str(f.get('l')),
      lastEditedBy: str(f.get('b'), LOCAL_HUMAN),
      editedAt: num(f.get('e'), 0),
    }),
  );
  edges.sort((a, b) => (a.id < b.id ? -1 : 1));

  const annotations: Annotation[] = [];
  c.annotations.forEach((f, id) => {
    const anchor = f.get('n');
    annotations.push({
      id,
      text: str(f.get('t')),
      nodeId: typeof anchor === 'string' ? anchor : null,
      x: num(f.get('x'), 0),
      y: num(f.get('y'), 0),
      lastEditedBy: str(f.get('b'), LOCAL_HUMAN),
      editedAt: num(f.get('e'), 0),
    });
  });
  annotations.sort((a, b) => (a.id < b.id ? -1 : 1));

  const regions: Region[] = [];
  c.regions.forEach((f, id) => {
    const raw = f.get('n');
    const layout = f.get('y');
    regions.push({
      id,
      label: str(f.get('l')),
      layout: LAYOUT_KINDS.includes(layout as LayoutKind) ? (layout as LayoutKind) : 'cluster',
      nodeIds: Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [],
      lastEditedBy: str(f.get('b'), LOCAL_HUMAN),
      editedAt: num(f.get('e'), 0),
    });
  });
  regions.sort((a, b) => (a.id < b.id ? -1 : 1));

  return repairScene({
    nodes: nodes.map(({ o: _o, ...n }) => n),
    edges,
    annotations,
    regions,
  });
};

// --- writing ---------------------------------------------------------------

/**
 * Write only what actually differs from what the document already holds.
 *
 * This is the difference between a sync that works and one that eats people's
 * edits. Blindly writing the whole local scene would re-send unchanged fields,
 * and an unchanged field carrying a *stale* value will clobber a peer's newer
 * one the moment the two writes land out of order.
 */
const reconcile = (
  map: Y.Map<Y.Map<unknown>>,
  wanted: Map<string, Fields>,
): void => {
  for (const [id, fields] of wanted) {
    let entry = map.get(id);
    if (!entry) {
      entry = new Y.Map<unknown>();
      map.set(id, entry);
    }
    for (const [key, value] of Object.entries(fields)) {
      const current = entry.get(key);
      // Region membership is the one array we store whole; compare by value.
      const same = Array.isArray(value)
        ? Array.isArray(current) && JSON.stringify(current) === JSON.stringify(value)
        : current === value;
      if (!same) entry.set(key, value);
    }
  }

  for (const id of [...map.keys()]) {
    if (!wanted.has(id)) map.delete(id);
  }
};

const nodeFields = (n: SceneNode, order: number): Fields => ({
  t: n.text,
  x: Math.round(n.x),
  y: Math.round(n.y),
  w: n.w,
  h: n.h,
  c: n.color,
  k: n.kind,
  b: n.lastEditedBy,
  e: n.editedAt,
  o: order,
});

export const writeScene = (doc: Y.Doc, scene: Scene, origin: unknown = ORIGIN_LOCAL): void => {
  const c = collections(doc);
  doc.transact(() => {
    reconcile(c.nodes, new Map(scene.nodes.map((n, i) => [n.id, nodeFields(n, i)])));
    reconcile(
      c.edges,
      new Map(
        scene.edges.map((e) => [
          e.id,
          { s: e.from, d: e.to, l: e.label, b: e.lastEditedBy, e: e.editedAt },
        ]),
      ),
    );
    reconcile(
      c.annotations,
      new Map(
        scene.annotations.map((a) => [
          a.id,
          { t: a.text, n: a.nodeId, x: Math.round(a.x), y: Math.round(a.y), b: a.lastEditedBy, e: a.editedAt },
        ]),
      ),
    );
    reconcile(
      c.regions,
      new Map(
        scene.regions.map((r) => [
          r.id,
          { l: r.label, y: r.layout, n: [...r.nodeIds], b: r.lastEditedBy, e: r.editedAt },
        ]),
      ),
    );
  }, origin);
};
