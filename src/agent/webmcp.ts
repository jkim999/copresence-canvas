import { create } from 'zustand';

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

interface HostState {
  transport: Transport;
  connected: boolean;
  registered: string[];
  /** rolling record of tool calls, whoever made them. */
  calls: { id: string; at: number; tool: string; args: unknown; result?: unknown; error?: string }[];
  setHost: (p: Partial<Pick<HostState, 'transport' | 'connected' | 'registered'>>) => void;
  recordCall: (tool: string, args: unknown) => string;
  completeCall: (id: string, result: unknown, error?: string) => void;
}

export const useHostStore = create<HostState>((set) => ({
  transport: 'none',
  connected: false,
  registered: [],
  calls: [],
  setHost: (p) => set(p),
  recordCall: (tool, args) => {
    const id = `call_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    set((s) => ({ calls: [...s.calls.slice(-40), { id, at: Date.now(), tool, args }] }));
    return id;
  },
  completeCall: (id, result, error) =>
    set((s) => ({
      calls: s.calls.map((c) => (c.id === id ? { ...c, result, error } : c)),
    })),
}));

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

/** Wrap a handler so every invocation — host or console — is logged identically. */
export const instrument = (tool: ToolDefinition): ToolDefinition => ({
  ...tool,
  execute: async (args, context) => {
    const store = useHostStore.getState();
    const id = store.recordCall(tool.name, args);
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
});

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
