import { roomView } from '../sync/peers';
import { disambiguate, me, myAgent, seatName } from '../state/actors';
import { PRESENCE_TTL_MS } from '../sync/presence';
import type { ActorId } from '../state/types';

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
  /** Whether they have an agent of their own working beside them. */
  hasAgent: boolean;
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
  you: { seat: string; actor: ActorId; agent: ActorId };
  others: Participant[];
  alone: boolean;
  /** How long ago this room was last confirmed, in seconds. */
  peersConfirmedSecondsAgo: number;
  consent: string;
  pacing: Pacing;
  note: string;
}

export const boardContext = (): BoardContext => {
  const { peers, heardAgoMs } = roomView();
  const confirmedAgo = Number.isFinite(heardAgoMs) ? Math.round(heardAgoMs / 1000) : 0;
  // Past a peer TTL the list is a cache, not an observation, and saying so is
  // the difference between an agent that hedges and one that is confidently
  // wrong about who is in the room.
  const trustworthy = confirmedAgo * 1000 <= PRESENCE_TTL_MS;

  // Distinct within this room. A seat name is the whole content of a refusal,
  // so two participants under one name would make it unreadable.
  const label = disambiguate([me(), ...peers.map((p) => p.actor)]);

  const others = peers.map(
    (p): Participant => ({
      seat: label[p.actor] ?? seatName(p.actor),
      actor: p.actor,
      holding: [...p.holding],
      hasAgent: p.agent !== null,
    }),
  );

  const alone = others.length === 0;
  const names = others.map((o) => o.seat);
  const staleWarning = trustworthy
    ? ''
    : ` This room was last confirmed ${confirmedAgo}s ago, which is longer than a peer's ` +
      'time-to-live, so treat this list as stale: someone shown here may have left, and ' +
      'someone not shown may have arrived. It goes stale because a background tab has its ' +
      'timers throttled. Re-read this before relying on it.';

  return {
    you: { seat: label[me()] ?? seatName(me()), actor: me(), agent: myAgent() },
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
        'seat, it is one of the seats listed here.') + staleWarning,
  };
};
