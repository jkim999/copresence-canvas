import { create } from 'zustand';
import type { Intent } from '../state/types';

/**
 * What is about to happen, said before it happens.
 *
 * The board was legible about the past and the present — a ledger of calls, a
 * labelled cursor, a journal of changes — and silent about the next two
 * seconds. That silence is what makes a shared canvas feel hostile: notes begin
 * sliding under your hands with no warning, and the only action that ever
 * announced itself in advance was the one whole-board change that puts up a
 * dialog. Everything smaller simply happened to you.
 *
 * So every agent act declares itself first, in one sentence, and takes the
 * declaration down when it is finished. The declaration goes out over awareness
 * with the rest of this tab's presence, which means it is ephemeral by
 * construction: a tab that crashes mid-arrange stops heartbeating, and its
 * announcement dies with it rather than hanging over the board forever.
 *
 * It serves both audiences from one source. The human reads it as a sentence
 * above the canvas; a peer's agent reads the same field on `get_board_context`
 * and can decide to work somewhere else instead of colliding.
 */

interface IntentState {
  /** This tab's agent's current announcement, or nothing when it is idle. */
  mine: Intent | null;
  /**
   * Set when the human has called the running act off, and cleared with the
   * announcement it belongs to. Objecting to one act is not a standing
   * objection: the next act is one nobody has yet had a chance to see.
   */
  stopping: boolean;
}

export const useIntentStore = create<IntentState>(() => ({ mine: null, stopping: false }));

export const currentIntent = (): Intent | null => useIntentStore.getState().mine;

/**
 * Call the running act off.
 *
 * Cooperative, not an abort. A note mid-flight is finished rather than dropped
 * where it happens to be, so whatever is on the board when this lands is an
 * arrangement somebody chose — and the grip the agent holds is released the way
 * it always is, by the tween ending, rather than needing a second path that
 * could leave a note claimed by an actor that has stopped.
 *
 * Only this tab's own agent can be called off. Reaching across the wire to halt
 * somebody else's agent is a different power with a different rule about who
 * may use it, and it is not going to be smuggled in behind a button that reads
 * as "stop mine".
 */
export const requestStop = (): void => {
  if (useIntentStore.getState().mine === null) return;
  useIntentStore.setState({ stopping: true });
};

/** Whether the human has asked the act now running to stop. */
export const stopRequested = (): boolean => useIntentStore.getState().stopping;

/**
 * Declare an act, do it, then take the declaration down — including when the
 * act throws, because an announcement that outlives its work is worse than no
 * announcement at all: it tells everyone to keep clear of a board that is idle.
 */
export const announce = async <T>(
  what: Omit<Intent, 'at'>,
  run: () => Promise<T>,
): Promise<T> => {
  const mine: Intent = { ...what, at: Date.now() };
  useIntentStore.setState({ mine, stopping: false });
  try {
    return await run();
  } finally {
    // Only ever retract our own. An act that started while this one was
    // settling has already replaced it, and clearing that would hide work
    // which is genuinely still running.
    if (useIntentStore.getState().mine === mine) {
      useIntentStore.setState({ mine: null, stopping: false });
    }
  }
};

/** The announcement as a sentence. Present continuous: this has not happened yet. */
export const describeIntent = (intent: Intent, name: string | null): string =>
  `${name ?? 'Someone'} is ${intent.verb} ${intent.what}`;
