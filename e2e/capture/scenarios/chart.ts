import type { Scenario } from '../scenario.ts';

export const chart: Scenario = {
  name: 'chart',
  description: 'Main chart view with Demo data, desktop and narrow screenshots',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    await ctx.step('open app', () => ctx.page.goto('/'));
    await ctx.waitForChart();
    await ctx.screenshot();
  },
};
