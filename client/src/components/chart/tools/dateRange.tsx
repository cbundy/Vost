import { Svg } from '../../DrawingIcons';
import { rangeTool } from './rangeTool';

export const dateRange = rangeTool(
  'date',
  'dateRange',
  'Date range',
  <Svg>
    <rect x="4" y="7" width="16" height="10" />
    <path d="M6 12h12M15.5 9.5 18 12l-2.5 2.5" />
  </Svg>,
);
