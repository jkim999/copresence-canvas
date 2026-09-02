import { beforeEach, describe, expect, it } from 'vitest';
import { useSceneStore } from '../sceneStore';
import {
  COALESCE_MS,
  JOURNAL_LIMIT,
  describeEvent,
  diffScene,
  eventsSince,
  journalCursor,
  recordFacts,
  resetJournal,
  revertScope,
  useJournalStore,
  watchScene,
  type JournalEvent,
} from '../journal';
import type { Scene, SceneNode } from '../types';

const HUMAN = 'h_one';
const AGENT = 'a_one';
const PEER = 'a_two';

const node = (id: string, over: Partial<SceneNode> = {}): SceneNode => ({
  id,
  text: `text ${id}`,
  x: 0,
  y: 0,
  w: 176,
  h: 84,
  color: '#fff',
  cluster: null,
  kind: 'idea',
  lastEditedBy: HUMAN,
  editedAt: 0,
  selected: false,
  ...over,
});

const scene = (over: Partial<Scene> = {}): Scene => ({
  nodes: [],
  edges: [],
  annotations: [],
  regions: [],
  ...over,
});

beforeEach(() => resetJournal());

describe('diffScene', () => {
  it('reports nothing when nothing changed', () => {
    const s = scene({ nodes: [node('n1')] });
    expect(diffScene(s, s, 1000)).toEqual([]);
  });

  it('names who added a note, and what it says', () => {
    const before = scene();
    const after = scene({ nodes: [node('n1', { text: 'ship it', lastEditedBy: AGENT })] });
    const [fact] = diffScene(before, after, 1000);
    expect(fact).toMatchObject({ verb: 'added', by: AGENT, ids: ['n1'], detail: 'ship it' });
  });

  it('groups one diff by actor, so two hands are two facts', () => {
    const before = scene();
    const after = scene({
      nodes: [
        node('n1', { lastEditedBy: AGENT }),
        node('n2', { lastEditedBy: AGENT }),
        node('n3', { lastEditedBy: HUMAN }),
      ],
    });
    const facts = diffScene(before, after, 1000);
    expect(facts).toHaveLength(2);
    expect(facts.find((f) => f.by === AGENT)?.ids).toEqual(['n1', 'n2']);
    expect(facts.find((f) => f.by === HUMAN)?.ids).toEqual(['n3']);
  });

  it('sees a move, and credits the hand that made it', () => {
    const before = scene({ nodes: [node('n1')] });
    const after = scene({ nodes: [node('n1', { x: 400, lastEditedBy: PEER })] });
    const [fact] = diffScene(before, after, 1000);
    expect(fact).toMatchObject({ verb: 'moved', by: PEER, ids: ['n1'] });
  });

  it('ignores a move too small to see', () => {
    const before = scene({ nodes: [node('n1')] });
    const after = scene({ nodes: [node('n1', { x: 0.4 })] });
    expect(diffScene(before, after, 1000)).toEqual([]);
  });

  it('does not call a selection a change to the board', () => {
    const before = scene({ nodes: [node('n1')] });
    const after = scene({ nodes: [node('n1', { selected: true })] });
    expect(diffScene(before, after, 1000)).toEqual([]);
  });

  it('separates a retitle from a move', () => {
    const before = scene({ nodes: [node('n1')] });
    const after = scene({ nodes: [node('n1', { text: 'new words', x: 900, lastEditedBy: AGENT })] });
    const facts = diffScene(before, after, 1000);
    expect(facts.map((f) => f.verb).sort()).toEqual(['moved', 'retitled']);
  });

  it('reports a removal even though no actor is recorded for it', () => {
    const before = scene({ nodes: [node('n1', { text: 'gone' })] });
    const [fact] = diffScene(before, scene(), 1000);
    expect(fact).toMatchObject({ verb: 'removed', by: null, ids: ['n1'], detail: 'gone' });
  });

  it('reports a new edge under its label', () => {
    const before = scene({ nodes: [node('n1'), node('n2')] });
    const after = scene({
      ...before,
      edges: [{ id: 'e1', from: 'n1', to: 'n2', label: 'causes', lastEditedBy: AGENT, editedAt: 0 }],
    });
    const [fact] = diffScene(before, after, 1000);
    expect(fact).toMatchObject({ verb: 'linked', by: AGENT, detail: 'causes' });
  });

  it('reports a new region under its name', () => {
    const before = scene({ nodes: [node('n1')] });
    const after = scene({
      ...before,
      regions: [
        { id: 'r1', label: 'Risks', layout: 'grid', nodeIds: ['n1'], lastEditedBy: AGENT, editedAt: 0 },
      ],
    });
    const [fact] = diffScene(before, after, 1000);
    expect(fact).toMatchObject({ verb: 'grouped', by: AGENT, detail: 'Risks' });
  });

  it('reports a region whose membership changed, not only a brand new one', () => {
    const region = {
      id: 'r1',
      label: 'Risks',
      layout: 'grid' as const,
      nodeIds: ['n1'],
      lastEditedBy: AGENT,
      editedAt: 0,
    };
    const before = scene({ nodes: [node('n1'), node('n2')], regions: [region] });
    const after = scene({ ...before, regions: [{ ...region, nodeIds: ['n1', 'n2'] }] });
    const [fact] = diffScene(before, after, 1000);
    expect(fact).toMatchObject({ verb: 'grouped', detail: 'Risks' });
  });

  it('reports an annotation under its text', () => {
    const after = scene({
      annotations: [
        { id: 'a1', text: 'where is the evidence?', nodeId: null, x: 0, y: 0, lastEditedBy: AGENT, editedAt: 0 },
      ],
    });
    const [fact] = diffScene(scene(), after, 1000);
    expect(fact).toMatchObject({ verb: 'annotated', by: AGENT, detail: 'where is the evidence?' });
  });
});

