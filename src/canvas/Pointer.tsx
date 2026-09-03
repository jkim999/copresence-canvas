/**
 * One drawn body, two actors. The human and the agent must be distinguishable
 * in a single frame of a screen recording without anyone reading the labels,
 * so they differ only in colour: ink teal for the machine, terracotta for the
 * hand. Drawing them from the same path keeps that comparison honest.
 */
interface Props {
  actor: 'agent' | 'human';
  /** A peer's own hue. Absent for this tab's pair, who keep the fixed two. */
  color?: string;
}

export const PointerBody = ({ actor, color }: Props) => (
  <svg width="18" height="20" viewBox="0 0 20 22" fill="none" aria-hidden="true">
    <path
      d="M2 1.6 L2 18.4 L6.3 14.2 L9.1 20.4 L12.2 19 L9.4 12.9 L15.4 12.6 Z"
      fill={color ?? (actor === 'agent' ? 'var(--agent)' : 'var(--human)')}
      stroke="#fdfcf8"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
  </svg>
);
