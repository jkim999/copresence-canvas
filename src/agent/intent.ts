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
}

export const useIntentStore = create<IntentState>(() => ({ mine: null }));

export const currentIntent = (): Intent | null => useIntentStore.getState().mine;

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
  useIntentStore.setState({ mine });
  try {
    return await run();
  } finally {
    // Only ever retract our own. An act that started while this one was
    // settling has already replaced it, and clearing that would hide work
    // which is genuinely still running.
    if (useIntentStore.getState().mine === mine) useIntentStore.setState({ mine: null });
  }
};

/** The announcement as a sentence. Present continuous: this has not happened yet. */
export const describeIntent = (intent: Intent, name: string | null): string =>
  `${name ?? 'Someone'} is ${intent.verb} ${intent.what}`;
