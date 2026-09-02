import { describe, expect, it } from 'vitest';
import { askFor, revertLabel, revertQuestion } from '../revert';
import type { RevertScope } from '../../state/journal';

const scope = (over: Partial<RevertScope> = {}): RevertScope => ({
  laterChanges: 0,
  othersAffected: [],
  ...over,
});

/**
 * The row in the history panel offers to rewind, and rewinding here means
 * restoring a whole-scene snapshot — so it can take work nobody pointed at.
 * What separates an honest control from a trapdoor is entirely in what it says
 * before it acts.
 */
describe('who has to agree to a rewind', () => {
  it('asks nobody when that act is the last thing that happened', () => {
    expect(askFor(scope())).toBe('nobody');
  });

  it('asks you when it would discard your own later work', () => {
    expect(askFor(scope({ laterChanges: 3 }))).toBe('you');
  });

  it('asks everyone when a colleague’s work is among it', () => {
    expect(askFor(scope({ laterChanges: 3, othersAffected: ['h_them'] }))).toBe('everyone');
  });
});

describe('what the control calls itself', () => {
  it('is Undo when nothing else goes with it', () => {
    expect(revertLabel(scope())).toBe('Undo');
  });

  it('is Rewind the moment it means more than one act', () => {
    expect(revertLabel(scope({ laterChanges: 1 }))).toBe('Rewind');
  });
});

describe('the question it asks', () => {
  it('counts what would be lost, so the number is never a surprise', () => {
    const q = revertQuestion(scope({ laterChanges: 4 }), 'Arrange 6 notes', []);
    expect(q.body).toContain('4 later changes');
    expect(q.body).toContain('Arrange 6 notes');
  });

  it('reads as English for exactly one', () => {
    expect(revertQuestion(scope({ laterChanges: 1 }), 'x', []).body).toContain('1 later change');
  });

  /**
   * Found in a live dialog, and it is the same defect the journal was fixed for:
   * an act label often already carries quotation marks, and a second pair
   * landed straight on top of the first.
   */
  it('does not put one pair of quotation marks inside another', () => {
    const q = revertQuestion(scope({ laterChanges: 2 }), 'Arrange "Stop test" as grid', []);
    expect(q.body).not.toContain('““');
    expect(q.body).toContain('‘Stop test’');
  });

  it('names the colleague, because "someone else" is not something you can weigh', () => {
    const q = revertQuestion(scope({ laterChanges: 2, othersAffected: ['h_them'] }), 'x', [
      'Cedar',
    ]);
    expect(q.title).toContain('someone else’s work');
    expect(q.body).toContain('Cedar');
    expect(q.body).toContain('Everyone here has to agree');
  });
});
