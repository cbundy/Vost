import { describe, expect, it } from 'vitest';
import { EXIT_REASON_HELP, METRIC_HELP } from './metricHelp';

describe('METRIC_HELP', () => {
  const entries = Object.entries(METRIC_HELP);
  it('has complete, short entries', () => {
    for (const [key, h] of entries) {
      for (const f of ['label', 'what', 'reading', 'profit'] as const) {
        expect(h[f].trim().length, `${key}.${f}`).toBeGreaterThan(0);
        expect(h[f].length, `${key}.${f}`).toBeLessThanOrEqual(300);
      }
      expect(h.related.length, key).toBeGreaterThan(0);
    }
  });
  it('relates only to other existing entries', () => {
    for (const [key, h] of entries) {
      for (const r of h.related) {
        expect(r.key, key).not.toBe(key);
        expect(METRIC_HELP[r.key], `${key} -> ${r.key}`).toBeDefined();
        expect(r.note.length, `${key} -> ${r.key}`).toBeGreaterThan(0);
        expect(r.note.length).toBeLessThanOrEqual(300);
      }
    }
  });
  it('maps every exit reason', () => {
    for (const k of Object.values(EXIT_REASON_HELP)) expect(METRIC_HELP[k]).toBeDefined();
    expect(Object.keys(EXIT_REASON_HELP).sort()).toEqual(['end_of_data', 'signal', 'stop_loss', 'take_profit']);
  });
});
