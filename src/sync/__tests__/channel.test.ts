import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { openSession, roomFromLocation, type Session } from '../channel';
import { holdsFrom, peersOf, publish } from '../presence';
import { readScene, writeScene } from '../doc';
import { humanId } from '../../state/actors';
import type { Scene, SceneNode } from '../../state/types';

/**
 * Two tabs, one room. These are the same scenarios as doc.test.ts, but going
 * through the actual wire instead of a hand-written `sync()` — which is where
 * echo loops, missed goodbyes and late joiners live.
 */

const ALEX = humanId();
const BO = humanId();

/** BroadcastChannel delivers on a later tick, so every assertion waits a turn. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

let rooms = 0;
const open: Session[] = [];

interface Peer {
  doc: Y.Doc;
  awareness: Awareness;
  session: Session;
}

const join = (room: string): Peer => {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  const session = openSession(room, doc, awareness);
  open.push(session);
  return { doc, awareness, session };
};

const newRoom = (): string => `test-${(rooms += 1)}-${Math.random().toString(36).slice(2)}`;

afterEach(() => {
  for (const s of open.splice(0)) s.close();
});

const node = (id: string, over: Partial<SceneNode> = {}): SceneNode => ({
  id, text: `text ${id}`, x: 0, y: 0, w: 176, h: 84, color: '#faf1e8',
  cluster: null, kind: 'idea', lastEditedBy: ALEX, editedAt: 0, selected: false, ...over,
});

const board = (nodes: SceneNode[]): Scene => ({ nodes, edges: [], annotations: [], regions: [] });

describe('a board across two tabs', () => {
  it('carries an edit from one tab to the other', async () => {
    const room = newRoom();
    const a = join(room);
    const b = join(room);
    await settle();

    writeScene(a.doc, board([node('n_0', { x: 40 })]));
    await settle();

    expect(readScene(b.doc).nodes.map((n) => n.id)).toEqual(['n_0']);
    expect(readScene(b.doc).nodes[0].x).toBe(40);
  });

  it('carries edits both ways at once', async () => {
    const room = newRoom();
    const a = join(room);
    const b = join(room);
    writeScene(a.doc, board([node('n_0'), node('n_1')]));
    await settle();

    writeScene(a.doc, board([node('n_0', { x: 100 }), node('n_1')]));
    writeScene(b.doc, board([node('n_0'), node('n_1', { y: 250 })]));
    await settle();

    for (const peer of [a, b]) {
      const s = readScene(peer.doc);
      expect(s.nodes.find((n) => n.id === 'n_0')!.x).toBe(100);
      expect(s.nodes.find((n) => n.id === 'n_1')!.y).toBe(250);
    }
  });

  it('does not echo what it received', async () => {
    // The failure this prevents is not cosmetic: a tab that rebroadcasts what
    // it was just told puts two tabs into a loop that never settles.
    const room = newRoom();
    const a = join(room);
    join(room);
    await settle();

    const spy = new BroadcastChannel(`copresence:${room}`);
    let seen = 0;
    spy.addEventListener('message', () => { seen += 1; });

    writeScene(a.doc, board([node('n_0')]));
    await settle();
    await settle();
    spy.close();

    // Exactly one message: A's own update. B stayed quiet.
    expect(seen).toBe(1);
  });

  it('hands a whole board to a tab that arrives late', async () => {
    const room = newRoom();
    const a = join(room);
    writeScene(a.doc, board([node('n_0'), node('n_1')]));
    await settle();

    const late = join(room);
    await settle();

    expect(readScene(late.doc).nodes.map((n) => n.id)).toEqual(['n_0', 'n_1']);
  });

  it('keeps rooms apart', async () => {
    const a = join(newRoom());
    const b = join(newRoom());
    await settle();

    writeScene(a.doc, board([node('n_0')]));
    await settle();

    expect(readScene(b.doc).nodes).toHaveLength(0);
  });

  it('shrugs off nonsense on the wire', async () => {
    const room = newRoom();
    const a = join(room);
    const b = join(room);
    await settle();

    const heckler = new BroadcastChannel(`copresence:${room}`);
    heckler.postMessage({ t: 'd', u: new Uint8Array([9, 9, 9, 9]) });
    heckler.postMessage({ t: 'nope' });
    heckler.postMessage('hello?');
    heckler.postMessage(null);
    await settle();
    heckler.close();

    // Still a working board afterwards.
    writeScene(a.doc, board([node('n_0')]));
    await settle();
    expect(readScene(b.doc).nodes.map((n) => n.id)).toEqual(['n_0']);
  });
});

describe('hands across two tabs', () => {
  it('shows one tab what the other is holding', async () => {
    const room = newRoom();
    const a = join(room);
    const b = join(room);
    publish(a.awareness, { actor: ALEX, name: 'Alex' });
    publish(b.awareness, { actor: BO, name: 'Bo' });
    await settle();

    expect(peersOf(b.awareness).map((p) => p.name)).toEqual(['Alex']);

    publish(a.awareness, { holding: ['n_0'] });
    await settle();

    expect(holdsFrom(b.awareness)).toEqual({ n_0: ALEX });
  });

  it('frees a held note when the other tab closes', async () => {
    const room = newRoom();
    const a = join(room);
    const b = join(room);
    publish(a.awareness, { actor: ALEX, holding: ['n_0'] });
    publish(b.awareness, { actor: BO });
    await settle();
    expect(holdsFrom(b.awareness)).toEqual({ n_0: ALEX });

    a.session.close();
    await settle();

    // Without the goodbye going out before the wire comes down, n_0 stays
    // frozen under a hand that is not there any more.
    expect(holdsFrom(b.awareness)).toEqual({});
    expect(peersOf(b.awareness)).toEqual([]);
  });
});

describe('the room name', () => {
  it('is the URL without the board in it', () => {
    // The fragment is the board's contents; two people opening the same link
    // must land in one room rather than one room per saved state.
    expect(roomFromLocation('https://x.app/#b=AAAA')).toBe('https://x.app/');
    expect(roomFromLocation('https://x.app/')).toBe('https://x.app/');
  });
});

describe('which board a URL means', () => {
  it('puts two tabs of the same page in one room', () => {
    expect(roomFromLocation('https://x.test/board')).toBe(roomFromLocation('https://x.test/board'));
  });

  it('ignores the hash, which is a place on the board rather than a board', () => {
    expect(roomFromLocation('https://x.test/b#n_04')).toBe(roomFromLocation('https://x.test/b'));
  });

  it('ignores flags that only describe this tab, not which board it is on', () => {
    const plain = roomFromLocation('https://x.test/b');
    expect(roomFromLocation('https://x.test/b?demo=a')).toBe(plain);
    expect(roomFromLocation('https://x.test/b?demo=b')).toBe(plain);
    expect(roomFromLocation('https://x.test/b?pace=2')).toBe(plain);
    expect(roomFromLocation('https://x.test/b?demo=a&pace=2')).toBe(plain);
  });

  it('still separates boards that are genuinely different', () => {
    expect(roomFromLocation('https://x.test/one')).not.toBe(roomFromLocation('https://x.test/two'));
    expect(roomFromLocation('https://x.test/b?board=k9')).not.toBe(roomFromLocation('https://x.test/b'));
  });

  it('does not fall over on something that is not a URL', () => {
    expect(roomFromLocation('local')).toBe('local');
  });
});
