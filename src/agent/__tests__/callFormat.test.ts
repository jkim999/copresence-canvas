import { describe, expect, it } from 'vitest';
import { formatArgs, refusalNote, summarizeResult } from '../callFormat';

describe('formatArgs', () => {
  it('renders the ids the agent chose, abbreviating a long list', () => {
    expect(formatArgs({ nodeIds: ['n_04', 'n_11', 'n_17', 'n_22', 'n_25'] })).toBe(
      'nodeIds: [n_04, n_11, n_17, +2]',
    );
  });

  it('quotes strings and leaves numbers bare', () => {
    expect(formatArgs({ layout: 'grid', sinceSeconds: 120 })).toBe(
      'layout: "grid", sinceSeconds: 120',
    );
  });

  it('summarises arrays of objects by count', () => {
    expect(formatArgs({ links: [{ from: 'a' }, { from: 'b' }] })).toBe('links: 2×{…}');
  });

  it('is empty for a no-argument call', () => {
    expect(formatArgs({})).toBe('');
    expect(formatArgs(undefined)).toBe('');
  });

  it('truncates long text instead of overflowing the ledger', () => {
    expect(formatArgs({ text: 'x'.repeat(90) })).toHaveLength('text: ""'.length + 34);
  });
});

describe('summarizeResult', () => {
  it('makes the token story legible on get_scene', () => {
    const out = summarizeResult('get_scene', { counts: { nodes: 28 }, nodes: [] });
    expect(out).toContain('28 notes');
    expect(out).toContain('no screenshot');
    expect(out).toMatch(/\d+(\.\d+)? (B|KB)/);
  });

  it('names the notes the agent gave back to the human', () => {
    expect(
      summarizeResult('arrange_region', {
        moved: 6,
        layout: 'timeline_horizontal',
        yieldedToHuman: ['n_03'],
        nudgedAside: ['n_09', 'n_10'],
      }),
    ).toBe('moved 6 · timeline_horizontal · yielded 1 to you · nudged 2 aside');
  });

  it('reports a declined gate as the human declining, not as failure', () => {
    // `refusedBy` is always populated for a real local refusal; the bare
    // `{ approved: false }` this once asserted on stopped being a shape the
    // action can produce once a board could hold more than one person.
    expect(summarizeResult('reorganize_board', { approved: false, refusedBy: 'You' })).toBe(
      'you declined',
    );
  });

  it('says what the agent noticed the human doing', () => {
    expect(
      summarizeResult('get_human_activity', {
        holdingRightNow: [{ id: 'n_02' }],
        recentlyTouched: [{ id: 'n_02' }, { id: 'n_07' }],
      }),
    ).toBe('you are holding 1 · 2 touched recently');
  });

  it('shows a call still in flight', () => {
    expect(summarizeResult('get_scene', undefined)).toBe('running…');
  });

  it('falls back rather than throwing on an unknown tool', () => {
    expect(summarizeResult('something_new', { ok: true })).toBe('ok');
  });
});

describe('a summary that could not absorb everything', () => {
  it('says what it left behind rather than claiming it collapsed', () => {
    expect(
      summarizeResult('summarize_cluster', { collapsed: 4, keptInHand: ['n_02'] }),
    ).toBe('4 notes → 1 summary · left 1 in your hand');
  });

  it('stays quiet when nothing was held', () => {
    expect(summarizeResult('summarize_cluster', { collapsed: 5, keptInHand: [] })).toBe(
      '5 notes → 1 summary',
    );
  });
});

/**
 * Two agents driving one board found this: a whole-board change that a *peer*
 * vetoed, and one that simply timed out with nobody answering, both rendered as
 * "you declined". The asker's own tab therefore accused its own human of a
 * refusal they never made. A ledger exists to be checked against reality, so a
 * plausible-sounding wrong attribution is worse here than no attribution.
 */
