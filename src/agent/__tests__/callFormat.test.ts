import { describe, expect, it } from 'vitest';
import { formatArgs, summarizeResult } from '../callFormat';

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
    expect(summarizeResult('reorganize_board', { approved: false })).toBe('you declined');
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
