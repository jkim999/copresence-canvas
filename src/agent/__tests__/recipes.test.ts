import { beforeEach, describe, expect, it } from 'vitest';
import { RECIPES } from '../recipes';
import { useSceneStore } from '../../state/sceneStore';

/**
 * The console is not a shortcut around the rules — it is the same agent with
 * keyword heuristics standing in for a model's judgement. So it has to behave
 * like a well-mannered one: read the board, then cite the read it planned from.
 *
 * Without this the one surface a judge can drive without a WebMCP host is also
 * the one surface that cannot demonstrate the gate, and the console would be
 * quietly writing blind while the README explains why that is unsafe.
 */

const WRITES_ON_EXISTING = ['timeline', 'affinity', 'matrix', 'summarize', 'reorg'];

/**
 * `link` and `tree` write on existing notes too, and cite their premise the
 * same way — but neither reaches its write on the seeded board, because their
 * keyword tables still describe the onboarding board this demo replaced. They
 * are excluded here rather than asserted-and-skipped so the omission is a
 * stated fact rather than a test that quietly passes on nothing.
 */
const DEAD_ON_THE_SEED_BOARD = ['link', 'tree'];

beforeEach(() => {
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

describe('the recipes that cannot run on the board they ship with', () => {
  it.each(DEAD_ON_THE_SEED_BOARD)('still fails before it writes: %s', async (id) => {
    const writes = (await trace(id)).filter((c) => c.name !== 'get_scene');
    expect(writes).toEqual([]);
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
