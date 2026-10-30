import { Svg } from '../../DrawingIcons';
import { elliottTool } from './elliottTool';

/** Elliott impulse wave: the origin and waves 1 to 5. */
export const elliottImpulse = elliottTool({
  id: 'elliottImpulse',
  label: 'Elliott impulse wave',
  kind: 'impulse',
  icon: (
    <Svg>
      <polyline points="2,20 6,10 9,15 15,4 18,10 22,3" />
    </Svg>
  ),
});
