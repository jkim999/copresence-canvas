import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';
import {
  MAX_IDS,
  PRESENCE_TTL_MS,
  everyoneOn,
  holdsFrom,
  holdsOf,
  leave,
  liveClients,
  peersOf,
  publish,
  readPresence,
} from '../presence';
import { agentId, humanId } from '../../state/actors';

/**
 * Presence is the half of multiplayer a CRDT must not hold. Everything here is
 * about a claim expiring, or two peers reaching for the same note at once.
 */

const ALEX = humanId();
const BO = humanId();
const BOS_AGENT = agentId();

const seat = (): [Y.Doc, Awareness] => {
  const doc = new Y.Doc();
  return [doc, new Awareness(doc)];
};

/**
 * What the transport will do for real: ship state both ways. Note that the
 * clients encoded come from `meta`, not `getStates()`. A peer that has just said
 * goodbye is *absent* from its own states but still present in meta, so reading
 * states would ship every update except the one that frees a note.
 */
const gossip = (a: Awareness, b: Awareness): void => {
  applyAwarenessUpdate(b, encodeAwarenessUpdate(a, [...a.meta.keys()]), 'test');
  applyAwarenessUpdate(a, encodeAwarenessUpdate(b, [...b.meta.keys()]), 'test');
};

describe('reading a peer state off the wire', () => {
  it('refuses a state with no actor', () => {
    expect(readPresence(null)).toBeNull();
    expect(readPresence({})).toBeNull();
    expect(readPresence({ actor: 42 })).toBeNull();
    expect(readPresence('human')).toBeNull();
  });

  it('keeps a well-formed state whole', () => {
    const state = {
      actor: ALEX,
      name: 'Alex',
      holding: ['n_0'],
      agent: BOS_AGENT,
      agentHolding: ['n_1'],
      selected: [],
      cursor: { x: 1, y: 2 },
    };

    expect(readPresence(state)).toEqual(state);
  });

  it('reads a peer that has no agent beside it', () => {
    // An older build, or a tab that never paired one. Its person still holds
    // notes and must still be able to refuse them.
    const p = readPresence({ actor: ALEX, name: 'Alex', holding: ['n_0'] })!;

    expect(p.agent).toBeNull();
    expect(p.agentHolding).toEqual([]);
    expect(holdsOf([p])).toEqual({ n_0: ALEX });
  });

  it('survives a peer sending nonsense in every field', () => {
    // Another tab is external input. It may be a different version of this app,
    // or a broken one, and it must not be able to crash the board.
    const p = readPresence({
      actor: ALEX,
      name: { nope: true },
      holding: ['n_0', 7, null, 'n_0'],
      selected: 'not-an-array',
      cursor: { x: 'left', y: 2 },
    })!;

    expect(p.holding).toEqual(['n_0']);
    expect(p.selected).toEqual([]);
    expect(p.cursor).toBeNull();
    expect(typeof p.name).toBe('string');
  });

  it('caps how much one peer can claim', () => {
    const many = Array.from({ length: MAX_IDS + 50 }, (_, i) => `n_${i}`);
    expect(readPresence({ actor: ALEX, holding: many })!.holding).toHaveLength(MAX_IDS);
  });
});

