import { eventsSince, journalCursor, useJournalStore, type JournalEvent, type JournalVerb } from '../state/journal';
import { myAgent } from '../state/actors';
import { useSceneStore } from '../state/sceneStore';
import { crediting, nameFor } from './credit';
import type { ActorId } from '../state/types';

/**
 * Whether the board an agent planned against still exists.
 *
 * The grip covers a collision measured in milliseconds: a hand closes on a note
 * while the agent is carrying it. This covers the much larger and much duller
 * window either side of that — the seconds between a model reading the board
 * and writing to it. Nothing about a language model is fast, and on a board
 * with other people on it those seconds are long enough for the premise of the
 * whole plan to stop being true. The agent then writes anyway, over work it
 * never saw, and neither side is told.
 *
 * There is nowhere else this check could live. The read happened in this tab,
 * against a scene held in memory and mutated by peers arriving over the wire;
 * no server holds that version, because there is no server. A database gives a
 * backend tool compare-and-swap for free. A page has to keep the bookmark
 * itself, which is exactly what the journal's sequence numbers already are.
 *
 * The rule is deliberately narrow. Only the notes a write actually *names* are
 * contested, so two agents working opposite corners of one board never block
 * each other — a gate that fired on any change at all would make a busy board
 * unusable, and an agent that is refused constantly learns to stop citing its
 * premise, which is worse than not having asked.
 *
 * It fails closed. If the record no longer reaches back to the cursor, the
 * honest answer is not "nothing happened" but "I cannot tell you", and a write
 * whose safety cannot be shown is refused. An unprovable premise is a refused
 * write.
 */

export interface Conflict {
  seq: number;
  /** Who did it, or `null` where the board genuinely does not record an author. */
  by: ActorId | null;
  verb: JournalVerb;
  /** Only the named notes this touched, never the rest of the event. */
  ids: string[];
  detail: string;
}

/** `changed` — somebody moved the ground. `forgotten` — nobody can say. */
export type StaleReason = 'changed' | 'forgotten';

export interface Verdict {
  stale: boolean;
  reason: StaleReason | null;
  conflicts: Conflict[];
}

const FRESH: Verdict = { stale: false, reason: null, conflicts: [] };

/**
 * Pure, so the rule can be tested without a store and without a room.
 *
 * `actor` is the caller, and its own writes are never held against it: an agent
 * that moved a note a moment ago has not been overtaken by itself. Everything
 * else counts, including the authorless events — a removal records no author,
 * and a note deleted out from under a plan is the single most destructive case
 * this exists to catch, so it must not be the one that slips through.
 */
export const verdictFrom = (
  events: readonly JournalEvent[],
  ids: readonly string[],
  actor: ActorId,
  { complete, membersOf }: { complete: boolean; membersOf?: (id: string) => readonly string[] },
): Verdict => {
  // A write that names nothing existing cannot clobber anything: adding notes
  // is not a claim about the board it is landing on.
  if (ids.length === 0) return FRESH;

  const named = new Set(ids);
  // An event is filed against the thing that changed, and for a group that is
  // the region, not the notes in it. But a peer drawing a group around four
  // notes has made a claim about those four notes, and a plan that scatters
  // them tears their group up — so a region is read through to its members
  // before anything is compared. The first two-seat run of this gate let
  // exactly that through: nothing on the board is named `r_…`, so nothing
  // matched.
  const reach = (id: string): string[] =>
    named.has(id) ? [id] : (membersOf?.(id) ?? []).filter((member) => named.has(member));

  const conflicts = events
    .filter((e) => e.by !== actor)
    .map((e) => ({ e, hit: [...new Set(e.ids.flatMap(reach))] }))
    .filter(({ hit }) => hit.length > 0)
    .map(
      // `ids` are the contested notes, never the region they arrived under: a
      // refusal that named `r_theirs` would tell a model nothing it could act on.
      ({ e, hit }): Conflict => ({ seq: e.seq, by: e.by, verb: e.verb, ids: hit, detail: e.detail }),
    );

  if (conflicts.length > 0) return { stale: true, reason: 'changed', conflicts };
  if (!complete) return { stale: true, reason: 'forgotten', conflicts: [] };
  return FRESH;
};

/**
 * The same rule against the live journal.
 *
 * A write that cites no cursor is not gated. That is a real choice and not an
 * oversight: the premise is the agent's to offer, and refusing every ungated
 * write would break every host that has not learned to pass one — including the
 * built-in console. Citing a bookmark buys protection; it is not a toll.
 */
export const stalenessOf = (since: number | undefined, ids: readonly string[]): Verdict => {
  const cursor = journalCursor();
  if (typeof since !== 'number' || !Number.isFinite(since) || since < 0 || since > cursor) {
    return FRESH;
  }

  const { events: held } = useJournalStore.getState();
  const oldest = held.length > 0 ? held[0].seq : cursor + 1;
  // Membership is read from the board as it stands rather than as it was: the
  // notes a peer has just gathered are the ones a plan would now be tearing up.
  const membersOf = (id: string): readonly string[] =>
    useSceneStore.getState().scene.regions.find((r) => r.id === id)?.nodeIds ?? [];
  return verdictFrom(eventsSince(since), ids, myAgent(), {
    complete: since >= oldest - 1,
    membersOf,
  });
};

const VERBS: Partial<Record<JournalVerb, string>> = {
  moved: 'moved',
  retitled: 'rewrote',
  recoloured: 'recoloured',
  removed: 'deleted',
  replaced: 'replaced',
  grouped: 'grouped',
};

/**
 * What the refusal says to the model.
 *
 * Written the way the yield is written, and for the same reason: a bare
 * `stale: true` is a result an agent reads as a transient failure and answers
 * by retrying the identical call. It has to be told what moved, whose it is,
 * and that the fix is to look again rather than to push harder.
 */
export const noteFor = (verdict: Verdict): string => {
  if (!verdict.stale) return '';

  if (verdict.reason === 'forgotten') {
    return (
      'Refused: too much has happened for this board to say whether the notes you named ' +
      'are as you last saw them. Nothing was changed. Call get_scene to read the board as ' +
      'it is now and decide again — do not repeat this call with the same bookmark.'
    );
  }

  const credit = crediting(
    verdict.conflicts
      .filter((c): c is Conflict & { by: ActorId } => c.by !== null)
      .map((c) => c.by),
  );
  const who = [
    ...new Set(
      verdict.conflicts.map((c) => (c.by === null ? 'somebody' : nameFor(credit(c.by)))),
    ),
  ];
  const touched = [...new Set(verdict.conflicts.flatMap((c) => c.ids))];
  const what = [...new Set(verdict.conflicts.map((c) => VERBS[c.verb] ?? 'changed'))].join(' and ');

  return (
    `Refused: you planned this against a board that has since changed. ${who.join(' and ')} ` +
    `${what} ${touched.length} of the notes you named (${touched.join(', ')}) after you read ` +
    'it. Nothing was changed, so their work is intact. Call what_changed with your bookmark ' +
    'to see what they did, then decide again — that is their work, not a stale copy of ' +
    'yours, so do not simply repeat this call.'
  );
};
