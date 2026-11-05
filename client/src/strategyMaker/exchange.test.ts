import { beforeAll, describe, expect, it } from 'vitest';
import { trainModel, type TrainResult } from './engine';
import { highlights, synth } from './engine/synthetic';
import { buildExport, modelFreshness, parseExchange, planImport, setStamp, setsToWrite } from './exchange';
import { setId, type HighlightSet, type ModelRecord } from './store';
import { recordOf } from './useModel';

const candles = synth(3000, 7);
const trades = highlights(candles, 3);
const csv = (name: string, t = trades): HighlightSet => ({ id: setId({ kind: 'csv', name }), version: 1, source: { kind: 'csv', name }, trades: t, candles, updatedAt: 5 });
const prov: HighlightSet = {
  id: 'provider|demo|BTC|1h',
  version: 1,
  source: { kind: 'provider', provider: 'demo', symbol: 'BTC', timeframe: '1h' },
  trades: trades.slice(0, 3),
  updatedAt: 6,
};

let result: TrainResult;
let record: ModelRecord;
beforeAll(async () => {
  const r = await trainModel({ series: [{ candles, trades }] });
  if (r.kind !== 'ok') throw new Error('training should work on the synthetic series');
  result = r;
  record = recordOf(result, [csv('a.csv')]);
}, 60_000);

const exportText = (sets: HighlightSet[], model: ModelRecord | null): string => JSON.stringify(buildExport(sets, model));
const parsed = (text: string) => {
  const p = parseExchange(text);
  if (!p.ok) throw new Error(p.error);
  return p;
};

describe('setStamp', () => {
  it('ignores the order of the trades and changes with the marks', () => {
    const a = csv('a.csv');
    expect(setStamp({ ...a, trades: [...a.trades].reverse() })).toBe(setStamp(a));
    expect(setStamp({ ...a, trades: a.trades.slice(1) })).not.toBe(setStamp(a));
    expect(setStamp({ ...a, trades: [{ ...a.trades[0], exitTime: a.trades[0].exitTime + 1 }, ...a.trades.slice(1)] })).not.toBe(setStamp(a));
  });
  it('includes the shape of the candles for a csv set only', () => {
    const a = csv('a.csv');
    expect(setStamp({ ...a, candles: candles.slice(0, 100) })).not.toBe(setStamp(a));
    expect(setStamp({ ...prov, candles: candles.slice(0, 100) })).toBe(setStamp(prov));
  });
});

describe('modelFreshness', () => {
  let now: Array<{ id: string; stamp: string }>;
  beforeAll(() => {
    now = record.trainedOn.map((t) => ({ id: t.id, stamp: t.stamp }));
  });
  it('is up to date when nothing changed', () => {
    expect(modelFreshness(record, now)).toEqual({ upToDate: true, reasons: [] });
  });
  it('reports a changed set', () => {
    const f = modelFreshness(record, [{ id: now[0].id, stamp: 'other' }]);
    expect(f.upToDate).toBe(false);
    expect(f.reasons[0]).toMatch(/changed/);
  });
  it('reports an added set', () => {
    const f = modelFreshness(record, [...now, { id: prov.id, stamp: 'x' }], { label: (id) => (id === prov.id ? 'Demo' : id) });
    expect(f.reasons).toEqual(['Demo was added']);
  });
  it('tells a set left out from one that is missing', () => {
    expect(modelFreshness(record, [], { known: new Set(now.map((n) => n.id)) }).reasons[0]).toMatch(/left out/);
    expect(modelFreshness(record, [], { known: new Set() }).reasons[0]).toMatch(/missing/);
  });
});

describe('export and import', () => {
  it('an export imported into an empty store gives the same sets and model', () => {
    const sets = [csv('a.csv'), prov];
    const p = parsed(exportText(sets, record));
    expect(p.sets).toEqual(sets);
    expect(JSON.parse(JSON.stringify(p.model))).toEqual(JSON.parse(JSON.stringify(record)));
    const plan = planImport({ sets: [], model: null }, p);
    expect(plan.add).toEqual(sets);
    expect(plan.conflicts).toEqual([]);
    expect(plan.model).not.toBeNull();
  });

  it('a second import of the same file plans no writes', () => {
    const sets = [csv('a.csv'), prov];
    const p = parsed(exportText(sets, record));
    const plan = planImport({ sets, model: p.model }, p);
    expect(plan.add).toEqual([]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.model).toBeNull();
    expect(setsToWrite(plan, {})).toEqual([]);
  });

  it('keeps the local model when the file has none', () => {
    const plan = planImport({ sets: [], model: record }, parsed(exportText([prov], null)));
    expect(plan.model).toBeNull();
  });

  it('a changed set is a conflict, and each choice gives the expected sets', () => {
    const mine = csv('a.csv');
    const theirs = { ...mine, trades: mine.trades.slice(1) };
    const plan = planImport({ sets: [mine], model: null }, parsed(exportText([theirs, prov], null)));
    expect(plan.conflicts.map((c) => c.id)).toEqual([mine.id]);
    expect(plan.add).toEqual([prov]);
    expect(setsToWrite(plan, { [mine.id]: 'mine' })).toEqual([prov]);
    expect(setsToWrite(plan, { [mine.id]: 'imported' })).toEqual([prov, theirs]);
  });

  it('a renamed set is a conflict too', () => {
    const mine = csv('a.csv');
    const plan = planImport({ sets: [mine], model: null }, parsed(exportText([{ ...mine, name: 'Mine' }], null)));
    expect(plan.conflicts).toHaveLength(1);
  });

  describe('refuses with a message and plans nothing', () => {
    const goodText = (): string => exportText([csv('a.csv'), prov], record);
    const refuse = (text: string, why: RegExp) => {
      const p = parseExchange(text);
      expect(p.ok).toBe(false);
      if (!p.ok) expect(p.error).toMatch(why);
    };
    const edit = (f: (x: Record<string, any>) => void): string => {
      const c = JSON.parse(goodText());
      f(c);
      return JSON.stringify(c);
    };
    it('version 2', () => refuse(edit((x) => (x.version = 2)), /version 2/));
    it('a truncated file', () => refuse(goodText().slice(0, 500), /not valid JSON/));
    it('another format', () => refuse(edit((x) => (x.format = 'other')), /not a Strategy maker export/));
    it('an id that does not match its source', () => refuse(edit((x) => (x.sets[1].id = 'provider|demo|ETH|1h')), /id that does not match/));
    it('a trade that enters at its exit', () => refuse(edit((x) => (x.sets[1].trades[0].entryTime = x.sets[1].trades[0].exitTime)), /malformed trade/));
    it('a trade time that is not a number', () => refuse(edit((x) => (x.sets[1].trades[0].entryTime = 'soon')), /malformed trade/));
    it('a bad source', () => refuse(edit((x) => (x.sets[1].source = { kind: 'ftp' })), /source/));
    it('a malformed model', () => refuse(edit((x) => (x.model.result.model.tree = { feature: 'nope' })), /saved model is malformed/));
    it('a model without its training list', () => refuse(edit((x) => delete x.model.trainedOn), /trained on/));
    it('a csv set without candles', () => refuse(edit((x) => delete x.sets[0].candles), /without its candles/));
    it('text that is not an object', () => refuse('[1,2]', /not a Strategy maker export/));
  });
});
