import type { Page } from 'playwright';
import type { Scenario } from '../scenario.ts';

interface Probe {
  cells: number;
  shown: number;
  activeCells: number;
  topBarSymbol: string;
  titles: string[];
  boxes: Array<{ x: number; y: number; w: number; h: number }>;
  overflowX: boolean;
}

async function probe(page: Page): Promise<Probe> {
  return page.evaluate(() => {
    const cells = [...document.querySelectorAll<HTMLElement>('.chart-cell')];
    const rect = (e: Element) => {
      const r = e.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    return {
      cells: cells.length,
      shown: cells.filter((c) => !c.classList.contains('away')).length,
      activeCells: cells.filter((c) => c.dataset.active === 'true' && c.classList.contains('active')).length,
      topBarSymbol: document.querySelector<HTMLInputElement>('.topbar .symbol-search input')?.value ?? '',
      // the legend reads "Demo (offline) · DEMO · 1d": keep the symbol
      titles: cells.map((c) => (c.querySelector('.legend-title')?.textContent ?? '').split(' · ')[1] ?? ''),
      boxes: cells.map(rect),
      overflowX: document.documentElement.scrollWidth > innerWidth,
    };
  });
}

const SYMBOLS = ['DEMO', 'DEMO-BEAR', 'DEMO-CHOP', 'DEMO-DOWN'];

export const layouts: Scenario = {
  name: 'layouts',
  description: 'The layout picker (55 arrangements), a 2x2 grid of four markets, a large chart plus three, the active chart, a dragged divider, the layout back after a reload, and the narrow switcher',
  keepPrefs: true,
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page } = ctx;
    const log: string[] = [];
    const narrow = ctx.viewport === 'narrow';
    const check = (label: string, p: Probe, extra = '') =>
      log.push(`${label}: cells=${p.cells} shown=${p.shown} active=${p.activeCells} topbar=${p.topBarSymbol} titles=${p.titles.join('|')} overflowX=${p.overflowX}${extra}`);
    const pick = (name: string) => page.getByRole('button', { name, exact: true });
    const openPicker = async () => {
      await page.getByRole('button', { name: 'Select layout' }).click();
      await page.getByRole('dialog', { name: 'Select layout' }).waitFor();
    };
    const cells = page.locator('.chart-cell');
    const waitLoaded = async (n: number) => {
      await page.waitForFunction((count) => document.querySelectorAll('.chart-cell .legend-title').length === count, n);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      await page.waitForTimeout(300);
    };
    const setSymbol = async (symbol: string) => {
      const input = page.locator('.topbar .symbol-search input');
      await input.fill(symbol);
      // Escape closes the suggestions, so Enter loads exactly what was typed
      await input.press('Escape');
      await input.press('Enter');
      await page.locator('.chart-cell.active .legend-title', { hasText: symbol }).waitFor();
    };
    const activate = async (i: number) => {
      const box = await cells.nth(i).boundingBox();
      if (!box) throw new Error(`cell ${i} has no box`);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    };

    await ctx.step('open app on one chart', () => page.goto('/'));
    await ctx.waitForChart();
    await ctx.step('one chart, no active outline', async () => {
      const p = await probe(page);
      check('start', p);
      if (p.cells !== 1) throw new Error(`expected one cell, got ${p.cells}`);
      if ((await page.locator('.chart-cell.active').count()) !== 0) throw new Error('the active outline shows with one chart');
    });

    await ctx.step('open the picker: 55 arrangements in 13 rows, the current one marked', async () => {
      await openPicker();
      const n = await page.locator('.layout-option').count();
      const rows = await page.locator('.layout-row .layout-count').allInnerTexts();
      if (n !== 55) throw new Error(`${n} arrangements`);
      if (rows.join(',') !== '1,2,3,4,5,6,7,8,9,10,12,14,16') throw new Error(`rows ${rows.join(',')}`);
      if ((await page.locator('.layout-option.selected').getAttribute('aria-label')) !== '1 chart') throw new Error('current arrangement is not marked');
      const box = await page.locator('.layout-menu').boundingBox();
      const vp = page.viewportSize()!;
      if (!box || box.x < 0 || box.x + box.width > vp.width + 0.5) throw new Error(`the menu does not fit the width: ${JSON.stringify(box)}`);
      const topbar = await page.evaluate(() => {
        const bar = document.querySelector('.topbar') as HTMLElement;
        const more = document.querySelector('.topbar-more')?.getBoundingClientRect();
        return { scrollWidth: bar.scrollWidth, clientWidth: bar.clientWidth, moreRight: more ? Math.round(more.right) : null, moreWidth: more ? Math.round(more.width) : null };
      });
      log.push(`picker: options=${n} rows=${rows.join(',')} box=${JSON.stringify(box)} topbar=${JSON.stringify(topbar)}`);
      if (topbar.scrollWidth > topbar.clientWidth) throw new Error(`the top bar overflows with the layout button: ${JSON.stringify(topbar)}`);
    });
    await ctx.screenshot('picker');
    await ctx.step('Escape closes the picker, an outside click too', async () => {
      await page.keyboard.press('Escape');
      await page.getByRole('dialog', { name: 'Select layout' }).waitFor({ state: 'detached' });
      await openPicker();
      await page.mouse.click(5, 500);
      await page.getByRole('dialog', { name: 'Select layout' }).waitFor({ state: 'detached' });
    });

    await ctx.step('choose 2x2: four charts, each copying the first', async () => {
      await openPicker();
      await pick('4 charts: 2 columns by 2 rows').click();
      await page.getByRole('dialog', { name: 'Select layout' }).waitFor({ state: 'detached' });
      await cells.nth(3).waitFor({ state: 'attached' });
      await waitLoaded(4);
      const p = await probe(page);
      check('2x2', p);
      if (p.cells !== 4 || p.titles.some((t) => t !== 'DEMO')) throw new Error(`expected four DEMO charts: ${p.titles.join(',')}`);
      if (narrow && p.shown !== 1) throw new Error(`narrow shows ${p.shown} charts`);
    });

    if (narrow) {
      await ctx.step('the switcher shows 1 / 4 and moves to the next chart', async () => {
        const sw = page.locator('.chart-switcher');
        await sw.waitFor();
        if (!(await sw.innerText()).includes('1 / 4')) throw new Error(`switcher says ${await sw.innerText()}`);
        await page.getByRole('button', { name: 'Next chart' }).click();
        if (!(await sw.innerText()).includes('2 / 4')) throw new Error(`switcher says ${await sw.innerText()}`);
        await setSymbol('DEMO-BEAR');
        check('narrow chart 2', await probe(page));
      });
      await ctx.screenshot('switcher');
      await ctx.step('the menu lists the charts by market and timeframe', async () => {
        await page.getByRole('button', { name: 'Choose chart' }).click();
        const items = await page.locator('.chart-switcher-menu [role=option]').allInnerTexts();
        if (items.length !== 4 || !items[1].includes('DEMO-BEAR') || !items[0].includes('DEMO')) throw new Error(`menu: ${items.join(' / ')}`);
        log.push(`menu: ${items.join(' / ').replace(/\n/g, ' ')}`);
      });
      await ctx.screenshot('switcher-menu');
      await ctx.step('choose chart 1 from the menu: the top bar follows', async () => {
        await page.locator('.chart-switcher-menu [role=option]').first().click();
        await page.waitForTimeout(200);
        const p = await probe(page);
        check('narrow chart 1', p);
        if (p.topBarSymbol !== 'DEMO') throw new Error(`top bar shows ${p.topBarSymbol}`);
        await page.getByRole('button', { name: 'Next chart' }).click();
        await page.waitForTimeout(200);
        if ((await probe(page)).topBarSymbol !== 'DEMO-BEAR') throw new Error('chart 2 lost its market');
      });
      await ctx.step('the picker fits the narrow screen and the layout comes back after a reload', async () => {
        await page.waitForTimeout(800);
        await page.reload();
        await page.locator('.chart-switcher').waitFor();
        await waitLoaded(4);
        const p = await probe(page);
        check('narrow reloaded', p);
        if (p.cells !== 4 || p.topBarSymbol !== 'DEMO-BEAR' || !(await page.locator('.chart-switcher').innerText()).includes('2 / 4')) throw new Error('layout not restored');
        await openPicker();
      });
      await ctx.screenshot('picker-open');
      await ctx.writeText('checks', `${log.join('\n')}\n`);
      return;
    }

    await ctx.step('give each chart its own market by clicking it and typing in the top bar', async () => {
      for (let i = 1; i < 4; i++) {
        await activate(i);
        await setSymbol(SYMBOLS[i]);
      }
      const p = await probe(page);
      check('four markets', p);
      if (p.titles.join(',') !== SYMBOLS.join(',')) throw new Error(`titles ${p.titles.join(',')}`);
    });
    await ctx.screenshot('grid-2x2');

    await ctx.step('clicking a cell makes it active: one outline, the top bar follows', async () => {
      await activate(1);
      const p = await probe(page);
      check('active=2', p);
      const id = await page.locator('.chart-cell.active').getAttribute('data-chart-id');
      const id2 = await cells.nth(1).getAttribute('data-chart-id');
      if (id !== id2 || p.activeCells !== 1 || p.topBarSymbol !== 'DEMO-BEAR') throw new Error('the outline or the top bar did not follow the click');
    });
    await ctx.screenshot('active');

    await ctx.step('1 large + 3 stacked: charts keep their markets in order', async () => {
      await openPicker();
      await pick('4 charts: 1 large left, 3 stacked right').click();
      await page.waitForTimeout(400);
      const p = await probe(page);
      check('large+3', p);
      if (p.titles.join(',') !== SYMBOLS.join(',')) throw new Error(`titles ${p.titles.join(',')}`);
      const [a, b, c, d] = p.boxes;
      if (!(a.h > b.h * 2.5 && b.x === c.x && c.x === d.x && b.x > a.x)) throw new Error(`not a large chart beside a stack: ${JSON.stringify(p.boxes)}`);
    });
    await ctx.screenshot('large-plus-3');

    let before: Probe | null = null;
    await ctx.step('drag the column divider right: the large chart widens, the stack narrows', async () => {
      const sep = page.getByRole('separator', { name: 'Resize chart columns' });
      const b = await sep.boundingBox();
      if (!b) throw new Error('no column divider');
      const start = await probe(page);
      const x = b.x + b.width / 2;
      const y = b.y + b.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 150, y, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(300);
      before = await probe(page);
      check('dragged', before, ` large=${start.boxes[0].w}->${before.boxes[0].w}`);
      if (!(before.boxes[0].w > start.boxes[0].w + 100 && before.boxes[1].w < start.boxes[1].w - 100)) throw new Error('the divider did not move the columns');
    });
    await ctx.screenshot('dragged');
    await ctx.step('a row divider on the stack side moves too, and double-click resets to even', async () => {
      const rowSep = page.getByRole('separator', { name: 'Resize chart rows' }).first();
      const b = await rowSep.boundingBox();
      if (!b) throw new Error('no row divider');
      const was = await probe(page);
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - 60, { steps: 8 });
      await page.mouse.up();
      const moved = await probe(page);
      if (!(moved.boxes[1].h < was.boxes[1].h - 30)) throw new Error('the row divider did not move');
      await rowSep.dblclick();
      await page.waitForTimeout(300);
      const reset = await probe(page);
      log.push(`reset: large=${reset.boxes[0].w} stack=${reset.boxes[1].w}x${reset.boxes[1].h}`);
      if (Math.abs(reset.boxes[0].w - reset.boxes[1].w) > 2) throw new Error('double-click did not reset to even tracks');
      // put the dragged size back for the reload check
      const sep = page.getByRole('separator', { name: 'Resize chart columns' });
      const cb = await sep.boundingBox();
      await page.mouse.move(cb!.x + cb!.width / 2, cb!.y + cb!.height / 2);
      await page.mouse.down();
      await page.mouse.move(cb!.x + cb!.width / 2 + 150, cb!.y + cb!.height / 2, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(300);
      before = await probe(page);
    });
    await ctx.step('after a reload the arrangement, markets, sizes and active chart are back', async () => {
      await page.waitForTimeout(800);
      await page.reload();
      await page.locator('.chart-cell').nth(3).waitFor({ state: 'attached' });
      await waitLoaded(4);
      const p = await probe(page);
      check('reloaded', p);
      if (p.titles.join(',') !== SYMBOLS.join(',')) throw new Error(`titles ${p.titles.join(',')}`);
      if (p.topBarSymbol !== 'DEMO-BEAR') throw new Error(`active chart is ${p.topBarSymbol}`);
      const drift = p.boxes.map((b, i) => Math.abs(b.w - before!.boxes[i].w) + Math.abs(b.h - before!.boxes[i].h));
      if (Math.max(...drift) > 3) throw new Error(`sizes moved after reload: ${drift.join(',')}`);
    });
    await ctx.screenshot('reloaded');

    await ctx.step('going to 2 charts keeps the first two, going to 16 adds copies', async () => {
      await openPicker();
      await pick('2 charts side by side').click();
      await page.waitForTimeout(400);
      const two = await probe(page);
      check('2 charts', two);
      if (two.cells !== 2 || two.titles.join(',') !== 'DEMO,DEMO-BEAR') throw new Error(`titles ${two.titles.join(',')}`);
      await openPicker();
      await pick('16 charts: 4 columns by 4 rows').click();
      await waitLoaded(16);
      const sixteen = await probe(page);
      check('16 charts', sixteen);
      if (sixteen.cells !== 16 || sixteen.boxes.some((b) => b.w < 100 || b.h < 60)) throw new Error('16 cells are too small');
    });
    await ctx.screenshot('sixteen');
    await ctx.writeText('checks', `${log.join('\n')}\n`);
  },
};
