import { describe, expect, it } from 'vitest';
import { paceFrom, MIN_PACE, MAX_PACE } from '../pace';

describe('demo pacing', () => {
  it('runs at true speed when nothing asks otherwise', () => {
    expect(paceFrom('')).toBe(1);
    expect(paceFrom('?foo=bar')).toBe(1);
  });

  it('stretches every duration by the factor asked for', () => {
    expect(paceFrom('?pace=2')).toBe(2);
    expect(paceFrom('?pace=2.5')).toBe(2.5);
  });

  // A recording knob reachable from the address bar is also reachable by
  // accident, and a board that takes a minute to move one note reads as broken.
  it('clamps a factor that would stall or blur the board', () => {
    expect(paceFrom('?pace=99')).toBe(MAX_PACE);
    expect(paceFrom('?pace=0.01')).toBe(MIN_PACE);
  });

  it('ignores anything that is not a number', () => {
    expect(paceFrom('?pace=slow')).toBe(1);
    expect(paceFrom('?pace=')).toBe(1);
    expect(paceFrom('?pace=NaN')).toBe(1);
  });
});
