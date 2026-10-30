import { Svg } from '../../DrawingIcons';
import { elliottTool } from './elliottTool';

/** Elliott triangle wave: the origin and waves A to E. */
export const elliottTriangle = elliottTool({
  id: 'elliottTriangle',
  label: 'Elliott triangle wave',
  kind: 'triangle',
  icon: (
    <Svg>
      <polyline points="2,12 6,3 10,18 13,7 16,15 19,10" />
    </Svg>
  ),
});
