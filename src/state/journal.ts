import { create } from 'zustand';
import { me, myAgent } from './actors';
import { currentIntent } from '../agent/intent';
import { useSceneStore } from './sceneStore';
import type { ActorId, Scene } from './types';

/**
 * What has happened on this board, as one record both audiences read.
 *
 * Two agents put on one board independently reported the same missing thing:
 * there is no way to find out what changed while you were not looking. Both
 * fell back to polling `get_scene` and diffing whole snapshots by hand, and a
 * peer that silently replaced the region you were working in produced no signal
 * at all. The human had a symmetrical hole: the canvas shows a note in its new
 * place, but never that it moved, or who moved it.
 *
 * So the record is derived rather than reported. Every change — this tab's, its
 * agent's, and every peer's arriving over the wire — lands in the same store,
 * and the journal watches that store and diffs it. Nothing has to remember to
 * write an entry, which means nothing can forget to; and a peer's change is
 * recorded from what actually arrived, not from what they said they would do.
 *
 * The cost of deriving is that a removal has no author: the scene records who
 * last *edited* a note, and a note that is gone records nothing at all. That is
 * said out loud (`by: null`) rather than guessed at, because a wrong name on a
 * deletion is worse than no name.
 */

export type JournalVerb =
  | 'added'
  | 'moved'
  | 'retitled'
  | 'recoloured'
  | 'removed'
  | 'linked'
  | 'unlinked'
  | 'grouped'
  | 'annotated'
  | 'replaced';

/** One thing that happened, before the journal gives it a sequence number. */
export interface JournalFact {
  at: number;
  /** Who did it, or `null` where the board genuinely does not record an author. */
  by: ActorId | null;
  verb: JournalVerb;
  ids: string[];
  /** A sample of the material: a note's text, an edge's label, a region's name. */
  detail: string;
  /**
   * The announcement this write belongs to, when it belongs to one.
   *
   * An agent act is not instantaneous: it animates, and it shoves bystanders
   * aside as it goes, so its writes arrive over seconds. Timing alone therefore
   * split one decision into several rows — a person reading the history saw six
   * acts where there had been one. The act is the unit, not the clock.
   */
  act?: number;
}

export interface JournalEvent extends JournalFact {
  /**
   * Monotonic across the life of the tab, and never reused. A reader holds one
   * of these as a bookmark; it has to keep counting past the entries that have
   * already been trimmed, or a reader who was away too long would be told
   * "nothing changed" when the truth is "more than I can still tell you".
   */
  seq: number;
}

/** Below this, a note has not moved so much as settled. */
const MOVED_PX = 1;

/**
 * How long a run of the same act by the same hand stays one act.
 *
 * A drag is sixty writes a second and an agent's animation is much the same, so
 * without this the journal would be a flood of frames instead of a record of
 * decisions. Folded events keep the union of what they touched.
 */
export const COALESCE_MS = 1_500;

/** Deep enough to cover a session's work, shallow enough to render. */
export const JOURNAL_LIMIT = 120;

interface JournalState {
  events: JournalEvent[];
  /** How many events have ever happened, trimmed ones included. */
  seq: number;
}

export const useJournalStore = create<JournalState>(() => ({ events: [], seq: 0 }));

export const resetJournal = (): void => useJournalStore.setState({ events: [], seq: 0 });

/** The bookmark a reader holds so it can ask what has happened since. */
export const journalCursor = (): number => useJournalStore.getState().seq;

const foldable = (last: JournalEvent, fact: JournalFact): boolean => {
  if (last.by !== fact.by || last.verb !== fact.verb) return false;
  // Two acts are never one line, however fast they follow each other; and one
  // act is always one line, however long it takes to finish.
  if (last.act !== undefined || fact.act !== undefined) return last.act === fact.act;
  // A human drag belongs to no act, so it still folds on the clock.
  return fact.at - last.at <= COALESCE_MS;
};

