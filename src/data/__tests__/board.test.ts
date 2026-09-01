import { describe, expect, it } from 'vitest';
import { MAX_NOTES, parseNotes, sceneFromTexts } from '../importBoard';
import { toMarkdown } from '../exportMarkdown';
import { seedScene } from '../seed';
import { scatter } from '../scatter';
import type { Scene } from '../../state/types';

describe('parseNotes', () => {
  it('makes one note per non-empty line', () => {
    expect(parseNotes('alpha\n\nbeta\n   \ngamma')).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('strips list marks, checkboxes and markdown headings', () => {
    expect(parseNotes('- alpha\n* beta\n1. gamma\n[ ] delta\n## epsilon')).toEqual([
      'alpha',
      'beta',
      'gamma',
      'delta',
      'epsilon',
    ]);
  });

  it('strips stacked marks on one line', () => {
    expect(parseNotes('- [ ] ship the thing')).toEqual(['ship the thing']);
  });

  it('drops duplicates case-insensitively, keeping the first', () => {
    expect(parseNotes('Alpha\nbeta\nALPHA')).toEqual(['Alpha', 'beta']);
  });

  it('truncates very long lines rather than dropping them', () => {
    const [note] = parseNotes('x'.repeat(400));
    expect(note).toHaveLength(160);
    expect(note.endsWith('…')).toBe(true);
  });

  it('caps the board so a pasted book cannot lock the page up', () => {
    const many = Array.from({ length: 500 }, (_, i) => `note ${i}`).join('\n');
    expect(parseNotes(many)).toHaveLength(MAX_NOTES);
  });

  it('returns nothing for whitespace', () => {
    expect(parseNotes('   \n\n\t')).toEqual([]);
  });
});

describe('sceneFromTexts', () => {
  it('lays every note out with a stable id and no overlap of ids', () => {
    const scene = sceneFromTexts(['a', 'b', 'c', 'd']);
    expect(scene.nodes).toHaveLength(4);
    expect(new Set(scene.nodes.map((n) => n.id)).size).toBe(4);
    expect(scene.edges).toEqual([]);
    expect(scene.regions).toEqual([]);
  });

  it('colours notes by what they look like, so the recipes can group them', () => {
    const scene = sceneFromTexts(['"a user said this"', 'Signups down 31% QoQ']);
    expect(scene.nodes[0].color).not.toBe(scene.nodes[1].color);
  });

  it('starts every imported note owned by the human', () => {
    const scene = sceneFromTexts(['a', 'b']);
    expect(scene.nodes.every((n) => n.lastEditedBy === 'human')).toBe(true);
  });

  it('is deterministic, so a demo recorded twice looks the same twice', () => {
    expect(sceneFromTexts(['a', 'b', 'c'])).toEqual(sceneFromTexts(['a', 'b', 'c']));
  });
});

describe('scatter', () => {
  it('keeps the seeded demo board exactly where it has always been', () => {
    // The seed board is what every screenshot and the demo video show.
    const seeded = seedScene();
    const points = scatter(seeded.nodes.length);
    expect(points.map((p) => p.x)).toEqual(seeded.nodes.map((n) => n.x));
    expect(points.map((p) => p.y)).toEqual(seeded.nodes.map((n) => n.y));
  });
});

const scene = (over: Partial<Scene> = {}): Scene => ({
  nodes: [],
  edges: [],
  annotations: [],
  regions: [],
  ...over,
});

const note = (id: string, text: string, x = 0, over = {}) => ({
  id,
  text,
  x,
  y: 0,
  w: 176,
  h: 84,
  color: '#fff',
  cluster: null,
  kind: 'idea' as const,
  lastEditedBy: 'human' as const,
  editedAt: 0,
  selected: false,
  ...over,
});

describe('toMarkdown', () => {
  it('writes groups as headings with their notes beneath', () => {
    const md = toMarkdown(
      scene({
        nodes: [note('n1', 'Mar 3 — flow ships'), note('n2', 'Mar 11 — migration')],
        regions: [
          {
            id: 'r1',
            label: 'What happened, in order',
            layout: 'timeline_horizontal',
            nodeIds: ['n1', 'n2'],
            lastEditedBy: 'agent',
            editedAt: 0,
          },
        ],
      }),
    );
    expect(md).toContain('## What happened, in order _(timeline)_');
    expect(md).toContain('- Mar 3 — flow ships');
    expect(md).toContain('- Mar 11 — migration');
  });

  it('orders groups left to right, the way the eye reads the board', () => {
    const md = toMarkdown(
      scene({
        nodes: [note('n1', 'right one', 900), note('n2', 'left one', 10)],
        regions: [
          { id: 'r1', label: 'Right', layout: 'grid', nodeIds: ['n1'], lastEditedBy: 'agent', editedAt: 0 },
          { id: 'r2', label: 'Left', layout: 'grid', nodeIds: ['n2'], lastEditedBy: 'agent', editedAt: 0 },
        ],
      }),
    );
    expect(md.indexOf('## Left')).toBeLessThan(md.indexOf('## Right'));
  });

  it('keeps ungrouped notes rather than silently losing them', () => {
    const md = toMarkdown(scene({ nodes: [note('n1', 'loose thought')] }));
    expect(md).toContain('## Notes');
    expect(md).toContain('- loose thought');
  });

  it('attributes what the agent wrote', () => {
    const md = toMarkdown(
      scene({ nodes: [note('n1', 'agent wrote this', 0, { lastEditedBy: 'agent' })] }),
    );
    expect(md).toContain('- agent wrote this _(agent)_');
  });

  it('renders edges and annotations in readable prose, not ids', () => {
    const md = toMarkdown(
      scene({
        nodes: [note('n1', 'evidence'), note('n2', 'hypothesis')],
        edges: [
          { id: 'e1', from: 'n1', to: 'n2', label: 'supports', lastEditedBy: 'agent', editedAt: 0 },
        ],
        annotations: [
          { id: 'a1', text: 'only H2 has a metric', nodeId: 'n2', x: 0, y: 0, lastEditedBy: 'agent', editedAt: 0 },
        ],
      }),
    );
    expect(md).toContain('- evidence → hypothesis — supports');
    expect(md).toContain('> only H2 has a metric — on "hypothesis"');
    expect(md).not.toContain('n1');
  });

  it('survives an empty board', () => {
    expect(toMarkdown(scene())).toContain('0 notes');
  });

  it('drops edges whose endpoints are gone rather than throwing', () => {
    const md = toMarkdown(
      scene({
        nodes: [note('n1', 'orphan')],
        edges: [
          { id: 'e1', from: 'n1', to: 'gone', label: 'x', lastEditedBy: 'agent', editedAt: 0 },
        ],
      }),
    );
    expect(md).not.toContain('— x');
  });
});
