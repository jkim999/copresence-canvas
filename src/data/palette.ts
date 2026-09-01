/**
 * The board's paper stock. Every tint is the same bone paper with a few points
 * of hue pulled into it, so a laid-out board reads as one material sorted by
 * category rather than five different colours competing on a white field.
 *
 * Note text is always --board-ink (#26241E); every tint here clears 4.5:1
 * against it with room to spare.
 */
export const PAPER = {
  /** verbatim interview quotes — warm, human */
  quote: '#faf1e8',
  /** measurements — cool, exact */
  metric: '#ebf1f4',
  /** dated events — near-paper, so a timeline reads as the board itself */
  event: '#f5f2ea',
  /** hypotheses — sage */
  hypothesis: '#ebf2ec',
  /** proposed actions — sand */
  action: '#f6eeda',
  /** what the agent writes: brighter stock, so new paper looks new */
  agentNote: '#fdfaf0',
  /** an agent-authored synthesis standing in for the notes it replaced */
  summary: '#eef4f3',
} as const;

export type PaperTint = (typeof PAPER)[keyof typeof PAPER];