describe('the journal', () => {
  it('hands out a monotonic cursor', () => {
    expect(journalCursor()).toBe(0);
    recordFacts([{ at: 1000, by: AGENT, verb: 'added', ids: ['n1'], detail: 'a' }]);
    expect(journalCursor()).toBe(1);
  });

  it('returns only what happened after the cursor a reader last held', () => {
    recordFacts([{ at: 1000, by: AGENT, verb: 'added', ids: ['n1'], detail: 'a' }]);
    const mark = journalCursor();
    recordFacts([{ at: 9000, by: HUMAN, verb: 'moved', ids: ['n2'], detail: 'b' }]);
    const since = eventsSince(mark);
    expect(since).toHaveLength(1);
    expect(since[0]).toMatchObject({ verb: 'moved', by: HUMAN });
  });

  it('folds a continuous drag into one event rather than sixty', () => {
    for (let i = 0; i < 60; i += 1) {
      recordFacts([{ at: 1000 + i * 16, by: HUMAN, verb: 'moved', ids: ['n1'], detail: 'x' }]);
    }
    const { events } = useJournalStore.getState();
    expect(events).toHaveLength(1);
    expect(events[0].ids).toEqual(['n1']);
  });

  it('unions the ids of the moves it folds together', () => {
    recordFacts([{ at: 1000, by: AGENT, verb: 'moved', ids: ['n1'], detail: 'x' }]);
    recordFacts([{ at: 1100, by: AGENT, verb: 'moved', ids: ['n2'], detail: 'y' }]);
    const { events } = useJournalStore.getState();
    expect(events).toHaveLength(1);
    expect(events[0].ids).toEqual(['n1', 'n2']);
  });

  it('does not fold two hands together, however close in time', () => {
    recordFacts([{ at: 1000, by: AGENT, verb: 'moved', ids: ['n1'], detail: 'x' }]);
    recordFacts([{ at: 1001, by: HUMAN, verb: 'moved', ids: ['n2'], detail: 'y' }]);
    expect(useJournalStore.getState().events).toHaveLength(2);
  });

  it('stops folding once the pause is long enough to be a separate act', () => {
    recordFacts([{ at: 1000, by: AGENT, verb: 'moved', ids: ['n1'], detail: 'x' }]);
    recordFacts([{ at: 1000 + COALESCE_MS + 1, by: AGENT, verb: 'moved', ids: ['n2'], detail: 'y' }]);
    expect(useJournalStore.getState().events).toHaveLength(2);
  });

  it('keeps the cursor meaningful when old events fall off the end', () => {
    for (let i = 0; i < JOURNAL_LIMIT + 20; i += 1) {
      recordFacts([{ at: i * 100_000, by: AGENT, verb: 'added', ids: [`n${i}`], detail: 'x' }]);
    }
    const { events } = useJournalStore.getState();
    expect(events).toHaveLength(JOURNAL_LIMIT);
    // The cursor still counts every event that ever happened, so a reader
    // holding an old mark is told it cannot be answered in full.
    expect(journalCursor()).toBe(JOURNAL_LIMIT + 20);
    expect(events[0].seq).toBe(21);
  });
});

