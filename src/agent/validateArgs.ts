/**
 * What a host would have checked before calling the handler.
 *
 * A WebMCP host validates a call against the tool's declared schema and refuses
 * it before the page ever sees it. The in-page console calls the same handlers
 * directly, so it skipped that step — and a call driven from the console with
 * `anchorTo` where the schema says `nodeId` had the stray key dropped in
 * silence, then reported success having anchored the comment to nothing. Two
 * paths that agree on everything except whether a typo is an error are not one
 * path.
 *
 * Deliberately shallow. Every tool here already checks its own arguments in
 * depth, and the job left over is the one a host does: reject a key that is not
 * in the schema, a required key that is absent, and a value of plainly the
 * wrong kind. Anything subtler belongs to the tool, and a validator that
 * guessed at it would start refusing calls the page would have honoured.
 *
 * It fails open on a schema it cannot read. A gate that cannot tell what is
 * permitted must not decide what is forbidden.
 */

const KINDS: Record<string, (v: unknown) => boolean> = {
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number',
  boolean: (v) => typeof v === 'boolean',
  array: (v) => Array.isArray(v),
  object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
};

const kindOf = (v: unknown): string =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;

/** The nearest declared key, so a typo is answered with the name it meant. */
const suggest = (key: string, known: string[]): string | null => {
  const lower = key.toLowerCase();
  const near = known.find(
    (k) => k.toLowerCase() === lower || k.toLowerCase().includes(lower) || lower.includes(k.toLowerCase()),
  );
  return near ?? null;
};

/** The complaint a host would have made, or `null` when the call is fine. */
export const validateArgs = (
  schema: Record<string, unknown> | undefined,
  args: unknown,
): string | null => {
  const properties = schema?.properties;
  if (properties === null || typeof properties !== 'object' || Array.isArray(properties)) {
    return null;
  }
  const declared = properties as Record<string, { type?: unknown }>;
  const known = Object.keys(declared);

  if (args !== undefined && (args === null || typeof args !== 'object' || Array.isArray(args))) {
    return `arguments must be an object, not ${kindOf(args)}`;
  }
  const given = (args ?? {}) as Record<string, unknown>;

  const required = Array.isArray(schema?.required) ? (schema.required as unknown[]) : [];
  for (const key of required) {
    if (typeof key === 'string' && given[key] === undefined) {
      return `missing required argument "${key}"`;
    }
  }

  for (const [key, value] of Object.entries(given)) {
    if (!(key in declared)) {
      if (schema?.additionalProperties === false) {
        const near = suggest(key, known);
        return (
          `unknown argument "${key}"${near === null ? '' : ` — did you mean "${near}"?`}. ` +
          `This tool takes: ${known.join(', ')}.`
        );
      }
      continue;
    }
    const declaredType = declared[key]?.type;
    const wanted = typeof declaredType === 'string' ? declaredType : null;
    const check = wanted === null ? undefined : KINDS[wanted];
    if (wanted !== null && value !== undefined && check !== undefined && !check(value)) {
      const article = 'aeiou'.includes(wanted[0]) ? 'an' : 'a';
      return `"${key}" must be ${article} ${wanted}, not ${kindOf(value)}`;
    }
  }

  return null;
};
