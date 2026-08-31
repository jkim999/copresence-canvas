import type { Scene, SceneNode } from '../state/types';

/**
 * A messy, realistic research-synthesis board: interview quotes, metrics,
 * timeline events and hypotheses from a "why did onboarding conversion drop"
 * investigation. Deliberately scattered — the whole point of the demo is that
 * an agent can physically impose structure on it while you keep working.
 */
const NOTES: readonly { text: string; color: string }[] = [
  // interview evidence (warm)
  { text: '"I gave up at the workspace-name step."', color: '#fff1e7' },
  { text: '"Didn\'t know what a workspace even was."', color: '#fff1e7' },
  { text: '"The email never arrived, I tried twice."', color: '#fff1e7' },
  { text: '"I wanted to poke around before signing up."', color: '#fff1e7' },
  { text: '"Asked for my team size before showing me anything."', color: '#fff1e7' },
  { text: '"Took a screenshot to send to my manager."', color: '#fff1e7' },

  // quantitative (cool)
  { text: 'Signup → activation down 31% QoQ', color: '#e8f1ff' },
  { text: '62% of drop-off happens on step 3 of 5', color: '#e8f1ff' },
  { text: 'Mobile completion 19%, desktop 54%', color: '#e8f1ff' },
  { text: 'Median time-to-first-value: 11m 40s', color: '#e8f1ff' },
  { text: 'Verification email p95 delivery: 4m 12s', color: '#e8f1ff' },
  { text: 'Support tickets tagged "onboarding" +2.4x', color: '#e8f1ff' },

  // timeline events (neutral)
  { text: 'Mar 3 — new signup flow ships', color: '#f1f0ee' },
  { text: 'Mar 11 — email provider migration', color: '#f1f0ee' },
  { text: 'Mar 24 — team-size question added', color: '#f1f0ee' },
  { text: 'Apr 2 — mobile web redesign', color: '#f1f0ee' },
  { text: 'Apr 15 — first conversion alert fires', color: '#f1f0ee' },
  { text: 'Apr 28 — research sprint kicks off', color: '#f1f0ee' },

  // hypotheses (green)
  { text: 'H1: Step 3 asks for data users don\'t have yet', color: '#eaf7ee' },
  { text: 'H2: Email deliverability regressed post-migration', color: '#eaf7ee' },
  { text: 'H3: Mobile layout hides the primary CTA', color: '#eaf7ee' },
  { text: 'H4: No way to preview value before committing', color: '#eaf7ee' },

  // proposed actions (violet)
  { text: 'Defer team size to post-activation', color: '#f3ecff' },
  { text: 'Add magic-link fallback for verification', color: '#f3ecff' },
  { text: 'Sticky CTA on mobile step 3', color: '#f3ecff' },
  { text: 'Ship a sandbox demo workspace', color: '#f3ecff' },
  { text: 'Instrument per-field abandonment', color: '#f3ecff' },
  { text: 'Weekly activation dashboard for the team', color: '#f3ecff' },
];

/** Deterministic PRNG so the board looks identical on every load and in demos. */
const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export const seedScene = (): Scene => {
  const rand = mulberry32(20260903);
  const nodes: SceneNode[] = NOTES.map((note, i) => {
    // Poisson-ish scatter over a wide field, with jitter so nothing looks gridded.
    const col = i % 6;
    const row = Math.floor(i / 6);
    return {
      id: `n_${i.toString().padStart(2, '0')}`,
      text: note.text,
      x: Math.round(col * 236 + (rand() - 0.5) * 150),
      y: Math.round(row * 190 + (rand() - 0.5) * 130),
      w: 176,
      h: 84,
      color: note.color,
      cluster: null,
      kind: 'idea',
      lastEditedBy: 'human',
      editedAt: 0,
      selected: false,
    };
  });

  return { nodes, edges: [], annotations: [], regions: [] };
};
