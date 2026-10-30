import type { Scenario } from '../scenario.ts';

const STORED = `(() => {
  const raw = localStorage.getItem('vost.drawings.v2');
  const all = raw ? JSON.parse(raw).sources : {};
  return all['demo:DEMO'] ?? [];
})()`;

type Stored = { id: string; tool: string; anchors: { time: number; price: number }[]; glyph?: string; style?: Record<string, unknown> };

const GROUP = 'Icons';

export const drawingIcons: Scenario = {
  name: 'drawing-icons',
  touch: ['narrow'],
  keepPrefs: true,
  description:
    'Icons, Emojis and Stickers: open the Icons picker, search "arrow", pick one and see it follow the pointer, place it; pick an emoji from a category tab; pick a sticker, then another from the Recent row; drag a corner to resize and the rotation handle with Shift to rotate (snapped to 15 degrees); restyle opacity and colour in the settings, undo and redo; reload and change the timeframe; at 390 px the picker fits the screen and a tap places an item',
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
    const of = async (tool: string) => (await stored()).find((d) => d.tool === tool);
    const box = async () => {
      const b = await page.locator('.chart-container').boundingBox();
      if (!b) throw new Error('chart container has no box');
      return b;
    };
    const at = async (f: { x: number; y: number }) => {
      const b = await box();
      return { x: b.x + b.width * f.x, y: b.y + b.height * f.y };
    };
    const rail = page.getByRole('toolbar', { name: 'Drawing tools' });
    const menuBtn = page.getByRole('button', { name: 'Drawing tools', exact: true });
    const menu = page.getByRole('group', { name: 'Drawing tools menu' });
    const dialog = page.getByRole('dialog');
    const search = page.getByRole('textbox', { name: /^Search / });

    const pickTool = async (label: string) => {
      if (narrow) {
        await menuBtn.tap();
        // The family's heading and its Icons tool share a name: open the family by its heading, then pick inside its body.
        const body = menu.locator('#menu-group-icons');
        if ((await body.count()) === 0) await menu.locator('button.menu-group-head', { hasText: GROUP }).tap();
        await body.getByRole('button', { name: label, exact: true }).tap();
        return;
      }
      await rail.getByRole('button', { name: `Open ${GROUP} tools`, exact: true }).click();
      await page.getByRole('menuitemradio', { name: label, exact: true }).click();
    };
    const choose = async (name: string) => {
      const cell = dialog.getByRole('button', { name, exact: true }).first();
      if (narrow) await cell.tap();
      else await cell.click();
      await dialog.waitFor({ state: 'hidden' });
    };
    const place = async (p: { x: number; y: number }) => {
      if (narrow) await page.touchscreen.tap(p.x, p.y);
      else {
        await page.mouse.move(p.x - 15, p.y - 15);
        await page.mouse.move(p.x, p.y, { steps: 3 });
        await page.mouse.click(p.x, p.y);
      }
    };
    const A = { x: 0.2, y: 0.3 };
    const B = { x: 0.45, y: 0.3 };
    const C = { x: 0.7, y: 0.4 };

    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();

    await ctx.step('Icons: the picker opens focused, search "arrow", pick one, it follows the pointer, a click places it', async () => {
      await pickTool('Icons');
      await dialog.waitFor();
      check('the search box has focus', await search.evaluate((el) => el === document.activeElement));
      await ctx.screenshot('picker');
      await search.fill('arrow');
      await dialog.getByRole('button', { name: 'arrow up', exact: true }).first().waitFor();
      const count = await dialog.locator('button[data-glyph]').count();
      check('the search narrows the grid to arrow icons', count > 3 && count < 80, String(count));
      await ctx.screenshot('search');
      await choose('arrow up');
      const p = await at(A);
      if (!narrow) {
        await page.mouse.move(p.x - 30, p.y - 30);
        await page.mouse.move(p.x, p.y, { steps: 4 });
        await ctx.screenshot('preview');
      }
      await place(p);
      const d = await of('icon');
      check('an icon is stored with its glyph id', d?.glyph === 'arrow-up' && (await stored()).length === 1, JSON.stringify(d));
    });

    await ctx.step('Emojis: a category tab, pick, place', async () => {
      await pickTool('Emojis');
      await dialog.waitFor();
      await dialog.getByRole('tab', { name: 'Animals and nature' }).click();
      await ctx.screenshot('emoji-category');
      const first = dialog.locator('.glyph-grid:not(.glyph-recent) button[data-glyph]').first();
      const name = (await first.getAttribute('aria-label')) ?? '';
      await choose(name);
      await place(await at(B));
      const d = await of('emoji');
      check('an emoji is stored', !!d?.glyph && (await stored()).length === 2, JSON.stringify(d));
    });

    await ctx.step('Stickers: pick, place, then pick another from the Recent row', async () => {
      await pickTool('Stickers');
      await dialog.waitFor();
      await search.fill('rocket');
      await choose('rocket');
      await place(await at(C));
      check('a sticker is stored', (await of('sticker'))?.glyph !== undefined, JSON.stringify(await of('sticker')));
      await pickTool('Stickers');
      await dialog.waitFor();
      const recent = dialog.locator('.glyph-recent button[data-glyph]');
      check('the Recent row holds the rocket', (await recent.count()) === 1 && (await recent.first().getAttribute('aria-label')) === 'rocket');
      await ctx.screenshot('recent');
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      check('Escape closes the picker and places nothing', (await stored()).length === 3);
    });

    if (!narrow) {
      await ctx.step('keyboard: arrows move through the grid, Enter picks', async () => {
        await pickTool('Emojis');
        await dialog.waitFor();
        await search.fill('heart');
        await page.keyboard.press('ArrowDown');
        const firstFocused = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.glyph ?? '');
        await page.keyboard.press('ArrowRight');
        const secondFocused = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.glyph ?? '');
        check('Down enters the grid and Right moves on', !!firstFocused && !!secondFocused && firstFocused !== secondFocused, `${firstFocused} -> ${secondFocused}`);
        await page.keyboard.press('Enter');
        await dialog.waitFor({ state: 'hidden' });
        await page.keyboard.press('Escape'); // leaves the armed emoji unplaced
      });

      const c = await at(C);
      await ctx.step('select the sticker and drag a corner: it grows about its centre; one undo step', async () => {
        await page.mouse.click(c.x, c.y);
        const before = (await of('sticker'))!.style?.size;
        check('a default sticker has no size of its own yet', before === undefined, String(before));
        await page.mouse.move(c.x + 40, c.y + 40);
        await page.mouse.down();
        await page.mouse.move(c.x + 60, c.y + 60, { steps: 4 });
        await page.mouse.move(c.x + 80, c.y + 80, { steps: 4 });
        await page.mouse.up();
        const size = (await of('sticker'))!.style?.size as number;
        check('the size follows the corner (about 160)', Math.abs(size - 160) < 12, String(size));
        await ctx.screenshot('resized');
        await page.keyboard.press('Control+z');
        check('one undo restores the size', (await of('sticker'))!.style?.size === undefined);
        await page.keyboard.press('Control+Shift+z');
        check('redo applies it again', Math.abs(((await of('sticker'))!.style?.size as number) - 160) < 12);
      });

      await ctx.step('drag the rotation handle with Shift: the angle snaps to 15 degrees', async () => {
        const size = (await of('sticker'))!.style!.size as number;
        const handle = { x: c.x, y: c.y - size / 2 - 24 };
        await page.mouse.move(handle.x, handle.y);
        await page.mouse.down();
        const to = { x: c.x + 120 * Math.sin((38 * Math.PI) / 180), y: c.y - 120 * Math.cos((38 * Math.PI) / 180) };
        await page.keyboard.down('Shift');
        await page.mouse.move(to.x, to.y, { steps: 6 });
        await page.mouse.up();
        await page.keyboard.up('Shift');
        const angle = (await of('sticker'))!.style?.angle;
        check('the angle is 45 (38 snapped)', angle === 45, String(angle));
        await ctx.screenshot('rotated');
      });

      await ctx.step('settings: Size, Angle, Opacity; undo and redo as one step', async () => {
        await page.mouse.dblclick(c.x, c.y);
        await dialog.waitFor();
        check('titled for the tool', (await dialog.getByRole('heading').textContent()) === 'Stickers settings');
        check('Angle shows 45', (await dialog.getByLabel('Angle', { exact: true }).inputValue()) === '45');
        check('a sticker has no Colour', (await dialog.getByLabel('Colour', { exact: true }).count()) === 0);
        await dialog.getByLabel('Opacity', { exact: true }).fill('0.5');
        await ctx.screenshot('dialog');
        await dialog.getByRole('button', { name: 'OK' }).click();
        await dialog.waitFor({ state: 'hidden' });
        check('opacity stored', (await of('sticker'))!.style?.opacity === 0.5);
        await page.keyboard.press('Control+z');
        check('undo reverts the opacity alone', (await of('sticker'))!.style?.opacity === undefined && (await of('sticker'))!.style?.angle === 45);
        await page.keyboard.press('Control+Shift+z');
      });

      await ctx.step('the icon has a Colour', async () => {
        const a = await at(A);
        await page.mouse.dblclick(a.x, a.y);
        await dialog.waitFor();
        await dialog.getByLabel('Colour', { exact: true }).fill('#f59e0b');
        await dialog.getByRole('button', { name: 'OK' }).click();
        await dialog.waitFor({ state: 'hidden' });
        check('colour stored', (await of('icon'))!.style?.color === '#f59e0b');
        await page.mouse.click(a.x + 120, a.y + 160);
        await ctx.screenshot('placed');
      });
    }

    await ctx.step('reload keeps all three, then a timeframe change', async () => {
      const before = JSON.stringify(await stored());
      await page.reload();
      await ctx.waitForChart();
      await page.waitForTimeout(800);
      check('storage is unchanged', JSON.stringify(await stored()) === before);
      await ctx.screenshot('reloaded');
      if (!narrow) {
        await page.locator('select[title="Timeframe"]').selectOption('1h');
        await page.waitForTimeout(1500);
        check('the drawings are still stored after a timeframe change', JSON.stringify(await stored()) === before);
        await ctx.screenshot('timeframe');
      }
    });

    await ctx.writeText('checks', checks.join('\n') + '\n');
  },
};
