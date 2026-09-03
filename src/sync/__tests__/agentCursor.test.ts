import { describe, expect, it } from 'vitest';
import { readPresence } from '../presence';
import { setPeerCursors, usePeerCursorStore } from '../peers';
import type { Presence } from '../presence';

/**
 * A peer's agent, as a body on the board rather than as a rumour.
 *
 * Presence carried one cursor per seat — the human's — so the other seat's
 * agent was visible only through its effects: notes moving with nothing on
 * them, a line in the strip, a badge in the ledger. On a page whose entire
 * claim is that agents are participants, the second agent was the one
 * participant with no presence at all.
 *
 * Its cursor rides on presence rather than in the document, for the same
 * reason the grip does: where a hand is, is a fact about a tab, and it should
 * die with the tab that made it.
 */

const seat = (over: Partial<Presence> = {}): Presence => ({
  actor: 'h_them',
  name: 'Ochre',
  holding: [],
  agent: 'a_them',
  agentHolding: [],
  selected: [],
  cursor: null,
  agentCursor: null,
  doing: null,
  ...over,
});

describe('reading a peer state', () => {
  it('carries the agent cursor', () => {
    const p = readPresence({ actor: 'h_them', agentCursor: { x: 4, y: 9 } });
    expect(p?.agentCursor).toEqual({ x: 4, y: 9 });
  });

  it('refuses one that is not a point, rather than passing it on', () => {
    expect(readPresence({ actor: 'h_them', agentCursor: { x: 'over there' } })?.agentCursor).toBeNull();
    expect(readPresence({ actor: 'h_them', agentCursor: { x: 1, y: Infinity } })?.agentCursor).toBeNull();
  });

  it('is absent, not undefined, when the peer never sent one', () => {
    expect(readPresence({ actor: 'h_them' })?.agentCursor).toBeNull();
  });
});

describe('the cursors drawn for a peer', () => {
  it('draws their agent beside their hand, each under its own actor', () => {
    setPeerCursors([seat({ cursor: { x: 1, y: 2 }, agentCursor: { x: 30, y: 40 } })]);
    const { cursors } = usePeerCursorStore.getState();
    expect(cursors).toHaveLength(2);
    expect(cursors.find((c) => c.kind === 'human')).toMatchObject({ actor: 'h_them', name: 'Ochre' });
    expect(cursors.find((c) => c.kind === 'agent')).toMatchObject({ actor: 'a_them' });
  });

  it('names the agent by the seat it belongs to', () => {
    setPeerCursors([seat({ agentCursor: { x: 0, y: 0 } })]);
    expect(usePeerCursorStore.getState().cursors[0].name).toBe('Ochre’s agent');
  });

  it('draws nothing for an agent the peer has not named', () => {
    setPeerCursors([seat({ agent: null, agentCursor: { x: 5, y: 5 } })]);
    expect(usePeerCursorStore.getState().cursors).toEqual([]);
  });

  it('takes the agent down on its own, without taking the hand with it', () => {
    setPeerCursors([seat({ cursor: { x: 1, y: 2 }, agentCursor: { x: 3, y: 4 } })]);
    setPeerCursors([seat({ cursor: { x: 1, y: 2 }, agentCursor: null })]);
    const { cursors } = usePeerCursorStore.getState();
    expect(cursors).toHaveLength(1);
    expect(cursors[0].kind).toBe('human');
  });
});
