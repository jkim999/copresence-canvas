import { useSceneStore } from '../state/sceneStore';
import { disambiguate, kindOf, me, myAgent, seatName } from '../state/actors';
import { roomView } from '../sync/peers';
import type { ActorId, ActorKind } from '../state/types';

/**
 * Who to credit for a piece of work, by seat.
 *
 * `lastEditedBy` alone answers "person or machine", which is the only question
 * a single-agent board ever asked. On a shared board it is not enough: two
 * agents organising one canvas both reported that every node came back marked
 * `agent`, so neither could tell its own work from the other's — one resorted
 * to diffing whole scene snapshots by hand.
 *
 * A tab's human and its agent are one seat. Reporting the person's work as some
 * other participant's would have the agent deferring to its own human.
 *
 * The labels are resolved once per call and reused, because `disambiguate` has
 * to see the whole cast at once: a seat name is only distinct with respect to
 * the other seats in the room, and a name resolved note-by-note could contradict
 * itself within a single reply.
 */

export interface Credit {
  /** 'human' or 'agent' — what kind of participant made it. */
  kind: ActorKind;
  /** The name every tab on this board uses for them, including in a refusal. */
  seat: string;
  /** True when it was you, or the human you sit beside. */
  mine: boolean;
}

/**
 * The human at each seat, keyed by the agent that sits beside them.
 *
 * Without this an agent is seated by the hash of its own id, which produced the
 * bug this map exists for: one tab answered to two unrelated names at once —
 * `get_board_context` called it Indigo while `what_changed` called its agent
 * Umber. Nothing on the board connected the two, so a reader could not tell
 * that the seat proposing a reorganisation was the seat that had just moved
 * eight notes.
 *
 * A seat is the pair, not the actor. Presence already publishes both halves
 * together, which is what makes the pairing knowable at all.
 */
const seatsOf = (peers: readonly { actor: ActorId; agent: ActorId | null }[]): Map<ActorId, ActorId> => {
  const humanOf = new Map<ActorId, ActorId>([[myAgent(), me()]]);
  for (const p of peers) if (p.agent !== null) humanOf.set(p.agent, p.actor);
  return humanOf;
};

/**
 * Everyone whose name might need to appear: the pair at this seat, everyone in
 * the room, and everyone whose fingerprints are still on the board even if they
 * have since left. The last group is the reason this is not simply the peer list.
 */
const cast = (): Set<ActorId> => {
  const { scene } = useSceneStore.getState();
  const everyone = new Set<ActorId>([me(), myAgent(), ...roomView().peers.map((p) => p.actor)]);
  for (const n of scene.nodes) everyone.add(n.lastEditedBy);
  for (const e of scene.edges) everyone.add(e.lastEditedBy);
  return everyone;
};

export const crediting = (extra: readonly ActorId[] = []): ((by: ActorId) => Credit) => {
  const mine = new Set([me(), myAgent()]);
  const humanOf = seatsOf(roomView().peers);
  const everyone = cast();
  for (const id of extra) everyone.add(id);

  // Seat names are drawn over *seats*, so a pair shares one name and the
  // numbering that separates two Umbers counts seats rather than actors.
  //
  // An agent whose human is not in the room stands as its own seat rather than
  // being dropped. Filtering those out left them outside the numbering
  // entirely, so two departed agents whose ids happened to hash alike both came
  // back as "Rowan" — reintroducing, for exactly the work whose author has left
  // and can no longer be asked, the ambiguity this file exists to remove.
  const seats = [...everyone].map((id) => humanOf.get(id) ?? id);
  const label = disambiguate([...new Set(seats)]);

  return (by) => {
    const seatFor = humanOf.get(by) ?? by;
    return {
      kind: kindOf(by),
      // An agent whose human has since left the room cannot be seated with
      // them, so it keeps its own name rather than borrowing somebody else's.
      seat: label[seatFor] ?? seatName(seatFor),
      mine: mine.has(by),
    };
  };
};

/** How a seat is spoken about in a sentence, given what kind of hand it was. */
export const nameFor = (credit: Credit): string =>
  credit.kind === 'agent'
    ? credit.mine
      ? 'Your agent'
      : `${credit.seat}\u2019s agent`
    : credit.mine
      ? 'You'
      : credit.seat;
