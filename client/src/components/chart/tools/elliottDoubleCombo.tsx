import { Svg } from '../../DrawingIcons';
import { elliottTool } from './elliottTool';

/** Elliott double combo wave: the origin and waves W, X and Y. */
export const elliottDoubleCombo = elliottTool({
  id: 'elliottDoubleCombo',
  label: 'Elliott double combo wave',
  kind: 'doubleCombo',
  icon: (
    <Svg>
      <polyline points="2,6 8,19 13,11 21,20" />
    </Svg>
  ),
});
