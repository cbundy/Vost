import type { Page } from 'playwright';
import type { Scenario } from '../scenario.ts';

interface Layout {
  scrollWidth: number;
  innerWidth: number;
  topbarHeight: number;
  clipped: string[];
  chartHeight: number;
  clockInside: boolean;
  collapseInside: boolean;
  dock: { height: number; bottom: number };
  innerHeight: number;
  scrollHeight: number;
  clientHeight: number;
  hasMore: boolean;
  hasSidebarSplitter: boolean;
  sidebarVisible: boolean;
}

async function layout(page: Page): Promise<Layout> {
  return page.evaluate(() => {
    const W = innerWidth;
    const clipped: string[] = [];
    for (const sel of ['.topbar', '.dock-tabs', '.app-body', '.dock', '.modal', '.sidebar.drawer', '.topbar-more-pop']) {
      for (const root of document.querySelectorAll(sel)) {
        for (const e of [root, ...root.querySelectorAll('*')]) {
          // a scroller's content may extend past its own box; only boxes that are not inside one count
          const r = e.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          let inScroller = false;
          for (let p = e.parentElement; p && p !== root.parentElement; p = p.parentElement) {
            const o = getComputedStyle(p).overflowX;
            if (o === 'auto' || o === 'scroll' || o === 'hidden') {
              inScroller = true;
              break;
            }
          }
          if (inScroller && e !== root) continue;
          if (r.right > W + 1 || r.left < -1) clipped.push(`${sel} ${e.tagName.toLowerCase()}.${(e as HTMLElement).className} right=${Math.round(r.right)}`);
        }
      }
    }
    const inside = (q: string) => {
      const e = document.querySelector(q);
      if (!e) return false;
      const r = e.getBoundingClientRect();
      return r.left >= 0 && r.right <= W + 0.5 && r.top >= 0 && r.bottom <= innerHeight + 0.5;
    };
    const dock = document.querySelector('.dock')!.getBoundingClientRect();
    const sb = document.querySelector('.sidebar');
    return {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: W,
      topbarHeight: Math.round(document.querySelector('.topbar')!.getBoundingClientRect().height),
      clipped,
      chartHeight: Math.round(document.querySelector('.chart-container')!.getBoundingClientRect().height),
      clockInside: inside('.zone-clock-btn'),
      collapseInside: inside('.dock-tabs > button[title="Collapse"], .dock-tabs > button[title="Expand"]'),
      dock: { height: Math.round(dock.height), bottom: Math.round(dock.bottom) },
      innerHeight,
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
      hasMore: document.querySelector('.topbar-more') != null,
      hasSidebarSplitter: document.querySelector('[aria-label="Resize sidebar"]') != null,
      sidebarVisible: sb != null && sb.getBoundingClientRect().width > 0,
    };
  });
}

const CSV = ['time,open,high,low,close,volume', ...Array.from({ length: 12 }, (_, i) => `2024-01-${String(i + 1).padStart(2, '0')},10,12,9,11,1000`)].join('\n');

