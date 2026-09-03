import { useSceneStore } from '../state/sceneStore';
import { me } from '../state/actors';
import { releaseHand, takeHand } from '../state/hands';
import { useConfirmStore } from '../agent/confirm';
import { classify, type Category } from '../data/classify';

/**
 * A hand that does not need a hand.
 *
 * The three refusals are all races between a person and an agent, and two of
 * them are only witnessable inside a window measured in hundreds of
 * milliseconds. That is fine for a person who has practised and fatal for one
 * recording a video: the grip beat asks the operator to take a note out of the
 * agent's hands *while it is carrying it*, in the correct tab, at the correct
 * moment, on camera.
 *
 * So the demo drives itself. Both tabs load the same timeline and run halves of
 * it in step, one as the director and one as the second seat.
 *
 * Nothing here is a back door. Every agent action goes through the same
 * registered handler a WebMCP host would call, and every human action goes
 * through the same grip the pointer does — `takeHand` and `moveNode`, exactly
 * as `Canvas` calls them on a drag. The autopilot can be refused, and in two of
 * these five beats it is supposed to be.
 */

export type Role = 'a' | 'b';
export type BeatId = 'opening' | 'hand' | 'reality' | 'veto' | 'approve';

/**
 * `?demo` alone means the director, because that is the tab you are already
 * looking at when you decide to turn this on. A role the app does not have is
 * not a role: seating an unknown value as the director would put two directors
 * on one board, and both would drive the same beat twice.
 */
export const roleFrom = (search: string): Role | null => {
  const params = new URLSearchParams(search);
  if (!params.has('demo')) return null;
  const raw = (params.get('demo') ?? '').trim();
  if (raw === '' || raw === 'a') return 'a';
  return raw === 'b' ? 'b' : null;
};

type Call = (name: string, args: unknown) => Promise<unknown>;

export interface BeatContext {
  call: Call;
}

