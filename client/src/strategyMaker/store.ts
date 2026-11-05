/** The strategy maker's own IndexedDB store of highlight sets, one record per chart source. */
import type { Candle } from '../../../shared/market.ts';
import type { HighlightTrade } from './brush';
import type { TrainResult } from './engine';

export const DB_NAME = 'vost-strategy-maker';
export const SETS = 'highlightSets';
export const SETTINGS = 'settings';
export const INPUTS_ID = 'find-inputs';
export const MODEL_ID = 'model';
export const DB_VERSION = 2;

export type SetSource =
  | { kind: 'provider'; provider: string; symbol: string; timeframe: string }
  | { kind: 'library'; datasetId: string }
  | { kind: 'csv'; name: string };

export interface HighlightSet {
  id: string;
  version: 1;
  source: SetSource;
  /** A name the user gave; the source's own label is shown when there is none. Never changes the id. */
  name?: string;
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

/** What the find form holds, as typed: strings stay strings so a half-typed number is kept as it is. */
export interface FindForm {
  direction: 'long' | 'short' | 'both';
  families: string[];
  feeBps: string;
  slippageBps: string;
  stopLossPct: string;
  takeProfitPct: string;
  minRR: string;
  minHitRatePct: string;
  maxDrawdownPct: string;
  /** Set ids to train on; null means the current chart's set (or all sets when no chart is open). */
  setIds: string[] | null;
}

export interface FindInputsRecord {
  id: typeof INPUTS_ID;
  version: 1;
  form: FindForm;
}

/** The trained model, kept with what it was trained on so the page can tell when it is out of date. */
export interface ModelRecord {
  id: typeof MODEL_ID;
  version: 1;
  result: TrainResult;
  /** The sets it was trained on, in training order, each with a stamp of its marks (see exchange.ts). */
  trainedOn: Array<{ id: string; trades: number; stamp: string }>;
}

export interface Store {
  getModel(): Promise<ModelRecord | undefined>;
  putModel(record: ModelRecord): Promise<void>;
  /** Writes the sets and the model in one transaction: all of it or none of it. */
  importAll(sets: HighlightSet[], model: ModelRecord | null): Promise<void>;
  getInputs(): Promise<FindInputsRecord | undefined>;
  putInputs(form: FindForm): Promise<void>;
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
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    // Each store is created only when missing, so a version 1 database keeps its highlight sets.
    req.onupgradeneeded = () => {
      const names = req.result.objectStoreNames;
      if (!names.contains(SETS)) req.result.createObjectStore(SETS, { keyPath: 'id' });
      if (!names.contains(SETTINGS)) req.result.createObjectStore(SETTINGS, { keyPath: 'id' });
    };
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
  const settings = (mode: IDBTransactionMode) => {
    const tx = db.transaction(SETTINGS, mode);
    return { tx, store: tx.objectStore(SETTINGS) };
  };
  return {
    getModel: () => done(settings('readonly').store.get(MODEL_ID) as IDBRequest<ModelRecord | undefined>),
    putModel: async (record) => {
      const { tx, store } = settings('readwrite');
      store.put(record);
      await txDone(tx);
    },
    importAll: async (sets, model) => {
      const tx = db.transaction([SETS, SETTINGS], 'readwrite');
      const finished = txDone(tx);
      finished.catch(() => undefined);
      try {
        const setsStore = tx.objectStore(SETS);
        for (const set of sets) setsStore.put(set);
        if (model) tx.objectStore(SETTINGS).put(model);
      } catch (e) {
        try {
          tx.abort();
        } catch {
          /* already finished */
        }
        throw e;
      }
      await finished;
    },
    getInputs: () => done(settings('readonly').store.get(INPUTS_ID) as IDBRequest<FindInputsRecord | undefined>),
    putInputs: async (form) => {
      const { tx, store } = settings('readwrite');
      store.put({ id: INPUTS_ID, version: 1, form } satisfies FindInputsRecord);
      await txDone(tx);
    },
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
