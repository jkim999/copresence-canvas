import { useMemo, useState } from 'react';
import { useSceneStore } from '../state/sceneStore';
import { describeEvent, useJournalStore, type JournalVerb } from '../state/journal';
import { usePeerStore } from '../sync/peers';
import { crediting, nameFor } from '../agent/credit';
import { isAgent, me, myAgent } from '../state/actors';
import { spotlight, unspotlight } from './spotlight';
import { revertAct, revertLabel, scopeOfAct } from './revert';
import { VerbMark } from './VerbMark';
import type { ActorId } from '../state/types';

/**
 * What has happened on this board, in one list — and the handle on each line.
 *
 * There were two accounts before this and neither was the record: a log that
 * only the agent's own narration and the occasional system message wrote into,
 * and the canvas itself, which shows where a note is but never that it moved,
 * or who moved it. A peer restructuring your work while you looked away left no
 * trace at all — the same hole the agents reported from their side.
 *
 * The journal supplies the changes and the log supplies the notices — a refusal,
 * a reset, an undo — and they are interleaved by time rather than stacked in two
 * panels, because "Ochre declined" only means anything next to what it declined.
 *
 * Three things make it usable rather than merely complete. A mark per verb, so
 * the shape of a session can be seen before it is read. A row that points:
 * hovering or focusing one rings the notes it changed, because a sentence about
 * three notes on a board of forty is only half an answer. And a row that acts,
 * because reading is exactly when a person decides they want something back,
 * and undo used to live in the toolbar as a button meaning "the last thing".
 */

const time = (t: number) =>
  new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

interface Row {
  id: string;
  at: number;
  text: string;
  kind: 'human' | 'agent' | 'system';
  /** Present on a change, absent on a notice — a refusal has no verb. */
  verb: JournalVerb | null;
  ids: readonly string[];
  /** This seat's own work, so it can be shown as yours rather than as a stranger's. */
  own: boolean;
  /** The announced act this line belongs to, when the board can still return to it. */
  act: number | null;
}

export const History = () => {
  const log = useSceneStore((s) => s.log);
  const history = useSceneStore((s) => s.history);
  const events = useJournalStore((s) => s.events);
  const peers = usePeerStore((s) => s.peers);
  const [reverting, setReverting] = useState<number | null>(null);

  /**
   * Named through the same function the tools use, so the seat in this list is
   * the seat in a tool result and in a refusal. Your own pair reads as "You"
   * and "Your agent": a seat name is what a *peer* calls you, and reading
   * "Cedar moved 3 notes" about work you just did yourself is a small lie that
   * makes the whole list harder to trust. Recomputed when the room changes,
   * since a seat name is only distinct with respect to the other seats in it.
   */
  const credit = useMemo(() => crediting(), [peers]);
  const nameOf = (by: ActorId | null): string | null =>
    by === null ? null : nameFor(credit(by));

  // A line can only offer to rewind to an act this tab kept a snapshot of.
  // Peers' acts, and anything old enough to have fallen off the undo stack,
  // are readable but not reachable — and the row simply does not offer.
  // Also the act's own short label — "Arrange 14 notes as grid" — which is what
  // the rewind dialog names. Quoting the whole rendered sentence there put one
  // pair of marks inside another and read as broken punctuation.
  const reachable = useMemo(() => {
    const out = new Map<number, string>();
    for (const h of history) if (h.act !== undefined) out.set(h.act, h.label);
    return out;
  }, [history]);

  const rows: Row[] = [
    ...events.map((e): Row => ({
      id: `j${e.seq}`,
      at: e.at,
      text: describeEvent(e, nameOf(e.by)),
      kind: e.by === null ? 'system' : isAgent(e.by) ? 'agent' : 'human',
      verb: e.verb,
      ids: e.ids,
      own: e.by === me() || e.by === myAgent(),
      act: e.act !== undefined && reachable.has(e.act) ? e.act : null,
    })),
    ...log.map((entry): Row => ({
      id: entry.id,
      at: entry.at,
      text: entry.text,
      kind: entry.by === 'system' ? 'system' : isAgent(entry.by) ? 'agent' : 'human',
      verb: null,
      ids: [],
      own: entry.by === me() || entry.by === myAgent(),
      act: null,
    })),
  ].sort((a, b) => a.at - b.at);

  if (rows.length === 0) {
    // Addressed to whoever is actually here. The old copy said "either of you"
    // to a person sitting alone on a board with no agent yet, which reads as a
    // promise about a second participant who does not exist.
    return <p className="empty">Every change on this board lands here — yours, your agent’s, and anyone else’s.</p>;
  }

  const rewind = async (row: Row) => {
    if (row.act === null || reverting !== null) return;
    setReverting(row.act);
    unspotlight(row.id);
    try {
      const seats = scopeOfAct(events, row.act).othersAffected.map((a) => credit(a).seat);
      await revertAct(events, row.act, reachable.get(row.act) ?? row.text, seats);
    } finally {
      setReverting(null);
    }
  };

  return (
    <ul className="history">
      {rows.map((row) => {
        const locatable = row.ids.length > 0;
        const label = row.act === null ? null : revertLabel(scopeOfAct(events, row.act));
        return (
          <li
            className={`log ${row.kind}${row.own ? ' own' : ''}${locatable ? ' locatable' : ''}`}
            key={row.id}
            // Focus as well as hover: the rings are the answer to "which ones",
            // and that answer cannot be reserved for people using a mouse.
            // A group rather than a bare focusable div, so what is focused has
            // a name — the sentence — and the control inside it is reachable.
            role={locatable ? 'group' : undefined}
            aria-label={locatable ? row.text : undefined}
            tabIndex={locatable ? 0 : undefined}
            onMouseEnter={() => spotlight(row.id, row.ids)}
            onMouseLeave={() => unspotlight(row.id)}
            onFocus={() => spotlight(row.id, row.ids)}
            onBlur={() => unspotlight(row.id)}
          >
            <span className="who">
              {row.verb ? <VerbMark verb={row.verb} /> : <i />}
            </span>
            <span className="body">{row.text}</span>
            {label !== null && (
              <button
                type="button"
                className="rewind"
                disabled={reverting !== null}
                onClick={() => void rewind(row)}
                // The visible word is one of two; what it costs is in the
                // dialog, and what it acts on is in the name.
                aria-label={`${label}: ${row.text}`}
              >
                {label}
              </button>
            )}
            <span className="t">{time(row.at)}</span>
          </li>
        );
      })}
    </ul>
  );
};
