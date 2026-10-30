import type { Scenario } from '../scenario.ts';
import { alerts } from './alerts.ts';
import { customTimeframe } from './custom-timeframe.ts';
import { builtTimeframe } from './built-timeframe.ts';
import { chart } from './chart.ts';
import { chartPan } from './chart-pan.ts';
import { btProgress } from './bt-progress.ts';
import { btRange } from './bt-range.ts';
import { btResults } from './bt-results.ts';
import { chartRange } from './chart-range.ts';
import { chartReset } from './chart-reset.ts';
import { drawingChannels } from './drawing-channels.ts';
import { drawingManage } from './drawing-manage.ts';
import { drawingFib } from './drawing-fib.ts';
import { drawingLines } from './drawing-lines.ts';
import { drawingRail } from './drawing-rail.ts';
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
import { pinePane } from './pine-pane.ts';
import { replay } from './replay.ts';
import { responsive } from './responsive.ts';
import { monteCarlo } from './monte-carlo.ts';
import { optimizer } from './optimizer.ts';
import { outage } from './outage.ts';
import { uiAudit } from './ui-audit.ts';
import { watchlist } from './watchlist.ts';

// Add a scenario: create a file in this folder and list it here.
const all: Scenario[] = [alerts, btProgress, btRange, btResults, builtTimeframe, chart, chartPan, chartRange, chartReset, compare, connStatus, customTimeframe, drawingChannels, drawingFib, drawingLines, drawingManage, drawingRail, drawingText, drawings, drawingSettings, layouts, monteCarlo, networkAudit, optimizer, outage, paneResize, pineConvert, pineLibraries, pinePane, replay, responsive, uiAudit, watchlist, zoneClock];


export const scenarios = new Map<string, Scenario>();
for (const s of all) {
  if (scenarios.has(s.name)) throw new Error(`duplicate e2e scenario name: ${s.name}`);
  scenarios.set(s.name, s);
}
