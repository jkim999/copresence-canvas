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
  if (/^h\d\s*[:.]/i.test(t)) return 'hypothesis';
  if (chronoKey(t) !== null && /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(t)) {
    return 'event';
  }
  if (/\d+\s*%|p\d{2}\b|median|\d+(\.\d+)?x\b|qoq|↑|↓/i.test(t)) return 'metric';
  return 'action';
};
