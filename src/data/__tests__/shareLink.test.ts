import { describe, expect, it } from 'vitest';
import {
  MAX_SHARE_NODES,
  decodeScene,
  encodeScene,
  hashForScene,
  sceneFromHash,
} from '../shareLink';
import { seedScene } from '../seed';
import { MAX_NOTES } from '../importBoard';
import type { Scene, SceneNode } from '../../state/types';

const node = (id: string, over: Partial<SceneNode> = {}): SceneNode => ({
  id,
  text: `text ${id}`,
  x: 10,
  y: 20,
  w: 176,
  h: 84,
  color: '#faf1e8',
  cluster: null,
  kind: 'idea',
  lastEditedBy: 'human',
  editedAt: 0,
  selected: false,
  ...over,
});

const scene = (over: Partial<Scene> = {}): Scene => ({
  nodes: [node('n_00'), node('n_01')],
  edges: [],
  annotations: [],
  regions: [],
  ...over,
});

const roundTrip = (s: Scene): Scene => {
  const decoded = decodeScene(encodeScene(s));
  if (!decoded) throw new Error('expected the scene to decode');
  return decoded;
};

describe('encodeScene / decodeScene', () => {
  it('round-trips a full board', () => {
    const source = scene({
      nodes: [node('n_00'), node('n_01'), node('n_02')],
      edges: [
        { id: 'e_0', from: 'n_00', to: 'n_01', label: 'supports', lastEditedBy: 'agent', editedAt: 5 },
      ],
      annotations: [
        { id: 'a_0', text: 'only H2 has a metric', nodeId: 'n_01', x: 4, y: 8, lastEditedBy: 'agent', editedAt: 5 },
      ],
      regions: [
        { id: 'r_0', label: 'What happened', layout: 'timeline_horizontal', nodeIds: ['n_00', 'n_02'], lastEditedBy: 'agent', editedAt: 5 },
      ],
    });

    const out = roundTrip(source);

    expect(out.nodes.map((n) => n.id)).toEqual(['n_00', 'n_01', 'n_02']);
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0]).toMatchObject({ from: 'n_00', to: 'n_01', label: 'supports' });
    expect(out.annotations[0]).toMatchObject({ text: 'only H2 has a metric', nodeId: 'n_01' });
    expect(out.regions[0]).toMatchObject({ label: 'What happened', layout: 'timeline_horizontal' });
    expect(out.regions[0].nodeIds).toEqual(['n_00', 'n_02']);
  });

  it('preserves the structure the agent produced — position, tint and authorship', () => {
    const source = scene({
      nodes: [node('n_00', { x: -412, y: 903, color: '#ebf1f4', lastEditedBy: 'agent', kind: 'summary' })],
    });

    const out = roundTrip(source);

    expect(out.nodes[0]).toMatchObject({
      x: -412,
      y: 903,
      color: '#ebf1f4',
      lastEditedBy: 'agent',
      kind: 'summary',
    });
  });

  it('reconciles node.cluster with the region that claims it', () => {
    const source = scene({
      nodes: [node('n_00', { cluster: 'r_gone' })],
      regions: [
        { id: 'r_0', label: 'Group', layout: 'cluster', nodeIds: ['n_00'], lastEditedBy: 'agent', editedAt: 0 },
      ],
    });

    expect(roundTrip(source).nodes[0].cluster).toBe('r_0');
  });

  it('lands transient state cold: nothing selected, no provenance tint mid-fade', () => {
    const source = scene({ nodes: [node('n_00', { selected: true, editedAt: Date.now() })] });

    const out = roundTrip(source);

    expect(out.nodes[0].selected).toBe(false);
    expect(out.nodes[0].editedAt).toBe(0);
  });

  // The fragment never reaches a server, so the only real ceiling is what a
  // browser and a chat client will carry. 8k is the conservative floor across
  // both; the biggest board the import path can build must fit under it.
  it('keeps a full board inside a pasteable URL', () => {
    const seed = seedScene();
    expect(encodeScene(seed).length).toBeLessThan(2200);

    const worst: Scene = {
      nodes: Array.from({ length: MAX_NOTES }, (_, i) => ({
        ...seed.nodes[i % seed.nodes.length],
        id: `n_${i}`,
        text: 'A pasted retro line of roughly the length people actually write',
        lastEditedBy: i % 2 ? 'agent' : 'human',
      })),
      edges: seed.nodes.slice(0, 12).map((n, i) => ({
        id: `e_${i}`,
        from: n.id,
        to: seed.nodes[i + 12].id,
        label: 'supports',
        lastEditedBy: 'agent',
        editedAt: 0,
      })),
      annotations: [
        { id: 'a_0', text: 'Only one of these has a metric behind it.', nodeId: 'n_0', x: 0, y: 0, lastEditedBy: 'agent', editedAt: 0 },
      ],
      regions: Array.from({ length: 5 }, (_, i) => ({
        id: `r_${i}`,
        label: 'What happened, in order',
        layout: 'timeline_horizontal',
        nodeIds: Array.from({ length: 5 }, (_, j) => `n_${i * 5 + j}`),
        lastEditedBy: 'agent',
        editedAt: 0,
      })),
    };

    expect(encodeScene(worst).length).toBeLessThan(8000);
  });
});

