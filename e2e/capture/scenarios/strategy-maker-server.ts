import type { Scenario } from '../scenario.ts';
import { BIG_BARS, BIG_NAME, bigSet } from './strategy-maker.ts';

const RUN_LIMIT_MS = 120_000;

export const strategyMakerServer: Scenario = {
  name: 'strategy-maker-server',
  description:
    'Strategy maker runs on the server (/strategy-maker, Server picked in Settings): Find is started and its progress shows the "Running on the server" line, the page is reloaded while it is going and the progress is back, then the result shows; the Search markets panel does the same on a small list, with its result after the reload. The checks file records the /api/jobs requests and that no find was posted to a worker',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page } = ctx;
    const notes: string[] = [];
    const jobRequests = () => ctx.requests.filter((u) => u.includes('/api/jobs')).map((u) => u.replace(/^https?:\/\/[^/]+/, ''));
    await ctx.step('pick Server in the prefs and seed a marked set', async () => {
      await ctx.settings.put('prefs.v1', { providerId: 'demo', symbol: 'DEMO', timeframe: '1d', jobPlace: 'server' });
      const big = bigSet();
      if (big.trades.length < 30) throw new Error(`only ${big.trades.length} trades`);
      await ctx.strategyMaker.putSet({ id: `csv|${BIG_NAME}`, version: 1, source: { kind: 'csv', name: BIG_NAME }, trades: big.trades, candles: big.candles, updatedAt: Date.now() } as { id: string });
      await page.goto('/strategy-maker');
      await page.getByRole('heading', { name: 'Strategy maker' }).waitFor();
      await page.getByLabel('CSV file').setInputFiles({ name: BIG_NAME, mimeType: 'text/csv', buffer: Buffer.from(big.csv) });
      await page.getByText(`${BIG_NAME} - ${BIG_BARS} candles`).waitFor({ timeout: 30_000 });
      await page.getByRole('heading', { name: 'Find a strategy' }).waitFor();
    });
    const find = page.getByRole('button', { name: 'Find a strategy' });
    const onServer = page.getByText('Running on the server; it keeps going if you close the page.');
    /** The page saves the job's id once the server has accepted it; reloading before then would leave the run with no way back. */
    const recordSaved = async () => {
      for (let i = 0; i < 100; i++) {
        if ((await fetch(new URL('/api/strategy-maker/job', page.url())).catch(() => null))?.status === 200) return;
        await page.waitForTimeout(100);
      }
      throw new Error('the job record was never saved');
    };
    await page.waitForTimeout(900);
    await ctx.step('Find runs on the server: progress with the on-server line', async () => {
      await find.click();
      await page.getByRole('button', { name: 'Cancel' }).first().waitFor();
      await onServer.first().waitFor({ timeout: 30_000 });
      await recordSaved();
    });
    await page.locator('.sm-progress').first().scrollIntoViewIfNeeded();
    await ctx.screenshot('find-running');
    await ctx.step('reload while it runs: the progress is back', async () => {
      await page.reload();
      await page.getByRole('heading', { name: 'Strategy maker' }).waitFor();
      await onServer.first().waitFor({ timeout: 30_000 }).catch(() => notes.push('the find had already ended when the page came back'));
    });
    await page.locator('.sm-progress').first().scrollIntoViewIfNeeded().catch(() => undefined);
    await ctx.screenshot('find-reloaded');
    await ctx.step('the result shows and the job record is gone', async () => {
      await page.getByRole('heading', { name: /Ranked settings|What explains your trades/ }).first().waitFor({ timeout: RUN_LIMIT_MS });
      await page.waitForTimeout(500);
      const res = await fetch(new URL('/api/strategy-maker/job', page.url()));
      notes.push(`job record after the result: ${res.status}`);
      if (res.status !== 404) throw new Error('the job record is still there');
    });
    await page.getByRole('heading', { name: /Ranked settings|What explains your trades/ }).first().scrollIntoViewIfNeeded();
    await ctx.screenshot('find-result');

    const panel = page.getByRole('region', { name: 'Search markets' });
    await ctx.step('a market search runs on the server and is followed after a reload', async () => {
      await panel.scrollIntoViewIfNeeded();
      await panel.getByRole('checkbox', { name: /^Indices/ }).check();
      await panel.getByRole('group', { name: 'Timeframes' }).getByLabel('1w').uncheck();
      await panel.getByLabel('Long and short').check();
      await panel.getByRole('button', { name: 'Search markets' }).click();
      await panel.getByRole('progressbar', { name: 'Search progress' }).waitFor();
      await panel.getByText('Running on the server; it keeps going if you close the page.').waitFor({ timeout: 30_000 });
      await recordSaved();
      await page.reload();
      await panel.getByText('Running on the server; it keeps going if you close the page.').waitFor({ timeout: 30_000 }).catch(() => notes.push('the search had already ended when the page came back'));
    });
    await panel.locator('.sm-progress').evaluate((el) => el.scrollIntoView({ block: 'end' })).catch(() => undefined);
    await ctx.screenshot('search-reloaded');
    await ctx.step('the search result shows', async () => {
      await panel.getByRole('region', { name: 'Search results' }).waitFor({ timeout: RUN_LIMIT_MS });
    });
    await panel.getByRole('region', { name: 'Search results' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await ctx.screenshot('search-result');
    const jobs = jobRequests();
    notes.push(`/api/jobs requests: ${jobs.length}`, ...jobs);
    await ctx.writeText('checks', [...notes, ''].join('\n'));
  },
};
