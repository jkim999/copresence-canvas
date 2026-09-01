import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { readScene, writeScene } from '../doc';
import { seedScene } from '../../data/seed';
import { LOCAL_AGENT, LOCAL_HUMAN } from '../../state/actors';
import type { Scene, SceneNode } from '../../state/types';

/**
 * Two Y.Docs in one process is the whole multiplayer test harness. Everything
 * below is a thing that actually happens when two people work at once, and
 * every one of them produced a broken board before the code under test existed.
 */

const sync = (a: Y.Doc, b: Y.Doc): void => {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
};

const node = (id: string, over: Partial<SceneNode> = {}): SceneNode => ({
  id, text: `text ${id}`, x: 0, y: 0, w: 176, h: 84, color: '#faf1e8',
  cluster: null, kind: 'idea', lastEditedBy: LOCAL_HUMAN, editedAt: 0, selected: false, ...over,
});

const blank = (over: Partial<Scene> = {}): Scene =>
  ({ nodes: [], edges: [], annotations: [], regions: [], ...over });

/** Two peers that already agree on a starting board. */
const paired = (scene: Scene): [Y.Doc, Y.Doc] => {
  const a = new Y.Doc();
  const b = new Y.Doc();
  writeScene(a, scene);
  sync(a, b);
  return [a, b];
};

describe('one peer', () => {
  it('round-trips a real board', () => {
    const doc = new Y.Doc();
    const scene = seedScene();
    writeScene(doc, scene);

    const out = readScene(doc);

    expect(out.nodes).toHaveLength(scene.nodes.length);
    expect(out.nodes.map((n) => n.id)).toEqual(scene.nodes.map((n) => n.id));
    expect(out.nodes[0]).toMatchObject({ text: scene.nodes[0].text, x: scene.nodes[0].x });
  });

  it('writes nothing on a second identical write', () => {
    const doc = new Y.Doc();
    writeScene(doc, seedScene());
    const before = Y.encodeStateAsUpdate(doc).length;

    let updates = 0;
    doc.on('update', () => { updates += 1; });
    writeScene(doc, readScene(doc));

    expect(updates).toBe(0);
    expect(Y.encodeStateAsUpdate(doc).length).toBe(before);
  });

  it('deletes what is gone from the scene', () => {
    const doc = new Y.Doc();
    writeScene(doc, blank({ nodes: [node('n_0'), node('n_1')] }));
    writeScene(doc, blank({ nodes: [node('n_0')] }));

    expect(readScene(doc).nodes.map((n) => n.id)).toEqual(['n_0']);
  });
});

describe('two peers editing at once', () => {
  it('keeps both moves when they touch different notes', () => {
    const [a, b] = paired(blank({ nodes: [node('n_0'), node('n_1')] }));

    writeScene(a, blank({ nodes: [node('n_0', { x: 100 }), node('n_1')] }));
    writeScene(b, blank({ nodes: [node('n_0'), node('n_1', { y: 250 })] }));
    sync(a, b);

    for (const doc of [a, b]) {
      const s = readScene(doc);
      expect(s.nodes.find((n) => n.id === 'n_0')!.x).toBe(100);
      expect(s.nodes.find((n) => n.id === 'n_1')!.y).toBe(250);
    }
  });

  it('lands both peers on the same board when they touch the same note', () => {
    const [a, b] = paired(blank({ nodes: [node('n_0')] }));

    writeScene(a, blank({ nodes: [node('n_0', { x: 10 })] }));
    writeScene(b, blank({ nodes: [node('n_0', { x: 20 })] }));
    sync(a, b);

    // Which one wins is last-writer-wins and not ours to promise. That they
    // agree is the promise, and the grip is what keeps this case rare.
    expect(readScene(a)).toEqual(readScene(b));
  });

  it('keeps both new notes when both peers add one', () => {
    const [a, b] = paired(blank({ nodes: [node('n_0')] }));

    writeScene(a, blank({ nodes: [node('n_0'), node('a_new')] }));
    writeScene(b, blank({ nodes: [node('n_0'), node('b_new')] }));
    sync(a, b);

    expect(readScene(a).nodes.map((n) => n.id)).toEqual(['n_0', 'a_new', 'b_new']);
    expect(readScene(a).nodes.map((n) => n.id)).toEqual(readScene(b).nodes.map((n) => n.id));
  });

  it('agrees on stacking order after concurrent inserts', () => {
    const [a, b] = paired(blank({ nodes: [node('n_0')] }));
    writeScene(a, blank({ nodes: [node('n_0'), node('z_late')] }));
    writeScene(b, blank({ nodes: [node('n_0'), node('a_late')] }));
    sync(a, b);

    // Both appended at the same index; without the id tiebreak the two peers
    // would paint these two notes in opposite orders.
    expect(readScene(a).nodes.map((n) => n.id)).toEqual(readScene(b).nodes.map((n) => n.id));
  });
});

