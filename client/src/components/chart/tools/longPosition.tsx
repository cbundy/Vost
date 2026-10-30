import { Svg } from '../../DrawingIcons';
import { positionTool } from './positionTool';

export const longPosition = positionTool(
  'long',
  'longPosition',
  'Long position',
  <Svg>
    <path d="M4 12h16M4 4h16v8H4zM4 12h16v8H4z" />
    <path d="M12 9V6m-1.5 1.5L12 6l1.5 1.5" />
  </Svg>,
);
