import type { Scenario } from '../scenario.ts';

export const customTimeframe: Scenario = {
  name: 'custom-timeframe',
  description: 'Coinbase on the fake upstream: the Custom intervals dialog refuses 2000 minutes, adds 2 hours (built from 1h), charts it live, keeps it across a reload and removes it',
  keepPrefs: true, // the reload step needs the saved preferences kept
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page } = ctx;
    const narrow = ctx.viewport === 'narrow';
    const more = page.getByRole('button', { name: 'More', exact: true });
    const providerSelect = narrow ? page.getByRole('dialog', { name: 'More' }).locator('select').first() : page.locator('.topbar select').first();
    const title = (tf: string) => page.locator('.chart-legend .legend-title', { hasText: `Coinbase · BTC-USD · ${tf}` });
    const timeframeSelect = page.locator('.topbar select[title="Timeframe"]');
    const dialog = page.locator('.modal', { has: page.getByRole('heading', { name: 'Custom intervals' }) });
    const openDialog = async () => {
      await timeframeSelect.selectOption({ label: 'Add interval...' });
      await dialog.waitFor();
    };
    const noOverflow = async () => {
      const over = await dialog.evaluate((el) => el.scrollWidth > el.clientWidth || el.getBoundingClientRect().right > window.innerWidth);
      if (over) throw new Error('the dialog overflows the viewport');
    };
    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();
    await ctx.step('switch to Coinbase', async () => {
      if (narrow) await more.click();
      await providerSelect.selectOption('coinbase');
      await title('1h').waitFor();
      if (narrow) await page.keyboard.press('Escape');
    });
    await ctx.step('the picker ends with Add interval... and picking it keeps the timeframe', async () => {
      await openDialog();
      if ((await timeframeSelect.inputValue()) !== '1h') throw new Error('the add entry changed the timeframe');
    });
    await ctx.screenshot('picker-entry');
    await ctx.step('2000 minutes is refused with a message and Add disabled', async () => {
      await dialog.getByLabel('Interval length').fill('2000');
      await dialog.getByLabel('Interval unit').selectOption('m');
      await dialog.getByText('Minutes go up to 1440.').waitFor();
      if (!(await dialog.getByRole('button', { name: 'Add', exact: true }).isDisabled())) throw new Error('Add is enabled');
      await noOverflow();
    });
    await ctx.screenshot('refused');
    await ctx.step('2 hours previews as built from 1h and is added', async () => {
      await dialog.getByLabel('Interval length').fill('2');
      await dialog.getByLabel('Interval unit').selectOption('h');
      await dialog.getByText('2h - built from 1h').waitFor();
      await dialog.getByRole('button', { name: 'Add', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
      await title('2h').waitFor();
      const labels = await timeframeSelect.locator('option:not([disabled]):not([value="__add-interval"])').allTextContents();
      const i = labels.indexOf('2h *');
      if (i < 0 || labels[i - 1] !== '1h') throw new Error(`picker shows ${labels.join(', ')}`);
      const t = await timeframeSelect.locator('option', { hasText: '2h' }).getAttribute('title');
      if (t !== 'Built from 1h') throw new Error(`2h option title is ${t}`);
    });
    await ctx.screenshot('added');
    if (!narrow) {
      await ctx.step('charts open live: the last 2h bar updates', async () => {
        const liveButton = page.locator('.topbar button.badge').first();
        const ohlc = page.locator('.chart-legend .legend-ohlc');
        const before = await ohlc.innerText();
        await liveButton.filter({ hasText: /^\s*LIVE\s*$/ }).waitFor();
        await page.waitForFunction(
          (text) => (document.querySelector('.chart-legend .legend-ohlc') as HTMLElement | null)?.innerText !== text,
          before,
          { timeout: 20_000 },
        );
      });
      await ctx.screenshot('live');
    }
    await ctx.step('a reload keeps the list and the chart on 2h', async () => {
      await page.waitForTimeout(800); // the saved preferences are written after a short delay
      await page.reload();
      await title('2h').waitFor();
      if ((await timeframeSelect.inputValue()) !== '2h') throw new Error('the chart did not stay on 2h');
    });
    await ctx.screenshot('reloaded');
    await ctx.step('remove 2h: the chart returns to the default timeframe', async () => {
      await openDialog();
      await dialog.getByRole('button', { name: 'Remove 2h' }).click();
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await title('1h').waitFor();
      const labels = await timeframeSelect.locator('option').allTextContents();
      if (labels.some((l) => l.startsWith('2h'))) throw new Error('2h is still in the picker');
    });
    await ctx.screenshot('removed');
  },
};
