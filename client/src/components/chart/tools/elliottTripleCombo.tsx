import { Svg } from '../../DrawingIcons';
import { elliottTool } from './elliottTool';

/** Elliott triple combo wave: the origin and waves W, X, Y, X and Z. */
export const elliottTripleCombo = elliottTool({
  id: 'elliottTripleCombo',
  label: 'Elliott triple combo wave',
  kind: 'tripleCombo',
  icon: (
    <Svg>
      <polyline points="2,6 6,16 9,10 13,19 17,12 22,20" />
    </Svg>
  ),
});
