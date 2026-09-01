import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { connectBoard, type Connection } from '../bind';
import { openSession, type Session } from '../channel';
import { readScene, writeScene } from '../doc';
import { holdsFrom, publish } from '../presence';
import { useSceneStore } from '../../state/sceneStore';
import { LOCAL_HUMAN, humanId } from '../../state/actors';
import type { Scene, SceneNode } from '../../state/types';

/**
 * The store is a module singleton, so "two tabs" here means one tab that owns
 * the store and a bare peer standing in for the other browser. That is enough:
 * every interesting failure is about what crosses between them.
 */

const BO = humanId();
const GRACE = 20;

const settle = (ms = 60): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

let rooms = 0;
const newRoom = (): string => `bind-${(rooms += 1)}-${Math.random().toString(36).slice(2)}`;

const connections: Connection[] = [];
const peers: { doc: Y.Doc; awareness: Awareness; session: Session }[] = [];

/** The other browser: a doc on the wire with no store behind it. */
const otherTab = (room: string) => {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  const session = openSession(room, doc, awareness);
  const peer = { doc, awareness, session };
  peers.push(peer);
  return peer;
};

const connect = (room: string): Connection => {
  const c = connectBoard({ room, graceMs: GRACE });
  connections.push(c);
  return c;
};

const node = (id: string, over: Partial<SceneNode> = {}): SceneNode => ({
  id, text: `text ${id}`, x: 0, y: 0, w: 176, h: 84, color: '#faf1e8',
  cluster: null, kind: 'idea', lastEditedBy: BO, editedAt: 0, selected: false, ...over,
});

const board = (nodes: SceneNode[]): Scene => ({ nodes, edges: [], annotations: [], regions: [] });

const store = () => useSceneStore.getState();

afterEach(() => {
  for (const c of connections.splice(0)) c.stop();
  for (const p of peers.splice(0)) p.session.close();
  useSceneStore.setState({ grip: {} });
  store().resetScene();
});

describe('the first tab in a room', () => {
  it('puts its own board on the wire', async () => {
    const room = newRoom();
    const mine = store().scene.nodes.map((n) => n.id);
    const c = connect(room);
    await settle();

    expect(readScene(c.doc).nodes.map((n) => n.id)).toEqual(mine);
  });

  it('sends a later edit to the other tab', async () => {
    const room = newRoom();
    const other = otherTab(room);
    const c = connect(room);
    await settle();

    const target = store().scene.nodes[0];
    store().moveNode(target.id, 777, 888, LOCAL_HUMAN);
    await settle();

    expect(readScene(other.doc).nodes.find((n) => n.id === target.id))
      .toMatchObject({ x: 777, y: 888 });
    expect(c.doc).toBeDefined();
  });
});

describe('a tab arriving in a room that already has a board', () => {
  it('adopts what it finds instead of adding to it', async () => {
    // The bug this exists for: two tabs, two seed boards, one merged document
    // holding both. Opening a second tab must not double the board.
    const room = newRoom();
    const other = otherTab(room);
    writeScene(other.doc, board([node('n_0'), node('n_1')]));
    await settle();

    const c = connect(room);
    await settle();

    expect(store().scene.nodes.map((n) => n.id)).toEqual(['n_0', 'n_1']);
    expect(readScene(c.doc).nodes.map((n) => n.id)).toEqual(['n_0', 'n_1']);
  });

  it('takes a later edit from the other tab into the store', async () => {
    const room = newRoom();
    const other = otherTab(room);
    writeScene(other.doc, board([node('n_0')]));
    connect(room);
    await settle();

    writeScene(other.doc, board([node('n_0', { x: 512, text: 'moved over there' })]));
    await settle();

    expect(store().getNode('n_0')).toMatchObject({ x: 512, text: 'moved over there' });
  });

  it('does not clear what this person had selected', async () => {
    const room = newRoom();
    const other = otherTab(room);
    writeScene(other.doc, board([node('n_0'), node('n_1')]));
    connect(room);
    await settle();

    store().setSelected('n_0', true);
    writeScene(other.doc, board([node('n_0'), node('n_1', { x: 99 })]));
    await settle();

    // Selection never travels, so a peer's edit must not land on top of it —
    // otherwise the next Backspace deletes nothing.
    expect(store().getNode('n_0')!.selected).toBe(true);
    expect(store().getNode('n_1')!.x).toBe(99);
  });
});

describe('hands, across the wire', () => {
  it('refuses to move a note the other tab is holding', async () => {
    const room = newRoom();
    const other = otherTab(room);
    writeScene(other.doc, board([node('n_0', { x: 10 })]));
    connect(room);
    await settle();

    publish(other.awareness, { actor: BO, name: 'Bo', holding: ['n_0'] });
    await settle();

    expect(store().heldBy('n_0')).toBe(BO);
    store().moveNode('n_0', 999, 999, LOCAL_HUMAN);
    expect(store().getNode('n_0')!.x).toBe(10);
  });

  it('tells the other tab what this one is holding', async () => {
    const room = newRoom();
    const other = otherTab(room);
    const c = connect(room);
    await settle();

    const target = store().scene.nodes[0];
    store().setGrip([target.id], LOCAL_HUMAN);
    await settle();

    expect(holdsFrom(other.awareness)).toEqual({ [target.id]: LOCAL_HUMAN });
    expect(c.awareness.getLocalState()).toMatchObject({ holding: [target.id] });
  });

  it('lets go of everything when the tab closes', async () => {
    const room = newRoom();
    const other = otherTab(room);
    const c = connect(room);
    await settle();

    const target = store().scene.nodes[0];
    store().setGrip([target.id], LOCAL_HUMAN);
    await settle();
    expect(holdsFrom(other.awareness)).toEqual({ [target.id]: LOCAL_HUMAN });

    c.stop();
    connections.length = 0;
    await settle();

    expect(holdsFrom(other.awareness)).toEqual({});
  });

  it('settles rather than looping when a hold bounces back', async () => {
    // The grip goes out to awareness and comes back as the grip. A flag cannot
    // stop that loop, because awareness fires on every heartbeat; only a value
    // comparison can. If this test hangs or the counts run away, it is broken.
    const room = newRoom();
    otherTab(room);
    connect(room);
    await settle();

    let writes = 0;
    const unsub = useSceneStore.subscribe(() => { writes += 1; });
    const target = store().scene.nodes[0];
    store().setGrip([target.id], LOCAL_HUMAN);
    await settle();
    unsub();

    // One local set, and at most the echo that confirms it.
    expect(writes).toBeLessThanOrEqual(2);
    expect(store().heldBy(target.id)).toBe(LOCAL_HUMAN);
  });
});
