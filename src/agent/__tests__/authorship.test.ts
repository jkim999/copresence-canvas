import { beforeEach, describe, expect, it } from 'vitest';
import { buildTools } from '../tools';
import { useSceneStore } from '../../state/sceneStore';
import { agentId, me, myAgent, seatName, takeSeat } from '../../state/actors';
import { setRoomSource } from '../../sync/peers';

/**
 * Two agents were put on one board knowing nothing about it. Both organised it
 * well, and both reported the same blocker in the same words: every node came
 * back marked `lastEditedBy: "agent"`, generically, so neither could tell its
 * own work from the other's. One of them spent its run diffing whole scene
 * snapshots by hand to work out what the other had done; the other could not
 * decide whether three notes already on the board were a peer's work or test
 * fixtures, and left them alone rather than guess.
 *
 * Knowing who is in the room is no use if the board will not say who did what.
 */

const scene = () => useSceneStore.getState();
const getScene = async () => {
  const tool = buildTools().find((t) => t.name === 'get_scene')!;
  return (await tool.execute({})) as {
    nodes: { id: string; seat: string; mine: boolean; lastEditedBy: string }[];
  };
};

beforeEach(() => {
  setRoomSource(null);
  takeSeat();
  scene().resetScene();
});

describe('reading who made what', () => {
  it('names the seat behind a note, not just that a machine made it', async () => {
    const peerAgent = agentId();
    const node = scene().addNode({ text: 'theirs', x: 0, y: 0 }, peerAgent);

    const found = (await getScene()).nodes.find((n) => n.id === node.id)!;
    // Starts with, not equals: a name contested by another participant is
    // suffixed to keep it distinct, and that is correct behaviour here.
    expect(found.seat.startsWith(seatName(peerAgent))).toBe(true);
    expect(found.lastEditedBy).toBe('agent');
  });

  it('marks this agent’s own work as its own', async () => {
    const mine = scene().addNode({ text: 'mine', x: 0, y: 0 }, myAgent());
    const theirs = scene().addNode({ text: 'theirs', x: 0, y: 0 }, agentId());

    const nodes = (await getScene()).nodes;
    expect(nodes.find((n) => n.id === mine.id)!.mine).toBe(true);
    expect(nodes.find((n) => n.id === theirs.id)!.mine).toBe(false);
  });

  it('counts the human it sits beside as this seat, not a stranger', async () => {
    // The person in this tab and its agent are one seat. Reporting their work
    // as another participant's would make the agent defer to its own human.
    const node = scene().addNode({ text: 'ours', x: 0, y: 0 }, me());

    const found = (await getScene()).nodes.find((n) => n.id === node.id)!;
    expect(found.seat.startsWith(seatName(me()))).toBe(true);
    expect(found.mine).toBe(true);
    expect(found.lastEditedBy).toBe('human');
  });

  it('tells two peers apart even when their seat names collide', async () => {
    const a = agentId();
    const b = agentId();
    const one = scene().addNode({ text: 'a', x: 0, y: 0 }, a);
    const two = scene().addNode({ text: 'b', x: 0, y: 0 }, b);

    const nodes = (await getScene()).nodes;
    const seatOf = (id: string) => nodes.find((n) => n.id === id)!.seat;
    expect(seatOf(one.id)).not.toBe(seatOf(two.id));
  });

  it('says who drew an edge as well as who wrote a note', async () => {
    const peer = agentId();
    const [x, y] = scene().scene.nodes;
    scene().addEdge(x.id, y.id, 'theirs', peer);

    const tool = buildTools().find((t) => t.name === 'get_scene')!;
    const out = (await tool.execute({})) as { edges: { seat: string; mine: boolean }[] };
    const last = out.edges[out.edges.length - 1];
    expect(last.seat.startsWith(seatName(peer))).toBe(true);
    expect(last.mine).toBe(false);
  });
});
