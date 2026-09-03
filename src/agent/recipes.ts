import { useSceneStore } from '../state/sceneStore';
import { useHostStore } from './webmcp';
import { classify, type Category } from '../data/classify';
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

export type { Category };

/**
 * The read a write cites back.
 *
 * The console stands in for a model's judgement, not for its manners, so it
 * plans the way a well-behaved agent does: read the board, keep the bookmark,
 * hand it back on the write. The page then refuses the act outright if somebody
 * else moved those notes while the recipe was deciding, instead of letting it
 * land on top of their work.
 *
 * One bookmark covers a recipe that writes several times. An agent's own writes
 * are never held against it, and re-reading between its own calls would be
 * pretending to a caution it does not need.
 */
const premise = async (call: Call): Promise<number | undefined> => {
  const scene = (await call('get_scene', {})) as { asOf?: unknown };
  return typeof scene?.asOf === 'number' ? scene.asOf : undefined;
};

/**
 * The bookmark from the last board this seat actually read.
 *
 * Distinct from `premise`, which reads and writes in one breath. A model does
 * not work that way: it looks, thinks for a few seconds, then acts — and the
 * staleness gate exists entirely because of what other people can do in those
 * seconds. Every recipe that takes its own premise closes that window to
 * nothing, which left the console — the only surface a judge without a WebMCP
 * host can drive — unable to demonstrate the rule the page leads with.
 *
 * Read from the ledger rather than from a variable of its own, because the
 * ledger is what the operator can see. The bookmark cited is the one on screen.
 */
const lastRead = (): number | undefined => {
  const reads = useHostStore.getState().calls.filter((c) => c.tool === 'get_scene');
  const asOf = (reads[reads.length - 1]?.result as { asOf?: unknown } | undefined)?.asOf;
  return typeof asOf === 'number' ? asOf : undefined;
};

const byCategory = (): Record<Category, { id: string; text: string }[]> => {
  const nodes = useSceneStore.getState().scene.nodes.filter((n) => n.kind === 'idea');
  const out: Record<Category, { id: string; text: string }[]> = {
    quote: [], metric: [], event: [], hypothesis: [], action: [],
  };
  for (const n of nodes) out[classify(n.text)].push({ id: n.id, text: n.text });
  return out;
};

/** Which shelf of the console a recipe sits on, in the order a user meets them. */
export type RecipeGroup = 'perceive' | 'structure' | 'author' | 'whole board';

export const RECIPE_GROUPS: readonly RecipeGroup[] = [
  'perceive',
  'structure',
  'author',
  'whole board',
];

export interface Recipe {
  id: string;
  title: string;
  blurb: string;
  tool: string;
  group: RecipeGroup;
  run: (call: Call) => Promise<unknown>;
}

