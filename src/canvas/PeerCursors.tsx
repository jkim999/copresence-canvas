import type { CSSProperties } from 'react';
import { ViewportPortal } from '@xyflow/react';
import { usePeerCursorStore } from '../sync/peers';
import { PointerBody } from './Pointer';
import { seatColor } from '../state/actors';

/**
 * Other people's bodies, drawn on the board rather than on the screen.
 *
 * Their agents are here too, and that is the point of the page: a second agent
 * used to be visible only through its effects — notes moving with nothing on
 * them, a line in the strip, a badge in the ledger — so the one participant
 * with no presence on a board about participation was the other agent.
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
      {cursors.map((c) => {
        // A peer's agent keeps teal, because agent-versus-hand is the contrast
        // this whole page is read through and it has to survive being somebody
        // else's. Their hands get a hue of their own: everyone was terracotta,
        // which answers "somebody else is here" while refusing to answer "which
        // of you" — the question a board with several people on it is asking.
        const color = c.kind === 'agent' ? undefined : seatColor(c.actor);
        return (
          <div
            key={c.actor}
            className={`actor-cursor ${c.kind} peer-cursor`}
            style={
              {
                transform: `translate(${c.point.x}px, ${c.point.y}px)`,
                ...(color ? { '--seat': color } : {}),
              } as CSSProperties
            }
          >
            <PointerBody actor={c.kind} color={color} />
            <span className="tag">{c.name}</span>
          </div>
        );
      })}
    </ViewportPortal>
  );
};
