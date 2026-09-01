import type { Scene, SceneNode } from '../state/types';
import { PAPER } from './palette';
import { scatter } from './scatter';

/**
 * A messy, realistic research-synthesis board: interview quotes, metrics,
 * timeline events and hypotheses from a "why did onboarding conversion drop"
 * investigation. Deliberately scattered — the whole point of the demo is that
 * an agent can physically impose structure on it while you keep working.
 */
const NOTES: readonly { text: string; color: string }[] = [
  // interview evidence
  { text: '"I gave up at the workspace-name step."', color: PAPER.quote },
  { text: '"Didn\'t know what a workspace even was."', color: PAPER.quote },
  { text: '"The email never arrived, I tried twice."', color: PAPER.quote },
  { text: '"I wanted to poke around before signing up."', color: PAPER.quote },
  { text: '"Asked for my team size before showing me anything."', color: PAPER.quote },
  { text: '"Took a screenshot to send to my manager."', color: PAPER.quote },

  // quantitative
  { text: 'Signup → activation down 31% QoQ', color: PAPER.metric },
  { text: '62% of drop-off happens on step 3 of 5', color: PAPER.metric },
  { text: 'Mobile completion 19%, desktop 54%', color: PAPER.metric },
  { text: 'Median time-to-first-value: 11m 40s', color: PAPER.metric },
  { text: 'Verification email p95 delivery: 4m 12s', color: PAPER.metric },
  { text: 'Support tickets tagged "onboarding" +2.4x', color: PAPER.metric },

  // timeline events
  { text: 'Mar 3 — new signup flow ships', color: PAPER.event },
  { text: 'Mar 11 — email provider migration', color: PAPER.event },
  { text: 'Mar 24 — team-size question added', color: PAPER.event },
  { text: 'Apr 2 — mobile web redesign', color: PAPER.event },
  { text: 'Apr 15 — first conversion alert fires', color: PAPER.event },
  { text: 'Apr 28 — research sprint kicks off', color: PAPER.event },

  // hypotheses
  { text: 'H1: Step 3 asks for data users don\'t have yet', color: PAPER.hypothesis },
  { text: 'H2: Email deliverability regressed post-migration', color: PAPER.hypothesis },
  { text: 'H3: Mobile layout hides the primary CTA', color: PAPER.hypothesis },
  { text: 'H4: No way to preview value before committing', color: PAPER.hypothesis },

  // proposed actions
  { text: 'Defer team size to post-activation', color: PAPER.action },
  { text: 'Add magic-link fallback for verification', color: PAPER.action },
  { text: 'Sticky CTA on mobile step 3', color: PAPER.action },
  { text: 'Ship a sandbox demo workspace', color: PAPER.action },
  { text: 'Instrument per-field abandonment', color: PAPER.action },
  { text: 'Weekly activation dashboard for the team', color: PAPER.action },
];

export const seedScene = (): Scene => {
  const points = scatter(NOTES.length);
  const nodes: SceneNode[] = NOTES.map((note, i) => ({
    id: `n_${i.toString().padStart(2, '0')}`,
    text: note.text,
    x: points[i].x,
    y: points[i].y,
    w: 176,
    h: 84,
    color: note.color,
    cluster: null,
    kind: 'idea',
    lastEditedBy: 'human',
    editedAt: 0,
    selected: false,
  }));

  return { nodes, edges: [], annotations: [], regions: [] };
};
