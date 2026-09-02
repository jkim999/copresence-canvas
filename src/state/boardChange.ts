import { useConfirmStore, othersHere } from '../agent/confirm';
import { useSceneStore } from './sceneStore';
import { seatName } from './actors';

/**
 * Throwing the whole board away, with other people on it.
 *
 * Reset, import and a followed share link are all the same act as the agent's
 * whole-board reorganisation — they replace everybody's work — and they were
 * the louder problem, because they did it with no dialog at all. So they go
 * through the same gate, on the same rule: any one person can stop it.
 *
 * Alone, none of this appears. A button that asks permission of nobody is a
 * button that has learnt a nervous tic.
 */
export interface BoardChange {
  title: string;
  body: string;
  detail?: string[];
}

export const replaceBoard = async (what: BoardChange, apply: () => void): Promise<boolean> => {
  if (othersHere().length === 0) {
    apply();
    return true;
  }

  const verdict = await useConfirmStore.getState().askEveryone({
    ...what,
    confirmLabel: 'Replace it',
    cancelLabel: 'Keep this board',
  });

  if (!verdict.approved) {
    const who =
      verdict.declinedBy === 'you'
        ? 'You'
        : verdict.declinedBy !== null
          ? seatName(verdict.declinedBy)
          : null;
    useSceneStore
      .getState()
      .pushLog(
        'system',
        who !== null
          ? `${who} declined, so the board is unchanged.`
          : 'Nobody answered, so the board is unchanged.',
      );
    return false;
  }

  apply();
  return true;
};
