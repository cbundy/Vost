/**
 * The strategy maker's store of highlight sets, its find form and its trained model. They live on the
 * Vost server (`/api/strategy-maker`), so every browser on the same server sees them; data an older
 * version kept in the browser's own IndexedDB is moved there once (see migrate.ts).
 */
import type { Candle } from '../../../shared/market.ts';
import type { HighlightTrade } from './brush';
import type { TrainResult } from './engine';
import { migrateBrowserData, type MoveNotice } from './migrate';

export const INPUTS_ID = 'find-inputs';
export const MODEL_ID = 'model';

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
  /** How the stop loss is sized: percent of the entry price or a multiple of the ATR. */
  stopMode: 'pct' | 'atr';
  stopAtrMult: string;
  takeProfitMode: 'pct' | 'atr' | 'r';
  takeProfitAtrMult: string;
  /** Take profit as a multiple of the stop distance. */
  takeProfitR: string;
  trailMode: 'off' | 'pct' | 'atr';
  trailPct: string;
  trailAtrMult: string;
  atrLength: string;
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

/** Options of a write. */
export interface WriteOptions {
  /** The page is going away: send it as a `keepalive` request when the body is small enough for the browser to allow that. */
  keepalive?: boolean;
}

export interface Store {
  getModel(): Promise<ModelRecord | undefined>;
  putModel(record: ModelRecord): Promise<void>;
  /** Writes the sets and the model: all of it or none of it. */
  importAll(sets: HighlightSet[], model: ModelRecord | null): Promise<void>;
  getInputs(): Promise<FindInputsRecord | undefined>;
  putInputs(form: FindForm): Promise<void>;
  get(id: string): Promise<HighlightSet | undefined>;
  put(set: HighlightSet, opts?: WriteOptions): Promise<void>;
  delete(id: string, opts?: WriteOptions): Promise<void>;
  list(): Promise<HighlightSet[]>;
  close(): void;
}

/** A request the server refused or failed; `message` is the server's own reason when it gave one. */
export class StoreError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'StoreError';
  }
}

export const UNREACHABLE = 'the Vost server cannot be reached';
/** Why a write failed, for the page: the server's reason for a refusal, else that the server is out of reach. */
export const whyNotSaved = (e: unknown): string => `Marks are not saved: ${e instanceof StoreError && e.status === 503 ? e.message : UNREACHABLE}`;

const API = '/api/strategy-maker';
const JSON_HEADERS = { 'content-type': 'application/json' };
/** The browser caps the bodies of `keepalive` requests at 64 KB. */
export const KEEPALIVE_LIMIT = 64 * 1024;

export interface StoreResponse {
  status: number;
  json: () => Promise<unknown>;
}
/** `fetch`, narrowed to what the store needs; tests inject their own. */
export type StoreTransport = (url: string, init: RequestInit) => Promise<StoreResponse>;

export interface OpenOptions {
  transport?: StoreTransport;
  /** Called once when data the browser held was moved to the server. */
  onMoved?: (notice: MoveNotice) => void;
}

/**
 * Opens the store: first moves any data the browser still holds to the server, then checks the server
 * answers. Null when it cannot be reached (a fetch that throws, or a 5xx): the marks then live for the
 * session only.
 */
export async function openStore(opts: OpenOptions = {}): Promise<Store | null> {
  const transport: StoreTransport = opts.transport ?? ((url, init) => fetch(url, init));
  try {
    const moved = await migrateBrowserData(transport);
    if (moved) opts.onMoved?.(moved);
    const probe = await transport(`${API}/inputs`, { method: 'GET' });
    if (probe.status >= 500) return null;
  } catch {
    return null;
  }

  async function call(method: string, path: string, body?: unknown, keepalive = false): Promise<StoreResponse> {
    const text = body === undefined ? undefined : JSON.stringify(body);
    // The server wants a JSON content type on every write, a DELETE included.
    const init: RequestInit = { method, ...(method === 'GET' ? {} : { headers: JSON_HEADERS }), ...(text === undefined ? {} : { body: text }) };
    if (keepalive && (text?.length ?? 0) <= KEEPALIVE_LIMIT) init.keepalive = true;
    const res = await transport(`${API}/${path}`, init);
    if (res.status >= 400 && !(res.status === 404 && method !== 'PUT')) {
      let reason = `The server answered ${res.status}`;
      try {
        const err = (await res.json()) as { error?: unknown };
        if (typeof err?.error === 'string') reason = err.error;
      } catch {
        /* no JSON reason */
      }
      throw new StoreError(res.status, reason);
    }
    return res;
  }
  const read = async <T>(path: string): Promise<T | undefined> => {
    const res = await call('GET', path);
    return res.status === 404 ? undefined : ((await res.json()) as T);
  };
  const setPath = (id: string) => `sets/${encodeURIComponent(id)}`;

  return {
    getModel: () => read<ModelRecord>('model'),
    putModel: async (record) => void (await call('PUT', 'model', record)),
    importAll: async (sets, model) => void (await call('POST', 'import', { sets, model })),
    getInputs: () => read<FindInputsRecord>('inputs'),
    putInputs: async (form) => void (await call('PUT', 'inputs', { id: INPUTS_ID, version: 1, form } satisfies FindInputsRecord)),
    get: (id) => read<HighlightSet>(setPath(id)),
    put: async (set, o) => void (await call('PUT', setPath(set.id), set, o?.keepalive)),
    delete: async (id, o) => void (await call('DELETE', setPath(id), undefined, o?.keepalive)),
    list: async () => ((await read<{ sets: HighlightSet[] }>('sets'))?.sets ?? []),
    close: () => undefined,
  };
}