describe('the invariants a merge cannot keep on its own', () => {
  it('drops an edge whose note the other peer deleted', () => {
    const start = blank({
      nodes: [node('n_0'), node('n_1')],
      edges: [{ id: 'e_0', from: 'n_0', to: 'n_1', label: 'supports', lastEditedBy: LOCAL_AGENT, editedAt: 0 }],
    });
    const [a, b] = paired(start);

    // A draws a second edge while B deletes the note it lands on.
    writeScene(a, {
      ...start,
      edges: [
        ...start.edges,
        { id: 'e_1', from: 'n_1', to: 'n_0', label: 'and back', lastEditedBy: LOCAL_AGENT, editedAt: 0 },
      ],
    });
    writeScene(b, blank({ nodes: [node('n_0')] }));
    sync(a, b);

    for (const doc of [a, b]) {
      expect(readScene(doc).nodes.map((n) => n.id)).toEqual(['n_0']);
      expect(readScene(doc).edges).toHaveLength(0);
    }
  });

  it('drops an annotation whose note the other peer deleted', () => {
    const start = blank({
      nodes: [node('n_0'), node('n_1')],
      annotations: [{ id: 'a_0', text: 'about n_1', nodeId: 'n_1', x: 0, y: 0, lastEditedBy: LOCAL_AGENT, editedAt: 0 }],
    });
    const [a, b] = paired(start);

    writeScene(b, blank({ nodes: [node('n_0')] }));
    sync(a, b);

    expect(readScene(a).annotations).toHaveLength(0);
    expect(readScene(a)).toEqual(readScene(b));
  });

  it('gives a note to exactly one region when two agents group it at once', () => {
    const [a, b] = paired(blank({ nodes: [node('n_0'), node('n_1')] }));

    writeScene(a, blank({
      nodes: [node('n_0'), node('n_1')],
      regions: [{ id: 'r_a', label: 'Evidence', layout: 'grid', nodeIds: ['n_0', 'n_1'], lastEditedBy: LOCAL_AGENT, editedAt: 0 }],
    }));
    writeScene(b, blank({
      nodes: [node('n_0'), node('n_1')],
      regions: [{ id: 'r_b', label: 'Timeline', layout: 'timeline_horizontal', nodeIds: ['n_0'], lastEditedBy: LOCAL_AGENT, editedAt: 0 }],
    }));
    sync(a, b);

    const merged = readScene(a);
    expect(merged).toEqual(readScene(b));
    const owners = merged.regions.filter((r) => r.nodeIds.includes('n_0'));
    expect(owners).toHaveLength(1);
    // and the note agrees with the region that claimed it
    expect(merged.nodes.find((n) => n.id === 'n_0')!.cluster).toBe(owners[0].id);
    expect(merged.regions.every((r) => r.nodeIds.length > 0)).toBe(true);
  });

  it('drops a region the other peer emptied', () => {
    const start = blank({
      nodes: [node('n_0')],
      regions: [{ id: 'r_0', label: 'Only n_0', layout: 'grid', nodeIds: ['n_0'], lastEditedBy: LOCAL_AGENT, editedAt: 0 }],
    });
    const [a, b] = paired(start);

    writeScene(b, blank({ nodes: [] , regions: start.regions }));
    sync(a, b);

    expect(readScene(a).regions).toHaveLength(0);
    expect(readScene(a)).toEqual(readScene(b));
  });
});
