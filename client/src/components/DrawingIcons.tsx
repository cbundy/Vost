import type { ReactNode } from 'react';

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      width={18}
      height={18}
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

const CursorIcon = () => (
  <Svg>
    <path d="M5 3l14 7-6 2-2 6z" />
  </Svg>
);
const TrendLineIcon = () => (
  <Svg>
    <line x1="5" y1="19" x2="19" y2="5" />
    <circle cx="5" cy="19" r="2" />
    <circle cx="19" cy="5" r="2" />
  </Svg>
);
const HorizontalLineIcon = () => (
  <Svg>
    <line x1="3" y1="12" x2="21" y2="12" />
    <circle cx="12" cy="12" r="2" />
  </Svg>
);

/** Rail icon per tool id (`cursor` plus every id in the tool registry). */
export const DRAWING_ICONS: Record<string, ReactNode> = {
  cursor: <CursorIcon />,
  trendLine: <TrendLineIcon />,
  horizontalLine: <HorizontalLineIcon />,
};
