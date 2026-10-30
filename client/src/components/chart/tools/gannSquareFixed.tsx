import { Svg } from '../../DrawingIcons';
import { squareTool } from './gannSquare';

/** The Gann square held 1:1: its side is the larger of the two points' distances, so point 2 only picks direction and size. */
export const gannSquareFixed = squareTool(
  {
    id: 'gannSquareFixed',
    label: 'Gann square fixed',
    icon: (
      <Svg>
        <rect x="5" y="5" width="14" height="14" />
        <line x1="5" y1="19" x2="19" y2="5" />
        <path d="M5 12a7 7 0 0 1 7 7" />
      </Svg>
    ),
  },
  true,
);
