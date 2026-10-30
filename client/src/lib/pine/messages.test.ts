import { describe, expect, it } from 'vitest';
import { Context } from 'pinets';
import { MESSAGE_CAP, mapMessages, takeLogs } from './messages';

const none = { lines: [], dropped: 0 };

describe('mapMessages', () => {
  it('converts ms to seconds and groups alert conditions by call site', () => {
    const ctx = {
      alerts: [
        { type: 'alert', id: 'alert_0', message: 'hi', freq: 'once_per_bar', time: 2000 },
        { type: 'alertcondition', id: 'alertcondition_0', title: 'Up', message: 'm', time: 3000 },
        { type: 'alertcondition', id: 'alertcondition_1', title: 'Down', message: 'n', time: 4000 },
        { type: 'alertcondition', id: 'alertcondition_0', title: 'Up', message: 'm', time: 5000 },
      ],
    };
    const m = mapMessages(ctx, none);
    expect(m.alerts).toEqual([{ time: 2, message: 'hi', frequency: 'once_per_bar' }]);
    expect(m.alertConditions).toEqual([
      { title: 'Up', message: 'm', count: 2, times: [3, 5] },
      { title: 'Down', message: 'n', count: 1, times: [4] },
    ]);
  });

  it('caps each list to the newest entries and counts the rest', () => {
    const n = MESSAGE_CAP + 7;
    const ctx = {
      alerts: [
        ...Array.from({ length: n }, (_, i) => ({ type: 'alert', id: 'a', message: String(i), time: i * 1000 })),
        ...Array.from({ length: n }, (_, i) => ({ type: 'alertcondition', id: 'c', title: 'T', message: '', time: i * 1000 })),
      ],
    };
    const m = mapMessages(ctx, { lines: [], dropped: 3 });
    expect(m.alerts).toHaveLength(MESSAGE_CAP);
    expect(m.alerts[MESSAGE_CAP - 1].message).toBe(String(n - 1));
    expect(m.alertConditions[0].count).toBe(n);
    expect(m.alertConditions[0].times).toHaveLength(MESSAGE_CAP);
    expect(m.omitted).toEqual({ alerts: 7, conditionTimes: 7, logs: 3 });
  });

  it('turns runtime warnings into warning logs in time order', () => {
    const ctx = {
      data: { openTime: { data: [1000, 2000, 3000] } },
      warnings: [{ message: 'careful', method: 'array.get', bar: 1 }, { message: 'plain', bar: 0 }],
    };
    const m = mapMessages(ctx, { lines: [{ time: 2, level: 'info', text: 'x' }], dropped: 0 });
    expect(m.logs).toEqual([
      { time: 1, level: 'warning', text: 'plain' },
      { time: 2, level: 'info', text: 'x' },
      { time: 2, level: 'warning', text: 'careful (array.get)' },
    ]);
  });
});

describe('log capture', () => {
  const proto: any = Object.getPrototypeOf(new Context({ marketData: [], source: [] } as any).pine.log);
  const call = (context: any, text: string) => proto.info.call({ context, logFormat: (m: string) => m }, text);

  it('files lines under the root context and drops a secondary context\'s lines', () => {
    const root = { data: { openTime: { data: [5000] } }, idx: 0 };
    call({ ...root, fullContext: root }, 'kept');
    call({ ...root, isSecondaryContext: true, fullContext: root }, 'dropped');
    expect(takeLogs(root).lines).toEqual([{ time: 5, level: 'info', text: 'kept' }]);
    expect(takeLogs(root).lines).toEqual([]);
  });

  it('keeps the newest lines while collecting', () => {
    const root = { data: { openTime: { data: [1000] } }, idx: 0 };
    for (let i = 0; i < MESSAGE_CAP + 3; i++) call(root, String(i));
    const taken = takeLogs(root);
    expect(taken.lines).toHaveLength(MESSAGE_CAP);
    expect(taken.lines[MESSAGE_CAP - 1].text).toBe(String(MESSAGE_CAP + 2));
    expect(taken.dropped).toBe(3);
  });
});
