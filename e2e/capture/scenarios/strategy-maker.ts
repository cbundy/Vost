import { readFile } from 'node:fs/promises';
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
  description: 'Strategy maker page (/strategy-maker): empty, a demo market, a CSV file, marking trades, finding a strategy in the background (progress, cancel, results, closest match, found trades on the chart); then the saved model, the Sets panel, the out-of-date notice, Retrain, export and import (a conflict kept as mine, a refused file); proves it opens no live stream, no long task over 200 ms during a run, and the main app never requests its chunk',
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
      await page.getByLabel('CSV file').setInputFiles({ name: 'sample.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
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
      await page.getByLabel('CSV file').setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from('hello') });
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
      await page.getByLabel('CSV file').setInputFiles({ name: BIG_NAME, mimeType: 'text/csv', buffer: Buffer.from(big.csv) });
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
    const trainOn = page.getByRole('group', { name: 'Train on' });
    const setRows = page.locator('.sm-set-list li');
    const importInput = page.getByLabel('Import', { exact: true });
    const outOfDate = page.getByText('Model out of date.');
    await ctx.step('after a reload the saved model shows its rules with no run, and is up to date', async () => {
      await page.reload();
      await page.getByRole('heading', { name: 'Saved model' }).waitFor();
      await page.getByRole('heading', { name: 'What explains your trades' }).waitFor();
      if (await page.getByRole('region', { name: 'Results' }).count()) throw new Error('a reload showed results');
      // Training on the big file alone, as the model was.
      await trainOn.getByRole('checkbox').first().waitFor();
      for (const box of await trainOn.getByRole('checkbox').all()) {
        const mine = (await box.locator('xpath=..').textContent())?.includes(BIG_NAME);
        if (!mine && (await box.isChecked())) await box.uncheck();
      }
      await page.getByText('Up to date with your marks').waitFor();
      if (await outOfDate.count()) throw new Error('an untouched model is out of date');
    });
    await page.getByRole('heading', { name: 'Saved model' }).scrollIntoViewIfNeeded();
    await ctx.screenshot('saved-model');
    let setCount = 0;
    await ctx.step('the Sets panel lists the saved sets and opens one on the chart', async () => {
      await page.getByRole('heading', { name: 'Sets' }).waitFor();
      setCount = await setRows.count();
      if (setCount < 2) throw new Error(`only ${setCount} sets listed`);
      await page.getByRole('button', { name: `Open ${BIG_NAME}` }).click();
      await page.getByText(`${BIG_NAME} - ${BIG_BARS} candles`).waitFor({ timeout: 30_000 });
    });
    await page.getByRole('heading', { name: 'Sets' }).scrollIntoViewIfNeeded();
    await ctx.screenshot('sets-panel');
    await ctx.step('one more marked trade makes the model out of date, with a Retrain button', async () => {
      await page.getByRole('button', { name: 'Brush long' }).click();
      await drag(0.45, 0.5);
      await page.keyboard.press('Escape');
      await outOfDate.waitFor();
      await page.getByRole('button', { name: 'Retrain' }).waitFor();
    });
    await page.getByRole('heading', { name: 'Saved model' }).scrollIntoViewIfNeeded();
    await ctx.screenshot('model-out-of-date');
    await ctx.step('Retrain trains again and the notice goes', async () => {
      await page.getByRole('button', { name: 'Retrain' }).click();
      await page.getByRole('status').getByText(/Training/).waitFor();
      await outOfDate.waitFor({ state: 'detached', timeout: RUN_LIMIT_MS });
      await page.getByText('Up to date with your marks').waitFor();
    });
    await page.getByRole('heading', { name: 'Saved model' }).scrollIntoViewIfNeeded();
    await ctx.screenshot('retrained');
    let exported = '';
    await ctx.step('Export downloads vost-strategy-maker.json, version 1, with the sets and the model', async () => {
      await page.waitForTimeout(900);
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export' }).click()]);
      if (download.suggestedFilename() !== 'vost-strategy-maker.json') throw new Error(`file name: ${download.suggestedFilename()}`);
      const path = await download.path();
      exported = await readFile(path, 'utf8');
      const file = JSON.parse(exported) as { format: string; version: number; sets: Array<{ id: string; trades: unknown[] }>; model: unknown };
      if (file.format !== 'vost-strategy-maker' || file.version !== 1) throw new Error(`format ${file.format} version ${file.version}`);
      if (file.sets.length !== setCount) throw new Error(`${file.sets.length} sets exported, ${setCount} listed`);
      if (!file.model) throw new Error('the model was not exported');
      await ctx.writeText('export', `${file.sets.map((x) => `${x.id}: ${x.trades.length} trades`).join('\n')}\nmodel: yes\n`);
    });
    await ctx.step('with the database cleared, importing the file brings the sets and the model back, once', async () => {
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            const q = indexedDB.deleteDatabase('vost-strategy-maker');
            q.onsuccess = q.onerror = q.onblocked = () => resolve();
          }),
      );
      await page.reload();
      await page.getByRole('heading', { name: 'Sets' }).waitFor();
      if ((await setRows.count()) !== 0) throw new Error('the database was not cleared');
      await importInput.setInputFiles({ name: 'vost-strategy-maker.json', mimeType: 'application/json', buffer: Buffer.from(exported) });
      await page.getByText(/^Imported \d+ new sets?/).waitFor({ timeout: 30_000 });
      await page.getByRole('heading', { name: 'Saved model' }).waitFor();
      await page.getByRole('heading', { name: 'What explains your trades' }).waitFor();
      if ((await setRows.count()) !== setCount) throw new Error(`${await setRows.count()} sets after the import, ${setCount} before`);
    });
    await page.getByRole('heading', { name: 'Sets' }).scrollIntoViewIfNeeded();
    await ctx.screenshot('imported');
    await ctx.step('a set changed here and in the file is a conflict; Keep mine writes nothing over it', async () => {
      await page.getByRole('button', { name: `Open ${BIG_NAME}` }).click();
      await page.getByText(`${BIG_NAME} - ${BIG_BARS} candles`).waitFor({ timeout: 30_000 });
      await page.getByRole('button', { name: 'Brush long' }).click();
      await drag(0.3, 0.35);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(900);
      const before = await page.locator('.sm-count strong').textContent();
      await importInput.setInputFiles({ name: 'vost-strategy-maker.json', mimeType: 'application/json', buffer: Buffer.from(exported) });
      await page.getByRole('heading', { name: 'These sets differ from the file' }).waitFor({ timeout: 30_000 });
      await page.getByRole('heading', { name: 'These sets differ from the file' }).scrollIntoViewIfNeeded();
      await ctx.screenshot('import-conflict');
      await page.getByLabel('Keep mine').check();
      await page.getByRole('button', { name: 'Apply import' }).click();
      await page.getByText(/kept 1 of yours/).waitFor();
      if ((await page.locator('.sm-count strong').textContent()) !== before) throw new Error('Keep mine changed the marks');
      if ((await setRows.count()) !== setCount) throw new Error('the import duplicated or lost a set');
    });
    await ctx.step('a file with version 2 is refused, with the reason, and writes nothing', async () => {
      const bad = JSON.stringify({ format: 'vost-strategy-maker', version: 2, exportedAt: new Date().toISOString(), sets: [], model: null });
      await importInput.setInputFiles({ name: 'future.json', mimeType: 'application/json', buffer: Buffer.from(bad) });
      await page.getByRole('alert').filter({ hasText: 'version 2' }).waitFor();
      if ((await setRows.count()) !== setCount) throw new Error('a refused file changed the sets');
    });
    await page.getByRole('heading', { name: 'Sets' }).scrollIntoViewIfNeeded();
    await ctx.screenshot('import-refused');
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
