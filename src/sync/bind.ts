import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import type { ActorId, Scene } from '../state/types';
import { useSceneStore } from '../state/sceneStore';
import { me, myAgent, seatName, takeSeat } from '../state/actors';
import { ORIGIN_LOCAL, collections, readScene, writeScene } from './doc';
import {
  heardAgoMs,
  holdsOf,
  peersOf,
  publish,
  readPresence,
  type Cursor,
  type Presence,
} from './presence';
import { setPeerCursors, setPeers, setRoomSource } from './peers';
import { clearPendingShare, shareWasDisplaced } from '../data/pendingShare';
import { openSession, roomFromLocation, type Session } from './channel';
import { setConsentTransport, useConfirmStore } from '../agent/confirm';
import { useIntentStore } from '../agent/intent';
import { resetJournal } from '../state/journal';
import { completeRemoteCall, recordRemoteCall, setCallTransport } from '../agent/webmcp';

/**
 * Wiring the store to the wire.
 *
 * Three loops meet here and all three would spin forever if left alone:
 * the store writes the doc, the doc writes the store, and the grip goes out to
 * awareness while awareness comes back as the grip. Each direction is therefore
 * gated on *what actually changed* rather than on the fact that something did.
 * Origin tagging catches the first, a re-entrancy flag the second, and a value
 * comparison the third — the grip is compared by value before it is published,
 * so a heartbeat that changed nothing never becomes an outgoing write.
 */

/**
 * How long a fresh tab waits to find out whether the room already has a board.
 *
 * Without this, the second tab pushes its own seed scene into a document that
 * already holds the first tab's, and since the two seeds were minted with
 * different ids the merge keeps both — you open a second tab and the board
 * doubles. So a new tab stays quiet until it has heard back, then either adopts
 * what it found or, finding nothing, seeds the room itself.
 */
const GRACE_MS = 250;

/**
 * How long the store may run ahead of the wire.
 *
 * An agent animating notes writes the scene on every animation frame, and each
 * write used to be a message, and each message a whole-scene read, repair and
 * store write on the receiving side. Measured on a 28-note board: while one tab
 * animated, a read-only tool call in the other went from about 15ms to roughly
 * six seconds. Frames are coalesced instead — the board is still the board a
 * frame or two later, and nothing is ever dropped, only merged.
 */
const PUSH_MS = 40;

export interface Connection {
  room: string;
  doc: Y.Doc;
  awareness: Awareness;
  stop: () => void;
}

export interface ConnectOptions {
  room?: string;
  graceMs?: number;
}

/**
 * Selection is one person's business, not the board's.
 *
 * It is already absent from the document — `writeScene` never sends it — but a
 * scene read back out of the doc carries `selected: false` on every note, so
 * applying a peer's edit would silently clear what you had picked, and the next
 * Backspace would find nothing. The local value wins on the way in.
 */
const keepSelection = (incoming: Scene, current: Scene): Scene => {
  const selected = new Set(current.nodes.filter((n) => n.selected).map((n) => n.id));
  return {
    ...incoming,
    nodes: incoming.nodes.map((n) =>
      n.selected === selected.has(n.id) ? n : { ...n, selected: selected.has(n.id) },
    ),
  };
};

const sameIds = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

const sameGrip = (a: Record<string, ActorId>, b: Record<string, ActorId>): boolean => {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
};

/**
 * The connection the pointer handlers talk to.
 *
 * A DOM handler has no way to reach into a closure, and a pointer event can
 * easily outlive teardown by a frame, so reporting into a dead connection has
 * to be a no-op rather than a throw on its way up through React.
 */
let broadcasting: Awareness | null = null;

/** Tell the room where this tab's pointer is, in flow coordinates. */
export const reportCursor = (cursor: Cursor | null): void => {
  if (!broadcasting) return;
  publish(broadcasting, { actor: me(), name: seatName(me()), agent: myAgent(), cursor });
};

