import { describe, expect, it } from 'vitest';
import { beatFor, type Standing } from './firstRun';

const standing = (over: Partial<Standing> = {}): Standing => ({
  step: 'idle',
  changes: 0,
  calls: 0,
  connected: false,
  peers: 0,
  ...over,
});

describe('what the first-time visitor is being told', () => {
  it('opens by offering the act', () => {
    expect(beatFor(standing())).toBe('watch');
  });

  it('says nothing to a board somebody has already worked on', () => {
    expect(beatFor(standing({ changes: 3 }))).toBe('gone');
    expect(beatFor(standing({ calls: 1 }))).toBe('gone');
    expect(beatFor(standing({ connected: true }))).toBe('gone');
    expect(beatFor(standing({ step: 'dismissed' }))).toBe('gone');
  });

  // The bug this file exists for: the one instruction that carries the product
  // used to be on screen only while nothing was happening, and vanished on the
  // click that started the act — shown exclusively when it could not be followed.
  it('keeps the instruction up for exactly as long as it can be followed', () => {
    const mid = standing({ step: 'running', changes: 7, calls: 1 });
    expect(beatFor(mid)).toBe('drag');
  });

  it('offers the other half of the argument once the act is over', () => {
    expect(beatFor(standing({ step: 'ran', changes: 7, calls: 1 }))).toBe('second');
  });

  it('does not invite a second person into a room that has one', () => {
    expect(beatFor(standing({ step: 'ran', peers: 1 }))).toBe('gone');
  });

  it('lets the visitor out at every beat', () => {
    expect(beatFor(standing({ step: 'dismissed', changes: 7 }))).toBe('gone');
  });
});
