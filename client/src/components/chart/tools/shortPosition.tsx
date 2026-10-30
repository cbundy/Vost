import { Svg } from '../../DrawingIcons';
import { positionTool } from './positionTool';

export const shortPosition = positionTool(
  'short',
  'shortPosition',
  'Short position',
  <Svg>
    <path d="M4 12h16M4 4h16v8H4zM4 12h16v8H4z" />
    <path d="M12 15v3m-1.5-1.5L12 18l1.5-1.5" />
  </Svg>,
);
