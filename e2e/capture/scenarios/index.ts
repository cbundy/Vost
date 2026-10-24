import type { Scenario } from '../scenario.ts';
import { chart } from './chart.ts';
import { chartPan } from './chart-pan.ts';

// Add a scenario: create a file in this folder and list it here.
const all: Scenario[] = [chart, chartPan];

export const scenarios = new Map<string, Scenario>();
for (const s of all) {
  if (scenarios.has(s.name)) throw new Error(`duplicate e2e scenario name: ${s.name}`);
  scenarios.set(s.name, s);
}
