import type { Scenario } from '../scenario.ts';
import { showSideSection } from '../side-panel.ts';

export const btPineRole: Scenario = {
  name: 'bt-pine-role',
  description: 'Composed with a stored TradingView indicator: the entry rule, a filter, a trailing stop and a target picked from the Backtest tab, the Results line counting its blocks, the stop-loss exits and badges, the empty-library hint and the failure when the indicator is removed',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page, viewport } = ctx;
    const narrow = viewport === 'narrow';
    const dialog = page.locator('.modal', { has: page.getByRole('heading', { name: 'TradingView indicators' }) });
    const openBacktest = async () => {
      const tab = page.locator('.dock-tab', { hasText: 'Backtest' });
      if (!(await tab.evaluate((el) => el.classList.contains('active')))) await tab.click();
      await page.getByLabel('Strategy').waitFor();
    };
    const button = page.getByRole('button', { name: 'TradingView indicators', exact: true });
    /** Opens the TradingView indicators dialog from the Pine pane, opening the pane first when it is closed. */
    const openDialog = async () => {
      if (!(await button.isVisible())) {
        await showSideSection(page, 'Indicators', narrow);
        await page.locator('#add-indicator-select').selectOption('pine');
        await page.getByRole(narrow ? 'dialog' : 'region', { name: 'Pine editor' }).waitFor();
      }
      await button.click();
      await dialog.waitFor();
    };
    const entry = page.locator('.bt-role[aria-label="Entry indicator"]');
    const filter = page.locator('.bt-role[aria-label="Indicator filter 1"]');
    const stop = page.locator('.bt-role[aria-label="Indicator stop"]');
    const target = page.locator('.bt-role[aria-label="Indicator target"]');

    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();
    await ctx.step('pick Composed and the TradingView indicator entry rule: the empty library says where to add one', async () => {
      await openBacktest();
      await page.getByLabel('Strategy').selectOption('composed');
      await page.getByLabel('Entry rule').selectOption({ label: 'TradingView indicator' });
      await page.getByText('No TradingView indicators are stored.').first().waitFor();
      await page.getByLabel('Entry rule').scrollIntoViewIfNeeded();
    });
    await ctx.screenshot('empty-library');
    await ctx.step('add the fake upstream Supertrend from the Pine pane', async () => {
      await openDialog();
      await dialog.getByLabel('Search TradingView').fill('Supertrend');
      await dialog.getByRole('button', { name: 'Search', exact: true }).click();
      await dialog.getByRole('button', { name: /^Add Supertrend by alice/ }).click();
      await dialog.getByRole('list', { name: 'Added indicators' }).getByText('by alice').waitFor();
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
    });
    await ctx.step('back in the Backtest tab, pick it as the entry: close crosses Supertrend', async () => {
      if (narrow) await page.keyboard.press('Escape');
      await openBacktest();
      await page.locator('.dock-tab', { hasText: 'Results' }).click();
      await openBacktest();
      await page.getByLabel('Shorts').selectOption('yes');
      await page.getByLabel('Direction').selectOption('3');
      // A few hundred bars keep the indicator run short.
      await page.getByLabel('Time range From').fill('2020-03-01T00:00');
      await page.getByLabel('Time range To').fill('2020-09-30T00:00');
      await entry.getByLabel('Entry indicator').selectOption({ label: 'Supertrend' });
      await entry.getByLabel('Crossing').waitFor();
      await entry.getByLabel('Against').selectOption('plot:Supertrend');
    });
    await ctx.step('add a filter: close above Supertrend, labelled trend', async () => {
      await page.getByRole('button', { name: 'Add TradingView indicator filter' }).click();
      await filter.getByLabel('Filter label').waitFor();
      await filter.getByLabel('Filter label').selectOption('trend');
      await filter.getByLabel('Rule', { exact: true }).selectOption('above');
      // The entry is already "close crosses Supertrend", so a filter on the same line would never block: ask for the line itself above a level.
      await filter.getByLabel('Value', { exact: true }).selectOption('plot:Supertrend');
      await filter.getByLabel('Above', { exact: true }).selectOption('level');
      await filter.getByLabel('Above level').fill('56');
      await entry.scrollIntoViewIfNeeded();
    });
    await ctx.screenshot('picker');
    await ctx.step('run and see the filter line with the indicator filter', async () => {
      await page.getByRole('button', { name: /Run backtest/ }).click({ timeout: 60000 });
      await page.getByText(/Backtest finished/).waitFor({ timeout: 60000 });
      const close = page.locator('.toast button');
      if ((await close.count()) > 0) await close.last().click({ timeout: 2000 }).catch(() => {});
      await page.locator('.dock-tab', { hasText: 'Results' }).click();
      const line = page.getByTestId('filters-line');
      await line.waitFor();
      const text = (await line.textContent()) ?? '';
      if (!/Supertrend \(trend\) blocked \d+/.test(text)) throw new Error(`Unexpected filter line: ${text}`);
      await line.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    });
    await ctx.screenshot('results');
    await ctx.step('add the indicator as a trailing stop and as a target, then run', async () => {
      await page.locator('.dock-tab', { hasText: 'Backtest' }).click();
      await page.getByRole('button', { name: 'Add TradingView indicator stop' }).click();
      await stop.getByLabel('Stop mode').waitFor();
      await stop.getByLabel('Stop mode').selectOption('trailing');
      await page.getByRole('button', { name: 'Add TradingView indicator target' }).click();
      await target.getByLabel('Plot').waitFor();
      await stop.scrollIntoViewIfNeeded();
    });
    await ctx.screenshot('stop-picker');
    await ctx.step('run and see the badges and a stop-loss exit at the plot', async () => {
      await page.getByRole('button', { name: /Run backtest/ }).click({ timeout: 60000 });
      await page.getByText(/Backtest finished/).waitFor({ timeout: 60000 });
      const close = page.locator('.toast button');
      if ((await close.count()) > 0) await close.last().click({ timeout: 2000 }).catch(() => {});
      await page.locator('.dock-tab', { hasText: 'Results' }).click();
      await page.getByText('Trail Supertrend Supertrend').first().waitFor();
      await page.getByText('TP Supertrend Supertrend').first().waitFor();
      await page.getByText('Trail Supertrend Supertrend').first().evaluate((el) => el.scrollIntoView({ block: 'center' }));
    });
    await ctx.screenshot('stop-results');
    await ctx.step('scroll to the trades list: an exit at the stop plot is a stop loss', async () => {
      const cell = page.getByRole('cell', { name: 'stop loss', exact: true }).first();
      await cell.waitFor();
      await cell.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    });
    await ctx.screenshot('stop-trades');
    await ctx.step('remove the stop and the target again', async () => {
      await page.locator('.dock-tab', { hasText: 'Backtest' }).click();
      await stop.getByRole('button', { name: 'Remove' }).click();
      await target.getByRole('button', { name: 'Remove' }).click();
    });
    await ctx.step('remove the indicator from the library: the run fails naming it', async () => {
      await openDialog();
      await dialog.getByRole('button', { name: 'Remove Supertrend' }).click();
      await dialog.getByText('No TradingView indicators added yet.').waitFor();
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      if (narrow) await page.keyboard.press('Escape');
      await openBacktest();
      await page.getByRole('button', { name: /Run backtest/ }).click();
      await page.getByText(/Backtest failed: .*"Supertrend" is no longer stored/).first().waitFor();
    });
    await ctx.screenshot('removed');
  },
};
