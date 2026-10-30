import { Svg } from '../../DrawingIcons';
import { patternTool } from './patternTool';
import { XABCD } from '../../../lib/geometry/patterns';

/** XABCD pattern: five points X A B C D with two filled triangles and four ratio lines. */
export const xabcdPattern = patternTool({
  id: 'xabcdPattern',
  label: 'XABCD pattern',
  spec: XABCD,
  icon: (
    <Svg>
      <polyline points="3,18 8,5 12,14 16,7 21,17" />
    </Svg>
  ),
});
