/**
 * How fast the agent's body moves, as a multiplier on every duration in the
 * choreography.
 *
 * The refusal is the product, and it is only witnessable while a note is in
 * flight — but a note is in flight for about 440ms, and the cursor reaches the
 * next one 150-620ms later. At true speed a six-note act is over in four
 * seconds, which is long enough to *see* and too short to *interrupt*: a person
 * meeting this page for the first time, or a camera, needs the window open
 * wider than a person who already knows where to put their hand.
 *
 * So this scales pacing only. Nothing about what the agent may do, what the
 * page refuses, or what either party is told changes with it — a slow yield and
 * a fast yield run the same code and return the same result. Speeding the board
 * back up must never be able to turn a refusal into a success.
 */

export const MIN_PACE = 0.5;
export const MAX_PACE = 4;

const clamp = (n: number): number => Math.min(MAX_PACE, Math.max(MIN_PACE, n));

/** Exported for tests; the live value is read once at load, below. */
export const paceFrom = (search: string): number => {
  const raw = new URLSearchParams(search).get('pace');
  if (raw === null || raw.trim() === '') return 1;
  const n = Number(raw);
  return Number.isFinite(n) ? clamp(n) : 1;
};

/**
 * Read once. A pace that changed mid-act would leave the tweens already in
 * flight running to their old clock while their siblings ran to a new one.
 */
export const PACE: number =
  typeof window === 'undefined' ? 1 : paceFrom(window.location.search);

/** A duration in true-speed milliseconds, stretched to the pace being run at. */
export const paced = (ms: number): number => ms * PACE;
