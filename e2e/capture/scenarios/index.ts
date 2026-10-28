import type { Scenario } from '../scenario.ts';
import { chart } from './chart.ts';
import { chartPan } from './chart-pan.ts';
import { btRange } from './bt-range.ts';
import { chartRange } from './chart-range.ts';
import { chartReset } from './chart-reset.ts';
import { connStatus } from './conn-status.ts';
import { zoneClock } from './zone-clock.ts';
import { networkAudit } from './network-audit.ts';
import { paneResize } from './pane-resize.ts';
import { pineTab } from './pine-tab.ts';
import { responsive } from './responsive.ts';
import { outage } from './outage.ts';
import { watchlist } from './watchlist.ts';

// Add a scenario: create a file in this folder and list it here.
const all: Scenario[] = [btRange, chart, chartPan, chartRange, chartReset, connStatus, networkAudit, outage, paneResize, pineTab, responsive, watchlist, zoneClock];


export const scenarios = new Map<string, Scenario>();
for (const s of all) {
  if (scenarios.has(s.name)) throw new Error(`duplicate e2e scenario name: ${s.name}`);
  scenarios.set(s.name, s);
}
