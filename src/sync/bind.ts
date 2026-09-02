import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import type { ActorId, Scene } from '../state/types';
import { useSceneStore } from '../state/sceneStore';
import { me, myAgent, seatName, takeSeat } from '../state/actors';
import { ORIGIN_LOCAL, collections, readScene, writeScene } from './doc';
import { holdsOf, peersOf, publish, readPresence, type Cursor, type Presence } from './presence';
import { setPeerCursors, setPeers } from './peers';
import { openSession, roomFromLocation, type Session } from './channel';

/**
 * Wiring the store to the wire.
 *
 * Three loops meet here and all three would spin forever if left alone:
 * the store writes the doc, the doc writes the store, and the grip goes out to
 * awareness while awareness comes back as the grip. Each direction is therefore
 * gated on *what actually changed* rather than on the fact that something did.
 * Origin tagging catches the first, a re-entrancy flag the second, and a value
 * comparison the third — a flag alone cannot stop the grip loop, because
 * awareness fires on every heartbeat whether or not the state differs.
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
  publish(broadcasting, { actor: me(), name: seatName(me()), cursor });
};

export const connectBoard = (options: ConnectOptions = {}): Connection => {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  const room = options.room ?? roomFromLocation(globalThis.location?.href ?? 'local');
  const session: Session = openSession(room, doc, awareness);

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
      return;
    }
    if (!oldestSeat()) return;
    // Nobody was here and nobody older is waiting. This tab's board is the room's.
    writeScene(doc, useSceneStore.getState().scene, ORIGIN_LOCAL);
    live = true;
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
  const impostor = (p: Presence): boolean => p.actor === me() || p.actor === myAgent();

  const pullPresence = (): void => {
    const others = peersOf(awareness).filter((p) => !impostor(p));
    setPeers(others);
    setPeerCursors(others);
    const mine = readPresence(awareness.getLocalState());
    const next = holdsOf(mine ? [mine, ...others] : others);
    considerAdoption();
    if (sameGrip(useSceneStore.getState().grip, next)) return;
    useSceneStore.setState({ grip: next });
  };
  // `change`, not `update`: awareness heartbeats every few seconds and only
  // `change` means somebody's state actually differs.
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
    const holding = [...new Set([...(claims[me()] ?? []), ...(claims[myAgent()] ?? [])])].sort();
    if (sameIds(holding, published)) return;
    published = holding;
    publish(awareness, { actor: me(), name: seatName(me()), holding });
  };

  const unsubscribe = useSceneStore.subscribe((state, prev) => {
    if (applying) return;
    if (live && state.scene !== prev.scene) writeScene(doc, state.scene, ORIGIN_LOCAL);
    if (state.claims !== prev.claims) pushGrip();
  });

  // A tab that keeps the default `human` id cannot be told apart from any other
  // tab, and the grip only refuses a note held by someone *else*.
  takeSeat();

  // Be visible to the room straight away, board or no board.
  publish(awareness, { actor: me(), name: seatName(me()) });
  broadcasting = awareness;

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
    doc.off('update', onDoc);
    awareness.off('change', pullPresence);
    // Says goodbye on the way out, which is what frees anything still in hand.
    session.close();
    if (broadcasting === awareness) broadcasting = null;
    setPeers([]);
    setPeerCursors([]);
    awareness.destroy();
    doc.destroy();
    globalThis.removeEventListener?.('beforeunload', stop);
  };

  // A closed tab must not leave a note frozen under a hand that has gone.
  globalThis.addEventListener?.('beforeunload', stop);

  return { room, doc, awareness, stop };
};
