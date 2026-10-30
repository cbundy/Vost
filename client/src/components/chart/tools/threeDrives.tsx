import { Svg } from '../../DrawingIcons';
import { patternTool } from './patternTool';
import { THREE_DRIVES } from '../../../lib/geometry/patterns';

/** Three drives: seven points, drives 1 2 3 and retracements A and C, with four ratio lines. */
export const threeDrives = patternTool({
  id: 'threeDrives',
  label: 'Three drives',
  spec: THREE_DRIVES,
  icon: (
    <Svg>
      <polyline points="2,19 5,9 8,14 12,5 15,11 19,3 22,8" />
    </Svg>
  ),
});
