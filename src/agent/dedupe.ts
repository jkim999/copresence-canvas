import type { ActorId, SceneNode } from '../state/types';

/**
 * The guard against a stutter.
 *
 * A tool call that moves anything is paced by an animation, and a throttled
 * background tab stretches that pacing to tens of seconds. A caller watching a
 * client-side timeout expire concludes the call was lost and sends it again. It
 * was not lost. Both copies land.
 *
 * So the page decides, rather than trusting the caller to be careful: text this
 * same agent wrote moments ago is treated as the same note, not a second one.
 * The window is short and the ownership test is strict, because the failure
 * being prevented is a stutter — never a person and an agent independently
 * arriving at the same words, and never a deliberate repetition later on.
 */

/** How recently this agent must have written the same text for it to be a retry. */
export const REPEAT_WINDOW_MS = 60_000;

export interface Repeat {
  text: string;
  /** The note already on the board that this would have duplicated. */
  existingId: string;
}

export interface Split {
  fresh: string[];
  repeats: Repeat[];
}

type Existing = Pick<SceneNode, 'id' | 'text' | 'lastEditedBy' | 'editedAt'>;

const key = (text: string): string => text.trim();

export const splitRepeats = (
  texts: string[],
  nodes: readonly Existing[],
  by: ActorId,
  now: number,
  windowMs: number = REPEAT_WINDOW_MS,
): Split => {
  // Only this agent's own recent work can shadow a write. A peer reaching the
  // same phrasing is their note, and dropping it would lose their work.
  const mine = new Map<string, string>();
  for (const n of nodes) {
    if (n.lastEditedBy !== by) continue;
    if (now - n.editedAt > windowMs) continue;
    if (!mine.has(key(n.text))) mine.set(key(n.text), n.id);
  }

  const fresh: string[] = [];
  const repeats: Repeat[] = [];
  // Consumed as we go, so one call asking for the same text twice still writes
  // both: an explicit instruction is not a stutter.
  for (const text of texts) {
    const hit = mine.get(key(text));
    if (hit === undefined) {
      fresh.push(text);
      continue;
    }
    mine.delete(key(text));
    repeats.push({ text, existingId: hit });
  }

  return { fresh, repeats };
};
