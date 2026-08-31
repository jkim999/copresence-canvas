import { useEffect, useRef, useState } from 'react';
import { useSceneStore } from '../state/sceneStore';
import { useHostStore, type ToolDefinition } from '../agent/webmcp';
import { RECIPES } from '../agent/recipes';

type Tab = 'agent' | 'tools' | 'activity';

const time = (t: number) =>
  new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const badgeFor = (tool: ToolDefinition): { text: string; cls: string } => {
  if (tool.name === 'reorganize_board') return { text: 'gated', cls: 'gated' };
  if (tool.annotations?.readOnlyHint) return { text: 'read', cls: '' };
  return { text: 'write', cls: 'write' };
};

interface Props {
  tools: ToolDefinition[];
  open: boolean;
}

export const Panel = ({ tools, open }: Props) => {
  const [tab, setTab] = useState<Tab>('agent');
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const connected = useHostStore((s) => s.connected);
  const calls = useHostStore((s) => s.calls);
  const log = useSceneStore((s) => s.log);
  const pushLog = useSceneStore((s) => s.pushLog);
  const logEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [log.length, calls.length, tab]);

  const call = async (name: string, args: unknown) => {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`No such tool: ${name}`);
    return tool.execute(args);
  };

  const runRecipe = async (id: string) => {
    const recipe = RECIPES.find((r) => r.id === id);
    if (!recipe || running) return;
    setRunning(id);
    setError(null);
    try {
      await recipe.run(call);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      pushLog('system', `Tool error: ${message}`);
    } finally {
      setRunning(null);
    }
  };

  if (!open) return <aside className="panel collapsed" />;

  return (
    <aside className="panel">
      <div className="panel-tabs">
        {(['agent', 'tools', 'activity'] as Tab[]).map((t) => (
          <button
            key={t}
            className={`panel-tab ${tab === t ? 'active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'agent' ? 'Agent console' : t === 'tools' ? `Tools · ${tools.length}` : 'Activity'}
          </button>
        ))}
      </div>

      <div className="panel-body">
        {tab === 'agent' && (
          <>
            <p className="hint">
              {connected ? (
                <>
                  A WebMCP host is connected — just ask it, out loud, to reorganise the board. These
                  buttons call the <em>same</em> registered handlers, so you can drive the agent
                  without a model in the loop.
                </>
              ) : (
                <>
                  No WebMCP host in this browser. Open this page in ChatGPT's in-app browser, or
                  in Chrome with <code>chrome://flags/#enable-webmcp-testing</code> enabled, and the
                  agent can drive it directly. Meanwhile these buttons call the same registered
                  handlers a host would call — they read <code>get_scene</code>, pick note ids out
                  of the text, and invoke the tool.{' '}
                  <strong>Keep dragging notes while one runs.</strong>
                </>
              )}
            </p>

            <div className="section">
              <h3 className="section-title">Ask the agent to…</h3>
              {RECIPES.map((r) => (
                <button
                  key={r.id}
                  className="recipe"
                  onClick={() => runRecipe(r.id)}
                  disabled={Boolean(running)}
                >
                  <strong>
                    {running === r.id ? '● ' : ''}
                    {r.title}
                  </strong>
                  <span>{r.blurb}</span>
                  <span className="tool">{r.tool}</span>
                </button>
              ))}
              {error && (
                <p className="hint" style={{ color: 'var(--danger)' }}>
                  {error}
                </p>
              )}
            </div>
          </>
        )}

        {tab === 'tools' && (
          <>
            <p className="hint">
              Registered on this page via{' '}
              <code>document.modelContext.registerTool</code>. Every handler mutates the same
              in-memory scene the canvas renders — there is no server holding this state.
            </p>
            {tools.map((tool) => {
              const badge = badgeFor(tool);
              return (
                <details className="tool-card" key={tool.name}>
                  <summary>
                    {tool.name}
                    <span className={`badge ${badge.cls}`}>{badge.text}</span>
                  </summary>
                  <div className="tool-desc">{tool.description}</div>
                  <pre>{JSON.stringify(tool.inputSchema, null, 2)}</pre>
                </details>
              );
            })}
          </>
        )}

        {tab === 'activity' && (
          <>
            <div className="section">
              <h3 className="section-title">Tool calls</h3>
              {calls.length === 0 ? (
                <p className="empty">
                  No tool calls yet.
                  <br />
                  Run something from the agent console.
                </p>
              ) : (
                [...calls].reverse().map((c) => (
                  <div className="call-row" key={c.id}>
                    <span className="name">{c.tool}</span>
                    <span className="time" style={{ float: 'right', color: '#4b5265', fontSize: 10 }}>
                      {time(c.at)}
                    </span>
                    <pre>{JSON.stringify(c.args, null, 1)}</pre>
                    {c.error ? (
                      <pre className="err">error: {c.error}</pre>
                    ) : c.result !== undefined ? (
                      <pre>→ {JSON.stringify(c.result).slice(0, 260)}</pre>
                    ) : (
                      <pre>→ running…</pre>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="section">
              <h3 className="section-title">Board history</h3>
              {log.map((entry) => (
                <div className={`log-row ${entry.by}`} key={entry.id}>
                  <span className="who">{entry.by}</span>
                  <span className="body">{entry.text}</span>
                  <span className="time">{time(entry.at)}</span>
                </div>
              ))}
              <div ref={logEnd} />
            </div>
          </>
        )}
      </div>
    </aside>
  );
};
