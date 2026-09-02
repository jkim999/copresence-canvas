import { beforeEach, describe, expect, it } from 'vitest';
import { setPeers, usePeerStore } from '../peers';
import type { Presence } from '../presence';

const peer = (over: Partial<Presence> = {}): Presence => ({
  actor: 'h_one',
  name: 'Ochre',
  holding: [],
  agent: 'a_one',
  agentHolding: [],
  selected: [],
  cursor: null,
  doing: null,
  ...over,
});

beforeEach(() => usePeerStore.setState({ peers: [], at: 0 }));

describe('the peer list the UI renders from', () => {
  it('republishes when somebody arrives', () => {
    setPeers([peer()]);
    expect(usePeerStore.getState().peers).toHaveLength(1);
  });

  /**
   * The bug this exists for: the signature covered membership only, so a seat
   * announcing an act changed nothing the UI could see. `get_board_context`
   * reported the announcement correctly the whole time, which meant the agents
   * could see each other's intentions and the humans could not.
   */
  it('republishes when a peer starts announcing an act, though the room is unchanged', () => {
    setPeers([peer()]);
    const before = usePeerStore.getState().peers;
    setPeers([peer({ doing: { verb: 'arranging', what: '8 notes', ids: [], at: 1 } })]);
    const after = usePeerStore.getState().peers;
    expect(after).not.toBe(before);
    expect(after[0].doing?.verb).toBe('arranging');
  });

  it('republishes when a peer stops announcing, so the strip comes back down', () => {
    setPeers([peer({ doing: { verb: 'arranging', what: '8 notes', ids: [], at: 1 } })]);
    setPeers([peer()]);
    expect(usePeerStore.getState().peers[0].doing).toBeNull();
  });

  it('still ignores a heartbeat that changed nothing, but records that it was heard', () => {
    setPeers([peer()]);
    const before = usePeerStore.getState();
    setPeers([peer()]);
    const after = usePeerStore.getState();
    expect(after.peers).toBe(before.peers);
    expect(after.at).toBeGreaterThanOrEqual(before.at);
  });
});
