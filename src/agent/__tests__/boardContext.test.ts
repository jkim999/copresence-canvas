import { beforeEach, describe, expect, it } from 'vitest';
import { boardContext, pacing } from '../boardContext';
import { setRoomSource, usePeerStore } from '../../sync/peers';
import { PRESENCE_TTL_MS } from '../../sync/presence';
import { useSceneStore } from '../../state/sceneStore';
import { agentId, humanId, me, myAgent, seatName, takeSeat } from '../../state/actors';

/**
 * Two agents were set loose on one board and neither could answer the first
 * question any participant in a shared space has to answer: who am I, and who
 * else is here? Both scraped the DOM for their own seat name and at least one
 * of them got it wrong. Worse, a refusal comes back naming a seat ("Ochre
 * declined") that the agent has no way to resolve to a person at all.
 *
 * Every fact below exists because an agent guessed it and guessed badly.
 */

const peer = (actor: string, holding: string[] = [], agent: string | null = null) => ({
  actor,
  name: seatName(actor),
  holding,
  agent,
  agentHolding: [],
  selected: [],
  cursor: null,
});

beforeEach(() => {
  usePeerStore.setState({ peers: [], at: Date.now() });
  setRoomSource(null);
  useSceneStore.getState().clearGrip();
  takeSeat();
});

describe('an agent asking who it is', () => {
  it('names its own seat the same way everybody else names it', () => {
    const ctx = boardContext();
    expect(ctx.you.seat).toBe(seatName(me()));
    expect(ctx.you.actor).toBe(me());
    expect(ctx.you.agent).toBe(myAgent());
  });

  it('says plainly when nobody else is here', () => {
    const ctx = boardContext();
    expect(ctx.alone).toBe(true);
    expect(ctx.others).toEqual([]);
  });
});

describe('an agent asking who else is here', () => {
  it('lists every peer by the seat name a refusal would use', () => {
    const other = humanId();
    usePeerStore.setState({ peers: [peer(other)] });

    const ctx = boardContext();
    expect(ctx.alone).toBe(false);
    expect(ctx.others).toHaveLength(1);
    expect(ctx.others[0].seat).toBe(seatName(other));
    expect(ctx.others[0].actor).toBe(other);
  });

  it('reports what a peer is holding, so the agent can work elsewhere', () => {
    const other = humanId();
    usePeerStore.setState({ peers: [peer(other, ['n_3', 'n_4'])] });

    expect(boardContext().others[0].holding).toEqual(['n_3', 'n_4']);
  });

  it('says whether a peer has an agent of its own', () => {
    const lone = humanId();
    const paired = humanId();
    usePeerStore.setState({ peers: [peer(lone), peer(paired, [], agentId())] });

    const byActor = Object.fromEntries(boardContext().others.map((o) => [o.actor, o]));
    expect(byActor[lone].hasAgent).toBe(false);
    expect(byActor[paired].hasAgent).toBe(true);
  });

  it('warns that a whole-board change now needs every one of them', () => {
    usePeerStore.setState({ peers: [peer(humanId()), peer(humanId())] });
    expect(boardContext().consent).toMatch(/every|all|unanim/i);
  });
});

describe('an agent asking why it is being made to wait', () => {
  it('does not pretend to know about a page that has no document', () => {
    // Node has no `document`. The honest answer is that visibility is unknown,
    // not a confident `true` that would teach the agent the wrong lesson.
    expect(pacing().pageVisible).toBeNull();
  });

  it('always explains that slowness is pacing and not a failure to retry', () => {
    expect(pacing().note).toMatch(/retry/i);
  });
});

/**
 * The peer list is a cache, refreshed when awareness fires an event — and in a
 * hidden tab those events are throttled to roughly once a minute. Reporting a
 * minute-old cache as present fact is how an agent ends up confidently wrong
 * about who is in the room, which is the exact failure this tool was added to
 * prevent. It says how old the answer is instead.
 */
describe('an agent asking how much to trust the peer list', () => {
  it('says how long ago the room was last confirmed', () => {
    usePeerStore.setState({ peers: [peer(humanId())], at: Date.now() - 4_000 });
    expect(boardContext().peersConfirmedSecondsAgo).toBe(4);
  });

  it('warns in its own words once the list is older than a peer TTL', () => {
    // Derived from the constant rather than a literal: the TTL has already been
    // changed once, and a hard-coded 45s silently stopped testing anything.
    const past = PRESENCE_TTL_MS + 5_000;
    usePeerStore.setState({ peers: [peer(humanId())], at: Date.now() - past });
    const ctx = boardContext();
    expect(ctx.peersConfirmedSecondsAgo).toBe(Math.round(past / 1000));
    expect(ctx.note).toMatch(/stale|may have|no longer/i);
  });

  it('does not cry stale when the room was confirmed a moment ago', () => {
    usePeerStore.setState({ peers: [peer(humanId())], at: Date.now() - 1_000 });
    expect(boardContext().note).not.toMatch(/stale/i);
  });
});

/**
 * The peer list was a cache written only when awareness fired a change event —
 * and those are throttled in a hidden tab. Two agents arriving cold both saw a
 * phantom third seat for their entire run, because the tab that had left was
 * still in the cache and nothing woke up to remove it.
 *
 * It was not merely cosmetic. The consent quorum is drawn from the same list,
 * so a departed seat kept a vote it could never cast, and every whole-board
 * change both agents attempted timed out waiting for a peer who was gone.
 */
describe('the room as it is, not as it was last cached', () => {
  it('asks a live source rather than trusting the cache', () => {
    const live = humanId();
    usePeerStore.setState({ peers: [peer(humanId())], at: Date.now() - 90_000 });
    setRoomSource(() => ({ peers: [peer(live)], heardAgoMs: 500 }));

    const ctx = boardContext();
    expect(ctx.others.map((o) => o.actor)).toEqual([live]);
    expect(ctx.peersConfirmedSecondsAgo).toBe(1);
  });

  it('drops a seat that has gone, so it cannot hold a vote hostage', () => {
    usePeerStore.setState({ peers: [peer(humanId())], at: Date.now() });
    setRoomSource(() => ({ peers: [], heardAgoMs: 0 }));

    const ctx = boardContext();
    expect(ctx.alone).toBe(true);
    expect(ctx.others).toEqual([]);
  });

  it('falls back to the cache when nothing is connected at all', () => {
    const cached = humanId();
    setRoomSource(null);
    usePeerStore.setState({ peers: [peer(cached)], at: Date.now() });

    expect(boardContext().others.map((o) => o.actor)).toEqual([cached]);
  });
});
