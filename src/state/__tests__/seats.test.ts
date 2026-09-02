import { describe, expect, it } from 'vitest';
import { SEAT_NAMES, disambiguate, seatName } from '../actors';

/**
 * A seat name is how one participant refers to another: it badges their tool
 * calls and it is the whole content of a refusal ("Ochre declined"). Two people
 * sharing one name therefore does not degrade gracefully — it makes the ledger
 * and the consent messages quietly wrong, and it is what led one test agent to
 * report a peer's calls as its own.
 *
 * The name is derived from the actor id with no coordination, so uniqueness
 * cannot be guaranteed by construction. It is guaranteed where it is read.
 */

describe('deriving a seat name', () => {
  it('gives the same peer the same name on every screen', () => {
    expect(seatName('h_abc')).toBe(seatName('h_abc'));
  });

  it('has enough names that two people rarely collide', () => {
    // 8 names put two peers in the same seat about one time in eight, which is
    // often enough to have actually happened during a two-tab test.
    expect(SEAT_NAMES.length).toBeGreaterThanOrEqual(24);
    expect(new Set(SEAT_NAMES).size).toBe(SEAT_NAMES.length);
  });
});

describe('when two present participants land on one name anyway', () => {
  /** Two ids that genuinely collide, found rather than assumed. */
  const collidingPair = (): [string, string] => {
    const seen = new Map<string, string>();
    for (let i = 0; i < 100_000; i += 1) {
      const id = `h_${i.toString(36)}`;
      const name = seatName(id);
      const prior = seen.get(name);
      if (prior) return [prior, id];
      seen.set(name, id);
    }
    throw new Error('no collision found');
  };

  it('tells them apart rather than printing one name twice', () => {
    const [a, b] = collidingPair();
    expect(seatName(a)).toBe(seatName(b));

    const labels = disambiguate([a, b]);
    expect(labels[a]).not.toBe(labels[b]);
    // The pretty name still leads; only the tie-break is added.
    expect(labels[a].startsWith(seatName(a))).toBe(true);
  });

  it('leaves an uncontested name completely alone', () => {
    const [a] = collidingPair();
    expect(disambiguate([a])[a]).toBe(seatName(a));
  });

  it('labels the same room the same way whatever order it is read in', () => {
    const [a, b] = collidingPair();
    expect(disambiguate([a, b])).toEqual(disambiguate([b, a]));
  });
});
