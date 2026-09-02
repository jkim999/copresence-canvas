import type { Awareness } from 'y-protocols/awareness';
import type { ActorId } from '../state/types';
import { LOCAL_HUMAN } from '../state/actors';

/**
 * Who is here, what they have hold of, and where their pointer is.
 *
 * None of this belongs in the document. A grip is a claim about a pair of
 * hands, not a fact about the board: it has to vanish the moment those hands
 * leave, and a CRDT never forgets anything. Yjs awareness is the right home —
 * it is ephemeral by construction, and every peer drops a client that stops
 * heartbeating. That drop *is* the grip TTL, which is why there is no timer in
 * this file.
 *
 * Two paths, and they are worth telling apart. A tab that closes normally says
 * goodbye on the way out (see `channel.ts`), so its notes come free at once. A
 * tab that is force-quit, crashed or discarded says nothing, and its notes stay
 * held until awareness times the client out — up to 30 seconds, fixed in
 * `y-protocols` as a module constant with no per-instance override. Half a
 * minute is a long time to stare at a note you cannot move, and the honest fix
 * is a heartbeat of our own rather than a comment implying it is instant.
 *
 * Everything arriving here is another tab, which may be running a different
 * build of this app or a broken one, so a peer state is validated exactly like
 * any other external input before the board is allowed to believe it.
 */

/** No hand holds more than a board's worth of notes. */
export const MAX_IDS = 300;
const MAX_NAME = 64;
const MAX_ACTOR = 64;

export interface Cursor {
  x: number;
  y: number;
}

export interface Presence {
  actor: ActorId;
  name: string;
  holding: string[];
  selected: string[];
  cursor: Cursor | null;
}

// --- reading ---------------------------------------------------------------

const ids = (v: unknown): string[] => {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of v) {
    if (typeof item !== 'string' || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length === MAX_IDS) break;
  }
  return out;
};

const cursorOf = (v: unknown): Cursor | null => {
  if (!v || typeof v !== 'object') return null;
  const { x, y } = v as Record<string, unknown>;
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
};

export const readPresence = (raw: unknown): Presence | null => {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  // Without an actor there is nobody to attribute a hold to, so the state is
  // not merely incomplete — it is unusable.
  if (typeof r.actor !== 'string' || r.actor.length === 0 || r.actor.length > MAX_ACTOR) return null;
  return {
    actor: r.actor,
    name: typeof r.name === 'string' ? r.name.slice(0, MAX_NAME) : 'someone',
    holding: ids(r.holding),
    selected: ids(r.selected),
    cursor: cursorOf(r.cursor),
  };
};

const statesOf = (awareness: Awareness, skipLocal: boolean): Presence[] => {
  const out: Presence[] = [];
  awareness.getStates().forEach((raw, clientId) => {
    if (skipLocal && clientId === awareness.clientID) return;
    const p = readPresence(raw);
    if (p) out.push(p);
  });
  return out;
};

/** Everyone but you. */
export const peersOf = (awareness: Awareness): Presence[] => statesOf(awareness, true);

/** Everyone, you included. */
export const everyoneOn = (awareness: Awareness): Presence[] => statesOf(awareness, false);

// --- folding many hands into one map ---------------------------------------

const claim = (states: Presence[], pick: (p: Presence) => string[]): Record<string, ActorId> => {
  const out: Record<string, ActorId> = {};
  for (const p of states) {
    for (const id of pick(p)) {
      const held = out[id];
      // Two peers can reach for the same note in the same instant, and there is
      // no clock that orders them. Lowest actor id wins: arbitrary, but the
      // same answer on every peer, which is the only property that matters. If
      // they disagreed, each tab would think it owned the note and both would
      // move it.
      if (held === undefined || p.actor < held) out[id] = p.actor;
    }
  }
  return out;
};

/** Who is holding which note, across every peer on the board. */
/** Resolve holds from an already-assembled list of states. */
export const holdsOf = (states: Presence[]): Record<string, ActorId> =>
  claim(states, (p) => p.holding);

export const holdsFrom = (awareness: Awareness): Record<string, ActorId> =>
  claim(everyoneOn(awareness), (p) => p.holding);

/** Who has which note selected. Selection is a hand's business, not the board's. */
export const selectionsFrom = (awareness: Awareness): Record<string, ActorId> =>
  claim(everyoneOn(awareness), (p) => p.selected);

// --- writing ---------------------------------------------------------------

const BLANK: Presence = {
  actor: LOCAL_HUMAN,
  name: 'You',
  holding: [],
  selected: [],
  cursor: null,
};

/**
 * Patch this peer's own state. Awareness replaces state wholesale, so a caller
 * updating only the cursor would otherwise drop its own grip.
 */
export const publish = (awareness: Awareness, patch: Partial<Presence>): Presence => {
  const next = { ...(readPresence(awareness.getLocalState()) ?? BLANK), ...patch };
  awareness.setLocalState(next);
  return next;
};

/** Say goodbye properly, so peers do not wait out the timeout to free your notes. */
export const leave = (awareness: Awareness): void => awareness.setLocalState(null);
