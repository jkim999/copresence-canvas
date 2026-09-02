import { beforeEach, describe, expect, it } from 'vitest';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import {
  announce,
  currentIntent,
  describeIntent,
  useIntentStore,
} from '../intent';
import { publish, readPresence } from '../../sync/presence';

beforeEach(() => useIntentStore.setState({ mine: null }));

const arranging = { verb: 'arranging', what: '8 notes into a timeline', ids: ['n1', 'n2'] };

describe('announce', () => {
  it('says what it is about to do before it starts doing it', async () => {
    const seen: (string | null)[] = [];
    await announce(arranging, async () => {
      seen.push(currentIntent()?.what ?? null);
    });
    expect(seen).toEqual(['8 notes into a timeline']);
  });

  it('stamps the announcement so a reader can tell a stale one', async () => {
    const before = Date.now();
    let at = 0;
    await announce(arranging, async () => {
      at = currentIntent()?.at ?? 0;
    });
    expect(at).toBeGreaterThanOrEqual(before);
  });

  it('takes the announcement down when the work is done', async () => {
    await announce(arranging, async () => undefined);
    expect(currentIntent()).toBeNull();
  });

  it('takes it down when the work fails, so a crash cannot leave a lie standing', async () => {
    await expect(
      announce(arranging, async () => {
        throw new Error('no such note');
      }),
    ).rejects.toThrow('no such note');
    expect(currentIntent()).toBeNull();
  });

  it('returns whatever the work returned', async () => {
    await expect(announce(arranging, async () => ({ moved: 3 }))).resolves.toEqual({ moved: 3 });
  });

  it('does not let a finished call clear an announcement that is no longer its own', async () => {
    let inner: Promise<void> | null = null;
    await announce(arranging, async () => {
      // A second act declared while the first is settling: the first must not
      // take the second's announcement down on its way out.
      inner = announce({ verb: 'linking', what: '3 pairs', ids: [] }, async () => {
        await Promise.resolve();
      });
    });
    await inner;
    expect(currentIntent()).toBeNull();
  });
});

describe('describeIntent', () => {
  it('reads as a sentence about the future, not the past', () => {
    const intent = { ...arranging, at: Date.now() };
    expect(describeIntent(intent, 'Ochre')).toBe('Ochre is arranging 8 notes into a timeline');
  });

  it('says who when nobody is named', () => {
    const intent = { ...arranging, at: Date.now() };
    expect(describeIntent(intent, null)).toBe('Someone is arranging 8 notes into a timeline');
  });
});

describe('an announcement on the wire', () => {
  const room = () => {
    const doc = new Y.Doc();
    return new Awareness(doc);
  };

  it('travels with the rest of a peer state', () => {
    const awareness = room();
    const intent = { ...arranging, at: 1000 };
    publish(awareness, { actor: 'h_1', doing: intent });
    expect(readPresence(awareness.getLocalState())?.doing).toEqual(intent);
  });

  it('is dropped when a peer sends a shape that is not one', () => {
    const awareness = room();
    awareness.setLocalState({ actor: 'h_1', doing: { verb: 42 } });
    expect(readPresence(awareness.getLocalState())?.doing).toBeNull();
  });

  it('is clamped, because a peer draws this sentence on your screen', () => {
    const awareness = room();
    awareness.setLocalState({
      actor: 'h_1',
      doing: { verb: 'x'.repeat(500), what: 'y'.repeat(500), ids: [], at: 1000 },
    });
    const doing = readPresence(awareness.getLocalState())?.doing;
    expect(doing?.verb.length).toBeLessThanOrEqual(64);
    expect(doing?.what.length).toBeLessThanOrEqual(120);
  });

  it('is absent, not invented, when a peer says nothing about it', () => {
    const awareness = room();
    publish(awareness, { actor: 'h_1' });
    expect(readPresence(awareness.getLocalState())?.doing).toBeNull();
  });
});
