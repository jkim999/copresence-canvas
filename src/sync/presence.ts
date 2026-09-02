import type { Awareness } from 'y-protocols/awareness';
import type { ActorId, Intent } from '../state/types';
import { LOCAL_HUMAN, isAgent } from '../state/actors';

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
 * minute is a long time to stare at a note you cannot move, so that timeout is
 * enforced *here*, at read time, rather than left to the sweep inside
 * y-protocols — because that sweep is an interval, and an interval does not run
 * in a tab nobody is looking at. See `stillHere`.
 *
 * Everything arriving here is another tab, which may be running a different
 * build of this app or a broken one, so a peer state is validated exactly like
 * any other external input before the board is allowed to believe it.
 */

/** No hand holds more than a board's worth of notes. */
export const MAX_IDS = 300;
const MAX_NAME = 64;
const MAX_ACTOR = 64;
/** A peer's announcement is drawn on *this* person's screen, so it is clamped. */
const MAX_VERB = 64;
const MAX_WHAT = 120;

export interface Cursor {
  x: number;
  y: number;
}

/**
 * One tab, but two hands, and they do not rank the same.
 *
 * The person and the agent paired with them share a screen and a wire, so a
 * peer state has to name both — publishing them under one actor sends the
 * agent's own claim back attributed to the human, and the agent then politely
 * yields to what it takes for a person and is in fact itself.
 */
export interface Presence {
  actor: ActorId;
  name: string;
  holding: string[];
  /** This tab's agent, when it has one. */
  agent: ActorId | null;
  agentHolding: string[];
  selected: string[];
  cursor: Cursor | null;
  /**
   * What this seat's agent is about to do, while it is doing it.
   *
   * Ephemeral on purpose. A tab that crashes mid-arrange stops heartbeating and
   * its announcement dies with it, which is the only way a promise about the
   * next two seconds can be safely believed by anybody else.
   */
  doing: Intent | null;
}

/** Every hand in one peer state, each under the actor that owns it. */
export const handsOf = (p: Presence): { actor: ActorId; ids: string[] }[] =>
  p.agent === null
    ? [{ actor: p.actor, ids: p.holding }]
    : [
        { actor: p.actor, ids: p.holding },
        { actor: p.agent, ids: p.agentHolding },
      ];

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

/**
 * A peer's announcement, validated like any other external input. A missing or
 * malformed one reads as "not saying", never as a fabricated act: an invented
 * intent would have a peer's agent politely working around nothing.
 */
const intentOf = (v: unknown): Intent | null => {
  if (!v || typeof v !== 'object') return null;
  const { verb, what, ids: raw, at } = v as Record<string, unknown>;
  if (typeof verb !== 'string' || verb.length === 0) return null;
  if (typeof what !== 'string') return null;
  return {
    verb: verb.slice(0, MAX_VERB),
    what: what.slice(0, MAX_WHAT),
    ids: ids(raw),
    at: typeof at === 'number' && Number.isFinite(at) ? at : 0,
  };
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
    agent:
      typeof r.agent === 'string' && r.agent.length > 0 && r.agent.length <= MAX_ACTOR
        ? r.agent
        : null,
    agentHolding: ids(r.agentHolding),
    selected: ids(r.selected),
    cursor: cursorOf(r.cursor),
    doing: intentOf(r.doing),
  };
};

/**
 * How long a silent client stays in the room.
 *
 * This has to be read against the *worst-case* heartbeat, not the nominal one.
 * Awareness re-announces every 15s, but a browser throttles timers in a hidden
 * tab — to 1Hz immediately, and after five minutes hidden to roughly once a
 * minute. A tab driven by an agent is hidden essentially all the time, so the
 * interval between two announcements from a perfectly healthy peer routinely
 * exceeds a minute.
 *
 * y-protocols' own 30s `outdatedTimeout` is therefore too short here, and
 * matching it was a mistake worth naming: it dropped peers that were alive and
 * merely quiet, which made the grip fail *open* — the page would hand you a
 * note somebody else was holding. A ghost that lingers is a nuisance; a
 * refusal that stops refusing is the product breaking.
 *
 * So the timeout is generous, and it only ever governs the crash path: a tab
 * that closes properly says goodbye and its notes come free at once.
 */
export const PRESENCE_TTL_MS = 90_000;

/**
 * Whether a client has been heard from recently enough to still count.
 *
 * Awareness does keep its own sweep, but it runs on an interval, and a browser
 * throttles timers in a hidden tab — to once a second, and after five minutes
 * to once a minute. A background tab therefore keeps a crashed peer in the room
 * long past its TTL and goes on refusing the notes in its dead hands.
 *
 * So the question is answered at read time instead. No timer has to have fired
 * for the answer to be right, which means it is right in a throttled tab, in a
 * frozen tab, and on the first read after the tab wakes up.
 */
