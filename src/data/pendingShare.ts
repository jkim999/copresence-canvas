import { create } from 'zustand';
import type { Scene } from '../state/types';

/**
 * A board that arrived in a link and could not be opened.
 *
 * Rooms are named after the URL without its fragment, and the fragment is where
 * a shared board lives — so following a link while another tab already has this
 * page open lands you in a room that already has a board. Adopting it is the
 * safe half of the answer: nobody else's work gets overwritten by someone
 * opening a link. Doing that silently was the other half, and it meant the
 * board you followed vanished with no dialog, no log line and no way back.
 *
 * It is held here instead, and offered.
 */
interface PendingShare {
  /** The board from the link, kept only until it is opened or dismissed. */
  scene: Scene | null;
  /** True once the room turned out to already have a board of its own. */
  displaced: boolean;
}

export const usePendingShare = create<PendingShare>(() => ({ scene: null, displaced: false }));

export const arrivedFromLink = (scene: Scene): void => {
  usePendingShare.setState({ scene, displaced: false });
};

/** The room already had a board, so the followed one is waiting rather than lost. */
export const shareWasDisplaced = (): void => {
  if (usePendingShare.getState().scene === null) return;
  usePendingShare.setState({ displaced: true });
};

export const clearPendingShare = (): void => {
  usePendingShare.setState({ scene: null, displaced: false });
};
