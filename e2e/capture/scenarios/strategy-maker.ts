import type { Scenario } from '../scenario.ts';

const CSV = 'time,open,high,low,close,volume\n' +
  Array.from({ length: 120 }, (_, i) => {
    const base = 100 + Math.sin(i / 8) * 10 + i * 0.1;
    return `${1700000000 + i * 3600},${base.toFixed(2)},${(base + 2).toFixed(2)},${(base - 2).toFixed(2)},${(base + Math.sin(i) * 1.5).toFixed(2)},${100 + i}`;
  }).join('\n');

export const strategyMaker: Scenario = {
  name: 'strategy-maker',
  description: 'Strategy maker page (/strategy-maker): empty, a demo market, a CSV file; proves it opens no live stream and the main app never requests its chunk',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page, viewport } = ctx;
    await ctx.step('open /strategy-maker', () => page.goto('/strategy-maker'));
    await page.getByRole('heading', { name: 'Strategy maker' }).waitFor();
    await ctx.step('title and empty library', async () => {
      if ((await page.title()) !== 'Strategy maker - Vost') throw new Error(`title: ${await page.title()}`);
      await page.getByText('No saved datasets.').waitFor();
    });
    await ctx.screenshot('empty');
    await ctx.step('load a demo market', async () => {
      await page.getByLabel('Provider').selectOption({ label: 'Demo (offline)' });
      await page.getByRole('button', { name: 'Load market' }).click();
      await page.getByText(/ candles$/).waitFor();
      await page.locator('.sm-chart canvas').first().waitFor();
    });
    await ctx.screenshot('market');
    await ctx.step('load a CSV file', async () => {
      await page.locator('input[type=file]').setInputFiles({ name: 'sample.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
      await page.getByText('sample.csv - 120 candles').waitFor();
    });
    await ctx.screenshot('csv');
    await ctx.step('a bad file shows a message, not a crash', async () => {
      await page.locator('input[type=file]').setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from('hello') });
      await page.getByRole('alert').waitFor();
    });
    await ctx.step('no horizontal page scroll', async () => {
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (over > 0) throw new Error(`page scrolls horizontally by ${over}px at ${viewport}`);
    });
    await ctx.step('no live stream, sockets or alert polling', async () => {
      const bad = ctx.requests.filter((u) => {
        const url = new URL(u);
        return url.protocol.startsWith('ws') || /^\/api\/(live|alerts)/.test(url.pathname);
      });
      await ctx.writeText('requests', ctx.requests.join('\n') + '\n');
      if (bad.length) throw new Error(`the strategy maker requested ${bad.join(', ')}`);
    });
    await ctx.step('the main app requests no strategy maker chunk', async () => {
      const mark = ctx.requests.length;
      await page.goto('/');
      await ctx.waitForChart();
      const seen = ctx.requests.slice(mark).filter((u) => /strateg/i.test(u));
      await ctx.writeText('main-requests', ctx.requests.slice(mark).join('\n') + '\n');
      if (seen.length) throw new Error(`the main app requested ${seen.join(', ')}`);
    });
  },
};
