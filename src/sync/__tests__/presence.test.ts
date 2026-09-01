import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';
import { MAX_IDS, holdsFrom, leave, peersOf, publish, readPresence } from '../presence';
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
    expect(readPresence({ actor: ALEX, name: 'Alex', holding: ['n_0'], selected: [], cursor: { x: 1, y: 2 } }))
      .toEqual({ actor: ALEX, name: 'Alex', holding: ['n_0'], selected: [], cursor: { x: 1, y: 2 } });
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

  it('does not let a second agent count as its own hand', () => {
    const [, a] = seat();
    const [, b] = seat();
    publish(a, { actor: ALEX, holding: ['n_0'] });
    publish(b, { actor: BOS_AGENT, holding: ['n_0'] });
    gossip(a, b);

    // Agents never take grip in this app, but presence is a wire format and a
    // peer could still claim one. The merge stays deterministic either way.
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
