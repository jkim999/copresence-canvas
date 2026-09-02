import type { JournalVerb } from '../state/journal';

/**
 * A mark per kind of change, on the same 16px grid and 1.5 stroke as the rest
 * of the set.
 *
 * The history was a column of identical dots, which meant it could only be read
 * one sentence at a time. Ten verbs share one shape vocabulary here, so the
 * shape of a session is legible before a single word of it is: a run of plus
 * marks is a board being built, a run of arrows is a board being rearranged,
 * and a minus in the middle of either is the thing you actually want to find.
 *
 * Colour still carries who, never what — that pair of accents is the product's
 * whole thesis and no glyph is allowed to borrow it.
 */

const base = {
  width: 11,
  height: 11,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
};

const PATHS: Record<JournalVerb, string[]> = {
  added: ['M8 3.2v9.6', 'M3.2 8h9.6'],
  moved: ['M2.8 8h10.4', 'm9.4 4.2 3.8 3.8-3.8 3.8'],
  retitled: ['M3 13h10', 'M4.6 10.3 10.9 4a1.6 1.6 0 0 1 2.3 2.3l-6.3 6.3-3 .7Z'],
  recoloured: ['M8 2.6 4.2 6.7a5.2 5.2 0 1 0 7.6 0Z', 'M8 13.2a5.2 5.2 0 0 0 3.8-8.9'],
  removed: ['M3.2 8h9.6'],
  linked: ['M6.6 9.4a3 3 0 0 0 4.4.3l1.6-1.6a3.1 3.1 0 0 0-4.4-4.4l-.9.9', 'M9.4 6.6a3 3 0 0 0-4.4-.3L3.4 7.9a3.1 3.1 0 0 0 4.4 4.4l.9-.9'],
  unlinked: ['M6.4 9.6 4.9 11a3.1 3.1 0 0 1-.2-4.6', 'M9.6 6.4 11.1 5a3.1 3.1 0 0 1 .2 4.6', 'M3 13 13 3'],
  grouped: ['M5.6 2.8H3.4a.6.6 0 0 0-.6.6v2.2', 'M10.4 2.8h2.2a.6.6 0 0 1 .6.6v2.2', 'M5.6 13.2H3.4a.6.6 0 0 1-.6-.6v-2.2', 'M10.4 13.2h2.2a.6.6 0 0 0 .6-.6v-2.2'],
  annotated: ['M13.2 9.4a1.7 1.7 0 0 1-1.7 1.7H6.3L3 13.6V4.5a1.7 1.7 0 0 1 1.7-1.7h6.8a1.7 1.7 0 0 1 1.7 1.7Z'],
  replaced: ['M13.2 3.6v3.6H9.6', 'M2.8 12.4V8.8h3.6', 'M4.3 6.5a4.5 4.5 0 0 1 7.4-1.7l1.5 1.4', 'M11.7 9.5a4.5 4.5 0 0 1-7.4 1.7L2.8 9.8'],
};

export const VerbMark = ({ verb }: { verb: JournalVerb }) => (
  <svg {...base}>
    {PATHS[verb].map((d) => (
      <path d={d} key={d} />
    ))}
  </svg>
);
