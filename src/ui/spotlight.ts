import { create } from 'zustand';

/**
 * The notes one history row is about, while a reader is pointing at it.
 *
 * A line of history names a change but not a place: "Cedar moved 3 notes" on a
 * board of forty leaves you to find which three. Pointing at the row rings them
 * on the canvas, which costs nothing and turns the record into a map.
 *
 * Kept out of the scene deliberately. This is one reader's attention, not a
 * fact about the board — it is never published, never undone, and a peer must
 * never see where your eye happens to be.
 */

interface SpotlightState {
  ids: readonly string[];
  /** The row holding the light, so a stale leave cannot turn off a live one. */
  source: string | null;
}

export const useSpotlightStore = create<SpotlightState>(() => ({ ids: [], source: null }));

export const spotlight = (source: string, ids: readonly string[]): void => {
  if (ids.length === 0) return;
  useSpotlightStore.setState({ ids, source });
};

export const unspotlight = (source: string): void => {
  if (useSpotlightStore.getState().source !== source) return;
  useSpotlightStore.setState({ ids: [], source: null });
};
