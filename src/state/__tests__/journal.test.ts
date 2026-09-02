import { beforeEach, describe, expect, it } from 'vitest';
import {
  COALESCE_MS,
  JOURNAL_LIMIT,
  describeEvent,
  diffScene,
  eventsSince,
  journalCursor,
  recordFacts,
  resetJournal,
  useJournalStore,
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
});
