import { useMemo } from 'react';
import { useIntentStore } from '../agent/intent';
import { describeIntent } from '../agent/intent';
import { usePeerStore } from '../sync/peers';
import { crediting } from '../agent/credit';
import type { Intent } from '../state/types';

/**
 * What is about to happen, before it happens.
 *
 * The board was legible about the past — a ledger of calls, a history of
 * changes — and about the present, since a labelled cursor is visible while it
 * works. It said nothing at all about the next two seconds, and on a canvas
 * with more than one pair of hands that is the gap that matters: notes begin
 * moving under you with no warning, and the only act that ever announced itself
 * in advance was the one whole-board change that puts up a dialog.
 *
 * Every seat's agent is here, this tab's included. Seeing your own agent
 * declare itself is not redundant — it is how you learn that the announcement
 * is trustworthy, which is what makes a peer's announcement worth believing.
 */
export const Happening = () => {
  const mine = useIntentStore((s) => s.mine);
  const peers = usePeerStore((s) => s.peers);

  // Named through the same function as everywhere else, so the seat in this
  // strip is the seat in the ledger, in a refusal, and in the history panel.
  const credit = useMemo(() => crediting(), [peers]);
  const lines: { key: string; text: string; own: boolean }[] = [];

  if (mine) lines.push({ key: 'mine', text: describeIntent(mine, 'Your agent'), own: true });
  for (const peer of peers) {
    const doing: Intent | null = peer.doing;
    if (!doing) continue;
    lines.push({
      key: peer.actor,
      text: describeIntent(doing, `${credit(peer.actor).seat}’s agent`),
      own: false,
    });
  }

  // Nothing pending is the common case, and an empty strip that reserves space
  // would be a permanent reminder of nothing.
  if (lines.length === 0) return null;

  return (
    <div className="happening chrome-surface" role="status" aria-live="polite">
      {lines.map((line) => (
        <p className={`happening-row${line.own ? ' own' : ''}`} key={line.key}>
          <span className="pulse" aria-hidden="true" />
          {line.text}
        </p>
      ))}
    </div>
  );
};
