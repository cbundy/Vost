import { Svg } from '../../DrawingIcons';
import { patternTool } from './patternTool';
import { TRIANGLE_PATTERN } from '../../../lib/geometry/patterns';

/** Triangle pattern: four points A B C D and the converging lines A-C and B-D with a background fill. */
export const trianglePattern = patternTool({
  id: 'trianglePattern',
  label: 'Triangle pattern',
  spec: TRIANGLE_PATTERN,
  icon: (
    <Svg>
      <polyline points="3,5 7,18 12,8 16,15" /><line x1="3" y1="5" x2="21" y2="12" /><line x1="7" y1="18" x2="21" y2="12" />
    </Svg>
  ),
});
