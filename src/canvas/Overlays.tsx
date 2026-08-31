import { ViewportPortal } from '@xyflow/react';
import { useSceneStore } from '../state/sceneStore';
import { boundsOf } from '../agent/layout';

/** Dashed group frames with agent-authored titles, drawn behind the notes. */
export const RegionLayer = () => {
  const scene = useSceneStore((s) => s.scene);
  if (scene.regions.length === 0) return null;

  const byId = new Map(scene.nodes.map((n) => [n.id, n]));

  return (
    <ViewportPortal>
      {scene.regions.map((region) => {
        const nodes = region.nodeIds
          .map((id) => byId.get(id))
          .filter((n): n is NonNullable<typeof n> => Boolean(n));
        if (nodes.length < 2) return null;
        const b = boundsOf(nodes, 26);
        return (
          <div
            key={region.id}
            className="region-box"
            style={{ transform: `translate(${b.x}px, ${b.y}px)`, width: b.w, height: b.h }}
          >
            <span className="region-label">{region.label}</span>
          </div>
        );
      })}
    </ViewportPortal>
  );
};

/** Floating agent comments — attached to the board, never moving anything. */
export const AnnotationLayer = () => {
  const scene = useSceneStore((s) => s.scene);
  const removeAnnotation = useSceneStore((s) => s.removeAnnotation);
  if (scene.annotations.length === 0) return null;

  const byId = new Map(scene.nodes.map((n) => [n.id, n]));

  return (
    <ViewportPortal>
      {scene.annotations.map((a) => {
        // Anchored comments follow their note as it moves.
        const anchor = a.nodeId ? byId.get(a.nodeId) : undefined;
        const x = anchor ? anchor.x + anchor.w + 24 : a.x;
        const y = anchor ? anchor.y - 10 : a.y;
        return (
          <div key={a.id} className="annotation" style={{ transform: `translate(${x}px, ${y}px)` }}>
            <span className="who">Agent note</span>
            {a.text}
            <button className="kill" onClick={() => removeAnnotation(a.id)} title="Dismiss">
              ×
            </button>
          </div>
        );
      })}
    </ViewportPortal>
  );
};
