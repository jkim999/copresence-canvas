import { beforeEach, describe, expect, it } from 'vitest';
import { RECIPES } from '../recipes';
import { useSceneStore } from '../../state/sceneStore';
import { useHostStore } from '../webmcp';

/**
 * The console is not a shortcut around the rules — it is the same agent with
 * keyword heuristics standing in for a model's judgement. So it has to behave
 * like a well-mannered one: read the board, then cite the read it planned from.
 *
 * Without this the one surface a judge can drive without a WebMCP host is also
 * the one surface that cannot demonstrate the gate, and the console would be
 * quietly writing blind while the README explains why that is unsafe.
 */

const WRITES_ON_EXISTING = ['timeline', 'affinity', 'matrix', 'link', 'tree', 'summarize', 'reorg'];

beforeEach(() => {
  useHostStore.setState({ calls: [] });
  useSceneStore.getState().resetScene();
});

const trace = async (id: string) => {
  const calls: { name: string; args: any }[] = [];
  const recipe = RECIPES.find((r) => r.id === id)!;
  await recipe
    .run(async (name, args) => {
      calls.push({ name, args });
      // Enough of a scene for the recipe to plan from; the point is the call
      // sequence, not what the layout engine would have done with it.
      return name === 'get_scene'
        ? { asOf: 7, nodes: useSceneStore.getState().scene.nodes }
        : {};
    })
    .catch(() => undefined);
  return calls;
};

/**
 * Every button in the panel is a button a judge will press. Two of them threw
 * on the board they ship with — their keyword tables described the onboarding
 * board this demo replaced — and an error where a demo should be is worse than
 * a feature that was never offered.
 */
describe('every recipe the panel offers', () => {
  it.each(RECIPES.map((r) => r.id))('runs on the board it ships with: %s', async (id) => {
    const recipe = RECIPES.find((r) => r.id === id)!;
    // `lastread` deliberately requires a board read on an earlier press — that
    // gap is the whole point of it — so give it the precondition it states.
    const host = useHostStore.getState();
    host.completeCall(host.recordCall('get_scene', {}), { asOf: 3, nodes: [] });
    let threw: string | null = null;
    await recipe
      .run(async (name) =>
        name === 'get_scene'
          ? { asOf: 7, nodes: useSceneStore.getState().scene.nodes }
          : { holdingRightNow: [], recentlyTouched: [] },
      )
      .catch((e: Error) => {
        threw = e.message;
      });
    expect(threw).toBeNull();
  });
});

describe('every console recipe that rewrites existing notes', () => {
  it.each(WRITES_ON_EXISTING)('reads the board before it writes: %s', async (id) => {
    const calls = await trace(id);
    expect(calls[0]?.name).toBe('get_scene');
  });

  it.each(WRITES_ON_EXISTING)('cites that read on every write it makes: %s', async (id) => {
    const writes = (await trace(id)).filter((c) => c.name !== 'get_scene');
    expect(writes.length).toBeGreaterThan(0);
    for (const write of writes) expect(write.args.basedOn).toBe(7);
  });
});
