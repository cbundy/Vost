import type { Page } from 'playwright';
import type { Scenario } from '../scenario.ts';

// A script of about 40 lines: long enough that the unchanged runs fold into "N unchanged lines" bars.
const filler = (from: number, to: number): string =>
  Array.from({ length: to - from + 1 }, (_, i) => `plot(ta.sma(close, ${from + i}), "SMA ${from + i}")`).join('\n');
const base = `//@version=6
indicator("Demo", overlay=false)
len = input.int(14, "Length")
src = close
basis = ta.sma(src, len)
plot(basis, "Basis")
${filler(1, 12)}
plot(ta.rma(src, len), "RMA")
${filler(13, 24)}
plot(ta.ema(src, len), "EMA")
`;
// Code B: one in-line edit (len 14 -> 21, shown inside its line), one added line and one removed line (the last EMA plot,
// a red block); the rest is unchanged and folds.
const changed = base
  .replace('input.int(14,', 'input.int(21,')
  .replace('plot(ta.rma(src, len), "RMA")\n', 'plot(ta.rma(src, len), "RMA")\ndev = ta.stdev(src, len)\n')
  .replace('plot(ta.ema(src, len), "EMA")\n', '');

// A generated 1000-line script for the typing regression step.
const long = `//@version=6\nindicator("Long", overlay=false)\n${Array.from({ length: 997 }, (_, i) => `v${i} = ta.sma(close, ${(i % 50) + 2}) + ${i}`).join('\n')}\nplot(v0)\n`;
const longOther = long.replace('v1 = ta.sma', 'v1 = ta.ema').replace('v20 = ta.sma(close, 22) + 20\n', '');

/** Puts text in a pane with a real clipboard paste (the way a user fills it). */
async function fill(page: Page, label: string, text: string): Promise<void> {
  await page.evaluate((t) => navigator.clipboard.writeText(t), text);
  await page.getByRole('textbox', { name: label, exact: true }).click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+V');
}

