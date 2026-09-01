import type { Scene, SceneNode } from '../state/types';
import { isAgent } from '../state/actors';

/**
 * The board has to be able to leave. Without this the agent's work is a nice
 * animation that dies on reload; with it, the organised board is something you
 * paste into the doc you were writing anyway.
 */

const LAYOUT_NAME: Record<string, string> = {
  cluster: 'cluster',
  timeline_horizontal: 'timeline',
  grid: 'grid',
  hierarchy: 'hierarchy',
};

/** Agent-authored or agent-moved notes stay attributed in the export. */
const line = (n: SceneNode): string =>
  `- ${n.text}${isAgent(n.lastEditedBy) ? ' _(agent)_' : ''}`;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const toMarkdown = (scene: Scene): string => {
  const byId = new Map(scene.nodes.map((n) => [n.id, n]));
  const out: string[] = ['# Co-Presence Canvas board', ''];

  const counts = [plural(scene.nodes.length, 'note')];
  if (scene.regions.length > 0) counts.push(plural(scene.regions.length, 'group'));
  if (scene.edges.length > 0) counts.push(plural(scene.edges.length, 'connection'));
  out.push(counts.join(' · '), '');

  // Groups read left to right, then top to bottom — the order the eye takes
  // them on the canvas, so the document matches what the human is looking at.
  const grouped = new Set<string>();
  const regions = [...scene.regions].sort((a, b) => {
    const an = a.nodeIds.map((id) => byId.get(id)).filter(Boolean) as SceneNode[];
    const bn = b.nodeIds.map((id) => byId.get(id)).filter(Boolean) as SceneNode[];
    if (an.length === 0 || bn.length === 0) return bn.length - an.length;
    const ax = Math.min(...an.map((n) => n.x));
    const bx = Math.min(...bn.map((n) => n.x));
    return ax === bx
      ? Math.min(...an.map((n) => n.y)) - Math.min(...bn.map((n) => n.y))
      : ax - bx;
  });

  for (const region of regions) {
    const nodes = region.nodeIds.map((id) => byId.get(id)).filter(Boolean) as SceneNode[];
    if (nodes.length === 0) continue;
    nodes.forEach((n) => grouped.add(n.id));
    const kind = LAYOUT_NAME[region.layout] ?? region.layout;
    out.push(`## ${region.label} _(${kind})_`, '');
    out.push(...nodes.map(line), '');
  }

  const loose = scene.nodes.filter((n) => !grouped.has(n.id));
  if (loose.length > 0) {
    out.push(regions.length > 0 ? '## Ungrouped' : '## Notes', '');
    out.push(...loose.map(line), '');
  }

  if (scene.edges.length > 0) {
    out.push('## Connections', '');
    for (const e of scene.edges) {
      const from = byId.get(e.from);
      const to = byId.get(e.to);
      if (!from || !to) continue;
      out.push(`- ${from.text} → ${to.text}${e.label ? ` — ${e.label}` : ''}`);
    }
    out.push('');
  }

  if (scene.annotations.length > 0) {
    out.push('## Agent comments', '');
    for (const a of scene.annotations) {
      const anchor = a.nodeId ? byId.get(a.nodeId) : undefined;
      out.push(`> ${a.text}${anchor ? ` — on "${anchor.text}"` : ''}`);
      out.push('');
    }
  }

  return `${out.join('\n').trimEnd()}\n`;
};
