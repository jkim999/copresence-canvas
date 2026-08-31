/**
 * The agent has one body, so it can only do one physical thing at a time.
 *
 * A WebMCP host is free to fire two write tools concurrently. Without this,
 * both would drive the single agent cursor at once: their animations would
 * interleave incoherently and — worse — one call's cursor promise would be
 * dropped and never settle, hanging that tool call forever.
 *
 * Actions queue instead. Reads (`get_scene`) never queue: the agent can always
 * look at the board, even while it is moving something.
 */
let tail: Promise<unknown> = Promise.resolve();

export const withAgentBody = <T>(action: () => Promise<T>): Promise<T> => {
  // Run after whatever is in flight, whether that succeeded or failed.
  const run = tail.then(action, action);
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
};