export const compare: Scenario = {
  name: 'compare',
  description: 'Pine compare page (/compare): panes marked against a reference, count and reference controls, restored after reload, no market data',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page, viewport } = ctx;
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const summary = (label: string) => page.getByRole('region', { name: label, exact: true }).locator('.compare-summary');
    await ctx.step('open /compare', () => page.goto('/compare'));
    await page.getByRole('textbox', { name: 'Code A', exact: true }).waitFor();
    await ctx.step('title and reference', async () => {
      if ((await page.title()) !== 'Pine compare - Vost') throw new Error(`title: ${await page.title()}`);
      await page.getByRole('region', { name: 'Code A', exact: true }).locator('.compare-ref-tag').waitFor();
    });
    await ctx.screenshot('empty');
    await ctx.step('fill A and B', async () => {
      await fill(page, 'Code A', base);
      await fill(page, 'Code B', changed);
      await summary('Code B').getByText('3 differences').waitFor();
      await page.locator('.compare-pane:nth-child(2) .cm-inlineChangedLine').first().waitFor();
      await page.locator('.compare-pane:nth-child(2) .cm-deletedChunk .cm-deletedLine').first().waitFor();
    });
    await ctx.step('only the differences are shown: folds, inline edit', async () => {
      const b = page.locator('.compare-pane:nth-child(2)');
      await b.locator('.cm-collapsedLines').first().waitFor();
      if ((await b.locator('.cm-collapsedLines').count()) < 2) throw new Error('expected a fold around each change');
      // the in-line edit: removed text struck through next to the added text, no separate red block for it
      await b.locator('.cm-inlineChangedLine').first().waitFor();
      await b.locator('.cm-line .cm-deletedText').first().waitFor();
      if (!(await b.locator('.cm-inlineChangedLineGutter').count())) throw new Error('no inline change gutter marker');
      const gutter = await b.locator('.cm-inlineChangedLineGutter').first().evaluate((e) => getComputedStyle(e).backgroundColor);
      const green = await b.evaluate(() => {
        const d = document.createElement('i');
        d.style.backgroundColor = 'var(--green)';
        document.body.append(d);
        const c = getComputedStyle(d).backgroundColor;
        d.remove();
        return c;
      });
      if (gutter !== green) throw new Error(`inline change gutter is ${gutter}, not the app green ${green}`);
      const a = page.locator('.compare-pane:nth-child(1)');
      if (await a.locator('.cm-collapsedLines').count()) throw new Error('the reference pane must not fold');
    });
    await ctx.step('a fold opens with a click', async () => {
      const b = page.locator('.compare-pane:nth-child(2)');
      const folds = await b.locator('.cm-collapsedLines').count();
      const lines = await b.locator('.cm-line').count();
      await b.locator('.cm-collapsedLines').first().click();
      await page.waitForFunction(
        ([n, l]) => {
          const el = document.querySelector('.compare-pane:nth-child(2)')!;
          return el.querySelectorAll('.cm-collapsedLines').length === n - 1 && el.querySelectorAll('.cm-line').length > l;
        },
        [folds, lines],
      );
    });
    await ctx.screenshot('two');
    await ctx.step('four panes, C identical, D different', async () => {
      await page.getByLabel('Panes').selectOption('4');
      await fill(page, 'Code C', base);
      await fill(page, 'Code D', changed + 'plot(close)\n');
      await summary('Code C').getByText('Identical to Code A').waitFor();
      await summary('Code D').getByText(/differences/).waitFor();
      for (const n of [3, 4]) await page.locator(`.compare-pane:nth-child(${n}) .cm-collapsedLines`).first().waitFor();
    });
    await ctx.screenshot('four');
    await ctx.step('switch the reference to Code B', async () => {
      await page.getByLabel('Compare against').selectOption('1');
      await page.getByRole('region', { name: 'Code B', exact: true }).locator('.compare-ref-tag').waitFor();
      await summary('Code A').getByText('vs Code B').waitFor();
    });
    await ctx.screenshot('reference');
    await ctx.step('reload restores everything', async () => {
      await page.reload();
      await page.getByRole('textbox', { name: 'Code D', exact: true }).waitFor();
      await page.getByRole('region', { name: 'Code B', exact: true }).locator('.compare-ref-tag').waitFor();
      if ((await page.getByLabel('Panes').inputValue()) !== '4') throw new Error('count not restored');
      const a = await page.getByRole('textbox', { name: 'Code A', exact: true }).innerText();
      if (!a.includes('indicator("Demo"')) throw new Error('Code A text not restored');
      await summary('Code C').getByText(/differences/).waitFor();
      await page.locator('.compare-pane:nth-child(3) .cm-collapsedLines').first().waitFor();
    });
    await ctx.screenshot('reloaded');
    await ctx.step('typing stays smooth with a long script in four panes', async () => {
      await page.getByLabel('Compare against').selectOption('0');
      for (const l of ['Code C', 'Code D']) await page.getByRole('region', { name: l, exact: true }).getByRole('button', { name: 'Clear' }).click();
      await fill(page, 'Code A', long);
      await fill(page, 'Code B', longOther);
      await summary('Code C').getByText('Empty').waitFor();
      await summary('Code B').getByText('2 differences').waitFor();
      // the summary can show before the last diff rebuild has drawn, and a reference edit lands after 200 ms: let both settle
      await page.waitForTimeout(600);
      const chunk = await page.locator('.compare-pane:nth-child(2) .cm-deletedChunk .cm-deletedLine').first().elementHandle();
      if (!chunk) throw new Error('Code B shows no removed line');
      await page.evaluate(() => {
        const w = window as unknown as { longTasks: number[] };
        w.longTasks = [];
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) w.longTasks.push(Math.round(e.duration));
        }).observe({ type: 'longtask', buffered: false });
      });
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
      const report: string[] = [];
      let tasks: number[] = [];
      try {
        for (const label of ['Code A', 'Code B']) {
          await page.getByRole('textbox', { name: label, exact: true }).click();
          await page.keyboard.press('Control+End');
          await page.waitForTimeout(300);
          await page.evaluate(() => ((window as unknown as { longTasks: number[] }).longTasks.length = 0));
          await page.keyboard.type('plot(close) // x', { delay: 60 });
          await page.keyboard.type('1234', { delay: 60 });
          await page.waitForTimeout(500);
          const got = await page.evaluate(() => (window as unknown as { longTasks: number[] }).longTasks.slice());
          report.push(`typing 20 characters in ${label} at 6x CPU throttling: ${got.length} long tasks, durations ms: ${got.join(', ') || 'none'}`);
          tasks = tasks.concat(got.slice(1));
          // Code B was not scrolled while typing in Code A, so its removed-line block must be the very same element
          // (the diff was updated in place, not rebuilt); after typing in Code B itself it may have scrolled out of view.
          if (label === 'Code A' && viewport === 'desktop' && !(await chunk.evaluate((e) => e.isConnected))) throw new Error('the removed-line block in Code B was rebuilt while typing in Code A');
        }
      } finally {
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      }
      await ctx.writeText('typing', report.join('\n') + '\n');
      const worst = Math.max(0, ...tasks);
      // The longtask API reports only tasks of 50 ms or more, so an unloaded run shows few and a noisy machine shows the odd
      // 50 to 70 ms one; the broken code ran 25 tasks of 50 to 230 ms (3 s in all). The narrow layout stacks the panes in a tall
      // page where a task of up to 90 ms was seen.
      const limit = viewport === 'desktop' ? 75 : 120;
      if (worst > limit) throw new Error(`a long task of ${worst} ms while typing (limit ${limit} ms after the first): ${report.join(' | ')}`);
      await summary('Code B').getByText('2 differences').waitFor();
    });
    await ctx.step('no horizontal page scroll', async () => {
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (over > 0) throw new Error(`page scrolls horizontally by ${over}px at ${viewport}`);
    });
    await ctx.step('no market data or sockets requested', async () => {
      const bad = ctx.requests.filter((u) => {
        const url = new URL(u);
        return url.protocol.startsWith('ws') || url.pathname.startsWith('/api/');
      });
      await ctx.writeText('requests', ctx.requests.join('\n') + '\n');
      if (bad.length) throw new Error(`the compare page requested ${bad.join(', ')}`);
    });
  },
};
