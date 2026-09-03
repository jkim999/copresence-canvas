import { beforeEach, describe, expect, it } from 'vitest';
import { noteFor, stalenessOf, verdictFrom } from '../staleness';
import { journalCursor, recordFacts, resetJournal } from '../../state/journal';
import { myAgent, takeSeat } from '../../state/actors';
import type { JournalEvent } from '../../state/journal';

const PEER = 'h_peer';
const MINE = 'a_mine';

let seq = 0;
const event = (over: Partial<JournalEvent> = {}): JournalEvent => {
  seq += 1;
  return {
    seq,
    at: Date.now(),
    by: PEER,
    verb: 'moved',
    ids: ['n1'],
    detail: 'a note',
    ...over,
  };
};

beforeEach(() => {
  seq = 0;
  resetJournal();
  takeSeat();
});

describe('verdictFrom', () => {
  it('passes a write nothing has touched', () => {
    const v = verdictFrom([event({ ids: ['n9'] })], ['n1', 'n2'], MINE, { complete: true });
    expect(v.stale).toBe(false);
    expect(v.conflicts).toEqual([]);
  });

  it('refuses a write whose notes somebody else has moved', () => {
    const v = verdictFrom([event({ ids: ['n1'] })], ['n1', 'n2'], MINE, { complete: true });
    expect(v.stale).toBe(true);
    expect(v.reason).toBe('changed');
    expect(v.conflicts).toHaveLength(1);
  });

  it('reports only the notes actually contested, not the whole event', () => {
    const v = verdictFrom([event({ ids: ['n1', 'n7'] })], ['n1'], MINE, { complete: true });
    expect(v.conflicts[0].ids).toEqual(['n1']);
  });

  it('does not count the calling agent against itself', () => {
    const v = verdictFrom([event({ by: MINE })], ['n1'], MINE, { complete: true });
    expect(v.stale).toBe(false);
  });

  it('counts a removal, which has no author at all', () => {
    const v = verdictFrom(
      [event({ by: null, verb: 'removed' })],
      ['n1'],
      MINE,
      { complete: true },
    );
    expect(v.stale).toBe(true);
  });

  it('refuses when the record is too short to prove nothing happened', () => {
    const v = verdictFrom([], ['n1'], MINE, { complete: false });
    expect(v.stale).toBe(true);
    expect(v.reason).toBe('forgotten');
  });

  it('passes a write that names no existing notes, however stale the premise', () => {
    const v = verdictFrom([event()], [], MINE, { complete: false });
    expect(v.stale).toBe(false);
  });
});

describe('stalenessOf', () => {
  it('passes a write that cites no premise at all', () => {
    recordFacts([{ at: Date.now(), by: PEER, verb: 'moved', ids: ['n1'], detail: 'a note' }]);
    expect(stalenessOf(undefined, ['n1']).stale).toBe(false);
  });

  it('refuses a write citing a cursor from before a peer touched its notes', () => {
    const before = journalCursor();
    recordFacts([{ at: Date.now(), by: PEER, verb: 'moved', ids: ['n1'], detail: 'a note' }]);
    expect(stalenessOf(before, ['n1']).stale).toBe(true);
  });

  it('passes once the agent has re-read past the change', () => {
    recordFacts([{ at: Date.now(), by: PEER, verb: 'moved', ids: ['n1'], detail: 'a note' }]);
    expect(stalenessOf(journalCursor(), ['n1']).stale).toBe(false);
  });

  it('ignores this seat’s own agent, whose writes are the caller’s own', () => {
    const before = journalCursor();
    recordFacts([{ at: Date.now(), by: myAgent(), verb: 'moved', ids: ['n1'], detail: 'x' }]);
    expect(stalenessOf(before, ['n1']).stale).toBe(false);
  });
});

describe('noteFor', () => {
  it('names who moved the ground, and forbids a blind retry', () => {
    const note = noteFor(verdictFrom([event()], ['n1'], MINE, { complete: true }));
    expect(note).toMatch(/what_changed|get_scene/);
    expect(note).toMatch(/not|do not/i);
  });

  it('says plainly when the reason is a forgotten stretch of record', () => {
    const note = noteFor(verdictFrom([], ['n1'], MINE, { complete: false }));
    expect(note).toMatch(/get_scene/);
  });
});
