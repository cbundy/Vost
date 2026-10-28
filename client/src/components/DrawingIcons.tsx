import type { ReactNode } from 'react';

export function Svg({ children }: { children: ReactNode }) {
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

export const CursorIcon = () => (
  <Svg>
    <path d="M5 3l14 7-6 2-2 6z" />
  </Svg>
);
