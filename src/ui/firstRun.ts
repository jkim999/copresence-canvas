/**
 * Which beat of the introduction a first-time visitor is on.
 *
 * Separated from the component because the rule that matters here is a rule
 * about *when*, and the two mistakes it prevents are both invisible in a
 * screenshot: an instruction shown only while it cannot be followed, and an
 * invitation extended to a room that already has the person in it.
 */
export type Beat =
  /** Nothing has happened yet. Offer the act. */
  | 'watch'
  /** The act is running. This is the only moment the instruction is true. */
  | 'drag'
  /** The act is over. Offer the half of the argument a lone tab cannot show. */
  | 'second'
  | 'gone';

export interface Standing {
  step: 'idle' | 'running' | 'ran' | 'dismissed';
  changes: number;
  calls: number;
  connected: boolean;
  peers: number;
}

export const beatFor = (s: Standing): Beat => {
  if (s.step === 'dismissed') return 'gone';

  // Deliberately ahead of every "this board is already in use" test below. Once
  // the visitor has started the act, the act's own changes are pouring into
  // that count — so reading them here is how the instruction came to be taken
  // off screen by the very thing it was describing.
  if (s.step === 'running') return 'drag';

  // A second tab IS the second person; there is no room to join. So the offer
  // is worth making only to somebody who has not already got one.
  if (s.step === 'ran') return s.peers > 0 ? 'gone' : 'second';

  if (s.changes > 0 || s.calls > 0 || s.connected) return 'gone';
  return 'watch';
};
