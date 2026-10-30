import { Svg } from '../../DrawingIcons';
import { patternTool } from './patternTool';
import { HEAD_AND_SHOULDERS } from '../../../lib/geometry/patterns';

/** Head and shoulders: seven points, a neckline through the two neck points and a fill per shoulder and the head. */
export const headAndShoulders = patternTool({
  id: 'headAndShoulders',
  label: 'Head and shoulders',
  spec: HEAD_AND_SHOULDERS,
  icon: (
    <Svg>
      <polyline points="2,18 5,10 8,15 12,5 16,15 19,10 22,18" /><line x1="2" y1="15" x2="22" y2="15" />
    </Svg>
  ),
});
