import { ViewportPortal } from '@xyflow/react';
import { usePeerCursorStore } from '../sync/peers';
import { PointerBody } from './Pointer';

/**
 * Other people's pointers, drawn on the board rather than on the screen.
 *
 * They live inside the viewport transform on purpose: a peer's pointer is at a
 * place on the *board*, so it has to pan and zoom with the notes. Anchoring it
 * to the screen would put their hand over the wrong note the moment either of
 * you scrolled.
 */
export const PeerCursors = () => {
  const cursors = usePeerCursorStore((s) => s.cursors);
  if (cursors.length === 0) return null;

  return (
    <ViewportPortal>
      {cursors.map((c) => (
        <div
          key={c.actor}
          className="actor-cursor human peer-cursor"
          style={{ transform: `translate(${c.point.x}px, ${c.point.y}px)` }}
        >
          <PointerBody actor="human" />
          <span className="tag">{c.name}</span>
        </div>
      ))}
    </ViewportPortal>
  );
};
