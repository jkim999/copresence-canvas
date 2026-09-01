/**
 * One authored icon set: 16px grid, 1.5 stroke, round caps, currentColor.
 * Keeping them here rather than pulling a library means the whole set shares a
 * weight — mismatched stroke widths are the fastest way to make a toolbar look
 * assembled instead of drawn.
 */
interface IconProps {
  size?: number;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
});

export const IconProvenance = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M8 2.2 2.6 5v3.4c0 2.7 2.2 4.6 5.4 5.4 3.2-.8 5.4-2.7 5.4-5.4V5L8 2.2Z" />
    <path d="M5.9 8.1 7.4 9.6l2.9-3" />
  </svg>
);

export const IconUndoAgent = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M3 6.4h6.2a3.4 3.4 0 0 1 0 6.8H6.1" />
    <path d="m5.5 3.7-2.6 2.7 2.6 2.7" />
  </svg>
);

export const IconUndo = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M2.9 8.4h7.4a2.9 2.9 0 0 1 0 5.8H7.6" />
    <path d="m5.6 5.9-2.7 2.5 2.7 2.6" />
    <path d="M11.4 2.2v2.9M9.9 3.6h2.9" />
  </svg>
);

export const IconReset = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M13.2 8a5.2 5.2 0 1 1-1.6-3.7" />
    <path d="M13.4 2.4v3.1h-3.1" />
  </svg>
);

export const IconPanelClose = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="2.2" y="2.8" width="11.6" height="10.4" rx="2" />
    <path d="M9.8 2.8v10.4" />
    <path d="m6.6 6.4-1.5 1.6 1.5 1.6" />
  </svg>
);

export const IconPanelOpen = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="2.2" y="2.8" width="11.6" height="10.4" rx="2" />
    <path d="M9.8 2.8v10.4" />
    <path d="m5.1 6.4 1.5 1.6-1.5 1.6" />
  </svg>
);

export const IconConsole = ({ size = 15 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="2" y="3.1" width="12" height="9.8" rx="2" />
    <path d="m4.9 6.6 1.8 1.5-1.8 1.5M8.9 9.9h2.4" />
  </svg>
);

export const IconTools = ({ size = 15 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M9.6 3.1a2.9 2.9 0 0 0 3.7 3.7l-6 6a1.8 1.8 0 0 1-2.6-2.6l6-6Z" />
    <path d="m3.4 3.3 1.9 1.9" />
  </svg>
);

export const IconActivity = ({ size = 15 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M1.8 8h2.7l1.8-4.6 2.6 9.2 1.8-4.6h3.5" />
  </svg>
);

export const IconDismiss = ({ size = 12 }: IconProps) => (
  <svg {...base(size)}>
    <path d="m4.4 4.4 7.2 7.2M11.6 4.4l-7.2 7.2" />
  </svg>
);

export const IconRunning = ({ size = 13 }: IconProps) => (
  <svg {...base(size)} className="spinner">
    <circle cx="8" cy="8" r="5.4" opacity="0.25" />
    <path d="M8 2.6a5.4 5.4 0 0 1 5.4 5.4" />
  </svg>
);

export const IconLock = ({ size = 12 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="3.4" y="7" width="9.2" height="6.4" rx="1.8" />
    <path d="M5.6 7V5.3a2.4 2.4 0 0 1 4.8 0V7" />
  </svg>
);

export const IconArrow = ({ size = 12 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M3.4 8h9.2M9.1 4.6 12.6 8l-3.5 3.4" />
  </svg>
);
