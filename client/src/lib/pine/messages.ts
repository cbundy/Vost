/**
 * What a Pine script says during a run: alerts, alert conditions and log lines. PineTS keeps alerts and warnings on
 * the context but sends `log.*` straight to the console, so the three Log methods are wrapped once and the lines are
 * filed per run, keyed by the run's root context.
 */
import { Context } from 'pinets';
import type { PineAlert, PineAlertCondition, PineLog, PineMessages } from './types';

/** Most entries kept per list (and per alert condition's times); the newest win. */
export const MESSAGE_CAP = 500;

interface LogBucket {
  lines: PineLog[];
  dropped: number;
}

const buckets = new WeakMap<object, LogBucket>();
let wrapped = false;

const LEVELS = { info: 'info', warning: 'warning', error: 'error' } as const;

function wrapLog(): void {
  if (wrapped) return;
  wrapped = true;
  const proto: any = Object.getPrototypeOf(new Context({ marketData: [], source: [] } as any).pine.log);
  for (const level of Object.keys(LEVELS) as (keyof typeof LEVELS)[]) {
    proto[level] = function (this: any, message: unknown, ...args: unknown[]) {
      const ctx = this.context;
      if (!ctx || ctx.isSecondaryContext) return;
      const key = ctx.fullContext ?? ctx;
      let bucket = buckets.get(key);
      if (!bucket) buckets.set(key, (bucket = { lines: [], dropped: 0 }));
      const ms = ctx.data?.openTime?.data?.[ctx.idx];
      const text = String(this.logFormat(message, ...args));
      bucket.lines.push({ time: typeof ms === 'number' ? Math.floor(ms / 1000) : 0, level, text });
      if (bucket.lines.length > MESSAGE_CAP) {
        bucket.lines.shift();
        bucket.dropped++;
      }
    };
  }
}
wrapLog();

/** The log lines filed under a finished run's context, released from the store. */
export function takeLogs(ctx: object): LogBucket {
  const bucket = buckets.get(ctx) ?? { lines: [], dropped: 0 };
  buckets.delete(ctx);
  return bucket;
}

const sec = (ms: unknown) => Math.floor(Number(ms) / 1000);

function capNewest<T>(list: T[]): { kept: T[]; omitted: number } {
  const omitted = Math.max(0, list.length - MESSAGE_CAP);
  return { kept: omitted ? list.slice(omitted) : list, omitted };
}

/** Turn the context's alerts and warnings, plus the collected log lines, into `PineMessages`. */
export function mapMessages(ctx: any, logs: LogBucket): PineMessages {
  const all: any[] = Array.isArray(ctx?.alerts) ? ctx.alerts : [];
  const alertList: PineAlert[] = [];
  const conditions = new Map<string, PineAlertCondition>();
  for (const a of all) {
    if (a?.type === 'alertcondition') {
      const id = String(a.id);
      let c = conditions.get(id);
      if (!c) conditions.set(id, (c = { title: String(a.title ?? ''), message: String(a.message ?? ''), count: 0, times: [] }));
      c.count++;
      c.times.push(sec(a.time));
    } else {
      alertList.push({ time: sec(a.time), message: String(a.message ?? ''), frequency: String(a.freq ?? 'all') });
    }
  }
  const alerts = capNewest(alertList);
  let conditionTimes = 0;
  const alertConditions = [...conditions.values()].map((c) => {
    const t = capNewest(c.times);
    conditionTimes += t.omitted;
    return { ...c, times: t.kept };
  });
  const warnings: PineLog[] = (Array.isArray(ctx?.warnings) ? ctx.warnings : []).map((w: any) => {
    const idx = Number(w.bar);
    const ms = ctx.data?.openTime?.data?.[idx];
    return {
      time: typeof ms === 'number' ? sec(ms) : 0,
      level: 'warning' as const,
      text: w.method ? `${w.message} (${w.method})` : String(w.message),
    };
  });
  const merged = [...logs.lines, ...warnings].sort((a, b) => a.time - b.time);
  const log = capNewest(merged);
  return {
    alerts: alerts.kept,
    alertConditions,
    logs: log.kept,
    omitted: { alerts: alerts.omitted, conditionTimes, logs: logs.dropped + log.omitted },
  };
}