describe('decodeScene rejects what it cannot trust', () => {
  it('returns null for junk, empty input and a bad version', () => {
    expect(decodeScene('')).toBeNull();
    expect(decodeScene('not-compressed-at-all')).toBeNull();
    expect(decodeScene(encodeScene(scene())?.replace(/^./, 'X'))).toBeNull();
  });

  it('returns null for a payload with no usable nodes', () => {
    expect(decodeScene(encodeScene(scene({ nodes: [] })))).toBeNull();
  });

  it('refuses a colour that is not a plain hex, so a link cannot inject CSS', () => {
    const source = scene({ nodes: [node('n_00', { color: 'url(https://tracker.example/p.png)' })] });

    expect(roundTrip(source).nodes[0].color).not.toContain('url(');
    expect(roundTrip(source).nodes[0].color).toMatch(/^#[0-9a-f]{3,8}$/i);
  });

  it('drops edges and annotations that point at notes the payload does not carry', () => {
    const source = scene({
      edges: [
        { id: 'e_0', from: 'n_00', to: 'n_missing', label: 'x', lastEditedBy: 'agent', editedAt: 0 },
      ],
      annotations: [
        { id: 'a_0', text: 'orphan', nodeId: 'n_missing', x: 0, y: 0, lastEditedBy: 'agent', editedAt: 0 },
      ],
    });

    const out = roundTrip(source);

    expect(out.edges).toHaveLength(0);
    expect(out.annotations).toHaveLength(0);
  });

  it('keeps a floating annotation that is anchored to nothing', () => {
    const source = scene({
      annotations: [
        { id: 'a_0', text: 'about the board', nodeId: null, x: 12, y: 14, lastEditedBy: 'agent', editedAt: 0 },
      ],
    });

    expect(roundTrip(source).annotations).toHaveLength(1);
  });

  it('filters regions to surviving notes and drops the ones left empty', () => {
    const source = scene({
      regions: [
        { id: 'r_0', label: 'Half here', layout: 'grid', nodeIds: ['n_00', 'n_gone'], lastEditedBy: 'agent', editedAt: 0 },
        { id: 'r_1', label: 'All gone', layout: 'grid', nodeIds: ['n_gone'], lastEditedBy: 'agent', editedAt: 0 },
      ],
    });

    const out = roundTrip(source);

    expect(out.regions).toHaveLength(1);
    expect(out.regions[0].nodeIds).toEqual(['n_00']);
  });

  it('gives a note claimed by two regions to exactly one', () => {
    const source = scene({
      regions: [
        { id: 'r_0', label: 'First', layout: 'grid', nodeIds: ['n_00', 'n_01'], lastEditedBy: 'agent', editedAt: 0 },
        { id: 'r_1', label: 'Second', layout: 'grid', nodeIds: ['n_00'], lastEditedBy: 'agent', editedAt: 0 },
      ],
    });

    const out = roundTrip(source);
    const claims = out.regions.filter((r) => r.nodeIds.includes('n_00'));

    expect(claims).toHaveLength(1);
    expect(out.regions.every((r) => r.nodeIds.length > 0)).toBe(true);
  });

  it('drops duplicate note ids rather than rendering two notes that cannot be told apart', () => {
    const source = scene({ nodes: [node('n_00'), node('n_00', { text: 'impostor' })] });

    const out = roundTrip(source);

    expect(out.nodes).toHaveLength(1);
    expect(out.nodes[0].text).toBe('text n_00');
  });

  it('caps a hostile payload at MAX_SHARE_NODES', () => {
    const many = Array.from({ length: MAX_SHARE_NODES + 40 }, (_, i) => node(`n_${i}`));

    expect(roundTrip(scene({ nodes: many })).nodes).toHaveLength(MAX_SHARE_NODES);
  });
});

describe('hashForScene / sceneFromHash', () => {
  it('round-trips through a location hash', () => {
    const out = sceneFromHash(hashForScene(scene()));

    expect(out?.nodes.map((n) => n.id)).toEqual(['n_00', 'n_01']);
  });

  it('tolerates the hash with or without its leading #', () => {
    const hash = hashForScene(scene());

    expect(sceneFromHash(hash.slice(1))?.nodes).toHaveLength(2);
  });

  it('ignores a hash that is not a board', () => {
    expect(sceneFromHash('')).toBeNull();
    expect(sceneFromHash('#section-two')).toBeNull();
    expect(sceneFromHash('#b=garbage')).toBeNull();
  });
});
