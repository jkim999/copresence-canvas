import type { Scene, SceneNode } from '../state/types';
import { LOCAL_HUMAN } from '../state/actors';
import { PAPER } from './palette';
import { scatter } from './scatter';

/**
 * A messy, realistic planning board: the first week of a software project,
 * before anyone has decided anything. Voices from the kickoff, the numbers the
 * team has to live inside, the dates already in the calendar, the risks nobody
 * has assigned, and the calls waiting to be made.
 *
 * Deliberately scattered, and deliberately short-lined — this is the board the
 * demo video is shot on, so every note has to stay legible at video bitrates
 * while an agent moves it. The five shapes are load-bearing: quoted lines are
 * what the agent reaches for when a hand takes one back, and all five are what
 * a whole-board restructure has to ask the room about.
 */
const NOTES: readonly { text: string; color: string }[] = [
  // what people said at kickoff
  { text: '"We can\'t run the pilot without SSO."', color: PAPER.quote },
  { text: '"Don\'t make me migrate twice."', color: PAPER.quote },
  { text: '"Mobile is where my team actually works."', color: PAPER.quote },
  { text: '"Who do I call when it breaks at 2am?"', color: PAPER.quote },
  { text: '"The last vendor took six weeks to onboard."', color: PAPER.quote },
  { text: '"Just make search fast. That\'s the whole ask."', color: PAPER.quote },

  // the numbers we have to live inside
  { text: '340 teams on the beta list', color: PAPER.metric },
  { text: 'Two engineers, one designer, ten weeks', color: PAPER.metric },
  { text: '41% of signups asked for SSO', color: PAPER.metric },
  { text: 'Search p95 has to stay under 200ms', color: PAPER.metric },
  { text: 'Import tool: three weeks, best case', color: PAPER.metric },
  { text: 'Runway covers four months', color: PAPER.metric },

  // dates already in the calendar
  { text: 'Sep 8 — kickoff', color: PAPER.event },
  { text: 'Sep 22 — API frozen for v1', color: PAPER.event },
  { text: 'Oct 6 — internal dogfood starts', color: PAPER.event },
  { text: 'Oct 27 — private beta, 20 teams', color: PAPER.event },
  { text: 'Nov 17 — feature freeze', color: PAPER.event },
  { text: 'Dec 1 — public launch', color: PAPER.event },

  // what could go wrong
  { text: 'R1: SSO blocks every enterprise pilot', color: PAPER.hypothesis },
  { text: 'R2: The import tool is on the critical path', color: PAPER.hypothesis },
  { text: 'R3: One engineer is away for two weeks in October', color: PAPER.hypothesis },
  { text: 'R4: Search cost scales with the beta list', color: PAPER.hypothesis },
  { text: 'R5: No on-call rota exists yet', color: PAPER.hypothesis },

  // calls waiting to be made
  { text: 'Buy SSO, don\'t build it', color: PAPER.action },
  { text: 'Cut the mobile app to responsive web', color: PAPER.action },
  { text: 'Dogfood before beta, no exceptions', color: PAPER.action },
  { text: 'Name one owner per launch gate', color: PAPER.action },
  { text: 'Write the on-call rota in October', color: PAPER.action },
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
    lastEditedBy: LOCAL_HUMAN,
    editedAt: 0,
    selected: false,
  }));

  return { nodes, edges: [], annotations: [], regions: [] };
};
