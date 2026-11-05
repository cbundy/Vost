/**
 * The strategy maker's sets and model as one file: stamps that tell when marks changed, the freshness of the
 * saved model, the export, the checked import and the merge plan. Pure: no DOM, no React.
 */
import type { Candle } from '../../../shared/market.ts';
import type { HighlightTrade } from './brush';
import { parseModel, type TrainResult } from './engine';
import { MODEL_ID, setId, type HighlightSet, type ModelRecord, type SetSource } from './store';

export const EXPORT_FORMAT = 'vost-strategy-maker';
export const EXPORT_VERSION = 1;
export const EXPORT_FILE = 'vost-strategy-maker.json';

/* ------------------------------ stamps ------------------------------ */

function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

type Stampable = Pick<HighlightSet, 'source' | 'candles'> & { trades: readonly HighlightTrade[] };

/** A stable hash of a set's marks (in any order) and, for a CSV set, the shape of its candles. */
export function setStamp(set: Stampable): string {
  const marks = set.trades
    .map((t) => `${t.side}:${t.entryTime}:${t.exitTime}`)
    .sort()
    .join(';');
  let text = marks;
  if (set.source.kind === 'csv') {
    const c = set.candles ?? [];
    text += `|${c.length}:${c.length ? c[0].time : ''}:${c.length ? c[c.length - 1].time : ''}`;
  }
  return fnv1a(text);
}

/* ---------------------------- freshness ---------------------------- */

export interface CurrentSet {
  id: string;
  stamp: string;
}

export interface Freshness {
  upToDate: boolean;
  /** Why it is out of date, one sentence each; empty when it is up to date. */
  reasons: string[];
}

/**
 * Whether the model was trained on exactly these sets with these marks. `current` is the sets chosen for training now;
 * `known` the ids of every set that exists (a trained-on set that is gone is "missing", one that is only left out is "removed").
 */
export function modelFreshness(
  record: Pick<ModelRecord, 'trainedOn'> | null,
  current: CurrentSet[],
  opts: { known?: ReadonlySet<string>; label?: (id: string) => string } = {},
): Freshness {
  if (!record) return { upToDate: false, reasons: [] };
  const name = opts.label ?? ((id: string) => id);
  const trained = new Map(record.trainedOn.map((t) => [t.id, t.stamp]));
  const now = new Map(current.map((c) => [c.id, c.stamp]));
  const reasons: string[] = [];
  for (const [id, stamp] of now) {
    if (!trained.has(id)) reasons.push(`${name(id)} was added`);
    else if (trained.get(id) !== stamp) reasons.push(`${name(id)} has changed marks`);
  }
  for (const id of trained.keys()) {
    if (now.has(id)) continue;
    reasons.push(opts.known && !opts.known.has(id) ? `${name(id)} is missing` : `${name(id)} was left out`);
  }
  return { upToDate: reasons.length === 0, reasons };
}

/* ------------------------------ export ------------------------------ */

export interface ExchangeFile {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  exportedAt: string;
  sets: HighlightSet[];
  model: ModelRecord | null;
}

export function buildExport(sets: HighlightSet[], model: ModelRecord | null, now: Date = new Date()): ExchangeFile {
  return { format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: now.toISOString(), sets, model };
}

/* ------------------------------ import ------------------------------ */

