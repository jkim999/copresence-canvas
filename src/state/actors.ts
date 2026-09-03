import { create } from 'zustand';
import type { Actor, ActorId, ActorKind } from './types';

/**
 * Who is on this board.
 *
 * The scene stores an actor *id* on every entity, never an actor object: ids
 * are what survive a share link, a snapshot and (later) a CRDT merge, while
 * names and colours are presentation and can change under you.
 *
 * The two actors this page has always had keep the ids `human` and `agent`.
 * That is deliberate — every share link already published carries those exact
 * strings, and every provenance check in the app used to compare against them.
 * New participants get prefixed ids instead, which is what lets `kindOf` stay a
 * pure string test: the render path asks "is this the agent's work?" once per
 * note per frame and must not take a registry lookup to answer.
 */

export const LOCAL_HUMAN: ActorId = 'human';
export const LOCAL_AGENT: ActorId = 'agent';

const AGENT_PREFIX = 'a_';
const HUMAN_PREFIX = 'h_';

let counter = 0;
/**
 * The random tail is load-bearing, not decoration. A clock and a counter are
 * both per-tab, so two tabs opened together mint byte-identical ids — and two
 * peers sharing an id is exactly the failure seats exist to prevent, since the
 * grip only refuses a note held by someone *else*.
 */
const mint = (prefix: string): ActorId => {
  counter += 1;
  const noise = Math.random().toString(36).slice(2, 8);
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${noise}`;
};

export const agentId = (): ActorId => mint(AGENT_PREFIX);
export const humanId = (): ActorId => mint(HUMAN_PREFIX);

/**
 * An unknown id reads as human on purpose. Guessing "agent" would put a teal
 * provenance ring and an "agent" stamp on a note a person wrote themselves,
 * which is a worse lie than the reverse.
 */
export const kindOf = (id: ActorId): ActorKind =>
  id === LOCAL_AGENT || id.startsWith(AGENT_PREFIX) ? 'agent' : 'human';

export const isAgent = (id: ActorId): boolean => kindOf(id) === 'agent';

const localPair = (): Record<ActorId, Actor> => ({
  [LOCAL_HUMAN]: { id: LOCAL_HUMAN, kind: 'human', name: 'You', color: 'var(--human)' },
  [LOCAL_AGENT]: { id: LOCAL_AGENT, kind: 'agent', name: 'Agent', color: 'var(--agent)' },
});

/**
 * The fixed pair: terracotta for this tab's hand, teal for its agent. Every
 * frame of this page is read through that one contrast, so it does not move.
 * Other people's hues come from `seatColor`, which needs no registry — a peer
 * has to look the same on every screen, and nothing here is shared.
 */
const SEATS: Record<ActorKind, string[]> = {
  human: ['var(--human)'],
  agent: ['var(--agent)'],
};

/**
 * What other people call you.
 *
 * Every tab calls itself "You", so a name cannot travel over the wire as-is or
 * a board full of peers would all be named You. A seat name is derived from the
 * actor id instead: no coordination, no server handing out labels, and the same
 * peer reads as the same name on every screen.
 */
export const SEAT_NAMES = [
  'Cedar', 'Amber', 'Slate', 'Clover', 'Ochre', 'Juniper', 'Flint', 'Sorrel',
  'Bramble', 'Cinder', 'Damson', 'Fennel', 'Ginger', 'Hazel', 'Indigo', 'Larch',
  'Marram', 'Nettle', 'Olive', 'Pewter', 'Quince', 'Rowan', 'Saffron', 'Teasel',
  'Umber', 'Verdigris', 'Willow', 'Yarrow',
];

const hash = (text: string): number => {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h);
};

export const seatName = (id: ActorId): string => SEAT_NAMES[hash(id) % SEAT_NAMES.length];

/**
 * Hues for the other people on the board, derived the same way names are.
 *
 * Terracotta is deliberately not in here. This tab's own hand is always
 * terracotta and its agent always teal, and that pair is how every frame of
 * this page is read — so a peer must never be able to land on either, however
 * their id hashes. Everyone else is somebody else, and distinguishable from
 * each other.
 */
const PEER_COLORS = [
  'var(--seat-2)',
  'var(--seat-3)',
  'var(--seat-4)',
  'var(--seat-5)',
  'var(--seat-6)',
];

/**
 * A colour for a seat, needing no coordination: the same peer is the same
 * colour on every screen, for the same reason they are the same name.
 */
export const seatColor = (id: ActorId): string => PEER_COLORS[hash(id) % PEER_COLORS.length];

/**
 * Seat names for a set of participants, guaranteed distinct within that set.
 *
 * The name is a hash of the actor id so that it needs no coordination and reads
 * the same on every screen — which means it can collide, and with eight names
 * it collided during an ordinary two-tab test. That is not a cosmetic problem:
 * a seat name badges a peer's tool calls and is the entire content of a refusal
 * ("Ochre declined"), so two people under one name makes both of those wrong.
 *
 * A wider list makes it rare; this makes it impossible where it is read. Only a
 * contested name is modified, and the tie-break is drawn from the actor id and
 * applied in sorted order, so every tab that can see the same people labels
 * them identically.
 */
export const disambiguate = (actors: readonly ActorId[]): Record<ActorId, string> => {
  const byName = new Map<string, ActorId[]>();
  for (const id of [...actors].sort()) {
    const name = seatName(id);
    const bucket = byName.get(name);
    if (bucket) bucket.push(id);
    else byName.set(name, [id]);
  }

  const out: Record<ActorId, string> = {};
  for (const [name, ids] of byName) {
    if (ids.length === 1) {
      out[ids[0]] = name;
      continue;
    }
    ids.forEach((id, i) => {
      out[id] = `${name} ${i + 1}`;
    });
  }
  return out;
};

interface ActorState {
  actors: Record<ActorId, Actor>;
  /** the participant this browser's own edits are filed under. */
  me: ActorId;
  /** the agent acting on this browser's behalf. */
  myAgent: ActorId;

  register: (actor: Actor) => void;
  /** Register someone, choosing their colour for them. */
  join: (actor: Omit<Actor, 'color'>) => Actor;
  /** `keepAgent` seats a returning tab beside the agent it already had. */
  setMe: (id: ActorId, keepAgent?: ActorId) => void;
  nameOf: (id: ActorId) => string;
  reset: () => void;
}

export const useActorStore = create<ActorState>((set, get) => ({
  actors: localPair(),
  me: LOCAL_HUMAN,
  myAgent: LOCAL_AGENT,

  register: (actor) => set((s) => ({ actors: { ...s.actors, [actor.id]: actor } })),

  join: (actor) => {
    const taken = Object.values(get().actors).filter((a) => a.kind === actor.kind).length;
    const ramp = SEATS[actor.kind];
    const full: Actor = { ...actor, color: ramp[taken % ramp.length] };
    set((s) => ({ actors: { ...s.actors, [full.id]: full } }));
    return full;
  },

  setMe: (id, keepAgent) => {
    // A second person must not file their agent's work under the first person's
    // agent, so taking an identity mints a paired agent alongside it — unless
    // the tab is returning to a seat it already had, in which case the pair
    // returns with it. An agent filed under a new id every reload would scatter
    // one seat's work across several names in the record.
    const paired = keepAgent ?? agentId();
    set((s) => ({
      me: id,
      myAgent: paired,
      actors: {
        ...s.actors,
        [paired]: {
          id: paired,
          kind: 'agent',
          name: s.actors[id]?.name === 'You' ? 'Your agent' : `${s.actors[id]?.name ?? 'Someone'}'s agent`,
          color: SEATS.agent[0],
        },
      },
    }));
  },

  nameOf: (id) => {
    const known = get().actors[id];
    if (known) return known.name;
    // A shared board can carry work by someone who was never in this session.
    return kindOf(id) === 'agent' ? 'an agent' : 'someone';
  },

  reset: () => set({ actors: localPair(), me: LOCAL_HUMAN, myAgent: LOCAL_AGENT }),
}));

