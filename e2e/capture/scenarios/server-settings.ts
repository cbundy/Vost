import type { Scenario } from '../scenario.ts';

const OFFLINE = 'Settings are not saved: the Vost server cannot be reached';

export const serverSettings: Scenario = {
  name: 'server-settings',
  description:
    'Everything the app keeps lives on the server: old browser data is moved over once (inbox message, browser emptied); a changed setting and a drawn line are there in a brand-new browser on the same server; failed saves raise one outage toast and then "Settings saved again"; with /api/settings unreachable the page shows the start-up error and Retry brings the chart back',
  async run(ctx) {
    const { page } = ctx;
    const notes: string[] = [];
    const check = (label: string, ok: boolean, detail = '') => {
      notes.push(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` - ${detail}` : ''}`);
      if (!ok) throw new Error(`check failed: ${label} ${detail}`);
    };
    const toasts = page.locator('.toasts .toast');
    const settingsButton = page.getByTitle('Vost settings');
    const settingsDialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Settings' }) });
    const countdown = (p: typeof page) => p.getByRole('dialog').getByLabel(/Countdown to bar close/);

    await ctx.step('open the app, then leave old browser data behind as an earlier version would have', async () => {
      await page.goto('/');
      await ctx.waitForChart();
      await page.evaluate(() => {
        localStorage.setItem('vost.compare.v1', JSON.stringify({ texts: ['a', 'b', 'c', 'd'], count: 3, reference: 1 }));
        // the server already has prefs.v1, so this one is archived instead of adopted
        localStorage.setItem('vost.prefs.v1', JSON.stringify({ providerId: 'demo', symbol: 'DEMO', timeframe: '1h' }));
        localStorage.setItem('vost.unreadable', '{not json');
      });
    });

    await ctx.step('reload: the old data moves to the server once', async () => {
      await page.reload();
      await ctx.waitForChart();
      const left = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('vost.')));
      check('only the unparsable key is left in the browser', left.join() === 'vost.unreadable', left.join());
      check('compare.v1 is on the server', JSON.stringify(await ctx.settings.get('compare.v1')) === JSON.stringify({ texts: ['a', 'b', 'c', 'd'], count: 3, reference: 1 }));
      const prefs = (await ctx.settings.get('prefs.v1')) as { timeframe: string };
      check('the server prefs were not overwritten', prefs.timeframe === '1d', prefs.timeframe);
      await page.getByRole('button', { name: 'Inbox' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByText(/from this browser to the server/).waitFor();
      check('the inbox says what moved', (await dialog.innerText()).includes('settings-imported-'));
      await ctx.screenshot('migration');
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
    });

    await ctx.step('turn the countdown off and draw a trend line', async () => {
      await settingsButton.click();
      await countdown(page).uncheck();
      await page.keyboard.press('Escape');
      await settingsDialog.waitFor({ state: 'detached' });
      await page.getByRole('toolbar', { name: 'Drawing tools' }).getByRole('button', { name: 'Trend line' }).click();
      const b = await page.locator('.chart-container').boundingBox();
      if (!b) throw new Error('chart container has no box');
      await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.6);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width * 0.8, b.y + b.height * 0.3, { steps: 15 });
      await page.mouse.up();
      await page.waitForTimeout(1200);
      const drawings = await ctx.settings.get('drawings.v2');
      check('the line is saved on the server', JSON.stringify(drawings).includes('trendLine'));
      check('the setting is saved on the server', ((await ctx.settings.get('prefs.v1')) as { barCountdown?: boolean }).barCountdown === false);
    });

    await ctx.step('a brand-new browser on the same server has both', async () => {
      const browser = page.context().browser();
      if (!browser) throw new Error('no browser');
      const fresh = await browser.newContext({ viewport: page.viewportSize() ?? undefined, baseURL: new URL(page.url()).origin });
      try {
        const other = await fresh.newPage();
        await other.goto('/');
        await other.locator('.chart-container canvas').first().waitFor({ state: 'visible' });
        await other.locator('.chart-legend .legend-title', { hasText: 'DEMO' }).waitFor({ state: 'visible' });
        await other.getByTitle('Vost settings').click();
        check('the countdown is still off', !(await countdown(other).isChecked()));
        await other.keyboard.press('Escape');
        await other.getByRole('dialog').waitFor({ state: 'detached' });
        await other.waitForTimeout(500);
        const stored = await other.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('vost.')));
        check('the new browser keeps no copy', stored.length === 0, stored.join());
        await ctx.screenshot('fresh-browser', other);
      } finally {
        await fresh.close();
      }
    });

    await ctx.step('failed saves raise one outage toast, and one when saving works again', async () => {
      await page.route('**/api/settings/*', (route) => (route.request().method() === 'PUT' ? route.abort() : route.fallback()));
      await settingsButton.click();
      await countdown(page).check();
      await page.keyboard.press('Escape');
      await settingsDialog.waitFor({ state: 'detached' });
      await toasts.filter({ hasText: OFFLINE }).first().waitFor({ timeout: 8000 });
      await page.waitForTimeout(2500);
      check('one outage toast, however many retries', (await toasts.filter({ hasText: OFFLINE }).count()) === 1);
      await ctx.screenshot('outage');
      await page.unroute('**/api/settings/*');
      await toasts.filter({ hasText: 'Settings saved again' }).first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(500);
      check('the retried save reached the server', ((await ctx.settings.get('prefs.v1')) as { barCountdown?: boolean }).barCountdown !== false);
      await ctx.screenshot('saved-again');
    });

    await ctx.step('with /api/settings unreachable the page shows the start-up error, and Retry brings the chart back', async () => {
      await page.route('**/api/settings', (route) => route.abort());
      await page.goto('/');
      await page.getByRole('heading', { name: 'The Vost server cannot be reached' }).waitFor();
      check('no chart is built', (await page.locator('.chart-container').count()) === 0);
      await ctx.screenshot('startup-error');
      await page.unroute('**/api/settings');
      await page.getByRole('button', { name: 'Retry' }).click();
      await ctx.waitForChart();
      await ctx.screenshot('retried');
    });

    await ctx.writeText('checks', notes.join('\n') + '\n');
  },
};
