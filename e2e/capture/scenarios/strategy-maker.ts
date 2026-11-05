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

    const chart = page.locator('.sm-chart');
    const rows = page.locator('.sm-row');
    const drag = async (from: number, to: number) => {
      const box = await chart.boundingBox();
      if (!box) throw new Error('no chart box');
      const y = box.y + box.height / 2;
      await page.mouse.move(box.x + box.width * from, y);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * ((from + to) / 2), y, { steps: 4 });
      await page.mouse.move(box.x + box.width * to, y, { steps: 4 });
      await page.mouse.up();
    };
    const expectRows = async (n: number) => {
      await page.waitForFunction((want) => document.querySelectorAll('.sm-row').length === want, n);
    };
    await ctx.step('a long and a short stroke mark two trades, shown in the list and the counter', async () => {
      await page.getByRole('button', { name: 'Brush long' }).click();
      if ((await page.getByRole('button', { name: 'Brush long' }).getAttribute('aria-pressed')) !== 'true') throw new Error('brush not pressed');
      await drag(0.2, 0.4);
      await page.getByRole('button', { name: 'Brush short' }).click();
      await drag(0.7, 0.5);
      await expectRows(2);
      await page.getByText('2 of 30 trades').waitFor();
      await page.getByText('mark 28 more').waitFor();
    });
    await ctx.screenshot('marked');
    await ctx.step('a click without a drag marks nothing', async () => {
      const box = await chart.boundingBox();
      if (!box) throw new Error('no chart box');
      await page.mouse.click(box.x + box.width * 0.9, box.y + box.height / 2);
      await expectRows(2);
    });
    await ctx.step('the eraser removes the stroked trade', async () => {
      await page.keyboard.press('e');
      await drag(0.25, 0.3);
      await expectRows(1);
      await page.getByText('1 of 30 trades').waitFor();
    });
    await ctx.screenshot('erased');
    await ctx.step('undo brings it back; leaving the tool lets the chart pan again', async () => {
      await page.keyboard.press('Control+z');
      await expectRows(2);
      await page.keyboard.press('Escape');
      if ((await page.getByRole('button', { name: 'Eraser' }).getAttribute('aria-pressed')) !== 'false') throw new Error('tool still on');
    });
    await ctx.screenshot('undone');
    if (viewport === 'narrow') {
      await ctx.step('one finger paints with the brush', async () => {
        await page.getByRole('button', { name: 'Brush long' }).click();
        const box = await chart.boundingBox();
        if (!box) throw new Error('no chart box');
        const y = box.y + box.height / 2;
        await page.evaluate(
          ({ x1, x2, y }) => {
            const el = document.querySelector('.sm-chart') as HTMLElement;
            const fire = (type: string, x: number) =>
              el.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, isPrimary: true }));
            fire('pointerdown', x1);
            fire('pointermove', (x1 + x2) / 2);
            fire('pointerup', x2);
          },
          { x1: box.x + box.width * 0.05, x2: box.x + box.width * 0.15, y },
        );
        await expectRows(3);
        await page.keyboard.press('Escape');
      });
    }
    await ctx.step('the marks are saved and found again after a reload', async () => {
      const want = viewport === 'narrow' ? 3 : 2;
      await page.waitForTimeout(900);
      await page.reload();
      await page.getByRole('heading', { name: 'Strategy maker' }).waitFor();
      await page.getByLabel('Provider').selectOption({ label: 'Demo (offline)' });
      await page.getByRole('button', { name: 'Load market' }).click();
      await page.getByText(/ candles$/).waitFor();
      await expectRows(want);
    });
    await ctx.screenshot('restored');
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