export const connectBoard = (options: ConnectOptions = {}): Connection => {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  const room = options.room ?? roomFromLocation(globalThis.location?.href ?? 'local');
  const session: Session = openSession(room, doc, awareness, {
    onAsk: (id, req, _from, name) => useConfirmStore.getState().openRemote(id, req, name),
    onReply: (id, from, ok) => {
      // A reply addressed to a question this tab did not ask is the asker
      // telling the room the question is over.
      useConfirmStore.getState().receiveReply(id, from, ok);
      useConfirmStore.getState().closeRemote(id);
    },
  }, {
    onCallStart: (c) => recordRemoteCall(c),
    onCallEnd: (id, out, err) => completeRemoteCall(id, out, err),
  });

  /** True while a remote change is being written into the store. */
  let applying = false;
  /** True once this tab has waited long enough to know whose room this is. */
  let graced = false;
  /** The store does not push until this tab knows whose board this room is. */
  let live = false;
  let published: string[] = [];

  // --- doc -> store ---------------------------------------------------------

  const pullScene = (): void => {
    applying = true;
    try {
      const current = useSceneStore.getState().scene;
      useSceneStore.setState({ scene: keepSelection(readScene(doc), current) });
    } finally {
      applying = false;
    }
  };

  /**
   * Whether this tab holds the oldest seat in the room.
   *
   * Deciding "seed or adopt" on an empty document alone let two tabs opened
   * together both seed, and a board whose ids are not the fixed demo ones came
   * back merged — every note twice. Client ids are already unique and already
   * known to everyone, so the oldest seat seeds and the rest wait.
   */
  const oldestSeat = (): boolean => {
    for (const id of awareness.getStates().keys()) if (id < awareness.clientID) return false;
    return true;
  };

  /**
   * Settle whose board this room holds. Re-run whenever that could have
   * changed — a board arriving, or the seat above this one leaving — rather
   * than only once on a timer that cannot know either.
   */
  const considerAdoption = (): void => {
    if (!graced || live) return;
    if (collections(doc).nodes.size > 0) {
      pullScene();
      live = true;
      // Adopting the room's board is not a change to it. Diffed against the
      // seed this tab was about to discard, it reads as every note on the board
      // having just been written — an account of arriving, dressed up as an
      // account of what happened. Nobody can be told what happened before they
      // got here, so the record starts now.
      resetJournal();
      // Adopting is the safe answer — nobody's work is overwritten by somebody
      // opening a link — but a board that came in a link is not thrown away for
      // it. It waits, and is offered.
      shareWasDisplaced();
      return;
    }
    if (!oldestSeat()) return;
    // Nobody was here and nobody older is waiting. This tab's board is the room's.
    writeScene(doc, useSceneStore.getState().scene, ORIGIN_LOCAL);
    live = true;
    clearPendingShare();
  };

  const onDoc = (_update: Uint8Array, origin: unknown): void => {
    // Our own write is already in the store by definition.
    if (origin === ORIGIN_LOCAL) return;
    pullScene();
    considerAdoption();
  };
  doc.on('update', onDoc);

  // --- awareness -> store ---------------------------------------------------

  /**
   * A peer declaring one of *this* tab's actor ids is not believed. Presence
   * validates shape but not identity, and a state wearing this tab's name would
   * otherwise be folded into what this tab republishes as its own hands.
   */
  const impostor = (p: Presence): boolean =>
    p.actor === me() || p.actor === myAgent() || p.agent === me() || p.agent === myAgent();

  const pullPresence = (): void => {
    const others = peersOf(awareness).filter((p) => !impostor(p));
    setPeers(others);
    setPeerCursors(others);
    // Nobody waits on an empty chair for a question they will never answer.
    useConfirmStore.getState().peersChanged(others.map((p) => p.actor));
    const mine = readPresence(awareness.getLocalState());
    const next = holdsOf(mine ? [mine, ...others] : others);
    considerAdoption();
    if (sameGrip(useSceneStore.getState().grip, next)) return;
    useSceneStore.setState({ grip: next });
  };
  // `change`, not `update`: awareness heartbeats every few seconds and only
  // `change` means somebody's state actually differs.
  // Anything that must not decide on stale membership reads through this.
  setRoomSource(() => ({ peers: peersOf(awareness), heardAgoMs: heardAgoMs(awareness) }));

  awareness.on('change', pullPresence);

  // --- store -> doc and awareness -------------------------------------------

  /**
   * Published from what this tab's hands are *asking for*, never from the
   * resolved map. Deriving it from the resolution meant losing a simultaneous
   * grab also retracted the claim, so the loser never contended again — finger
   * still down, note free, nobody holding it.
   */
  const pushGrip = (): void => {
    const { claims } = useSceneStore.getState();
    const holding = [...(claims[me()] ?? [])].sort();
    const agentHolding = [...(claims[myAgent()] ?? [])].sort();
    // Both hands, so the comparison covers both.
    const signature = [...holding, '|', ...agentHolding];
    if (sameIds(signature, published)) return;
    published = signature;
    publish(awareness, {
      actor: me(),
      name: seatName(me()),
      holding,
      agent: myAgent(),
      agentHolding,
    });
  };

  /**
   * What this tab's agent is about to do, out to the room before it does it.
   *
   * Separate from `pushGrip` because it changes on a different clock: a grip
   * opens and closes with a hand, an announcement brackets a whole act. Sharing
   * one subscription would publish each on the other's schedule.
   */
  const pushIntent = (): void => {
    publish(awareness, { doing: useIntentStore.getState().mine });
  };

  const unwatchIntent = useIntentStore.subscribe((state, prev) => {
    if (state.mine !== prev.mine) pushIntent();
  });

  let pushTimer: ReturnType<typeof setTimeout> | undefined;

  const flushScene = (): void => {
    if (pushTimer === undefined) return;
    clearTimeout(pushTimer);
    pushTimer = undefined;
    writeScene(doc, useSceneStore.getState().scene, ORIGIN_LOCAL);
  };

  const schedulePush = (): void => {
    if (pushTimer !== undefined) return;
    pushTimer = setTimeout(() => {
      pushTimer = undefined;
      writeScene(doc, useSceneStore.getState().scene, ORIGIN_LOCAL);
    }, PUSH_MS);
  };

  const unsubscribe = useSceneStore.subscribe((state, prev) => {
    if (applying) return;
    if (live && state.scene !== prev.scene) schedulePush();
    // A hand closing or opening is not a frame of animation, and waiting on it
    // is what lets two people grab the same note.
    if (state.claims !== prev.claims) pushGrip();
  });

  // A tab that keeps the default `human` id cannot be told apart from any other
  // tab, and the grip only refuses a note held by someone *else*.
  takeSeat();

  // Be visible to the room straight away, board or no board.
  publish(awareness, { actor: me(), name: seatName(me()), agent: myAgent() });
  broadcasting = awareness;

  // A whole-board change is everyone's business, so the question goes to
  // everyone. Injected rather than imported so a board with no connection
  // behaves exactly as it did when there was only ever one person on it.
  setConsentTransport({
    ask: (id, req) => session.ask(id, me(), seatName(me()), req),
    reply: (id, ok) => session.reply(id, me(), ok),
    // Live, not cached: a seat that has left must not keep a vote it cannot cast.
    peers: () => peersOf(awareness).map((p) => p.actor),
  });

  // The ledger is the evidence that a model decided something. Kept per-browser
  // it could not show the one thing this shape is for: two agents, one board.
  setCallTransport({
    started: (c) => session.callStart(c, me(), seatName(me())),
    finished: (c) => session.callEnd(c.id, me(), c.out, c.error),
  });

  const grace = setTimeout(() => {
    graced = true;
    considerAdoption();
  }, options.graceMs ?? GRACE_MS);

  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    clearTimeout(grace);
    unsubscribe();
    unwatchIntent();
    // Whatever was still coalescing belongs to the board, not to this tab.
    if (live) flushScene();
    doc.off('update', onDoc);
    awareness.off('change', pullPresence);
    // Says goodbye on the way out, which is what frees anything still in hand.
    session.close();
    setConsentTransport(null);
    setCallTransport(null);
    if (broadcasting === awareness) broadcasting = null;
    setPeers([]);
    setRoomSource(null);
    setPeerCursors([]);
    awareness.destroy();
    doc.destroy();
    globalThis.removeEventListener?.('beforeunload', stop);
  };

  // A closed tab must not leave a note frozen under a hand that has gone.
  globalThis.addEventListener?.('beforeunload', stop);

  return { room, doc, awareness, stop };
};
