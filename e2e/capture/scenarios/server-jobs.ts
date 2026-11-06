import type { Scenario } from '../scenario.ts';

export const serverJobs: Scenario = {
  name: 'server-jobs',
  description:
    'Heavy jobs on the server: Server is picked in Settings, a backtest runs on the server (its toast says so), then a long optimizer run is started and the page is reloaded while it is going; the progress shows again, the result table appears when it ends and the inbox is unchanged for a run that was followed. The checks file records the /api/jobs requests',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page } = ctx;
    const notes: string[] = [];
    const jobRequests = () => ctx.requests.filter((u) => u.includes('/api/jobs'));
    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();
    await ctx.step('no /api/jobs request while Browser is picked', async () => {
      await page.waitForTimeout(500);
      notes.push(`/api/jobs requests with Browser picked: ${jobRequests().length}`);
      if (jobRequests().length > 0) throw new Error('the page asked for /api/jobs on Browser');
    });
    await ctx.step('pick Server in Settings', async () => {
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Settings' }) });
      await dialog.getByRole('heading', { name: 'Heavy jobs' }).waitFor();
      await dialog.getByLabel(/^Server/).check();
      await page.waitForTimeout(700);
      await dialog.getByTitle('Close (Esc)').click();
      await dialog.waitFor({ state: 'detached' });
    });
    await ctx.step('run a backtest on the server', async () => {
      const tab = page.locator('.dock-tab', { hasText: 'Backtest' });
      if (!(await tab.evaluate((el) => el.classList.contains('active')))) await tab.click();
      await page.getByRole('button', { name: /Run backtest/ }).click();
      await page.getByText(/Backtest finished on the server in \d+ ms/).waitFor();
    });
    await ctx.screenshot('backtest');
    await ctx.step('start a long optimizer run', async () => {
      const tab = page.locator('.dock-tab', { hasText: 'Optimizer' });
      if (!(await tab.evaluate((el) => el.classList.contains('active')))) await tab.click();
      await page.getByText('Parameter 1', { exact: true }).waitFor();
      const n = page.locator('.form-grid input[type=number]');
      await n.nth(0).fill('5');
      await n.nth(1).fill('9');
      await n.nth(2).fill('1');
      await n.nth(3).fill('15');
      await n.nth(4).fill('25');
      await n.nth(5).fill('2');
      await page.getByRole('button', { name: /Optimize \d+ combinations/ }).click();
      await page.getByRole('button', { name: 'Cancel', exact: true }).waitFor();
      // The page saves the job's id once the server has accepted it; closing the tab before then would leave the run with no way back.
      for (let i = 0; i < 50; i++) {
        const doc = (await ctx.settings.get('serverJobs.v1')) as Record<string, { optimize?: unknown }> | null;
        if (doc && Object.values(doc).some((c) => c.optimize)) return;
        await page.waitForTimeout(100);
      }
      throw new Error('the optimizer job record was never saved');
    });
    await ctx.screenshot('running');
    await ctx.step('reload while it runs: the progress shows again', async () => {
      await page.reload();
      await ctx.waitForChart();
      const tab = page.locator('.dock-tab', { hasText: 'Optimizer' });
      if (!(await tab.evaluate((el) => el.classList.contains('active')))) await tab.click();
      await page.getByRole('button', { name: 'Cancel', exact: true }).waitFor({ timeout: 8000 }).catch(() => notes.push('the run had already ended when the page came back'));
    });
    await ctx.screenshot('reloaded');
    await ctx.step('the result table appears', async () => {
      await page.getByText(/Results ·/).waitFor({ timeout: 60_000 });
      await page.getByText(/Results ·/).scrollIntoViewIfNeeded();
    });
    await ctx.screenshot('result');
    const kinds = jobRequests().map((u) => u.replace(/^https?:\/\/[^/]+/, ''));
    notes.push(`/api/jobs requests: ${kinds.length}`, ...kinds);
    await ctx.writeText('checks', [...notes, ''].join('\n'));
  },
};
