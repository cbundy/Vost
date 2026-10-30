import { Svg } from '../../DrawingIcons';
import { lineTool } from './lineTool';

export const ray = lineTool(
  {
    id: 'ray',
    label: 'Ray',
    group: 'lines',
    section: 'Lines',
    icon: (
      <Svg>
        <circle cx="5" cy="19" r="2" />
        <line x1="6.5" y1="17.5" x2="21" y2="3" />
        <polyline points="15,3 21,3 21,9" />
      </Svg>
    ),
  },
  { extendRight: true },
);
