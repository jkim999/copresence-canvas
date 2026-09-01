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
const mint = (prefix: string): ActorId => {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}`;
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
 * Seat colours. Today this is the load-bearing pair and nothing else, so extra
 * participants share a colour rather than borrow a hue the design system has
 * not assigned. A real ramp is a design decision that belongs with the presence
 * cursors that will need it.
 */
const SEATS: Record<ActorKind, string[]> = {
  human: ['var(--human)'],
  agent: ['var(--agent)'],
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
  setMe: (id: ActorId) => void;
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

  setMe: (id) => {
    // A second person must not file their agent's work under the first person's
    // agent, so taking an identity mints a paired agent alongside it.
    const paired = agentId();
    set((s) => ({
      me: id,
      myAgent: paired,
      actors: {
        ...s.actors,
        [paired]: {
          id: paired,
          kind: 'agent',
          name: `${s.actors[id]?.name ?? 'Someone'}'s agent`,
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

/** Non-hook access, for the tool handlers and stores that run outside React. */
export const me = (): ActorId => useActorStore.getState().me;
export const myAgent = (): ActorId => useActorStore.getState().myAgent;
export const nameOf = (id: ActorId): string => useActorStore.getState().nameOf(id);
