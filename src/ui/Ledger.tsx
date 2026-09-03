import { useMemo, useState } from 'react';
import { useHostStore } from '../agent/webmcp';
import { formatArgs, refusalNote, summarizeResult } from '../agent/callFormat';
import { crediting } from '../agent/credit';
import { usePeerStore } from '../sync/peers';

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
 * That name is resolved from the actor, never taken from the wire. The wire
 * carries the name the calling tab minted for itself before it knew the room,
 * so with two seats whose names collide the ledger showed a bare "JUNIPER"
 * while every other surface said "Juniper 1" and "Juniper 2" — leaving the one
 * panel that shows raw agent activity unable to say which agent.
 *
 * Only the last few rows are shown, because the ledger sits over the canvas and
 * the board is the thing being looked at. The rest are not thrown away: the
 * count is a button, and the evidence a viewer cannot reach is not evidence.
 */
export const Ledger = () => {
  const calls = useHostStore((s) => s.calls);
  const peers = usePeerStore((s) => s.peers);
  const [open, setOpen] = useState(false);
  const credit = useMemo(
    () => crediting(calls.flatMap((c) => (c.by ? [c.by.actor] : []))),
    [peers, calls],
  );
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
              {c.by && <span className="whose">{credit(c.by.actor).seat}</span>}
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
            {/* Only a refusal speaks here. It is the one part of a result the
                model is told and the room otherwise is not. */}
            {!c.by && !c.error && refusalNote(c.result) && (
              <span className="told">{refusalNote(c.result)}</span>
            )}
          </div>
        );
      })}
    </div>
  );
};
