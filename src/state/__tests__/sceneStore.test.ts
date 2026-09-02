import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSceneStore } from '../sceneStore';
import { LOCAL_HUMAN } from '../actors';

const reset = () => useSceneStore.getState().resetScene();
const first = () => useSceneStore.getState().scene.nodes[0];

describe('the human grip invariant', () => {
  beforeEach(() => {
    reset();
    useSceneStore.getState().clearGrip();
  });

  it('refuses to let the agent move a note the human is holding', () => {
    const held = first();
    const other = useSceneStore.getState().scene.nodes[1];
    useSceneStore.getState().setGrip([held.id], LOCAL_HUMAN);

    useSceneStore.getState().moveNodes(
      { [held.id]: { x: 9999, y: 9999 }, [other.id]: { x: 500, y: 500 } },
      'agent',
    );

    const after = useSceneStore.getState().getNode(held.id)!;
    expect(after.x).toBe(held.x);
    expect(after.y).toBe(held.y);
    expect(after.lastEditedBy).toBe('human');

    // The agent still gets to move everything it was not asked to leave alone.
    const movedOther = useSceneStore.getState().getNode(other.id)!;
    expect(movedOther.x).toBe(500);
    expect(movedOther.lastEditedBy).toBe('agent');
  });

  it('lets the agent move the note again once the human lets go', () => {
    const target = first();
    useSceneStore.getState().setGrip([target.id], LOCAL_HUMAN);
    useSceneStore.getState().moveNodes({ [target.id]: { x: 100, y: 100 } }, 'agent');
    expect(useSceneStore.getState().getNode(target.id)!.x).toBe(target.x);

    useSceneStore.getState().clearGrip();
    useSceneStore.getState().moveNodes({ [target.id]: { x: 100, y: 100 } }, 'agent');
    expect(useSceneStore.getState().getNode(target.id)!.x).toBe(100);
  });
});

describe('provenance and undo', () => {
  beforeEach(reset);

  it('stamps every mutation with who made it', () => {
    const node = useSceneStore.getState().addNode({ text: 'agent idea', x: 0, y: 0 }, 'agent');
    expect(useSceneStore.getState().getNode(node.id)!.lastEditedBy).toBe('agent');
    useSceneStore.getState().setNodeText(node.id, 'human edit', 'human');
    expect(useSceneStore.getState().getNode(node.id)!.lastEditedBy).toBe('human');
  });

  it('rewinds the agent past the human changes stacked on top of it', () => {
    const store = useSceneStore.getState();
    const before = store.scene.nodes.length;

    store.snapshot('agent adds', 'agent');
    store.addNode({ text: 'from agent', x: 0, y: 0 }, 'agent');
    store.snapshot('human adds', 'human');
    store.addNode({ text: 'from human', x: 0, y: 0 }, 'human');

    const entry = useSceneStore.getState().undoLastAgentAction();
    expect(entry?.by).toBe('agent');
    expect(useSceneStore.getState().scene.nodes.length).toBe(before);
  });

  it('reports nothing to undo when the agent has not acted', () => {
    useSceneStore.getState().snapshot('human only', 'human');
    expect(useSceneStore.getState().undoLastAgentAction()).toBeNull();
  });
});

describe('scene integrity', () => {
  beforeEach(reset);

  it('drops edges and annotations that point at deleted notes', () => {
    const store = useSceneStore.getState();
    const [a, b] = store.scene.nodes;
    store.addEdge(a.id, b.id, 'causes', 'agent');
    store.addAnnotation({ text: 'about a', nodeId: a.id, x: 0, y: 0 }, 'agent');

    useSceneStore.getState().removeNodes([a.id], 'human');
    const scene = useSceneStore.getState().scene;
    expect(scene.edges).toHaveLength(0);
    expect(scene.annotations).toHaveLength(0);
  });

  it('refuses self-links, duplicate links and links to notes that do not exist', () => {
    const store = useSceneStore.getState();
    const [a, b] = store.scene.nodes;
    expect(store.addEdge(a.id, a.id, 'self', 'agent')).toBeNull();
    expect(store.addEdge(a.id, 'nope', 'missing', 'agent')).toBeNull();
    expect(useSceneStore.getState().addEdge(a.id, b.id, 'first', 'agent')).not.toBeNull();
    expect(useSceneStore.getState().addEdge(b.id, a.id, 'reverse duplicate', 'agent')).toBeNull();
  });

  it('gives a note to exactly one region — the newest claim wins', () => {
    const store = useSceneStore.getState();
    const [a, b, c] = store.scene.nodes;
    store.upsertRegion({ id: 'r1', label: 'First', layout: 'grid', nodeIds: [a.id, b.id] }, 'agent');
    useSceneStore
      .getState()
      .upsertRegion({ id: 'r2', label: 'Second', layout: 'cluster', nodeIds: [b.id, c.id] }, 'agent');

    const scene = useSceneStore.getState().scene;
    expect(scene.regions.find((r) => r.id === 'r1')!.nodeIds).toEqual([a.id]);
    expect(useSceneStore.getState().getNode(b.id)!.cluster).toBe('r2');
  });
});

