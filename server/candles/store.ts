/**
 * The candle store: `candles.sqlite` under the data dir (`node:sqlite`, WAL).
 * `candles` holds the bars; `coverage` holds disjoint, merged intervals of bar
 * times known to be complete from the source, so a bar time inside an interval
 * with no row means the exchange had no candle there. The forming bar is never
 * stored or covered. A broken, mismatched or unwritable file turns the store
 * off (every call a no-op that reports "not covered"); it never stops the server.
 */
import { DatabaseSync } from 'node:sqlite';
import { rename, mkdir } from 'node:fs/promises';
import { statSync } from 'node:fs';
import path from 'node:path';
import { TIMEFRAME_SECONDS, type Candle, type Timeframe } from '../../shared/market.ts';
import { canWrite } from '../fsutil.ts';

export const SCHEMA_VERSION = 1;
export const FILE_NAME = 'candles.sqlite';

export interface Series {
  provider: string;
  symbol: string;
  timeframe: Timeframe;
}

/** An inclusive interval of bar times (unix seconds). */
export interface Interval {
  from: number;
  to: number;
}

export interface CandleStats {
  on: boolean;
  series: number;
  rows: number;
  bytes: number;
}

export interface CandleStore {
  readonly on: boolean;
  readonly file: string;
  /** Stores closed bars and merges `coveredFrom..coveredTo` (clamped to the last closed bar) into coverage. Idempotent. */
  upsert(series: Series, candles: Candle[], coveredFrom?: number, coveredTo?: number): void;
  /** Rows with `from <= time <= to`, ascending. */
  range(series: Series, from: number, to: number): Candle[];
  /** The `n` newest rows with `time <= to`, ascending. */
  lastN(series: Series, to: number, n: number): Candle[];
  /** The sub-intervals of `from..to` that coverage does not hold. A store that is off reports the whole span. */
  covered(series: Series, from: number, to: number): Interval[];
  /** Deletes rows older than `olderThan` and trims coverage to match. */
  prune(series: Series | 'all', olderThan: number): void;
  stats(): CandleStats;
  close(): void;
}

