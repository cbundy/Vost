import type { Scenario } from '../scenario.ts';

type Anchor = { time: number; price: number };
type Stored = { id: string; tool: string; anchors: Anchor[]; name?: string; locked?: boolean };

const ALL = `(() => {
  const raw = localStorage.getItem('vost.drawings.v2');
  return raw ? JSON.parse(raw).sources : {};
})()`;

/** Where (canvas fractions) each drawing goes; x is scaled to stay in the plot, clear of the price axis. */
const TREND = [{ x: 0.2, y: 0.6 }, { x: 0.6, y: 0.25 }];
const RECT1 = [{ x: 0.6, y: 0.55 }, { x: 0.8, y: 0.85 }];
const RECT2 = [{ x: 0.7, y: 0.45 }, { x: 0.95, y: 0.7 }];

export const drawingManage: Scenario = {
  name: 'drawing-manage',
  keepPrefs: true,
  description: 'Managing drawings: the right-click menu on a drawing and on empty chart, lock (a locked drawing does not move or pan the chart), rename, clone, Ctrl+drag clone (one undo step), copy and paste onto a second chart showing another symbol, bring to front and send to back of two rectangles, Remove drawings with undo, and selecting several drawings (Shift+click, a Shift+drag box) to move, lock, order, copy, paste and delete them together',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page } = ctx;
    const checks: string[] = [];
    const check = (label: string, ok: boolean, detail = '') => {
      checks.push(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` - ${detail}` : ''}`);
      if (!ok) throw new Error(`check failed: ${label} ${detail}`);
    };
    const narrow = ctx.viewport === 'narrow';
    const sources = async () => {
      await page.waitForTimeout(700);
      return (await page.evaluate(ALL)) as Record<string, Stored[]>;
    };
    const stored = async (symbol = 'DEMO') => (await sources())[`demo:${symbol}`] ?? [];
    const cell = () => page.locator('.chart-container').first();
    const at = async (f: { x: number; y: number }) => {
      const b = await cell().boundingBox();
      if (!b) throw new Error('chart container has no box');
      return { x: b.x + b.width * f.x * 0.7, y: b.y + b.height * f.y };
    };
    const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const menu = page.getByRole('menu');
    const item = (name: string) => menu.getByRole('menuitem', { name, exact: true });
    const rightClick = async (p: { x: number; y: number }) => {
      await page.mouse.move(p.x, p.y);
      await page.mouse.click(p.x, p.y, { button: 'right' });
      await menu.waitFor();
    };
    const drag = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
      await page.mouse.move(from.x, from.y);
      await page.waitForTimeout(120);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 12 });
      await page.mouse.up();
    };

    const rail = page.getByRole('toolbar', { name: 'Drawing tools' });
    const menuBtn = page.getByRole('button', { name: 'Drawing tools', exact: true });
    const toolMenu = page.getByRole('group', { name: 'Drawing tools menu' });
    const pickTool = async (group: string, label: string) => {
      if (narrow) {
        await menuBtn.click();
        const btn = toolMenu.getByRole('button', { name: label, exact: true });
        if (!(await btn.isVisible())) await toolMenu.getByRole('button', { name: group, exact: true }).click();
        await btn.click();
        return;
      }
      await rail.getByRole('button', { name: `Open ${group} tools`, exact: true }).click();
      await page.getByRole('menuitemradio', { name: label, exact: true }).click();
    };
    const draw = async (group: string, label: string, pts: { x: number; y: number }[]) => {
      await pickTool(group, label);
      const [a, b] = await Promise.all(pts.map(at));
      await drag(a, b);
      await page.waitForTimeout(200);
    };
    /** The chart as an image with the pointer parked at a fixed spot, so two shots differ only when the chart changed. */
    const shot = async () => {
      const park = await at({ x: 0.05, y: 0.95 });
      await page.mouse.move(park.x, park.y);
      await page.waitForTimeout(200);
      return cell().screenshot();
    };

    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();

    await ctx.step('empty chart menu with nothing drawn and nothing copied: Paste and Remove drawings are disabled', async () => {
      await rightClick(await at({ x: 0.5, y: 0.5 }));
      check('Add alert at <price> is there', await menu.getByRole('menuitem', { name: /^Add alert at / }).isVisible());
      check('Paste disabled', await item('Paste').isDisabled());
      check('Remove drawings disabled', await item('Remove drawings').isDisabled());
      await page.keyboard.press('Escape');
      await menu.waitFor({ state: 'detached' });
      check('Escape closes it', true);
    });

    const [ta, tb] = await Promise.all(TREND.map(at));
    const body = mid(ta, tb);

    await ctx.step('draw a trend line and right-click it: the menu has its title and every action', async () => {
      await draw('Lines', 'Trend line', TREND);
      check('one trend line', (await stored()).length === 1);
      await rightClick(body);
      check('titled by the tool', (await menu.getAttribute('aria-label')) === 'Trend line');
      const names = (await menu.getByRole('menuitem').allTextContents()).join(',');
      check('every action listed', names === 'Settings,Rename,Clone,Copy,Lock,Bring to front,Bring forward,Send backward,Send to back,Delete', names);
      await ctx.screenshot('menu');
    });

    await ctx.step('Lock: a drag does nothing and the chart does not pan', async () => {
      await item('Lock').click();
      const before = (await stored())[0];
      check('stored locked', before.locked === true);
      const still = await shot();
      await drag(body, { x: body.x + 60, y: body.y + 50 });
      const after = (await stored())[0];
      check('anchors unchanged', JSON.stringify(after.anchors) === JSON.stringify(before.anchors));
      check('the chart did not pan or change', (await shot()).equals(still));
      await ctx.screenshot('locked');
      await rightClick(body);
      check('the menu offers Unlock', await item('Unlock').isVisible());
      await item('Unlock').click();
      check('unlocked', (await stored())[0].locked === undefined);
    });

    await ctx.step('Rename in the menu stores the name and titles the menu', async () => {
      await rightClick(body);
      await item('Rename').click();
      const input = menu.getByRole('textbox', { name: 'Name' });
      await input.fill('  Support  ');
      await ctx.screenshot('rename');
      await input.press('Enter');
      check('name stored trimmed', (await stored())[0].name === 'Support');
      await rightClick(body);
      check('menu titled by the name', (await menu.getAttribute('aria-label')) === 'Support');
      await ctx.screenshot('menu-named');
      await page.keyboard.press('Escape');
    });

    await ctx.step('Clone in the menu adds a copy with the same name and anchors, and undo removes it', async () => {
      await rightClick(body);
      await item('Clone').click();
      const list = await stored();
      check('two drawings', list.length === 2);
      check('the copy has the original anchors and name and its own id', list[1].id !== list[0].id && list[1].name === 'Support' && JSON.stringify(list[1].anchors) === JSON.stringify(list[0].anchors));
      await page.keyboard.press('Control+z');
      check('one undo removes the clone', (await stored()).length === 1);
    });

    await ctx.step('Ctrl+drag clones and drags the clone; one undo removes both', async () => {
      const original = (await stored())[0];
      await page.keyboard.down('Control');
      await drag(body, { x: body.x, y: body.y + 70 });
      await page.keyboard.up('Control');
      const list = await stored();
      check('two drawings', list.length === 2);
      check('the original stayed', JSON.stringify(list[0].anchors) === JSON.stringify(original.anchors));
      check('the clone moved', JSON.stringify(list[1].anchors) !== JSON.stringify(original.anchors));
      await ctx.screenshot('ctrl-drag');
      await page.keyboard.press('Control+z');
      const undone = await stored();
      check('one undo removes the clone and its move', undone.length === 1 && JSON.stringify(undone[0].anchors) === JSON.stringify(original.anchors));
    });

    await ctx.step('bring to front and send to back reorder two overlapping rectangles', async () => {
      await draw('Shapes', 'Rectangle', RECT1);
      await draw('Shapes', 'Rectangle', RECT2);
      const list = await stored();
      check('trend line then two rectangles', list.map((d) => d.tool).join() === 'trendLine,rectangle,rectangle');
      const [first, second] = [list[1].id, list[2].id];
      const [r1a, r1b] = await Promise.all(RECT1.map(at));
      await rightClick({ x: r1a.x, y: (r1a.y + r1b.y) / 2 });
      await item('Bring to front').click();
      const front = await stored();
      check('the first rectangle is last', front[2].id === first && front[1].id === second);
      await ctx.screenshot('front');
      const [r2a, r2b] = await Promise.all(RECT2.map(at));
      await rightClick({ x: r2b.x, y: (r2a.y + r2b.y) / 2 });
      await item('Send to back').click();
      const back = await stored();
      check('the second rectangle is first', back[0].id === second && back[0].tool === 'rectangle');
      check('only the order changed', back.length === 3 && JSON.stringify([...back].sort((a, b) => a.id.localeCompare(b.id))) === JSON.stringify([...list].sort((a, b) => a.id.localeCompare(b.id))));
      await ctx.screenshot('back');
      await page.keyboard.press('Control+z');
      await page.keyboard.press('Control+z');
      check('two undos put the order back', (await stored()).map((d) => d.id).join() === list.map((d) => d.id).join());
    });

    await ctx.step('Ctrl+C then the empty chart menu enables Paste, which adds the copy on top', async () => {
      await page.mouse.click(body.x, body.y);
      await page.keyboard.press('Control+c');
      await rightClick(await at({ x: 0.1, y: 0.92 }));
      check('Paste enabled', await item('Paste').isEnabled());
      check('Remove drawings enabled', await item('Remove drawings').isEnabled());
      await ctx.screenshot('empty-menu');
      await item('Paste').click();
      const list = await stored();
      check('four drawings', list.length === 4);
      check('the pasted copy is on top with the copied anchors', list[3].tool === 'trendLine' && list[3].id !== list[0].id && JSON.stringify(list[3].anchors) === JSON.stringify(list[0].anchors));
      await page.keyboard.press('Control+z');
      check('undo removes the paste', (await stored()).length === 3);
    });

    await ctx.step('Remove drawings in the menu asks first and one undo brings every drawing back', async () => {
      page.once('dialog', (d) => void d.dismiss());
      await rightClick(await at({ x: 0.1, y: 0.92 }));
      await item('Remove drawings').click();
      check('dismissing the confirm keeps them', (await stored()).length === 3);
      page.once('dialog', (d) => void d.accept());
      await rightClick(await at({ x: 0.1, y: 0.92 }));
      await item('Remove drawings').click();
      check('accepting removes them', (await stored()).length === 0);
      await page.keyboard.press('Control+z');
      check('undo brings them back', (await stored()).length === 3);
    });

    await ctx.step('select several drawings: Shift+click adds and removes, a Shift+drag box selects, and the group moves, orders, copies and deletes together', async () => {
      const list = await stored();
      check('trend line and two rectangles', list.map((d) => d.tool).join() === 'trendLine,rectangle,rectangle');
      const [r1a, r1b] = await Promise.all(RECT1.map(at));
      const [r2a, r2b] = await Promise.all(RECT2.map(at));
      const edge1 = { x: r1a.x, y: (r1a.y + r1b.y) / 2 };
      const edge2 = { x: r2b.x, y: (r2a.y + r2b.y) / 2 };
      const empty = await at({ x: 0.1, y: 0.92 });
      const shiftClick = async (p: { x: number; y: number }) => {
        await page.keyboard.down('Shift');
        await page.mouse.click(p.x, p.y);
        await page.keyboard.up('Shift');
      };
      const title = async (p: { x: number; y: number }) => {
        await rightClick(p);
        const t = await menu.getAttribute('aria-label');
        return t;
      };
      const closeMenu = async () => {
        await page.keyboard.press('Escape');
        await menu.waitFor({ state: 'detached' });
      };
      const boxA = await at({ x: 0.05, y: 0.12 });
      const boxB = await at({ x: 0.98, y: 0.95 });
      /** Selects all three with a Shift+drag box. */
      const boxAll = async () => {
        await page.mouse.click(empty.x, empty.y);
        await page.keyboard.down('Shift');
        await drag(boxA, boxB);
        await page.keyboard.up('Shift');
      };

      await page.mouse.click(empty.x, empty.y);
      await shiftClick(body);
      await shiftClick(edge1);
      check('Shift+click two drawings selects both', (await title(edge1)) === '2 drawings');
      await ctx.screenshot('multi-selected');
      await closeMenu();
      await shiftClick(edge1);
      check('Shift+click again takes it out', (await title(body)) === 'Support');
      await closeMenu();
      check('nothing moved', JSON.stringify(await stored()) === JSON.stringify(list));

      await page.mouse.click(empty.x, empty.y);
      const still = await shot();
      await page.keyboard.down('Shift');
      await page.mouse.move(boxA.x, boxA.y);
      await page.mouse.down();
      await page.mouse.move(boxB.x, boxB.y, { steps: 12 });
      await ctx.screenshot('box');
      await page.mouse.up();
      await page.keyboard.up('Shift');
      check('the box selected all three', (await title(edge2)) === '3 drawings');
      const names = (await menu.getByRole('menuitem').allTextContents()).join(',');
      check('no Settings or Rename for several', names === 'Clone,Copy,Lock,Bring to front,Bring forward,Send backward,Send to back,Delete', names);
      await ctx.screenshot('multi-menu');
      await closeMenu();
      await page.mouse.click(empty.x, empty.y);
      check('the box did not pan or zoom the chart', (await shot()).equals(still));

      // Lock one rectangle, then drag the trend line with the other two selected: the unlocked pair move together.
      await page.mouse.click(edge1.x, edge1.y);
      await rightClick(edge1);
      await item('Lock').click();
      await boxAll();
      const beforeMove = await stored();
      check('rectangle locked', beforeMove[1].locked === true);
      await drag(body, { x: body.x + 40, y: body.y + 30 });
      const moved = await stored();
      const delta = (i: number) => ({ t: moved[i].anchors[0].time - beforeMove[i].anchors[0].time, p: moved[i].anchors[0].price - beforeMove[i].anchors[0].price });
      const [d0, d2] = [delta(0), delta(2)];
      check('the locked rectangle stayed', JSON.stringify(moved[1]) === JSON.stringify(beforeMove[1]));
      check('both others moved', d0.t !== 0 && d0.p !== 0 && d2.t !== 0 && d2.p !== 0, JSON.stringify({ d0, d2 }));
      check('by the same offset', Math.abs(d0.p - d2.p) <= Math.abs(d0.p) * 0.01 && Math.abs(d0.t - d2.t) <= Math.abs(d0.t) * 0.15, JSON.stringify({ d0, d2 }));
      await ctx.screenshot('multi-moved');
      await page.keyboard.press('Control+z');
      check('one undo puts both back', JSON.stringify(await stored()) === JSON.stringify(beforeMove));
      await page.keyboard.press('Control+z');
      check('another undo unlocks', JSON.stringify(await stored()) === JSON.stringify(list));

      // Bring to front on two of three keeps their relative order.
      await page.mouse.click(empty.x, empty.y);
      await page.mouse.click(body.x, body.y);
      await shiftClick(edge1);
      await rightClick(edge1);
      await item('Bring to front').click();
      check('the two moved to the top in their order', (await stored()).map((d) => d.id).join() === [list[2].id, list[0].id, list[1].id].join());
      await page.keyboard.press('Control+z');
      check('one undo restores the order', (await stored()).map((d) => d.id).join() === list.map((d) => d.id).join());

      // Copy and paste all three, then delete the pasted (selected) ones with one key press.
      await boxAll();
      await page.keyboard.press('Control+c');
      await page.keyboard.press('Control+v');
      const pasted = await stored();
      check('three pasted on top, in order', pasted.length === 6 && pasted.slice(3).map((d) => d.tool).join() === 'trendLine,rectangle,rectangle');
      check('all three pasted are selected', (await title(edge2)) === '3 drawings');
      await closeMenu();
      await page.keyboard.press('Delete');
      check('Delete removes the whole selection', (await stored()).map((d) => d.id).join() === list.map((d) => d.id).join());
      await page.keyboard.press('Control+z');
      check('one undo brings all three back', (await stored()).length === 6);
      await page.keyboard.press('Control+z');
      check('the originals are left', (await stored()).map((d) => d.id).join() === list.map((d) => d.id).join());
    });

    await ctx.step('copy on one chart, paste onto a second chart showing another symbol', async () => {
      await page.mouse.click(body.x, body.y);
      await page.keyboard.press('Control+c');
      await page.getByRole('button', { name: 'Select layout' }).click();
      await page.getByRole('button', { name: '2 charts side by side', exact: true }).click();
      await page.locator('.chart-cell').nth(1).waitFor({ state: 'attached' });
      await page.waitForFunction(() => document.querySelectorAll('.chart-cell .legend-title').length === 2);
      if (narrow) await page.getByRole('button', { name: 'Next chart' }).click();
      else {
        const b = await page.locator('.chart-cell').nth(1).boundingBox();
        if (!b) throw new Error('no second cell');
        await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      }
      const input = page.locator('.topbar .symbol-search input');
      await input.fill('DEMO-BEAR');
      await input.press('Escape');
      await input.press('Enter');
      await page.locator('.chart-cell.active .legend-title', { hasText: 'DEMO-BEAR' }).waitFor();
      await page.waitForTimeout(400);
      const c = await page.locator('.chart-cell.active .chart-container').boundingBox();
      if (!c) throw new Error('no active chart');
      await page.mouse.click(c.x + c.width * 0.1, c.y + c.height * 0.1);
      check('focus left the symbol field', await page.evaluate(() => document.activeElement?.tagName !== 'INPUT'));
      const source = (await stored('DEMO'))[0];
      await page.keyboard.press('Control+v');
      const other = await stored('DEMO-BEAR');
      check('one drawing on the other symbol', other.length === 1 && other[0].tool === 'trendLine');
      check('same times and prices', JSON.stringify(other[0].anchors) === JSON.stringify(source.anchors));
      check('a new id', other[0].id !== source.id);
      check('the first symbol is unchanged', (await stored('DEMO')).length === 3);
      await ctx.screenshot('pasted-other-chart');
    });

    await ctx.writeText('checks', checks.join('\n') + '\n');
  },
};
