import { describe, expect, it } from 'vitest';
import { BEATS, roleFrom, type BeatId } from '../autopilot';

describe('demo role', () => {
  it('reads the role off the query string', () => {
    expect(roleFrom('?demo=a')).toBe('a');
    expect(roleFrom('?demo=b')).toBe('b');
  });

  it('treats a bare ?demo as the director', () => {
    expect(roleFrom('?demo')).toBe('a');
    expect(roleFrom('?demo=')).toBe('a');
  });

  it('is off unless asked for', () => {
    expect(roleFrom('')).toBeNull();
    expect(roleFrom('?pace=2')).toBeNull();
  });

  it('does not seat a nonsense role', () => {
    expect(roleFrom('?demo=c')).toBeNull();
  });
});

describe('the beats', () => {
  const ids = BEATS.map((b) => b.id);

  it('runs in the order the video is cut in', () => {
    expect(ids).toEqual<BeatId[]>(['opening', 'hand', 'reality', 'veto', 'approve']);
  });

  it('gives every beat a title the operator can read off a button', () => {
    for (const beat of BEATS) expect(beat.title.length).toBeGreaterThan(0);
  });

  it('gives every beat a half for each seat, so neither tab is idle by accident', () => {
    for (const beat of BEATS) {
      expect(typeof beat.a).toBe('function');
      expect(typeof beat.b).toBe('function');
    }
  });
});

