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

export const MagnetIcon = ({ mark }: { mark?: 'weak' | 'strong' }) => (
  <Svg>
    <path d="M6 3v8a6 6 0 0 0 12 0V3h-4v8a2 2 0 0 1-4 0V3z" />
    <path d="M6 7h4M14 7h4" />
    {mark && (
      <text x="23" y="23" textAnchor="end" fontSize="10" fontWeight="700" fill="currentColor" stroke="none" data-testid="magnet-mark">
        {mark === 'weak' ? 'W' : 'S'}
      </text>
    )}
  </Svg>
);

export const LockIcon = () => (
  <Svg>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Svg>
);

/** A pencil with a pin: the tool stays picked. */
export const StayIcon = () => (
  <Svg>
    <path d="M4 20l1-4L15 6l3 3L8 19z" />
    <circle cx="19" cy="5" r="2" />
  </Svg>
);

export const EyeIcon = () => (
  <Svg>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);

export const EyeOffIcon = () => (
  <Svg>
    <path d="M9.9 5.2A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.1 6.1A17 17 0 0 0 2 12s3.6 7 10 7a10 10 0 0 0 4-.8" />
    <path d="M3 3l18 18" />
  </Svg>
);

export const TrashIcon = () => (
  <Svg>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
  </Svg>
);

export const PencilIcon = () => (
  <Svg>
    <path d="M4 20l1-4L16 5l3 3L8 19z" />
    <path d="M14 7l3 3" />
  </Svg>
);

export const CrossIcon = () => (
  <Svg>
    <path d="M12 3v18M3 12h18" />
  </Svg>
);

export const DotIcon = () => (
  <Svg>
    <circle cx="12" cy="12" r="3" fill="currentColor" />
  </Svg>
);

export const EraserIcon = () => (
  <Svg>
    <path d="M7 21h12M5 15l9-9a2 2 0 0 1 3 0l3 3a2 2 0 0 1 0 3l-7 7H9z" />
    <path d="M9 11l6 6" />
  </Svg>
);

export const StarIcon = ({ filled = false }: { filled?: boolean }) => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />
  </svg>
);

export const ChevronRightIcon = () => (
  <svg width={8} height={8} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 4l8 8-8 8" />
  </svg>
);

export const ChevronDownIcon = () => (
  <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 8l8 8 8-8" />
  </svg>
);

export const GripIcon = () => (
  <svg width={10} height={14} viewBox="0 0 10 14" fill="currentColor" aria-hidden="true">
    <circle cx="3" cy="3" r="1.2" />
    <circle cx="7" cy="3" r="1.2" />
    <circle cx="3" cy="7" r="1.2" />
    <circle cx="7" cy="7" r="1.2" />
    <circle cx="3" cy="11" r="1.2" />
    <circle cx="7" cy="11" r="1.2" />
  </svg>
);