export const RECIPES: Recipe[] = [
  {
    id: 'read',
    title: 'Read the board',
    blurb: 'Pull every note as structured JSON — ids and text, no screenshot.',
    tool: 'get_scene',
    group: 'perceive',
    run: (call) => call('get_scene', {}),
  },
  {
    id: 'watch',
    title: 'Notice what I am doing',
    blurb:
      'Hold a note with your mouse, then press this. The agent checks what you are working ' +
      'on and writes what it saw onto the board — without touching your note.',
    tool: 'get_human_activity → annotate_scene',
    group: 'perceive',
    run: async (call) => {
      const activity = (await call('get_human_activity', { sinceSeconds: 120 })) as {
        holdingRightNow: { id: string; text: string }[];
        recentlyTouched: { id: string; text: string; secondsAgo: number }[];
      };

      if (activity.holdingRightNow.length > 0) {
        const held = activity.holdingRightNow[0];
        return call('annotate_scene', {
          text: `You are holding "${held.text}" right now — I'll leave it alone and work around you.`,
          nodeId: held.id,
        });
      }
      if (activity.recentlyTouched.length > 0) {
        const last = activity.recentlyTouched[0];
        return call('annotate_scene', {
          text: `You touched "${last.text}" ${last.secondsAgo}s ago. Want me to group what it belongs with?`,
          nodeId: last.id,
        });
      }
      return call('annotate_scene', {
        text: 'You have not moved anything recently, so I organised nothing. Grab a note and press this again.',
      });
    },
  },
  {
    id: 'timeline',
    title: 'Build the timeline',
    blurb: 'Find every dated note and lay them out left-to-right in real chronological order.',
    tool: 'arrange_region',
    group: 'structure',
    run: async (call) => {
      const basedOn = await premise(call);
      const groups = byCategory();
      if (groups.event.length < 2) throw new Error('No dated notes on the board.');
      return call('arrange_region', {
        basedOn,
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
    group: 'structure',
    run: async (call) => {
      const basedOn = await premise(call);
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
        basedOn,
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
    id: 'lastread',
    title: 'Act on what I read a moment ago',
    blurb:
      'Cluster the risks, citing the board you last read instead of reading again — the way '
      + 'an agent acts a turn after it looked. Press "Read the board" first, then let somebody '
      + 'else move those notes, then press this.',
    tool: 'arrange_region',
    group: 'structure',
    run: async (call) => {
      const basedOn = lastRead();
      if (basedOn === undefined) {
        throw new Error('Nothing read yet — press "Read the board" first, then come back.');
      }
      const groups = byCategory();
      if (groups.hypothesis.length < 2) throw new Error('No risks on the board to cluster.');
      return call('arrange_region', {
        basedOn,
        nodeIds: groups.hypothesis.map((n) => n.id),
        layout: 'cluster',
        label: 'Risks',
      });
    },
  },
  {
    id: 'matrix',
    title: 'Lay the actions out as a grid',
    blurb: 'Put every proposed action into an even grid so nothing hides behind anything else.',
    tool: 'arrange_region',
    group: 'structure',
    run: async (call) => {
      const basedOn = await premise(call);
      const groups = byCategory();
      if (groups.action.length < 2) throw new Error('No action notes on the board.');
      return call('arrange_region', {
        basedOn,
        nodeIds: groups.action.map((n) => n.id),
        layout: 'grid',
        label: 'Proposed actions',
      });
    },
  },
  {
    id: 'link',
    title: 'Link evidence to risks',
    blurb: 'Read the text of every note and draw labelled edges from supporting evidence to each risk.',
    tool: 'find_and_link',
    group: 'structure',
    run: async (call) => {
      const basedOn = await premise(call);
      const groups = byCategory();
      const evidence = [...groups.quote, ...groups.metric];
      const links: { from: string; to: string; label: string }[] = [];

      // Keyword overlap stands in for the model's judgement about relatedness.
      // One theme per risk on this board, matched against the risk's own text
      // first and then against the evidence — so a table that has drifted from
      // the board simply links nothing rather than linking the wrong things.
      const KEYS: Record<string, RegExp> = {
        sso: /\bsso\b/i,
        import: /import|onboard|migrate|vendor/i,
        capacity: /engineer|designer|weeks|runway/i,
        search: /search|p95|beta list/i,
        oncall: /on-?call|rota|2am|breaks/i,
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
      return call('find_and_link', {
        basedOn,
        criterion: 'evidence supports risk',
        links: links.slice(0, 10),
      });
    },
  },
  {
    id: 'tree',
    title: 'Build the fix tree',
    blurb:
      'Two tools composing: link each risk to the action that addresses it, then ' +
      'lay the whole thing out as a dependency hierarchy.',
    tool: 'find_and_link → arrange_region',
    group: 'structure',
    run: async (call) => {
      const basedOn = await premise(call);
      const groups = byCategory();
      // A risk and the action that answers it, by shared subject. Deliberately
      // sparse: only the pairs a reader would also draw. Inventing an edge for
      // every risk would fill the board with claims the notes do not support.
      const KEYS: Record<string, RegExp> = {
        sso: /\bsso\b/i,
        oncall: /on-?call|rota/i,
        import: /import|dogfood/i,
        mobile: /mobile/i,
      };

      const links: { from: string; to: string; label: string }[] = [];
      for (const h of groups.hypothesis) {
        const match = Object.values(KEYS).find((re) => re.test(h.text));
        if (!match) continue;
        for (const a of groups.action) {
          if (match.test(a.text)) links.push({ from: h.id, to: a.id, label: 'addressed by' });
        }
      }
      if (links.length === 0) throw new Error('Nothing to connect — no risk on this board names an action that answers it.');

      await call('find_and_link', { basedOn, criterion: 'risk is addressed by action', links });

      const linked = new Set(links.flatMap((l) => [l.from, l.to]));
      return call('arrange_region', {
        basedOn,
        nodeIds: [...linked],
        layout: 'hierarchy',
        label: 'Risks → fixes',
      });
    },
  },
  {
    id: 'annotate',
    title: 'Point out what is missing',
    blurb: 'Leave a floating comment on the board without moving a single note.',
    tool: 'annotate_scene',
    group: 'author',
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
    group: 'author',
    run: async (call) => {
      const basedOn = await premise(call);
      const groups = byCategory();
      if (groups.quote.length < 2) throw new Error('No quotes left to collapse.');
      return call('summarize_cluster', {
        basedOn,
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
    group: 'author',
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
    group: 'whole board',
    run: async (call) => {
      const basedOn = await premise(call);
      const groups = byCategory();
      const plan = [
        { label: 'Timeline', nodeIds: groups.event.map((n) => n.id), layout: 'timeline_horizontal' },
        { label: 'Evidence', nodeIds: [...groups.quote, ...groups.metric].map((n) => n.id), layout: 'cluster' },
        { label: 'Hypotheses', nodeIds: groups.hypothesis.map((n) => n.id), layout: 'grid' },
        { label: 'Actions', nodeIds: groups.action.map((n) => n.id), layout: 'grid' },
      ].filter((g) => g.nodeIds.length > 0);

      return call('reorganize_board', {
        basedOn,
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
    group: 'whole board',
    run: (call) => call('undo_last_agent_action', {}),
  },
];
