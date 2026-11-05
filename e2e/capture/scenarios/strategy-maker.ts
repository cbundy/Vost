import type { Scenario } from '../scenario.ts';

const CSV = 'time,open,high,low,close,volume\n' +
  Array.from({ length: 120 }, (_, i) => {
    const base = 100 + Math.sin(i / 8) * 10 + i * 0.1;
    return `${1700000000 + i * 3600},${base.toFixed(2)},${(base + 2).toFixed(2)},${(base - 2).toFixed(2)},${(base + Math.sin(i) * 1.5).toFixed(2)},${100 + i}`;
  }).join('\n');

const BIG_BARS = 100_000;
const BIG_NAME = 'big.csv';
const T0 = 1_600_000_000;

/** 100,000 seeded hourly bars, and the long trades of a hidden 8/34 SMA cross (some marks shifted, some dropped, like a hand-made set). */
function bigSet(): { csv: string; candles: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>; trades: Array<{ side: 'long'; entryTime: number; exitTime: number }> } {
  let seed = 20260101;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = () => Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand());
  const candles: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }> = [];
  let price = 100;
  let trend = 0;
  for (let i = 0; i < BIG_BARS; i++) {
    trend = trend * 0.98 + normal() * 0.00012;
    const open = price;
    const close = Math.max(0.5, open * (1 + trend + normal() * 0.006));
    candles.push({ time: T0 + i * 3600, open, high: Math.max(open, close) * 1.002, low: Math.min(open, close) * 0.998, close, volume: 1000 });
    price = close;
  }
  const sma = (n: number, i: number) => {
    let sum = 0;
    for (let k = i - n + 1; k <= i; k++) sum += candles[k].close;
    return sum / n;
  };
  const trades: Array<{ side: 'long'; entryTime: number; exitTime: number }> = [];
  let entry = -1;
  let prevUp = false;
  for (let i = 34; i < BIG_BARS; i++) {
    const up = sma(8, i) > sma(34, i);
    if (i > 34 && up && !prevUp) entry = i;
    if (i > 34 && !up && prevUp && entry >= 0) {
      if (rand() >= 0.15) {
        const shift = (b: number) => (rand() < 0.3 ? Math.min(BIG_BARS - 1, Math.max(0, b + (rand() < 0.5 ? -1 : 1) * (1 + Math.floor(rand() * 3)))) : b);
        const a = shift(entry);
        const b = Math.max(a + 1, shift(i));
        trades.push({ side: 'long', entryTime: candles[a].time, exitTime: candles[Math.min(b, BIG_BARS - 1)].time });
      }
      entry = -1;
    }
    prevUp = up;
  }
  const csv = 'time,open,high,low,close,volume\n' + candles.map((c) => `${c.time},${c.open},${c.high},${c.low},${c.close},${c.volume}`).join('\n');
  return { csv, candles, trades };
}

const RUN_LIMIT_MS = 30_000;
const LONG_TASK_LIMIT_MS = 200;

