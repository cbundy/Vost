import type { Scenario } from '../scenario.ts';

const STORED = `(() => {
  const raw = localStorage.getItem('vost.drawings.v2');
  const all = raw ? JSON.parse(raw).sources : {};
  return all['demo:DEMO'] ?? [];
})()`;

type Stored = { id: string; tool: string; anchors: { time: number; price: number }[]; text?: string; style?: Record<string, unknown> };

const GROUP = 'Annotations';
const LONG = 'a long third line that has to wrap onto more than one line inside the box';

export const drawingText: Scenario = {
  name: 'drawing-text',
  touch: ['narrow'],
  keepPrefs: true,
  description:
    'Text and Anchored text: type a three-line note (Enter adds a line, Ctrl+Enter commits) that wraps in the editor, restyle it on the Text tab (bold, centred; one undo step), place Anchored text and check it keeps its spot on the pane through a pan, a zoom and a timeframe change, drag it and read X %/Y % on the Coordinates tab, undo, redo and reload; at 360 px both are typed with touch',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page } = ctx;
    const checks: string[] = [];
    const check = (label: string, ok: boolean, detail = '') => {
      checks.push(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` - ${detail}` : ''}`);
      if (!ok) throw new Error(`check failed: ${label} ${detail}`);
    };
    const stored = async () => {
      await page.waitForTimeout(700);
      return (await page.evaluate(STORED)) as Stored[];
    };
    const box = async () => {
      const b = await page.locator('.chart-container').boundingBox();
      if (!b) throw new Error('chart container has no box');
      return b;
    };
    /** A canvas fraction; the canvas holds the price axis on its right, so x is scaled to stay in the plot. */
    const at = async (f: { x: number; y: number }) => {
      const b = await box();
      return { x: b.x + b.width * f.x * 0.7, y: b.y + b.height * f.y };
    };
    const narrow = ctx.viewport === 'narrow';
    const rail = page.getByRole('toolbar', { name: 'Drawing tools' });
    const menuBtn = page.getByRole('button', { name: 'Drawing tools', exact: true });
    const menu = page.getByRole('group', { name: 'Drawing tools menu' });
    const input = page.getByLabel('Note text');
    const dialog = page.getByRole('dialog');
    const cursorAt = async (p: { x: number; y: number }) => {
      await page.mouse.move(p.x - 30, p.y - 30);
      await page.mouse.move(p.x, p.y, { steps: 4 });
      return page.locator('.chart-container').evaluate((el) => (el as HTMLElement).style.cursor);
    };

    /** Shift+double-click: a note's settings (a plain double-click edits its text). */
    const openSettings = async (x: number, y: number) => {
      await page.keyboard.down('Shift');
      await page.mouse.dblclick(x, y);
      await page.keyboard.up('Shift');
      await dialog.waitFor();
    };

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
    const place = async (label: string, f: { x: number; y: number }) => {
      await pickTool(label);
      const p = await at(f);
      if (narrow) await page.touchscreen.tap(p.x, p.y);
      else await page.mouse.click(p.x, p.y);
      await input.waitFor({ state: 'visible' });
      return p;
    };

    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();

    await ctx.step('Text: three lines with Enter, a long line wraps in the editor, Ctrl+Enter commits', async () => {
      await place('Text', { x: 0.1, y: 0.2 });
      check('the editor is a textarea', (await input.evaluate((el) => el.tagName)) === 'TEXTAREA');
      const one = (await input.boundingBox())!.height;
      await page.keyboard.type('first line');
      await page.keyboard.press('Enter');
      check('plain Enter keeps the editor open', (await input.count()) === 1);
      await page.keyboard.type('second line');
      await page.keyboard.press('Enter');
      await page.keyboard.type(LONG);
      const grown = (await input.boundingBox())!;
      check('the editor grew with its lines and wrapping', grown.height > one + 3 * 16 - 1, `${one} -> ${grown.height}`);
      check('it is as wide as the wrap width', Math.abs(grown.width - 252) <= 1, String(grown.width));
      check('it keeps the newlines', (await input.inputValue()) === `first line\nsecond line\n${LONG}`);
      await ctx.screenshot('typing');
      await page.keyboard.press('Control+Enter');
      const list = await stored();
      check('one text drawing stored with its newlines', list.length === 1 && list[0].tool === 'text' && list[0].text === `first line\nsecond line\n${LONG}`, JSON.stringify(list));
      check('the editor is gone', (await input.count()) === 0);
      await ctx.screenshot('text');
    });

    if (!narrow) {
      await ctx.step('Text tab: bold and centred, previewed, OK as one undo step', async () => {
        const p = await at({ x: 0.1, y: 0.2 });
        await openSettings(p.x + 20, p.y + 10);
        check('titled for the tool', (await dialog.getByRole('heading').textContent()) === 'Text settings');
        await dialog.getByRole('tab', { name: 'Text', exact: true }).click();
        const labels = await dialog.getByRole('tabpanel').locator('.ds-label').allTextContents();
        check('the Text tab holds every text setting', ['Text colour', 'Text size', 'Bold', 'Italic', 'Alignment', 'Wrap text', 'Wrap width'].every((l) => labels.includes(l)), labels.join(','));
        check('the Text tab has the textarea', (await dialog.getByLabel('Text', { exact: true }).count()) >= 1);
        await dialog.getByLabel('Bold').check();
        await dialog.getByLabel('Alignment').selectOption('center');
        check('nothing is stored before OK', (await stored())[0].style === undefined);
        await ctx.screenshot('text-tab');
        await dialog.getByRole('button', { name: 'OK' }).click();
        await dialog.waitFor({ state: 'hidden' });
        const s = (await stored())[0].style!;
        check('bold and centre stored', s.bold === true && s.align === 'center', JSON.stringify(s));
        await ctx.screenshot('text-styled');
        await page.keyboard.press('Control+z');
        check('one undo reverts both', (await stored())[0].style === undefined);
        await page.keyboard.press('Control+Shift+z');
        check('redo reapplies both', (await stored())[0].style?.align === 'center');
      });
    }

    const PIN = { x: 0.55, y: 0.45 };
    await ctx.step('Anchored text: place it, with a line of text', async () => {
      await place('Anchored text', PIN);
      await page.keyboard.type('pinned on the pane');
      await page.keyboard.press('Enter');
      await page.keyboard.type('second line');
      const wide = (await input.boundingBox())!.width;
      check('it does not wrap by default (wider than 252 px is not needed, narrower box follows the text)', wide < 252, String(wide));
      await page.keyboard.press('Control+Enter');
      const list = await stored();
      const d = list.find((x) => x.tool === 'anchoredText');
      check('stored as anchoredText, not text', !!d && list.length === 2 && list[0].tool === 'text', list.map((x) => x.tool).join(','));
      check('the anchor is pane fractions in 0..1', !!d && d.anchors[0].time > 0 && d.anchors[0].time < 1 && d.anchors[0].price > 0 && d.anchors[0].price < 1, JSON.stringify(d?.anchors));
      check('multi-line text kept', d?.text === 'pinned on the pane\nsecond line');
      await ctx.screenshot('anchored');
    });

    if (!narrow) {
      const spot = async () => {
        const b = await box();
        const a = (await stored()).find((x) => x.tool === 'anchoredText')!.anchors[0];
        return { a, x: b.x + b.width * a.time, y: b.y + b.height * a.price };
      };
      await ctx.step('pan, zoom and a timeframe change leave Anchored text where it was', async () => {
        const first = await spot();
        const b = await box();
        const y = b.y + b.height * 0.9;
        await page.mouse.move(b.x + b.width * 0.6, y);
        await page.mouse.down();
        await page.mouse.move(b.x + b.width * 0.3, y, { steps: 15 });
        await page.mouse.up();
        await page.waitForTimeout(300);
        check('the box still answers at its anchor after a pan', (await cursorAt({ x: first.x + 15, y: first.y + 10 })) === 'pointer');
        await ctx.screenshot('panned');
        await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.8);
        await page.mouse.wheel(0, -600);
        await page.waitForTimeout(400);
        check('and after a zoom', (await cursorAt({ x: first.x + 15, y: first.y + 10 })) === 'pointer');
        await ctx.screenshot('zoomed');
        await page.locator('select[title="Timeframe"]').selectOption('1h');
        await page.waitForTimeout(1500);
        check('and after a timeframe change', (await cursorAt({ x: first.x + 15, y: first.y + 10 })) === 'pointer');
        check('its stored anchor never changed', JSON.stringify((await spot()).a) === JSON.stringify(first.a));
        await ctx.screenshot('timeframe');
      });

      await ctx.step('drag it, read X %/Y % on the Coordinates tab, undo and redo', async () => {
        const before = await spot();
        const from = { x: before.x + 15, y: before.y + 10 };
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(from.x + 80, from.y + 40, { steps: 10 });
        await page.mouse.up();
        const after = await spot();
        check('it moved in pane space', after.a.time > before.a.time && after.a.price > before.a.price, `${JSON.stringify(before.a)} -> ${JSON.stringify(after.a)}`);
        await openSettings(after.x + 15, after.y + 10);
        await dialog.getByRole('tab', { name: 'Coordinates', exact: true }).click();
        const xs = Number(await dialog.getByLabel('Point 1 X %').inputValue());
        const ys = Number(await dialog.getByLabel('Point 1 Y %').inputValue());
        check('X % and Y % match the stored fractions', Math.abs(xs - after.a.time * 100) < 0.06 && Math.abs(ys - after.a.price * 100) < 0.06, `${xs}/${ys}`);
        check('no price or time fields', (await dialog.getByLabel('Point 1 price').count()) === 0 && (await dialog.getByLabel('Point 1 time').count()) === 0);
        await ctx.screenshot('coordinates');
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        await dialog.waitFor({ state: 'hidden' });
        await page.keyboard.press('Control+z');
        check('undo puts it back', JSON.stringify((await spot()).a) === JSON.stringify(before.a));
        await page.keyboard.press('Control+Shift+z');
        check('redo moves it again', JSON.stringify((await spot()).a) === JSON.stringify(after.a));
      });
    }

    await ctx.step('reload keeps both notes, with their lines', async () => {
      const before = JSON.stringify(await stored());
      await page.reload();
      await ctx.waitForChart();
      await page.waitForTimeout(500);
      check('storage is unchanged', JSON.stringify(await stored()) === before);
      const list = await stored();
      check('both tools and their text survived', list.length === 2 && list[0].text!.split('\n').length === 3 && list[1].text!.split('\n').length === 2);
      const b = await box();
      const a = list[1].anchors[0];
      check('Anchored text still answers at its spot', (await cursorAt({ x: b.x + b.width * a.time + 15, y: b.y + b.height * a.price + 10 })) === 'pointer');
      await ctx.screenshot('reloaded');
    });

    await ctx.writeText('checks', checks.join('\n') + '\n');
  },
};
