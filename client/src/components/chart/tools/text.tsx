import { Svg } from '../../DrawingIcons';
import { NOTE_SIZE, textBoxTool, textSettings } from './textBox';
import type { DrawingTool } from './types';

/** Text keeps its original look (12 px, wrapped at 240 px) so notes saved before the Text tab hold still look the same. */
export const text: DrawingTool = {
  id: 'text',
  label: 'Text',
  group: 'annotations',
  section: 'Text',
  icon: (
    <Svg>
      <path d="M5 6V5h14v1M12 5v14M9 19h6" />
    </Svg>
  ),
  anchors: 1,
  text: true,
  settings: textSettings(NOTE_SIZE, true),
  ...textBoxTool(false),
};
