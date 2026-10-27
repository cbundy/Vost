// Evidence capture runner. See docs/e2e-visual-verification.md. Never run from CI or a gate.
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { rm } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import type { Browser } from 'playwright';
import { formatLaunchError } from './launch-error.ts';
import { StepError, runScenario } from './scenario.ts';
import { scenarios } from './scenarios/index.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function fail(msg: string): never {
  throw new Error(msg);
}

function usage(): string {
  const names = [...scenarios.values()].map((s) => `  ${s.name} - ${s.description}`).join('\n');
  return `usage: npm run e2e:capture -- <scenario> [<scenario>...] [--slug <slug>]\nknown scenarios:\n${names}`;
}

function parseArgs(argv: string[]): { names: string[]; slug?: string } {
  const names: string[] = [];
  let slug: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--slug') {
      slug = argv[++i];
      if (!slug || !/^[\w.-]+$/.test(slug)) fail(`--slug needs a simple name\n${usage()}`);
    } else names.push(argv[i]);
  }
  if (!names.length) fail(usage());
  const unknown = names.filter((n) => !scenarios.has(n));
  if (unknown.length) fail(`unknown scenario: ${unknown.join(', ')}\n${usage()}`);
  return { names, slug };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

function capture(child: ChildProcess): () => string {
  let out = '';
  child.stdout?.on('data', (d) => (out += d));
  child.stderr?.on('data', (d) => (out += d));
  return () => out;
}

function exited(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once('exit', () => resolve());
  });
}

async function stopServer(child: ChildProcess | null): Promise<void> {
  if (!child) return;
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
    await exited(child);
    clearTimeout(timer);
  }
}

async function waitHealthy(baseUrl: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return fail('server exited before it was healthy');
    try {
      const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return fail('server health check on /api/health not ok within 15 s');
}

function hasFfmpeg(): boolean {
  return spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
}

async function toGif(webm: string): Promise<string> {
  const gif = webm.replace(/\.webm$/, '.gif');
  const r = spawnSync(
    'ffmpeg',
    ['-y', '-i', webm, '-vf', 'fps=12,scale=800:-1:flags=lanczos', gif],
    { encoding: 'utf8', timeout: 60_000 },
  );
  if (r.status !== 0) fail(`ffmpeg failed to make a GIF: ${(r.stderr || '').trim().split('\n').pop()}`);
  return gif;
}

async function main(): Promise<string[]> {
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (maj < 22 || (maj === 22 && min < 18)) fail('e2e:capture needs Node 22.18 or newer (type stripping)');
  const { names, slug } = parseArgs(process.argv.slice(2));

  let server: ChildProcess | null = null;
  let browser: Browser | null = null;
  const stop = () => {
    void stopServer(server).finally(() => process.exit(130));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const build = spawnSync('npm', ['run', 'build'], { cwd: ROOT, encoding: 'utf8' });
    if (build.status !== 0) {
      process.stderr.write(`${build.stdout}${build.stderr}`);
      fail('build failed');
    }
    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, ['server/index.mjs'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const serverOut = capture(server);
    try {
      await waitHealthy(baseUrl, server);
    } catch (err) {
      process.stderr.write(serverOut());
      throw err;
    }
    try {
      browser = await chromium.launch();
    } catch (err) {
      fail(`browser launch failed: ${formatLaunchError(err instanceof Error ? err.message : String(err))}`);
    }
    const written: string[] = [];
    for (const name of names) {
      const scenario = scenarios.get(name)!;
      const outDir = path.join(ROOT, 'docs', 'evidence', slug ?? name);
      for (const viewport of scenario.viewports ?? ['desktop']) {
        const files = await runScenario({ browser, baseUrl, outDir, scenario, viewport });
        for (const f of files) {
          written.push(f);
          if (f.endsWith('.webm') && hasFfmpeg()) written.push(await toGif(f));
        }
      }
      await rm(path.join(outDir, '.video-tmp'), { recursive: true, force: true });
    }
    return written.map((f) => path.relative(process.cwd(), f) || f);
  } finally {
    await browser?.close().catch(() => undefined);
    await stopServer(server);
  }
}

main().then(
  (paths) => {
    process.stdout.write(paths.map((p) => `${p}\n`).join(''));
    process.exit(0);
  },
  (err) => {
    const msg = err instanceof StepError ? `e2e:capture: ${err.message}` : `e2e:capture: ${err instanceof Error ? err.message : err}`;
    process.stderr.write(`${msg}\n`);
    process.exit(1);
  },
);
