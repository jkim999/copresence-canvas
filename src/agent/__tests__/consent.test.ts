import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConfirmStore, setConsentTransport, type ConfirmRequest } from '../confirm';

/**
 * Consent on a board with more than one person on it.
 *
 * "Whoever answers first decides" would be a race wearing the costume of a
 * vote: the same situation resolves differently depending on who happens to be
 * looking at their screen. So the rule is asymmetric, the way it is for
 * anything destructive — one person can stop it, no one person can commit
 * everybody else.
 */

const REQUEST: ConfirmRequest = {
  title: 'Reorganise the entire board?',
  body: 'This moves everything at once.',
  confirmLabel: 'Go on',
  cancelLabel: 'Not now',
};

const asked: { id: string; req: ConfirmRequest }[] = [];
const replied: { id: string; ok: boolean }[] = [];
let present: string[] = [];

const answerHere = (ok: boolean) => useConfirmStore.getState().answer(ok);
const store = () => useConfirmStore.getState();

beforeEach(() => {
  asked.length = 0;
  replied.length = 0;
  present = [];
  setConsentTransport({
    ask: (id, req) => asked.push({ id, req }),
    reply: (id, ok) => replied.push({ id, ok }),
    peers: () => present,
  });
});

afterEach(() => {
  setConsentTransport(null);
  vi.useRealTimers();
});

describe('asking a board with nobody else on it', () => {
  it('is just this person\'s answer', async () => {
    const verdict = store().askEveryone(REQUEST);
    expect(store().pending).not.toBeNull();

    answerHere(true);

    expect(await verdict).toMatchObject({ approved: true });
  });
});

describe('asking a board with someone else on it', () => {
  it('waits for them even after this person has said yes', async () => {
    present = ['h_bo'];
    const verdict = store().askEveryone(REQUEST);
    answerHere(true);

    const settled = await Promise.race([
      verdict.then(() => 'settled'),
      new Promise((r) => setTimeout(() => r('waiting'), 40)),
    ]);

    expect(settled).toBe('waiting');
    expect(asked).toHaveLength(1);
  });

  it('goes ahead once everyone has agreed', async () => {
    present = ['h_bo'];
    const verdict = store().askEveryone(REQUEST);
    answerHere(true);
    store().receiveReply(asked[0].id, 'h_bo', true);

    expect(await verdict).toMatchObject({ approved: true });
  });

  it('stops the moment one person says no, without waiting for the rest', async () => {
    present = ['h_bo', 'h_cass'];
    const verdict = store().askEveryone(REQUEST);
    store().receiveReply(asked[0].id, 'h_bo', false);

    // Nobody else has answered, and this tab's own dialog is still open.
    expect(await verdict).toMatchObject({ approved: false, declinedBy: 'h_bo' });
  });

  it('closes this tab\'s dialog when a peer vetoes it', async () => {
    present = ['h_bo'];
    const verdict = store().askEveryone(REQUEST);
    expect(store().pending).not.toBeNull();

    store().receiveReply(asked[0].id, 'h_bo', false);
    await verdict;

    expect(store().pending).toBeNull();
  });

  it('refuses when this person says no, whatever the others think', async () => {
    present = ['h_bo'];
    const verdict = store().askEveryone(REQUEST);

    answerHere(false);

    expect(await verdict).toMatchObject({ approved: false, declinedBy: 'you' });
  });

  it('does not wait for somebody who has closed their tab', async () => {
    present = ['h_bo', 'h_cass'];
    const verdict = store().askEveryone(REQUEST);
    answerHere(true);
    store().receiveReply(asked[0].id, 'h_bo', true);

    // Cass leaves rather than answering. Waiting for an empty chair is a hang.
    present = ['h_bo'];
    store().peersChanged(present);

    expect(await verdict).toMatchObject({ approved: true });
  });

  it('refuses rather than hanging when somebody never answers', async () => {
    vi.useFakeTimers();
    present = ['h_bo'];
    const verdict = store().askEveryone(REQUEST);
    answerHere(true);

    await vi.advanceTimersByTimeAsync(11_000);

    expect(await verdict).toMatchObject({ approved: false, unanswered: ['h_bo'] });
  });

  it('ignores an answer to a question nobody asked', async () => {
    present = ['h_bo'];
    const verdict = store().askEveryone(REQUEST);
    store().receiveReply('ask_from_nowhere', 'h_bo', false);
    answerHere(true);
    store().receiveReply(asked[0].id, 'h_bo', true);

    expect(await verdict).toMatchObject({ approved: true });
  });
});

describe('being asked by somebody else', () => {
  it('shows their question and sends back the answer', () => {
    store().openRemote('ask_1', REQUEST, 'Cedar');

    expect(store().pending).toMatchObject({ id: 'ask_1', asker: 'Cedar' });

    answerHere(false);

    expect(replied).toEqual([{ id: 'ask_1', ok: false }]);
  });

  it('does not answer on the asker\'s behalf when it withdraws the question', () => {
    store().openRemote('ask_1', REQUEST, 'Cedar');

    store().closeRemote('ask_1');

    expect(store().pending).toBeNull();
    expect(replied).toEqual([]);
  });
});
