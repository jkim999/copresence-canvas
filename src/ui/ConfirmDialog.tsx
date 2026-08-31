import { useConfirmStore } from '../agent/confirm';

/**
 * The single turn-taking beat in an otherwise simultaneous product. WebMCP has
 * no standard elicitation call yet, so the page owns the gate: the tool handler
 * awaits this dialog, and the agent's own promise does not resolve until the
 * human answers.
 */
export const ConfirmDialog = () => {
  const pending = useConfirmStore((s) => s.pending);
  const answer = useConfirmStore((s) => s.answer);
  if (!pending) return null;

  return (
    <div className="scrim" onClick={() => answer(false)}>
      <div className="dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="eyebrow">The agent is asking permission</div>
        <h2>{pending.title}</h2>
        <p>{pending.body}</p>
        {pending.detail && pending.detail.length > 0 && (
          <ul>
            {pending.detail.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        )}
        <div className="row">
          <button className="btn ghost" onClick={() => answer(false)}>
            {pending.cancelLabel}
          </button>
          <button className="btn primary" onClick={() => answer(true)} autoFocus>
            {pending.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
