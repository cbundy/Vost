import { Svg } from '../../DrawingIcons';
import { rangeTool } from './rangeTool';

export const datePriceRange = rangeTool(
  'both',
  'datePriceRange',
  'Date and price range',
  <Svg>
    <rect x="4" y="5" width="16" height="14" />
    <path d="M12 17V7M9.5 9.5 12 7l2.5 2.5M6 12h12M15.5 9.5 18 12l-2.5 2.5" />
  </Svg>,
);
