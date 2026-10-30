import type { Scenario } from '../scenario.ts';

export const settings: Scenario = {
  name: 'settings',
  description: 'The gear at the right end of the top bar opens the Settings popup; picking "Load all bars at once" saves the setting, reloads the chart and shows the Bars menu',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page, viewport } = ctx;
    const narrow = viewport === 'narrow';
    const notes: string[] = [];
    const history = () => ctx.requests.filter((u) => u.includes('/api/history?'));
    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();
    await ctx.step('switch to Binance (its history comes from /api/history)', async () => {
      if (narrow) await page.getByRole('button', { name: 'More', exact: true }).click();
      await page.getByLabel('Provider', { exact: true }).selectOption('binance');
      await page.locator('.chart-legend .legend-title', { hasText: 'Binance' }).waitFor();
      await page.locator('.chart-legend .legend-ohlc').waitFor();
      await page.waitForTimeout(800);
      if (narrow) await page.keyboard.press('Escape');
    });
    const gear = page.getByRole('button', { name: 'Settings', exact: true });
    await ctx.step('the gear is visible', async () => {
      await gear.waitFor({ state: 'visible' });
      notes.push(`gear visible at ${viewport}: true`);
    });
    await ctx.screenshot('topbar');
    await ctx.step('open the popup', () => gear.click());
    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Settings' }) });
    await ctx.step('the dialog heading is Settings and Load as you scroll back is checked', async () => {
      await dialog.waitFor();
      notes.push(`dialog heading: ${(await dialog.locator('h2').innerText()).trim()}`);
      if (!(await dialog.getByLabel(/Load as you scroll back/).isChecked())) throw new Error('scroll is not checked');
    });
    await ctx.screenshot('open');
    await ctx.step('Escape closes it', async () => {
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      notes.push('Escape closes the popup: true');
    });
    const before = history().length;
    await ctx.step('pick Load all bars at once', async () => {
      await gear.click();
      await dialog.getByLabel(/Load all bars at once/).check();
      await page.waitForTimeout(800);
    });
    await ctx.step('close with the close button', async () => {
      await dialog.getByTitle('Close (Esc)').click();
      await dialog.waitFor({ state: 'detached' });
    });
    await ctx.step('the Bars menu is shown', async () => {
      if (narrow) await page.getByRole('button', { name: 'More', exact: true }).click();
      await page.getByLabel('Number of bars', { exact: true }).waitFor({ state: 'visible' });
    });
    await ctx.screenshot('all');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('vost.prefs.v1') ?? '{}').historyLoading);
    notes.push(`vost.prefs.v1 historyLoading: ${saved}`, `new /api/history requests after the switch: ${history().length - before}`);
    await ctx.step('the choice is saved and the chart reloaded', async () => {
      if (saved !== 'all') throw new Error(`saved ${saved}`);
      if (history().length <= before) throw new Error('no new history request after the switch');
    });
    await ctx.writeText('checks', [...notes, ''].join('\n'));
  },
};
