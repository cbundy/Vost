/** The saved model: read when the page opens, stored after each training, and checked against the marks as they are now. */
import { useCallback, useMemo, useState } from 'react';
import { describeModel, type TrainResult } from './engine';
import { modelFreshness, setStamp, type CurrentSet, type Freshness } from './exchange';
import type { HighlightSet, ModelRecord, Store } from './store';
import { MODEL_ID } from './store';

/** The record of a model trained on `sets`, in that order. */
export function recordOf(result: TrainResult, sets: HighlightSet[]): ModelRecord {
  return { id: MODEL_ID, version: 1, result, trainedOn: trainedOnOf(sets) };
}

/** The stamps of `sets` as they are now, for a model trained on them. */
export const trainedOnOf = (sets: HighlightSet[]): ModelRecord['trainedOn'] =>
  sets.map((s) => ({ id: s.id, trades: s.trades.length, stamp: setStamp(s) }));

export function useModel() {
  const [record, setRecord] = useState<ModelRecord | null>(null);

  /** Reads the stored model; a failed read leaves the panel hidden. */
  const load = useCallback(async (st: Store): Promise<void> => {
    try {
      const rec = await st.getModel();
      if (rec && rec.id === MODEL_ID) setRecord(rec);
    } catch {
      /* no saved model is shown */
    }
  }, []);

  /** Keeps a ready record, such as a model trained while the page was closed (it keeps the stamps it was trained with). */
  const saveRecord = useCallback(async (st: Store | null, rec: ModelRecord): Promise<void> => {
    setRecord(rec);
    try {
      await st?.putModel(rec);
    } catch {
      /* kept for this session only */
    }
  }, []);

  /** Keeps a model that was just trained. The page shows it even when the store cannot be written. */
  const save = useCallback((st: Store | null, result: TrainResult, sets: HighlightSet[]): Promise<void> => saveRecord(st, recordOf(result, sets)), [saveRecord]);

  /** Rules and importance rebuilt from the model itself. */
  const insights = useMemo(() => (record ? describeModel(record.result.model) : null), [record]);

  const freshness = (current: CurrentSet[], known: ReadonlySet<string>, label: (id: string) => string): Freshness | null =>
    record ? modelFreshness(record, current, { known, label }) : null;

  return { record, setRecord, load, save, saveRecord, insights, freshness };
}
