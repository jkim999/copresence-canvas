import * as Y from 'yjs';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';
import { leave } from './presence';

/**
 * The wire between two tabs.
 *
 * A BroadcastChannel deliberately, not a server. The whole claim of this page
 * is that no server holds the board, and the moment a room lives in someone's
 * database that claim is gone. Two tabs on one machine is a real second peer
 * with real concurrency — the same doc, the same awareness, the same merge —
 * so everything above this file is already networked; only this file would be
 * swapped to put the two peers on different machines.
 *
 * Every message is another tab's, which is to say external input. A neighbour
 * may be a different build of this app, or a broken one, or simply mid-reload,
 * and none of that is allowed to take the board down.
 */

/** Marks anything this transport applied, so it is never echoed back out. */
export const FROM_CHANNEL = Symbol('from-channel');

const DOC = 'd';
const AWARE = 'a';
const HELLO = 'h';

type Wire =
  | { t: typeof DOC; u: Uint8Array }
  | { t: typeof AWARE; u: Uint8Array }
  | { t: typeof HELLO };

export interface Session {
  room: string;
  close: () => void;
}

/** A BroadcastChannel message is structured-cloned, so shapes still need checking. */
const readWire = (data: unknown): Wire | null => {
  if (!data || typeof data !== 'object') return null;
  const { t, u } = data as Record<string, unknown>;
  if (t === HELLO) return { t: HELLO };
  if ((t === DOC || t === AWARE) && u instanceof Uint8Array && u.length > 0) {
    return { t, u } as Wire;
  }
  return null;
};

/**
 * Put `doc` and `awareness` on the air in `room`.
 *
 * Returns a `close` that says goodbye before it hangs up: a peer that vanishes
 * silently keeps its grip until awareness times it out, and a note frozen under
 * a hand that is not there is the worst failure this feature has.
 */
export const openSession = (room: string, doc: Y.Doc, awareness: Awareness): Session => {
  const channel = new BroadcastChannel(`copresence:${room}`);

  const post = (msg: Wire): void => {
    try {
      channel.postMessage(msg);
    } catch {
      // The channel is closed, or the page is being torn down. There is nobody
      // left to tell, and throwing here would take the unload handler with it.
    }
  };

  const onDoc = (update: Uint8Array, origin: unknown): void => {
    if (origin === FROM_CHANNEL) return;
    post({ t: DOC, u: update });
  };

  const onAwareness = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void => {
    if (origin === FROM_CHANNEL) return;
    // Removed clients travel too. They are the goodbye, and dropping them is
    // how a released note stays stuck on every other peer.
    post({ t: AWARE, u: encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed]) });
  };

  const onMessage = (event: MessageEvent): void => {
    const msg = readWire(event.data);
    if (!msg) return;
    try {
      if (msg.t === DOC) {
        Y.applyUpdate(doc, msg.u, FROM_CHANNEL);
      } else if (msg.t === AWARE) {
        applyAwarenessUpdate(awareness, msg.u, FROM_CHANNEL);
      } else {
        // Somebody just arrived. Hand them the whole board and everyone we can
        // see, because they have no history and no way to ask for one.
        post({ t: DOC, u: Y.encodeStateAsUpdate(doc) });
        post({ t: AWARE, u: encodeAwarenessUpdate(awareness, [...awareness.meta.keys()]) });
      }
    } catch {
      // A corrupt or mismatched update is that peer's problem, not the board's.
    }
  };

  doc.on('update', onDoc);
  awareness.on('update', onAwareness);
  channel.addEventListener('message', onMessage as EventListener);

  // Announce, then let the room catch us up.
  post({ t: HELLO });

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    // Order matters: the goodbye has to go out while the wire is still up.
    leave(awareness);
    removeAwarenessStates(awareness, [awareness.clientID], 'closed');
    doc.off('update', onDoc);
    awareness.off('update', onAwareness);
    channel.removeEventListener('message', onMessage as EventListener);
    channel.close();
  };

  return { room, close };
};

/**
 * Everyone who opens the same URL lands in the same room, and nobody has to be
 * told a room name. Two tabs of the same board are already the demo.
 */
export const roomFromLocation = (href: string): string => {
  const [base] = href.split('#');
  return base;
};
