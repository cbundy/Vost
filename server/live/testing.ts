/** Test doubles for the live relay: a fake websocket class and a fake timer set. */
import type { Timers, WebSocketCtor, WsLike } from './socket.ts';

export class FakeWS implements WsLike {
  static instances: FakeWS[] = [];
  static reset(): void {
    FakeWS.instances = [];
  }
  static get last(): FakeWS {
    return FakeWS.instances[FakeWS.instances.length - 1];
  }
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code?: number; reason?: string; wasClean?: boolean }) => void) | null = null;
  sent: string[] = [];
  closed = false;
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeWS.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
  }
  // test helpers
  open(): void {
    this.onopen?.();
  }
  message(data: unknown): void {
    this.onmessage?.({ data });
  }
  drop(code = 1006, reason = ''): void {
    this.onclose?.({ code, reason, wasClean: false });
  }
}
export const FakeWebSocket = FakeWS as unknown as WebSocketCtor;

interface Pending {
  id: number;
  at: number;
  every?: number;
  fn: () => void;
}

/** Manual clock: nothing runs until `advance()`. `pending` is what is still scheduled. */
export function fakeTimers(): Timers & { advance(ms: number): void; readonly pending: number; delays(): number[] } {
  let now = 0;
  let nextId = 1;
  const list: Pending[] = [];
  const add = (fn: () => void, ms: number, every?: number): number => {
    const t = { id: nextId++, at: now + ms, every, fn };
    list.push(t);
    return t.id;
  };
  const remove = (id: unknown): void => {
    const i = list.findIndex((t) => t.id === id);
    if (i >= 0) list.splice(i, 1);
  };
  return {
    setTimeout: (fn, ms) => add(fn, ms),
    clearTimeout: remove,
    setInterval: (fn, ms) => add(fn, ms, ms),
    clearInterval: remove,
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = list.filter((t) => t.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!due) break;
        now = due.at;
        if (due.every) due.at += due.every;
        else remove(due.id);
        due.fn();
      }
      now = end;
    },
    get pending() {
      return list.length;
    },
    delays: () => list.map((t) => t.at - now),
  };
}
