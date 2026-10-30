import { Svg } from '../../DrawingIcons';
import { patternTool } from './patternTool';
import { CYPHER } from '../../../lib/geometry/patterns';

/** Cypher pattern: five points X A B C D with two filled triangles and the Cypher ratio lines. */
export const cypherPattern = patternTool({
  id: 'cypherPattern',
  label: 'Cypher pattern',
  spec: CYPHER,
  icon: (
    <Svg>
      <polyline points="3,17 7,6 11,13 20,4 15,18" />
    </Svg>
  ),
});
