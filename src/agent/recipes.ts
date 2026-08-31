import { useSceneStore } from '../state/sceneStore';
import { chronoKey } from './layout';
import { wait } from './motion';

/**
 * Scripted agent behaviours for the in-page console.
 *
 * These exist so the product is demonstrable in any browser, and so the same
 * handlers can be exercised without a model in the loop. Every recipe calls the
 * REAL registered tool through the same entry point a WebMCP host uses — it
 * picks ids out of `get_scene` exactly as a model would, then calls the tool.
 * Nothing here is a private back door into the store.
 */

type Call = (name: string, args: unknown) => Promise<unknown>;

export type Category = 'quote' | 'metric' | 'event' | 'hypothesis' | 'action';

/** The same shallow reading a model does over `get_scene` text. */
export const classify = (text: string): Category => {
  const t = text.trim();
  if (t.startsWith('"') || t.startsWith('“')) return 'quote';
  if (/^h\d\s*[:.]/i.test(t)) return 'hypothesis';
  if (chronoKey(t) !== null && /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(t)) {
    return 'event';
  }
  if (/\d+\s*%|p\d{2}\b|median|\d+(\.\d+)?x\b|qoq|↑|↓/i.test(t)) return 'metric';
  return 'action';
};

const byCategory = (): Record<Category, { id: string; text: string }[]> => {
  const nodes = useSceneStore.getState().scene.nodes.filter((n) => n.kind === 'idea');
  const out: Record<Category, { id: string; text: string }[]> = {
    quote: [], metric: [], event: [], hypothesis: [], action: [],
  };
  for (const n of nodes) out[classify(n.text)].push({ id: n.id, text: n.text });
  return out;
};

export interface Recipe {
  id: string;
  title: string;
  blurb: string;
  tool: string;
  run: (call: Call) => Promise<unknown>;
}

