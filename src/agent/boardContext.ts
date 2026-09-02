import { roomView } from '../sync/peers';
import { useSceneStore } from '../state/sceneStore';
import { me, myAgent } from '../state/actors';
import { crediting } from './credit';
import { PRESENCE_TTL_MS } from '../sync/presence';
import { describeIntent } from './intent';
import type { ActorId, Intent } from '../state/types';

/**
 * The answer to "who am I, and who else is here".
 *
 * This exists because two agents were put on one board and neither could find
 * out. Both fell back to scraping the page for their own seat name and at least
 * one of them read the wrong element and believed it for the rest of its run.
 * An agent that is wrong about its own identity cannot reason about provenance,
 * cannot interpret a refusal, and cannot tell its own work from a peer's.
 *
 * It is also the only place that resolves a seat name to a participant. A
 * refusal comes back as "Ochre declined" — a sentence an agent can repeat but,
 * until now, could not understand.
 */

export interface Participant {
  /** The name every tab on this board uses for them, including in a refusal. */
  seat: string;
  actor: ActorId;
  /** Notes in their hand right now. Not yours to move. */
  holding: string[];
  /**
   * Notes they have selected — what they are pointing at, rather than holding.
   *
   * Unlike `holding` this forbids nothing. It is the answer to the word people
   * actually use on a canvas: someone says "these ones", or "tidy this up", and
   * means whatever is lit under their cursor. Without it that sentence resolves
   * to the whole board and you have to guess which part of it they meant.
   */
  selected: string[];
  /** Whether they have an agent of their own working beside them. */
  hasAgent: boolean;
  /**
   * What their agent announced it was about to do, if it is mid-act.
   *
   * This is the only forward-looking field on the board. Everything else here
   * describes a state; this one describes an intention, which is what lets you
   * choose a different part of the canvas instead of discovering the collision
   * afterwards. It is `null` far more often than not — an idle seat, a seat
   * with no agent, or a peer running a build that does not announce.
   */
  doing: { verb: string; what: string; ids: string[]; sentence: string } | null;
}

export interface Pacing {
  /**
   * `null` where there is no document to ask — an unknown answer, said out
   * loud, rather than a confident `true` that would teach the wrong lesson.
   */
  pageVisible: boolean | null;
  note: string;
}

/**
 * Why a call that normally takes a second can take thirty.
 *
 * Every tool that moves a note waits on an animation, and a browser suspends
 * animation frames in a tab nobody is looking at. The page has a watchdog that
 * steps the clock anyway, so the call always finishes — but its remaining
 * timers are throttled to about 1Hz and it finishes *slowly*.
 *
 * Both test agents hit this and neither could see it. One concluded there was
 * "a race in whatever mutex serializes writes to the shared doc"; the other
 * inferred "some server-side queue". There is no mutex and there is no server.
 * They invented mechanisms because the page gave them no true one, and then
 * retried on a theory — which is how a board ends up with three copies of the
 * same note.
 */
export const pacing = (): Pacing => {
  const visible =
    typeof document === 'undefined' ? null : document.visibilityState === 'visible';

  const slow =
    'This tab is in the background, so the browser has throttled its timers. Anything ' +
    'that moves a note is paced by an animation and will take far longer than usual — ' +
    'tens of seconds rather than one. The call has not failed and it has not been ' +
    'dropped; it is still running and it will finish. Wait for it. Do not retry: these ' +
    'tools are not idempotent and a retry adds a second copy of the work.';

  const fine =
    'Anything that moves a note is paced by an animation the human can watch and ' +
    'interrupt, so calls take about a second longer than the edit itself needs. That is ' +
    'deliberate. Do not retry a call that has not come back yet.';

  return { pageVisible: visible, note: visible === false ? slow : fine };
};

export interface BoardContext {
  you: {
    seat: string;
    actor: ActorId;
    agent: ActorId;
    /** What your own human has selected. This is what "these" means. */
    selected: string[];
  };
  others: Participant[];
  alone: boolean;
  /** How long ago this room was last confirmed, in seconds. */
  peersConfirmedSecondsAgo: number;
  consent: string;
  pacing: Pacing;
  note: string;
}

