import { openChartData, closeChartData } from '../topbar.ts';
import type { Scenario } from '../scenario.ts';

export const settings: Scenario = {
  name: 'settings',
  description: 'The gear at the right end of the top bar opens the Settings popup; picking "Load all bars at once" saves the setting, reloads the chart and shows the Bars menu; the Pine scripts section offers "Only finished bars (no repaint)", which is saved and still checked after reopening; the Heavy jobs section offers Server, saved and still checked after reopening',
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
    // waitFor visible only checks for a non-empty box, so check the gear is on screen and the page has not scrolled sideways
    const inViewport = async (label: string) => {
      const r = await page.evaluate((el) => {
        const b = el!.getBoundingClientRect();
        const d = document.documentElement;
        return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, w: window.innerWidth, h: window.innerHeight, sw: d.scrollWidth };
      }, await gear.elementHandle());
      const ok = r.left >= 0 && r.right <= r.w && r.top >= 0 && r.bottom <= r.h && r.sw <= r.w;
      notes.push(`gear inside viewport at ${viewport} (${label}): ${ok} (right ${Math.round(r.right)} of ${r.w}, scrollWidth ${r.sw})`);
      if (!ok) throw new Error(`gear not inside the viewport (${label}): ${JSON.stringify(r)}`);
    };
    await ctx.step('the gear is visible', async () => {
      await gear.waitFor({ state: 'visible' });
      await inViewport('topbar');
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
      await openChartData(page);
      await page.getByLabel('Number of bars', { exact: true }).waitFor({ state: 'visible' });
    });
    await ctx.step('the gear is still inside the viewport with the Bars menu', async () => {
      await closeChartData(page);
      await inViewport('with Bars menu');
      await openChartData(page);
    });
    await ctx.screenshot('all');
    await page.waitForTimeout(700);
    const saved = ((await ctx.settings.get('prefs.v1')) as { historyLoading?: string } | null)?.historyLoading;
    notes.push(`prefs.v1 historyLoading: ${saved}`, `new /api/history requests after the switch: ${history().length - before}`);
    await ctx.step('the choice is saved and the chart reloaded', async () => {
      if (saved !== 'all') throw new Error(`saved ${saved}`);
      if (history().length <= before) throw new Error('no new history request after the switch');
    });
    await ctx.step('the Pine scripts section defaults to following the forming bar, and picking Only finished bars saves it', async () => {
      await page.keyboard.press('Escape');
      await gear.click();
      await dialog.getByRole('heading', { name: 'Pine scripts' }).waitFor();
      if (!(await dialog.getByLabel(/Follow the forming bar/).isChecked())) throw new Error('forming is not checked');
      await ctx.screenshot('pine-default');
      await dialog.getByLabel(/Only finished bars/).check();
      await page.waitForTimeout(300);
      await dialog.getByTitle('Close (Esc)').click();
      await dialog.waitFor({ state: 'detached' });
      await gear.click();
      await dialog.waitFor();
      if (!(await dialog.getByLabel(/Only finished bars/).isChecked())) throw new Error('finished is not still checked after reopening');
      await ctx.screenshot('pine-finished');
    });
    await ctx.step('the Heavy jobs section defaults to Browser, and picking Server saves it and is still checked after reopening', async () => {
      await dialog.getByRole('heading', { name: 'Heavy jobs' }).waitFor();
      if (!(await dialog.getByLabel(/^Browser/).isChecked())) throw new Error('browser is not checked');
      await dialog.getByLabel(/^Server/).check();
      await page.waitForTimeout(300);
      await dialog.getByTitle('Close (Esc)').click();
      await dialog.waitFor({ state: 'detached' });
      await gear.click();
      await dialog.waitFor();
      if (!(await dialog.getByLabel(/^Server/).isChecked())) throw new Error('server is not still checked after reopening');
      await dialog.getByRole('heading', { name: 'Heavy jobs' }).scrollIntoViewIfNeeded();
      await ctx.screenshot('heavy-jobs-server');
    });
    await page.waitForTimeout(700);
    const savedJobs = ((await ctx.settings.get('prefs.v1')) as { jobPlace?: string } | null)?.jobPlace;
    notes.push(`prefs.v1 jobPlace: ${savedJobs}`);
    if (savedJobs !== 'server') throw new Error(`jobPlace saved ${savedJobs}`);
    const savedPine = ((await ctx.settings.get('prefs.v1')) as { pineHigherBars?: string } | null)?.pineHigherBars;
    notes.push(`prefs.v1 pineHigherBars: ${savedPine}`);
    if (savedPine !== 'finished') throw new Error(`pineHigherBars saved ${savedPine}`);
    await ctx.writeText('checks', [...notes, ''].join('\n'));
  },
};
