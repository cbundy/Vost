import { Svg } from '../../DrawingIcons';
import { lineTool } from './lineTool';

/** A trend line that continues both ways to the edge of the pane. */
export const extendedLine = lineTool(
  {
    id: 'extendedLine',
    label: 'Extended line',
    group: 'lines',
    section: 'Lines',
    icon: (
      <Svg>
        <line x1="2" y1="21" x2="22" y2="3" />
        <circle cx="9" cy="15" r="2" />
        <circle cx="15" cy="9" r="2" />
      </Svg>
    ),
  },
  { extendLeft: true, extendRight: true },
);
