import type { Scenario } from '../scenario.ts';
import { alerts } from './alerts.ts';
import { customTimeframe } from './custom-timeframe.ts';
import { builtTimeframe } from './built-timeframe.ts';
import { chart } from './chart.ts';
import { chartHistory } from './chart-history.ts';
import { chartPan } from './chart-pan.ts';
import { chartPanes } from './chart-panes.ts';
import { btProgress } from './bt-progress.ts';
import { btRange } from './bt-range.ts';
import { btResults } from './bt-results.ts';
import { chartRange } from './chart-range.ts';
import { chartReset } from './chart-reset.ts';
import { drawingChannels } from './drawing-channels.ts';
import { drawingCycles } from './drawing-cycles.ts';
import { drawingPitchforks } from './drawing-pitchforks.ts';
import { drawingManage } from './drawing-manage.ts';
import { drawingElliott } from './drawing-elliott.ts';
import { drawingFib } from './drawing-fib.ts';
import { drawingGann } from './drawing-gann.ts';
import { drawingFibTrend } from './drawing-fib-trend.ts';
import { drawingLines } from './drawing-lines.ts';
import { drawingPatterns } from './drawing-patterns.ts';
import { drawingRail } from './drawing-rail.ts';
import { drawingShapes } from './drawing-shapes.ts';
import { drawingImage } from './drawing-image.ts';
import { drawingNotes } from './drawing-notes.ts';
import { drawingForecast } from './drawing-forecast.ts';
import { drawingBars } from './drawing-bars.ts';
import { drawingRanges } from './drawing-ranges.ts';
import { drawingPositions } from './drawing-positions.ts';
import { drawingPriceMarkers } from './drawing-price-markers.ts';
import { drawingTable } from './drawing-table.ts';
import { drawingToolbar } from './drawing-toolbar.ts';
import { drawingIcons } from './drawing-icons.ts';
import { drawingVolume } from './drawing-volume.ts';
import { drawingText } from './drawing-text.ts';
import { drawings } from './drawings.ts';
import { drawingSettings } from './drawing-settings.ts';
import { compare } from './compare.ts';
import { connStatus } from './conn-status.ts';
import { zoneClock } from './zone-clock.ts';
import { layouts } from './layouts.ts';
import { networkAudit } from './network-audit.ts';
import { paneResize } from './pane-resize.ts';
import { pineConvert } from './pine-convert.ts';
import { pineLibraries } from './pine-libraries.ts';
import { pineDrawings } from './pine-drawings.ts';
import { pinePane } from './pine-pane.ts';
import { pineRender } from './pine-render.ts';
import { replay } from './replay.ts';
import { responsive } from './responsive.ts';
import { monteCarlo } from './monte-carlo.ts';
import { optimizer } from './optimizer.ts';
import { outage } from './outage.ts';
import { uiAudit } from './ui-audit.ts';
import { watchlist } from './watchlist.ts';

// Add a scenario: create a file in this folder and list it here.
const all: Scenario[] = [alerts, drawingBars, btProgress, btRange, btResults, builtTimeframe, chart, chartHistory, chartPan, chartPanes, chartRange, chartReset, compare, connStatus, customTimeframe, drawingChannels, drawingCycles, drawingElliott, drawingFib, drawingFibTrend, drawingForecast, drawingGann, drawingIcons, drawingImage, drawingPitchforks, drawingLines, drawingManage, drawingNotes, drawingPatterns, drawingPositions, drawingPriceMarkers, drawingRail, drawingRanges, drawingShapes, drawingTable, drawingText, drawingToolbar, drawingVolume, drawings, drawingSettings, layouts, monteCarlo, networkAudit, optimizer, outage, paneResize, pineConvert, pineDrawings, pineLibraries, pinePane, pineRender, replay, responsive, uiAudit, watchlist, zoneClock];


export const scenarios = new Map<string, Scenario>();
for (const s of all) {
  if (scenarios.has(s.name)) throw new Error(`duplicate e2e scenario name: ${s.name}`);
  scenarios.set(s.name, s);
}
