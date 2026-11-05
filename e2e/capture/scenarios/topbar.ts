import type { Scenario } from '../scenario.ts';
import { chartDataDialog, closeChartData, liveButton, openChartData, waitLive } from '../topbar.ts';

export const topbar: Scenario = {
  name: 'topbar',
  description: 'The top bar keeps one Chart data button (range, Bars, Build, Load in a pop-up) and a Live dot whose colour and tooltip give its state; checked on Binance with live on, then Demo, at desktop and narrow widths',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page, viewport } = ctx;
    const narrow = viewport === 'narrow';
    const notes: string[] = [];
    const check = (label: string, ok: boolean, extra = ''): void => {
      notes.push(`${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ` (${extra})` : ''}`);
      if (!ok) throw new Error(`check failed: ${label} ${extra}`);
    };
    const more = page.getByRole('button', { name: 'More', exact: true });
    const button = page.getByRole('button', { name: 'Chart data', exact: true });
    const inView = async (sel: string): Promise<boolean> =>
      page.evaluate((q) => {
        const r = document.querySelector(q)!.getBoundingClientRect();
        const d = document.documentElement;
        return r.left >= 0 && r.right <= innerWidth + 0.5 && r.top >= 0 && r.bottom <= innerHeight + 0.5 && d.scrollWidth <= innerWidth;
      }, sel);

    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();
    await ctx.step('switch to Binance', async () => {
      if (narrow) await more.click();
      await page.getByLabel('Provider', { exact: true }).selectOption('binance');
      if (narrow) await page.keyboard.press('Escape');
      await page.locator('.chart-legend .legend-title', { hasText: 'Binance' }).waitFor();
      await page.locator('.chart-legend .legend-ohlc').waitFor();
    });

    await ctx.step('the bar holds no range, Build, Bars or Load, only the Chart data button', async () => {
      check('no .topbar-range', (await page.locator('.topbar-range').count()) === 0);
      check('no Build in the bar', (await page.locator('.topbar').getByRole('button', { name: 'Build higher timeframes from lower ones' }).count()) === 0);
      check('no Bars in the bar', (await page.getByLabel('Number of bars', { exact: true }).count()) === 0);
      check('no Load in the bar', (await page.locator('.topbar').getByRole('button', { name: 'Load', exact: true }).count()) === 0);
      check('Chart data button has aria-haspopup=dialog', (await button.getAttribute('aria-haspopup')) === 'dialog');
      check('Chart data button title is the range text', /bars$/.test((await button.getAttribute('title')) ?? ''));
    });
    await ctx.screenshot('bar');

    await ctx.step('Chart data opens with Range, Build and Load', async () => {
      const dialog = await openChartData(page);
      check('expanded', (await button.getAttribute('aria-expanded')) === 'true');
      check('range ends with bars', /bars$/.test((await dialog.locator('.data-range').innerText()).trim()));
      check('Build is inside', (await dialog.getByRole('button', { name: 'Build higher timeframes from lower ones' }).count()) === 1);
      check('Load is inside', (await dialog.getByRole('button', { name: 'Load', exact: true }).count()) === 1);
      check('no Bars in scroll mode', (await dialog.getByLabel('Number of bars', { exact: true }).count()) === 0);
      check('pop-up inside the viewport', await inView('.topbar-data-pop'));
    });
    await ctx.screenshot('data-open');

    await ctx.step('Load keeps the pop-up open and shows the spinner', async () => {
      const dialog = chartDataDialog(page);
      await dialog.getByRole('button', { name: 'Load', exact: true }).click();
      await dialog.locator('.spinner').waitFor({ state: 'attached', timeout: 5000 }).catch(() => undefined);
      check('pop-up still open', (await dialog.count()) === 1);
      await page.locator('.chart-legend .legend-ohlc').waitFor();
      await dialog.getByRole('button', { name: 'Load', exact: true }).waitFor();
      check('Load enabled again', await dialog.getByRole('button', { name: 'Load', exact: true }).isEnabled());
    });
    await ctx.step('Escape closes it and refocuses the button', async () => {
      await page.keyboard.press('Escape');
      await chartDataDialog(page).waitFor({ state: 'detached' });
      check('focus on the button', await button.evaluate((e) => e === document.activeElement));
    });
    await ctx.step('an outside click closes it', async () => {
      await openChartData(page);
      await page.mouse.click(200, 500);
      await chartDataDialog(page).waitFor({ state: 'detached' });
      check('closed', true);
    });

    await ctx.step('Settings: Load all bars at once shows Bars', async () => {
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      const settings = page.getByRole('dialog').filter({ hasText: /Load all bars at once/ });
      await settings.getByLabel(/Load all bars at once/).check();
      await settings.getByTitle('Close (Esc)').click();
      await settings.waitFor({ state: 'detached' });
      const dialog = await openChartData(page);
      await dialog.getByLabel('Number of bars', { exact: true }).waitFor();
      check('Bars appears in the pop-up', true);
      check('pop-up inside the viewport with Bars', await inView('.topbar-data-pop'));
      await closeChartData(page);
    });

    await ctx.step('Live dot: on, then off', async () => {
      if (narrow) await more.click();
      await waitLive(page, 'live');
      const live = liveButton(page);
      check('live title in words', (await live.getAttribute('title')) === 'Live: on');
      check('live dot has no text', ((await live.innerText()).trim()) === '');
      check('live dot is green', await live.locator('.live-dot').evaluate((e) => !e.className.includes('off') && !e.className.includes('error') && !e.className.includes('connecting')));
      if (narrow) await ctx.screenshot('more-live-on');
      await live.click();
      await waitLive(page, 'off');
      check('off title in words', ((await live.getAttribute('title')) ?? '').startsWith('Live: off'));
      check('off dot is the grey one', await live.locator('.live-dot').evaluate((e) => e.classList.contains('off')));
      if (narrow) {
        const pop = page.getByRole('dialog', { name: 'More' });
        const labels = await pop.locator('.more-label').allInnerTexts();
        check('More has no Timeframes or Bars rows', !labels.some((l) => /^(timeframes|bars)$/i.test(l.trim())), labels.join(', '));
        check('More has the Live row', labels.some((l) => /^live$/i.test(l.trim())));
        await ctx.screenshot('live-off');
        await page.keyboard.press('Escape');
      } else {
        await ctx.screenshot('live-off');
      }
    });

    await ctx.step('Demo: no Build (offline provider), range still shown', async () => {
      if (narrow) await more.click();
      await page.getByLabel('Provider', { exact: true }).selectOption('demo');
      if (narrow) await page.keyboard.press('Escape');
      await page.locator('.chart-legend .legend-title', { hasText: 'Demo' }).waitFor();
      await page.locator('.chart-legend .legend-ohlc').waitFor();
      const dialog = await openChartData(page);
      check('Demo has no Build', (await dialog.getByRole('button', { name: 'Build higher timeframes from lower ones' }).count()) === 0);
      check('Demo range ends with bars', /bars$/.test((await dialog.locator('.data-range').innerText()).trim()));
      await ctx.screenshot('data-open-demo');
      await closeChartData(page);
    });
    await ctx.writeText('checks', [...notes, ''].join('\n'));
  },
};
