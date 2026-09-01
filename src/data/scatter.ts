/**
 * Deterministic scatter used for every board that starts life unstructured —
 * the seeded demo and anything the human pastes in. Same seed, same board, so
 * a demo recorded twice looks the same twice.
 */

const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const COL_W = 236;
const ROW_H = 190;
const JITTER_X = 150;
const JITTER_Y = 130;

export const DEFAULT_SEED = 20260903;

/** Wide enough to read, narrow enough that the whole board fits one screen. */
export const columnsFor = (count: number): number =>
  Math.max(3, Math.min(6, Math.ceil(Math.sqrt(count))));

export interface ScatterOptions {
  seed?: number;
  columns?: number;
}

/** Poisson-ish positions over a loose grid, jittered so nothing looks gridded. */
export const scatter = (
  count: number,
  { seed = DEFAULT_SEED, columns = 6 }: ScatterOptions = {},
): { x: number; y: number }[] => {
  const rand = mulberry32(seed);
  return Array.from({ length: count }, (_, i) => ({
    x: Math.round((i % columns) * COL_W + (rand() - 0.5) * JITTER_X),
    y: Math.round(Math.floor(i / columns) * ROW_H + (rand() - 0.5) * JITTER_Y),
  }));
};
