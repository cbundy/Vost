/** The server engine bundle's entry (built to server/dist/engine.mjs): runs inside a worker thread and speaks the bridge's protocol to the parent. */
import { parentPort } from 'node:worker_threads';
import { attachBridge } from './bridge';

if (parentPort) attachBridge(parentPort);
