import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_AGENT, LOCAL_HUMAN, agentId, humanId, isAgent, kindOf, me, myAgent, nameOf, seatName, takeSeat, useActorStore } from '../actors';

const reset = () => useActorStore.getState().reset();

describe('kindOf', () => {
  it('reads the two actors this page has always had', () => {
    expect(kindOf(LOCAL_HUMAN)).toBe('human');
    expect(kindOf(LOCAL_AGENT)).toBe('agent');
  });

  it('reads a participant id without consulting the registry', () => {
    expect(kindOf(agentId())).toBe('agent');
    expect(kindOf(humanId())).toBe('human');
  });

  it('treats an id it has never seen as a human rather than an agent', () => {
    // Provenance that wrongly claims agent authorship is the worse failure:
    // it would put a teal ring and an "agent" stamp on someone's own note.
    expect(kindOf('who_is_this')).toBe('human');
    expect(isAgent('who_is_this')).toBe(false);
  });

  it('mints ids that do not collide', () => {
    const ids = new Set(Array.from({ length: 200 }, () => agentId()));
    expect(ids.size).toBe(200);
  });
});

describe('the registry', () => {
  beforeEach(reset);

  it('starts holding exactly the local pair, and attributes local edits to them', () => {
    expect(Object.keys(useActorStore.getState().actors).sort()).toEqual([LOCAL_AGENT, LOCAL_HUMAN]);
    expect(me()).toBe(LOCAL_HUMAN);
    expect(myAgent()).toBe(LOCAL_AGENT);
  });

  it('names the local pair for a board with one of each', () => {
    expect(useActorStore.getState().nameOf(LOCAL_HUMAN)).toBe('You');
    expect(useActorStore.getState().nameOf(LOCAL_AGENT)).toBe('Agent');
  });

  it('registers a participant and returns them by id', () => {
    const bo = { id: agentId(), kind: 'agent' as const, name: 'Bo', color: 'var(--agent-2)' };
    useActorStore.getState().register(bo);

    expect(useActorStore.getState().actors[bo.id]).toEqual(bo);
    expect(useActorStore.getState().nameOf(bo.id)).toBe('Bo');
  });

  it('describes an actor it has never seen without inventing a name', () => {
    // A shared board can carry work by someone who was never in this session.
    const name = useActorStore.getState().nameOf('a_longgone');

    expect(name).toBe('an agent');
    expect(useActorStore.getState().nameOf('h_longgone')).toBe('someone');
  });

  it('does not let a re-register erase a participant already known', () => {
    const id = humanId();
    useActorStore.getState().register({ id, kind: 'human', name: 'Alex', color: 'var(--human)' });
    useActorStore.getState().register({ id, kind: 'human', name: 'Alex', color: 'var(--human-2)' });

    expect(Object.keys(useActorStore.getState().actors)).toHaveLength(3);
    expect(useActorStore.getState().actors[id].color).toBe('var(--human-2)');
  });

  it('gives the two load-bearing colours to the local pair', () => {
    expect(useActorStore.getState().actors[LOCAL_HUMAN].color).toBe('var(--human)');
    expect(useActorStore.getState().actors[LOCAL_AGENT].color).toBe('var(--agent)');
  });

  it('joins a participant without being handed a colour', () => {
    const id = humanId();
    useActorStore.getState().join({ id, kind: 'human', name: 'Alex' });

    expect(useActorStore.getState().actors[id].color).toBeTruthy();
    expect(useActorStore.getState().nameOf(id)).toBe('Alex');
  });

  it('lets this browser say which participant its own edits belong to', () => {
    const id = humanId();
    useActorStore.getState().join({ id, kind: 'human', name: 'Alex' });
    useActorStore.getState().setMe(id);

    expect(me()).toBe(id);
    // A second person must not file their agent's work under the first's agent,
    // so taking an identity mints a paired agent rather than sharing the default.
    expect(kindOf(myAgent())).toBe('agent');
    expect(myAgent()).not.toBe(LOCAL_AGENT);
    expect(useActorStore.getState().actors[myAgent()]).toBeDefined();
  });
});

describe('taking a seat', () => {
  it('gives this browser an identity of its own', () => {
    const first = takeSeat();
    const second = takeSeat();

    // Two tabs both answering to `human` is not cosmetic: the grip only refuses
    // a note held by someone *else*, so a shared id means neither tab is ever
    // refused and both can pull the same note at once.
    expect(first).not.toBe(LOCAL_HUMAN);
    expect(second).not.toBe(first);
    expect(kindOf(first)).toBe('human');
  });

  it('brings a paired agent along, not a shared one', () => {
    takeSeat();
    const mine = myAgent();
    takeSeat();

    expect(myAgent()).not.toBe(mine);
    expect(kindOf(myAgent())).toBe('agent');
  });

  it('is called something other people can read', () => {
    const id = takeSeat();

    // You are always "You" to yourself, so the name that travels is derived
    // from the id instead — no coordination, same answer on every screen.
    expect(nameOf(id)).toBe('You');
    expect(seatName(id)).toMatch(/^[A-Z][a-z]+$/);
    expect(seatName(id)).toBe(seatName(id));
  });
});

describe('minting an id', () => {
  it('does not repeat itself within one tab', () => {
    expect(new Set(Array.from({ length: 500 }, () => humanId())).size).toBe(500);
  });

  it('does not collide with a second tab that started in the same millisecond', async () => {
    // The one that matters, and the one a single-process loop cannot reach: a
    // clock and a counter are both per-*tab*, so two tabs opened together mint
    // byte-identical ids — and then neither can refuse the other a note,
    // because the grip only blocks a hand that is not yours. A fresh module
    // registry is a fresh tab.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    try {
      vi.resetModules();
      const tabA = await import('../actors');
      vi.resetModules();
      const tabB = await import('../actors');

      expect(tabA.humanId()).not.toBe(tabB.humanId());
    } finally {
      vi.useRealTimers();
      vi.resetModules();
    }
  });
});