export type ParsedExchange = { ok: true; sets: HighlightSet[]; model: ModelRecord | null } | { ok: false; error: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

function readSource(raw: unknown): SetSource | null {
  if (!isObject(raw)) return null;
  if (raw.kind === 'provider' && str(raw.provider) && str(raw.symbol) && str(raw.timeframe)) {
    return { kind: 'provider', provider: raw.provider, symbol: raw.symbol, timeframe: raw.timeframe };
  }
  if (raw.kind === 'library' && str(raw.datasetId)) return { kind: 'library', datasetId: raw.datasetId };
  if (raw.kind === 'csv' && str(raw.name)) return { kind: 'csv', name: raw.name };
  return null;
}

function readTrades(raw: unknown): HighlightTrade[] | null {
  if (!Array.isArray(raw)) return null;
  const out: HighlightTrade[] = [];
  for (const t of raw as unknown[]) {
    if (!isObject(t) || (t.side !== 'long' && t.side !== 'short') || !finite(t.entryTime) || !finite(t.exitTime) || t.entryTime >= t.exitTime) return null;
    out.push({ side: t.side, entryTime: t.entryTime, exitTime: t.exitTime });
  }
  return out;
}

function readCandles(raw: unknown): Candle[] | null {
  if (!Array.isArray(raw)) return null;
  const out: Candle[] = [];
  for (const c of raw as unknown[]) {
    if (!isObject(c) || ![c.time, c.open, c.high, c.low, c.close, c.volume].every(finite)) return null;
    out.push({ time: c.time as number, open: c.open as number, high: c.high as number, low: c.low as number, close: c.close as number, volume: c.volume as number });
  }
  return out;
}

function readSet(raw: unknown, n: number): HighlightSet | string {
  const bad = (why: string): string => `Set ${n} ${why}.`;
  if (!isObject(raw)) return bad('is not a set');
  if (raw.version !== 1) return bad(`has version ${String(raw.version)}`);
  const source = readSource(raw.source);
  if (!source) return bad('has a source this app does not know');
  if (raw.id !== setId(source)) return bad('has an id that does not match its source');
  const trades = readTrades(raw.trades);
  if (!trades) return bad('has a malformed trade (a time that is not a number, or an entry that is not before its exit)');
  if (!finite(raw.updatedAt)) return bad('has no change time');
  if (raw.name !== undefined && typeof raw.name !== 'string') return bad('has a name that is not text');
  const set: HighlightSet = { id: raw.id as string, version: 1, source, trades, updatedAt: raw.updatedAt };
  if (typeof raw.name === 'string' && raw.name) set.name = raw.name;
  if (raw.candles !== undefined) {
    const candles = readCandles(raw.candles);
    if (!candles) return bad('has malformed candles');
    set.candles = candles;
  }
  if (source.kind === 'csv' && !set.candles?.length) return bad('is a CSV set without its candles');
  return set;
}

function readModel(raw: unknown): ModelRecord | string {
  const bad = (why: string): string => `The saved model ${why}.`;
  if (!isObject(raw) || raw.id !== MODEL_ID || raw.version !== 1) return bad('is not a model record this app reads');
  const result = raw.result;
  if (!isObject(result) || result.kind !== 'ok') return bad('has no training result');
  const parsed = parseModel(JSON.stringify(result.model));
  if (!parsed.ok) return bad(`is malformed: ${parsed.error}`);
  const held = result.heldOut;
  if (!isObject(held)) return bad('has no held-out report');
  const num = (v: unknown): number => (finite(v) ? v : 0);
  if (!Array.isArray(result.rules) || !result.rules.every((r) => typeof r === 'string')) return bad('has malformed rules');
  if (!isObject(result.importance) || !Array.isArray(result.importance.byFeature) || !Array.isArray(result.importance.byFamily)) return bad('has malformed importance');
  if (!Array.isArray(result.families) || !result.families.every((f) => typeof f === 'string')) return bad('has malformed families');
  if (!isObject(result.space) || !Array.isArray(result.skipped) || !finite(result.usedTrades)) return bad('has malformed training details');
  const trained = raw.trainedOn;
  if (!Array.isArray(trained)) return bad('has no list of the sets it was trained on');
  const trainedOn: ModelRecord['trainedOn'] = [];
  for (const t of trained as unknown[]) {
    if (!isObject(t) || !str(t.id) || !finite(t.trades) || !str(t.stamp)) return bad('has a malformed list of the sets it was trained on');
    trainedOn.push({ id: t.id, trades: t.trades, stamp: t.stamp });
  }
  const model: TrainResult = {
    ...(result as unknown as TrainResult),
    model: parsed.model,
    heldOut: { accuracy: num(held.accuracy), f1: num(held.f1), precision: num(held.precision), recall: num(held.recall), bars: num(held.bars) },
  };
  return { id: MODEL_ID, version: 1, result: model, trainedOn };
}

/** Reads an export file. Never throws: a refusal comes back as a message, and nothing is to be written. */
export function parseExchange(text: string): ParsedExchange {
  const fail = (error: string): ParsedExchange => ({ ok: false, error });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail('The file is not valid JSON, so it is not a Strategy maker export (or it is cut short).');
  }
  if (!isObject(raw) || raw.format !== EXPORT_FORMAT) return fail('The file is not a Strategy maker export.');
  if (raw.version !== EXPORT_VERSION) return fail(`The file has version ${String(raw.version)}; this app reads version ${EXPORT_VERSION}.`);
  if (!Array.isArray(raw.sets)) return fail('The file has no list of sets.');
  const sets: HighlightSet[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.sets.length; i++) {
    const s = readSet(raw.sets[i], i + 1);
    if (typeof s === 'string') return fail(s);
    if (seen.has(s.id)) return fail(`Set ${i + 1} appears twice in the file.`);
    seen.add(s.id);
    sets.push(s);
  }
  let model: ModelRecord | null = null;
  if (raw.model !== null && raw.model !== undefined) {
    const m = readModel(raw.model);
    if (typeof m === 'string') return fail(m);
    model = m;
  }
  return { ok: true, sets, model };
}

/* ------------------------------ merge ------------------------------ */

export interface Conflict {
  id: string;
  mine: HighlightSet;
  imported: HighlightSet;
}

export interface ImportPlan {
  /** Sets this browser does not have. */
  add: HighlightSet[];
  /** Ids already here with the same marks and name: nothing to do. */
  same: string[];
  conflicts: Conflict[];
  /** The file's model when it differs from the stored one; null when there is nothing to write. */
  model: ModelRecord | null;
}

const sameSet = (a: HighlightSet, b: HighlightSet): boolean => setStamp(a) === setStamp(b) && (a.name ?? '') === (b.name ?? '');

const sameModel = (a: ModelRecord | null, b: ModelRecord): boolean =>
  !!a &&
  a.result.model.createdAt === b.result.model.createdAt &&
  a.trainedOn.length === b.trainedOn.length &&
  a.trainedOn.every((t, i) => t.id === b.trainedOn[i].id && t.stamp === b.trainedOn[i].stamp);

export function planImport(local: { sets: HighlightSet[]; model: ModelRecord | null }, file: { sets: HighlightSet[]; model: ModelRecord | null }): ImportPlan {
  const mine = new Map(local.sets.map((s) => [s.id, s]));
  const plan: ImportPlan = { add: [], same: [], conflicts: [], model: file.model && !sameModel(local.model, file.model) ? file.model : null };
  for (const imported of file.sets) {
    const have = mine.get(imported.id);
    if (!have) plan.add.push(imported);
    else if (sameSet(have, imported)) plan.same.push(imported.id);
    else plan.conflicts.push({ id: imported.id, mine: have, imported });
  }
  return plan;
}

/** The sets to write once each conflict has been decided (a conflict not in `choices` keeps the local set). */
export function setsToWrite(plan: ImportPlan, choices: Record<string, 'mine' | 'imported'>): HighlightSet[] {
  return [...plan.add, ...plan.conflicts.filter((c) => choices[c.id] === 'imported').map((c) => c.imported)];
}
