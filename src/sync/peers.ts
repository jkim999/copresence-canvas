import { create } from 'zustand';
import type { Cursor, Presence } from './presence';
import type { ActorId } from '../state/types';

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

/**
 * Where everyone else's pointer is, kept in its own store rather than folded
 * into `peers`.
 *
 * A pointer moves tens of times a second and a peer list changes when somebody
 * opens or closes a tab. Sharing one store would re-render the header on every
 * mouse move, which is why the identity list above is gated on names alone.
 */
export interface PeerCursor {
  actor: ActorId;
  name: string;
  point: Cursor;
}

export const usePeerCursorStore = create<{ cursors: PeerCursor[] }>(() => ({ cursors: [] }));

const cursorSignature = (cursors: PeerCursor[]): string =>
  cursors.map((c) => `${c.actor}:${Math.round(c.point.x)}:${Math.round(c.point.y)}`).sort().join('|');

export const setPeerCursors = (peers: Presence[]): void => {
  const cursors = peers
    .filter((p): p is Presence & { cursor: Cursor } => p.cursor !== null)
    .map((p) => ({ actor: p.actor, name: p.name, point: p.cursor }));
  if (cursorSignature(usePeerCursorStore.getState().cursors) === cursorSignature(cursors)) return;
  usePeerCursorStore.setState({ cursors });
};
