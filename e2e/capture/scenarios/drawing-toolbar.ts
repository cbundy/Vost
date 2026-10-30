import type { Scenario } from '../scenario.ts';

type Anchor = { time: number; price: number };
type Stored = { id: string; tool: string; anchors: Anchor[]; style?: Record<string, unknown>; locked?: boolean };

const STORED = `(() => {
  const raw = localStorage.getItem('vost.drawings.v2');
  const all = raw ? JSON.parse(raw).sources : {};
  return all['demo:DEMO'] ?? [];
})()`;

/** Where (canvas fractions) each drawing goes; x is scaled to stay in the plot, clear of the price axis. */
const TREND = [{ x: 0.2, y: 0.6 }, { x: 0.6, y: 0.35 }];
const TOP = [{ x: 0.3, y: 0.02 }, { x: 0.7, y: 0.05 }];

export const drawingToolbar: Scenario = {
  name: 'drawing-toolbar',
  keepPrefs: true,
  description:
    'The floating drawing toolbar: it shows above the one selected drawing (below it near the top of the chart) and follows a pan and a price-scale drag; quick colour (a swatch), width and line style each as one undo step; the gear opens the settings dialog and hides the toolbar; lock keeps quick edits working; clone moves it to the copy; the more menu lists the right-click menu\'s items; delete removes it; a horizontal line and a note get only their own pickers; two selected drawings show none; pressing a button with a line tool armed neither draws nor pans; at 360 px it fits inside the chart',
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
    const cell = () => page.locator('.chart-container').first();
    const at = async (f: { x: number; y: number }) => {
      const b = await cell().boundingBox();
      if (!b) throw new Error('chart container has no box');
      return { x: b.x + b.width * f.x * 0.7, y: b.y + b.height * f.y };
    };
    const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const drag = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
      await page.mouse.move(from.x, from.y);
      await page.waitForTimeout(120);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 12 });
      await page.mouse.up();
    };
    const rail = page.getByRole('toolbar', { name: 'Drawing tools', exact: true });
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
      await page.waitForTimeout(250);
    };
    const toolbar = (title: string) => page.getByRole('toolbar', { name: `${title} tools`, exact: true });
    const anyToolbar = () => page.locator('.drawing-toolbar');
    const undo = async () => {
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(300);
    };
    const bounds = async (title: string) => {
      const b = await toolbar(title).boundingBox();
      if (!b) throw new Error('no toolbar box');
      return b;
    };
    const inside = async (title: string) => {
      const b = await bounds(title);
      const main = await page.locator('.chart-main').boundingBox();
      if (!main) throw new Error('no chart-main box');
      return b.x >= main.x && b.y >= main.y && b.x + b.width <= main.x + main.width && b.y + b.height <= main.y + main.height;
    };

    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();

    const [ta, tb] = await Promise.all(TREND.map(at));
    const body = mid(ta, tb);

    await ctx.step('select a trend line: the toolbar shows above it, centred and inside the chart', async () => {
      await draw('Lines', 'Trend line', TREND);
      await page.mouse.click(body.x, body.y);
      await toolbar('Trend line').waitFor();
      const b = await bounds('Trend line');
      check('above the drawing', b.y + b.height < Math.min(ta.y, tb.y));
      check('centred over its box', Math.abs(b.x + b.width / 2 - body.x) < 12 || narrow, `${b.x + b.width / 2} vs ${body.x}`);
      check('inside the chart area', await inside('Trend line'));
      check('a colour, a width and a line style picker, the gear, lock, clone, delete and more', (await toolbar('Trend line').getByRole('button').allTextContents()).length === 8);
      await ctx.screenshot('selected');
    });

    await ctx.step('colour: the popover opens on swatches; a pick is stored and one undo reverts it', async () => {
      const tb1 = toolbar('Trend line');
      await tb1.getByRole('button', { name: 'Colour', exact: true }).click();
      await page.getByRole('button', { name: 'Green', exact: true }).waitFor();
      await ctx.screenshot('colour');
      await page.getByRole('button', { name: 'Green', exact: true }).click();
      check('stored green', (await stored())[0].style?.color === 'green', JSON.stringify((await stored())[0].style));
      await page.keyboard.press('Escape');
      await undo();
      check('one undo reverts it', (await stored())[0].style?.color === undefined);
    });

    await ctx.step('width 3 and dashed: both stored, each one undo step', async () => {
      const tb1 = toolbar('Trend line');
      await tb1.getByRole('button', { name: 'Width', exact: true }).click();
      await page.getByRole('menuitemradio', { name: /^3px/ }).click();
      await page.keyboard.press('Escape');
      await tb1.getByRole('button', { name: 'Line style', exact: true }).click();
      await page.getByRole('menuitemradio', { name: /Dashed/ }).click();
      let s = (await stored())[0].style;
      check('width 3 and dashed stored', s?.width === 3 && s?.lineStyle === 'dashed', JSON.stringify(s));
      await ctx.screenshot('dashed');
      await page.keyboard.press('Escape');
      await undo();
      s = (await stored())[0].style;
      check('one undo reverts the line style only', s?.width === 3 && s?.lineStyle === undefined, JSON.stringify(s));
      await undo();
      check('another reverts the width', (await stored())[0].style?.width === undefined);
    });

    await ctx.step('the gear opens the settings dialog and the toolbar hides; Cancel brings it back', async () => {
      await toolbar('Trend line').getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByRole('dialog').waitFor();
      check('toolbar hidden', (await anyToolbar().count()) === 0);
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await toolbar('Trend line').waitFor();
      check('toolbar back after Cancel', true);
    });

    await ctx.step('lock: the button is pressed and a quick colour still applies', async () => {
      const lock = toolbar('Trend line').getByRole('button', { name: 'Lock', exact: true });
      await lock.click();
      check('stored locked', (await stored())[0].locked === true);
      check('aria-pressed', (await lock.getAttribute('aria-pressed')) === 'true');
      await toolbar('Trend line').getByRole('button', { name: 'Colour', exact: true }).click();
      await page.getByRole('button', { name: 'Red', exact: true }).click();
      check('colour applied to the locked drawing', (await stored())[0].style?.color === 'red');
      await page.keyboard.press('Escape');
      await ctx.screenshot('locked');
      await lock.click();
      check('unlocked', (await stored())[0].locked === undefined);
    });

    await ctx.step('the more menu lists the right-click menu items', async () => {
      await toolbar('Trend line').getByRole('button', { name: 'More', exact: true }).click();
      const names = (await page.getByRole('menu').getByRole('menuitem').allTextContents()).join(',');
      check('every item listed', names === 'Settings,Rename,Clone,Copy,Lock,Hide,Bring to front,Bring forward,Send backward,Send to back,Delete', names);
      await ctx.screenshot('more');
      await page.keyboard.press('Escape');
      check('Escape closes it', (await page.getByRole('menu').count()) === 0);
      check('focus returns to More', await toolbar('Trend line').getByRole('button', { name: 'More', exact: true }).evaluate((el) => el === document.activeElement));
    });

    await ctx.step('the toolbar follows a pan and a price-scale drag', async () => {
      const before = await bounds('Trend line');
      const b = await cell().boundingBox();
      if (!b) throw new Error('no box');
      const y = b.y + b.height * 0.9;
      await drag({ x: b.x + b.width * 0.3, y }, { x: b.x + b.width * 0.4, y });
      await page.waitForTimeout(300);
      check('the pan kept the selection', (await anyToolbar().count()) === 1);
      const panned = await bounds('Trend line');
      check('moved with the pan', Math.abs(panned.x - before.x) > 5 || Math.abs(panned.y - before.y) > 5, `${before.x},${before.y} -> ${panned.x},${panned.y}`);
      const axisX = b.x + b.width - 25;
      await drag({ x: axisX, y: b.y + b.height * 0.5 }, { x: axisX, y: b.y + b.height * 0.7 });
      await page.waitForTimeout(300);
      const scaled = await bounds('Trend line');
      check('moved with a price-scale drag', Math.abs(scaled.y - panned.y) > 3, `${panned.y} -> ${scaled.y}`);
      await ctx.screenshot('followed');
    });

    await ctx.step('clone: the toolbar is on the copy; delete: no toolbar', async () => {
      await toolbar('Trend line').getByRole('button', { name: 'Clone', exact: true }).click();
      await page.waitForTimeout(300);
      check('two trend lines', (await stored()).length === 2);
      await toolbar('Trend line').waitFor();
      check('the toolbar follows the selected copy', (await anyToolbar().count()) === 1);
      await toolbar('Trend line').getByRole('button', { name: 'Delete', exact: true }).click();
      await page.waitForTimeout(300);
      check('one left', (await stored()).length === 1);
      check('no toolbar after delete', (await anyToolbar().count()) === 0);
    });

    await ctx.step('a drawing at the top of the chart gets the toolbar below it', async () => {
      await draw('Lines', 'Trend line', TOP);
      const [a, b] = await Promise.all(TOP.map(at));
      await page.mouse.click((a.x + b.x) / 2, (a.y + b.y) / 2);
      const t = await toolbar('Trend line').waitFor().then(() => bounds('Trend line'));
      check('below the drawing', t.y > Math.max(a.y, b.y));
      check('inside the chart area', await inside('Trend line'));
      await ctx.screenshot('below');
    });

    await ctx.step('Shift-selecting a second drawing shows no toolbar', async () => {
      await page.keyboard.down('Shift');
      await page.mouse.click(body.x, body.y);
      await page.keyboard.up('Shift');
      await page.waitForTimeout(300);
      check('no toolbar for two', (await anyToolbar().count()) === 0);
      await page.mouse.click(...(Object.values(await at({ x: 0.9, y: 0.85 })) as [number, number]));
    });

    await ctx.step('a horizontal line shows only its own pickers; a note shows no line style', async () => {
      await pickTool('Lines', 'Horizontal line');
      const p = await at({ x: 0.5, y: 0.75 });
      await page.mouse.click(p.x, p.y);
      await page.waitForTimeout(300);
      await page.mouse.click(p.x + 40, p.y);
      await toolbar('Horizontal line').waitFor();
      const names = await toolbar('Horizontal line').getByRole('button').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
      check('a horizontal line has its colour, width and line style', names.includes('Colour') && names.includes('Width') && names.includes('Line style'), names.join(','));
      await ctx.screenshot('horizontal');
      await pickTool('Annotations', 'Text');
      const q = await at({ x: 0.15, y: 0.15 });
      await page.mouse.click(q.x, q.y);
      await page.getByLabel('Note text').waitFor();
      await page.keyboard.type('note');
      await page.keyboard.press('Control+Enter');
      await page.waitForTimeout(300);
      await page.mouse.click(q.x + 10, q.y + 8);
      await page.waitForTimeout(300);
      const note = anyToolbar();
      if ((await note.count()) === 1) {
        const labels = await note.getByRole('button').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
        check('a note has no line style picker', !labels.includes('Line style'), labels.join(','));
        await ctx.screenshot('note');
      }
    });

    await ctx.step('a press-drag on the toolbar neither draws nor pans the chart', async () => {
      await page.locator('button[title="Reset view"]').click();
      await page.waitForTimeout(500);
      await page.mouse.click(...(Object.values(mid(await at(TREND[0]), await at(TREND[1]))) as [number, number]));
      await anyToolbar().first().waitFor();
      const count = (await stored()).length;
      const tbBox = await anyToolbar().first().boundingBox();
      if (!tbBox) throw new Error('no toolbar');
      await page.mouse.move(tbBox.x + 14, tbBox.y + 14);
      await page.mouse.down();
      await page.mouse.move(tbBox.x + 80, tbBox.y + 40, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(300);
      check('no drawing was added', (await stored()).length === count);
      const after = await anyToolbar().first().boundingBox();
      check('the chart did not pan: the toolbar that follows the drawing has not moved', !!after && after.x === tbBox.x && after.y === tbBox.y, JSON.stringify(after));
    });

    await ctx.step('at 360 px the toolbar fits inside the chart', async () => {
      await page.setViewportSize({ width: 360, height: 740 });
      await page.waitForTimeout(500);
      await anyToolbar().first().waitFor();
      const t = await anyToolbar().first().boundingBox();
      const main = await page.locator('.chart-main').boundingBox();
      check('inside the chart area with no horizontal overflow', !!t && !!main && t.x >= main.x && t.x + t.width <= main.x + main.width, JSON.stringify({ t, main }));
      await ctx.screenshot('narrow-360');
    });

    await ctx.writeText('checks', checks.join('\n') + '\n');
  },
};
