import { ViewportPortal } from '@xyflow/react';
import { useCursorStore } from '../agent/motion';

const LABELS: Record<string, string> = {
  travelling: 'moving',
  grabbing: 'picking up',
  writing: 'writing',
  thinking: 'reading',
  idle: '',
};

/**
 * The agent's body. It lives in flow coordinates inside the viewport transform,
 * so it pans and zooms with the board exactly like a real second user would.
 */
export const AgentCursor = () => {
  const { x, y, visible, mode, label, trail } = useCursorStore();
  if (!visible) return null;

  return (
    <ViewportPortal>
      {trail.map((p, i) => (
        <div
          key={`${p.t}-${i}`}
          className="cursor-trail"
          style={{
            transform: `translate(${p.x}px, ${p.y}px)`,
            opacity: ((i + 1) / trail.length) * 0.32,
          }}
        />
      ))}
      <div
        className={`agent-cursor ${mode}`}
        style={{ transform: `translate(${x}px, ${y}px)` }}
      >
        <span className="halo" key={mode === 'grabbing' ? `g${Math.round(x)}${Math.round(y)}` : 'h'} />
        <svg width="20" height="22" viewBox="0 0 20 22" fill="none">
          <path
            d="M2 1.6 L2 18.4 L6.3 14.2 L9.1 20.4 L12.2 19 L9.4 12.9 L15.4 12.6 Z"
            fill="#8b5cf6"
            stroke="#fff"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
        </svg>
        <span className="tag">
          {label}
          {LABELS[mode] ? <em> · {LABELS[mode]}</em> : null}
        </span>
      </div>
    </ViewportPortal>
  );
};
