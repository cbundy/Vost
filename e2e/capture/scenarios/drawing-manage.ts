import { generateDemoCandles } from '../../../client/src/lib/providers/demo.ts';
import type { Scenario } from '../scenario.ts';
import { showSideSection } from '../side-panel.ts';

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
  description: 'Managing drawings: the right-click menu on a drawing and on empty chart, lock (a locked drawing does not move or pan the chart), rename, clone, Ctrl+drag clone (one undo step), copy and paste onto a second chart showing another symbol, bring to front and send to back of two rectangles, Remove drawings with undo, and selecting several drawings (Shift+click, a Shift+drag box) to move, lock, order, copy, paste and delete them together, and the Object tree side panel (select, hide, lock, rename, drag to reorder and delete from the list, Hide in the menu, following the active chart)',
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
      check('every action listed', names === 'Settings,Rename,Clone,Copy,Lock,Hide,Bring to front,Bring forward,Send backward,Send to back,Delete', names);
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

    /** A rail switch (on the phone, a button of the drawing menu, which is closed again after a click). */
    const sw = async (name: string, action: 'click' | 'state' = 'click') => {
      if (narrow) {
        await menuBtn.click();
        if (name === 'Magnet') {
          // the phone menu has the magnet's modes, not a toggle: pressed is "Off" not being the checked one
          const off = toolMenu.getByRole('radio', { name: 'Off', exact: true });
          const v = (await off.getAttribute('aria-checked')) === 'false' ? 'true' : 'false';
          if (action === 'click') await off.click();
          await page.keyboard.press('Escape');
          return action === 'state' ? v : null;
        }
        const b = toolMenu.getByRole('button', { name, exact: true });
        if (action === 'state') {
          const v = await b.getAttribute('aria-pressed');
          await page.keyboard.press('Escape');
          return v;
        }
        await b.click();
        await page.keyboard.press('Escape');
        return null;
      }
      const b = rail.getByRole('button', { name, exact: true });
      if (action === 'state') return b.getAttribute('aria-pressed');
      await b.click();
      return null;
    };
    const countIs = async (n: number) => (await stored()).length === n;
    const undoTo = async (n: number) => {
      for (let i = 0; i < 6 && !(await countIs(n)); i++) await page.keyboard.press('Control+z');
      check(`back to ${n} drawing(s)`, await countIs(n));
    };

    await ctx.step('Lock all drawings: nothing moves, no handles, own locks untouched, off restores them', async () => {
      const before = (await stored())[0];
      await page.mouse.click(body.x, body.y);
      await sw('Lock all drawings');
      check('Lock all pressed', (await sw('Lock all drawings', 'state')) === 'true');
      const still = await shot();
      await drag(body, { x: body.x + 60, y: body.y + 50 });
      check('a body drag moved nothing', JSON.stringify((await stored())[0].anchors) === JSON.stringify(before.anchors));
      await page.mouse.click(body.x, body.y);
      await drag(ta, { x: ta.x - 40, y: ta.y + 40 });
      check('a handle drag moved nothing', JSON.stringify((await stored())[0].anchors) === JSON.stringify(before.anchors));
      check('the drawing has no flag of its own', (await stored())[0].locked === undefined);
      await page.mouse.click(body.x, body.y);
      check('the chart did not pan and no handles are drawn', (await shot()).equals(still));
      await rightClick(body);
      check('the menu still offers Lock (own flag)', await item('Lock').isVisible());
      await ctx.screenshot('lock-all');
      await item('Lock').click();
      check('own lock stored', (await stored())[0].locked === true);
      await sw('Lock all drawings');
      check('Lock all off', (await sw('Lock all drawings', 'state')) === 'false');
      await drag(body, { x: body.x + 60, y: body.y + 50 });
      check('own lock still holds', JSON.stringify((await stored())[0].anchors) === JSON.stringify(before.anchors));
      await rightClick(body);
      await item('Unlock').click();
      check('unlocked again', (await stored())[0].locked === undefined);
      await drag(body, { x: body.x + 60, y: body.y + 50 });
      check('now it drags', JSON.stringify((await stored())[0].anchors) !== JSON.stringify(before.anchors));
      await page.keyboard.press('Control+z');
      check('undo puts it back', JSON.stringify((await stored())[0].anchors) === JSON.stringify(before.anchors));
    });

    await ctx.step('Stay in drawing mode: two trend lines in a row, Escape and a Measure return to the cursor', async () => {
      await sw('Stay in drawing mode');
      check('Stay pressed', (await sw('Stay in drawing mode', 'state')) === 'true');
      await pickTool('Lines', 'Trend line');
      const [a1, a2] = await Promise.all([{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.3 }].map(at));
      const [b1, b2] = await Promise.all([{ x: 0.1, y: 0.8 }, { x: 0.3, y: 0.7 }].map(at));
      await drag(a1, a2);
      await drag(b1, b2);
      check('two more stored without picking again', await countIs(3));
      if (!narrow) check('Trend line still pressed', (await rail.getByRole('button', { name: 'Trend line', exact: true }).getAttribute('aria-pressed')) === 'true');
      await ctx.screenshot('stay-mode');
      await page.keyboard.press('Escape');
      if (!narrow) check('Escape returns to Cross', (await rail.getByRole('button', { name: 'Cross', exact: true }).getAttribute('aria-pressed')) === 'true');
      await undoTo(1);
      await pickTool('Forecasting and measurers', 'Measure');
      await drag(a1, a2);
      await drag(b1, b2);
      check('a Measure stores nothing', await countIs(1));
      if (!narrow) check('the Measure went back to the cursor', (await rail.getByRole('button', { name: 'Cross', exact: true }).getAttribute('aria-pressed')) === 'true');
      await sw('Stay in drawing mode');
      check('Stay off', (await sw('Stay in drawing mode', 'state')) === 'false');
      await page.keyboard.press('Escape');
    });

    await ctx.step('Magnet: weak snaps only close to an OHLC, strong snaps any point; the strength survives a reload', async () => {
      const bars = generateDemoCandles({ bars: 5000, timeframe: '1d', seed: 1337 });
      const isBarTime = (t: number) => bars.some((c) => c.time === t);
      const barOf = (t: number) => bars.reduce((best, c) => (Math.abs(c.time - t) < Math.abs(best.time - t) ? c : best));
      const ohlc = (t: number) => {
        const c = barOf(t);
        return [c.open, c.high, c.low, c.close];
      };
      const pickMode = async (name: string) => {
        if (narrow) {
          await menuBtn.click();
          await toolMenu.getByRole('radio', { name, exact: true }).click();
          await page.keyboard.press('Escape');
          return;
        }
        await rail.getByRole('button', { name: 'Open Magnet modes', exact: true }).click();
        await page.getByRole('menuitemradio', { name, exact: true }).click();
      };
      const modeChecked = async (name: string) => {
        if (narrow) {
          await menuBtn.click();
          const v = await toolMenu.getByRole('radio', { name, exact: true }).getAttribute('aria-checked');
          await page.keyboard.press('Escape');
          return v === 'true';
        }
        await rail.getByRole('button', { name: 'Open Magnet modes', exact: true }).click();
        const v = await page.getByRole('menuitemradio', { name, exact: true }).getAttribute('aria-checked');
        await page.keyboard.press('Escape');
        return v === 'true';
      };
      const trend = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
        await pickTool('Lines', 'Trend line');
        await drag(from, to);
        const list = await stored();
        return list[list.length - 1].anchors;
      };
      // two far points (their bars' prices are clear of them), which also calibrate pixels to price
      const f1 = await at({ x: 0.45, y: 0.5 });
      const f2 = await at({ x: 0.6, y: 0.9 });

      await pickMode('Weak magnet');
      if (!narrow) check('title says weak', (await rail.getByRole('button', { name: 'Magnet', exact: true }).getAttribute('title')) === 'Magnet: weak');
      check('Magnet pressed', (await sw('Magnet', 'state')) === 'true');
      const far = await trend(f1, f2);
      for (const [i, a] of far.entries()) {
        const near = ohlc(a.time).some((v) => Math.abs(v - a.price) < 1e-6);
        check(`weak: far point ${i + 1} is not snapped`, !near, JSON.stringify(a));
      }
      const perPx = (far[0].price - far[1].price) / (f2.y - f1.y);
      const near = async (frac: { x: number; y: number }) => {
        const p = await at(frac);
        const t = (await trend(f1, p))[1];
        // a bar's high, found from the pixels: put the pointer on it
        const high = barOf(t.time).high;
        const y = f1.y + (far[0].price - high) / perPx;
        return { y, high };
      };
      const probe = await near({ x: 0.5, y: 0.5 });
      const pt = await at({ x: 0.5, y: 0.5 });
      const nearAnchors = await trend(f1, { x: pt.x, y: probe.y });
      check('weak: a point on the high of a bar snaps to it', Math.abs(nearAnchors[1].price - probe.high) < 1e-6 && isBarTime(nearAnchors[1].time), `${nearAnchors[1].price} vs ${probe.high}`);
      await ctx.screenshot('magnet-weak');

      await pickMode('Strong magnet');
      if (!narrow) check('title says strong', (await rail.getByRole('button', { name: 'Magnet', exact: true }).getAttribute('title')) === 'Magnet: strong');
      const strong = await trend(f1, f2);
      for (const [i, a] of strong.entries()) {
        check(`strong: far point ${i + 1} snaps to an OHLC`, isBarTime(a.time) && ohlc(a.time).some((v) => Math.abs(v - a.price) < 1e-6), JSON.stringify(a));
      }
      if (!narrow) {
        await rail.getByRole('button', { name: 'Open Magnet modes', exact: true }).click();
        await ctx.screenshot('magnet-menu');
        await page.keyboard.press('Escape');
        check('Escape closes the menu and refocuses the Magnet button', await rail.getByRole('button', { name: 'Magnet', exact: true }).evaluate((el) => el === document.activeElement));
      }
      await undoTo(1);
      await sw('Stay in drawing mode');
      await sw('Lock all drawings');
      await page.waitForTimeout(700);
      await page.reload();
      await ctx.waitForChart();
      check('strength survives a reload', await modeChecked('Strong magnet'));
      check('Magnet survives a reload', (await sw('Magnet', 'state')) === 'true');
      check('Stay survives a reload', (await sw('Stay in drawing mode', 'state')) === 'true');
      check('Lock all survives a reload', (await sw('Lock all drawings', 'state')) === 'true');
      await ctx.screenshot('switches-on');
      await sw('Stay in drawing mode');
      await sw('Lock all drawings');
      await sw('Magnet');
      check('switches off for the steps below', (await sw('Magnet', 'state')) === 'false' && (await sw('Stay in drawing mode', 'state')) === 'false' && (await sw('Lock all drawings', 'state')) === 'false');
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
      check('no Settings or Rename for several', names === 'Clone,Copy,Lock,Hide,Bring to front,Bring forward,Send backward,Send to back,Delete', names);
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

    await ctx.step('Object tree: the chart\'s drawings top-most first, with select, hide, lock, rename, reorder and delete', async () => {
      const dlg = page.getByRole('dialog', { name: 'Sidebar' });
      const openTree = async () => {
        await showSideSection(page, 'Object tree', narrow);
        await page.locator('.object-tree').waitFor();
      };
      const closeTree = async () => {
        if (narrow && (await dlg.count()) > 0) {
          await dlg.getByRole('button', { name: 'Close sidebar' }).click();
          await dlg.waitFor({ state: 'detached' });
        }
      };
      const rowIds = () => page.locator('.object-row').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.rowId ?? ''));
      const row = (id: string) => page.locator(`.object-row[data-row-id="${id}"]`);
      const btn = (id: string, verb: string) => row(id).locator(`button[aria-label^="${verb} "]`);

      await openTree();
      const list = await stored();
      const [trendId, rect1Id, rect2Id] = list.map((d) => d.id);
      await page.waitForFunction((n) => document.querySelectorAll('.object-row').length === n, 3);
      check('the list follows the active chart: three rows, top-most first', (await rowIds()).join() === [rect2Id, rect1Id, trendId].join());
      check('a row shows its name, else its tool label', (await row(trendId).locator('.object-name').textContent()) === (list[0].name ?? 'Trend line'));
      check('an unnamed row shows the tool label', (await row(rect1Id).locator('.object-name').textContent()) === (list[1].name ?? 'Rectangle'), String(list[1].name));

      await row(trendId).locator('.object-name').click();
      check('a click selects it', (await row(trendId).getAttribute('aria-selected')) === 'true');
      await ctx.screenshot('tree');

      await btn(rect2Id, 'Hide').click();
      check('the eye hides it', (await stored()).find((d) => d.id === rect2Id)?.hidden === true);
      check('the row is dimmed', ((await row(rect2Id).getAttribute('class')) ?? '').includes('dim'));
      await ctx.screenshot('tree-hidden');
      await page.keyboard.press('Control+z');
      check('one undo shows it again', (await stored()).find((d) => d.id === rect2Id)?.hidden === undefined);

      await closeTree();
      const body2 = body;
      await rightClick(body2);
      await item('Hide').click();
      check('right-click Hide hides it', (await stored()).find((d) => d.id === trendId)?.hidden === true);
      await page.keyboard.press('Control+z');
      check('and one undo shows it', (await stored()).find((d) => d.id === trendId)?.hidden === undefined);

      await openTree();
      await btn(trendId, 'Lock').click();
      check('the lock toggle locks it', (await stored()).find((d) => d.id === trendId)?.locked === true);
      await closeTree();
      const anchorsBefore = JSON.stringify((await stored())[0].anchors);
      await drag(body2, { x: body2.x + 60, y: body2.y + 50 });
      check('a drag is refused', JSON.stringify((await stored())[0].anchors) === anchorsBefore);
      await openTree();
      await btn(trendId, 'Unlock').click();
      check('unlocked from the row', (await stored())[0].locked === undefined);

      await row(trendId).locator('.object-name').dblclick();
      const input = row(trendId).getByRole('textbox', { name: 'Name' });
      await input.fill('Support');
      await input.press('Enter');
      await page.waitForTimeout(100);
      check('inline rename keeps the name', (await stored())[0].name === 'Support');
      check('the row shows it', (await row(trendId).locator('.object-name').textContent()) === 'Support');
      await row(rect1Id).locator('.object-name').dblclick();
      const cancel = row(rect1Id).getByRole('textbox', { name: 'Name' });
      await cancel.fill('Nope');
      await cancel.press('Escape');
      check('Escape cancels a rename', (await stored())[1].name === undefined);
      await closeTree();
      await rightClick(body2);
      check('the menu header shows the name', (await menu.getAttribute('aria-label')) === 'Support');
      await page.keyboard.press('Escape');
      await menu.waitFor({ state: 'detached' });
      await openTree();

      const before = (await stored()).map((d) => d.id);
      const top = await row(rect2Id).boundingBox();
      const bottom = await row(trendId).boundingBox();
      if (!top || !bottom) throw new Error('rows have no box');
      await page.mouse.move(top.x + top.width / 2, top.y + top.height / 2);
      await page.mouse.down();
      await page.mouse.move(bottom.x + bottom.width / 2, bottom.y + bottom.height * 0.9, { steps: 10 });
      await ctx.screenshot('tree-drag');
      await page.mouse.up();
      const after = (await stored()).map((d) => d.id);
      check('dragging the top row below the bottom one paints it at the bottom', after.join() === [rect2Id, trendId, rect1Id].join(), after.join());
      await page.keyboard.press('Control+z');
      check('one undo restores the paint order', (await stored()).map((d) => d.id).join() === before.join());

      await btn(rect1Id, 'Delete').click();
      check('the delete button removes it', (await stored()).length === 2);
      await ctx.screenshot('tree-deleted');
      await page.keyboard.press('Control+z');
      check('one undo brings it back', (await stored()).length === 3);
      await closeTree();
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


    await ctx.step('Object tree follows the active chart', async () => {
      const dlg = page.getByRole('dialog', { name: 'Sidebar' });
      const rowIds = () => page.locator('.object-row').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.rowId ?? ''));
      await showSideSection(page, 'Object tree', narrow);
      await page.locator('.object-tree').waitFor();
      check('the other chart lists its one pasted drawing', (await rowIds()).length === 1);
      await ctx.screenshot('tree-other-chart');
      if (narrow) {
        await dlg.getByRole('button', { name: 'Close sidebar' }).click();
        await dlg.waitFor({ state: 'detached' });
        await page.getByRole('button', { name: 'Previous chart' }).click();
      } else {
        const b = await page.locator('.chart-cell').nth(0).boundingBox();
        if (!b) throw new Error('no first cell');
        await page.mouse.click(b.x + b.width * 0.1, b.y + b.height * 0.1);
      }
      await page.locator('.chart-cell.active .legend-title', { hasText: 'DEMO' }).waitFor();
      await showSideSection(page, 'Object tree', narrow);
      await page.waitForFunction((n) => document.querySelectorAll('.object-row').length === n, 3);
      check('switching the active chart lists its three drawings', (await rowIds()).length === 3);
    });

    await ctx.writeText('checks', checks.join('\n') + '\n');
  },
};
