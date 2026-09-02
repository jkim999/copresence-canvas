import { describe, expect, it } from 'vitest';
import { REPEAT_WINDOW_MS, splitRepeats } from '../dedupe';

/**
 * An agent driving a background tab timed out client-side, assumed its call was
 * lost, and retried. The call had not been lost — it was crawling under timer
 * throttling — so the board ended up with three copies of one note and five
 * copies of another. No tool said "you already did this", because nothing was
 * looking.
 */

const AGENT = 'a_1';
const OTHER = 'a_2';
const now = 1_000_000;
const node = (id: string, text: string, by: string, editedAt: number) =>
  ({ id, text, lastEditedBy: by, editedAt }) as never;

describe('telling a retry apart from a real second note', () => {
  it('lets a genuinely new note through', () => {
    const r = splitRepeats(['fresh'], [], AGENT, now);
    expect(r.fresh).toEqual(['fresh']);
    expect(r.repeats).toEqual([]);
  });

  it('refuses a note this agent wrote moments ago, naming what it matched', () => {
    const existing = [node('n_1', 'hello', AGENT, now - 5_000)];
    const r = splitRepeats(['hello'], existing, AGENT, now);

    expect(r.fresh).toEqual([]);
    expect(r.repeats).toEqual([{ text: 'hello', existingId: 'n_1' }]);
  });

  it('splits a partly-landed retry, which is the shape a timeout leaves behind', () => {
    // The exact failure seen: five notes asked for, three landed, the agent
    // retried all five. Only the two that never landed should be written.
    const existing = ['one', 'two', 'three'].map((t, i) =>
      node(`n_${i}`, t, AGENT, now - 3_000),
    );
    const r = splitRepeats(['one', 'two', 'three', 'four', 'five'], existing, AGENT, now);

    expect(r.fresh).toEqual(['four', 'five']);
    expect(r.repeats.map((x) => x.existingId)).toEqual(['n_0', 'n_1', 'n_2']);
  });

  it('allows the same text again once the window has passed', () => {
    // Deliberately writing "Follow up" twice an hour apart is ordinary work,
    // not a retry. The guard is against a stutter, not against repetition.
    const existing = [node('n_1', 'Follow up', AGENT, now - REPEAT_WINDOW_MS - 1)];
    expect(splitRepeats(['Follow up'], existing, AGENT, now).fresh).toEqual(['Follow up']);
  });

  it('never suppresses a note because somebody else wrote the same words', () => {
    // Two people converging on the same phrasing is a real thing that happens
    // on a shared board, and swallowing the second one would lose their work.
    const existing = [node('n_1', 'risk', OTHER, now - 1_000)];
    expect(splitRepeats(['risk'], existing, AGENT, now).fresh).toEqual(['risk']);
  });

  it('writes both copies when the agent asks for the same text twice in one call', () => {
    // One call asking for two identical notes is an explicit instruction, not
    // a stutter — the retry guard must not silently halve it.
    const r = splitRepeats(['same', 'same'], [], AGENT, now);
    expect(r.fresh).toEqual(['same', 'same']);
  });

  it('ignores surrounding whitespace when matching', () => {
    const existing = [node('n_1', 'trimmed', AGENT, now - 1_000)];
    expect(splitRepeats(['  trimmed  '], existing, AGENT, now).fresh).toEqual([]);
  });
});
