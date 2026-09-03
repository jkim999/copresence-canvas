import { beforeEach, describe, expect, it } from 'vitest';
import { crediting } from '../credit';
import { useSceneStore } from '../../state/sceneStore';
import { LOCAL_HUMAN, me, seatName, takeSeat } from '../../state/actors';
import { setRoomSource } from '../../sync/peers';

/**
 * `seatName('human')` is Amber, and every note on the seeded board is authored
 * by that legacy id — so a board nobody had touched yet carried a participant
 * called Amber who did not exist. When a real seat's id happened to hash to
 * Amber as well, the two were told apart the way two real people would be, and
 * the roster read "Amber 1" and "Amber 2" on a board with one person on it.
 *
 * The starting board is not somebody's work. It is the material everyone
 * begins from, and it should be credited as such rather than to a ghost.
 */

beforeEach(() => {
  setRoomSource(null);
  takeSeat();
  useSceneStore.getState().resetScene();
});

describe('the seeded board', () => {
  it('is not credited to a participant', () => {
    const credit = crediting();
    expect(credit(LOCAL_HUMAN).seat).not.toBe(seatName(LOCAL_HUMAN));
    expect(credit(LOCAL_HUMAN).mine).toBe(false);
  });

  it('does not number a live seat against a ghost that shares its name', () => {
    const credit = crediting();
    // Whatever this seat is called, it is called that plainly — no ordinal,
    // because there is only one of them in the room.
    expect(credit(me()).seat).not.toMatch(/\s\d+$/);
  });

  it('still names a real departed author, who is a person and did do the work', () => {
    const ghost = 'h_someone_who_left';
    useSceneStore.getState().addNode({ text: 'theirs', x: 0, y: 0 }, ghost);
    expect(crediting()(ghost).seat).toBe(seatName(ghost));
  });
});
