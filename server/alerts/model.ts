/** Alert validation and the pure crossing rule. */
import { ALERT_CONDITIONS, type Alert, type AlertCondition, type AlertEdit, type AlertInput } from '../../shared/alerts.ts';
import { PROVIDER_CATALOG } from '../../shared/providerCatalog.ts';
import { adapters } from '../providers/index.ts';
import { InputError } from '../providers/errors.ts';

export const MAX_ALERTS = 500;
export const MAX_SYMBOL = 40;
export const MAX_NOTE = 200;

function record(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new InputError('Body must be a JSON object');
  return body as Record<string, unknown>;
}

function parseCondition(v: unknown): AlertCondition {
  if (typeof v !== 'string' || !(ALERT_CONDITIONS as readonly string[]).includes(v)) {
    throw new InputError(`condition must be one of: ${ALERT_CONDITIONS.join(', ')}`);
  }
  return v as AlertCondition;
}

function parseLevel(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) throw new InputError('level must be a number above 0');
  return v;
}

function parseNote(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw new InputError('note must be a string');
  if (v.length > MAX_NOTE) throw new InputError(`note must be at most ${MAX_NOTE} characters`);
  return v;
}

/** Validates a create body. `existing` is how many alerts are stored now. */
export function parseAlertInput(body: unknown, existing: number): Required<AlertInput> {
  const b = record(body);
  if (existing >= MAX_ALERTS) throw new InputError(`At most ${MAX_ALERTS} alerts are allowed; delete one first`);
  const provider = typeof b.provider === 'string' ? b.provider : '';
  if (!adapters.has(provider)) {
    throw new InputError(`Unknown provider "${provider}". Use one of: ${PROVIDER_CATALOG.filter((p) => adapters.has(p.id)).map((p) => p.id).join(', ')}.`);
  }
  if (typeof b.symbol !== 'string') throw new InputError('symbol must be a string');
  const symbol = b.symbol.trim().toUpperCase();
  if (!symbol) throw new InputError('Missing symbol');
  if (symbol.length > MAX_SYMBOL) throw new InputError(`symbol must be at most ${MAX_SYMBOL} characters`);
  return { provider, symbol, condition: parseCondition(b.condition), level: parseLevel(b.level), note: parseNote(b.note) };
}

/** Validates an edit body; a field left out keeps its value. */
export function parseAlertEdit(body: unknown): AlertEdit {
  const b = record(body);
  const edit: AlertEdit = {};
  if (b.condition !== undefined) edit.condition = parseCondition(b.condition);
  if (b.level !== undefined) edit.level = parseLevel(b.level);
  if (b.note !== undefined) edit.note = parseNote(b.note);
  return edit;
}

export function newAlert(input: Required<AlertInput>, id: string, now: number): Alert {
  return { id, ...input, createdAt: now, status: 'active', lastPrice: null, triggeredAt: null, triggerPrice: null };
}

/** Applies an edit and re-arms the alert. */
export function editAlert(alert: Alert, edit: AlertEdit): Alert {
  return {
    ...alert,
    condition: edit.condition ?? alert.condition,
    level: edit.level ?? alert.level,
    note: edit.note ?? alert.note,
    status: 'active',
    lastPrice: null,
    triggeredAt: null,
    triggerPrice: null,
  };
}

/**
 * The alert after seeing `price` (the latest trade): the same object when
 * nothing changes. The first price only records the side the market is on; a
 * triggered alert is never evaluated again until it is edited.
 */
export function evaluate(alert: Alert, price: number, now: number): Alert {
  if (alert.status !== 'active' || !Number.isFinite(price)) return alert;
  const last = alert.lastPrice;
  if (last === null) return { ...alert, lastPrice: price };
  const up = last < alert.level && price >= alert.level;
  const down = last > alert.level && price <= alert.level;
  const fires = alert.condition === 'crossing-up' ? up : alert.condition === 'crossing-down' ? down : up || down;
  if (fires) return { ...alert, lastPrice: price, status: 'triggered', triggeredAt: now, triggerPrice: price };
  return last === price ? alert : { ...alert, lastPrice: price };
}
