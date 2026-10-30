import type { Scenario } from '../scenario.ts';

const STORED = `(() => {
  const raw = localStorage.getItem('vost.drawings.v2');
  const all = raw ? JSON.parse(raw).sources : {};
  return all['demo:DEMO'] ?? [];
})()`;

type Stored = { id: string; tool: string; anchors: { time: number; price: number }[]; cells?: string[][]; style?: Record<string, unknown> };

const GROUP = 'Annotations';

export const drawingTable: Scenario = {
  name: 'drawing-table',
  touch: ['narrow'],
  keepPrefs: true,
  description:
    'Table: place one by a click and type its first cell, Tab and Shift+Tab through the cells, double-click a cell to edit it, add a row and a column from the right-click menu, set Rows and Columns and turn on the header row and a border colour in the settings (one undo step), undo and redo a cell edit, reload and change the timeframe; at 360 px a double tap opens a cell',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page } = ctx;
    const checks: string[] = [];
    const check = (label: string, ok: boolean, detail = '') => {
      checks.push(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` - ${detail}` : ''}`);
      if (!ok) throw new Error(`check failed: ${label} ${detail}`);
    };
    const narrow = ctx.viewport === 'narrow';
    const stored = async () => {
      await page.waitForTimeout(700);
      return (await page.evaluate(STORED)) as Stored[];
    };
    const cellsNow = async () => (await stored()).find((d) => d.tool === 'table')?.cells;
    const box = async () => {
      const b = await page.locator('.chart-container').boundingBox();
      if (!b) throw new Error('chart container has no box');
      return b;
    };
    const at = async (f: { x: number; y: number }) => {
      const b = await box();
      return { x: b.x + b.width * f.x * 0.7, y: b.y + b.height * f.y };
    };
    const rail = page.getByRole('toolbar', { name: 'Drawing tools' });
    const menuBtn = page.getByRole('button', { name: 'Drawing tools', exact: true });
    const menu = page.getByRole('group', { name: 'Drawing tools menu' });
    const input = page.getByLabel('Cell text');
    const dialog = page.getByRole('dialog');
    const ctxMenu = page.getByRole('menu');

    const pickTool = async (label: string) => {
      if (narrow) {
        await menuBtn.tap();
        const btn = menu.getByRole('button', { name: label, exact: true });
        if (!(await btn.isVisible())) await menu.getByRole('button', { name: GROUP, exact: true }).tap();
        await btn.tap();
        return;
      }
      await rail.getByRole('button', { name: `Open ${GROUP} tools`, exact: true }).click();
      await page.getByRole('menuitemradio', { name: label, exact: true }).click();
    };
    /** A double click, or a double tap on a touch screen. */
    const doubleOn = async (p: { x: number; y: number }) => {
      if (narrow) {
        await page.touchscreen.tap(p.x, p.y);
        await page.waitForTimeout(80);
        await page.touchscreen.tap(p.x, p.y);
      } else await page.mouse.dblclick(p.x, p.y);
    };
    const CORNER = { x: 0.15, y: 0.2 };

    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();

    await ctx.step('Table: a click places a 2 by 2 table and opens the first cell', async () => {
      await pickTool('Table');
      const p = await at(CORNER);
      if (!narrow) {
        await page.mouse.move(p.x - 20, p.y - 20);
        await page.mouse.move(p.x, p.y, { steps: 4 });
        await ctx.screenshot('preview');
      }
      if (narrow) await page.touchscreen.tap(p.x, p.y);
      else await page.mouse.click(p.x, p.y);
      await input.waitFor({ state: 'visible' });
      const list = await stored();
      check('one table stored with empty 2 by 2 cells', list.length === 1 && list[0].tool === 'table' && JSON.stringify(list[0].cells) === '[["",""],["",""]]', JSON.stringify(list));
      check('the editor is a textarea over the first cell', (await input.evaluate((el) => el.tagName)) === 'TEXTAREA');
      await page.keyboard.type('Symbol');
      await ctx.screenshot('first-cell');
    });

    await ctx.step('Tab and Shift+Tab move between cells and commit', async () => {
      await page.keyboard.press('Tab');
      await page.keyboard.type('Price');
      await page.keyboard.press('Tab');
      await page.keyboard.type('DEMO');
      await page.keyboard.press('Shift+Tab');
      check('Shift+Tab went back to Price', (await input.inputValue()) === 'Price');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await page.keyboard.type('100');
      check('the first cells were committed', JSON.stringify(await cellsNow()) === '[["Symbol","Price"],["DEMO",""]]', JSON.stringify(await cellsNow()));
      await ctx.screenshot('tabbing');
      await page.keyboard.press('Tab');
      check('Tab from the last cell commits and closes', (await input.count()) === 0);
      check('all four cells stored', JSON.stringify(await cellsNow()) === '[["Symbol","Price"],["DEMO","100"]]', JSON.stringify(await cellsNow()));
      await ctx.screenshot('table');
    });

    await ctx.step('double-click (double tap) a cell edits it; Escape cancels, Ctrl+Enter commits', async () => {
      const p = await at(CORNER);
      await doubleOn({ x: p.x + 20, y: p.y + 10 });
      await input.waitFor({ state: 'visible' });
      check('it opens on the clicked cell', (await input.inputValue()) === 'Symbol');
      await page.keyboard.type(' x');
      await page.keyboard.press('Escape');
      check('Escape cancels', (await cellsNow())![0][0] === 'Symbol');
      await doubleOn({ x: p.x + 20, y: p.y + 10 });
      await input.waitFor({ state: 'visible' });
      await page.keyboard.press('Control+a');
      await page.keyboard.type('Ticker');
      await page.keyboard.press('Control+Enter');
      check('Ctrl+Enter commits', (await cellsNow())![0][0] === 'Ticker');
      await page.keyboard.press('Control+z');
      check('undo reverts the cell edit alone', (await cellsNow())![0][0] === 'Symbol');
      await page.keyboard.press('Control+Shift+z');
      check('redo reapplies it', (await cellsNow())![0][0] === 'Ticker');
    });

    if (!narrow) {
      await ctx.step('right-click: add a row below and a column right', async () => {
        const p = await at(CORNER);
        await page.mouse.click(p.x + 20, p.y + 10, { button: 'right' });
        await ctxMenu.waitFor();
        await ctx.screenshot('menu');
        await ctxMenu.getByRole('menuitem', { name: 'Add row below' }).click();
        check('a row was added below the first', JSON.stringify(await cellsNow()) === '[["Ticker","Price"],["",""],["DEMO","100"]]', JSON.stringify(await cellsNow()));
        await page.mouse.click(p.x + 20, p.y + 10, { button: 'right' });
        await ctxMenu.getByRole('menuitem', { name: 'Add column right' }).click();
        check('a column was added right of the first', (await cellsNow())!.every((r) => r.length === 3) && (await cellsNow())![0][1] === '', JSON.stringify(await cellsNow()));
        await page.mouse.click(p.x + 76, p.y + 10, { button: 'right' });
        await ctxMenu.getByRole('menuitem', { name: 'Delete column' }).click();
        check('Delete column on the new column removed it again', (await cellsNow())!.every((r) => r.length === 2) && (await cellsNow())![0][0] === 'Ticker', JSON.stringify(await cellsNow()));
        await ctx.screenshot('rows-added');
      });

      await ctx.step('settings: Rows and Columns, header row and a border colour as one undo step', async () => {
        const p = await at(CORNER);
        await page.keyboard.down('Shift');
        await page.mouse.dblclick(p.x + 20, p.y + 10);
        await page.keyboard.up('Shift');
        await dialog.waitFor();
        check('titled for the tool', (await dialog.getByRole('heading').textContent()) === 'Table settings');
        await dialog.getByLabel('Rows', { exact: true }).fill('4');
        await dialog.getByLabel('Columns', { exact: true }).fill('3');
        await dialog.getByLabel('Header row').check();
        await dialog.getByLabel('Border colour').fill('#f59e0b');
        check('nothing is stored before OK', (await cellsNow())!.length === 3);
        await ctx.screenshot('dialog');
        await dialog.getByRole('button', { name: 'OK' }).click();
        await dialog.waitFor({ state: 'hidden' });
        const t = (await stored()).find((d) => d.tool === 'table')!;
        check('4 by 3 cells with the text kept', t.cells!.length === 4 && t.cells!.every((r) => r.length === 3) && t.cells![0][0] === 'Ticker', JSON.stringify(t.cells));
        check('header and border stored', t.style?.header === true && t.style?.borderColor === '#f59e0b', JSON.stringify(t.style));
        await ctx.screenshot('styled');
        await page.keyboard.press('Control+z');
        const u = (await stored()).find((d) => d.tool === 'table')!;
        check('one undo reverts the size and the style', u.cells!.length === 3 && u.style === undefined, JSON.stringify(u));
        await page.keyboard.press('Control+Shift+z');
      });
    }

    await ctx.step('reload keeps the table, then a timeframe change', async () => {
      const before = JSON.stringify(await stored());
      await page.reload();
      await ctx.waitForChart();
      await page.waitForTimeout(500);
      check('storage is unchanged', JSON.stringify(await stored()) === before);
      await ctx.screenshot('reloaded');
      if (!narrow) {
        await page.locator('select[title="Timeframe"]').selectOption('1h');
        await page.waitForTimeout(1500);
        check('the table is still stored after a timeframe change', JSON.stringify(await stored()) === before);
        await ctx.screenshot('timeframe');
      }
    });

    await ctx.writeText('checks', checks.join('\n') + '\n');
  },
};
