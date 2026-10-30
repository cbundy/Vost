import { Svg } from '../../DrawingIcons';
import { patternTool } from './patternTool';
import { ABCD } from '../../../lib/geometry/patterns';

/** ABCD pattern: four points A B C D with two ratio lines. */
export const abcdPattern = patternTool({
  id: 'abcdPattern',
  label: 'ABCD pattern',
  spec: ABCD,
  icon: (
    <Svg>
      <polyline points="4,18 9,6 14,15 20,5" />
    </Svg>
  ),
});
