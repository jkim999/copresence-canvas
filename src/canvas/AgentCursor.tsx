import { ViewportPortal } from '@xyflow/react';
import { useCursorStore } from '../agent/motion';
import { PointerBody } from './Pointer';

const DOING: Record<string, string> = {
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
            opacity: ((i + 1) / trail.length) * 0.26,
          }}
        />
      ))}
      <div className={`actor-cursor agent ${mode}`} style={{ transform: `translate(${x}px, ${y}px)` }}>
        <span
          className="halo"
          key={mode === 'grabbing' ? `g${Math.round(x)}${Math.round(y)}` : 'h'}
        />
        <PointerBody actor="agent" />
        <span className="tag">
          {label}
          {DOING[mode] ? <em> · {DOING[mode]}</em> : null}
        </span>
      </div>
    </ViewportPortal>
  );
};
