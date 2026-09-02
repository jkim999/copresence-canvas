import { useEffect } from 'react';
import { useConfirmStore } from '../agent/confirm';

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
 */
export const ConfirmDialog = () => {
  const pending = useConfirmStore((s) => s.pending);
  const answer = useConfirmStore((s) => s.answer);

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
        {pending.asker !== null && (
          <p className="asker">
            <strong>{pending.asker}</strong>&rsquo;s agent is asking. It needs everyone here to
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
