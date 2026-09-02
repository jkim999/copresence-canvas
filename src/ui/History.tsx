import { useMemo } from 'react';
import { useSceneStore } from '../state/sceneStore';
import { describeEvent, useJournalStore, type JournalVerb } from '../state/journal';
import { usePeerStore } from '../sync/peers';
import { crediting, nameFor } from '../agent/credit';
import { isAgent, me, myAgent } from '../state/actors';
import { spotlight, unspotlight } from './spotlight';
import { VerbMark } from './VerbMark';
import type { ActorId } from '../state/types';

/**
 * What has happened on this board, in one list.
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
 * Two things make it readable rather than merely complete. A mark per verb, so
 * the shape of a session can be seen before it is read. And a row that points:
 * hovering one rings the notes it changed, because a sentence about three notes
 * on a board of forty is only half an answer.
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
}

export const History = () => {
  const log = useSceneStore((s) => s.log);
  const events = useJournalStore((s) => s.events);
  const peers = usePeerStore((s) => s.peers);

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

  const rows: Row[] = [
    ...events.map((e): Row => ({
      id: `j${e.seq}`,
      at: e.at,
      text: describeEvent(e, nameOf(e.by)),
      kind: e.by === null ? 'system' : isAgent(e.by) ? 'agent' : 'human',
      verb: e.verb,
      ids: e.ids,
      own: e.by === me() || e.by === myAgent(),
    })),
    ...log.map((entry): Row => ({
      id: entry.id,
      at: entry.at,
      text: entry.text,
      kind: entry.by === 'system' ? 'system' : isAgent(entry.by) ? 'agent' : 'human',
      verb: null,
      ids: [],
      own: entry.by === me() || entry.by === myAgent(),
    })),
  ].sort((a, b) => a.at - b.at);

  if (rows.length === 0) {
    return <p className="empty">Every change either of you makes lands here.</p>;
  }

  return (
    <div className="history">
      {rows.map((row) => {
        const locatable = row.ids.length > 0;
        return (
          <div
            className={`log ${row.kind}${row.own ? ' own' : ''}${locatable ? ' locatable' : ''}`}
            key={row.id}
            // Focus as well as hover: the rings are the answer to "which ones",
            // and that answer cannot be reserved for people using a mouse.
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
            <span className="t">{time(row.at)}</span>
          </div>
        );
      })}
    </div>
  );
};
