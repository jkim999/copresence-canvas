import { beforeEach, describe, expect, it } from 'vitest';
import { dropAllHands, hands, releaseHand, takeHand } from '../hands';
import { useSceneStore } from '../sceneStore';
import { me, takeSeat } from '../actors';

beforeEach(() => {
  dropAllHands();
  useSceneStore.getState().clearGrip();
  takeSeat();
});

const grip = () => useSceneStore.getState().grip;

describe('hands', () => {
  it('grips a note taken by one hand', () => {
    takeHand('drag', 'n1');
    expect(grip().n1).toBe(me());
  });

  it('keeps a dragged note held while a different note is being typed in', () => {
    takeHand('drag', 'n1');
    takeHand('edit', 'n2');
    expect(grip().n1).toBe(me());
    expect(grip().n2).toBe(me());
  });

  it('does not let one hand letting go drop what the other still holds', () => {
    takeHand('drag', 'n1');
    takeHand('edit', 'n2');
    releaseHand('edit', 'n2');
    expect(grip().n1).toBe(me());
    expect(grip().n2).toBeUndefined();
  });

  it('holds a note claimed by both hands until both let go', () => {
    takeHand('drag', 'n1');
    takeHand('edit', 'n1');
    releaseHand('drag', 'n1');
    expect(grip().n1).toBe(me());
    releaseHand('edit', 'n1');
    expect(grip().n1).toBeUndefined();
  });

  it('reports what this tab is holding, for the tools that must answer that', () => {
    takeHand('edit', 'n5');
    expect(hands()).toEqual(['n5']);
  });

  it('is unmoved by releasing something never held', () => {
    takeHand('drag', 'n1');
    releaseHand('edit', 'n9');
    expect(grip().n1).toBe(me());
  });
});
