import { Svg } from '../../DrawingIcons';
import { elliottTool } from './elliottTool';

/** Elliott correction wave: the origin and waves A, B and C. */
export const elliottCorrection = elliottTool({
  id: 'elliottCorrection',
  label: 'Elliott correction wave',
  kind: 'correction',
  icon: (
    <Svg>
      <polyline points="2,4 8,18 14,10 21,20" />
    </Svg>
  ),
});
