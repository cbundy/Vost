import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { FakeUpstream } from '../fake-upstream/index.ts';

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
  /** The fake market-data service the server is pointed at; `stop()` and `start()` take it down and bring it back. */
  upstream: Pick<FakeUpstream, 'stop' | 'start' | 'requests'>;
  /** Every URL the browser requested so far (http, https, ws and wss; not data: or blob:), in order, repeats included. */
  requests: readonly string[];
  /** Writes `<scenario>-<name>-<viewport>.txt` and returns its path. */
  writeText(name: string, text: string): Promise<string>;
}

export interface Scenario {
  name: string;
  description: string;
  /** Record a WebM (desktop size only). */
  video?: boolean;
  viewports?: ViewportName[];
  /** Viewports that emulate a touch device (a touchscreen, mobile mode); the others use a mouse. */
  touch?: ViewportName[];
  /** Seed the prefs once per page load only when none are saved yet, so a reload keeps what the page saved. */
  keepPrefs?: boolean;
  run(ctx: ScenarioContext): Promise<void>;
}

export class StepError extends Error {}

export interface RunOptions {
  browser: Browser;
  baseUrl: string;
  outDir: string;
  scenario: Scenario;
  viewport: ViewportName;
  upstream: FakeUpstream;
}

/** Runs one scenario at one viewport in a fresh context; returns the files written. */
export async function runScenario(opts: RunOptions): Promise<string[]> {
  const { browser, baseUrl, outDir, scenario, viewport, upstream } = opts;
  await mkdir(outDir, { recursive: true });
  const size = VIEWPORTS[viewport];
  const recording = scenario.video === true;
  const videoDir = path.join(outDir, '.video-tmp');
  const context: BrowserContext = await browser.newContext({
    viewport: size,
    baseURL: baseUrl,
    ...(scenario.touch?.includes(viewport) ? { hasTouch: true, isMobile: true } : {}),
    ...(recording ? { recordVideo: { dir: videoDir, size } } : {}),
  });
  context.setDefaultTimeout(ACTION_TIMEOUT_MS);
  context.setDefaultNavigationTimeout(ACTION_TIMEOUT_MS);
  const origin = new URL(baseUrl).host;
  const aborted: string[] = [];
  const requests: string[] = [];
  const isLocal = (url: URL): boolean => url.host === origin;
  // A capture must never depend on the network: only the local server is reachable, and anything else fails the run.
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
    requests.push(url.href);
    if (isLocal(url)) return route.continue();
    aborted.push(url.href);
    return route.abort();
  });
  // Routes above see HTTP only: a browser websocket to another host is caught here.
  await context.routeWebSocket(/.*/, (ws) => {
    const url = new URL(ws.url());
    requests.push(url.href);
    if (isLocal(url)) {
      ws.connectToServer();
      return;
    }
    aborted.push(url.href);
    void ws.close();
  });
  await context.addInitScript((keep) => {
    if (keep && localStorage.getItem('vost.prefs.v1')) return;
    // A saved layout wins over prefs.v1 for the charts: seeding the prefs starts from a single chart again.
    localStorage.removeItem('vost.layout.v1');
    localStorage.removeItem('vost.savedLayouts.v1');
    localStorage.setItem(
      'vost.prefs.v1',
      JSON.stringify({ providerId: 'demo', symbol: 'DEMO', timeframe: '1d' }),
    );
  }, scenario.keepPrefs === true);
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
    upstream,
    requests,
    async writeText(name, text) {
      const file = path.join(outDir, `${[scenario.name, name, viewport].join('-')}.txt`);
      await writeFile(file, text);
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
    if (aborted.length) console.error(`e2e:capture: aborted non-local requests: ${[...new Set(aborted)].join(', ')}`);
    throw err;
  } finally {
    await context.close();
  }
  if (aborted.length) {
    const urls = [...new Set(aborted)];
    throw new StepError(`scenario "${scenario.name}" failed: the browser requested ${urls.length} URL(s) outside the Vost server: ${urls.join(', ')}`);
  }
  if (video) {
    const dest = path.join(outDir, `${scenario.name}.webm`);
    await rename(await video.path(), dest);
    written.push(dest);
  }
  return written;
}
