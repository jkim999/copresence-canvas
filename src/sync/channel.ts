import * as Y from 'yjs';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';
import { leave } from './presence';
import type { ConfirmRequest } from '../agent/confirm';
import type { ActorId } from '../state/types';

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
const ASK = 'k';
const REPLY = 'r';

/** Capped hard: a peer's dialog text is rendered on *this* person's screen. */
const MAX_TEXT = 400;
const MAX_DETAIL = 12;

type Wire =
  | { t: typeof DOC; u: Uint8Array }
  | { t: typeof AWARE; u: Uint8Array }
  | { t: typeof HELLO }
  | { t: typeof ASK; id: string; from: ActorId; name: string; req: ConfirmRequest }
  | { t: typeof REPLY; id: string; from: ActorId; ok: boolean };

export interface ConsentHandlers {
  onAsk: (id: string, req: ConfirmRequest, from: ActorId, name: string) => void;
  onReply: (id: string, from: ActorId, ok: boolean) => void;
}

export interface Session {
  room: string;
  ask: (id: string, from: ActorId, name: string, req: ConfirmRequest) => void;
  reply: (id: string, from: ActorId, ok: boolean) => void;
  close: () => void;
}

const text = (v: unknown, fallback: string): string =>
  typeof v === 'string' && v.length > 0 ? v.slice(0, MAX_TEXT) : fallback;

/**
 * A question from another tab is drawn as a modal on this person's screen, so
 * it is validated and clamped like any other external input — a peer running a
 * different build must not be able to put unbounded text in front of anyone.
 */
const readRequest = (v: unknown): ConfirmRequest | null => {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (typeof r.title !== 'string' || typeof r.body !== 'string') return null;
  return {
    title: text(r.title, 'A whole-board change'),
    body: text(r.body, 'Another agent wants to change this board.'),
    detail: Array.isArray(r.detail)
      ? r.detail.filter((d): d is string => typeof d === 'string').slice(0, MAX_DETAIL).map((d) => d.slice(0, MAX_TEXT))
      : undefined,
    confirmLabel: text(r.confirmLabel, 'Allow'),
    cancelLabel: text(r.cancelLabel, 'Not now'),
  };
};

/** A BroadcastChannel message is structured-cloned, so shapes still need checking. */
const readWire = (data: unknown): Wire | null => {
  if (!data || typeof data !== 'object') return null;
  const { t, u } = data as Record<string, unknown>;
  if (t === HELLO) return { t: HELLO };
  if (t === ASK || t === REPLY) {
    const { id, from } = data as Record<string, unknown>;
    if (typeof id !== 'string' || id.length === 0 || id.length > 64) return null;
    if (typeof from !== 'string' || from.length === 0 || from.length > 64) return null;
    if (t === REPLY) {
      const { ok } = data as Record<string, unknown>;
      return typeof ok === 'boolean' ? { t: REPLY, id, from, ok } : null;
    }
    const { req, name } = data as Record<string, unknown>;
    const parsed = readRequest(req);
    return parsed ? { t: ASK, id, from, name: text(name, 'Someone'), req: parsed } : null;
  }
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
export const openSession = (
  room: string,
  doc: Y.Doc,
  awareness: Awareness,
  consent?: ConsentHandlers,
): Session => {
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
      } else if (msg.t === ASK) {
        consent?.onAsk(msg.id, msg.req, msg.from, msg.name);
      } else if (msg.t === REPLY) {
        consent?.onReply(msg.id, msg.from, msg.ok);
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

  return {
    room,
    ask: (id, from, name, req) => post({ t: ASK, id, from, name, req }),
    reply: (id, from, ok) => post({ t: REPLY, id, from, ok }),
    close,
  };
};

/**
 * Everyone who opens the same URL lands in the same room, and nobody has to be
 * told a room name. Two tabs of the same board are already the demo.
 */
export const roomFromLocation = (href: string): string => {
  const [base] = href.split('#');
  return base;
};
