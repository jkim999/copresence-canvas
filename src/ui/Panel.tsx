import { useEffect, useMemo, useRef, useState } from 'react';
import { useSceneStore } from '../state/sceneStore';
import { History } from './History';
import { useJournalStore } from '../state/journal';
import { useHostStore, type ToolDefinition } from '../agent/webmcp';
import { RECIPES, RECIPE_GROUPS, type Recipe } from '../agent/recipes';
import {
  IconActivity,
  IconArrow,
  IconConsole,
  IconLock,
  IconRunning,
  IconTools,
} from './icons';

export type Tab = 'console' | 'tools' | 'activity';

export const TABS: { id: Tab; label: string; Icon: typeof IconConsole }[] = [
  { id: 'console', label: 'Console', Icon: IconConsole },
  { id: 'tools', label: 'Tools', Icon: IconTools },
  { id: 'activity', label: 'Activity', Icon: IconActivity },
];

const time = (t: number) =>
  new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const badgeFor = (tool: ToolDefinition): { text: string; cls: string } => {
  if (tool.name === 'reorganize_board') return { text: 'gated', cls: 'gated' };
  if (tool.annotations?.readOnlyHint) return { text: 'read', cls: '' };
  return { text: 'write', cls: 'write' };
};

interface Props {
  tools: ToolDefinition[];
  tab: Tab;
  onTab: (tab: Tab) => void;
}

export const Panel = ({ tools, tab, onTab }: Props) => {
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const connected = useHostStore((s) => s.connected);
  const calls = useHostStore((s) => s.calls);
  const pushLog = useSceneStore((s) => s.pushLog);
  const changes = useJournalStore((s) => s.events.length);
  const logEnd = useRef<HTMLDivElement>(null);

  const shelves = useMemo(
    () =>
      RECIPE_GROUPS.map((group) => ({
        group,
        items: RECIPES.filter((r) => r.group === group),
      })).filter((s) => s.items.length > 0),
    [],
  );

  useEffect(() => {
    logEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [changes, calls.length, tab]);

  const call = async (name: string, args: unknown) => {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`No such tool: ${name}`);
    return tool.execute(args);
  };

  const runRecipe = async (recipe: Recipe) => {
    if (running) return;
    setRunning(recipe.id);
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

  return (
    <aside className="panel chrome-surface" aria-label="Agent console">
      <div className="tabs">
        <div className="tablist" role="tablist">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? 'active' : ''}
              onClick={() => onTab(id)}
            >
              <Icon size={14} />
              {label}
              {id === 'tools' && <span className="n">{tools.length}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="panel-body">
        {tab === 'console' && (
          <>
            <p className="lede">
              {connected ? (
                <>
                  A host is connected — ask it out loud to reorganise the board. These buttons call
                  the same registered handlers, so you can drive the agent with no model in the
                  loop. <strong>Keep dragging notes while one runs.</strong>
                </>
              ) : (
                <>
                  No WebMCP host here, so these buttons call the same handlers a host would.{' '}
                  <strong>Keep dragging notes while one runs.</strong> To hand the board to a real
                  agent, open it in ChatGPT's in-app browser, or in Chrome with:
                  <code>chrome://flags/#enable-webmcp-testing</code>
                </>
              )}
            </p>

            {shelves.map(({ group, items }) => (
              <div className="group" key={group}>
                <h3 className="group-title">{group}</h3>
                {items.map((r) => (
                  <button
                    key={r.id}
                    className={`recipe ${running === r.id ? 'running' : ''}`}
                    onClick={() => runRecipe(r)}
                    disabled={Boolean(running)}
                  >
                    <span className="head">
                      <strong>{r.title}</strong>
                      {running === r.id ? (
                        <span className="spin">
                          <IconRunning />
                        </span>
                      ) : (
                        <span className="go">
                          <IconArrow />
                        </span>
                      )}
                    </span>
                    <p>{r.blurb}</p>
                    <code className={r.id === 'reorg' ? 'gated' : ''}>
                      {r.id === 'reorg' && <IconLock size={10} />}
                      {r.tool}
                    </code>
                  </button>
                ))}
              </div>
            ))}

            {error && <p className="notice">{error}</p>}
          </>
        )}

        {tab === 'tools' && (
          <>
            <p className="lede">
              Registered on this page through <code>document.modelContext.registerTool</code>. Every
              handler mutates the same in-memory scene the canvas renders — no server holds this
              state.
            </p>
            {tools.map((tool) => {
              const badge = badgeFor(tool);
              return (
                <details className="tool" key={tool.name}>
                  <summary>
                    {tool.name}
                    <span className={`badge ${badge.cls}`}>{badge.text}</span>
                  </summary>
                  <div className="desc">{tool.description}</div>
                  <pre>{JSON.stringify(tool.inputSchema, null, 2)}</pre>
                </details>
              );
            })}
          </>
        )}

        {tab === 'activity' && (
          <>
            <div className="group">
              <h3 className="group-title">Tool calls</h3>
              {calls.length === 0 ? (
                <p className="empty">
                  Nothing has been called yet.
                  <br />
                  Run something from the console.
                </p>
              ) : (
                [...calls].reverse().map((c) => (
                  <div className="call" key={c.id}>
                    <span className="row">
                      <span className="name">{c.tool}</span>
                      <span className="t">{time(c.at)}</span>
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

            <div className="group">
              <h3 className="group-title">Board history</h3>
              <History />
              <div ref={logEnd} />
            </div>
          </>
        )}
      </div>
    </aside>
  );
};
