import { create } from 'zustand';
import { me } from './actors';
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

const foldable = (last: JournalEvent, fact: JournalFact): boolean =>
  last.by === fact.by && last.verb === fact.verb && fact.at - last.at <= COALESCE_MS;

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

const quote = (detail: string, max = 44): string =>
  `${OPEN}${detail.length > max ? `${detail.slice(0, max - 1)}…` : detail}${CLOSE}`;

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

const VERB: Record<JournalVerb, [string, string]> = {
  added: ['added', 'was added'],
  moved: ['moved', 'moved'],
  retitled: ['rewrote', 'was rewritten'],
  recoloured: ['recoloured', 'was recoloured'],
  removed: ['removed', 'was removed'],
  linked: ['drew', 'was drawn'],
  unlinked: ['removed', 'was removed'],
  grouped: ['formed', 'was formed'],
  annotated: ['left', 'was left'],
  replaced: ['replaced', 'was replaced'],
};

/**
 * One event as a sentence.
 *
 * The seat name is passed in rather than looked up, because who counts as
 * "you" differs between the panel and a tool result, and because a seat name is
 * only meaningful against the room as it stands right now.
 */
export const describeEvent = (event: JournalEvent, name: string | null): string => {
  const n = event.ids.length;
  const [one, many] = NOUN[event.verb];
  const [active, passive] = VERB[event.verb];
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
    if (state.scene === prev.scene) return;
    recordFacts(diffScene(prev.scene, state.scene, Date.now()));
  });
