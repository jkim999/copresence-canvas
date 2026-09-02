import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { connectBoard, reportCursor, type Connection } from '../bind';
import { openSession, type Session } from '../channel';
import { readScene, writeScene } from '../doc';
import { holdsFrom, peersOf, publish } from '../presence';
import { usePeerCursorStore, usePeerStore } from '../peers';
import { useSceneStore } from '../../state/sceneStore';
import { LOCAL_HUMAN, humanId, me, myAgent, seatName } from '../../state/actors';
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
const otherTab = (room: string, clientId?: number) => {
  const doc = new Y.Doc();
  // Seat age is the seeding election, so a test that cares about it has to be
  // able to say which tab is older.
  if (clientId !== undefined) doc.clientID = clientId;
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
    store().moveNode('n_0', 999, 999, me());
    expect(store().getNode('n_0')!.x).toBe(10);
  });

  it('tells the other tab what this one is holding', async () => {
    const room = newRoom();
    const other = otherTab(room);
    const c = connect(room);
    await settle();

    // The seat, not the literal `human` — connecting takes an identity of this
    // tab's own, which is the only reason two tabs can refuse each other.
    const target = store().scene.nodes[0];
    store().setGrip([target.id], me());
    await settle();

    expect(me()).not.toBe(LOCAL_HUMAN);
    expect(holdsFrom(other.awareness)).toEqual({ [target.id]: me() });
    expect(c.awareness.getLocalState()).toMatchObject({ holding: [target.id], name: seatName(me()) });
  });

  it('lets go of everything when the tab closes', async () => {
    const room = newRoom();
    const other = otherTab(room);
    const c = connect(room);
    await settle();

    const target = store().scene.nodes[0];
    store().setGrip([target.id], me());
    await settle();
    expect(holdsFrom(other.awareness)).toEqual({ [target.id]: me() });

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
    store().setGrip([target.id], me());
    await settle();
    unsub();

    // One local set, and at most the echo that confirms it.
    expect(writes).toBeLessThanOrEqual(2);
    expect(store().heldBy(target.id)).toBe(me());
  });
});

describe('pointers, across the wire', () => {
  it('carries this tab\'s pointer to the other one', async () => {
    const room = newRoom();
    const other = otherTab(room);
    connect(room);
    await settle();

    reportCursor({ x: 120, y: 340 });
    await settle();

    expect(peersOf(other.awareness)[0]?.cursor).toEqual({ x: 120, y: 340 });
  });

  it('takes a peer\'s pointer out of the room again when they leave', async () => {
    const room = newRoom();
    const other = otherTab(room);
    connect(room);
    publish(other.awareness, { actor: BO, name: 'Bo', cursor: { x: 10, y: 20 } });
    await settle();
    expect(usePeerCursorStore.getState().cursors).toHaveLength(1);

    other.session.close();
    peers.length = 0;
    await settle();

    expect(usePeerCursorStore.getState().cursors).toEqual([]);
  });

  it('is a no-op once the tab has disconnected', async () => {
    const room = newRoom();
    const c = connect(room);
    await settle();
    c.stop();
    connections.length = 0;

    // Pointer events can outlive teardown by a frame; reporting into a closed
    // connection must not throw its way up through a DOM handler.
    expect(() => reportCursor({ x: 1, y: 2 })).not.toThrow();
  });
});

describe('a note two tabs grab at the same instant', () => {
  /** An actor id low enough to win every tie-break. */
  const EARLY = 'h_000000';

  it('goes to one of them and stays claimed by the other', async () => {
    const room = newRoom();
    const other = otherTab(room);
    const c = connect(room);
    await settle();

    const target = store().scene.nodes[0];
    publish(other.awareness, { actor: EARLY, name: 'Bo', holding: [target.id] });
    store().setGrip([target.id], me());
    await settle();

    // Lost the tie — but the hand is still down, so the claim must stand.
    expect(store().heldBy(target.id)).toBe(EARLY);
    expect(c.awareness.getLocalState()).toMatchObject({ holding: [target.id] });
  });

  it('comes to the loser when the winner lets go', async () => {
    // The bug: the grip was published from the *resolved* map, so losing a tie
    // retracted the claim too, and the loser never contended again — their
    // finger still down, the note free, and nobody holding it.
    const room = newRoom();
    const other = otherTab(room);
    connect(room);
    await settle();

    const target = store().scene.nodes[0];
    publish(other.awareness, { actor: EARLY, name: 'Bo', holding: [target.id] });
    store().setGrip([target.id], me());
    await settle();

    publish(other.awareness, { actor: EARLY, name: 'Bo', holding: [] });
    await settle();

    expect(store().heldBy(target.id)).toBe(me());
  });
});

