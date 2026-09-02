import { beforeEach, describe, expect, it } from 'vitest';
import { boardContext, pacing } from '../boardContext';
import { usePeerStore } from '../../sync/peers';
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
  usePeerStore.setState({ peers: [] });
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
