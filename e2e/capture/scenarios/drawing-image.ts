import { deflateSync } from 'node:zlib';
import type { Scenario } from '../scenario.ts';

const STORED = `(() => {
  const raw = localStorage.getItem('vost.drawings.v2');
  const all = raw ? JSON.parse(raw).sources : {};
  return all['demo:DEMO'] ?? [];
})()`;

/** How many records the picture store holds (-1 when it cannot be opened). */
const RECORDS = `new Promise((resolve) => {
  const open = indexedDB.open('vost-images');
  open.onerror = () => resolve(-1);
  open.onsuccess = () => {
    const db = open.result;
    if (!db.objectStoreNames.contains('images')) return resolve(0);
    const req = db.transaction('images').objectStore('images').count();
    req.onsuccess = () => { db.close(); resolve(req.result); };
  };
})`;

type Stored = { id: string; tool: string; anchors: { time: number; price: number }[]; image?: { key: string; w: number; h: number }; style?: Record<string, unknown> };

const GROUP = 'Annotations';

const CRC = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t.push(c >>> 0);
  }
  return t;
})();
const crc32 = (b: Buffer) => {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
/** A small PNG built here: a colour gradient with a white frame, so no binary is committed. */
function makePng(w: number, h: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // 8-bit RGB
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    for (let x = 0; x < w; x++) {
      const edge = x < 3 || y < 3 || x >= w - 3 || y >= h - 3;
      raw[row + 1 + x * 3] = edge ? 255 : Math.round((x / w) * 255);
      raw[row + 2 + x * 3] = edge ? 255 : Math.round((y / h) * 200);
      raw[row + 3 + x * 3] = edge ? 255 : 160;
    }
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export const drawingImage: Scenario = {
  name: 'drawing-image',
  touch: ['narrow'],
  keepPrefs: true,
  description:
    'Image: pick the tool and upload a generated PNG (and the same one again: one stored record), place it by a click at its natural size and by press-drag-release with a live preview, resize a corner with the ratio kept and with Shift, set opacity and a border in the settings, delete and undo (the picture returns), redo, copy and paste, reload and change the timeframe, refuse a 6 MB file and a text file renamed .png with their messages; at 390 px a tap places it and a reload keeps it',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page } = ctx;
    const checks: string[] = [];
    const check = (label: string, ok: boolean, detail = '') => {
      checks.push(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` - ${detail}` : ''}`);
      if (!ok) throw new Error(`check failed: ${label} ${detail}`);
    };
    const consoleErrors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
    page.on('pageerror', (e) => consoleErrors.push(String(e)));
    const narrow = ctx.viewport === 'narrow';
    const stored = async () => {
      await page.waitForTimeout(700);
      return (await page.evaluate(STORED)) as Stored[];
    };
    const records = () => page.evaluate(RECORDS) as Promise<number>;
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
    const dialog = page.getByRole('dialog');
    const toast = page.locator('.toast');

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
    /** Picks Image; the file chooser it opens is answered with `file`. */
    const pickImage = async (file: { name: string; mimeType: string; buffer: Buffer }) => {
      const chooser = page.waitForEvent('filechooser');
      await pickTool('Image');
      await (await chooser).setFiles(file);
      await page.waitForTimeout(300);
    };
    const png = { name: 'picture.png', mimeType: 'image/png', buffer: makePng(160, 100) };
    const tap = async (p: { x: number; y: number }) => (narrow ? page.touchscreen.tap(p.x, p.y) : page.mouse.click(p.x, p.y));
    const images = async () => (await stored()).filter((d) => d.tool === 'image');

    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();

    await ctx.step('Image: upload a picture and place it by a click at its natural size', async () => {
      await pickImage(png);
      check('nothing is stored before the click', (await images()).length === 0);
      check('the picture is in the store', (await records()) === 1);
      await tap(await at({ x: 0.1, y: 0.15 }));
      const list = await images();
      check('one image drawing with the natural size', list.length === 1 && list[0].image?.w === 160 && list[0].image?.h === 100, JSON.stringify(list));
      await ctx.screenshot('placed');
    });

    if (!narrow) {
      await ctx.step('the same file again stores one record; press-drag-release sets the box with a live preview', async () => {
        await pickImage(png);
        check('the same bytes are stored once', (await records()) === 1);
        const a = await at({ x: 0.5, y: 0.2 });
        await page.mouse.move(a.x, a.y);
        await page.mouse.down();
        await page.mouse.move(a.x + 120, a.y + 20, { steps: 6 });
        await ctx.screenshot('preview');
        await page.mouse.up();
        const list = await images();
        check('a second image drawing, same picture', list.length === 2 && list[0].image?.key === list[1].image?.key, JSON.stringify(list.map((d) => d.image)));
        await ctx.screenshot('dragged');
      });

      await ctx.step('a corner resize keeps the ratio; Shift frees it', async () => {
        const before = (await images())[1];
        const a = await at({ x: 0.5, y: 0.2 });
        // the second picture's bottom-right corner is a handle once it is selected
        const corner = { x: a.x + 120, y: a.y + 120 * (100 / 160) };
        await page.mouse.move(corner.x, corner.y);
        await page.mouse.down();
        await page.mouse.move(corner.x + 60, corner.y + 10, { steps: 5 });
        await page.mouse.up();
        const kept = (await images())[1];
        check('the anchors changed', JSON.stringify(kept.anchors) !== JSON.stringify(before.anchors));
        await ctx.screenshot('resized');
        await page.keyboard.down('Shift');
        const corner2 = { x: corner.x + 60, y: corner.y + 60 * (100 / 160) };
        await page.mouse.move(corner2.x, corner2.y);
        await page.mouse.down();
        await page.mouse.move(corner2.x, corner2.y + 80, { steps: 5 });
        await page.mouse.up();
        await page.keyboard.up('Shift');
        await ctx.screenshot('resized-free');
      });

      await ctx.step('settings: opacity and a border', async () => {
        const p = await at({ x: 0.1, y: 0.15 });
        await page.mouse.dblclick(p.x + 30, p.y + 20);
        await dialog.waitFor();
        check('titled for the tool', (await dialog.getByRole('heading').textContent()) === 'Image settings');
        await dialog.getByLabel('Opacity').fill('0.6');
        await dialog.getByLabel('Border width').fill('3');
        await ctx.screenshot('dialog');
        await dialog.getByRole('button', { name: 'OK' }).click();
        await dialog.waitFor({ state: 'hidden' });
        const first = (await images())[0];
        check('opacity and border stored', first.style?.borderWidth === 3, JSON.stringify(first.style));
        await ctx.screenshot('styled');
      });

      await ctx.step('delete then undo keeps the picture; redo, copy and paste', async () => {
        const p = await at({ x: 0.1, y: 0.15 });
        await page.mouse.click(p.x + 30, p.y + 20);
        await page.keyboard.press('Delete');
        check('deleted', (await images()).length === 1);
        await ctx.screenshot('deleted');
        await page.keyboard.press('Control+z');
        const back = await images();
        check('undo brings the picture drawing back', back.length === 2 && !!back[0].image?.key);
        await ctx.screenshot('undone');
        await page.keyboard.press('Control+Shift+z');
        check('redo deletes it again', (await images()).length === 1);
        await page.keyboard.press('Control+z');
        await page.mouse.click(p.x + 30, p.y + 20);
        await page.keyboard.press('Control+c');
        await page.keyboard.press('Control+v');
        const pasted = await images();
        check('paste adds a copy with the same picture', pasted.length === 3 && pasted[2].image?.key === pasted[0].image?.key, JSON.stringify(pasted.map((d) => d.image?.key.slice(0, 6))));
        check('still one stored record', (await records()) === 1);
        await ctx.screenshot('pasted');
      });

      await ctx.step('refusals: a 6 MB picture and a text file renamed .png add nothing', async () => {
        const before = (await images()).length;
        const big = Buffer.concat([makePng(8, 8), Buffer.alloc(6 * 1024 * 1024)]);
        await pickImage({ name: 'big.png', mimeType: 'image/png', buffer: big });
        await toast.first().waitFor();
        check('the 5 MB message shows', ((await toast.first().textContent()) ?? '').includes('5 MB'), (await toast.first().textContent()) ?? '');
        await ctx.screenshot('refused-big');
        await page.keyboard.press('Escape');
        await pickImage({ name: 'notes.png', mimeType: 'image/png', buffer: Buffer.from('this is plain text, not a picture') });
        await page.waitForTimeout(200);
        const texts = await toast.allTextContents();
        check('the type message shows', texts.some((t) => t.includes('Only PNG, JPEG, GIF or WebP pictures can be added.')), texts.join('|'));
        await ctx.screenshot('refused-type');
        await page.keyboard.press('Escape');
        check('nothing was added', (await images()).length === before && (await records()) === 1);
      });
    }

    await ctx.step('reload keeps the picture, then a timeframe change', async () => {
      await page.keyboard.press('Escape');
      const before = JSON.stringify(await stored());
      await page.reload();
      await ctx.waitForChart();
      await page.waitForTimeout(800);
      check('storage is unchanged', JSON.stringify(await stored()) === before);
      check('the picture store survived the reload', (await records()) === 1);
      await ctx.screenshot('reloaded');
      if (!narrow) {
        await page.locator('select[title="Timeframe"]').selectOption('1h');
        await page.waitForTimeout(1500);
        check('the pictures are still stored after a timeframe change', JSON.stringify(await stored()) === before);
        await ctx.screenshot('timeframe');
      }
    });

    check('no console error', consoleErrors.length === 0, consoleErrors.join(' | '));
    await ctx.writeText('checks', checks.join('\n') + '\n');
  },
};