/**
 * Claim an identity of this browser's own.
 *
 * Two tabs both answering to the id `human` is not a cosmetic problem: the grip
 * asks whether a note is held by someone *else*, so two tabs sharing one id can
 * each pull a note out of the other's hand and neither is ever refused. A tab
 * that joins a room takes its own seat, and a paired agent comes with it — which
 * is the whole point of two people each bringing their own.
 */
/**
 * Where a tab keeps the seat it took, so a reload is the same person returning.
 *
 * Every load used to mint a fresh id, which left the previous one sitting in
 * the room for the full presence TTL. That is not a cosmetic ghost. Consent for
 * a whole-board change is put to everyone present and silence counts as a
 * refusal, so somebody who had reloaded twice could not reorganise their own
 * board: two earlier versions of themselves vetoed it by not answering, and the
 * refusal named them.
 *
 * sessionStorage is exactly the right scope. It survives a reload, a second tab
 * gets its own, and it dies with the tab — which is the same life a seat has.
 */
const SEAT_KEY = 'copresence.seat';

interface KeptSeat {
  human: ActorId;
  agent: ActorId;
}

const keptSeat = (): KeptSeat | null => {
  // Storage can be absent (tests, a worker) or throw outright (a browser set to
  // block site data), and neither is a reason to fail to seat somebody.
  try {
    const raw = sessionStorage?.getItem(SEAT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { human, agent } = parsed as Record<string, unknown>;
    // Validated rather than trusted: this came back from outside the program,
    // and an id of the wrong shape would seat somebody as the wrong kind.
    if (typeof human !== 'string' || !human.startsWith(HUMAN_PREFIX)) return null;
    if (typeof agent !== 'string' || !agent.startsWith(AGENT_PREFIX)) return null;
    return { human, agent };
  } catch {
    return null;
  }
};

const keepSeat = (seat: KeptSeat): void => {
  try {
    sessionStorage?.setItem(SEAT_KEY, JSON.stringify(seat));
  } catch {
    // A tab that cannot remember its seat simply takes a new one next time.
  }
};

export const takeSeat = (): ActorId => {
  const kept = keptSeat();
  const id = kept?.human ?? humanId();
  const store = useActorStore.getState();
  store.register({ id, kind: 'human', name: 'You', color: SEATS.human[0] });
  store.setMe(id, kept?.agent);
  keepSeat({ human: id, agent: useActorStore.getState().myAgent });
  return id;
};

/** Non-hook access, for the tool handlers and stores that run outside React. */
export const me = (): ActorId => useActorStore.getState().me;
export const myAgent = (): ActorId => useActorStore.getState().myAgent;
export const nameOf = (id: ActorId): string => useActorStore.getState().nameOf(id);
