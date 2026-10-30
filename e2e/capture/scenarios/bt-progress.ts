import type { Scenario } from '../scenario.ts';

export const btProgress: Scenario = {
  name: 'bt-progress',
  description:
    'Backtest progress bar on demo data. A run is too fast to catch on screen, so the page wraps the Worker (test side only, the app is unchanged) to hold back the worker messages once the run is about 40% simulated; the real progress messages up to there are delivered. Captures the bar under the Run button, in the Results tab, then the finished state with the bar gone',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page } = ctx;
    await ctx.step('hold worker messages past 40% of the simulation', () =>
      page.addInitScript(() => {
        const w = window as unknown as { __btRelease: () => void };
        const held: { handler: ((ev: MessageEvent) => void) | null; ev: MessageEvent }[] = [];
        let holding = false;
        const Native = window.Worker;
        class HoldWorker extends Native {
          private handler: ((ev: MessageEvent) => void) | null = null;
          constructor(url: string | URL, opts?: WorkerOptions) {
            super(url, opts);
            super.onmessage = (ev: MessageEvent) => {
              if (holding) {
                held.push({ handler: this.handler, ev });
                return;
              }
              if (ev.data?.type === 'progress' && ev.data.stage === 'simulating' && ev.data.pct >= 0.5) holding = true;
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
        w.__btRelease = () => {
          holding = false;
          for (const { handler, ev } of held.splice(0)) handler?.(ev);
        };
      }),
    );
    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();
    await ctx.step('open the Backtest pane', async () => {
      const tab = page.locator('.dock-tab', { hasText: 'Backtest' });
      if (!(await tab.evaluate((el) => el.classList.contains('active')))) await tab.click();
      await page.getByRole('button', { name: /Run backtest/ }).waitFor();
    });
    await ctx.step('run and wait for the bar', async () => {
      await page.getByRole('button', { name: /Run backtest/ }).click();
      await page.getByRole('progressbar', { name: 'Backtest progress' }).waitFor();
      await page.getByText(/Simulating trades \d+%/).first().waitFor();
      await page.getByRole('progressbar').scrollIntoViewIfNeeded();
    });
    await ctx.screenshot('backtest-tab');
    await ctx.step('the Results tab shows the same bar', async () => {
      await page.locator('.dock-tab', { hasText: 'Results' }).click();
      await page.getByRole('progressbar', { name: 'Backtest progress' }).waitFor();
      const now = Number(await page.getByRole('progressbar').getAttribute('aria-valuenow'));
      if (!(now > 0 && now < 100)) throw new Error(`expected a mid-run value, got aria-valuenow=${now}`);
    });
    await ctx.screenshot('results-tab');
    await ctx.step('release the run and the bar goes away', async () => {
      await page.evaluate(() => (window as unknown as { __btRelease: () => void }).__btRelease());
      await page.getByText(/Backtest finished/).waitFor();
      await page.getByRole('progressbar').waitFor({ state: 'detached' });
    });
    await ctx.screenshot('finished');
  },
};
