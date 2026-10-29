/**
 * Resolves `import user/name/version as x` in a Pine script through the Vost
 * server (`/api/pine/libraries/...`), which fetches open-source libraries from
 * TradingView and keeps them, or serves the ones the user pasted. The browser
 * never talks to TradingView itself.
 *
 * A resolver is made fresh for every run, so a library pasted after a miss is
 * found on the next run. It records each path it could not get, and why.
 */

export type LibraryMissReason = 'not-found' | 'closed-source' | 'server-error' | 'no-server';

export interface LibraryMiss {
  path: string;
  reason: LibraryMissReason;
  detail?: string;
}

export interface ServerResolver {
  resolve: (path: string) => Promise<string | null>;
  /** Every path this resolver could not get, by path. */
  misses: Map<string, LibraryMiss>;
}

export interface ServerResolverOptions {
  /** `http://host:port` of the Vost server; undefined when there is none (Node, tests). */
  origin?: string | null;
  fetch?: typeof globalThis.fetch;
}

/** The origin of the page or worker running this code, or null outside a browser. */
export function pageOrigin(): string | null {
  const loc = (globalThis as { location?: { origin?: string; protocol?: string } }).location;
  return loc?.origin && /^https?:$/.test(loc.protocol ?? '') ? loc.origin : null;
}

export function libraryUrl(origin: string, libPath: string): string {
  return `${origin}/api/pine/libraries/${libPath.split('/').map(encodeURIComponent).join('/')}`;
}

export function createServerResolver(opts: ServerResolverOptions = {}): ServerResolver {
  const origin = opts.origin === undefined ? pageOrigin() : opts.origin;
  const misses = new Map<string, LibraryMiss>();
  const miss = (path: string, reason: LibraryMissReason, detail?: string): null => {
    misses.set(path, { path, reason, ...(detail && { detail }) });
    return null;
  };
  return {
    misses,
    async resolve(libPath) {
      if (!origin) return miss(libPath, 'no-server');
      const doFetch = opts.fetch ?? globalThis.fetch;
      try {
        const res = await doFetch(libraryUrl(origin, libPath));
        if (res.ok) {
          const body = (await res.json()) as { source?: unknown };
          if (typeof body.source === 'string') return body.source;
          return miss(libPath, 'server-error', 'the server sent no source');
        }
        const body = (await res.json().catch(() => ({}))) as { error?: unknown; reason?: unknown };
        if (res.status === 404 && (body.reason === 'not-found' || body.reason === 'closed-source')) return miss(libPath, body.reason);
        return miss(libPath, 'server-error', typeof body.error === 'string' ? body.error : `HTTP ${res.status}`);
      } catch (err) {
        return miss(libPath, 'server-error', err instanceof Error ? err.message : String(err));
      }
    },
  };
}

/** The plain message for a library a run could not load. */
export function libraryMessage(libPath: string, miss?: LibraryMiss): string {
  const head = `Library "${libPath}" could not be loaded: `;
  const paste = 'Paste its source under Pine libraries.';
  switch (miss?.reason) {
    case 'not-found':
      return `${head}TradingView has no library with that name and version. ${paste}`;
    case 'closed-source':
      return `${head}TradingView has no open-source copy of it. ${paste}`;
    case 'server-error':
      return `${head}the Vost server could not fetch it${miss.detail ? ` (${miss.detail})` : ''}. Try again, or ${paste.charAt(0).toLowerCase()}${paste.slice(1)}`;
    case 'no-server':
      return `${head}there is no Vost server to load it from.`;
    default:
      return `${head}no source was found for it. ${paste}`;
  }
}

/** The library path in a PineTS "could not be resolved" error, if that is what the error is. */
export function missingLibraryPath(message: string): string | null {
  const m = /Import "([^"]+)" could not be resolved/.exec(message) ?? /from "([^"]+)", which could not be resolved/.exec(message);
  return m ? m[1] : null;
}
