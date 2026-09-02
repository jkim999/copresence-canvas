import { useMemo } from 'react';
import { usePeerStore } from '../sync/peers';
import { crediting } from '../agent/credit';
import { useHeldStore } from '../agent/announcements';
import { requestStop, useIntentStore } from '../agent/intent';

/**
 * What is about to happen, before it happens — and the handle to stop it.
 *
 * The board was legible about the past — a ledger of calls, a history of
 * changes — and about the present, since a labelled cursor is visible while it
 * works. It said nothing at all about the next two seconds, and on a canvas
 * with more than one pair of hands that is the gap that matters: notes begin
 * moving under you with no warning, and the only act that ever announced itself
 * in advance was the one whole-board change that puts up a dialog.
 *
 * The name is a chip rather than the first two words of a sentence, and it
 * carries the colour of the ring drawn around the notes that announcement
 * named. That correspondence is the point: teal here means the teal rings out
 * there are the ones you can call off, terracotta means they belong to somebody
 * else's seat and will land whether you watch or not.
 *
 * That first half was a promise the page could not keep. It described a window
 * with no handle in it — the strip told you an act was coming, held the notes
 * up for you to look at, and then did it anyway. So a row about your own agent
 * now ends in the handle, and a row about a peer's does not, because reaching
 * across the wire to halt somebody else's agent is a different power with a
 * different rule about who may hold it.
 *
 * Every seat's agent is here, this tab's included. Seeing your own agent
 * declare itself is not redundant — it is how you learn that the announcement
 * is trustworthy, which is what makes a peer's announcement worth believing.
 *
 * The rows come from the one held list the canvas also rings from. They were
 * derived separately once, and two live tabs caught the consequence: the strip
 * promised "1 ringed" over a board with no ring on it anywhere.
 */

interface Row {
  key: string;
  /** The seat, shown as a chip: "Your agent", "Cedar's agent". */
  who: string;
  /** The rest of the sentence, in the present continuous. */
  what: string;
  /** How many notes it named, or 0 for an act that names none. */
  count: number;
  /** The whole sentence, for anyone who hears the page rather than sees it. */
  said: string;
  own: boolean;
  /** Whether this row is still the running act, rather than one held on screen. */
  live: boolean;
}

export const Happening = () => {
  const held = useHeldStore((s) => s.held);
  const peers = usePeerStore((s) => s.peers);
  const mine = useIntentStore((s) => s.mine);
  const stopping = useIntentStore((s) => s.stopping);

  // Named through the same function as everywhere else, so the seat in this
  // strip is the seat in the ledger, in a refusal, and in the history panel.
  const credit = useMemo(() => crediting(), [peers]);

  const rows: Row[] = held.map((a) => {
    const who = a.own ? 'Your agent' : `${credit(a.actor ?? '').seat}’s agent`;
    return {
      key: a.key,
      who,
      what: `is ${a.verb} ${a.what}`,
      count: a.ids.length,
      said: `${who} is ${a.verb} ${a.what}`,
      own: a.own,
      // An announcement is held for a moment after its act ends so it can be
      // read at all. Offering to stop something already finished would be the
      // same broken promise in the other direction.
      live: a.own && mine !== null,
    };
  });

  // Nothing pending is the common case, and an empty strip that reserves space
  // would be a permanent reminder of nothing.
  if (rows.length === 0) return null;

  return (
    <div className="happening chrome-surface" role="status" aria-live="polite">
      {rows.map((row) => (
        <p className={`happening-row${row.own ? ' own' : ''}`} key={row.key} aria-label={row.said}>
          <span className="pulse" aria-hidden="true" />
          <span className="who">{row.who}</span>
          <span className="what">{row.what}</span>
          {row.count > 0 && (
            <span className="ringed" aria-hidden="true">
              {row.count} ringed
            </span>
          )}
          {row.live && (
            <button
              type="button"
              className="stop"
              onClick={requestStop}
              disabled={stopping}
              // The visible word is "Stop"; a screen reader hears what it stops,
              // since the row it belongs to is read as one label.
              aria-label={stopping ? 'Stopping your agent' : `Stop: ${row.said}`}
            >
              {stopping ? 'Stopping…' : 'Stop'}
            </button>
          )}
        </p>
      ))}
    </div>
  );
};
