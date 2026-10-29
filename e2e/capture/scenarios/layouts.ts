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
  description: 'The layout picker (55 arrangements), a 2x2 grid of four markets, a large chart plus three, the active chart, a dragged divider, the layout back after a reload, the narrow switcher, and the named layouts menu (save, autosave, copy, rename, download, create, recent, open, unsaved marker, the last layout back after a reload)',
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
    const nameBtn = page.locator('.layout-name-btn');
    const nameText = async () => ((await nameBtn.locator('.layout-name').innerText()) ?? '').trim();
    const menu = page.getByRole('menu', { name: 'Layout' });
    const openMenu = async () => {
      await nameBtn.click();
      await menu.waitFor();
    };
    const savedState = () =>
      page.evaluate(() => {
        const raw = JSON.parse(localStorage.getItem('vost.savedLayouts.v1') ?? 'null') as { currentId: string; autosave: boolean; layouts: Array<{ id: string; name: string; updatedAt: number; layout: { charts: unknown[] } }> } | null;
        return raw && { autosave: raw.autosave, current: raw.layouts.find((l) => l.id === raw.currentId)?.name, names: raw.layouts.map((l) => `${l.name}:${l.layout.charts.length}`), updatedAt: raw.layouts.find((l) => l.id === raw.currentId)?.updatedAt };
      });
    const syncSwitch = (name: string) => page.getByRole('switch', { name, exact: true });
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
        const kids = [...bar.children].map((k) => `${k.className.toString().split(' ')[0] || k.tagName}:${Math.round(k.getBoundingClientRect().width)}`).join(',');
        return { kids, scrollWidth: bar.scrollWidth, clientWidth: bar.clientWidth, moreRight: more ? Math.round(more.right) : null, moreWidth: more ? Math.round(more.width) : null };
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
      await ctx.step('the Sync in layout section fits the narrow picker with Crosshair on', async () => {
        const rows = await page.locator('.layout-sync-label').allInnerTexts();
        if (rows.join(',') !== 'Symbol,Interval,Crosshair,Time,Date range') throw new Error(`sync rows ${rows.join(',')}`);
        const box = await page.locator('.layout-menu').boundingBox();
        const lastRow = await page.locator('.layout-sync-row').last().boundingBox();
        const vp = page.viewportSize()!;
        if (!box || box.x < 0 || box.x + box.width > vp.width + 0.5 || (await probe(page)).overflowX) throw new Error(`the sync section overflows: ${JSON.stringify(box)}`);
        await page.locator('.layout-sync-row').last().scrollIntoViewIfNeeded();
        log.push(`narrow sync: rows=${rows.join('|')} crosshair=${await syncSwitch('Crosshair').getAttribute('aria-checked')} lastRow=${JSON.stringify(lastRow)}`);
      });
      await ctx.screenshot('picker-open');
      await ctx.step('the layout name menu fits the narrow screen', async () => {
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'More', exact: true }).click();
        if ((await page.locator('.topbar > .layout-name-wrap').count()) !== 0) throw new Error('the layout name is in the narrow top bar');
        await openMenu();
        const box = await menu.boundingBox();
        const vp = page.viewportSize()!;
        const p = await probe(page);
        const name = await nameBtn.boundingBox();
        log.push(`narrow menu: name=${await nameText()} nameBox=${JSON.stringify(name)} menuBox=${JSON.stringify(box)} overflowX=${p.overflowX}`);
        if (!box || box.x < 0 || box.x + box.width > vp.width + 0.5 || p.overflowX) throw new Error(`the layout menu overflows: ${JSON.stringify(box)}`);
      });
      await ctx.screenshot('menu');
      // On a narrow screen the layout name lives in the More menu.
      const openNarrowMenu = async () => {
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'More', exact: true }).click();
        await openMenu();
      };
      await ctx.step('Rename on the narrow screen: the dialog fits, OK renames the layout', async () => {
        await menu.getByRole('menuitem', { name: 'Rename...' }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel('Layout name').fill('Narrow');
        await page.waitForTimeout(150);
        const box = await dialog.boundingBox();
        const vp = page.viewportSize()!;
        if (!box || box.x < 0 || box.x + box.width > vp.width + 0.5) throw new Error(`the rename dialog overflows: ${JSON.stringify(box)}`);
      });
      await ctx.screenshot('rename');
      await ctx.step('OK renames it; Create new layout adds a second one', async () => {
        await page.getByRole('dialog').getByRole('button', { name: 'OK' }).click();
        await page.getByRole('dialog').waitFor({ state: 'detached' });
        await openNarrowMenu();
        await menu.getByRole('menuitem', { name: 'Create new layout...' }).click();
        await page.getByRole('dialog').getByLabel('Layout name').fill('Fresh');
        await page.getByRole('dialog').getByRole('button', { name: 'OK' }).click();
        await page.getByRole('dialog').waitFor({ state: 'detached' });
        await page.waitForTimeout(300);
        log.push(`narrow created: ${JSON.stringify(await savedState())}`);
      });
      await ctx.step('Open layout lists both layouts and fits the narrow screen', async () => {
        await openNarrowMenu();
        await menu.getByRole('menuitem', { name: /^Open layout/ }).click();
        const dialog = page.getByRole('dialog');
        await dialog.waitFor();
        const rows = await dialog.locator('.lm-open-row').count();
        await page.waitForTimeout(150);
        const box = await dialog.boundingBox();
        const vp = page.viewportSize()!;
        log.push(`narrow open dialog: rows=${rows} box=${JSON.stringify(box)}`);
        if (rows !== 2) throw new Error(`rows ${rows}`);
        if (!box || box.x < 0 || box.x + box.width > vp.width + 0.5) throw new Error(`the open dialog overflows: ${JSON.stringify(box)}`);
      });
      await ctx.screenshot('open-dialog');
      await ctx.step('opening Narrow from the list switches to it', async () => {
        await page.getByRole('dialog').getByRole('button', { name: /^Narrow/ }).first().click();
        await page.getByRole('dialog').waitFor({ state: 'detached' });
        await page.waitForTimeout(300);
        await openNarrowMenu();
        const recent = (await menu.getByRole('menuitem').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
        log.push(`narrow switched: name=${await nameText()} items=${recent.join(' | ')}`);
        if ((await nameText()) !== 'Narrow') throw new Error(`name is ${await nameText()}`);
      });
      await ctx.screenshot('switched');
      await ctx.step('autosave off: a change shows the unsaved marker on the narrow screen', async () => {
        await menu.getByRole('switch', { name: 'Autosave' }).click();
        await page.keyboard.press('Escape');
        await page.locator('.topbar select[title="Timeframe"]').selectOption('4h');
        await openNarrowMenu();
        await page.waitForFunction(() => document.querySelector('.layout-unsaved') != null);
        const p = await probe(page);
        log.push(`narrow unsaved: overflowX=${p.overflowX}`);
        if (p.overflowX) throw new Error('horizontal overflow');
      });
      await ctx.screenshot('unsaved');
      await ctx.step('after a reload the last open layout is back with autosave off', async () => {
        await page.waitForTimeout(800);
        await page.reload();
        await page.locator('.chart-switcher').waitFor();
        await waitLoaded(4);
        await page.getByRole('button', { name: 'More', exact: true }).click();
        await openMenu();
        const auto = await menu.getByRole('switch', { name: 'Autosave' }).getAttribute('aria-checked');
        const p = await probe(page);
        log.push(`narrow named reloaded: name=${await nameText()} autosave=${auto} overflowX=${p.overflowX}`);
        if ((await nameText()) !== 'Narrow' || auto !== 'false' || p.overflowX) throw new Error('the last open layout did not come back');
      });
      await ctx.screenshot('named-reloaded');
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

    const timeframes = () => page.evaluate(() => [...document.querySelectorAll('.chart-cell .legend-title')].map((e) => (e.textContent ?? '').split(' · ')[2] ?? ''));
    await ctx.step('the picker has a Sync in layout section: Crosshair on, the rest off; a switch keeps it open', async () => {
      await openPicker();
      await pick('4 charts: 2 columns by 2 rows').click();
      await page.getByRole('dialog', { name: 'Select layout' }).waitFor({ state: 'detached' });
      await waitLoaded(4);
      await openPicker();
      const heading = await page.locator('.layout-sync-heading').innerText();
      const states: string[] = [];
      for (const n of ['Symbol', 'Interval', 'Crosshair', 'Time', 'Date range']) states.push(`${n}=${await syncSwitch(n).getAttribute('aria-checked')}`);
      log.push(`sync defaults: ${heading} ${states.join(' ')}`);
      if (states.join(' ') !== 'Symbol=false Interval=false Crosshair=true Time=false Date range=false') throw new Error(`defaults ${states.join(' ')}`);
      await syncSwitch('Interval').focus();
      await page.keyboard.press('Space');
      if ((await syncSwitch('Interval').getAttribute('aria-checked')) !== 'true') throw new Error('Space did not turn Interval on');
      if (!(await page.getByRole('dialog', { name: 'Select layout' }).isVisible())) throw new Error('a switch closed the picker');
      await page.waitForTimeout(300); // let the switch finish its slide before the picture
    });
    await ctx.screenshot('sync-picker');
    await ctx.step('with Interval synced, chart 3 on 1h puts all four charts on 1h', async () => {
      await page.keyboard.press('Escape');
      await page.getByRole('dialog', { name: 'Select layout' }).waitFor({ state: 'detached' });
      await activate(2);
      await page.locator('.topbar select[title="Timeframe"]').selectOption('1h');
      await page.waitForFunction(() => [...document.querySelectorAll('.chart-cell .legend-title')].every((e) => (e.textContent ?? '').endsWith('1h')));
      await page.waitForTimeout(300);
      const tfs = await timeframes();
      log.push(`interval synced: ${tfs.join('|')}`);
      if (tfs.join(',') !== '1h,1h,1h,1h') throw new Error(`timeframes ${tfs.join(',')}`);
    });
    await ctx.screenshot('sync-interval');
    await ctx.step('with Crosshair synced, the pointer over chart 1 draws the crosshair on every chart', async () => {
      const box = await cells.nth(0).boundingBox();
      if (!box) throw new Error('no cell');
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, { steps: 6 });
      await page.waitForTimeout(400);
    });
    await ctx.screenshot('sync-crosshair');
    await ctx.step('the switches are still set after a reload', async () => {
      await page.mouse.move(2, 2);
      await page.waitForTimeout(800);
      await page.reload();
      await page.locator('.chart-cell').nth(3).waitFor({ state: 'attached' });
      await waitLoaded(4);
      await openPicker();
      const states: string[] = [];
      for (const n of ['Symbol', 'Interval', 'Crosshair', 'Time', 'Date range']) states.push(`${n}=${await syncSwitch(n).getAttribute('aria-checked')}`);
      log.push(`sync reloaded: ${states.join(' ')} timeframes=${(await timeframes()).join('|')}`);
      if (states.join(' ') !== 'Symbol=false Interval=true Crosshair=true Time=false Date range=false') throw new Error(`after reload ${states.join(' ')}`);
    });
    await ctx.screenshot('sync-reloaded');

    /* ----------------------------- named layouts ----------------------------- */
    await ctx.step('the layout name opens a menu: save, autosave on, copy, rename, download, create, open', async () => {
      await page.mouse.move(2, 2);
      await openMenu();
      const items = (await menu.getByRole('menuitem').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
      const auto = await menu.getByRole('switch', { name: 'Autosave' }).getAttribute('aria-checked');
      log.push(`menu: name=${await nameText()} items=${items.join(' | ')} autosave=${auto} state=${JSON.stringify(await savedState())}`);
      if ((await nameText()) !== 'Unnamed') throw new Error('the first layout is not named Unnamed');
      if (auto !== 'true') throw new Error('autosave is not on by default');
      if (items.join('|') !== 'Save layout Ctrl + S|Make a copy...|Rename...|Download chart data...|Create new layout...|Open layout... .') throw new Error(`items ${items.join('|')}`);
      if (await page.getByText('Share layout').count()) throw new Error('Share layout is in the menu');
    });
    await ctx.screenshot('menu');
    await ctx.step('Rename: the name field refuses an empty name, OK renames the layout', async () => {
      await menu.getByRole('menuitem', { name: 'Rename...' }).click();
      const dialog = page.getByRole('dialog');
      const field = dialog.getByLabel('Layout name');
      await field.fill('   ');
      if (!(await dialog.getByRole('button', { name: 'OK' }).isDisabled())) throw new Error('OK is enabled for an empty name');
      await field.fill('  Grid  ');
      await page.waitForTimeout(150);
    });
    await ctx.screenshot('rename');
    await ctx.step('OK renames it and the name shows in the top bar', async () => {
      await page.getByRole('dialog').getByRole('button', { name: 'OK' }).click();
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      if ((await nameText()) !== 'Grid') throw new Error(`name is ${await nameText()}`);
      log.push(`renamed: ${JSON.stringify(await savedState())}`);
    });
    let updatedBefore = 0;
    await ctx.step('Ctrl+S in the symbol field saves, prevents the browser save dialog and changes updatedAt', async () => {
      updatedBefore = (await savedState())!.updatedAt!;
      await page.evaluate(() => {
        (window as unknown as { __saveKeys: boolean[] }).__saveKeys = [];
        window.addEventListener('keydown', (e) => {
          if (e.key.toLowerCase() === 's' && (e.ctrlKey || e.metaKey)) (window as unknown as { __saveKeys: boolean[] }).__saveKeys.push(e.defaultPrevented);
        });
      });
      await page.waitForTimeout(20);
      await page.locator('.topbar .symbol-search input').focus();
      await page.keyboard.press('Control+s');
      await page.waitForTimeout(100);
      const prevented = await page.evaluate(() => (window as unknown as { __saveKeys: boolean[] }).__saveKeys);
      const after = (await savedState())!.updatedAt!;
      log.push(`ctrl+s: defaultPrevented=${prevented.join(',')} updatedAt ${updatedBefore} -> ${after}`);
      if (prevented.length !== 1 || !prevented[0]) throw new Error('Ctrl+S was not prevented');
      if (!(after > updatedBefore)) throw new Error('updatedAt did not change');
      await page.locator('.topbar .symbol-search input').blur();
    });
    await ctx.step('Download chart data: the active chart gives <symbol>_<timeframe>.csv', async () => {
      await openMenu();
      await menu.getByRole('menuitem', { name: 'Download chart data...' }).click();
      const dialog = page.getByRole('dialog');
      const radios = (await dialog.locator('label').allInnerTexts()).map((t) => t.trim());
      const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Download' }).click()]);
      log.push(`download: options=${radios.join('|')} file=${download.suggestedFilename()}`);
      if (!/^DEMO[\w-]*_1h\.csv$/.test(download.suggestedFilename())) throw new Error(`file ${download.suggestedFilename()}`);
      await page.getByRole('dialog').waitFor({ state: 'detached' });
    });
    await ctx.step('Make a copy: the field is prefilled "Grid copy", the copy becomes current', async () => {
      await openMenu();
      await menu.getByRole('menuitem', { name: 'Make a copy...' }).click();
      const field = page.getByRole('dialog').getByLabel('Layout name');
      if ((await field.inputValue()) !== 'Grid copy') throw new Error(`prefill ${await field.inputValue()}`);
      await field.fill('Solo');
      await page.getByRole('dialog').getByRole('button', { name: 'OK' }).click();
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      log.push(`copy: ${JSON.stringify(await savedState())}`);
      if ((await nameText()) !== 'Solo') throw new Error('the copy is not current');
    });
    await ctx.step('autosave writes a one-chart arrangement into Solo only; then open Grid from Recently used', async () => {
      await openPicker();
      await pick('1 chart').click();
      await page.getByRole('dialog', { name: 'Select layout' }).waitFor({ state: 'detached' });
      await page.waitForTimeout(800);
      const solo = await probe(page);
      check('solo', solo);
      if (solo.cells !== 1) throw new Error(`solo has ${solo.cells} charts`);
      log.push(`solo saved: ${JSON.stringify(await savedState())}`);
      await openMenu();
      const recent = (await menu.getByRole('menuitem').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim()).filter((t) => t.startsWith('Grid'));
      log.push(`recent: ${recent.join(' | ')}`);
      if (!/^Grid DEMO[\w-]*, 1h$/.test(recent.join(''))) throw new Error(`recent ${recent.join('|')}`);
      await menu.getByRole('menuitem', { name: /^Grid/ }).click();
      await page.locator('.chart-cell').nth(3).waitFor({ state: 'attached' });
      await waitLoaded(4);
      const grid = await probe(page);
      check('grid back', grid);
      if (grid.cells !== 4 || (await nameText()) !== 'Grid') throw new Error('Grid did not come back with four charts');
    });
    await ctx.screenshot('switched');
    await ctx.step('"." opens the layout list with both layouts; a search narrows it; Enter opens', async () => {
      await page.mouse.move(2, 2);
      await page.keyboard.press('.');
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      const rows = (await dialog.locator('.lm-open-row').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
      log.push(`open dialog: ${rows.join(' | ')}`);
      if (rows.length !== 2) throw new Error(`rows ${rows.join('|')}`);
      if (!(await dialog.getByRole('button', { name: 'Delete Grid' }).isDisabled())) throw new Error('the current layout can be deleted');
      await page.waitForTimeout(150);
    });
    await ctx.screenshot('open-dialog');
    await ctx.step('search "sol" lists Solo only; Enter opens it, one chart', async () => {
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Search layouts').fill('sol');
      const n = await dialog.locator('.lm-open-row').count();
      if (n !== 1) throw new Error(`${n} rows for "sol"`);
      await page.keyboard.press('Enter');
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      await page.waitForTimeout(300);
      const p = await probe(page);
      check('opened Solo', p);
      if (p.cells !== 1 || (await nameText()) !== 'Solo') throw new Error('Solo did not open');
    });
    await ctx.step('Create new layout: one chart on the active market', async () => {
      await openMenu();
      await menu.getByRole('menuitem', { name: 'Create new layout...' }).click();
      await page.getByRole('dialog').getByLabel('Layout name').fill('Fresh');
      await page.getByRole('dialog').getByRole('button', { name: 'OK' }).click();
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      await page.waitForTimeout(300);
      const p = await probe(page);
      check('created', p);
      log.push(`created: ${JSON.stringify(await savedState())}`);
      if (p.cells !== 1 || (await nameText()) !== 'Fresh') throw new Error('Fresh is not a one-chart current layout');
    });
    await ctx.step('autosave off: a change shows the unsaved marker, and switching asks Save / Don\'t save / Cancel', async () => {
      await openMenu();
      await menu.getByRole('switch', { name: 'Autosave' }).click();
      await page.keyboard.press('Escape');
      await page.locator('.topbar select[title="Timeframe"]').selectOption('4h');
      await page.waitForFunction(() => document.querySelector('.layout-unsaved') != null);
      const label = await page.locator('.layout-unsaved').getAttribute('aria-label');
      log.push(`unsaved: label=${label} title=${await nameBtn.getAttribute('title')} state=${JSON.stringify(await savedState())}`);
      if (label !== 'Unsaved changes') throw new Error(`marker label ${label}`);
      await page.mouse.move(2, 2);
    });
    await ctx.screenshot('unsaved');
    await ctx.step('opening Grid asks first; Cancel stays, Save writes Fresh and leaves', async () => {
      await openMenu();
      await menu.getByRole('menuitem', { name: /^Grid/ }).click();
      const dialog = page.getByRole('dialog');
      const buttons = (await dialog.getByRole('button').allInnerTexts()).filter((t) => t !== '✕');
      log.push(`unsaved dialog: ${buttons.join('|')}`);
      if (buttons.join('|') !== 'Cancel|Don\'t save|Save') throw new Error(`buttons ${buttons.join('|')}`);
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      if ((await nameText()) !== 'Fresh') throw new Error('Cancel left the layout');
      await openMenu();
      await menu.getByRole('menuitem', { name: /^Grid/ }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
      await page.locator('.chart-cell').nth(3).waitFor({ state: 'attached' });
      await waitLoaded(4);
      const fresh = await page.evaluate(() => {
        const raw = JSON.parse(localStorage.getItem('vost.savedLayouts.v1')!) as { layouts: Array<{ name: string; layout: { charts: Array<{ timeframe: string }> } }> };
        return raw.layouts.find((l) => l.name === 'Fresh')!.layout.charts[0].timeframe;
      });
      log.push(`saved on leave: Fresh timeframe=${fresh}`);
      if (fresh !== '4h' || (await nameText()) !== 'Grid') throw new Error('Save did not write Fresh before leaving');
    });
    await ctx.step('after a reload the last open layout (Grid, four charts, autosave off) is back', async () => {
      await page.waitForTimeout(800);
      await page.reload();
      await page.locator('.chart-cell').nth(3).waitFor({ state: 'attached' });
      await waitLoaded(4);
      await openMenu();
      const auto = await menu.getByRole('switch', { name: 'Autosave' }).getAttribute('aria-checked');
      const p = await probe(page);
      check('named reloaded', p, ` name=${(await nameText())} autosave=${auto} state=${JSON.stringify(await savedState())}`);
      if (p.cells !== 4 || (await nameText()) !== 'Grid' || auto !== 'false') throw new Error('the last open layout did not come back');
      if (p.overflowX) throw new Error('horizontal overflow');
    });
    await ctx.screenshot('named-reloaded');
    await ctx.writeText('checks', `${log.join('\n')}\n`);
  },
};
