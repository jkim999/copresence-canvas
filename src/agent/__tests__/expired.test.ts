import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTools } from '../tools';
import { useSceneStore } from '../../state/sceneStore';
import { resetJournal, watchScene } from '../../state/journal';
import { me, takeSeat } from '../../state/actors';
import { setRoomSource } from '../../sync/peers';
import { dropAllHands, takeHand } from '../../state/hands';

/**
 * The gate as an agent actually meets it: through the registered tool, with a
 * real bookmark from a real read, against a board a peer has moved underneath.
 *
 * Driven end to end on purpose. The rule is a pure function and its own tests
 * pass without proving the thing that matters — that the write is refused
 * before it lands, that the board is genuinely untouched afterwards, and that
 * what comes back tells a model to look again rather than to push harder.
 */

const scene = () => useSceneStore.getState();
let unwatch: (() => void) | undefined;

const tool = (name: string) => buildTools().find((t) => t.name === name)!;

const readBoard = async () => (await tool('get_scene').execute({})) as {
  asOf: number;
  nodes: { id: string; x: number; y: number }[];
};

beforeEach(() => {
  // Headless, so the choreography lands instantly instead of animating — the
  // same path a backgrounded tab takes. The gate runs before any of it either
  // way; this only keeps the test from waiting on frames that never come.
  vi.stubGlobal('document', { visibilityState: 'hidden' });
  setRoomSource(null);
  // The journal derives itself by watching the scene, and the gate reads the
  // journal. Without the watcher running, a peer's move leaves no trace and the
  // gate would correctly find nothing to refuse — passing for the wrong reason.
  unwatch = watchScene();
  dropAllHands();
  resetJournal();
  takeSeat();
  scene().resetScene();
});

afterEach(() => {
  unwatch?.();
  unwatch = undefined;
  vi.unstubAllGlobals();
});

describe('a write against a board that has moved', () => {
  it('is refused, and refused before anything is touched', async () => {
    const read = await readBoard();
    const ids = read.nodes.slice(0, 4).map((n) => n.id);
    const before = read.nodes.slice(0, 4).map((n) => ({ id: n.id, x: n.x, y: n.y }));

    // A peer reaches the board first, in the seconds the model spent deciding.
    scene().moveNode(ids[1], 4321, 8765, 'h_peer');

    const result = (await tool('arrange_region').execute({
      nodeIds: ids,
      layout: 'grid',
      basedOn: read.asOf,
    })) as { refused?: string; moved: number; note?: string; changed?: { ids: string[] }[] };

    expect(result.refused).toBe('stale');
    expect(result.moved).toBe(0);
    expect(result.changed?.flatMap((c) => c.ids)).toContain(ids[1]);

    // The notes it never got to are exactly where they were, and the peer's is
    // where the peer put it. A refusal that half-landed would be worse than none.
    const now = scene().scene.nodes;
    for (const was of before.filter((n) => n.id !== ids[1])) {
      const node = now.find((n) => n.id === was.id)!;
      expect([node.x, node.y]).toEqual([was.x, was.y]);
    }
    const moved = now.find((n) => n.id === ids[1])!;
    expect([moved.x, moved.y]).toEqual([4321, 8765]);
  });

  it('tells the model to re-read rather than to repeat itself', async () => {
    const read = await readBoard();
    const ids = read.nodes.slice(0, 3).map((n) => n.id);
    scene().moveNode(ids[0], 10, 10, 'h_peer');

    const result = (await tool('arrange_region').execute({
      nodeIds: ids,
      layout: 'cluster',
      basedOn: read.asOf,
    })) as { note: string };

    expect(result.note).toMatch(/what_changed/);
    expect(result.note).toMatch(/do not simply repeat/i);
  });

  it('lets the same call through once the agent has read the change', async () => {
    const first = await readBoard();
    const ids = first.nodes.slice(0, 3).map((n) => n.id);
    scene().moveNode(ids[0], 10, 10, 'h_peer');

    const fresh = await readBoard();
    const result = (await tool('arrange_region').execute({
      nodeIds: ids,
      layout: 'cluster',
      basedOn: fresh.asOf,
    })) as { refused?: string; moved: number };

    expect(result.refused).toBeUndefined();
    expect(result.moved).toBeGreaterThan(0);
  });

  it('writes blind, as before, when no premise is cited', async () => {
    const read = await readBoard();
    const ids = read.nodes.slice(0, 3).map((n) => n.id);
    scene().moveNode(ids[0], 10, 10, 'h_peer');

    const result = (await tool('arrange_region').execute({
      nodeIds: ids,
      layout: 'cluster',
    })) as { refused?: string; moved: number };

    expect(result.refused).toBeUndefined();
    expect(result.moved).toBeGreaterThan(0);
  });

  it('does not hold the agent’s own work against it', async () => {
    const read = await readBoard();
    const ids = read.nodes.slice(0, 3).map((n) => n.id);
    await tool('arrange_region').execute({ nodeIds: ids, layout: 'grid' });

    const result = (await tool('arrange_region').execute({
      nodeIds: ids,
      layout: 'cluster',
      basedOn: read.asOf,
    })) as { refused?: string };

    expect(result.refused).toBeUndefined();
  });

  it('refuses a whole-board proposal without ever putting it to the room', async () => {
    const read = await readBoard();
    const ids = read.nodes.slice(0, 5).map((n) => n.id);
    scene().moveNode(ids[2], 1, 1, 'h_peer');

    const result = (await tool('reorganize_board').execute({
      rationale: 'tidying',
      groups: [{ label: 'All', nodeIds: ids }],
      basedOn: read.asOf,
    })) as { refused?: string; approved?: boolean };

    expect(result.refused).toBe('stale');
    // Never asked, so never answered. A vote on a board that no longer exists
    // spends the room's attention on a question that cannot be honoured.
    expect(result.approved).toBeUndefined();
  });

  it('protects a note the human is only typing in, which holds no drag', async () => {
    const read = await readBoard();
    const ids = read.nodes.slice(0, 3).map((n) => n.id);
    takeHand('edit', ids[1]);
    const held = scene().grip[ids[1]];
    expect(held).toBe(me());

    const before = scene().scene.nodes.find((n) => n.id === ids[1])!;
    await tool('arrange_region').execute({ nodeIds: ids, layout: 'grid' });
    const after = scene().scene.nodes.find((n) => n.id === ids[1])!;
    expect([after.x, after.y]).toEqual([before.x, before.y]);
  });
});
