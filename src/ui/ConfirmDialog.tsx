import { useEffect, useMemo } from 'react';
import { useConfirmStore } from '../agent/confirm';
import { usePeerStore } from '../sync/peers';
import { crediting } from '../agent/credit';

/**
 * The single turn-taking beat in an otherwise simultaneous product. WebMCP has
 * no standard elicitation call yet, so the page owns the gate: the tool handler
 * awaits this dialog, and the agent's own promise does not resolve until the
 * human answers.
 *
 * On a board with more than one person, the same question is put to all of
 * them and any one refusal is enough. So the dialog has to say whose agent is
 * asking — otherwise a modal appears on your screen about a board you were not
 * touching, with no account of where it came from.
 *
 * And it has to be the *same* name. The wire carries the seat name the asking
 * tab minted for itself, which knows nothing about the room it landed in: this
 * dialog once said "Pewter's agent is asking" while the strip four inches above
 * it said "Pewter 2's agent" about that very act. Resolving the actor here puts
 * one seat under one name across the dialog, the strip, the ledger, the history
 * and a refusal.
 */
export const ConfirmDialog = () => {
  const pending = useConfirmStore((s) => s.pending);
  const answer = useConfirmStore((s) => s.answer);
  const peers = usePeerStore((s) => s.peers);

  const actor = pending?.askerActor ?? null;
  const asker = useMemo(() => {
    if (actor === null) return pending?.asker ?? null;
    // Passed in explicitly: an agent can outlive the presence entry that named
    // its seat, and a question from a tab that just left still has to be signed.
    return crediting([actor])(actor).seat;
  }, [actor, pending?.asker, peers]);

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') answer(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, answer]);

  if (!pending) return null;

  return (
    <div className="scrim chrome-surface" onClick={() => answer(false)}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gate-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="gate-title">{pending.title}</h2>
        {asker !== null && (
          <p className="asker">
            <strong>{asker}</strong>&rsquo;s agent is asking. It needs everyone here to
            agree, and your refusal alone is enough to stop it.
          </p>
        )}
        <p>{pending.body}</p>
        {pending.detail && pending.detail.length > 0 && (
          <ul>
            {pending.detail.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        )}
        <div className="row">
          <button className="btn quiet" onClick={() => answer(false)}>
            {pending.cancelLabel}
          </button>
          <button className="btn solid" onClick={() => answer(true)} autoFocus>
            {pending.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
