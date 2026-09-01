import type { Scene, SceneNode } from '../state/types';
import { PAPER } from './palette';
import { classify, type Category } from './classify';
import { columnsFor, scatter } from './scatter';

/**
 * Bring your own board. The demo seed proves the idea; this is what makes the
 * page useful on the material you actually have open — paste a retro, a set of
 * interview lines, a backlog, and the agent's tools work on it unchanged.
 */

const COLOR: Record<Category, string> = {
  quote: PAPER.quote,
  metric: PAPER.metric,
  event: PAPER.event,
  hypothesis: PAPER.hypothesis,
  action: PAPER.action,
};

/** Leading list marks people paste along with their text, and markdown hashes. */
const LEADING = /^\s*(?:#{1,6}\s+|[-*•·–—]\s+|\d+[.)]\s+|\[[ xX]\]\s+)/;

export const MAX_NOTES = 80;
const MAX_CHARS = 160;

/**
 * One non-empty line becomes one note. Duplicates are dropped so a pasted doc
 * with repeated headers does not litter the board.
 */
export const parseNotes = (raw: string): string[] => {
  const seen = new Set<string>();
  const notes: string[] = [];

  for (const line of raw.split(/\r?\n/)) {
    let text = line.trim();
    // A line can carry more than one mark: "- [ ] thing", "1. - thing".
    let stripped = text.replace(LEADING, '').trim();
    while (stripped !== text) {
      text = stripped;
      stripped = text.replace(LEADING, '').trim();
    }
    if (!text) continue;

    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    notes.push(text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS - 1)}…` : text);
    if (notes.length >= MAX_NOTES) break;
  }

  return notes;
};

export const sceneFromTexts = (texts: string[]): Scene => {
  const points = scatter(texts.length, { columns: columnsFor(texts.length) });
  const nodes: SceneNode[] = texts.map((text, i) => ({
    id: `n_${i.toString().padStart(2, '0')}`,
    text,
    x: points[i].x,
    y: points[i].y,
    w: 176,
    h: 84,
    color: COLOR[classify(text)],
    cluster: null,
    kind: 'idea',
    lastEditedBy: 'human',
    editedAt: 0,
    selected: false,
  }));

  return { nodes, edges: [], annotations: [], regions: [] };
};