export const recordFacts = (facts: JournalFact[]): void => {
  if (facts.length === 0) return;
  useJournalStore.setState((s) => {
    let events = s.events;
    let seq = s.seq;
    for (const fact of facts) {
      const last = events[events.length - 1];
      if (last && foldable(last, fact)) {
        const ids = [...last.ids];
        for (const id of fact.ids) if (!ids.includes(id)) ids.push(id);
        events = [...events.slice(0, -1), { ...last, at: fact.at, ids }];
        continue;
      }
      seq += 1;
      events = [...events, { ...fact, seq }];
    }
    return { events: events.slice(-JOURNAL_LIMIT), seq };
  });
};

/** Everything the journal still holds that happened after `cursor`. */
export const eventsSince = (cursor: number): JournalEvent[] =>
  useJournalStore.getState().events.filter((e) => e.seq > cursor);

// --- deriving the facts ----------------------------------------------------

interface Entry {
  by: ActorId | null;
  id: string;
  detail: string;
}

/**
 * Facts are grouped by actor, never merged across them. Two hands working at
 * once is the whole premise of this board, and "5 notes moved" over a diff that
 * two people caused is a sentence that hides exactly the thing worth seeing.
 */
const collect = (at: number, verb: JournalVerb, entries: Entry[]): JournalFact[] => {
  const byActor = new Map<string, { by: ActorId | null; ids: string[]; detail: string }>();
  for (const entry of entries) {
    const key = entry.by ?? ' none';
    const bucket = byActor.get(key);
    if (bucket) bucket.ids.push(entry.id);
    else byActor.set(key, { by: entry.by, ids: [entry.id], detail: entry.detail });
  }
  return [...byActor.values()].map(({ by, ids, detail }) => ({ at, by, verb, ids, detail }));
};

const index = <T extends { id: string }>(items: T[]): Map<string, T> =>
  new Map(items.map((i) => [i.id, i]));

/**
 * What changed between two readings of the board.
 *
 * Pure, and deliberately blind to who is asking: the same function serves the
 * human's history panel and the agent's `what_changed`, so the two can never
 * disagree about what happened.
 */
export const diffScene = (prev: Scene, next: Scene, at: number): JournalFact[] => {
  const facts: JournalFact[] = [];

  const wasNode = index(prev.nodes);
  const isNode = index(next.nodes);

  const added: Entry[] = [];
  const moved: Entry[] = [];
  const retitled: Entry[] = [];
  const recoloured: Entry[] = [];
  const removed: Entry[] = [];

  for (const n of next.nodes) {
    const before = wasNode.get(n.id);
    if (!before) {
      added.push({ by: n.lastEditedBy, id: n.id, detail: n.text });
      continue;
    }
    if (before.text !== n.text) retitled.push({ by: n.lastEditedBy, id: n.id, detail: n.text });
    if (Math.abs(before.x - n.x) > MOVED_PX || Math.abs(before.y - n.y) > MOVED_PX) {
      moved.push({ by: n.lastEditedBy, id: n.id, detail: n.text });
    }
    if (before.color !== n.color) {
      recoloured.push({ by: n.lastEditedBy, id: n.id, detail: n.text });
    }
  }
  for (const n of prev.nodes) {
    // Nothing on the board records who took a note away, so nobody is named.
    if (!isNode.has(n.id)) removed.push({ by: null, id: n.id, detail: n.text });
  }

  facts.push(
    ...collect(at, 'added', added),
    ...collect(at, 'moved', moved),
    ...collect(at, 'retitled', retitled),
    ...collect(at, 'recoloured', recoloured),
    ...collect(at, 'removed', removed),
  );

  const wasEdge = index(prev.edges);
  const isEdge = index(next.edges);
  facts.push(
    ...collect(
      at,
      'linked',
      next.edges
        .filter((e) => !wasEdge.has(e.id))
        .map((e) => ({ by: e.lastEditedBy, id: e.id, detail: e.label })),
    ),
    ...collect(
      at,
      'unlinked',
      prev.edges
        .filter((e) => !isEdge.has(e.id))
        .map((e) => ({ by: null, id: e.id, detail: e.label })),
    ),
  );

  const wasAnnotation = index(prev.annotations);
  facts.push(
    ...collect(
      at,
      'annotated',
      next.annotations
        .filter((a) => !wasAnnotation.has(a.id))
        .map((a) => ({ by: a.lastEditedBy, id: a.id, detail: a.text })),
    ),
  );

  // A region that gained or lost members is as much a change as a new one:
  // being moved out of the group you were in is exactly the kind of thing a
  // peer does to your work while you are not looking.
  const wasRegion = index(prev.regions);
  facts.push(
    ...collect(
      at,
      'grouped',
      next.regions
        .filter((r) => {
          const before = wasRegion.get(r.id);
          if (!before) return true;
          return (
            before.label !== r.label ||
            before.nodeIds.length !== r.nodeIds.length ||
            before.nodeIds.some((id, i) => id !== r.nodeIds[i])
          );
        })
        .map((r) => ({ by: r.lastEditedBy, id: r.id, detail: r.label })),
    ),
  );

  return facts;
};

