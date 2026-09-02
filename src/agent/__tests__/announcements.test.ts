import { describe, expect, it } from 'vitest';
import { MIN_VISIBLE_MS, hold, liveAnnouncements, pendingFrom } from '../announcements';
import type { Presence } from '../../sync/presence';
import type { Intent } from '../../state/types';

const intent = (ids: string[], over: Partial<Intent> = {}): Intent => ({
  verb: 'arranging',
  what: `${ids.length} notes`,
  ids,
  at: 1,
  ...over,
});

const peer = (over: Partial<Presence> = {}): Presence => ({
  actor: 'h_one',
  name: 'Ochre',
  holding: [],
  agent: 'a_one',
  agentHolding: [],
  selected: [],
  cursor: null,
  doing: null,
  ...over,
});

/**
 * The bug this file exists for, found by driving two live tabs: the strip said
 * "1 ringed" while `document.querySelectorAll('.note.pending')` returned 0. The
 * strip and the canvas each derived the announcement separately, so a claim
 * about the board and the marks on the board could disagree — and on a busy
 * page they reliably did, because an act that finishes in under a frame never
 * survives long enough for the heavier canvas to paint it.
 *
 * One held list now feeds both, and it is held long enough to be seen.
 */
describe('the announcements on screen', () => {
  it('reads both this tab and its peers into one list', () => {
    const live = liveAnnouncements(intent(['n1']), [peer({ doing: intent(['n2', 'n3']) })]);
    expect(live.map((a) => a.own)).toEqual([true, false]);
    expect(live[1].ids).toEqual(['n2', 'n3']);
  });

  it('is empty when nobody has announced anything', () => {
    expect(liveAnnouncements(null, [peer()])).toEqual([]);
  });

  it('marks the notes from the very same list the strip counts', () => {
    const live = liveAnnouncements(intent(['n1']), [peer({ doing: intent(['n2']) })]);
    const marks = pendingFrom(live);
    // The invariant the live bug broke: what the pill says, the board shows.
    expect(marks.size).toBe(live.reduce((n, a) => n + a.ids.length, 0));
    expect(marks.get('n1')).toBe('own');
    expect(marks.get('n2')).toBe('peer');
  });

  it('keeps a note yours when both agents named it, since yours is the one you can stop', () => {
    const live = liveAnnouncements(intent(['n1']), [peer({ doing: intent(['n1']) })]);
    expect(pendingFrom(live).get('n1')).toBe('own');
  });
});

describe('holding an announcement long enough to be seen', () => {
  const live = () => liveAnnouncements(intent(['n1']), []);

  it('shows a new announcement the instant it arrives', () => {
    expect(hold([], live(), 1000)).toHaveLength(1);
  });

  it('keeps one that has already gone until it has had its moment', () => {
    const held = hold([], live(), 1000);
    expect(hold(held, [], 1000 + MIN_VISIBLE_MS - 1)).toHaveLength(1);
  });

  it('lets it go once that moment has passed', () => {
    const held = hold([], live(), 1000);
    expect(hold(held, [], 1000 + MIN_VISIBLE_MS)).toEqual([]);
  });

  it('does not restart the clock while the act is still running', () => {
    const first = hold([], live(), 1000);
    const later = hold(first, live(), 1400);
    expect(later[0].since).toBe(1000);
  });

  /**
   * Two acts in a row from one seat must not merge into one long-lived ghost:
   * a held announcement that has been replaced is a lie about what is running.
   */
  it('replaces a held announcement when the same seat announces something new', () => {
    const first = hold([], live(), 1000);
    const next = liveAnnouncements(intent(['n9'], { verb: 'linking', what: '2 pairs' }), []);
    const after = hold(first, next, 1100);
    expect(after).toHaveLength(1);
    expect(after[0].verb).toBe('linking');
    expect(after[0].since).toBe(1100);
  });

  it('holds a departed peer’s announcement too, not only your own', () => {
    const peerLive = liveAnnouncements(null, [peer({ doing: intent(['n2']) })]);
    const held = hold([], peerLive, 1000);
    expect(hold(held, [], 1000 + MIN_VISIBLE_MS - 1)[0].own).toBe(false);
  });
});
