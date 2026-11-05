/** The strategy maker's worker: training, search and validation run here so the page never freezes. Created only by engineClient. */
import { createHost } from './engineHost';
import type { Request } from './protocol';

const ctx = self as unknown as { onmessage: ((ev: MessageEvent<Request>) => void) | null; postMessage: (msg: unknown) => void };
const host = createHost((reply) => ctx.postMessage(reply));
ctx.onmessage = (ev) => host.receive(ev.data);