export const responsive: Scenario = {
  name: 'responsive',
  description: 'Layout at phone, tablet and desktop sizes: no overflow, the sidebar drawer, the top bar More menu, the dock tab strip and both dialogs',
  viewports: ['desktop'],
  async run(ctx) {
    const { page } = ctx;
    const log: string[] = [];
    const sizes: Array<[number, number]> = [[360, 740], [768, 1024], [1024, 768], [1920, 1080], [740, 360], [1281, 800], [1280, 800], [1440, 900]];

    const check = (label: string, opts: { chart?: boolean } = {}) =>
      ctx.step(`check ${label}`, async () => {
        await page.waitForTimeout(250);
        const l = await layout(page);
        log.push(`${label}: scrollWidth=${l.scrollWidth}/${l.innerWidth} topbar=${l.topbarHeight} chartH=${l.chartHeight} dock=${l.dock.height} more=${l.hasMore} clipped=${l.clipped.length}`);
        if (l.scrollWidth > l.innerWidth) throw new Error(`${label}: horizontal overflow ${l.scrollWidth} > ${l.innerWidth}`);
        if (l.clipped.length) throw new Error(`${label}: past the viewport: ${l.clipped.slice(0, 3).join('; ')}`);
        if (l.topbarHeight !== 48) throw new Error(`${label}: top bar is ${l.topbarHeight}px tall`);
        if (l.scrollHeight > l.clientHeight) throw new Error(`${label}: vertical overflow ${l.scrollHeight} > ${l.clientHeight}`);
        if (opts.chart !== false) {
          if (l.chartHeight < 200) throw new Error(`${label}: chart is ${l.chartHeight}px tall`);
          if (!l.clockInside) throw new Error(`${label}: zone clock not fully visible`);
          if (!l.collapseInside) throw new Error(`${label}: dock collapse button not fully visible`);
        }
        return l;
      });
    const expect = (cond: boolean, msg: string) => {
      if (!cond) throw new Error(msg);
    };

    await ctx.step('open app', () => page.goto('/'));
    await ctx.waitForChart();

    for (const [w, h] of sizes) {
      await ctx.step(`resize ${w}x${h}`, () => page.setViewportSize({ width: w, height: h }));
      const l = await check(`${w}x${h}`);
      if (w <= 900) {
        expect(!l.sidebarVisible && !l.hasSidebarSplitter, `${w}x${h}: sidebar or splitter shown in drawer mode`);
      } else {
        expect(l.sidebarVisible && l.hasSidebarSplitter, `${w}x${h}: desktop sidebar or splitter missing`);
      }
      if (w > 1280) expect(!l.hasMore, `${w}x${h}: More button present on a wide screen`);
      else expect(l.hasMore, `${w}x${h}: More button missing`);
      if (w === 360 || w === 768 || w === 1024 || w === 1920 || w === 740) await ctx.screenshot(`${w}x${h}`);
    }

    const toggle = page.getByRole('button', { name: 'Toggle sidebar' });
    const drawer = page.getByRole('dialog', { name: 'Sidebar' });
    const focusInfo = () =>
      page.evaluate(() => {
        const a = document.activeElement;
        const d = document.querySelector('.sidebar.drawer');
        return { label: a?.getAttribute('aria-label') ?? null, inDrawer: !!(d && a && d.contains(a)), isToggle: a?.getAttribute('aria-label') === 'Toggle sidebar' };
      });

    for (const [w, h] of [[360, 740], [768, 1024]] as const) {
      await ctx.step(`drawer at ${w}x${h}`, async () => {
        await page.setViewportSize({ width: w, height: h });
        await page.waitForTimeout(250);
        expect((await drawer.count()) === 0, 'drawer present at load');
        expect((await toggle.getAttribute('aria-expanded')) === 'false', 'toggle not collapsed at load');
        expect((await toggle.getAttribute('aria-controls')) === 'sidebar', 'toggle has no aria-controls');
        await toggle.click();
        await drawer.waitFor({ state: 'visible' });
        expect((await drawer.getAttribute('aria-modal')) === 'true', 'drawer is not aria-modal');
        expect((await toggle.getAttribute('aria-expanded')) === 'true', 'toggle not expanded');
        expect((await focusInfo()).label === 'Close sidebar', 'focus did not move to the close button');
      });
      await ctx.screenshot(`drawer-${w}`);
      await check(`drawer-${w}`);
      await ctx.step(`Tab stays in the drawer at ${w}`, async () => {
        for (let i = 0; i < 30; i++) {
          await page.keyboard.press(i % 2 ? 'Shift+Tab' : 'Tab');
          expect((await focusInfo()).inDrawer, `focus left the drawer on Tab ${i + 1}`);
        }
        for (let i = 0; i < 30; i++) {
          await page.keyboard.press('Tab');
          expect((await focusInfo()).inDrawer, `focus left the drawer on forward Tab ${i + 1}`);
        }
        for (let i = 0; i < 30; i++) {
          await page.keyboard.press('Shift+Tab');
          expect((await focusInfo()).inDrawer, `focus left the drawer on Shift+Tab ${i + 1}`);
        }
      });
      await ctx.step(`Escape closes it at ${w}`, async () => {
        await page.keyboard.press('Escape');
        await drawer.waitFor({ state: 'detached' });
        expect((await focusInfo()).isToggle, 'focus is not back on the toggle');
        await page.keyboard.press('Escape');
        expect((await drawer.count()) === 0, 'Escape on a closed drawer did something');
      });
      await ctx.step(`backdrop closes it at ${w}`, async () => {
        await toggle.click();
        await drawer.waitFor({ state: 'visible' });
        await page.mouse.click(w - 4, h - 4);
        await drawer.waitFor({ state: 'detached' });
        expect((await focusInfo()).isToggle, 'focus is not back on the toggle after the backdrop');
      });
      await ctx.step(`close button closes it at ${w}`, async () => {
        await toggle.click();
        await drawer.waitFor({ state: 'visible' });
        await page.getByRole('button', { name: 'Close sidebar' }).click();
        await drawer.waitFor({ state: 'detached' });
        expect((await focusInfo()).isToggle, 'focus is not back on the toggle after the close button');
      });
    }

    await ctx.step('Import CSV from the drawer closes it first', async () => {
      await page.setViewportSize({ width: 360, height: 740 });
      await toggle.click();
      await drawer.waitFor({ state: 'visible' });
      await drawer.getByRole('button', { name: 'Import CSV' }).click();
      await page.getByRole('heading', { name: /Import/ }).first().waitFor();
      expect((await drawer.count()) === 0, 'drawer still open behind the modal');
      await page.keyboard.press('Escape');
      await page.locator('.modal').waitFor({ state: 'detached' });
    });

    // 360x740: the More menu
    const more = page.getByRole('button', { name: 'More', exact: true });
    await ctx.step('More menu at 360', async () => {
      await page.setViewportSize({ width: 360, height: 740 });
      await page.waitForTimeout(250);
      expect((await more.getAttribute('aria-haspopup')) === 'dialog', 'More has no aria-haspopup');
      await more.click();
      const pop = page.getByRole('dialog', { name: 'More' });
      await pop.waitFor({ state: 'visible' });
      const b = (await pop.boundingBox())!;
      expect(b.x >= 0 && b.x + b.width <= 360 && b.y + b.height <= 740, `menu outside the viewport: ${JSON.stringify(b)}`);
      expect((await more.getAttribute('aria-expanded')) === 'true', 'More not expanded');
      // each moved control exists once
      for (const name of ['Provider', 'Number of bars']) expect((await page.getByLabel(name, { exact: true }).count()) === 1, `${name} select is not unique`);
      expect((await page.getByRole('button', { name: 'Range', exact: true }).count()) === 1, 'Range is not unique');
      await check('more-360');
    });
    await ctx.screenshot('more-360');
    await ctx.step('Range panel from the menu stays inside', async () => {
      await page.getByRole('button', { name: 'Range', exact: true }).click();
      const panel = page.getByRole('dialog', { name: 'Chart range' });
      await panel.waitFor({ state: 'visible' });
      const b = (await panel.boundingBox())!;
      expect(b.x >= 0 && b.x + b.width <= 360 && b.y + b.height <= 740, `range panel outside the viewport: ${JSON.stringify(b)}`);
      await check('range-from-more-360');
    });
    await ctx.screenshot('range-360');
    await ctx.step('Escape closes the menu and refocuses More', async () => {
      await page.keyboard.press('Escape');
      await page.getByRole('dialog', { name: 'More' }).waitFor({ state: 'detached' });
      expect(await more.evaluate((e) => e === document.activeElement), 'focus is not on More');
    });
    await ctx.step('outside click closes the menu', async () => {
      await more.click();
      await page.getByRole('dialog', { name: 'More' }).waitFor({ state: 'visible' });
      await page.mouse.click(180, 400);
      await page.getByRole('dialog', { name: 'More' }).waitFor({ state: 'detached' });
    });

    // dialogs at 360
    await ctx.step('CSV import dialog at 360', async () => {
      await more.click();
      await page.getByRole('button', { name: /Import CSV/ }).first().click();
      await page.locator('input[type=file]').setInputFiles({ name: 'sample.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
      await page.getByLabel('Dataset name').or(page.getByPlaceholder('My dataset')).first().waitFor();
      await page.waitForTimeout(250);
      const modal = (await page.locator('.modal').boundingBox())!;
      expect(modal.x >= 0 && modal.x + modal.width <= 360 && modal.y >= 0 && modal.y + modal.height <= 740, `CSV modal outside: ${JSON.stringify(modal)}`);
      const m = await page.evaluate(() => {
        const b = document.querySelector('.modal-body')!;
        const f = document.querySelector('.modal-foot');
        return { scrollable: b.scrollHeight >= b.clientHeight, foot: f ? f.getBoundingClientRect().bottom <= innerHeight : true, sw: document.documentElement.scrollWidth };
      });
      expect(m.foot && m.sw <= 360, `CSV modal overflows: ${JSON.stringify(m)}`);
      log.push(`csv-360: modal=${Math.round(modal.width)}x${Math.round(modal.height)} at ${Math.round(modal.x)},${Math.round(modal.y)}`);
      await check('csv-360', { chart: false });
    });
    await ctx.screenshot('csv-360');
    await ctx.step('close the CSV dialog', async () => {
      await page.keyboard.press('Escape');
      await page.locator('.modal').waitFor({ state: 'detached' });
    });
    await ctx.step('Inbox dialog at 360', async () => {
      await page.getByRole('button', { name: 'Inbox' }).click();
      await page.locator('.modal').waitFor({ state: 'visible' });
      await page.waitForTimeout(250);
      const modal = (await page.locator('.modal').boundingBox())!;
      expect(modal.x >= 0 && modal.x + modal.width <= 360 && modal.y + modal.height <= 740, `Inbox modal outside: ${JSON.stringify(modal)}`);
      log.push(`inbox-360: modal=${Math.round(modal.width)}x${Math.round(modal.height)}`);
      await check('inbox-360', { chart: false });
    });
    await ctx.screenshot('inbox-360');
    await ctx.step('close the Inbox', async () => {
      await page.keyboard.press('Escape');
      await page.locator('.modal').waitFor({ state: 'detached' });
    });

    // dock tabs scroll instead of spilling
    await ctx.step('dock tabs at 360 are icon-only and inside', async () => {
      const info = await page.evaluate(() => {
        const t = document.querySelector('.dock-tablist') as HTMLElement;
        const label = document.querySelector('.dock-tab-label')!.getBoundingClientRect();
        return { sw: t.scrollWidth, cw: t.clientWidth, labelW: label.width, name: document.querySelector('#dock-tab-backtest')!.textContent };
      });
      log.push(`dock-tablist: scrollWidth=${info.sw} clientWidth=${info.cw} labelWidth=${info.labelW}`);
      expect(info.labelW <= 1, 'tab label is visible at 360');
      expect(!!info.name && info.name.includes('Backtest'), 'tab label lost from the accessible name');
    });

    // resize with the drawer open
    await ctx.step('widening past 900 closes the drawer', async () => {
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.waitForTimeout(250);
      await page.getByRole('button', { name: 'Toggle sidebar' }).click();
      await drawer.waitFor({ state: 'visible' });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForTimeout(300);
      expect((await drawer.count()) === 0, 'drawer still open at 1440');
      const l = await layout(page);
      expect(l.sidebarVisible && l.hasSidebarSplitter, 'desktop sidebar missing after widening');
      await check('widened-1440');
    });
    await ctx.screenshot('widened-1440');
    await ctx.step('narrowing again starts closed', async () => {
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.waitForTimeout(250);
      expect((await drawer.count()) === 0, 'drawer open after narrowing');
    });

    await ctx.writeText('checks', `${log.join('\n')}\n`);
  },
};
