import { beforeEach, describe, expect, it } from 'vitest';
import { useSceneStore } from '../sceneStore';

const reset = () => useSceneStore.getState().resetScene();
const first = () => useSceneStore.getState().scene.nodes[0];

describe('the human grip invariant', () => {
  beforeEach(() => {
    reset();
    useSceneStore.getState().setHumanGrip([]);
  });

  it('refuses to let the agent move a note the human is holding', () => {
    const held = first();
    const other = useSceneStore.getState().scene.nodes[1];
    useSceneStore.getState().setHumanGrip([held.id]);

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
    useSceneStore.getState().setHumanGrip([target.id]);
    useSceneStore.getState().moveNodes({ [target.id]: { x: 100, y: 100 } }, 'agent');
    expect(useSceneStore.getState().getNode(target.id)!.x).toBe(target.x);

    useSceneStore.getState().setHumanGrip([]);
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