const stillHere = (awareness: Awareness, clientId: number, now: number): boolean => {
  // You are self-evidently present. Timing yourself out would empty the room of
  // the one person certainly in it.
  if (clientId === awareness.clientID) return true;
  const meta = awareness.meta.get(clientId);
  // No metadata means no basis to judge, and hiding a peer we cannot judge is
  // the more damaging guess: it would hand their held notes to somebody else.
  if (meta === undefined) return true;
  return now - meta.lastUpdated <= PRESENCE_TTL_MS;
};

const statesOf = (
  awareness: Awareness,
  skipLocal: boolean,
  now: number = Date.now(),
): Presence[] => {
  const out: Presence[] = [];
  awareness.getStates().forEach((raw, clientId) => {
    if (skipLocal && clientId === awareness.clientID) return;
    if (!stillHere(awareness, clientId, now)) return;
    const p = readPresence(raw);
    if (p) out.push(p);
  });
  return out;
};

/**
 * The clients worth telling a newcomer about.
 *
 * Not `meta.keys()`, which is every client ever seen. `applyAwarenessUpdate`
 * stamps whatever it receives as heard-from *now*, so relaying an ancient entry
 * resurrects it on the far side — and with two tabs each catching the other up,
 * a peer that left half an hour ago never dies. It also holds a vote it can
 * never cast, which is enough to time out every whole-board change.
 *
 * A goodbye still has to travel: a tab that has just left is absent from its own
 * states but present in meta with a *recent* timestamp, and that message is what
 * frees the notes it was holding. So the filter is recency, not presence.
 */
export const liveClients = (awareness: Awareness, now: number = Date.now()): number[] => {
  const out: number[] = [];
  awareness.meta.forEach((meta, clientId) => {
    if (clientId === awareness.clientID || now - meta.lastUpdated <= PRESENCE_TTL_MS) {
      out.push(clientId);
    }
  });
  return out;
};

/**
 * How long ago the most recently heard-from peer was heard, which is the age of
 * the freshest evidence that anybody else is still there.
 */
export const heardAgoMs = (awareness: Awareness, now: number = Date.now()): number => {
  let freshest = Infinity;
  awareness.getStates().forEach((_raw, clientId) => {
    if (clientId === awareness.clientID) return;
    const meta = awareness.meta.get(clientId);
    if (meta === undefined) return;
    freshest = Math.min(freshest, now - meta.lastUpdated);
  });
  return freshest;
};

/** Everyone but you. */
export const peersOf = (awareness: Awareness, now?: number): Presence[] =>
  statesOf(awareness, true, now);

/** Everyone, you included. */
export const everyoneOn = (awareness: Awareness, now?: number): Presence[] =>
  statesOf(awareness, false, now);

// --- folding many hands into one map ---------------------------------------

/**
 * Who wins when two hands close on the same note in the same instant.
 *
 * A person outranks a machine, which is the rule the canvas already promises
 * out loud — an agent's grip must never be what stops someone dragging. The
 * ids cannot carry that rule on their own, since every agent id begins `a_`
 * and every human `h_`, so it is stated here. Between two of a kind there is
 * no rank and the lowest id decides: arbitrary, but the same answer on every
 * peer, which is the only property that matters. If they disagreed, each tab
 * would think it owned the note and both would move it.
 */
const outranks = (challenger: ActorId, holder: ActorId): boolean => {
  const machine = isAgent(challenger);
  if (machine !== isAgent(holder)) return !machine;
  return challenger < holder;
};

const claim = (
  states: Presence[],
  pick: (p: Presence) => { actor: ActorId; ids: string[] }[],
): Record<string, ActorId> => {
  const out: Record<string, ActorId> = {};
  for (const p of states) {
    for (const hand of pick(p)) {
      for (const id of hand.ids) {
        const held = out[id];
        if (held === undefined || outranks(hand.actor, held)) out[id] = hand.actor;
      }
    }
  }
  return out;
};

/** Who is holding which note, across every peer on the board. */
/** Resolve holds from an already-assembled list of states. */
export const holdsOf = (states: Presence[]): Record<string, ActorId> => claim(states, handsOf);

export const holdsFrom = (awareness: Awareness): Record<string, ActorId> =>
  holdsOf(everyoneOn(awareness));

/**
 * Who has which note selected. Selection is a hand's business, not the board's.
 *
 * Resolved the same way holds are, and for the same reason: two people can
 * point at one note, and every tab has to draw the same answer or the board
 * disagrees with itself about who is looking at what. Unlike a hold, this
 * forbids nothing — it is only ever shown.
 */
export const selectionsOf = (states: Presence[]): Record<string, ActorId> =>
  claim(states, (p) => [{ actor: p.actor, ids: p.selected }]);

export const selectionsFrom = (awareness: Awareness): Record<string, ActorId> =>
  selectionsOf(everyoneOn(awareness));

// --- writing ---------------------------------------------------------------

const BLANK: Presence = {
  actor: LOCAL_HUMAN,
  name: 'You',
  holding: [],
  agent: null,
  agentHolding: [],
  selected: [],
  cursor: null,
  doing: null,
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
