import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { replaceBoard } from '../boardChange';
import { setConsentTransport, useConfirmStore } from '../../agent/confirm';
import { useSceneStore } from '../sceneStore';

/**
 * Reset, import and a followed share link all throw away the board — for
 * everyone on it, not just the person who clicked. Alone, that is an ordinary
 * button and must stay one; with somebody else on the board it is the same
 * whole-board change an agent has to ask about, so it asks.
 */

let present: string[] = [];
const store = () => useSceneStore.getState();

const WHAT = { title: 'Reset the board?', body: 'Everything goes back to the start.' };

beforeEach(() => {
  present = [];
  setConsentTransport({ ask: () => {}, reply: () => {}, peers: () => present });
});

afterEach(() => setConsentTransport(null));

describe('replacing the board when nobody else is here', () => {
  it('just does it, with no dialog in the way', async () => {
    let applied = false;

    const done = await replaceBoard(WHAT, () => {
      applied = true;
    });

    expect(applied).toBe(true);
    expect(done).toBe(true);
    expect(useConfirmStore.getState().pending).toBeNull();
  });
});

describe('replacing the board when somebody else is', () => {
  it('asks before throwing away their work', async () => {
    present = ['h_bo'];
    let applied = false;
    const done = replaceBoard(WHAT, () => {
      applied = true;
    });

    const id = useConfirmStore.getState().pending!.id;
    expect(applied).toBe(false);

    useConfirmStore.getState().answer(true);
    useConfirmStore.getState().receiveReply(id, 'h_bo', true);

    await done;
    expect(applied).toBe(true);
  });

  it('leaves the board alone when they say no', async () => {
    present = ['h_bo'];
    let applied = false;
    const done = replaceBoard(WHAT, () => {
      applied = true;
    });
    const id = useConfirmStore.getState().pending!.id;

    useConfirmStore.getState().receiveReply(id, 'h_bo', false);

    expect(await done).toBe(false);
    expect(applied).toBe(false);
    expect(store().log[store().log.length - 1].text).toContain('declined');
  });
});
