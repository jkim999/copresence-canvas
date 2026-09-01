import { create } from 'zustand';
import type { Presence } from './presence';

/**
 * Who else is on this board, for the parts of the UI that need to say so.
 *
 * Kept apart from the scene store on purpose: presence is not board state, it
 * does not undo, it does not travel in a share link, and it changes far more
 * often than the board does.
 */
export const usePeerStore = create<{ peers: Presence[] }>(() => ({ peers: [] }));

/** A cheap identity of the peer list, so a heartbeat does not re-render the page. */
const signature = (peers: Presence[]): string =>
  peers.map((p) => `${p.actor}:${p.name}`).sort().join('|');

export const setPeers = (peers: Presence[]): void => {
  const current = usePeerStore.getState().peers;
  if (signature(current) === signature(peers)) return;
  usePeerStore.setState({ peers });
};