/**
 * Found by two agents driving one board: a single `arrange_region` call showed
 * up as six separate history rows — "moved 9 notes", "moved 8", "moved 17",
 * "moved 15", "moved 15" — totalling more moves than the board had notes. The
 * act animates over several seconds and nudges bystanders aside as it goes, so
 * its writes straddle the coalescing window and one decision reads as six.
 *
 * The window was never the right unit. An act is.
 */
describe('one act, one line', () => {
  const ACT = 4242;

  it('folds writes from one act however far apart they land', () => {
    recordFacts([{ at: 1000, by: AGENT, verb: 'moved', ids: ['n1'], detail: 'a', act: ACT }]);
    recordFacts([{ at: 9000, by: AGENT, verb: 'moved', ids: ['n2'], detail: 'b', act: ACT }]);
    const { events } = useJournalStore.getState();
    expect(events).toHaveLength(1);
    expect(events[0].ids).toEqual(['n1', 'n2']);
  });

  it('still keeps a different verb in the same act on its own line', () => {
    recordFacts([{ at: 1000, by: AGENT, verb: 'moved', ids: ['n1'], detail: 'a', act: ACT }]);
    recordFacts([{ at: 1100, by: AGENT, verb: 'grouped', ids: ['r1'], detail: 'Evidence', act: ACT }]);
    expect(useJournalStore.getState().events).toHaveLength(2);
  });

  it('does not fold two separate acts together, however close', () => {
    recordFacts([{ at: 1000, by: AGENT, verb: 'moved', ids: ['n1'], detail: 'a', act: ACT }]);
    recordFacts([{ at: 1010, by: AGENT, verb: 'moved', ids: ['n2'], detail: 'b', act: ACT + 1 }]);
    expect(useJournalStore.getState().events).toHaveLength(2);
  });

  it('still folds a human drag, which belongs to no act at all', () => {
    recordFacts([{ at: 1000, by: HUMAN, verb: 'moved', ids: ['n1'], detail: 'a' }]);
    recordFacts([{ at: 1200, by: HUMAN, verb: 'moved', ids: ['n1'], detail: 'a' }]);
    expect(useJournalStore.getState().events).toHaveLength(1);
  });
});

describe('describeEvent', () => {
  const name = (by: string | null) => (by === AGENT ? 'Cedar’s agent' : by === null ? null : 'Ochre');

  it('writes a sentence a person can read', () => {
    recordFacts([{ at: 1000, by: AGENT, verb: 'added', ids: ['n1', 'n2'], detail: 'ship it' }]);
    const [event] = useJournalStore.getState().events;
    expect(describeEvent(event, name(event.by))).toBe('Cedar’s agent added 2 notes — “ship it”');
  });

  it('says one note, not 1 notes', () => {
    recordFacts([{ at: 1000, by: AGENT, verb: 'added', ids: ['n1'], detail: 'ship it' }]);
    const [event] = useJournalStore.getState().events;
    expect(describeEvent(event, name(event.by))).toBe('Cedar’s agent added a note — “ship it”');
  });

  it('does not invent an author for a removal it cannot attribute', () => {
    recordFacts([{ at: 1000, by: null, verb: 'removed', ids: ['n1'], detail: 'gone' }]);
    const [event] = useJournalStore.getState().events;
    expect(describeEvent(event, null)).toBe('A note was removed — “gone”');
  });

  /**
   * "3 notes was removed" was on screen for as long as the panel existed. A
   * record nobody can read without wincing is a record people stop reading.
   */
  it('agrees the verb with the count when it does not know who acted', () => {
    recordFacts([{ at: 1000, by: null, verb: 'removed', ids: ['n1', 'n2', 'n3'], detail: 'gone' }]);
    const [event] = useJournalStore.getState().events;
    expect(describeEvent(event, null)).toBe('3 notes were removed — “gone”');
  });

  /**
   * Note text arrives already quoted often enough — it is an interview quote —
   * and the panel was rendering ““I gave up at the workspace-name step.””.
   */
  /**
   * Interview boards are full of quoted material, and the outer marks landed
   * straight on top of the inner ones: “Support tickets tagged "onboarding" +2.4x”.
   */
  it('turns quote marks inside the detail into inner ones', () => {
    recordFacts([
      { at: 1000, by: AGENT, verb: 'moved', ids: ['n1'], detail: 'tickets tagged "onboarding" up' },
    ]);
    const [event] = useJournalStore.getState().events;
    expect(describeEvent(event, name(event.by))).toBe(
      'Cedar’s agent moved a note — “tickets tagged ‘onboarding’ up”',
    );
  });

  it('does not quote a detail that is already quoted', () => {
    recordFacts([{ at: 1000, by: AGENT, verb: 'moved', ids: ['n1'], detail: '"I gave up."' }]);
    const [event] = useJournalStore.getState().events;
    expect(describeEvent(event, name(event.by))).toBe('Cedar’s agent moved a note — “I gave up.”');
  });
});