describe('a peer wearing this tab\'s name', () => {
  it('is not believed', async () => {
    // Presence validates shape but not identity, and a state claiming to be
    // this tab would be folded into what *this* tab republishes as its own.
    const room = newRoom();
    const other = otherTab(room);
    connect(room);
    await settle();

    publish(other.awareness, { actor: me(), name: 'Impostor', holding: ['n_0'] });
    publish(other.awareness, { actor: myAgent(), name: 'Impostor', holding: ['n_1'] });
    await settle();

    expect(usePeerStore.getState().peers).toEqual([]);
    expect(store().heldBy('n_0')).toBeNull();
    expect(store().heldBy('n_1')).toBeNull();
  });
});

describe('two tabs opening a room together', () => {
  it('leaves the seeding to the older seat', async () => {
    // Both tabs used to find an empty document at the end of the grace window
    // and both used to seed it, so a board whose ids are not the fixed demo
    // ones came back merged — every note twice.
    const room = newRoom();
    const other = otherTab(room, 1);
    publish(other.awareness, { actor: BO, name: 'Bo' });
    const c = connect(room);
    await settle();

    expect(readScene(c.doc).nodes).toHaveLength(0);
  });

  it('adopts the board once the older seat puts one there', async () => {
    const room = newRoom();
    const other = otherTab(room, 1);
    publish(other.awareness, { actor: BO, name: 'Bo' });
    connect(room);
    await settle();

    writeScene(other.doc, board([node('n_0'), node('n_1')]));
    await settle();

    expect(store().scene.nodes.map((n) => n.id)).toEqual(['n_0', 'n_1']);
  });

  it('seeds the room itself when it holds the oldest seat', async () => {
    const room = newRoom();
    const other = otherTab(room, 0xffffffff);
    publish(other.awareness, { actor: BO, name: 'Bo' });
    const mine = store().scene.nodes.map((n) => n.id);
    const c = connect(room);
    await settle();

    expect(readScene(c.doc).nodes.map((n) => n.id)).toEqual(mine);
  });
});

describe('a tab with two hands of its own', () => {
  it('does not publish the agent\'s hold as the person\'s', async () => {
    // One tab, two actors with different rank. If both hands go out under one
    // name, the agent's own claim comes back attributed to the human — and the
    // agent then yields to what it thinks is a person, which is itself.
    const room = newRoom();
    const other = otherTab(room);
    const c = connect(room);
    await settle();

    const target = store().scene.nodes[0];
    store().setGrip([target.id], myAgent());
    await settle();

    expect(store().heldBy(target.id)).toBe(myAgent());
    expect(holdsFrom(other.awareness)[target.id]).toBe(myAgent());
    expect(c.awareness.getLocalState()).toBeDefined();
  });
});

describe('a board being animated', () => {
  it('does not put every frame on the wire', async () => {
    // Measured, not guessed: while one tab animated, a read-only tool call in
    // the other took about six seconds instead of fifteen milliseconds. Every
    // frame was a message, and every message a whole-scene read, repair and
    // store write on the receiving side.
    const room = newRoom();
    const other = otherTab(room);
    connect(room);
    await settle();

    let updates = 0;
    other.doc.on('update', () => {
      updates += 1;
    });

    const target = store().scene.nodes[0];
    for (let i = 0; i < 20; i += 1) store().moveNode(target.id, i * 10, 0, me());
    await settle(150);

    expect(updates).toBeLessThan(5);
    // Coalesced, never dropped: the last position still has to arrive.
    expect(readScene(other.doc).nodes.find((n) => n.id === target.id)!.x).toBe(190);
  });

  it('flushes what it was holding when the tab goes', async () => {
    const room = newRoom();
    const other = otherTab(room);
    const c = connect(room);
    await settle();

    const target = store().scene.nodes[0];
    store().moveNode(target.id, 640, 480, me());
    c.stop();
    connections.length = 0;
    await settle();

    expect(readScene(other.doc).nodes.find((n) => n.id === target.id)).toMatchObject({ x: 640 });
  });
});