describe('two peers on one board', () => {
  it('sees each other without seeing itself as a peer', () => {
    const [, a] = seat();
    const [, b] = seat();
    publish(a, { actor: ALEX, name: 'Alex' });
    publish(b, { actor: BO, name: 'Bo' });
    gossip(a, b);

    expect(peersOf(a).map((p) => p.actor)).toEqual([BO]);
    expect(peersOf(b).map((p) => p.actor)).toEqual([ALEX]);
  });

  it('folds every hand into one grip map', () => {
    const [, a] = seat();
    const [, b] = seat();
    publish(a, { actor: ALEX, holding: ['n_0'] });
    publish(b, { actor: BO, holding: ['n_1'] });
    gossip(a, b);

    expect(holdsFrom(a)).toEqual({ n_0: ALEX, n_1: BO });
    expect(holdsFrom(b)).toEqual(holdsFrom(a));
  });

  it('gives a note to one hand when both grab it in the same instant', () => {
    const [, a] = seat();
    const [, b] = seat();
    publish(a, { actor: ALEX, holding: ['n_0'] });
    publish(b, { actor: BO, holding: ['n_0'] });
    gossip(a, b);

    // Which hand wins is arbitrary. That both peers name the *same* hand is the
    // whole point: otherwise each tab thinks it owns the note and both move it.
    expect(holdsFrom(a)).toEqual(holdsFrom(b));
    expect(Object.keys(holdsFrom(a))).toEqual(['n_0']);
  });

  it('gives the note to the person when a hand and an agent both grab it', () => {
    // Agents take grip now, so the tie-break has to carry the rule rather than
    // leave it to the ids — and the ids say the opposite, since every agent id
    // begins `a_` and every human id `h_`.
    const [, a] = seat();
    const [, b] = seat();
    publish(a, { actor: BOS_AGENT, holding: ['n_0'] });
    publish(b, { actor: ALEX, holding: ['n_0'] });
    gossip(a, b);

    expect(holdsFrom(a)).toEqual({ n_0: ALEX });
    expect(holdsFrom(b)).toEqual(holdsFrom(a));
  });

  it('does not let a second agent count as its own hand', () => {
    const [, a] = seat();
    const [, b] = seat();
    publish(a, { actor: ALEX, holding: ['n_0'] });
    publish(b, { actor: BOS_AGENT, holding: ['n_0'] });
    gossip(a, b);

    // Two machines reaching for the same note have no rank between them, so
    // the id decides. All that matters is that it decides the same way twice.
    expect(holdsFrom(a)).toEqual(holdsFrom(b));
  });
});

describe('a hand that goes away', () => {
  it('releases what it held when the peer says goodbye', () => {
    const [, a] = seat();
    const [, b] = seat();
    publish(a, { actor: ALEX, holding: ['n_0'] });
    publish(b, { actor: BO, holding: ['n_1'] });
    gossip(a, b);

    leave(b);
    gossip(a, b);

    expect(holdsFrom(a)).toEqual({ n_0: ALEX });
    expect(peersOf(a)).toEqual([]);
  });

  it('releases what it held when the peer just disappears', () => {
    // The case that matters: a tab closed mid-drag, no goodbye. This is the
    // grip TTL, and it is awareness's timeout rather than anything we wrote.
    const [, a] = seat();
    const [, b] = seat();
    publish(a, { actor: ALEX, holding: ['n_0'] });
    publish(b, { actor: BO, holding: ['n_1'] });
    gossip(a, b);
    expect(holdsFrom(a)).toEqual({ n_0: ALEX, n_1: BO });

    removeAwarenessStates(a, [b.clientID], 'timeout');

    expect(holdsFrom(a)).toEqual({ n_0: ALEX });
  });

  it('lets go of one note without letting go of the peer', () => {
    const [, a] = seat();
    publish(a, { actor: ALEX, holding: ['n_0', 'n_1'] });
    publish(a, { holding: ['n_1'] });

    expect(holdsFrom(a)).toEqual({ n_1: ALEX });
    expect(readPresence(a.getLocalState())!.actor).toBe(ALEX);
  });
});

/**
 * Awareness drops a client that stops heartbeating, but it does that work on an
 * interval of its own — and a browser throttles timers in a tab nobody is
 * looking at, to once a second and eventually once a minute. So in a background
 * tab the drop simply does not happen on time: a crashed peer stays in the room
 * long past its TTL, and the notes in its hands stay locked, which makes the
 * refusal — the whole product — wrong for a minute at a stretch.
 *
 * The fix is to stop asking a timer. Liveness is decided when somebody looks.
 */
