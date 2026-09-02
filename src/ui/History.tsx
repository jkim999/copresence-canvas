import { useMemo } from 'react';
import { useSceneStore } from '../state/sceneStore';
import { describeEvent, useJournalStore } from '../state/journal';
import { usePeerStore } from '../sync/peers';
import { crediting, nameFor } from '../agent/credit';
import { isAgent, me, myAgent } from '../state/actors';
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
 */

const time = (t: number) =>
  new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

interface Row {
  id: string;
  at: number;
  text: string;
  kind: 'human' | 'agent' | 'system';
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
      own: e.by === me() || e.by === myAgent(),
    })),
    ...log.map((entry): Row => ({
      id: entry.id,
      at: entry.at,
      text: entry.text,
      kind: entry.by === 'system' ? 'system' : isAgent(entry.by) ? 'agent' : 'human',
      own: entry.by === me() || entry.by === myAgent(),
    })),
  ].sort((a, b) => a.at - b.at);

  if (rows.length === 0) {
    return <p className="empty">Every change either of you makes lands here.</p>;
  }

  return (
    <>
      {rows.map((row) => (
        <div className={`log ${row.kind}${row.own ? ' own' : ''}`} key={row.id}>
          <span className="who">
            <i />
          </span>
          <span className="body">{row.text}</span>
          <span className="t">{time(row.at)}</span>
        </div>
      ))}
    </>
  );
};
