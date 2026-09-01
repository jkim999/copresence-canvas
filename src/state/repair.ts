import type { Annotation, Region, Scene, SceneEdge, SceneNode } from './types';

/**
 * Put a scene back into a state the store would have produced itself.
 *
 * The store keeps cross-entity invariants inside single transactions:
 * `removeNodes` cascades to edges, annotations and regions and drops the
 * regions it empties; `upsertRegion` strips claimed ids out of every other
 * region and rewrites `node.cluster`. Anything that assembles a scene from
 * parts — a shared link, or a CRDT merging two peers' concurrent edits —
 * bypasses those transactions entirely and can hand back a board the app can
 * never produce: an edge to a note somebody else deleted, an annotation
 * anchored to nothing, a note claimed by two regions at once.
 *
 * So the invariants are re-established rather than assumed. Deterministic on
 * purpose: two peers running this over the same merged state must land on
 * byte-identical scenes, or they will disagree about what they are looking at.
 */
export const repairScene = (scene: Scene): Scene => {
  const nodes: SceneNode[] = [];
  const present = new Set<string>();
  for (const n of scene.nodes) {
    if (present.has(n.id)) continue;
    present.add(n.id);
    nodes.push(n);
  }

  // Mirrors addEdge: no self-edge, no dangling end, one edge per pair.
  const edges: SceneEdge[] = [];
  const pairs = new Set<string>();
  for (const e of scene.edges) {
    if (e.from === e.to) continue;
    if (!present.has(e.from) || !present.has(e.to)) continue;
    const pair = [e.from, e.to].sort().join(' ');
    if (pairs.has(pair)) continue;
    pairs.add(pair);
    edges.push(e);
  }

  // Mirrors removeNodes: an annotation whose note is gone goes with it. One
  // anchored to nothing is a board-level comment and stays.
  const annotations: Annotation[] = scene.annotations.filter(
    (a) => !a.nodeId || present.has(a.nodeId),
  );

  // A note belongs to exactly one region. Live upserts settle that by "newest
  // claim wins" because they are ordered in time; a merged or flattened board
  // has no such ordering, so the first claim in document order wins and every
  // peer agrees.
  const regions: Region[] = [];
  const claimed = new Set<string>();
  const cluster = new Map<string, string>();
  for (const r of scene.regions) {
    const nodeIds: string[] = [];
    for (const nodeId of r.nodeIds) {
      if (!present.has(nodeId) || claimed.has(nodeId)) continue;
      claimed.add(nodeId);
      cluster.set(nodeId, r.id);
      nodeIds.push(nodeId);
    }
    if (nodeIds.length === 0) continue;
    regions.push({ ...r, nodeIds });
  }

  return {
    nodes: nodes.map((n) =>
      n.cluster === (cluster.get(n.id) ?? null) ? n : { ...n, cluster: cluster.get(n.id) ?? null },
    ),
    edges,
    annotations,
    regions,
  };
};