// --- rendering -------------------------------------------------------------

const OPEN = '“';
const CLOSE = '”';

/**
 * Note text is often already a quotation — these boards are full of interview
 * transcript — and wrapping it again produced ““I gave up.””. One pair of marks
 * is the sentence; a second pair is a rendering bug on display.
 */
const unquoted = (detail: string): string => {
  const head = detail[0];
  const tail = detail[detail.length - 1];
  const paired =
    detail.length > 1 &&
    ((head === '"' && tail === '"') || (head === OPEN && tail === CLOSE));
  return paired ? detail.slice(1, -1) : detail;
};

/**
 * Quotation inside quotation gets the inner marks, the way print has always
 * done it. Without this the outer pair landed straight on top of the inner one
 * and the sentence read as broken punctuation rather than as nested speech.
 */
const nested = (text: string): string => text.replace(/"([^"]*)"/g, '\u2018$1\u2019');

/**
 * Shared with anything else that has to set a fragment of board text inside a
 * sentence — the rewind dialog names the act it is about to undo, and got the
 * doubled marks wrong in exactly the same way this was written to fix.
 */
export const quote = (detail: string, max = 44): string => {
  const text = nested(unquoted(detail));
  return `${OPEN}${text.length > max ? `${text.slice(0, max - 1)}…` : text}${CLOSE}`;
};

const NOUN: Record<JournalVerb, [string, string]> = {
  added: ['note', 'notes'],
  moved: ['note', 'notes'],
  retitled: ['note', 'notes'],
  recoloured: ['note', 'notes'],
  removed: ['note', 'notes'],
  linked: ['connection', 'connections'],
  unlinked: ['connection', 'connections'],
  grouped: ['group', 'groups'],
  annotated: ['comment', 'comments'],
  replaced: ['board', 'boards'],
};

/** Active, then the passive in both numbers: "3 notes was removed" is not English. */
const VERB: Record<JournalVerb, [string, string, string]> = {
  added: ['added', 'was added', 'were added'],
  moved: ['moved', 'moved', 'moved'],
  retitled: ['rewrote', 'was rewritten', 'were rewritten'],
  recoloured: ['recoloured', 'was recoloured', 'were recoloured'],
  removed: ['removed', 'was removed', 'were removed'],
  linked: ['drew', 'was drawn', 'were drawn'],
  unlinked: ['removed', 'was removed', 'were removed'],
  grouped: ['formed', 'was formed', 'were formed'],
  annotated: ['left', 'was left', 'were left'],
  replaced: ['replaced', 'was replaced', 'were replaced'],
};

/**
 * One event as a sentence.
 *
 * The seat name is passed in rather than looked up, because who counts as
 * "you" differs between the panel and a tool result, and because a seat name is
 * only meaningful against the room as it stands right now.
 */
