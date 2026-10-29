import type { Page } from 'playwright';
import type { Scenario } from '../scenario.ts';

const base = `//@version=6
indicator("Demo", overlay=false)
len = input.int(14, "Length")
src = close
basis = ta.sma(src, len)
plot(basis, "Basis")
plot(ta.ema(src, len), "EMA")
`;
// Code B: one changed line (len 14 -> 21), one added line, one removed line (the EMA plot).
const changed = `//@version=6
indicator("Demo", overlay=false)
len = input.int(21, "Length")
src = close
basis = ta.sma(src, len)
dev = ta.stdev(src, len)
plot(basis, "Basis")
`;

async function fill(page: Page, label: string, text: string): Promise<void> {
  await page.getByRole('textbox', { name: label, exact: true }).click();
  await page.keyboard.press('Control+A');
  // insertText avoids closeBrackets mangling typed text
  await page.keyboard.insertText(text);
}

export const compare: Scenario = {
  name: 'compare',
  description: 'Pine compare page (/compare): panes marked against a reference, count and reference controls, restored after reload, no market data',
  viewports: ['desktop', 'narrow'],
  async run(ctx) {
    const { page, viewport } = ctx;
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
      await page.locator('.compare-pane:nth-child(2) .cm-changedLine').first().waitFor();
      await page.locator('.compare-pane:nth-child(2) .cm-deletedChunk').first().waitFor();
    });
    await ctx.screenshot('two');
    await ctx.step('four panes, C identical, D different', async () => {
      await page.getByLabel('Panes').selectOption('4');
      await fill(page, 'Code C', base);
      await fill(page, 'Code D', changed + 'plot(close)\n');
      await summary('Code C').getByText('Identical to Code A').waitFor();
      await summary('Code D').getByText(/differences/).waitFor();
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
      if (!a.includes('input.int(14')) throw new Error('Code A text not restored');
      await summary('Code C').getByText(/differences/).waitFor();
    });
    await ctx.screenshot('reloaded');
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