/** What this tab's own human has lit up right now. */
const mySelection = (): string[] =>
  useSceneStore
    .getState()
    .scene.nodes.filter((n) => n.selected)
    .map((n) => n.id);

/**
 * Said only when there is a selection, and said plainly.
 *
 * A field the model never reads is the same as a field that does not exist, and
 * "these ones" is the phrase this whole thing was added for. It earns a
 * sentence exactly when it has content.
 */
const pointing = (n: number): string =>
  n === 0
    ? ''
    : ` Your human currently has ${n} note${n === 1 ? '' : 's'} selected, listed under ` +
      '`you.selected`. When they say "these", "this lot" or "what I have selected", that ' +
      'is what they mean — use those ids rather than guessing from the text of the board.';

export const boardContext = (): BoardContext => {
  const { peers, heardAgoMs } = roomView();
  const confirmedAgo = Number.isFinite(heardAgoMs) ? Math.round(heardAgoMs / 1000) : 0;
  // Past a peer TTL the list is a cache, not an observation, and saying so is
  // the difference between an agent that hedges and one that is confidently
  // wrong about who is in the room.
  const trustworthy = confirmedAgo * 1000 <= PRESENCE_TTL_MS;

  // Named through the same function every human surface uses, rather than a
  // second numbering of its own.
  //
  // A seat name is the entire content of a refusal — "Ochre declined" — and the
  // agent is expected to resolve it against this list. Numbering here over the
  // room alone while the ledger, the history and the notes numbered over
  // everyone who has touched the board meant a colleague was "Nettle 2" on
  // every surface a person looks at and plain "Nettle" in the one an agent
  // reads. Two live tabs and one selected note showed all three at once.
  const credit = crediting();
  const label = (actor: ActorId): string => credit(actor).seat;

  const announcing = (seat: string, doing: Intent | null): Participant['doing'] =>
    doing === null
      ? null
      : {
          verb: doing.verb,
          what: doing.what,
          ids: [...doing.ids],
          sentence: describeIntent(doing, seat),
        };

  const others = peers.map((p): Participant => {
    const seat = label(p.actor);
    return {
      seat,
      actor: p.actor,
      holding: [...p.holding],
      selected: [...p.selected],
      hasAgent: p.agent !== null,
      doing: announcing(seat, p.doing),
    };
  });

  const alone = others.length === 0;
  const names = others.map((o) => o.seat);
  const staleWarning = trustworthy
    ? ''
    : ` This room was last confirmed ${confirmedAgo}s ago, which is longer than a peer's ` +
      'time-to-live, so treat this list as stale: someone shown here may have left, and ' +
      'someone not shown may have arrived. It goes stale because a background tab has its ' +
      'timers throttled. Re-read this before relying on it.';

  return {
    you: {
      seat: label(me()),
      actor: me(),
      agent: myAgent(),
      selected: mySelection(),
    },
    others,
    alone,
    consent: alone
      ? 'You are the only participant, so a whole-board change needs only this human’s ' +
        'approval.'
      : `A whole-board change is put to everyone here — you and ${names.join(', ')}. It ` +
        'proceeds only if all of them approve, any single refusal stops it, and silence ' +
        'for ten seconds counts as a refusal.',
    peersConfirmedSecondsAgo: confirmedAgo,
    pacing: pacing(),
    note:
      (alone
      ? 'You and one human share this board. Nobody else is connected.'
      : `${others.length} other ${others.length === 1 ? 'person is' : 'people are'} on this ` +
        'board right now, each possibly with an agent of their own. Notes listed under ' +
        '`holding` are in someone else’s hand: the page will refuse to move them, and that ' +
        'refusal is the design working, not an error to route around. When a result names a ' +
        'seat, it is one of the seats listed here. A seat with a `doing` is mid-act right ' +
        'now: those notes are about to move, so pick somewhere else rather than racing it.') +
      pointing(mySelection().length) +
      staleWarning,
  };
};
