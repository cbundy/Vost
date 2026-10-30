import { Svg } from '../../DrawingIcons';
import { lineTool } from './lineTool';

/** A line with an arrow head at its second point (the line tools' settings, Arrow at end on). */
export const arrow = lineTool(
  {
    id: 'arrow',
    label: 'Arrow',
    group: 'shapes',
    section: 'Shapes',
    icon: (
      <Svg>
        <line x1="5" y1="19" x2="18" y2="6" />
        <path d="M10 6h8v8" />
      </Svg>
    ),
  },
  { arrowEnd: true },
);
