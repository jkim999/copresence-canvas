import { useSceneStore } from '../state/sceneStore';
import { quote, revertScope, type JournalEvent, type RevertScope } from '../state/journal';
import { useConfirmStore } from '../agent/confirm';
import { me, myAgent } from '../state/actors';

/**
 * Rewinding the board from the line in the record that describes the act.
 *
 * Undo already existed, as two toolbar buttons that mean "the last thing" and
 * "the last thing the agent did". Neither is where the thought happens: a
 * person forms "no, not that" while reading the row, and that was the one place
 * on the page they could not act on it.
 *
 * The mechanism is snapshots of the whole scene, and this deliberately does not
 * pretend otherwise. Going back to an act from five acts ago goes back past the
 * four that followed. So the control names itself for what it does — Undo when
 * that act is the last thing that happened, Rewind when it is not — and asks
 * before discarding anything the person did not point at.
 *
 * A colleague's work is the case that makes this worth the trouble. It arrived
 * over the wire and left no snapshot here, so nothing but the journal knows it
 * happened, and a rewind would take it silently. Discarding somebody else's
 * work is a change to everybody's board, which on this canvas is already a
 * question put to everybody, where any one refusal stops it.
 */

/** How this act's rewind should be put to the room, if at all. */
export type RevertAsk = 'nobody' | 'you' | 'everyone';

export const askFor = (scope: RevertScope): RevertAsk => {
  if (scope.othersAffected.length > 0) return 'everyone';
  // Your own later work is still yours to throw away, but throwing it away is
  // not what the row appears to offer, so it is said out loud first.
  if (scope.laterChanges > 0) return 'you';
  return 'nobody';
};

const changes = (n: number): string => `${n} later change${n === 1 ? '' : 's'}`;

/** The question, phrased for whichever of the two situations this is. */
export const revertQuestion = (
  scope: RevertScope,
  label: string,
  seats: readonly string[],
): { title: string; body: string; detail: string[]; confirmLabel: string; cancelLabel: string } => {
  const others = seats.length === 0 ? 'someone else' : seats.join(' and ');
  return {
    title: scope.othersAffected.length > 0 ? 'Rewind past someone else’s work?' : 'Rewind the board?',
    body:
      scope.othersAffected.length > 0
        ? `Going back to before ${quote(label)} also discards ${changes(scope.laterChanges)}, ` +
          `and ${others} made some of them. Everyone here has to agree.`
        : `Going back to before ${quote(label)} also discards ${changes(scope.laterChanges)} ` +
          'you made after it.',
    detail: [
      'The board is put back exactly as it stood before that act.',
      'Nothing after it can be recovered afterwards.',
    ],
    confirmLabel: 'Rewind',
    cancelLabel: 'Leave it',
  };
};

/** What a row's control should say, given what it would cost. */
export const revertLabel = (scope: RevertScope): string =>
  scope.laterChanges === 0 ? 'Undo' : 'Rewind';

export const scopeOfAct = (events: readonly JournalEvent[], act: number): RevertScope =>
  revertScope(events, act, me(), myAgent());

/**
 * Ask if asking is warranted, then rewind. Resolves to whether it happened, so
 * the caller can leave the row alone when the answer was no.
 */
export const revertAct = async (
  events: readonly JournalEvent[],
  act: number,
  label: string,
  seats: readonly string[],
): Promise<boolean> => {
  const scope = scopeOfAct(events, act);
  const ask = askFor(scope);
  if (ask !== 'nobody') {
    const question = revertQuestion(scope, label, seats);
    const ok =
      ask === 'everyone'
        ? (await useConfirmStore.getState().askEveryone(question)).approved
        : await useConfirmStore.getState().request(question);
    if (!ok) return false;
  }
  return useSceneStore.getState().revertToAct(act) !== null;
};
