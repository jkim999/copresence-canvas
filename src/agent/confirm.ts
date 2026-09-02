import { create } from 'zustand';
import type { ActorId } from '../state/types';

/**
 * Human-in-the-loop gate for whole-board actions.
 *
 * WebMCP has no standard elicitation API today, so the page owns the
 * confirmation: the tool handler simply awaits the human's answer.
 *
 * With more than one person on the board that stops being one answer. The
 * consent rule here is deliberately asymmetric, the way it is for anything
 * destructive: **any one person can stop it, and no one person can commit
 * everybody else.** "Whoever answers first decides" was the obvious shape and
 * the wrong one — it is a race wearing the costume of a vote, resolving
 * differently depending on who happens to be looking at their screen.
 *
 * The person whose agent is acting has already consented to *something* by
 * prompting it, but not to this: the model chose a whole-board action on its
 * own. So they are asked too, rather than assumed.
 */

export interface ConfirmRequest {
  title: string;
  body: string;
  detail?: string[];
  confirmLabel: string;
  cancelLabel: string;
}

export interface Verdict {
  approved: boolean;
  /** Who refused: an actor id, or 'you' when it was this tab. */
  declinedBy: ActorId | 'you' | null;
  /** Who was still being waited on when it timed out. */
  unanswered: ActorId[];
}

/**
 * How the question reaches the other tabs. Injected rather than imported, so
 * the rule above can be tested without a wire, and so a board with no
 * connection behaves exactly as it did when there was only ever one person.
 */
export interface ConsentTransport {
  ask: (id: string, req: ConfirmRequest) => void;
  reply: (id: string, ok: boolean) => void;
  /** Actor ids of the other people on the board right now. */
  peers: () => ActorId[];
}

/**
 * Nobody is owed an unbounded wait on somebody who has walked away from their
 * desk, and a tool call that never returns is its own kind of failure.
 */
const NO_ANSWER_MS = 10_000;

let transport: ConsentTransport | null = null;
export const setConsentTransport = (t: ConsentTransport | null): void => {
  transport = t;
};

interface Outstanding {
  id: string;
  waiting: Set<ActorId>;
  answeredHere: boolean;
  settle: (v: Verdict) => void;
  timer: ReturnType<typeof setTimeout>;
}

let outstanding: Outstanding | null = null;

interface PendingDialog extends ConfirmRequest {
  id: string;
  /** The seat that asked, when the question came from another tab. */
  asker: string | null;
}

interface ConfirmState {
  pending: PendingDialog | null;
  resolve: ((ok: boolean) => void) | null;
  answer: (ok: boolean) => void;
  /** Ask this tab's human, and nobody else. */
  request: (req: ConfirmRequest) => Promise<boolean>;
  /** Ask this tab's human and everybody else on the board. */
  askEveryone: (req: ConfirmRequest) => Promise<Verdict>;
  /** Another tab is asking. */
  openRemote: (id: string, req: ConfirmRequest, asker: string) => void;
  /** Another tab's question has been settled elsewhere. */
  closeRemote: (id: string) => void;
  receiveReply: (id: string, from: ActorId, ok: boolean) => void;
  /** Who is still on the board — an empty chair is not a vote to wait for. */
  peersChanged: (present: ActorId[]) => void;
}

const newId = (): string =>
  `ask_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const useConfirmStore = create<ConfirmState>((set, get) => {
  const finish = (verdict: Verdict): void => {
    const held = outstanding;
    if (!held) return;
    outstanding = null;
    clearTimeout(held.timer);
    // Everyone else can stop looking at a question that has been answered.
    transport?.reply(held.id, verdict.approved);
    if (get().pending?.id === held.id) set({ pending: null, resolve: null });
    held.settle(verdict);
  };

  /** Approved only once this tab and every remaining peer has said yes. */
  const settleIfComplete = (): void => {
    if (!outstanding || !outstanding.answeredHere || outstanding.waiting.size > 0) return;
    finish({ approved: true, declinedBy: null, unanswered: [] });
  };

  return {
    pending: null,
    resolve: null,

    answer: (ok) => {
      const { pending, resolve } = get();
      set({ pending: null, resolve: null });
      resolve?.(ok);

      if (pending && pending.asker !== null) {
        transport?.reply(pending.id, ok);
        return;
      }
      if (!outstanding || pending?.id !== outstanding.id) return;
      if (!ok) {
        finish({ approved: false, declinedBy: 'you', unanswered: [] });
        return;
      }
      outstanding.answeredHere = true;
      settleIfComplete();
    },

    request: (req) =>
      new Promise<boolean>((resolve) => {
        get().resolve?.(false);
        set({ pending: { ...req, id: newId(), asker: null }, resolve });
      }),

    askEveryone: (req) =>
      new Promise<Verdict>((settle) => {
        const id = newId();
        const waiting = new Set(transport?.peers() ?? []);
        outstanding = {
          id,
          waiting,
          answeredHere: false,
          settle,
          timer: setTimeout(() => {
            finish({
              approved: false,
              declinedBy: null,
              unanswered: [...(outstanding?.waiting ?? [])],
            });
          }, NO_ANSWER_MS),
        };
        transport?.ask(id, req);
        get().resolve?.(false);
        set({ pending: { ...req, id, asker: null }, resolve: null });
      }),

    openRemote: (id, req, asker) => {
      get().resolve?.(false);
      set({ pending: { ...req, id, asker }, resolve: null });
    },

    closeRemote: (id) => {
      if (get().pending?.id !== id) return;
      set({ pending: null, resolve: null });
    },

    receiveReply: (id, from, ok) => {
      if (!outstanding || outstanding.id !== id) return;
      if (!ok) {
        finish({ approved: false, declinedBy: from, unanswered: [] });
        return;
      }
      outstanding.waiting.delete(from);
      settleIfComplete();
    },

    peersChanged: (presentList) => {
      if (!outstanding) return;
      const present = new Set(presentList);
      for (const actor of [...outstanding.waiting]) {
        if (!present.has(actor)) outstanding.waiting.delete(actor);
      }
      settleIfComplete();
    },
  };
});
