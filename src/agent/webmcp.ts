import { create } from 'zustand';
import { formatArgs, summarizeResult } from './callFormat';

/**
 * WebMCP host adapter.
 *
 * The registration entry point has moved between drafts of the spec, so we
 * feature-detect rather than assume:
 *   - `document.modelContext.registerTool(...)`  — current Chrome / ChatGPT docs
 *   - `navigator.modelContext.registerTool(...)` — earlier drafts
 *   - `navigator.modelContext.provideContext({ tools })` — original shape
 * Whichever exists wins; when none exist the page still works and the built-in
 * agent console drives the exact same handlers.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  execute: (args: any, context?: { signal?: AbortSignal }) => Promise<unknown>;
}

type Transport = 'document.modelContext' | 'navigator.modelContext' | 'provideContext' | 'none';

/**
 * One line of the ledger.
 *
 * A call made in another tab arrives already rendered — `sig` and `out` are the
 * strings that tab drew — rather than as raw args and results. Those can be a
 * whole board (`get_scene` returns every note), and shipping one per call to
 * every peer to redraw an identical line would be silly and slow.
 */
export interface Call {
  id: string;
  at: number;
  tool: string;
  args?: unknown;
  result?: unknown;
  error?: string;
  /** The seat that made it. Absent means this tab's own. */
  by?: { actor: string; name: string };
  /** Pre-rendered call and outcome, for a call that came off the wire. */
  sig?: string;
  out?: string;
}

/** How a call reaches the other tabs. Injected, so an unconnected page is unchanged. */
export interface CallTransport {
  started: (c: { id: string; at: number; tool: string; sig: string }) => void;
  finished: (c: { id: string; out?: string; error?: string }) => void;
}

let callTransport: CallTransport | null = null;
export const setCallTransport = (t: CallTransport | null): void => {
  callTransport = t;
};

interface HostState {
  transport: Transport;
  connected: boolean;
  registered: string[];
  /** rolling record of tool calls, whoever made them. */
  calls: Call[];
  setHost: (p: Partial<Pick<HostState, 'transport' | 'connected' | 'registered'>>) => void;
  recordCall: (tool: string, args: unknown) => string;
  completeCall: (id: string, result: unknown, error?: string) => void;
}

const LEDGER_LIMIT = 40;

export const useHostStore = create<HostState>((set) => ({
  transport: 'none',
  connected: false,
  registered: [],
  calls: [],
  setHost: (p) => set(p),
  recordCall: (tool, args) => {
    const id = `call_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const at = Date.now();
    set((s) => ({ calls: [...s.calls.slice(-(LEDGER_LIMIT - 1)), { id, at, tool, args }] }));
    callTransport?.started({ id, at, tool, sig: formatArgs(args) });
    return id;
  },
  completeCall: (id, result, error) => {
    set((s) => ({
      calls: s.calls.map((c) => (c.id === id ? { ...c, result, error } : c)),
    }));
    const call = useHostStore.getState().calls.find((c) => c.id === id);
    callTransport?.finished({
      id,
      out: error === undefined && call ? summarizeResult(call.tool, result) : undefined,
      error,
    });
  },
}));

/** A call another tab is making, in the moment it starts. */
export const recordRemoteCall = (c: {
  id: string;
  at: number;
  tool: string;
  sig: string;
  actor: string;
  name: string;
}): void => {
  useHostStore.setState((s) =>
    s.calls.some((existing) => existing.id === c.id)
      ? s
      : {
          calls: [
            ...s.calls.slice(-(LEDGER_LIMIT - 1)),
            { id: c.id, at: c.at, tool: c.tool, sig: c.sig, by: { actor: c.actor, name: c.name } },
          ],
        },
  );
};

/** The same call, once that tab has an answer. */
export const completeRemoteCall = (id: string, out?: string, error?: string): void => {
  useHostStore.setState((s) =>
    s.calls.some((c) => c.id === id)
      ? { calls: s.calls.map((c) => (c.id === id ? { ...c, out, error } : c)) }
      : s,
  );
};

const getHost = (): { transport: Transport; target: any } => {
  const doc = (globalThis as any).document?.modelContext;
  if (doc && typeof doc.registerTool === 'function') {
    return { transport: 'document.modelContext', target: doc };
  }
  const nav = (globalThis as any).navigator?.modelContext;
  if (nav && typeof nav.registerTool === 'function') {
    return { transport: 'navigator.modelContext', target: nav };
  }
  if (nav && typeof nav.provideContext === 'function') {
    return { transport: 'provideContext', target: nav };
  }
  return { transport: 'none', target: null };
};

/**
 * Wrap a handler so every invocation — host or console — is logged identically.
 *
 * Idempotent on purpose: the same tool list is handed to the host registration,
 * to the in-page console and to window.__copresence, and wrapping twice would
 * record every call twice.
 */
const wrapped = new WeakSet<ToolDefinition>();

export const instrument = (tool: ToolDefinition): ToolDefinition => {
  if (wrapped.has(tool)) return tool;
  const instrumented: ToolDefinition = {
    ...tool,
    execute: async (args, context) => {
      const id = useHostStore.getState().recordCall(tool.name, args);
      try {
        const result = await tool.execute(args ?? {}, context);
        useHostStore.getState().completeCall(id, result);
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        useHostStore.getState().completeCall(id, undefined, message);
        throw error;
      }
    },
  };
  wrapped.add(instrumented);
  return instrumented;
};

export const registerTools = (tools: ToolDefinition[]): (() => void) => {
  const instrumented = tools.map(instrument);
  const { transport, target } = getHost();
  const controller = new AbortController();

  if (transport === 'none') {
    useHostStore.getState().setHost({
      transport,
      connected: false,
      registered: instrumented.map((t) => t.name),
    });
    return () => {};
  }

  const registered: string[] = [];

  if (transport === 'provideContext') {
    try {
      target.provideContext({ tools: instrumented });
      registered.push(...instrumented.map((t) => t.name));
    } catch (error) {
      console.error('[webmcp] provideContext failed', error);
    }
  } else {
    // Register one at a time: a host that rejects a single field should cost us
    // that one tool, not the whole integration.
    for (const tool of instrumented) {
      try {
        target.registerTool(
          {
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            ...(tool.annotations ? { annotations: tool.annotations } : {}),
            execute: tool.execute,
          },
          { signal: controller.signal },
        );
        registered.push(tool.name);
      } catch (error) {
        console.error(`[webmcp] could not register ${tool.name}`, error);
      }
    }
  }

  useHostStore.getState().setHost({
    transport,
    connected: registered.length > 0,
    registered: registered.length > 0 ? registered : instrumented.map((t) => t.name),
  });

  return () => controller.abort();
};

/** Direct handler access for the in-page agent console and for debugging. */
export const exposeForConsole = (tools: ToolDefinition[]): void => {
  const instrumented = tools.map(instrument);
  const api = Object.fromEntries(
    instrumented.map((t) => [t.name, (args: unknown) => t.execute(args ?? {})]),
  );
  (globalThis as any).__copresence = { tools: instrumented, call: api };
};