describe('summarizeResult names who actually refused', () => {
  it('names the peer who vetoed, rather than blaming the reader', () => {
    const line = summarizeResult('reorganize_board', {
      approved: false,
      groupsApplied: 0,
      moved: 0,
      refusedBy: 'Ochre',
    });
    expect(line).toContain('Ochre');
    expect(line).not.toContain('you declined');
  });

  it('says nobody answered when the ask timed out', () => {
    const line = summarizeResult('reorganize_board', {
      approved: false,
      groupsApplied: 0,
      moved: 0,
      refusedBy: null,
    });
    expect(line).toMatch(/no.?(one|body) answered/i);
    expect(line).not.toContain('you declined');
  });

  it('still says you declined when you are the one who declined', () => {
    const line = summarizeResult('reorganize_board', {
      approved: false,
      groupsApplied: 0,
      moved: 0,
      refusedBy: 'You',
    });
    expect(line).toBe('you declined');
  });

  it('reports an approval with what it moved', () => {
    const line = summarizeResult('reorganize_board', {
      approved: true,
      groupsApplied: 3,
      moved: 12,
      refusedBy: null,
    });
    expect(line).toContain('approved');
    expect(line).toContain('12');
  });
});

describe('the new legibility tools on the ledger line', () => {
  it('says nothing changed rather than showing an empty count', () => {
    expect(summarizeResult('what_changed', { changes: [], complete: true })).toBe(
      'nothing changed',
    );
  });

  it('admits on the visible line when the answer is only partial', () => {
    const out = summarizeResult('what_changed', { changes: [{}, {}], complete: false });
    expect(out).toBe('2 changes · partial');
  });

  it('counts the seats that are mid-act, not just the seats', () => {
    const out = summarizeResult('get_board_context', {
      others: [{ doing: { verb: 'arranging' } }, { doing: null }],
    });
    expect(out).toBe('2 others · 1 mid-act');
  });

  it('says alone when nobody else is there', () => {
    expect(summarizeResult('get_board_context', { others: [] })).toBe('alone');
  });

  it('names why links were skipped, since the reason is the actionable part', () => {
    const out = summarizeResult('find_and_link', {
      created: 1,
      skipped: [{ reason: 'no such note' }, { reason: 'no such note' }, { reason: 'already linked' }],
    });
    expect(out).toBe('1 edges drawn · 3 skipped (no such note, already linked)');
  });
});

/**
 * Found live: `arrange_region` with ids that do not exist on the board came
 * back as "moved 0 · cluster". The result already carried `unknownIds`, but the
 * one line a person actually reads showed nothing, so "nothing needed moving"
 * and "your ids were wrong" looked identical.
 */
describe('an act that could not find what it was sent after', () => {
  it('says so, rather than reporting a quiet zero', () => {
    const line = summarizeResult('arrange_region', {
      moved: 0,
      layout: 'cluster',
      unknownIds: ['n_04', 'n_05'],
    });
    expect(line).toMatch(/2 unknown/);
  });

  it('stays quiet when every id resolved', () => {
    const line = summarizeResult('arrange_region', { moved: 3, layout: 'grid', unknownIds: [] });
    expect(line).not.toMatch(/unknown/);
  });
});

describe('the line the agent was actually told', () => {
  it('shows a refusal, which is the whole point of the call', () => {
    expect(refusalNote({ refused: 'stale', note: 'Refused: the board changed.' }))
      .toBe('Refused: the board changed.');
  });

  it('shows what it was told after a hand took a note off it', () => {
    expect(refusalNote({ moved: 5, yieldedToHuman: ['n_03'], note: 'The human took those notes.' }))
      .toBe('The human took those notes.');
  });

  it('shows the note when the room declined', () => {
    expect(refusalNote({ approved: false, message: 'Nobody answered in time.' }))
      .toBe('Nobody answered in time.');
  });

  it('stays quiet when nothing was refused, so the ledger is not a wall of prose', () => {
    expect(refusalNote({ moved: 6, yieldedToHuman: [], note: 'Coordinates are canvas units.' }))
      .toBeNull();
    expect(refusalNote({ nodes: [], asOf: 3, note: 'Keep asOf.' })).toBeNull();
  });

  it('is not fooled by a result that is not one', () => {
    expect(refusalNote(null)).toBeNull();
    expect(refusalNote('refused')).toBeNull();
    expect(refusalNote({ refused: 'stale' })).toBeNull();
  });
});
