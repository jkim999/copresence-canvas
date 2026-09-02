import { beforeEach, describe, expect, it } from 'vitest';
import {
  completeRemoteCall,
  recordRemoteCall,
  setCallTransport,
  useHostStore,
} from '../webmcp';

/**
 * The ledger is the evidence that a model decided something — real ids, chosen
 * by whoever is driving. It was per-browser, so the one thing this shape exists
 * to show, two agents working the same board, was the one thing nobody could
 * see. Calls travel now, attributed to the seat that made them.
 */

const store = () => useHostStore.getState();
const CEDAR = { actor: 'h_cedar', name: 'Cedar' };

beforeEach(() => {
  useHostStore.setState({ calls: [] });
  setCallTransport(null);
});

describe('a tool call made in another tab', () => {
  it('lands in this tab\'s ledger under their name', () => {
    recordRemoteCall({ id: 'c1', at: 1, tool: 'arrange_region', sig: 'nodeIds: 4', ...CEDAR });

    expect(store().calls).toHaveLength(1);
    expect(store().calls[0]).toMatchObject({ tool: 'arrange_region', by: CEDAR, sig: 'nodeIds: 4' });
  });

  it('is updated in place when it finishes', () => {
    recordRemoteCall({ id: 'c1', at: 1, tool: 'add_notes', sig: 'texts: 2', ...CEDAR });

    completeRemoteCall('c1', 'added 2 notes', undefined);

    expect(store().calls).toHaveLength(1);
    expect(store().calls[0].out).toBe('added 2 notes');
  });

  it('is ignored when it answers a call this tab never saw', () => {
    completeRemoteCall('never_seen', 'whatever', undefined);

    expect(store().calls).toEqual([]);
  });

  it('does not arrive twice if the peer says it twice', () => {
    recordRemoteCall({ id: 'c1', at: 1, tool: 'add_notes', sig: 'texts: 2', ...CEDAR });
    recordRemoteCall({ id: 'c1', at: 1, tool: 'add_notes', sig: 'texts: 2', ...CEDAR });

    expect(store().calls).toHaveLength(1);
  });
});

describe('a tool call made here', () => {
  it('goes out to the other tabs, start and finish', () => {
    const started: unknown[] = [];
    const finished: unknown[] = [];
    setCallTransport({
      started: (c) => started.push(c),
      finished: (c) => finished.push(c),
    });

    const id = store().recordCall('add_notes', { texts: ['a'] });
    store().completeCall(id, { added: 1 }, undefined);

    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ id, tool: 'add_notes' });
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({ id });
  });

  it('is not attributed to anybody, because it is yours', () => {
    const id = store().recordCall('get_scene', {});

    expect(store().calls.find((c) => c.id === id)?.by).toBeUndefined();
  });
});
