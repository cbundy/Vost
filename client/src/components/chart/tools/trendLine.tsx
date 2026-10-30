import { Svg } from '../../DrawingIcons';
import { lineTool } from './lineTool';

export const trendLine = lineTool(
  {
    id: 'trendLine',
    label: 'Trend line',
    group: 'lines',
    section: 'Lines',
    icon: (
      <Svg>
        <line x1="5" y1="19" x2="19" y2="5" />
        <circle cx="5" cy="19" r="2" />
        <circle cx="19" cy="5" r="2" />
      </Svg>
    ),
  },
  {},
);
