import { Svg } from '../../DrawingIcons';
import { textBoxTool, textSettings } from './textBox';
import type { DrawingTool } from './types';

/** A note fixed on the pane: it keeps its spot whatever the chart's range, zoom or timeframe. */
export const anchoredText: DrawingTool = {
  id: 'anchoredText',
  label: 'Anchored text',
  group: 'annotations',
  section: 'Text',
  icon: (
    <Svg>
      <path d="M5 6V5h10v1M10 5v9M8 14h4M18 12v7M15 16l3 3 3-3" />
    </Svg>
  ),
  anchors: 1,
  text: true,
  paneAnchored: true,
  settings: textSettings(14, false),
  ...textBoxTool(true),
};
