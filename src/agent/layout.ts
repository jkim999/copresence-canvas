import type { Bounds, LayoutKind, SceneEdge, SceneNode } from '../state/types';

export type Positions = Record<string, { x: number; y: number }>;

const GAP_X = 40;
const GAP_Y = 44;

export const centroidOf = (nodes: SceneNode[]): { x: number; y: number } => {
  if (nodes.length === 0) return { x: 0, y: 0 };
  const sum = nodes.reduce(
    (acc, n) => ({ x: acc.x + n.x + n.w / 2, y: acc.y + n.y + n.h / 2 }),
    { x: 0, y: 0 },
  );
  return { x: sum.x / nodes.length, y: sum.y / nodes.length };
};

export const boundsOf = (nodes: SceneNode[], pad = 0): Bounds => {
  if (nodes.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  const minX = Math.min(...nodes.map((n) => n.x)) - pad;
  const minY = Math.min(...nodes.map((n) => n.y)) - pad;
  const maxX = Math.max(...nodes.map((n) => n.x + n.w)) + pad;
  const maxY = Math.max(...nodes.map((n) => n.y + n.h)) + pad;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
};

// ---------------------------------------------------------------------------
// Chronology inference — lets `timeline_horizontal` order notes by the dates
// written on them rather than by wherever they happen to be sitting.
// ---------------------------------------------------------------------------

const MONTHS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
];

/** Returns a comparable time-ish number, or null when the text has no date. */
export const chronoKey = (text: string): number | null => {
  const lower = text.toLowerCase();

  const iso = lower.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return Number(iso[1]) * 10000 + Number(iso[2]) * 100 + Number(iso[3]);

  const monthDay = lower.match(
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/,
  );
  if (monthDay) return 20000000 + (MONTHS.indexOf(monthDay[1]) + 1) * 100 + Number(monthDay[2]);

  const quarter = lower.match(/\bq([1-4])\b/);
  if (quarter) return 10000000 + Number(quarter[1]) * 1000;

  const ordinal = lower.match(/\b(?:step|phase|week|day|stage|sprint)\s+(\d{1,3})\b/);
  if (ordinal) return 1000000 + Number(ordinal[1]);

  const year = lower.match(/\b(19|20)\d{2}\b/);
  if (year) return Number(year[0]) * 10000;

  return null;
};

// ---------------------------------------------------------------------------
// Layouts. Every layout is centred on the group's own centroid so the board
// reorganises in place instead of teleporting across the world.
// ---------------------------------------------------------------------------

const clusterLayout = (nodes: SceneNode[]): Positions => {
  const c = centroidOf(nodes);
  const out: Positions = {};
  const cell = { w: nodes[0].w + GAP_X * 0.5, h: nodes[0].h + GAP_Y * 0.5 };

  // Concentric rings: 1 in the middle, then 6, 12, 18 ... reads as a cluster.
  let index = 0;
  let ring = 0;
  while (index < nodes.length) {
    const count = ring === 0 ? 1 : ring * 6;
    const radius = ring * Math.max(cell.w, cell.h) * 0.78;
    const take = Math.min(count, nodes.length - index);
    for (let i = 0; i < take; i += 1) {
      // Spread over however many notes this ring actually holds. Using the
      // ring's full capacity would bunch a partial ring into one arc and pull
      // the whole cluster off its own centre.
      const angle = (i / take) * Math.PI * 2 - Math.PI / 2 + ring * 0.35;
      const n = nodes[index + i];
      out[n.id] = {
        x: c.x + Math.cos(angle) * radius - n.w / 2,
        y: c.y + Math.sin(angle) * radius * 0.82 - n.h / 2,
      };
    }
    index += take;
    ring += 1;
  }
  return out;
};

const timelineLayout = (nodes: SceneNode[]): Positions => {
  const keyed = nodes.map((n) => ({ n, key: chronoKey(n.text) }));
  const anyDates = keyed.some((k) => k.key !== null);
  const ordered = [...keyed].sort((a, b) => {
    if (anyDates) {
      // Undated notes trail the dated ones rather than scrambling the sequence.
      if (a.key === null && b.key === null) return a.n.x - b.n.x;
      if (a.key === null) return 1;
      if (b.key === null) return -1;
      return a.key - b.key;
    }
    return a.n.x - b.n.x;
  }).map((k) => k.n);

  const c = centroidOf(nodes);
  const step = ordered[0].w + GAP_X;
  const totalWidth = step * ordered.length - GAP_X;
  const startX = c.x - totalWidth / 2;
  const out: Positions = {};
  ordered.forEach((n, i) => {
    // Gentle alternating offset keeps long labels from colliding visually.
    const stagger = i % 2 === 0 ? -18 : 18;
    out[n.id] = { x: startX + i * step, y: c.y - n.h / 2 + stagger };
  });
  return out;
};

