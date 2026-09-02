import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { moveCursorTo, tweenNodeTo, useCursorStore } from '../motion';
import { useSceneStore } from '../../state/sceneStore';
import { LOCAL_HUMAN, myAgent } from '../../state/actors';

/**
 * The animation loop is where a tool call goes to wait, so every promise it
 * hands out has to settle and every promise has to tell the truth about *why*
 * it settled. A tween that the agent itself replaced is not the human taking a
 * note away, and a cursor move that never resolves strands the whole call.
 */

const store = () => useSceneStore.getState();

const frames = new Set<ReturnType<typeof setTimeout>>();

beforeEach(() => {
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => {
    const handle = setTimeout(() => cb(performance.now()), 16);
    frames.add(handle);
    return handle;
  });
  vi.stubGlobal('cancelAnimationFrame', (handle: ReturnType<typeof setTimeout>) => {
    frames.delete(handle);
    clearTimeout(handle);
  });
  store().resetScene();
  store().clearGrip();
  useCursorStore.getState().set({ visible: false, x: 0, y: 0 });
});

afterEach(() => {
  for (const handle of frames) clearTimeout(handle);
  frames.clear();
  vi.unstubAllGlobals();
});

/** Resolves 'hung' if the promise has not settled in time. */
const within = (promise: Promise<unknown>, ms: number): Promise<string> =>
  Promise.race([
    promise.then(() => 'settled'),
    new Promise<string>((resolve) => setTimeout(() => resolve('hung'), ms)),
  ]);

describe('a tween that ends early', () => {
  it('says the human took it only when a hand is actually on it', async () => {
    const target = store().scene.nodes[0];
    const flight = tweenNodeTo(target.id, 500, 500, 400);
    store().setGrip([target.id], LOCAL_HUMAN);

    expect(await flight).toBe('yielded');
  });

  it('does not blame the human for a tween the agent replaced', async () => {
    // The bug this exists for: the superseded tween resolved the same value as
    // a stolen one, so the model was told a human grabbed a note that nobody
    // had touched. A fabricated refusal is worse than a missed one.
    const target = store().scene.nodes[0];
    const first = tweenNodeTo(target.id, 500, 500, 300);
    const second = tweenNodeTo(target.id, 900, 900, 60);

    expect(await first).toBe('dropped');
    expect(await second).toBe('landed');
    expect(store().heldBy(target.id)).toBeNull();
  });

  it('does not blame the human for a note that is no longer there', async () => {
    expect(await tweenNodeTo('n_nowhere', 10, 10, 40)).toBe('dropped');
  });
});

describe('a cursor move that is replaced mid-flight', () => {
  it('settles instead of stranding the call that awaited it', async () => {
    // A single cursor slot used to be overwritten without resolving what it
    // displaced, so two concurrent tool calls left one of them awaiting a
    // promise that could never settle — and nothing above here times out.
    const first = moveCursorTo(100, 100, { min: 400, max: 400 });
    const second = moveCursorTo(600, 600, { min: 60, max: 60 });

    expect(await within(first, 900)).toBe('settled');
    await second;
    expect(useCursorStore.getState().x).toBe(600);
  });
});

describe('a note the agent is carrying', () => {
  it('is held by the agent for as long as it is in flight', async () => {
    // Multiplayer gave every tab an agent of its own, and nothing anywhere took
    // a grip on the agent's behalf — so two agents arranging overlapping notes
    // both passed the refusal check and fought over every position.
    const target = store().scene.nodes[0];
    const flight = tweenNodeTo(target.id, 400, 400, 200);
    await new Promise((r) => setTimeout(r, 60));

    expect(store().heldBy(target.id)).toBe(myAgent());

    // And the agent's own hand is not a reason to let go of its own note.
    expect(await flight).toBe('landed');
    expect(store().heldBy(target.id)).toBeNull();
  });

  it('comes free the moment a person reaches for it', async () => {
    const target = store().scene.nodes[0];
    const flight = tweenNodeTo(target.id, 400, 400, 400);
    await new Promise((r) => setTimeout(r, 60));
    expect(store().heldBy(target.id)).toBe(myAgent());

    store().setGrip([target.id], LOCAL_HUMAN);

    expect(await flight).toBe('yielded');
    expect(store().heldBy(target.id)).toBe(LOCAL_HUMAN);
  });
});

/**
 * A browser suspends animation frames and throttles timers in a tab nobody is
 * looking at. Every one of these tweens then waits on a clock that has all but
 * stopped, and a tool call built from a dozen of them — cursor move, write,
 * pause, repeat — stretched to minutes. Two agents driving background tabs both
 * read that as a hang, invented a cause (one blamed a mutex, one blamed a
 * server that does not exist), and retried, duplicating their own work.
 *
 * The animation is an affordance for a human who is watching the agent work.
 * In a hidden tab there is no such human, so there is nothing to pace for: the
 * change lands at once and the call returns immediately.
 */
describe('a tab nobody is looking at', () => {
  const hide = () => vi.stubGlobal('document', { visibilityState: 'hidden' });

  it('lands a note without waiting for a frame that will never come', async () => {
    hide();
    // No rAF is pumped at all: if this resolves, it resolved without one.
    vi.stubGlobal('requestAnimationFrame', () => 0);

    const id = store().scene.nodes[0].id;
    const began = performance.now();
    await expect(tweenNodeTo(id, 400, 250)).resolves.toBe('landed');
    // The assertion that discriminates. Settling eventually proves nothing —
    // the watchdog already did that, in the full 460ms the animation would
    // have taken. What is being fixed is the waiting itself.
    expect(performance.now() - began).toBeLessThan(50);

    const node = store().getNode(id)!;
    expect([node.x, node.y]).toEqual([400, 250]);
  });

  it('leaves the note exactly where it was asked to go, not part way', async () => {
    hide();
    vi.stubGlobal('requestAnimationFrame', () => 0);

    const id = store().scene.nodes[1].id;
    await tweenNodeTo(id, -120, 96);

    expect(store().getNode(id)!.x).toBe(-120);
  });

  it('settles the cursor rather than stranding the call that awaits it', async () => {
    hide();
    vi.stubGlobal('requestAnimationFrame', () => 0);

    const began = performance.now();
    await expect(moveCursorTo(300, 300)).resolves.toBeUndefined();
    expect(performance.now() - began).toBeLessThan(50);
    const cursor = useCursorStore.getState();
    expect([cursor.x, cursor.y]).toEqual([300, 300]);
  });

  it('still yields the note to a human who has hold of it', async () => {
    // Skipping the animation must not skip the refusal. The note is held, so
    // the agent gives it back — instantly, but it still gives it back.
    hide();
    vi.stubGlobal('requestAnimationFrame', () => 0);

    const id = store().scene.nodes[2].id;
    store().setGrip([id], LOCAL_HUMAN);

    await expect(tweenNodeTo(id, 900, 900)).resolves.toBe('yielded');
    expect(store().getNode(id)!.x).not.toBe(900);
  });

  it('animates as before once somebody is watching again', async () => {
    vi.stubGlobal('document', { visibilityState: 'visible' });
    const id = store().scene.nodes[0].id;
    const from = store().getNode(id)!.x;

    const settled = tweenNodeTo(id, from + 500, 0);
    // Mid-flight it is somewhere between the two, which is the whole point of
    // pacing it for a human to see and interrupt.
    await new Promise((r) => setTimeout(r, 40));
    const mid = store().getNode(id)!.x;
    expect(mid).not.toBe(from + 500);

    await settled;
    expect(store().getNode(id)!.x).toBe(from + 500);
  });
});
