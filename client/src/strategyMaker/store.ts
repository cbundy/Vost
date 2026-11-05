/** The strategy maker's own IndexedDB store of highlight sets, one record per chart source. */
import type { Candle } from '../../../shared/market.ts';
import type { HighlightTrade } from './brush';

export const DB_NAME = 'vost-strategy-maker';
export const SETS = 'highlightSets';

export type SetSource =
  | { kind: 'provider'; provider: string; symbol: string; timeframe: string }
  | { kind: 'library'; datasetId: string }
  | { kind: 'csv'; name: string };

export interface HighlightSet {
  id: string;
  version: 1;
  source: SetSource;
  trades: HighlightTrade[];
  /** Kept for a csv set only, so the set can be trained on later. */
  candles?: Candle[];
  updatedAt: number;
}

/** The record id of a source: the same chart always finds its set. */
export function setId(s: SetSource): string {
  if (s.kind === 'provider') return `provider|${s.provider}|${s.symbol}|${s.timeframe}`;
  if (s.kind === 'library') return `library|${s.datasetId}`;
  return `csv|${s.name}`;
}

export interface Store {
  get(id: string): Promise<HighlightSet | undefined>;
  put(set: HighlightSet): Promise<void>;
  delete(id: string): Promise<void>;
  list(): Promise<HighlightSet[]>;
  close(): void;
}

const done = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const txDone = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

/** Opens the store; null when IndexedDB is missing or fails to open (the marks then live for the session only). */
export async function openStore(): Promise<Store | null> {
  let db: IDBDatabase;
  try {
    if (typeof indexedDB === 'undefined') return null;
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(SETS, { keyPath: 'id' });
    req.onblocked = () => undefined;
    db = await done(req);
  } catch {
    return null;
  }
  db.onversionchange = () => db.close();
  const os = (mode: IDBTransactionMode) => {
    const tx = db.transaction(SETS, mode);
    return { tx, store: tx.objectStore(SETS) };
  };
  return {
    get: (id) => done(os('readonly').store.get(id) as IDBRequest<HighlightSet | undefined>),
    put: async (set) => {
      const { tx, store } = os('readwrite');
      store.put(set);
      await txDone(tx);
    },
    delete: async (id) => {
      const { tx, store } = os('readwrite');
      store.delete(id);
      await txDone(tx);
    },
    list: () => done(os('readonly').store.getAll() as IDBRequest<HighlightSet[]>),
    close: () => db.close(),
  };
}
