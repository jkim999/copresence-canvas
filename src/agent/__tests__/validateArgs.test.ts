import { describe, expect, it } from 'vitest';
import { validateArgs } from '../validateArgs';

const schema = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    nodeId: { type: 'string' },
    count: { type: 'number' },
    nodeIds: { type: 'array', items: { type: 'string' } },
  },
  required: ['text'],
  additionalProperties: false,
} as const;

/**
 * Found by driving the deployed page: `annotate_scene` was called with
 * `anchorTo` where its schema says `nodeId`. The key was dropped in silence and
 * the call reported success, having anchored the comment to nothing. A host
 * validates before it calls a handler; the in-page console did not, so the two
 * paths agreed on everything except whether a typo is an error.
 */
describe('validateArgs', () => {
  it('names the key that does not belong, and what was expected instead', () => {
    const message = validateArgs(schema, { text: 'hi', anchorTo: 'n_08' });
    expect(message).toContain('anchorTo');
    expect(message).toContain('nodeId');
  });

  it('names a required key that is missing', () => {
    expect(validateArgs(schema, {})).toContain('text');
  });

  it('names the type it was given rather than only the one it wanted', () => {
    const message = validateArgs(schema, { text: 42 });
    expect(message).toContain('text');
    expect(message).toContain('string');
    expect(message).toContain('number');
  });

  it('catches an array where one is declared', () => {
    expect(validateArgs(schema, { text: 'hi', nodeIds: 'n_01' })).toContain('nodeIds');
  });

  it('passes a call that matches', () => {
    expect(validateArgs(schema, { text: 'hi', nodeId: 'n_08', nodeIds: ['n_01'] })).toBeNull();
    expect(validateArgs(schema, { text: 'hi' })).toBeNull();
  });

  it('treats a missing argument object as an empty one', () => {
    expect(validateArgs(schema, undefined)).toContain('text');
    expect(validateArgs({ type: 'object', properties: {} }, undefined)).toBeNull();
  });

  /**
   * The gate is only as good as its willingness to stay out of the way. A
   * schema that permits extra keys must keep permitting them, and anything
   * this shallow checker cannot read is not its business to reject.
   */
  it('allows extra keys where the schema has not forbidden them', () => {
    const open = { type: 'object', properties: { text: { type: 'string' } } };
    expect(validateArgs(open, { text: 'hi', whatever: 1 })).toBeNull();
  });

  it('ignores a property whose declared type it does not understand', () => {
    const odd = { type: 'object', properties: { thing: { type: 'integer' } } };
    expect(validateArgs(odd, { thing: 3 })).toBeNull();
  });

  it('is silent on a schema it cannot read at all', () => {
    expect(validateArgs({}, { anything: true })).toBeNull();
    expect(validateArgs({ properties: 'nonsense' }, { a: 1 })).toBeNull();
  });
});

/**
 * The rule is only worth having where the calls actually arrive. `instrument`
 * is the one wrapper both paths share — the handlers handed to the WebMCP host
 * and the ones handed to the in-page console are the same objects — so the
 * check belongs there and nowhere else.
 */
describe('the check where the calls come in', () => {
  const tool = {
    name: 'annotate_scene',
    description: 'leave a comment',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' }, nodeId: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    },
    execute: async (args: any) => ({ ok: true, saw: args }),
  };

  it('refuses the call rather than quietly dropping the stray key', async () => {
    const { instrument } = await import('../webmcp');
    const wrapped = instrument(tool);
    await expect(wrapped.execute({ text: 'hi', anchorTo: 'n_08' })).rejects.toThrow(/anchorTo/);
  });

  it('leaves a good call completely alone', async () => {
    const { instrument } = await import('../webmcp');
    const wrapped = instrument(tool);
    await expect(wrapped.execute({ text: 'hi', nodeId: 'n_08' })).resolves.toEqual({
      ok: true,
      saw: { text: 'hi', nodeId: 'n_08' },
    });
  });

  it('shows the refusal in the ledger, so it is not a call that never happened', async () => {
    const { instrument, useHostStore } = await import('../webmcp');
    const before = useHostStore.getState().calls.length;
    await instrument(tool)
      .execute({ text: 'hi', anchorTo: 'n_08' })
      .catch(() => undefined);
    const calls = useHostStore.getState().calls;
    expect(calls.length).toBe(before + 1);
    expect(calls[calls.length - 1].error).toMatch(/anchorTo/);
  });
});
