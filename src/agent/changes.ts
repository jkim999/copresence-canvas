import {
  describeEvent,
  eventsSince,
  journalCursor,
  useJournalStore,
} from '../state/journal';
import { crediting, nameFor, type Credit } from './credit';
import type { ActorId } from '../state/types';

/**
 * What happened while you were not looking.
 *
 * The gap this closes was named independently by two agents dropped onto one
 * board: `get_scene` says what is true *now* and nothing says what changed, so
 * both fell back to keeping whole snapshots and diffing them by hand, and a
 * peer quietly restructuring the region one of them was working in produced no
 * signal at all. An agent cannot cooperate with something it cannot observe.
 *
 * The cursor is the whole design. A reader holds an opaque number, hands it
 * back, and gets exactly what happened in between — no timestamps to reason
 * about, no clock to keep, and no dependence on how long the tab was throttled.
 * Arriving without one starts you at the present rather than at the beginning
 * of the session, because a first call is orientation, not archaeology.
 */

export interface Change {
  seq: number;
  at: number;
  secondsAgo: number;
  /** Who did it, or `null` where the board genuinely does not record an author. */
  by: Credit | null;
  /** The change as a sentence, already naming the seat. */
  what: string;
  /** The notes, edges or groups it touched, so you can go and look at them. */
  ids: string[];
}

export interface ChangeReport {
  /** Hand this back as `since` on your next call. */
  cursor: number;
  changes: Change[];
  /**
   * False when the journal had already discarded some of what happened after
   * the cursor you gave. The changes listed are still true; they are not all.
   */
  complete: boolean;
  note: string;
}

const seatOf = (by: ActorId | null, credit: (id: ActorId) => Credit): Credit | null =>
  by === null ? null : credit(by);

export const changesSince = (since?: number): ChangeReport => {
  const cursor = journalCursor();

  // No cursor means a first look, and a first look is not owed the session's
  // whole history — it is owed a starting point. A number that cannot be one
  // of ours is treated the same way rather than silently coerced.
  if (typeof since !== 'number' || !Number.isFinite(since) || since < 0 || since > cursor) {
    return {
      cursor,
      changes: [],
      complete: true,
      note:
        'No usable bookmark, so this is your starting point rather than a history. Keep ' +
        '`cursor` and pass it back as `since` to find out what changed after this moment. ' +
        'Call get_scene to see what is on the board now.',
    };
  }

  const events = eventsSince(since);
  const { events: held } = useJournalStore.getState();
  // The oldest entry still held tells us whether anything between the reader's
  // bookmark and that entry has already been trimmed away.
  const oldest = held.length > 0 ? held[0].seq : cursor + 1;
  const complete = since >= oldest - 1;

  const credit = crediting(
    events.filter((e): e is typeof e & { by: ActorId } => e.by !== null).map((e) => e.by),
  );
  const now = Date.now();

  const changes = events.map(
    (e): Change => ({
      seq: e.seq,
      at: e.at,
      secondsAgo: Math.max(0, Math.round((now - e.at) / 1000)),
      by: seatOf(e.by, credit),
      what: describeEvent(e, e.by === null ? null : nameFor(credit(e.by))),
      ids: e.ids,
    }),
  );

  const note = !complete
    ? 'More happened than this board still remembers — some of it has been discarded. ' +
      'Treat this as a partial account and call get_scene to re-read the board rather ' +
      'than reasoning from the list below alone.'
    : changes.length === 0
      ? 'Nothing has changed since you last looked. The board is as you left it.'
      : `${changes.length} thing${changes.length === 1 ? '' : 's'} happened since you last ` +
        'looked. Anything with `mine: false` was somebody else — check it before you undo ' +
        'or rearrange it, because it is their work, not stale copies of yours.';

  return { cursor, changes, complete, note };
};
