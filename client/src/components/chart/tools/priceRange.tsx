import { Svg } from '../../DrawingIcons';
import { rangeTool } from './rangeTool';

export const priceRange = rangeTool(
  'price',
  'priceRange',
  'Price range',
  <Svg>
    <rect x="6" y="5" width="12" height="14" />
    <path d="M12 17V7M9.5 9.5 12 7l2.5 2.5" />
  </Svg>,
);
