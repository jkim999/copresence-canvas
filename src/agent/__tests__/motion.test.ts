import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { moveCursorTo, tweenNodeTo, useCursorStore } from '../motion';
import { animateAgentCursorThrough } from '../actions';
import { me } from '../../state/actors';
import { announce, requestStop, useIntentStore } from '../intent';
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


/**
 * Calling an act off, at the level where it actually has to take effect.
 *
 * The strip has always said the rings it draws are "the ones you can call off"
 * and until now nothing could call anything off. What makes the handle honest
 * is here rather than in the button: the loop has to notice, it has to stop
 * between notes rather than dropping one mid-air, and it has to report that it
 * was stopped — a short result the caller has to infer from is how an agent
 * decides to helpfully try again.
 *
 * A browser cannot demonstrate this, which is why it is pinned here. In a tab
 * nobody is looking at, every tween lands instantly and there is genuinely
 * nothing left to stop by the time a probe can run.
 */
describe('stopping an act that is under way', () => {
  const ids = () => useSceneStore.getState().scene.nodes.slice(0, 6).map((n) => n.id);

  beforeEach(() => useIntentStore.setState({ mine: null, stopping: false }));

  it('runs to the end when nobody objects', async () => {
    const result = await announce({ verb: 'arranging', what: '6 notes', ids: ids() }, () =>
      animateAgentCursorThrough(ids(), {
        targets: Object.fromEntries(ids().map((id, i) => [id, { x: i * 100, y: 0 }])),
        speed: 40,
        grabPause: 0,
        carryDuration: 20,
      }),
    );
    expect(result.stopped).toBe(false);
    expect(result.notReached).toEqual([]);
    expect(result.moved).toBe(6);
  });

  it('puts the board down between notes and says which it never reached', async () => {
    let visited = 0;
    const result = await announce({ verb: 'arranging', what: '6 notes', ids: ids() }, () =>
      animateAgentCursorThrough(ids(), {
        targets: Object.fromEntries(ids().map((id, i) => [id, { x: i * 100, y: 0 }])),
        speed: 40,
        grabPause: 0,
        carryDuration: 20,
        onVisit: () => {
          visited += 1;
          if (visited === 2) requestStop();
        },
      }),
    );

    expect(result.stopped).toBe(true);
    // Two were reached; the rest were never touched, and the caller is told so
    // by name rather than being left to subtract.
    expect(result.moved).toBe(2);
    expect(result.notReached).toHaveLength(4);
    expect(result.moved + result.notReached.length).toBe(6);
  });

  it('leaves the notes it never reached exactly where their owner put them', async () => {
    const all = ids();
    const before = new Map(
      all.map((id) => {
        const n = useSceneStore.getState().getNode(id)!;
        return [id, { x: n.x, y: n.y }];
      }),
    );

    const result = await announce({ verb: 'arranging', what: '6 notes', ids: all }, () =>
      animateAgentCursorThrough(all, {
        targets: Object.fromEntries(all.map((id, i) => [id, { x: 9000 + i * 100, y: 9000 }])),
        speed: 40,
        grabPause: 0,
        carryDuration: 20,
        onVisit: () => requestStop(),
      }),
    );

    // Not vacuous: an empty list would pass the loop below without asserting.
    expect(result.notReached.length).toBeGreaterThan(0);
    for (const id of result.notReached) {
      const after = useSceneStore.getState().getNode(id)!;
      expect({ x: after.x, y: after.y }).toEqual(before.get(id));
    }
  });
});


/**
 * The refusal, told to the person it was made for.
 *
 * A hand closing on a note and the machine giving it up is the moment this
 * whole canvas exists to demonstrate — and it was reported only to the agent,
 * under `yieldedToHuman`. The human felt a note not moving and was told
 * nothing, while the model got a sentence about it. The human is the one being
 * defended and was the one kept in the dark.
 */
describe('what the human is told when the agent lets go', () => {
  const notices = () =>
    useSceneStore
      .getState()
      .log.filter((entry) => entry.text.includes('let go'))
      .map((entry) => entry.text);

  it('says so, in the record, naming who took it', async () => {
    const [note] = useSceneStore.getState().scene.nodes;
    const flight = animateAgentCursorThrough([note.id], {
      targets: { [note.id]: { x: 900, y: 900 } },
      speed: 40,
      grabPause: 0,
      carryDuration: 400,
    });
    // A hand closes on it mid-flight, which is the case the board promises.
    await new Promise((resolve) => setTimeout(resolve, 90));
    useSceneStore.getState().setGrip([note.id], LOCAL_HUMAN);
    const result = await flight;

    expect(result.yieldedToHuman).toEqual([note.id]);
    expect(notices()).toHaveLength(1);
    expect(notices()[0]).toContain('a note');
    // This tab's own human reads as "you", not as a seat name: a seat name is
    // what a peer calls you, and being told a stranger took your own note is
    // worse than not being told at all.
    expect(notices()[0]).toContain(LOCAL_HUMAN === me() ? 'you had hold of' : 'had hold of');
  });

  it('says nothing when nothing was taken', async () => {
    const [note] = useSceneStore.getState().scene.nodes;
    await animateAgentCursorThrough([note.id], {
      targets: { [note.id]: { x: 300, y: 300 } },
      speed: 40,
      grabPause: 0,
      carryDuration: 20,
    });
    expect(notices()).toEqual([]);
  });
});