export interface CandleStoreDeps {
  dir: string;
  now?: () => number;
  log?: (line: string) => void;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS candles (
  provider TEXT NOT NULL, symbol TEXT NOT NULL, timeframe TEXT NOT NULL, time INTEGER NOT NULL,
  open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL, volume REAL NOT NULL,
  PRIMARY KEY (provider, symbol, timeframe, time)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS coverage (
  provider TEXT NOT NULL, symbol TEXT NOT NULL, timeframe TEXT NOT NULL, from_time INTEGER NOT NULL, to_time INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS coverage_series ON coverage (provider, symbol, timeframe, from_time);
`;

function offStore(file: string): CandleStore {
  return {
    on: false,
    file,
    upsert() {},
    range: () => [],
    lastN: () => [],
    covered: (_s, from, to) => (from <= to ? [{ from, to }] : []),
    prune() {},
    stats: () => ({ on: false, series: 0, rows: 0, bytes: 0 }),
    close() {},
  };
}

/** Opens the file, creating it at `SCHEMA_VERSION`; throws when it is corrupt or from another version. */
function openDb(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA journal_mode = WAL');
    const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    const tables = (db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").get() as { n: number }).n;
    if (version === 0 && tables === 0) {
      db.exec(SCHEMA);
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    } else if (version !== SCHEMA_VERSION) {
      throw new Error(`schema version ${version}, expected ${SCHEMA_VERSION}`);
    } else {
      db.exec(SCHEMA);
    }
    return db;
  } catch (err) {
    try {
      db.close();
    } catch {
      /* already unusable */
    }
    throw err;
  }
}

export async function openCandleStore(deps: CandleStoreDeps): Promise<CandleStore> {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((line: string) => console.log(line));
  const file = path.join(deps.dir, FILE_NAME);
  const fail = (why: string): CandleStore => {
    log(`[candles] store off: ${why}`);
    return offStore(file);
  };

  if (!(await canWrite(deps.dir))) return fail(`${deps.dir} cannot be written`);
  let db: DatabaseSync;
  try {
    await mkdir(deps.dir, { recursive: true });
    try {
      db = openDb(file);
    } catch (err) {
      const stamp = now();
      let moved = false;
      for (const suffix of ['', '-wal', '-shm']) {
        try {
          await rename(file + suffix, `${file}.bad-${stamp}${suffix}`);
          if (suffix === '') moved = true;
        } catch (moveErr) {
          if ((moveErr as NodeJS.ErrnoException).code !== 'ENOENT') return fail(`bad file could not be moved aside: ${(moveErr as Error).message}`);
        }
      }
      log(`[candles] moved bad file to ${FILE_NAME}.bad-${stamp}${moved ? '' : ' (nothing)'} (${(err as Error).message})`);
      db = openDb(file);
    }
  } catch (err) {
    return fail((err as Error).message);
  }

  const database = db;
  let open = true;
  const tfSeconds = (tf: Timeframe): number => TIMEFRAME_SECONDS[tf];
  const insert = database.prepare('INSERT OR REPLACE INTO candles (provider, symbol, timeframe, time, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const selRange = database.prepare('SELECT time, open, high, low, close, volume FROM candles WHERE provider = ? AND symbol = ? AND timeframe = ? AND time >= ? AND time <= ? ORDER BY time ASC');
  const selLast = database.prepare('SELECT time, open, high, low, close, volume FROM candles WHERE provider = ? AND symbol = ? AND timeframe = ? AND time <= ? ORDER BY time DESC LIMIT ?');
  const selCover = database.prepare('SELECT from_time AS "from", to_time AS "to" FROM coverage WHERE provider = ? AND symbol = ? AND timeframe = ? AND to_time >= ? AND from_time <= ? ORDER BY from_time ASC');
  const delCover = database.prepare('DELETE FROM coverage WHERE provider = ? AND symbol = ? AND timeframe = ? AND to_time >= ? AND from_time <= ?');
  const insCover = database.prepare('INSERT INTO coverage (provider, symbol, timeframe, from_time, to_time) VALUES (?, ?, ?, ?, ?)');

  const toCandle = (r: Record<string, unknown>): Candle => ({
    time: Number(r.time),
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: Number(r.volume),
  });
  const transaction = <T>(fn: () => T): T => {
    database.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      database.exec('COMMIT');
      return out;
    } catch (err) {
      try {
        database.exec('ROLLBACK');
      } catch {
        /* the original error matters */
      }
      throw err;
    }
  };

  return {
    on: true,
    file,
    upsert(s, candles, coveredFrom, coveredTo) {
      if (!open) return;
      const lastClosed = Math.floor(now() / 1000) - tfSeconds(s.timeframe); // a bar at or before this has closed
      transaction(() => {
        for (const c of candles) {
          if (c.time > lastClosed) continue;
          insert.run(s.provider, s.symbol, s.timeframe, c.time, c.open, c.high, c.low, c.close, c.volume);
        }
        if (coveredFrom === undefined || coveredTo === undefined) return;
        const to = Math.min(coveredTo, lastClosed);
        if (coveredFrom > to) return;
        let from = coveredFrom;
        let end = to;
        for (const row of selCover.all(s.provider, s.symbol, s.timeframe, coveredFrom - 1, to + 1) as unknown as Interval[]) {
          from = Math.min(from, row.from);
          end = Math.max(end, row.to);
        }
        delCover.run(s.provider, s.symbol, s.timeframe, coveredFrom - 1, to + 1);
        insCover.run(s.provider, s.symbol, s.timeframe, from, end);
      });
    },
    range(s, from, to) {
      if (!open) return [];
      return (selRange.all(s.provider, s.symbol, s.timeframe, from, to) as Record<string, unknown>[]).map(toCandle);
    },
    lastN(s, to, n) {
      if (!open || n < 1) return [];
      return (selLast.all(s.provider, s.symbol, s.timeframe, to, n) as Record<string, unknown>[]).map(toCandle).reverse();
    },
    covered(s, from, to) {
      if (from > to) return [];
      if (!open) return [{ from, to }];
      const missing: Interval[] = [];
      let cursor = from;
      for (const row of selCover.all(s.provider, s.symbol, s.timeframe, from, to) as unknown as Interval[]) {
        if (row.from > cursor) missing.push({ from: cursor, to: row.from - 1 });
        cursor = Math.max(cursor, row.to + 1);
        if (cursor > to) break;
      }
      if (cursor <= to) missing.push({ from: cursor, to });
      return missing;
    },
    prune(s, olderThan) {
      if (!open) return;
      const where = s === 'all' ? '' : ' AND provider = ? AND symbol = ? AND timeframe = ?';
      const args = s === 'all' ? [] : [s.provider, s.symbol, s.timeframe];
      transaction(() => {
        database.prepare(`DELETE FROM candles WHERE time < ?${where}`).run(olderThan, ...args);
        database.prepare(`DELETE FROM coverage WHERE to_time < ?${where}`).run(olderThan, ...args);
        database.prepare(`UPDATE coverage SET from_time = ? WHERE from_time < ?${where}`).run(olderThan, olderThan, ...args);
      });
    },
    stats() {
      if (!open) return { on: false, series: 0, rows: 0, bytes: 0 };
      const series = (database.prepare('SELECT count(*) AS n FROM (SELECT DISTINCT provider, symbol, timeframe FROM candles)').get() as { n: number }).n;
      const rows = (database.prepare('SELECT count(*) AS n FROM candles').get() as { n: number }).n;
      let bytes = 0;
      for (const suffix of ['', '-wal']) {
        try {
          bytes += statSync(file + suffix).size;
        } catch {
          /* no such file */
        }
      }
      return { on: true, series: Number(series), rows: Number(rows), bytes };
    },
    close() {
      if (!open) return;
      open = false;
      try {
        database.close();
      } catch {
        /* closing twice or a failing disk */
      }
    },
  };
}
