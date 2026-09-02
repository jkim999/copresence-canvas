import { useState } from 'react';
import { useHostStore } from '../agent/webmcp';
import { formatArgs, summarizeResult } from '../agent/callFormat';

const VISIBLE = 3;

/**
 * The agent's calls, on the board, as they happen.
 *
 * Without this the page shows only consequences — notes sliding around — and a
 * viewer has no way to tell a model apart from a scripted animation. The ledger
 * is the evidence: real ids, chosen by whoever is driving, with what came back.
 *
 * Calls from the other people on the board appear here too, under their seat
 * name. Without that, two agents working one board looks exactly like one.
 *
 * Only the last few rows are shown, because the ledger sits over the canvas and
 * the board is the thing being looked at. The rest are not thrown away: the
 * count is a button, and the evidence a viewer cannot reach is not evidence.
 */
export const Ledger = () => {
  const calls = useHostStore((s) => s.calls);
  const [open, setOpen] = useState(false);
  if (calls.length === 0) return null;

  const recent = open ? calls : calls.slice(-VISIBLE);
  const hidden = calls.length - calls.slice(-VISIBLE).length;

  return (
    <div
      className={`ledger${open ? ' open' : ''}`}
      role="log"
      aria-live="polite"
      aria-label="Agent tool calls"
    >
      <span className="ledger-head">
        agent tool calls
        {hidden > 0 && (
          <button
            type="button"
            className="more"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? 'show less' : `+${hidden} earlier`}
          </button>
        )}
      </span>
      {recent.map((c) => {
        const answered = c.by ? c.out !== undefined : c.result !== undefined;
        const state = c.error ? 'err' : answered ? 'done' : 'live';
        return (
          <div className={`ledger-row ${state}`} key={c.id}>
            <code className="sig">
              {c.by && <span className="whose">{c.by.name}</span>}
              <b>{c.tool}</b>
              <span className="paren">(</span>
              {c.sig ?? formatArgs(c.args)}
              <span className="paren">)</span>
            </code>
            <span className="out">
              {c.error
                ? `error: ${c.error}`
                : `→ ${c.by ? (c.out ?? '…') : summarizeResult(c.tool, c.result)}`}
            </span>
          </div>
        );
      })}
    </div>
  );
};
