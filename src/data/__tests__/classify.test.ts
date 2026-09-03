import { describe, expect, it } from 'vitest';
import { classify } from '../classify';
import { seedScene } from '../seed';

/**
 * The seeded board numbers its risks `R1:`…`R5:`, and the classifier only knew
 * `H1:` — the convention of the board this demo replaced. Nothing failed
 * loudly: the notes fell through to `action`, so "Cluster by kind of evidence"
 * quietly produced two of its three clusters, and the two recipes that reason
 * about hypotheses threw on the board they ship with.
 */

describe('the seeded board', () => {
  it('has risks the classifier recognises', () => {
    const kinds = seedScene().nodes.map((n) => classify(n.text));
    expect(kinds.filter((k) => k === 'hypothesis').length).toBeGreaterThanOrEqual(2);
  });

  it('still recognises the older H-numbered form', () => {
    expect(classify('H1: people bounce at the team-size step')).toBe('hypothesis');
  });

  it('does not mistake an ordinary sentence starting with r for a risk', () => {
    expect(classify('Runway covers four months')).not.toBe('hypothesis');
  });
});
