import { mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';

export type ViewportName = 'desktop' | 'narrow';

export const VIEWPORTS: Record<ViewportName, { width: number; height: number }> = {
  desktop: { width: 1440, height: 900 },
  narrow: { width: 390, height: 844 },
};

/** Fast failure: a missing selector must fail in about 10 s, not the 30 s default. */
const ACTION_TIMEOUT_MS = 10_000;

export interface ScenarioContext {
  page: Page;
  viewport: ViewportName;
  /** Runs fn; a failure is rethrown as `scenario "<name>" step "<label>" failed: <first line>`. */
  step<T>(label: string, fn: () => Promise<T>): Promise<T>;
  /** Writes `<scenario>-<name>-<viewport>.png` (or `<scenario>-<viewport>.png`) and returns its path. */
  screenshot(name?: string): Promise<string>;
  /** Waits for the chart canvas, the demo legend title and the web fonts. */
  waitForChart(): Promise<void>;
}

export interface Scenario {
  name: string;
  description: string;
  /** Record a WebM (desktop size only). */
  video?: boolean;
  viewports?: ViewportName[];
  run(ctx: ScenarioContext): Promise<void>;
}

export class StepError extends Error {}

export interface RunOptions {
  browser: Browser;
  baseUrl: string;
  outDir: string;
  scenario: Scenario;
  viewport: ViewportName;
}

/** Runs one scenario at one viewport in a fresh context; returns the files written. */
export async function runScenario(opts: RunOptions): Promise<string[]> {
  const { browser, baseUrl, outDir, scenario, viewport } = opts;
  await mkdir(outDir, { recursive: true });
  const size = VIEWPORTS[viewport];
  const recording = scenario.video === true;
  const videoDir = path.join(outDir, '.video-tmp');
  const context: BrowserContext = await browser.newContext({
    viewport: size,
    baseURL: baseUrl,
    ...(recording ? { recordVideo: { dir: videoDir, size } } : {}),
  });
  context.setDefaultTimeout(ACTION_TIMEOUT_MS);
  context.setDefaultNavigationTimeout(ACTION_TIMEOUT_MS);
  const origin = new URL(baseUrl).host;
  const aborted: string[] = [];
  // A capture must never depend on the network: only the local server is reachable.
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.host === origin || url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
    aborted.push(url.href);
    return route.abort();
  });
  await context.addInitScript(() => {
    localStorage.setItem(
      'vost.prefs.v1',
      JSON.stringify({ providerId: 'demo', symbol: 'DEMO', timeframe: '1d' }),
    );
  });
  const page = await context.newPage();
  const written: string[] = [];

  const step: ScenarioContext['step'] = async (label, fn) => {
    try {
      return await fn();
    } catch (err) {
      const first = (err instanceof Error ? err.message : String(err)).split('\n')[0];
      throw new StepError(`scenario "${scenario.name}" step "${label}" failed: ${first}`);
    }
  };
  const ctx: ScenarioContext = {
    page,
    viewport,
    step,
    async screenshot(name) {
      const file = path.join(outDir, `${[scenario.name, name, viewport].filter(Boolean).join('-')}.png`);
      await page.screenshot({ path: file });
      written.push(file);
      return file;
    },
    async waitForChart() {
      await step('wait for chart', async () => {
        await page.locator('.chart-container canvas').first().waitFor({ state: 'visible' });
        await page.locator('.chart-legend .legend-title', { hasText: 'DEMO' }).waitFor({ state: 'visible' });
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
      });
    },
  };

  const video = recording ? page.video() : null;
  try {
    await scenario.run(ctx);
  } catch (err) {
    if (aborted.length) console.error(`e2e:capture: aborted non-local requests: ${aborted.join(', ')}`);
    throw err;
  } finally {
    await context.close();
  }
  if (video) {
    const dest = path.join(outDir, `${scenario.name}.webm`);
    await rename(await video.path(), dest);
    written.push(dest);
  }
  return written;
}