describe('minting a node id', () => {
  it('does not collide with a second tab that started in the same millisecond', async () => {
    // Same failure the actor ids already guard against, in the one place it is
    // worse: two tabs adding a note at the same moment mint the same node id,
    // and the CRDT merges two different notes into one with mixed fields.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    try {
      vi.resetModules();
      const tabA = await import('../sceneStore');
      vi.resetModules();
      const tabB = await import('../sceneStore');

      expect(tabA.uid('n')).not.toBe(tabB.uid('n'));
    } finally {
      vi.useRealTimers();
      vi.resetModules();
    }
  });
});

describe('resetting the board', () => {
  it('lets go of everything the old board was holding', () => {
    // A grip is a claim on a note id. Wiping the board without wiping the grip
    // leaves holds on notes that no longer exist, and publishes them.
    const held = first();
    useSceneStore.getState().setGrip([held.id], LOCAL_HUMAN);

    useSceneStore.getState().resetScene();

    expect(useSceneStore.getState().grip).toEqual({});
  });
});

/**
 * Rewinding from the history panel, rather than from a toolbar button that can
 * only ever mean "the last thing".
 *
 * The row a person is reading is the moment they form the thought "no, not
 * that" — and it was the one place they could not act on it. What the row can
 * offer is honest about the mechanism: snapshots are whole scenes, so going
 * back to one goes back past everything after it too.
 */
describe('rewinding to a particular act', () => {
  beforeEach(reset);

  it('puts the board back the way it was before that act', () => {
    const store = useSceneStore.getState();
    const before = store.scene.nodes.length;
    store.snapshot('agent arranges', 'agent', 500);
    store.addNode({ text: 'from agent', x: 0, y: 0 }, 'agent');

    const entry = useSceneStore.getState().revertToAct(500);
    expect(entry?.label).toBe('agent arranges');
    expect(useSceneStore.getState().scene.nodes.length).toBe(before);
  });

  it('goes back past everything stacked on top of it, which is the honest part', () => {
    const store = useSceneStore.getState();
    const before = store.scene.nodes.length;
    store.snapshot('agent arranges', 'agent', 500);
    store.addNode({ text: 'from agent', x: 0, y: 0 }, 'agent');
    store.snapshot('agent links', 'agent', 600);
    store.addNode({ text: 'later still', x: 0, y: 0 }, 'agent');

    useSceneStore.getState().revertToAct(500);
    expect(useSceneStore.getState().scene.nodes.length).toBe(before);
    // And the snapshots it passed are gone with it: they describe a board that
    // no longer exists, and offering to return to one would be a trapdoor.
    expect(useSceneStore.getState().history).toHaveLength(0);
  });

  it('finds the act rather than the last snapshot that happens to match', () => {
    const store = useSceneStore.getState();
    store.snapshot('first', 'agent', 500);
    store.snapshot('second', 'agent', 600);
    expect(useSceneStore.getState().revertToAct(600)?.label).toBe('second');
  });

  it('does nothing for an act it has no snapshot of', () => {
    useSceneStore.getState().snapshot('only one', 'agent', 500);
    expect(useSceneStore.getState().revertToAct(999)).toBeNull();
    expect(useSceneStore.getState().history).toHaveLength(1);
  });
});