export interface Beat {
  id: BeatId;
  title: string;
  /** What the director's seat does. */
  a: (ctx: BeatContext) => Promise<unknown>;
  /** What the second seat does, at the same moment. */
  b: (ctx: BeatContext) => Promise<unknown>;
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const nothing = async (): Promise<void> => {};

/** The same shallow read of the board the console recipes do. */
const byCategory = (): Record<Category, string[]> => {
  const out: Record<Category, string[]> = {
    quote: [], metric: [], event: [], hypothesis: [], action: [],
  };
  for (const n of useSceneStore.getState().scene.nodes) {
    if (n.kind === 'idea') out[classify(n.text)].push(n.id);
  }
  return out;
};

const asOfFrom = async (call: Call): Promise<number | undefined> => {
  const scene = (await call('get_scene', {})) as { asOf?: unknown };
  return typeof scene?.asOf === 'number' ? scene.asOf : undefined;
};

/** Ease so a driven hand reads as a hand, not as a teleport. */
const ease = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/**
 * A drag, taken the way the pointer takes one.
 *
 * `hold` is the part that matters: a real hand does not let go the instant it
 * stops moving, and the grip is only interesting while it is still closed.
 */
const animateTo = async (id: string, dx: number, dy: number, travel: number): Promise<void> => {
  const node = useSceneStore.getState().getNode(id);
  if (!node) return;
  const { x, y } = node;
  // Same rule the agent's own choreography follows: a tab nobody is looking at
  // gets the outcome without the theatre. It also keeps this from hanging — a
  // hidden tab runs no animation frames, so the loop below would never finish
  // and the hand would stay closed for the rest of the session.
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    useSceneStore.getState().moveNode(id, x + dx, y + dy, me());
    return;
  }
  const start = performance.now();
  await new Promise<void>((resolve) => {
    const step = (): void => {
      const t = Math.min(1, (performance.now() - start) / travel);
      useSceneStore.getState().moveNode(id, x + dx * ease(t), y + dy * ease(t), me());
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
};

/** A drag, taken and released the way the pointer takes and releases one. */
const drag = async (
  id: string,
  dx: number,
  dy: number,
  { travel = 1400, hold = 0 }: { travel?: number; hold?: number } = {},
): Promise<void> => {
  takeHand('drag', id);
  try {
    await animateTo(id, dx, dy, travel);
    if (hold > 0) await wait(hold);
  } finally {
    // A hand left closed by a thrown beat would refuse every later act on that
    // note for the rest of the recording.
    releaseHand('drag', id);
  }
};

/**
 * Hold a note for as long as an act lasts.
 *
 * The grip beat first tried to win a race: start the act, poll until the agent
 * was carrying something, then take that note. It reads better and it is not
 * reliable — the poll can miss the flight entirely, and a hand that lands on a
 * note already at rest is refused nothing, so the beat silently produces no
 * refusal at all. On a recording day, a beat that works every time beats a beat
 * that works when the timing falls right. The hand is on the note before the
 * agent reaches it, which is the same refusal from the agent's side.
 */
const holdThrough = async <T>(
  id: string,
  dx: number,
  dy: number,
  travel: number,
  act: Promise<T>,
): Promise<T> => {
  takeHand('drag', id);
  try {
    const [result] = await Promise.all([act, animateTo(id, dx, dy, travel)]);
    return result;
  } finally {
    releaseHand('drag', id);
  }
};

/** Say yes to whatever this tab is being asked, once it is actually asked. */
const approveWhenAsked = async (within = 8000): Promise<void> => {
  const deadline = performance.now() + within;
  while (performance.now() < deadline) {
    if (useConfirmStore.getState().pending !== null) {
      useConfirmStore.getState().answer(true);
      return;
    }
    await wait(60);
  }
};

/**
 * A whole-board proposal built from the board as it stands.
 *
 * Deliberately not citing `basedOn`: this beat is about the room, and a
 * staleness refusal here would pre-empt the consent it exists to show.
 */
const wholeBoard = (): Record<string, unknown> => {
  const by = byCategory();
  const groups = [
    { label: 'What people said', nodeIds: by.quote, layout: 'cluster' },
    { label: 'What the numbers say', nodeIds: by.metric, layout: 'cluster' },
    { label: 'Risks', nodeIds: by.hypothesis, layout: 'cluster' },
    { label: 'What happened, in order', nodeIds: by.event, layout: 'timeline_horizontal' },
    { label: 'Proposed actions', nodeIds: by.action, layout: 'grid' },
  ].filter((g) => g.nodeIds.length > 0);
  return { rationale: 'Group the board by what each note actually is.', groups };
};

export const BEATS: Beat[] = [
  {
    id: 'opening',
    title: 'A · two agents and a hand',
    a: async ({ call }) => {
      const basedOn = await asOfFrom(call);
      const { action, quote } = byCategory();
      const held = quote[0];
      const grid = call('arrange_region', {
        basedOn,
        nodeIds: action,
        layout: 'grid',
        label: 'Proposed actions',
      });
      // The hand is in shot for the whole act, which is the point of the frame:
      // nobody is taking turns.
      if (held) await drag(held, 260, 140, { travel: 3200, hold: 1200 });
      return grid;
    },
    b: async ({ call }) => {
      const basedOn = await asOfFrom(call);
      const { event } = byCategory();
      await call('arrange_region', {
        basedOn,
        nodeIds: event,
        layout: 'timeline_horizontal',
        label: 'What happened, in order',
      });
    },
  },
  {
    id: 'hand',
    title: 'C · take a note out of its hands',
    a: async ({ call }) => {
      const basedOn = await asOfFrom(call);
      const { quote } = byCategory();
      const held = quote[Math.floor(quote.length / 2)];
      const act = call('arrange_region', {
        basedOn,
        nodeIds: quote,
        layout: 'cluster',
        label: 'What people said',
      });
      if (!held) return act;
      return holdThrough(held, -240, 210, 5200, act);
    },
    b: nothing,
  },
  {
    id: 'reality',
    title: 'D · the board moved underneath it',
    a: async ({ call }) => {
      // Read, then wait out loud, then write — citing the read. The gap is the
      // whole beat: it is where the other seat gets there first.
      const basedOn = await asOfFrom(call);
      const { hypothesis } = byCategory();
      await wait(4200);
      return call('arrange_region', {
        basedOn,
        nodeIds: hypothesis,
        layout: 'cluster',
        label: 'Risks',
      });
    },
    b: async () => {
      // A person, not an agent: the refusal should name a human seat.
      await wait(1200);
      const { hypothesis } = byCategory();
      for (const id of hypothesis.slice(0, 3)) {
        await drag(id, 180, -160, { travel: 500 });
      }
    },
  },
  {
    id: 'veto',
    title: 'E1 · silence is a refusal',
    a: async ({ call }) => {
      return call('reorganize_board', wholeBoard());
    },
    b: nothing,
  },
  {
    id: 'approve',
    title: 'E2 · the room says yes',
    a: async ({ call }) => {
      // The seat whose agent is acting is asked as well: prompting an agent is
      // not consent to a whole-board change it chose by itself. So this half
      // answers its own dialog too, or the beat times out looking like a veto.
      const act = call('reorganize_board', wholeBoard());
      void approveWhenAsked();
      return act;
    },
    b: async () => {
      await approveWhenAsked();
    },
  },
];

export const beatById = (id: string): Beat | undefined => BEATS.find((b) => b.id === id);
