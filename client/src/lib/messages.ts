/** Pure helpers for the in-app message log ("inbox"). */

export type MessageSeverity = 'info' | 'success' | 'warning' | 'error';

export interface InboxMessage {
  id: string;
  time: number;
  source: string;
  severity: MessageSeverity;
  text: string;
  read: boolean;
}

export const MAX_MESSAGES = 200;

/** Append a message and keep only the newest `cap`. */
export function appendMessage(list: InboxMessage[], msg: InboxMessage, cap = MAX_MESSAGES): InboxMessage[] {
  const next = [...list, msg];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

export function unreadCount(list: InboxMessage[]): number {
  return list.reduce((n, m) => (m.read ? n : n + 1), 0);
}

export function markAllRead(list: InboxMessage[]): InboxMessage[] {
  return list.some((m) => !m.read) ? list.map((m) => (m.read ? m : { ...m, read: true })) : list;
}

export function formatClose(ev: { code?: number; reason?: string; wasClean?: boolean }): string {
  return `close code ${ev.code ?? 'unknown'}, reason ${ev.reason ? `"${ev.reason}"` : '(none)'}, wasClean ${String(ev.wasClean ?? false)}`;
}
