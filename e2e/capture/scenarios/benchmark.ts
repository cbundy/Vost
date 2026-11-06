import type { Scenario } from '../scenario.ts';

export const benchmark: Scenario = {
  name: 'benchmark',
  description:
    'Settings > Heavy jobs: the Auto hint asks for the benchmark; Run benchmark times five standard jobs in the browser and on the server (the progress line names the job running), then shows the table with the time in each place and which was faster; Auto is picked, the table and Auto are still there after reopening, and a backtest on the chart carries "(Auto)" in its finish message. The checks file records the saved benchmark.v1 fields and the placement the chart job was posted with',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page } = ctx;
    const notes: string[] = [];
    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();
    const gear = page.getByRole('button', { name: 'Settings', exact: true });
    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Settings' }) });
    const openSettings = async () => {
      await gear.click();
      await dialog.waitFor();
      await dialog.getByRole('heading', { name: 'Heavy jobs' }).scrollIntoViewIfNeeded();
    };
    await ctx.step('the Auto hint asks for the benchmark and only the Run benchmark button shows', async () => {
      await openSettings();
      const hint = await dialog.locator('.settings-radio', { hasText: /^Auto/ }).innerText();
      notes.push(`Auto hint before a benchmark: ${hint.replace(/\s+/g, ' ')}`);
      if (!hint.includes('Run the benchmark to let Auto choose')) throw new Error('the Auto hint does not ask for the benchmark');
      if ((await dialog.getByRole('table', { name: 'Benchmark result' }).count()) !== 0) throw new Error('a table shows before any run');
      await dialog.getByRole('button', { name: 'Run benchmark' }).scrollIntoViewIfNeeded();
    });
    await ctx.screenshot('before');
    await ctx.step('run the benchmark: the progress line names the job running', async () => {
      await dialog.getByRole('button', { name: 'Run benchmark' }).click();
      const progress = dialog.getByRole('status').filter({ hasText: /^Benchmark: / });
      await progress.waitFor();
      notes.push(`progress line: ${(await progress.innerText()).trim()}`);
      await dialog.getByRole('button', { name: 'Cancel' }).waitFor();
    });
    await ctx.screenshot('running');
    await ctx.step('the table shows the five jobs', async () => {
      const table = dialog.getByRole('table', { name: 'Benchmark result' });
      await table.waitFor({ timeout: 180_000 });
      await table.scrollIntoViewIfNeeded();
      const rows = await table.locator('tbody tr').allInnerTexts();
      for (const r of rows) notes.push(`row: ${r.replace(/\s+/g, ' | ')}`);
      if (rows.length !== 5) throw new Error(`${rows.length} rows`);
    });
    await ctx.screenshot('results');
    let doc: { at?: number; userAgent?: string; cores?: number | null; serverVersion?: string | null; jobs?: Record<string, { browserMs: number | null; serverMs: number | null; serverError?: string }> } | null = null;
    await ctx.step('benchmark.v1 is saved with every field', async () => {
      for (let i = 0; i < 30 && !doc; i++) {
        doc = (await ctx.settings.get('benchmark.v1')) as typeof doc;
        if (!doc) await page.waitForTimeout(200);
      }
      if (!doc) throw new Error('benchmark.v1 was never saved');
      notes.push(`benchmark.v1 at: ${doc.at} (${new Date(doc.at ?? 0).toISOString()})`, `benchmark.v1 userAgent: ${doc.userAgent}`, `benchmark.v1 cores: ${doc.cores}`, `benchmark.v1 serverVersion: ${doc.serverVersion}`);
      for (const [k, j] of Object.entries(doc.jobs ?? {})) notes.push(`benchmark.v1 jobs.${k}: browserMs ${j.browserMs?.toFixed(0)}, serverMs ${j.serverMs?.toFixed(0) ?? null}${j.serverError ? `, serverError ${j.serverError}` : ''}`);
      if (Object.keys(doc.jobs ?? {}).length !== 5) throw new Error('the document does not hold five jobs');
    });
    await ctx.step('pick Auto, close and reopen: Auto and the table are still there', async () => {
      await dialog.getByLabel(/^Auto/).check();
      await page.waitForTimeout(500);
      await dialog.getByTitle('Close (Esc)').click();
      await dialog.waitFor({ state: 'detached' });
      await openSettings();
      if (!(await dialog.getByLabel(/^Auto/).isChecked())) throw new Error('Auto is not still checked');
      await dialog.getByRole('table', { name: 'Benchmark result' }).waitFor();
      const hint = await dialog.locator('.settings-radio', { hasText: /^Auto/ }).innerText();
      notes.push(`Auto hint after a benchmark: ${hint.replace(/\s+/g, ' ')}`);
      if (hint.includes('Run the benchmark')) throw new Error('the Auto hint still asks for the benchmark');
      await dialog.getByRole('table', { name: 'Benchmark result' }).scrollIntoViewIfNeeded();
    });
    await ctx.screenshot('auto');
    await ctx.step('a backtest carries (Auto) in its finish message', async () => {
      await dialog.getByTitle('Close (Esc)').click();
      await dialog.waitFor({ state: 'detached' });
      const tab = page.locator('.dock-tab', { hasText: 'Backtest' });
      if (!(await tab.evaluate((el) => el.classList.contains('active')))) await tab.click();
      await page.getByRole('button', { name: /Run backtest/ }).click();
      const toast = page.getByText(/Backtest finished (on the server|in the browser) \(Auto\) in \d+ ms/);
      await toast.waitFor();
      notes.push(`finish message: ${(await toast.first().innerText()).trim()}`);
    });
    await ctx.screenshot('finished');
    await ctx.step('the job was posted with the placement Auto chose', async () => {
      const jobs = await page.evaluate(async () => ((await (await fetch('/api/jobs')).json()) as { jobs: Array<{ kind: string; scope: string; placement?: unknown }> }).jobs);
      const chart = jobs.filter((j) => j.scope !== 'benchmark' && j.scope !== 'strategy-maker');
      const bench = jobs.filter((j) => j.scope === 'benchmark');
      notes.push(`server jobs in scope benchmark: ${bench.length}`);
      if (chart.length === 0) notes.push('chart job placement: browser (Auto chose the browser, so no server job was posted)');
      for (const j of chart) notes.push(`chart job ${j.kind} placement: ${JSON.stringify(j.placement)}`);
      if (chart.some((j) => (j.placement as { reason?: string } | undefined)?.reason !== 'auto')) throw new Error('a chart job was posted without reason auto');
    });
    await ctx.step('with the server saved as faster, Auto sends the backtest to the server and posts the figures', async () => {
      // A saved benchmark in which the server won every job: the real one above depends on the machine.
      const won = { browserMs: 900, serverMs: 300 };
      await ctx.settings.put('benchmark.v1', { ...doc, at: 1_700_000_000_000, jobs: { run: won, optimize: won, montecarlo: won, find: won, sweep: won } });
      await page.reload();
      await ctx.waitForChart();
      const tab = page.locator('.dock-tab', { hasText: 'Backtest' });
      if (!(await tab.evaluate((el) => el.classList.contains('active')))) await tab.click();
      await page.getByRole('button', { name: /Run backtest/ }).click();
      const toast = page.getByText(/Backtest finished on the server \(Auto\) in \d+ ms/);
      await toast.waitFor();
      notes.push(`finish message with the server faster: ${(await toast.first().innerText()).trim()}`);
      const jobs = await page.evaluate(async () => ((await (await fetch('/api/jobs')).json()) as { jobs: Array<{ kind: string; scope: string; placement?: unknown }> }).jobs);
      const chart = jobs.filter((j) => j.scope !== 'benchmark' && j.scope !== 'strategy-maker');
      for (const j of chart) notes.push(`chart job ${j.kind} placement: ${JSON.stringify(j.placement)}`);
      const p = chart[0]?.placement as { where?: string; reason?: string; benchmark?: { browserMs?: number; serverMs?: number; at?: number } } | undefined;
      if (p?.where !== 'server' || p.reason !== 'auto' || p.benchmark?.serverMs !== 300 || p.benchmark?.browserMs !== 900 || p.benchmark?.at !== 1_700_000_000_000) throw new Error(`placement ${JSON.stringify(p)}`);
    });
    await ctx.screenshot('finished-server');
    await ctx.writeText('checks', [...notes, ''].join('\n'));
  },
};
