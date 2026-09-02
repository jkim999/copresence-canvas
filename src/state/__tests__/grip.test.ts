import { beforeEach, describe, expect, it } from 'vitest';
import { useSceneStore } from '../sceneStore';
import { LOCAL_AGENT, LOCAL_HUMAN, agentId, humanId } from '../actors';

/**
 * The grip is the one invariant that makes concurrent editing safe. It used to
 * be a flat list of node ids, which was enough when there was exactly one pair
 * of hands: anything in the list was the human's, and the agent was the only
 * other actor. With more than one person the list cannot answer the question
 * that matters — *whose* hand is on this note — so it is a map, and every
 * mutating path has to ask.
 */

const ALEX = humanId();
const BO = agentId();

const store = () => useSceneStore.getState();
const node = (i = 0) => store().scene.nodes[i];

describe('a note in someone else\'s hand', () => {
  beforeEach(() => {
    store().resetScene();
    store().clearGrip();
  });

  it('cannot be moved by the agent', () => {
    const held = node();
    store().setGrip([held.id], LOCAL_HUMAN);

    store().moveNodes({ [held.id]: { x: 9999, y: 9999 } }, LOCAL_AGENT);

    expect(store().getNode(held.id)!.x).toBe(held.x);
  });

  it('cannot be moved by another person — the hole the flat list left open', () => {
    const held = node();
    store().setGrip([held.id], ALEX);

    // moveNode is the human drag path, and it used to skip the grip entirely.
    store().moveNode(held.id, 9999, 9999, LOCAL_HUMAN);

    expect(store().getNode(held.id)!.x).toBe(held.x);
  });

  it('republishes the scene when it refuses, so the view can snap back', () => {
    // The canvas keeps its own node list and only re-mirrors when `scene.nodes`
    // changes identity. A refusal that quietly returned nothing left the note
    // sitting wherever the refused hand had dragged it — the invariant held in
    // the store and visibly did not hold on screen.
    const held = node();
    store().setGrip([held.id], ALEX);
    const before = store().scene;

    store().moveNode(held.id, 9999, 9999, LOCAL_HUMAN);

    expect(store().scene.nodes).not.toBe(before.nodes);
    expect(store().getNode(held.id)).toEqual(held);
  });

  it('can still be moved by the hand that is holding it', () => {
    const held = node();
    store().setGrip([held.id], ALEX);

    store().moveNode(held.id, 640, 480, ALEX);

    expect(store().getNode(held.id)!.x).toBe(640);
  });

  it('cannot be deleted out from under them', () => {
    const held = node();
    store().setGrip([held.id], ALEX);

    const refused = store().removeNodes([held.id], BO);

    expect(store().getNode(held.id)).toBeDefined();
    expect(refused).toEqual([held.id]);
  });

  it('cannot be retitled or recoloured out from under them', () => {
    const held = node();
    const before = { text: held.text, color: held.color };
    store().setGrip([held.id], ALEX);

    store().setNodeText(held.id, 'stolen', BO);
    store().setNodeColor(held.id, '#000000', BO);

    expect(store().getNode(held.id)!.text).toBe(before.text);
    expect(store().getNode(held.id)!.color).toBe(before.color);
  });

  it('is released the moment that hand lets go, and only that hand\'s notes', () => {
    const mine = node(0);
    const theirs = node(1);
    store().setGrip([mine.id], ALEX);
    store().setGrip([theirs.id], LOCAL_HUMAN);

    store().setGrip([], ALEX);

    store().moveNode(mine.id, 100, 100, BO);
    store().moveNode(theirs.id, 100, 100, BO);

    expect(store().getNode(mine.id)!.x).toBe(100);
    expect(store().getNode(theirs.id)!.x).toBe(theirs.x);
  });

  it('lets a second person hold a different note at the same time', () => {
    const a = node(0);
    const b = node(1);
    store().setGrip([a.id], ALEX);
    store().setGrip([b.id], LOCAL_HUMAN);

    expect(store().heldBy(a.id)).toBe(ALEX);
    expect(store().heldBy(b.id)).toBe(LOCAL_HUMAN);

    store().moveNode(a.id, 1, 1, ALEX);
    store().moveNode(b.id, 2, 2, LOCAL_HUMAN);

    expect(store().getNode(a.id)!.x).toBe(1);
    expect(store().getNode(b.id)!.x).toBe(2);
  });

  it('does not let one person take a note by grabbing at it', () => {
    const held = node();
    store().setGrip([held.id], ALEX);

    // A second pointer going down on the same note must not steal the claim.
    store().setGrip([held.id], LOCAL_HUMAN);

    expect(store().heldBy(held.id)).toBe(ALEX);
    store().moveNode(held.id, 777, 777, LOCAL_HUMAN);
    expect(store().getNode(held.id)!.x).toBe(held.x);
  });

  it('deletes the notes that are free even when one in the batch is held', () => {
    const held = node(0);
    const free = node(1);
    store().setGrip([held.id], ALEX);

    const refused = store().removeNodes([held.id, free.id], BO);

    expect(refused).toEqual([held.id]);
    expect(store().getNode(held.id)).toBeDefined();
    expect(store().getNode(free.id)).toBeUndefined();
  });
});
