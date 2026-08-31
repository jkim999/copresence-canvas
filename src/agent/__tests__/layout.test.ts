import { describe, expect, it } from 'vitest';
import {
  applyLayout,
  boundsOf,
  centroidOf,
  chronoKey,
  relaxOverlaps,
  visitOrder,
} from '../layout';
import type { SceneEdge, SceneNode } from '../../state/types';

const note = (id: string, text: string, x: number, y: number): SceneNode => ({
  id,
  text,
  x,
  y,
  w: 176,
  h: 84,
  color: '#fff',
  cluster: null,
  kind: 'idea',
  lastEditedBy: 'human',
  editedAt: 0,
  selected: false,
});

const overlaps = (a: SceneNode & { x: number; y: number }, b: SceneNode) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('chronoKey', () => {
  it('orders month/day dates within a year', () => {
    const mar3 = chronoKey('Mar 3 — new signup flow ships')!;
    const mar11 = chronoKey('Mar 11 — email provider migration')!;
    const apr2 = chronoKey('Apr 2 — mobile web redesign')!;
    expect(mar3).toBeLessThan(mar11);
    expect(mar11).toBeLessThan(apr2);
  });

  it('reads ISO dates, quarters and ordinals', () => {
    expect(chronoKey('shipped 2026-04-15')).toBeTruthy();
    expect(chronoKey('Q1 planning')!).toBeLessThan(chronoKey('Q3 planning')!);
    expect(chronoKey('step 2 of onboarding')!).toBeLessThan(chronoKey('step 9 of onboarding')!);
  });

  it('returns null when there is no date to read', () => {
    expect(chronoKey('users abandon the workspace step')).toBeNull();
    expect(chronoKey('62% of drop-off happens on 3 of 5')).toBeNull();
  });
});

describe('applyLayout', () => {
  it('orders a timeline by the dates written on the notes, not their positions', () => {
    // Deliberately seeded in reverse chronological x order.
    const nodes = [
      note('a', 'Apr 28 — research sprint kicks off', 0, 0),
      note('b', 'Mar 3 — new signup flow ships', 400, 0),
      note('c', 'Apr 2 — mobile web redesign', 800, 0),
    ];
    const out = applyLayout(nodes, 'timeline_horizontal');
    expect(out.b.x).toBeLessThan(out.c.x);
    expect(out.c.x).toBeLessThan(out.a.x);
  });

  it('falls back to spatial order when nothing is dated', () => {
    const nodes = [
      note('a', 'third', 800, 0),
      note('b', 'first', 0, 0),
      note('c', 'second', 400, 0),
    ];
    const out = applyLayout(nodes, 'timeline_horizontal');
    expect(out.b.x).toBeLessThan(out.c.x);
    expect(out.c.x).toBeLessThan(out.a.x);
  });

  it('layers a hierarchy by edge depth', () => {
    const nodes = [note('root', 'H1', 0, 0), note('kid', 'fix', 300, 0), note('grandkid', 'sub', 600, 0)];
    const edges: SceneEdge[] = [
      { id: 'e1', from: 'root', to: 'kid', label: '', lastEditedBy: 'agent', editedAt: 0 },
      { id: 'e2', from: 'kid', to: 'grandkid', label: '', lastEditedBy: 'agent', editedAt: 0 },
    ];
    const out = applyLayout(nodes, 'hierarchy', edges);
    expect(out.root.y).toBeLessThan(out.kid.y);
    expect(out.kid.y).toBeLessThan(out.grandkid.y);
  });

  it('keeps every layout centred on the group it was given', () => {
    const nodes = [note('a', 'one', 1000, 1000), note('b', 'two', 1300, 1000), note('c', 'three', 1150, 1200)];
    const before = centroidOf(nodes);
    for (const layout of ['cluster', 'grid', 'timeline_horizontal', 'hierarchy'] as const) {
      const out = applyLayout(nodes, layout);
      const after = centroidOf(nodes.map((n) => ({ ...n, x: out[n.id].x, y: out[n.id].y })));
      expect(Math.abs(after.x - before.x)).toBeLessThan(40);
      expect(Math.abs(after.y - before.y)).toBeLessThan(40);
    }
  });

  it('returns a position for every node it was given', () => {
    const nodes = Array.from({ length: 13 }, (_, i) => note(`n${i}`, `note ${i}`, i * 7, i * 3));
    for (const layout of ['cluster', 'grid', 'timeline_horizontal', 'hierarchy'] as const) {
      const out = applyLayout(nodes, layout);
      expect(Object.keys(out).sort()).toEqual(nodes.map((n) => n.id).sort());
      for (const p of Object.values(out)) {
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
      }
    }
  });

  it('handles a single node without dividing by zero', () => {
    const one = [note('solo', 'alone', 5, 5)];
    for (const layout of ['cluster', 'grid', 'timeline_horizontal', 'hierarchy'] as const) {
      const out = applyLayout(one, layout);
      expect(Number.isFinite(out.solo.x)).toBe(true);
    }
  });
});

describe('relaxOverlaps', () => {
  it('separates notes stacked on the same point', () => {
    const stacked = Array.from({ length: 6 }, (_, i) => ({ id: `n${i}`, x: 0, y: 0, w: 176, h: 84 }));
    const out = relaxOverlaps(stacked);
    const placed = stacked.map((n) => ({ ...note(n.id, '', 0, 0), x: out[n.id].x, y: out[n.id].y }));
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        expect(overlaps(placed[i], placed[j])).toBe(false);
      }
    }
  });

  it('leaves already-separated notes alone', () => {
    const spread = [
      { id: 'a', x: 0, y: 0, w: 176, h: 84 },
      { id: 'b', x: 500, y: 0, w: 176, h: 84 },
    ];
    const out = relaxOverlaps(spread);
    expect(out.a).toEqual({ x: 0, y: 0 });
    expect(out.b).toEqual({ x: 500, y: 0 });
  });
});

describe('visitOrder', () => {
  it('walks nearest-neighbour from the cursor', () => {
    const nodes = [note('far', 'far', 2000, 2000), note('near', 'near', 10, 10), note('mid', 'mid', 600, 600)];
    const order = visitOrder(nodes, { x: 0, y: 0 }).map((n) => n.id);
    expect(order).toEqual(['near', 'mid', 'far']);
  });

  it('visits every node exactly once', () => {
    const nodes = Array.from({ length: 9 }, (_, i) => note(`n${i}`, '', i * 137, (i * 91) % 400));
    const order = visitOrder(nodes, { x: 0, y: 0 });
    expect(new Set(order.map((n) => n.id)).size).toBe(9);
  });
});

describe('boundsOf', () => {
  it('covers every node and honours padding', () => {
    const nodes = [note('a', '', 0, 0), note('b', '', 300, 200)];
    const tight = boundsOf(nodes);
    expect(tight).toEqual({ x: 0, y: 0, w: 476, h: 284 });
    expect(boundsOf(nodes, 10)).toEqual({ x: -10, y: -10, w: 496, h: 304 });
  });
});
