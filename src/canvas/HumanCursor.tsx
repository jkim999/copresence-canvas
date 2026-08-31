import { useEffect, useState } from 'react';
import { useCursorStore } from '../agent/motion';

/**
 * A label for the human's own pointer, shown only while the agent is acting.
 * Two labelled cursors on screen at once is the entire thesis of this product,
 * and it is very hard to read in a screen recording without the names.
 */
export const HumanCursor = () => {
  const agentActive = useCursorStore((s) => s.visible);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!agentActive) {
      setPoint(null);
      return;
    }
    const onMove = (e: PointerEvent) => {
      const wrap = document.querySelector('.canvas-wrap');
      if (!wrap) return;
      const box = wrap.getBoundingClientRect();
      const inside =
        e.clientX >= box.left && e.clientX <= box.right &&
        e.clientY >= box.top && e.clientY <= box.bottom;
      setPoint(inside ? { x: e.clientX - box.left, y: e.clientY - box.top } : null);
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [agentActive]);

  if (!agentActive || !point) return null;

  return (
    <span className="human-tag" style={{ transform: `translate(${point.x}px, ${point.y}px)` }}>
      You
    </span>
  );
};
