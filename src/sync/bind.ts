import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import type { ActorId, Scene } from '../state/types';
import { useSceneStore } from '../state/sceneStore';
import { me, myAgent, nameOf } from '../state/actors';
import { ORIGIN_LOCAL, collections, readScene, writeScene } from './doc';
import { holdsFrom, publish } from './presence';
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

export const connectBoard = (options: ConnectOptions = {}): Connection => {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  const room = options.room ?? roomFromLocation(globalThis.location?.href ?? 'local');
  const session: Session = openSession(room, doc, awareness);

  /** True while a remote change is being written into the store. */
  let applying = false;
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

  const onDoc = (_update: Uint8Array, origin: unknown): void => {
    // Our own write is already in the store by definition.
    if (origin === ORIGIN_LOCAL) return;
    pullScene();
  };
  doc.on('update', onDoc);

  // --- awareness -> store ---------------------------------------------------

  const pullGrip = (): void => {
    const next = holdsFrom(awareness);
    if (sameGrip(useSceneStore.getState().grip, next)) return;
    useSceneStore.setState({ grip: next });
  };
  // `change`, not `update`: awareness heartbeats every few seconds and only
  // `change` means somebody's state actually differs.
  awareness.on('change', pullGrip);

  // --- store -> doc and awareness -------------------------------------------

  const pushGrip = (): void => {
    const { grip } = useSceneStore.getState();
    const mine = new Set([me(), myAgent()]);
    const holding = Object.entries(grip)
      .filter(([, holder]) => mine.has(holder))
      .map(([nodeId]) => nodeId)
      .sort();
    if (sameIds(holding, published)) return;
    published = holding;
    publish(awareness, { actor: me(), name: nameOf(me()), holding });
  };

  const unsubscribe = useSceneStore.subscribe((state, prev) => {
    if (applying) return;
    if (live && state.scene !== prev.scene) writeScene(doc, state.scene, ORIGIN_LOCAL);
    if (state.grip !== prev.grip) pushGrip();
  });

  // Be visible to the room straight away, board or no board.
  publish(awareness, { actor: me(), name: nameOf(me()) });

  const grace = setTimeout(() => {
    if (collections(doc).nodes.size === 0) {
      // Nobody was here. This tab's board becomes the room's board.
      writeScene(doc, useSceneStore.getState().scene, ORIGIN_LOCAL);
    } else {
      pullScene();
    }
    live = true;
  }, options.graceMs ?? GRACE_MS);

  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    clearTimeout(grace);
    unsubscribe();
    doc.off('update', onDoc);
    awareness.off('change', pullGrip);
    // Says goodbye on the way out, which is what frees anything still in hand.
    session.close();
    awareness.destroy();
    doc.destroy();
    globalThis.removeEventListener?.('beforeunload', stop);
  };

  // A closed tab must not leave a note frozen under a hand that has gone.
  globalThis.addEventListener?.('beforeunload', stop);

  return { room, doc, awareness, stop };
};
