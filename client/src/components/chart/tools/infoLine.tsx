import { Svg } from '../../DrawingIcons';
import { lineTool } from './lineTool';

/** A trend line that labels its price change, bars, angle and distance from the start. */
export const infoLine = lineTool(
  {
    id: 'infoLine',
    label: 'Info line',
    group: 'lines',
    section: 'Lines',
    icon: (
      <Svg>
        <line x1="5" y1="19" x2="19" y2="7" />
        <circle cx="5" cy="19" r="2" />
        <circle cx="19" cy="7" r="2" />
        <rect x="11" y="13" width="9" height="7" rx="1" />
      </Svg>
    ),
  },
  { showPriceChange: true, showBars: true, showAngle: true, showDistance: true },
  true,
);
