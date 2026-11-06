import type { Scenario } from '../scenario.ts';

const RUN_LIMIT_MS = 60_000;

export const strategySearch: Scenario = {
  name: 'strategy-search',
  description:
    'Strategy maker "Search markets" panel (/strategy-maker): the lists and defaults, the combination count, an over-budget choice refused, a run in progress (the page wraps the Worker, test side only, to hold back the final result message so the bar can be caught), Cancel back to idle, a finished run on the Indices list with a held row, a closest-found row and a skipped market, and the main app opened from Open in Backtest on that result\'s market and timeframe with the risk per trade set',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page } = ctx;
    await ctx.step('hold back the final sweep result so a run can be caught in progress', () =>
      page.addInitScript(() => {
        const w = window as unknown as { __sweepHold: boolean; __sweepRelease: () => void };
        const held: { handler: ((ev: MessageEvent) => void) | null; ev: MessageEvent }[] = [];
        w.__sweepHold = false;
        const Native = window.Worker;
        class HoldWorker extends Native {
          private handler: ((ev: MessageEvent) => void) | null = null;
          constructor(url: string | URL, opts?: WorkerOptions) {
            super(url, opts);
            super.onmessage = (ev: MessageEvent) => {
              if (w.__sweepHold && ev.data?.type === 'sweep-result') {
                held.push({ handler: this.handler, ev });
                return;
              }
              this.handler?.(ev);
            };
          }
          override set onmessage(fn: ((ev: MessageEvent) => void) | null) {
            this.handler = fn;
          }
          override get onmessage() {
            return this.handler;
          }
        }
        window.Worker = HoldWorker as unknown as typeof Worker;
        w.__sweepRelease = () => {
          w.__sweepHold = false;
          for (const { handler, ev } of held.splice(0)) handler?.(ev);
        };
      }),
    );
    await ctx.step('open /strategy-maker and find the Search markets panel with its lists', async () => {
      await page.goto('/strategy-maker');
      await page.getByRole('heading', { name: 'Search markets' }).waitFor();
      await page.getByRole('checkbox', { name: /^Indices/ }).waitFor();
    });
    const panel = page.getByRole('region', { name: 'Search markets' });
    const run = panel.getByRole('button', { name: 'Search markets' });
    const count = panel.locator('.sm-sweep-count');
    await panel.scrollIntoViewIfNeeded();
    await ctx.step('defaults: nothing picked, 1d and 1w, 75/1 or 50/4, 1000 and 2%, Run off with its reason', async () => {
      const text = (await count.innerText()).replace(/\s+/g, ' ');
      if (text !== '0 markets x 2 timeframes = 0 combinations') throw new Error(`count: ${text}`);
      if (!(await run.isDisabled())) throw new Error('Run is on with no list');
      await panel.getByText('Pick at least one market list.').waitFor();
      const values = await panel.locator('input[inputmode=decimal]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
      if (values.join(',') !== '75,1,50,4,1000,2,10,5') throw new Error(`numbers: ${values.join(',')}`);
      await panel.getByText('or', { exact: true }).waitFor();
    });
    await ctx.screenshot('panel');
    await ctx.step('a bad number is marked and turns Run off with the reason', async () => {
      await panel.getByLabel('Risk per trade').fill('abc');
      await panel.getByText('Risk per trade must be a number.').waitFor();
      await panel.getByText('Fix the numbers marked above.').waitFor();
      await panel.getByLabel('Risk per trade').fill('2');
    });
    await ctx.step('every list, timeframe and indicator is over the budget: Run is off and the limit is named', async () => {
      for (const box of await panel.getByRole('group', { name: 'Market lists' }).getByRole('checkbox').all()) await box.check();
      for (const box of await panel.getByRole('group', { name: 'Timeframes' }).getByRole('checkbox').all()) await box.check();
      for (const box of await panel.getByRole('group', { name: 'Indicators' }).getByRole('checkbox').all()) await box.check();
      for (const box of await panel.getByRole('group', { name: /^Stop/ }).getByRole('checkbox').all()) await box.check();
      for (const box of await panel.getByRole('group', { name: /^Take profit/ }).getByRole('checkbox').all()) await box.check();
      await panel.getByText(/over the limit of 2,000,000/).first().waitFor();
      if (!(await run.isDisabled())) throw new Error('Run is on over the budget');
      await ctx.writeText('over-budget', (await count.innerText()) + '\n');
    });
    await ctx.screenshot('over-budget');
    await ctx.step('back to a small search: the Indices list on the daily timeframe', async () => {
      await page.reload();
      await panel.getByRole('checkbox', { name: /^Indices/ }).check();
      await panel.getByRole('group', { name: 'Timeframes' }).getByLabel('1w').uncheck();
      await panel.getByLabel('Long and short').check();
      const text = (await count.innerText()).replace(/\s+/g, ' ');
      if (!/^10 markets x 1 timeframe = [\d,]+ combinations$/.test(text)) throw new Error(`count: ${text}`);
      await ctx.writeText('count', text + '\n');
      if (await run.isDisabled()) throw new Error('Run is off');
    });
    await ctx.screenshot('ready');
    await ctx.step('a run shows its progress bar with percent and market', async () => {
      await page.evaluate(() => ((window as unknown as { __sweepHold: boolean }).__sweepHold = true));
      await run.click();
      await panel.getByRole('progressbar', { name: 'Search progress' }).waitFor();
      await panel.getByText(/^\d+% - /).waitFor({ timeout: RUN_LIMIT_MS });
      await panel.getByText('100% - done').waitFor({ timeout: RUN_LIMIT_MS });
    });
    await panel.locator('.sm-progress').evaluate((el) => el.scrollIntoView({ block: 'end' }));
    await ctx.screenshot('running');
    await ctx.step('Cancel returns the panel to idle within a second', async () => {
      const t0 = Date.now();
      await panel.getByRole('button', { name: 'Cancel' }).click();
      await run.waitFor({ timeout: 1000 });
      if (Date.now() - t0 > 1000) throw new Error('slow cancel');
      if (await panel.getByRole('progressbar').count()) throw new Error('the bar stayed');
      if (await panel.getByRole('region', { name: 'Search results' }).count()) throw new Error('a cancelled run showed results');
    });
    await ctx.screenshot('cancelled');
    await ctx.step('a finished run lists ranked results, with a held row and a skipped market', async () => {
      await page.evaluate(() => ((window as unknown as { __sweepHold: boolean }).__sweepHold = false));
      await run.click();
      await panel.getByRole('region', { name: 'Search results' }).waitFor({ timeout: RUN_LIMIT_MS });
      await panel.getByRole('heading', { name: 'Skipped' }).waitFor();
      await panel.getByText(/^Tried [\d,]+ combinations: /).waitFor();
      await panel.getByText(/can be luck/).waitFor();
      if (!(await panel.locator('.sm-table tbody tr td:nth-child(11)', { hasText: 'yes' }).count())) throw new Error('no row held on unseen data');
      await ctx.writeText('results', (await panel.getByRole('region', { name: 'Search results' }).innerText()) + '\n');
    });
    await panel.getByRole('region', { name: 'Search results' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await ctx.screenshot('results');
    await ctx.step('the table scrolls inside its own box, not the page', async () => {
      const wide = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      if (wide) throw new Error('the page scrolls sideways');
      const box = await panel.locator('.sm-table-wrap').evaluate((el) => ({ inner: el.scrollWidth, outer: el.clientWidth }));
      await ctx.writeText('table-box', JSON.stringify(box) + '\n');
    });
    await ctx.step('a header sorts the table', async () => {
      const col = async () => panel.locator('.sm-table tbody tr td:first-child').allInnerTexts();
      await panel.getByRole('button', { name: /^Market/ }).click();
      const asc = await col();
      if (asc.join() !== [...asc].sort((a, b) => a.localeCompare(b)).join()) throw new Error('not sorted by market');
      await panel.getByRole('button', { name: /^Market/ }).click();
      const desc = await col();
      if (desc.join() !== [...desc].sort((a, b) => b.localeCompare(a)).join() || desc[0] === asc[0]) throw new Error('not sorted by market, descending');
    });
    let opened = '';
    await ctx.step('Open in Backtest opens a new tab address with the market and timeframe', async () => {
      await page.evaluate(() => {
        (window as unknown as { __opened: unknown[] }).__opened = [];
        window.open = ((...a: unknown[]) => void (window as unknown as { __opened: unknown[] }).__opened.push(a)) as typeof window.open;
      });
      await panel.getByRole('button', { name: 'Open in Backtest' }).first().click();
      const calls = await page.evaluate(() => (window as unknown as { __opened: unknown[][] }).__opened);
      if (calls.length !== 1 || calls[0][1] !== '_blank') throw new Error(`window.open calls ${JSON.stringify(calls)}`);
      opened = String(calls[0][0]);
      if (!opened.startsWith('/#backtest=')) throw new Error(`opened ${opened}`);
    });
    await ctx.step('stricter targets leave nothing met: the closest found per market, with its gaps in words', async () => {
      await panel.getByLabel('Min R:R').nth(0).fill('20');
      await panel.getByLabel('Min R:R').nth(1).fill('');
      await panel.getByLabel('Min hit rate').nth(1).fill('');
      await run.click();
      await panel.getByRole('heading', { name: 'Closest found' }).waitFor({ timeout: RUN_LIMIT_MS });
      await panel.getByText(/you asked for at least/).first().waitFor();
      await ctx.writeText('closest', (await panel.getByRole('heading', { name: 'Closest found' }).locator('xpath=..').innerText()) + '\n');
    });
    await panel.getByRole('heading', { name: 'Closest found' }).evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await ctx.screenshot('closest');
    await ctx.step('the main app opens on that market and timeframe with the Backtest tab filled in', async () => {
      await page.goto('about:blank');
      await page.goto(opened);
      const toast = page.getByText(/^Backtest set from the strategy maker on /);
      await toast.waitFor();
      const text = await toast.innerText();
      await ctx.writeText('handoff-toast', text + '\n');
      const market = /^Backtest set from the strategy maker on (\^[A-Z0-9]+) 1d:/.exec(text);
      if (!market) throw new Error(`toast: ${text}`);
      await page.locator('.chart-container canvas').first().waitFor({ state: 'visible' });
      await page.locator('.chart-legend', { hasText: `${market[1]} · 1d` }).first().waitFor({ state: 'visible' });
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      await page.getByRole('combobox', { name: 'Strategy' }).waitFor();
      await page.getByText('Risk per trade (%)').waitFor();
    });
    await ctx.screenshot('handoff-backtest');
  },
};
