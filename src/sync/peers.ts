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
/**
 * `at` is when the room was last confirmed, not when it last changed. A reader
 * needs to know the age of the answer: awareness events are throttled in a
 * hidden tab, so an unchanged list may be a quiet room or a minute-old cache,
 * and those are not the same thing to anyone deciding whether to act.
 */
export const usePeerStore = create<{ peers: Presence[]; at: number }>(() => ({
  peers: [],
  at: Date.now(),
}));

/**
 * A cheap identity of the peer list, so a heartbeat does not re-render the page.
 *
 * Membership is not enough on its own. An announcement — what a seat's agent is
 * about to do — changes without anybody arriving or leaving, and a signature
 * blind to it left the strip that draws those announcements permanently empty
 * while `get_board_context` reported them correctly: the agents could see each
 * other's intentions and the humans could not. Announcements change twice per
 * act rather than per heartbeat, so this stays cheap.
 */
const signature = (peers: Presence[]): string =>
  peers
    .map((p) => `${p.actor}:${p.name}:${p.doing ? `${p.doing.verb} ${p.doing.what}` : ''}`)
    .sort()
    .join('|');

/**
 * Who is in the room *now*, as opposed to when an event last fired.
 *
 * The store below is a cache, and it is written only when awareness reports a
 * change — which a hidden tab throttles to roughly once a minute. Anything that
 * makes a decision from that cache decides on stale membership: two agents that
 * arrived cold both saw a seat that had already left, and because the consent
 * quorum is drawn from the same list, that departed seat held a vote it could
 * never cast and every whole-board change they tried timed out waiting for it.
 *
 * So a reader that needs the truth asks for it, and the answer is computed from
 * awareness at the moment of asking. Injected rather than imported so this
 * module stays free of the wire, and so the cache remains the honest fallback
 * for a page with no connection at all.
 */
export interface RoomView {
  peers: Presence[];
  /** How long ago any peer was last heard from. `Infinity` when none has been. */
  heardAgoMs: number;
}

let roomSource: (() => RoomView) | null = null;

export const setRoomSource = (source: (() => RoomView) | null): void => {
  roomSource = source;
};

export const roomView = (): RoomView => {
  if (roomSource) return roomSource();
  const { peers, at } = usePeerStore.getState();
  return { peers, heardAgoMs: Date.now() - at };
};

/**
 * A stable order for a list that arrives in no order at all.
 *
 * The header names the first peer and counts the rest ("Ochre +2"), and this
 * list came in awareness iteration order — so whenever anybody joined or left,
 * the name in the chip could change to a different person for no reason the
 * viewer could see. Sorting by actor rather than by seat name because the name
 * is derived and can be renumbered; the id cannot.
 */
const inOrder = (peers: Presence[]): Presence[] =>
  [...peers].sort((a, b) => (a.actor < b.actor ? -1 : a.actor > b.actor ? 1 : 0));

export const setPeers = (incoming: Presence[]): void => {
  const peers = inOrder(incoming);
  const current = usePeerStore.getState().peers;
  // The timestamp advances even when the membership does not: hearing the same
  // room again is exactly the evidence that it is still there.
  if (signature(current) === signature(peers)) {
    usePeerStore.setState({ at: Date.now() });
    return;
  }
  usePeerStore.setState({ peers, at: Date.now() });
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
  /** Which of the pair this body is, so it can be drawn in its own colours. */
  kind: 'human' | 'agent';
  point: Cursor;
}

export const usePeerCursorStore = create<{ cursors: PeerCursor[] }>(() => ({ cursors: [] }));

const cursorSignature = (cursors: PeerCursor[]): string =>
  cursors
    .map((c) => `${c.actor}:${c.kind}:${Math.round(c.point.x)}:${Math.round(c.point.y)}`)
    .sort()
    .join('|');

/**
 * Every body a peer puts on the board: their hand, and the agent beside it.
 *
 * Filed under its own actor rather than the seat's, because the agent's cursor
 * has to be distinguishable from the person's wherever a cursor is keyed — and
 * because a peer whose agent is working while their own pointer is elsewhere is
 * the ordinary case here, not an edge one.
 *
 * An agent the peer has not named is not drawn at all. A cursor with no actor
 * behind it could not be attributed, and an unattributable hand on this board
 * is exactly the thing every other surface here exists to prevent.
 */
export const setPeerCursors = (peers: Presence[]): void => {
  const cursors: PeerCursor[] = [];
  for (const p of peers) {
    if (p.cursor !== null) {
      cursors.push({ actor: p.actor, name: p.name, kind: 'human', point: p.cursor });
    }
    if (p.agentCursor !== null && p.agent !== null) {
      cursors.push({
        actor: p.agent,
        name: `${p.name}\u2019s agent`,
        kind: 'agent',
        point: p.agentCursor,
      });
    }
  }
  if (cursorSignature(usePeerCursorStore.getState().cursors) === cursorSignature(cursors)) return;
  usePeerCursorStore.setState({ cursors });
};