describe('a peer that stopped heartbeating', () => {
  const stale = (a: Awareness, client: number, ms: number): void => {
    const meta = a.meta.get(client)!;
    a.meta.set(client, { ...meta, lastUpdated: meta.lastUpdated - ms });
  };

  it('is gone from the room the moment anyone looks, with no timer involved', () => {
    const [, a] = seat();
    const [, b] = seat();
    publish(a, { actor: ALEX, holding: ['n_0'] });
    publish(b, { actor: BO, holding: ['n_1'] });
    gossip(a, b);
    expect(peersOf(a)).toHaveLength(1);

    // No interval is pumped and no removal is broadcast — exactly the state a
    // throttled tab is in. Only the clock has moved.
    stale(a, b.clientID, PRESENCE_TTL_MS + 1);

    expect(peersOf(a)).toEqual([]);
  });

  it('releases the notes it was holding, so the board stops refusing them', () => {
    const [, a] = seat();
    const [, b] = seat();
    publish(a, { actor: ALEX, holding: ['n_0'] });
    publish(b, { actor: BO, holding: ['n_1'] });
    gossip(a, b);
    expect(holdsFrom(a)).toEqual({ n_0: ALEX, n_1: BO });

    stale(a, b.clientID, PRESENCE_TTL_MS + 1);

    expect(holdsFrom(a)).toEqual({ n_0: ALEX });
  });

  it('keeps a peer that is merely quiet, not gone', () => {
    const [, a] = seat();
    const [, b] = seat();
    publish(a, { actor: ALEX });
    publish(b, { actor: BO, holding: ['n_1'] });
    gossip(a, b);

    stale(a, b.clientID, PRESENCE_TTL_MS - 1_000);

    expect(peersOf(a).map((p) => p.actor)).toEqual([BO]);
    expect(holdsFrom(a)).toEqual({ n_1: BO });
  });

  it('never expires you from your own board however long the tab idles', () => {
    // The local client is self-evidently present. Timing it out would empty the
    // room of the one person who is definitely in it.
    const [, a] = seat();
    publish(a, { actor: ALEX, holding: ['n_0'] });

    stale(a, a.clientID, PRESENCE_TTL_MS * 10);

    expect(everyoneOn(a).map((p) => p.actor)).toEqual([ALEX]);
    expect(holdsFrom(a)).toEqual({ n_0: ALEX });
  });
});

/**
 * Catching a newcomer up used to mean shipping every client in `meta`, and
 * `applyAwarenessUpdate` stamps each one as heard-from *now* on the receiving
 * side. So a peer that had been gone for half an hour was resurrected by every
 * arrival, and two tabs kept a dead third alive between them indefinitely — no
 * expiry could reach it, because its clock was being reset faster than it ran.
 *
 * Observed: two tabs, both freshly reloaded, each reporting a third participant
 * whose id had been minted thirty-five minutes earlier. It also broke consent,
 * since a seat that cannot answer still counted toward unanimity.
 */
describe('catching a newcomer up', () => {
  const stale = (a: Awareness, client: number, ms: number): void => {
    const meta = a.meta.get(client)!;
    a.meta.set(client, { ...meta, lastUpdated: meta.lastUpdated - ms });
  };

  it('does not pass on a peer that went silent long ago', () => {
    const [, a] = seat();
    const [, b] = seat();
    publish(a, { actor: ALEX });
    publish(b, { actor: BO });
    gossip(a, b);

    stale(a, b.clientID, PRESENCE_TTL_MS + 1);

    expect(liveClients(a)).not.toContain(b.clientID);
  });

  it('still passes on a goodbye, which is fresh news that frees notes', () => {
    // A tab that has just left is absent from its own states but present in
    // meta with a recent timestamp. Dropping it would strand its held notes.
    const [, a] = seat();
    const [, b] = seat();
    publish(a, { actor: ALEX });
    publish(b, { actor: BO, holding: ['n_1'] });
    gossip(a, b);

    leave(b);
    gossip(a, b);

    expect(liveClients(a)).toContain(b.clientID);
  });

  it('always includes you, however long you have sat still', () => {
    const [, a] = seat();
    publish(a, { actor: ALEX });
    stale(a, a.clientID, PRESENCE_TTL_MS * 10);

    expect(liveClients(a)).toContain(a.clientID);
  });
});
