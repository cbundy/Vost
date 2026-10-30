import type { ReactNode } from 'react';

/** Small inline SVG icons shared by the top bar (no icon library). All inherit the text colour. */
function Svg({ size = 14, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      className="topbar-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const ListIcon = () => (
  <Svg size={16}>
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" />
    <line x1="3" y1="12" x2="3.01" y2="12" />
    <line x1="3" y1="18" x2="3.01" y2="18" />
  </Svg>
);

export const DatabaseIcon = () => (
  <Svg size={16}>
    <ellipse cx="12" cy="5" rx="9" ry="3" />
    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3" />
  </Svg>
);

export const IndicatorIcon = () => (
  <Svg size={16}>
    <polyline points="3 17 9 11 13 15 21 7" />
  </Svg>
);

export const InboxIcon = () => (
  <Svg size={15}>
    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </Svg>
);

export const UploadIcon = () => (
  <Svg>
    <path d="M12 16V4" />
    <path d="m6 10 6-6 6 6" />
    <path d="M4 20h16" />
  </Svg>
);

export const InfoIcon = () => (
  <Svg>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5" />
    <path d="M12 7.5v.01" />
  </Svg>
);

export const RefreshIcon = () => (
  <Svg>
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v6h-6" />
  </Svg>
);

export const RangeIcon = () => (
  <Svg>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </Svg>
);

export const StarIcon = () => (
  <Svg>
    <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />
  </Svg>
);

export const MoreIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="5" cy="12" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="19" cy="12" r="2" />
  </svg>
);

export const ReplayIcon = () => (
  <Svg>
    <path d="M3 12a9 9 0 1 0 2.64-6.36" />
    <path d="M3 4v5h5" />
    <path d="m10 9 5 3-5 3z" />
  </Svg>
);

const Glyph = ({ children }: { children: ReactNode }) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    {children}
  </svg>
);
export const StepBackIcon = () => (
  <Glyph>
    <path d="M6 5h2.5v14H6zM20 5v14L9.5 12z" />
  </Glyph>
);
export const StepForwardIcon = () => (
  <Glyph>
    <path d="M15.5 5H18v14h-2.5zM4 5l10.5 7L4 19z" />
  </Glyph>
);
export const PlayIcon = () => (
  <Glyph>
    <path d="M7 4v16l13-8z" />
  </Glyph>
);
export const PauseIcon = () => (
  <Glyph>
    <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
  </Glyph>
);

export const BellIcon = () => (
  <Svg size={15}>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </Svg>
);

/** Stacked layers: the object tree. */
export const LayersIcon = () => (
  <Svg size={16}>
    <polygon points="12 2 2 7 12 12 22 7 12 2" />
    <polyline points="2 12 12 17 22 12" />
    <polyline points="2 17 12 22 22 17" />
  </Svg>
);