const gridLayout = (nodes: SceneNode[]): Positions => {
  const cols = Math.max(1, Math.round(Math.sqrt(nodes.length * 1.35)));
  const rows = Math.ceil(nodes.length / cols);
  const c = centroidOf(nodes);
  const stepX = nodes[0].w + GAP_X;
  const stepY = nodes[0].h + GAP_Y;
  const startX = c.x - (cols * stepX - GAP_X) / 2;
  const startY = c.y - (rows * stepY - GAP_Y) / 2;

  const out: Positions = {};
  nodes.forEach((n, i) => {
    out[n.id] = {
      x: startX + (i % cols) * stepX,
      y: startY + Math.floor(i / cols) * stepY,
    };
  });
  return out;
};

const hierarchyLayout = (nodes: SceneNode[], edges: SceneEdge[]): Positions => {
  const ids = new Set(nodes.map((n) => n.id));
  const inner = edges.filter((e) => ids.has(e.from) && ids.has(e.to));

  const depth = new Map<string, number>();
  if (inner.length > 0) {
    const children = new Map<string, string[]>();
    const hasParent = new Set<string>();
    for (const e of inner) {
      children.set(e.from, [...(children.get(e.from) ?? []), e.to]);
      hasParent.add(e.to);
    }
    const roots = nodes.filter((n) => !hasParent.has(n.id)).map((n) => n.id);
    const queue = (roots.length > 0 ? roots : [nodes[0].id]).map((id) => ({ id, d: 0 }));
    while (queue.length > 0) {
      const { id, d } = queue.shift()!;
      if (depth.has(id)) continue;
      depth.set(id, d);
      for (const child of children.get(id) ?? []) queue.push({ id: child, d: d + 1 });
    }
    // Anything unreachable sits on the deepest layer.
    const maxDepth = Math.max(0, ...depth.values());
    for (const n of nodes) if (!depth.has(n.id)) depth.set(n.id, maxDepth + 1);
  } else {
    // No edges to read: fan out 1 → 2 → 4 → 8 in the order the agent gave us.
    let layer = 0;
    let capacity = 1;
    let placed = 0;
    for (const n of nodes) {
      depth.set(n.id, layer);
      placed += 1;
      if (placed >= capacity) {
        placed = 0;
        layer += 1;
        capacity = Math.min(capacity * 2, 6);
      }
    }
  }

  const layers = new Map<number, SceneNode[]>();
  for (const n of nodes) {
    const d = depth.get(n.id) ?? 0;
    layers.set(d, [...(layers.get(d) ?? []), n]);
  }

  const c = centroidOf(nodes);
  const stepY = nodes[0].h + GAP_Y * 1.6;
  const depths = [...layers.keys()].sort((a, b) => a - b);
  const startY = c.y - ((depths.length - 1) * stepY) / 2 - nodes[0].h / 2;

  const out: Positions = {};
  depths.forEach((d, rowIndex) => {
    const row = layers.get(d)!;
    const stepX = row[0].w + GAP_X;
    const startX = c.x - (row.length * stepX - GAP_X) / 2;
    row.forEach((n, i) => {
      out[n.id] = { x: startX + i * stepX, y: startY + rowIndex * stepY };
    });
  });
  return out;
};

export const applyLayout = (
  nodes: SceneNode[],
  layout: LayoutKind,
  edges: SceneEdge[] = [],
): Positions => {
  if (nodes.length === 0) return {};
  switch (layout) {
    case 'cluster':
      return clusterLayout(nodes);
    case 'timeline_horizontal':
      return timelineLayout(nodes);
    case 'grid':
      return gridLayout(nodes);
    case 'hierarchy':
      return hierarchyLayout(nodes, edges);
  }
};

/**
 * Order the agent should physically visit nodes in: nearest-neighbour from its
 * current position. A tidy path reads as intent; a random path reads as noise.
 */
export const visitOrder = (
  nodes: SceneNode[],
  from: { x: number; y: number },
): SceneNode[] => {
  const remaining = [...nodes];
  const path: SceneNode[] = [];
  let cursor = from;
  while (remaining.length > 0) {
    let best = 0;
    let bestDistance = Infinity;
    remaining.forEach((n, i) => {
      const d = Math.hypot(n.x + n.w / 2 - cursor.x, n.y + n.h / 2 - cursor.y);
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    });
    const [next] = remaining.splice(best, 1);
    path.push(next);
    cursor = { x: next.x + next.w / 2, y: next.y + next.h / 2 };
  }
  return path;
};

/** Push nodes apart so an agent layout never leaves two notes overlapping. */
export const relaxOverlaps = (
  placed: { id: string; x: number; y: number; w: number; h: number }[],
  iterations = 24,
): Positions => {
  const items = placed.map((p) => ({ ...p }));
  for (let iter = 0; iter < iterations; iter += 1) {
    let moved = false;
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        const a = items[i];
        const b = items[j];
        const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) + 16;
        const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) + 16;
        if (overlapX <= 0 || overlapY <= 0) continue;
        moved = true;
        if (overlapX < overlapY) {
          const push = (overlapX / 2) * (a.x <= b.x ? 1 : -1);
          a.x -= push;
          b.x += push;
        } else {
          const push = (overlapY / 2) * (a.y <= b.y ? 1 : -1);
          a.y -= push;
          b.y += push;
        }
      }
    }
    if (!moved) break;
  }
  const out: Positions = {};
  for (const item of items) out[item.id] = { x: item.x, y: item.y };
  return out;
};