export const RECIPES: Recipe[] = [
  {
    id: 'read',
    title: 'Read the board',
    blurb: 'Pull every note as structured JSON — ids and text, no screenshot.',
    tool: 'get_scene',
    run: (call) => call('get_scene', {}),
  },
  {
    id: 'timeline',
    title: 'Build the timeline',
    blurb: 'Find every dated note and lay them out left-to-right in real chronological order.',
    tool: 'arrange_region',
    run: async (call) => {
      const groups = byCategory();
      if (groups.event.length < 2) throw new Error('No dated notes on the board.');
      return call('arrange_region', {
        nodeIds: groups.event.map((n) => n.id),
        layout: 'timeline_horizontal',
        label: 'What happened, in order',
      });
    },
  },
  {
    id: 'affinity',
    title: 'Cluster by kind of evidence',
    blurb: 'Separate interview quotes, metrics and hypotheses into three affinity clusters.',
    tool: 'arrange_region ×3',
    run: async (call) => {
      const groups = byCategory();
      const plan: [Category, string][] = [
        ['quote', 'What people said'],
        ['metric', 'What the numbers say'],
        ['hypothesis', 'Hypotheses'],
      ];
      const results = [];
      for (const [category, label] of plan) {
        if (groups[category].length < 2) continue;
        results.push(
          await call('arrange_region', {
            nodeIds: groups[category].map((n) => n.id),
            layout: 'cluster',
            label,
          }),
        );
        await wait(120);
      }
      return results;
    },
  },
  {
    id: 'matrix',
    title: 'Lay the actions out as a grid',
    blurb: 'Put every proposed action into an even grid so nothing hides behind anything else.',
    tool: 'arrange_region',
    run: async (call) => {
      const groups = byCategory();
      if (groups.action.length < 2) throw new Error('No action notes on the board.');
      return call('arrange_region', {
        nodeIds: groups.action.map((n) => n.id),
        layout: 'grid',
        label: 'Proposed actions',
      });
    },
  },
  {
    id: 'link',
    title: 'Link evidence to hypotheses',
    blurb: 'Read the text of every note and draw labelled edges from supporting evidence to each hypothesis.',
    tool: 'find_and_link',
    run: async (call) => {
      const groups = byCategory();
      const evidence = [...groups.quote, ...groups.metric];
      const links: { from: string; to: string; label: string }[] = [];

      // Keyword overlap stands in for the model's judgement about relatedness.
      const KEYS: Record<string, RegExp> = {
        'step 3': /step 3|workspace|team size|team-size|didn't know|don't have/i,
        email: /email|verification|deliver|magic.?link/i,
        mobile: /mobile|cta|layout|screenshot/i,
        preview: /preview|poke around|sandbox|demo|before signing/i,
      };

      for (const h of groups.hypothesis) {
        const key = Object.entries(KEYS).find(([, re]) => re.test(h.text));
        if (!key) continue;
        for (const e of evidence) {
          if (key[1].test(e.text)) {
            links.push({ from: e.id, to: h.id, label: 'supports' });
          }
        }
      }
      if (links.length === 0) throw new Error('No supporting evidence found to link.');
      return call('find_and_link', { criterion: 'evidence supports hypothesis', links: links.slice(0, 10) });
    },
  },
  {
    id: 'annotate',
    title: 'Point out what is missing',
    blurb: 'Leave a floating comment on the board without moving a single note.',
    tool: 'annotate_scene',
    run: async (call) => {
      const groups = byCategory();
      const target = groups.hypothesis[0] ?? groups.metric[0];
      return call('annotate_scene', {
        text:
          'Every hypothesis here has qualitative support but only H2 has a metric attached. ' +
          'Worth instrumenting before you commit engineering time.',
        ...(target ? { nodeId: target.id } : {}),
      });
    },
  },
  {
    id: 'summarize',
    title: 'Collapse the quotes into one finding',
    blurb: 'Gather the interview quotes to a single point and replace them with one summary note.',
    tool: 'summarize_cluster',
    run: async (call) => {
      const groups = byCategory();
      if (groups.quote.length < 2) throw new Error('No quotes left to collapse.');
      return call('summarize_cluster', {
        nodeIds: groups.quote.map((n) => n.id),
        summary: 'Finding: users abandon when asked for information they do not have yet',
      });
    },
  },
  {
    id: 'add',
    title: 'Add the open questions',
    blurb: 'Write new notes onto the canvas for the gaps the board does not cover.',
    tool: 'add_notes',
    run: (call) =>
      call('add_notes', {
        texts: [
          'Open: what does step 3 look like on a 375px screen?',
          'Open: did the email regression predate the flow change?',
          'Open: which cohort drives the mobile gap — new vs. invited?',
        ],
      }),
  },
  {
    id: 'reorg',
    title: 'Reorganise the entire board',
    blurb: 'The one destructive action — moves everything at once, so it asks you first.',
    tool: 'reorganize_board',
    run: async (call) => {
      const groups = byCategory();
      const plan = [
        { label: 'Timeline', nodeIds: groups.event.map((n) => n.id), layout: 'timeline_horizontal' },
        { label: 'Evidence', nodeIds: [...groups.quote, ...groups.metric].map((n) => n.id), layout: 'cluster' },
        { label: 'Hypotheses', nodeIds: groups.hypothesis.map((n) => n.id), layout: 'grid' },
        { label: 'Actions', nodeIds: groups.action.map((n) => n.id), layout: 'grid' },
      ].filter((g) => g.nodeIds.length > 0);

      return call('reorganize_board', {
        rationale:
          'Right now evidence, dates, theories and to-dos are interleaved. Separating them by ' +
          'kind makes the causal story readable left to right.',
        groups: plan,
      });
    },
  },
  {
    id: 'undo',
    title: 'Undo my last change',
    blurb: 'The agent reverts its own most recent action.',
    tool: 'undo_last_agent_action',
    run: (call) => call('undo_last_agent_action', {}),
  },
];
