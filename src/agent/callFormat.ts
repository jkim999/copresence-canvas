/**
 * Renders a tool call the way a reader can verify it.
 *
 * Motion alone cannot prove a model decided anything — a scripted animation
 * looks identical. What proves it is the call itself: the ids the agent chose,
 * the layout it asked for, and what came back. This formats both compactly
 * enough to sit on the canvas while the work is still happening.
 */

const short = (s: string, max = 34): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

const value = (v: unknown): string => {
  if (typeof v === 'string') return `"${short(v)}"`;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    if (v.every((x) => typeof x === 'string')) {
      const head = (v as string[]).slice(0, 3).map((s) => short(s, 16));
      return `[${head.join(', ')}${v.length > 3 ? `, +${v.length - 3}` : ''}]`;
    }
    return `${v.length}×{…}`;
  }
  if (v && typeof v === 'object') return '{…}';
  return String(v);
};

/** `nodeIds: [n_04, n_11, n_17, +3], layout: "timeline_horizontal"` */
export const formatArgs = (args: unknown): string => {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return '';
  const entries = Object.entries(args as Record<string, unknown>).filter(
    ([, v]) => v !== undefined,
  );
  return entries.map(([k, v]) => `${k}: ${value(v)}`).join(', ');
};

const bytes = (n: number): string =>
  n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;

const count = (v: unknown): number =>
  Array.isArray(v) ? v.length : typeof v === 'number' ? v : 0;

/**
 * One line of consequence per tool. Deliberately names what the human cares
 * about — including the notes the agent gave back because they grabbed them.
 */
export const summarizeResult = (tool: string, result: unknown): string => {
  if (result === undefined) return 'running…';
  if (result === null || typeof result !== 'object') return String(result);
  const r = result as Record<string, any>;
  const parts: string[] = [];

  switch (tool) {
    case 'get_scene': {
      const n = r.counts?.nodes ?? r.nodes?.length ?? 0;
      parts.push(`${n} notes`, bytes(JSON.stringify(result).length), 'no screenshot');
      break;
    }
    case 'get_human_activity': {
      const held = count(r.holdingRightNow);
      const touched = count(r.recentlyTouched);
      parts.push(
        held > 0 ? `you are holding ${held}` : 'you are holding nothing',
        `${touched} touched recently`,
      );
      break;
    }
    case 'arrange_region':
      parts.push(`moved ${count(r.moved)}`);
      if (r.layout) parts.push(String(r.layout));
      if (count(r.yieldedToHuman) > 0) parts.push(`yielded ${count(r.yieldedToHuman)} to you`);
      if (count(r.nudgedAside) > 0) parts.push(`nudged ${count(r.nudgedAside)} aside`);
      break;
    case 'find_and_link':
      parts.push(`${count(r.created)} edges drawn`);
      if (count(r.skipped) > 0) parts.push(`${count(r.skipped)} skipped`);
      break;
    case 'annotate_scene':
      parts.push(r.anchoredTo ? `pinned to ${r.anchoredTo}` : 'pinned to the board');
      break;
    case 'summarize_cluster':
      parts.push(`${count(r.collapsed)} notes → 1 summary`);
      if (count(r.keptInHand) > 0) parts.push(`left ${count(r.keptInHand)} in your hand`);
      break;
    case 'add_notes':
      parts.push(`+${count(r.created)} notes`);
      break;
    case 'reorganize_board':
      // `refusedBy` is already the rendered seat — 'You' when this tab refused,
      // a peer's seat name when theirs did, and null when the ask simply ran
      // out of time. Collapsing all three into "you declined" told the reader
      // their own human had refused something they were never asked.
      parts.push(
        r.approved
          ? `approved · ${count(r.groupsApplied)} groups`
          : typeof r.refusedBy === 'string' && r.refusedBy.length > 0
            ? r.refusedBy === 'You'
              ? 'you declined'
              : `${r.refusedBy} declined`
            : 'nobody answered',
      );
      if (r.approved) parts.push(`moved ${count(r.moved)}`);
      break;
    case 'undo_last_agent_action':
      parts.push(r.undone ? `reverted "${short(String(r.undone), 30)}"` : 'nothing to undo');
      break;
    default:
      parts.push('ok');
  }

  return parts.join(' · ');
};
