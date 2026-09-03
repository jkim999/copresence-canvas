import { useSceneStore } from './sceneStore';
import { me } from './actors';

/**
 * Everything this tab is holding by hand, from every hand it has.
 *
 * The store's grip is per-actor by design: claiming drops whatever that actor
 * held and re-takes the list, so a second pointer coming down cannot steal a
 * note somebody else already has. That is right for the store and wrong for a
 * caller, because one person has more than one way to hold a note. Dragging is
 * the obvious one. Typing into a note is the other, and it was not wired at
 * all — so the board promised that a hand on a note is sacred while quietly
 * meaning only a hand that is dragging it. An agent would move a note out from
 * under a caret mid-sentence, and the person's blur would then write their
 * stale draft over whatever had arrived in the meantime.
 *
 * Wiring the caret straight into `setGrip` would have swapped one bug for
 * another: the two hands would each drop the other's claim on every call. So
 * the union lives here, one level above the store, and the store keeps its
 * single-claim-per-actor rule intact.
 *
 * A note is released only when every hand on it has let go, which is what makes
 * dragging a note you are also editing safe.
 */

export type Hand = 'drag' | 'edit';

const held: Record<Hand, Set<string>> = { drag: new Set(), edit: new Set() };

/** What this tab holds right now, in a stable order. */
export const hands = (): string[] => [...new Set([...held.drag, ...held.edit])];

const publish = (): void => {
  useSceneStore.getState().setGrip(hands(), me());
};

export const takeHand = (hand: Hand, nodeId: string): void => {
  held[hand].add(nodeId);
  publish();
};

export const releaseHand = (hand: Hand, nodeId: string): void => {
  held[hand].delete(nodeId);
  publish();
};

/**
 * Let go of everything, for the paths that replace the board wholesale — an
 * import, a shared link, a reset. Hands that outlive the notes they were on
 * would hold ids that no longer exist, and the grip is consulted by id.
 */
export const dropAllHands = (): void => {
  held.drag.clear();
  held.edit.clear();
};

/**
 * A board replaced under a hand takes the hand with it.
 *
 * Hooked to the epoch rather than to the callers that replace boards — a reset,
 * an import, a shared link adopted from a peer — because the list of those will
 * grow and a hand still holding the ids of notes that no longer exist would go
 * on publishing claims over them to the room forever. One subscription cannot
 * be forgotten; four call sites can.
 */
useSceneStore.subscribe((state, prev) => {
  if (state.epoch !== prev.epoch) dropAllHands();
});
