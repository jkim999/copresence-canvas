import { create } from 'zustand';
import { useIntentStore } from './intent';
import { usePeerStore } from '../sync/peers';
import type { Presence } from '../sync/presence';
import type { ActorId, Intent } from '../state/types';

/** Whose announcement has claimed a note: yours, or another seat's. */
export type PendingKind = 'own' | 'peer';

/**
 * Every announcement on screen right now, from one list.
 *
 * The strip and the rings on the notes started life as two derivations of the
 * same fact, and two live tabs showed what that costs: the strip said "1 ringed"
 * while not one note carried a ring. A claim about the board and the marks on
 * the board must come from the same place, or they will eventually contradict
 * each other in front of the person trying to trust them.
 *
 * They are also held briefly after the act ends. Most acts finish in well under
 * a second, and on a board of any size the canvas cannot repaint that fast — so
 * the warning that something is about to happen was reliably over before it
 * could be seen. An announcement nobody can see is not an announcement, and one
 * held a beat too long costs nothing: the act it describes has just happened.
 */

export interface Announcement {
  /** One per seat: this tab's pair is 'mine', a peer's is its actor id. */
  key: string;
  own: boolean;
  /** Whose seat, for naming. Null for this tab, which is named "Your agent". */
  actor: ActorId | null;
  verb: string;
  what: string;
  ids: readonly string[];
  /** When it first appeared, so it can be kept on screen long enough to read. */
  since: number;
}

/** Long enough for a busy canvas to paint it at least once. */
export const MIN_VISIBLE_MS = 1_200;

export const liveAnnouncements = (
  mine: Intent | null,
  peers: readonly Presence[],
): Announcement[] => {
  const out: Announcement[] = [];
  if (mine) {
    out.push({ key: 'mine', own: true, actor: null, verb: mine.verb, what: mine.what, ids: mine.ids, since: 0 });
  }
  for (const peer of peers) {
    if (!peer.doing) continue;
    out.push({
      key: peer.actor,
      own: false,
      actor: peer.actor,
      verb: peer.doing.verb,
      what: peer.doing.what,
      ids: peer.doing.ids,
      since: 0,
    });
  }
  return out;
};

/** The notes these announcements name. Yours wins a tie: it is the one you can stop. */
export const pendingFrom = (announcements: readonly Announcement[]): Map<string, PendingKind> => {
  const marks = new Map<string, PendingKind>();
  for (const a of announcements) {
    if (a.own) continue;
    for (const id of a.ids) marks.set(id, 'peer');
  }
  // Second, so it overwrites a peer's claim on the same note.
  for (const a of announcements) {
    if (!a.own) continue;
    for (const id of a.ids) marks.set(id, 'own');
  }
  return marks;
};

const same = (a: Announcement, b: Announcement): boolean =>
  a.key === b.key && a.verb === b.verb && a.what === b.what;

/**
 * Merge what is live into what is already on screen, keeping each entry for at
 * least {@link MIN_VISIBLE_MS} from when it first appeared.
 *
 * Pure, and given the clock rather than reading it, so the holding rule can be
 * tested without waiting through it.
 */
export const hold = (
  held: readonly Announcement[],
  live: readonly Announcement[],
  now: number,
): Announcement[] => {
  const out: Announcement[] = live.map((a) => {
    const previous = held.find((h) => same(h, a));
    // A seat that announced something new starts a new clock; the old entry is
    // gone rather than lingering, because it is no longer true.
    return { ...a, since: previous ? previous.since : now };
  });

  for (const h of held) {
    if (live.some((a) => a.key === h.key)) continue;
    if (now - h.since < MIN_VISIBLE_MS) out.push(h);
  }
  return out;
};

// --- the one list on screen -------------------------------------------------

/**
 * Deliberately a single store rather than a hook each component runs for
 * itself. Two components holding their own copy is exactly how the strip and
 * the canvas came to disagree in the first place; one list cannot.
 */
interface HeldState {
  held: Announcement[];
}

export const useHeldStore = create<HeldState>(() => ({ held: [] }));

export const resetAnnouncements = (): void => useHeldStore.setState({ held: [] });

/** The notes currently under an announcement, for the canvas to ring. */
export const heldPending = (): Map<string, PendingKind> =>
  pendingFrom(useHeldStore.getState().held);

/**
 * Keep the held list in step with the room, and take entries down when their
 * moment is up. Started once, beside the journal's watcher.
 */
export const watchAnnouncements = (): (() => void) => {
  let timer = 0;

  const settle = (): void => {
    const live = liveAnnouncements(
      useIntentStore.getState().mine,
      usePeerStore.getState().peers,
    );
    const next = hold(useHeldStore.getState().held, live, Date.now());
    const current = useHeldStore.getState().held;
    const unchanged =
      next.length === current.length && next.every((a, i) => same(a, current[i]));
    if (!unchanged) useHeldStore.setState({ held: next });

    if (timer !== 0) {
      clearTimeout(timer);
      timer = 0;
    }
    // Only an entry whose act has ended needs waking for; a running one will
    // wake us itself when it finishes.
    const ending = next.filter((a) => !live.some((l) => l.key === a.key));
    if (ending.length === 0) return;
    const soonest = Math.min(...ending.map((a) => a.since + MIN_VISIBLE_MS - Date.now()));
    timer = setTimeout(settle, Math.max(soonest, 16)) as unknown as number;
  };

  const stopIntent = useIntentStore.subscribe(settle);
  const stopPeers = usePeerStore.subscribe(settle);
  settle();

  return () => {
    stopIntent();
    stopPeers();
    if (timer !== 0) clearTimeout(timer);
  };
};
