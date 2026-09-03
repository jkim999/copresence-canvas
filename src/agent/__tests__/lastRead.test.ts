import { beforeEach, describe, expect, it } from 'vitest';
import { RECIPES } from '../recipes';
import { useHostStore } from '../webmcp';
import { useSceneStore } from '../../state/sceneStore';

/**
 * A model does not read and write in the same breath. It looks, it thinks for a
 * few seconds, and it acts — and the staleness gate exists entirely because of
 * what other people can do in those seconds.
 *
 * Every other recipe collapses that gap: it reads and writes in one press, so
 * nothing can happen in between and the gate can never fire. That left the one
 * surface a judge can drive without a WebMCP host unable to demonstrate the one
 * rule the README leads with. This recipe keeps the two halves apart, citing
 * the bookmark from a read the operator made earlier.
 */

const recipe = () => RECIPES.find((r) => r.id === 'lastread')!;

beforeEach(() => {
  useHostStore.setState({ calls: [] });
  useSceneStore.getState().resetScene();
});

const read = (asOf: unknown) => {
  const store = useHostStore.getState();
  store.completeCall(store.recordCall('get_scene', {}), { asOf, nodes: [] });
};

describe('acting on a read from earlier', () => {
  it('is offered by the console', () => {
    expect(recipe()).toBeDefined();
  });

  it('refuses to run before anything has been read', async () => {
    await expect(recipe().run(async () => ({}))).rejects.toThrow(/read/i);
  });

  it('cites the bookmark from that earlier read, and takes no new one', async () => {
    read(11);
    const calls: { name: string; args: any }[] = [];
    await recipe().run(async (name, args) => {
      calls.push({ name, args });
      return {};
    });
    expect(calls.map((c) => c.name)).toEqual(['arrange_region']);
    expect(calls[0].args.basedOn).toBe(11);
  });

  it('uses the most recent read, not the first', async () => {
    read(11);
    read(29);

    const calls: any[] = [];
    await recipe().run(async (_n, args) => {
      calls.push(args);
      return {};
    });
    expect(calls[0].basedOn).toBe(29);
  });

  it('ignores a read that came back without a usable bookmark', async () => {
    read('not a number');
    await expect(recipe().run(async () => ({}))).rejects.toThrow(/read/i);
  });
});
