import { chronoKey } from '../agent/layout';

/**
 * The same shallow reading a model does over `get_scene` text: what kind of
 * thing is this note? Used to colour an imported board and to let the console
 * recipes pick sensible groups out of material they have never seen.
 */
export type Category = 'quote' | 'metric' | 'event' | 'hypothesis' | 'action';

export const classify = (text: string): Category => {
  const t = text.trim();
  if (t.startsWith('"') || t.startsWith('“')) return 'quote';
  // `H1:` was this board's convention and `R1:` is the current one. Both are
  // the same shape of note — a numbered claim about what might go wrong — and a
  // classifier that knows only the retired form fails silently: the notes drop
  // through to `action`, so a three-cluster act quietly makes two and the
  // recipes that reason about them throw on the board they ship with.
  if (/^[hr]\d\s*[:.]/i.test(t)) return 'hypothesis';
  if (chronoKey(t) !== null && /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(t)) {
    return 'event';
  }
  if (/\d+\s*%|p\d{2}\b|median|\d+(\.\d+)?x\b|qoq|↑|↓/i.test(t)) return 'metric';
  return 'action';
};