export const strategyMaker: Scenario = {
  name: 'strategy-maker',
  description: 'Strategy maker page (/strategy-maker): empty, a demo market, a CSV file, marking trades, finding a strategy in the background (progress, cancel, results, closest match, found trades on the chart); proves it opens no live stream, no long task over 200 ms during a run, and the main app never requests its chunk',
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
    await ctx.step('with two trades Find says how many more are needed and stays off', async () => {
      await page.getByText(/\d+ more trades needed/).first().waitFor();
      if (!(await page.getByRole('button', { name: 'Find a strategy' }).isDisabled())) throw new Error('Find is on with too few trades');
    });
    await page.getByRole('heading', { name: 'Find a strategy' }).scrollIntoViewIfNeeded();
    await ctx.screenshot('find-needs-more');
    await ctx.step('a bad file shows a message, not a crash', async () => {
      await page.locator('input[type=file]').setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from('hello') });
      await page.getByRole('alert').waitFor();
    });
    const big = bigSet();
    const find = page.getByRole('button', { name: 'Find a strategy' });
    const cancel = page.getByRole('button', { name: 'Cancel' });
    await ctx.step(`seed ${big.trades.length} marked trades on ${BIG_BARS} bars into the page's database and open the file`, async () => {
      if (big.trades.length < 30) throw new Error(`only ${big.trades.length} trades`);
      await page.evaluate(
        ({ candles, trades, name }) =>
          new Promise<void>((resolve, reject) => {
            const req = indexedDB.open('vost-strategy-maker');
            req.onerror = () => reject(req.error);
            req.onsuccess = () => {
              const db = req.result;
              const tx = db.transaction('highlightSets', 'readwrite');
              tx.objectStore('highlightSets').put({ id: `csv|${name}`, version: 1, source: { kind: 'csv', name }, trades, candles, updatedAt: Date.now() });
              tx.oncomplete = () => (db.close(), resolve());
              tx.onerror = () => reject(tx.error);
            };
          }),
        { candles: big.candles, trades: big.trades, name: BIG_NAME },
      );
      await page.reload();
      await page.getByRole('heading', { name: 'Strategy maker' }).waitFor();
      await page.locator('input[type=file]').setInputFiles({ name: BIG_NAME, mimeType: 'text/csv', buffer: Buffer.from(big.csv) });
      await page.getByText(`${BIG_NAME} - ${BIG_BARS} candles`).waitFor({ timeout: 30_000 });
      await page.waitForFunction((n) => document.querySelectorAll('.sm-row').length >= n, Math.min(big.trades.length, 30));
      await page.getByRole('heading', { name: 'Find a strategy' }).waitFor();
    });
    await page.waitForTimeout(900);
    await page.getByRole('heading', { name: 'Find a strategy' }).scrollIntoViewIfNeeded();
    await ctx.screenshot('find-ready');

    const watchLongTasks = () =>
      page.evaluate(() => {
        const w = window as unknown as { __long: number[] };
        w.__long = [];
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) w.__long.push(e.duration);
        }).observe({ type: 'longtask' });
      });
    const readLongTasks = () => page.evaluate(() => (window as unknown as { __long: number[] }).__long);

    await ctx.step('Find shows progress and Cancel stops it within a second, back to the form as it was', async () => {
      await find.click();
      await cancel.waitFor();
      await page.getByRole('status').getByText(/%/).waitFor();
      await page.waitForTimeout(700);
      await page.getByRole('status').scrollIntoViewIfNeeded();
      await ctx.screenshot('find-progress');
      const t = Date.now();
      await cancel.click();
      await find.waitFor();
      const took = Date.now() - t;
      if (took > 1000) throw new Error(`Cancel took ${took} ms`);
      if (await page.getByRole('region', { name: 'Results' }).count()) throw new Error('a cancelled run left results');
      if ((await page.getByRole('status').count()) > 0) throw new Error('progress still shown after Cancel');
    });
    await ctx.screenshot('find-cancelled');

    await ctx.step(`a full run on ${BIG_BARS} bars finishes within ${RUN_LIMIT_MS / 1000} s with no page task over ${LONG_TASK_LIMIT_MS} ms`, async () => {
      await watchLongTasks();
      const t = Date.now();
      await find.click();
      await page.getByRole('region', { name: 'Results' }).waitFor({ timeout: RUN_LIMIT_MS });
      const took = Date.now() - t;
      const long = await readLongTasks();
      await ctx.writeText('long-tasks', `run ${took} ms; long tasks (ms): ${long.map((d) => d.toFixed(0)).join(', ') || 'none'}\n`);
      if (took > RUN_LIMIT_MS) throw new Error(`the run took ${took} ms`);
      const worst = Math.max(0, ...long);
      if (worst > LONG_TASK_LIMIT_MS) throw new Error(`a page task took ${worst.toFixed(0)} ms during the run`);
      if (await page.getByText('Running on this page').count()) throw new Error('the run was on the page, not in the worker');
    });
    await ctx.step('the results explain the trades, rank settings and give a verdict', async () => {
      await page.getByRole('heading', { name: 'What explains your trades' }).waitFor();
      await page.getByRole('heading', { name: 'Ranked settings' }).waitFor();
      await page.getByText(/^(Validated|Not validated)$/).waitFor();
      await page.getByText('Best match').first().waitFor();
    });
    await page.getByRole('heading', { name: 'What explains your trades' }).scrollIntoViewIfNeeded();
    await ctx.screenshot('results');
    await ctx.step('strict targets give the closest match and its gaps', async () => {
      await page.getByLabel('Min R:R').fill('50');
      await find.click();
      await page.getByRole('heading', { name: 'Closest found' }).waitFor({ timeout: RUN_LIMIT_MS });
    });
    await page.getByRole('heading', { name: 'Closest found' }).scrollIntoViewIfNeeded();
    await ctx.screenshot('closest');
    await ctx.step('selecting a result draws its trades on the chart beside the marks, and clearing removes them', async () => {
      await page.getByRole('button', { name: /SMA crossover|EMA crossover|MACD|Donchian|Bollinger|RSI/ }).first().click();
      await page.getByText('Found trades').waitFor();
      await page.locator('.sm-row-main').nth(3).click();
      await page.getByRole('region', { name: 'Trades' }).count();
      await page.getByRole('img', { name: 'Candle chart' }).scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
    });
    await ctx.screenshot('found-trades');
    await ctx.step('the same button again clears the found trades', async () => {
      await page.locator('.sm-pick[aria-pressed=true]').click();
      await page.getByText('Found trades').waitFor({ state: 'detached' });
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