/**
 * What a rewind would cost, read off the record rather than guessed.
 *
 * Undo here restores a whole-scene snapshot, so undoing an act from five acts
 * ago also discards the four that followed it — including a colleague's, which
 * arrived over the wire and left no snapshot of its own. A control that says
 * "undo this" while doing that would be lying, so the panel asks the journal
 * what it is about to throw away and says so out loud.
 */
describe('what rewinding to an act would discard', () => {
  const ev = (over: Partial<JournalEvent>): JournalEvent => ({
    at: 1000,
    by: 'a_mine',
    verb: 'moved',
    ids: ['n1'],
    detail: '',
    seq: 1,
    ...over,
  });

  it('counts nothing when the act is the most recent thing that happened', () => {
    const events = [ev({ seq: 1, act: 100 }), ev({ seq: 2, act: 200 })];
    expect(revertScope(events, 200, 'h_me', 'a_mine')).toEqual({
      laterChanges: 0,
      othersAffected: [],
    });
  });

  it('counts every change recorded after it', () => {
    const events = [
      ev({ seq: 1, act: 100 }),
      ev({ seq: 2, act: 100 }),
      ev({ seq: 3, act: 200 }),
      ev({ seq: 4, by: 'h_me' }),
    ];
    expect(revertScope(events, 100, 'h_me', 'a_mine').laterChanges).toBe(2);
  });

  /**
   * The one that makes this worth asking about. Your own later work is yours to
   * throw away; a colleague's is not, and it is invisible in this panel unless
   * something says so.
   */
  it('names the other seats whose work would go with it', () => {
    const events = [
      ev({ seq: 1, act: 100 }),
      ev({ seq: 2, by: 'h_them' }),
      ev({ seq: 3, by: 'a_theirs' }),
      ev({ seq: 4, by: 'h_me' }),
      ev({ seq: 5, by: 'h_them' }),
    ];
    const scope = revertScope(events, 100, 'h_me', 'a_mine');
    expect(scope.laterChanges).toBe(4);
    expect(scope.othersAffected).toEqual(['h_them', 'a_theirs']);
  });

  it('ignores a removal, which belongs to nobody the record can name', () => {
    const events = [ev({ seq: 1, act: 100 }), ev({ seq: 2, by: null, verb: 'removed' })];
    expect(revertScope(events, 100, 'h_me', 'a_mine').othersAffected).toEqual([]);
  });

  it('treats an act it cannot find as one with nothing after it', () => {
    const events = [ev({ seq: 1, act: 100 })];
    expect(revertScope(events, 999, 'h_me', 'a_mine').laterChanges).toBe(0);
  });
});

/**
 * A rewind is not something the people on the board just did.
 *
 * Restoring a snapshot moves notes back, and the notes carry whoever last
 * edited them — so diffing the restore produced lines like "Nettle's agent
 * moved 4 notes", timestamped now, about work Nettle's agent did not do and a
 * moment at which it may not even have been connected. Found by rewinding in a
 * live tab and reading what the panel then claimed.
 *
 * The rewind already writes its own notice, so the honest record of it is one
 * line saying it happened, not seven attributing it to bystanders.
 */
describe('what a rewind puts in the record', () => {
  it('does not attribute the restored board to whoever last touched each note', () => {
    const store = () => useSceneStore.getState();
    store().resetScene();
    resetJournal();
    const stop = watchScene();

    try {
      store().snapshot('Arrange 4 notes', 'a_mine', 4242);
      const moving = store().scene.nodes.slice(0, 4).map((n) => n.id);
      store().moveNodes(
        Object.fromEntries(moving.map((id, i) => [id, { x: 5000 + i * 60, y: 5000 }])),
        'a_theirs',
      );
      // The move itself is recorded, which is the point of the journal.
      expect(useJournalStore.getState().events.length).toBeGreaterThan(0);

      const before = useJournalStore.getState().events.length;
      store().revertToAct(4242);
      expect(useJournalStore.getState().events.length).toBe(before);
    } finally {
      stop();
    }
  });
});