/**
 * What a rewind to a given act would take with it.
 *
 * Undo restores a whole-scene snapshot, so rewinding to an act discards
 * everything recorded after it as well — and a colleague's work, which arrived
 * over the wire and was never snapshotted here, goes with it silently. The
 * journal is the only record that knows those changes happened at all, so it is
 * the thing that has to be asked before a control offers the rewind.
 *
 * Pure and given the two local actors rather than reading them, so the rule
 * "your own later work is yours to discard, a colleague's is not" can be tested
 * without a room.
 */
export interface RevertScope {
  /** Changes recorded after that act, all of which a rewind would discard. */
  laterChanges: number;
  /** Seats other than your own with work among them, in the order they appear. */
  othersAffected: ActorId[];
}

export const revertScope = (
  events: readonly JournalEvent[],
  act: number,
  human: ActorId,
  agent: ActorId,
): RevertScope => {
  let last = -1;
  for (let i = 0; i < events.length; i += 1) if (events[i].act === act) last = i;
  // An act with nothing of its own left in the record has already been trimmed
  // past; treating that as "nothing follows" is the safe reading, because the
  // caller only offers a rewind for an act it can still see.
  const later = last < 0 ? [] : events.slice(last + 1);

  const others: ActorId[] = [];
  for (const e of later) {
    // A removal is recorded with no author: the scene remembers who last edited
    // a note, never who deleted one. It cannot be attributed to a colleague.
    if (e.by === null || e.by === human || e.by === agent) continue;
    if (!others.includes(e.by)) others.push(e.by);
  }
  return { laterChanges: later.length, othersAffected: others };
};

export const describeEvent = (event: JournalEvent, name: string | null): string => {
  const n = event.ids.length;
  const [one, many] = NOUN[event.verb];
  const [active, passiveOne, passiveMany] = VERB[event.verb];
  const passive = n === 1 ? passiveOne : passiveMany;
  const subject = n === 1 ? `a ${one}` : `${n} ${many}`;
  const tail = event.detail ? ` — ${quote(event.detail)}` : '';

  if (event.verb === 'replaced') {
    return name === null ? `The board was replaced${tail}` : `${name} replaced the board${tail}`;
  }
  // No name means the board does not know, and a sentence with no subject is
  // the honest shape for that.
  if (name === null) {
    const head = subject.charAt(0).toUpperCase() + subject.slice(1);
    return `${head} ${passive}${tail}`;
  }
  return `${name} ${active} ${subject}${tail}`;
};

// --- watching --------------------------------------------------------------

/**
 * Keep the journal fed from the one place every change already passes through.
 *
 * The store is the confluence: a drag, an agent's animation frame and a peer's
 * edit arriving off the wire all end up here, so watching it is the only way to
 * record all three without three separate reporting paths that can drift apart.
 *
 * A replaced board is not diffed. Reset, import and a followed share link swap
 * every id at once, and the honest diff — every note removed, every note added
 * — is both enormous and a worse account of what happened than the one sentence
 * it deserves.
 */
/**
 * The announcement this tab's agent is running, used to tie every write it
 * causes to one act. A peer's writes arrive already folded by their own tab.
 */
const runningAct = (): number | undefined => currentIntent()?.at;

const stamped = (facts: JournalFact[]): JournalFact[] => {
  const act = runningAct();
  if (act === undefined) return facts;
  return facts.map((f) => (f.by === myAgent() ? { ...f, act } : f));
};

export const watchScene = (): (() => void) =>
  useSceneStore.subscribe((state, prev) => {
    if (state.epoch !== prev.epoch) {
      // Only this tab bumps the epoch; a peer's replacement arrives as an
      // ordinary document update, so naming ourselves here is not a guess.
      recordFacts([
        { at: Date.now(), by: me(), verb: 'replaced', ids: [], detail: '' },
      ]);
      return;
    }
    // A rewind is a restoration, not a set of edits by the people whose names
    // happen to be on the restored notes. It records itself as a notice.
    if (state.rewound !== prev.rewound) return;
    if (state.scene === prev.scene) return;
    recordFacts(stamped(diffScene(prev.scene, state.scene, Date.now())));
  });
