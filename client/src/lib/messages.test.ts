import { describe, expect, it } from 'vitest';
import { appendMessage, formatClose, markAllRead, unreadCount, type InboxMessage } from './messages';

const m = (id: string, read = false): InboxMessage => ({ id, time: 1, source: 'Data', severity: 'error', text: id, read });

describe('messages', () => {
  it('caps to the newest entries', () => {
    let l: InboxMessage[] = [];
    for (let i = 0; i < 5; i++) l = appendMessage(l, m(String(i)), 3);
    expect(l.map((x) => x.id)).toEqual(['2', '3', '4']);
  });
  it('counts and clears unread', () => {
    const l = [m('a'), m('b', true), m('c')];
    expect(unreadCount(l)).toBe(2);
    expect(unreadCount(markAllRead(l))).toBe(0);
  });
  it('formats a close event', () => {
    expect(formatClose({ code: 1006, reason: '', wasClean: false })).toBe('close code 1006, reason (none), wasClean false');
  });
});
