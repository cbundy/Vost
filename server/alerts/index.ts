/**
 * Price alerts: the stored list, the evaluator that watches prices for it and
 * the HTTP route. `createAlerts` loads the file, starts watching and returns
 * the handler `server/main.ts` mounts at `/api/alerts`.
 */
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Alert } from '../../shared/alerts.ts';
import type { Relay } from '../live/relay.ts';
import type { Timers } from '../live/socket.ts';
import { adapters as defaultAdapters } from '../providers/index.ts';
import { createSymbolCache } from '../providers/symbolCache.ts';
import type { AdapterContext, ProviderAdapter } from '../providers/types.ts';
import { createEvaluator } from './evaluator.ts';
import { editAlert, evaluate, newAlert, parseAlertEdit, parseAlertInput } from './model.ts';
import { handleAlerts } from './route.ts';
import { createAlertStore, type AlertStore } from './store.ts';

export { isAlertsPath } from './route.ts';

export interface AlertSubscriber {
  onAlerts(alerts: Alert[]): void;
  onTriggered(alert: Alert): void;
  onEnd(): void;
}

export interface AlertsService {
  list(): Alert[];
  readonly writable: boolean;
  create(body: unknown): Promise<Alert>;
  edit(id: string, body: unknown): Promise<Alert | null>;
  remove(id: string): Promise<boolean>;
  /** Stream listener; returns the function that removes it. */
  subscribe(sub: AlertSubscriber): () => void;
}

export interface AlertsDeps {
  dataDir: string;
  /** Seconds between polls of providers without a live feed. */
  pollSeconds?: number;
  relay: Relay;
  adapters?: ReadonlyMap<string, ProviderAdapter>;
  ctx?: () => AdapterContext;
  timers?: Timers;
  now?: () => number;
  log?: (line: string) => void;
  store?: AlertStore;
  /** Called once per firing, after the trigger is persisted. */
  onTriggered?: (alert: Alert) => void;
  heartbeatMs?: number;
}

export interface Alerts {
  handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void>;
  service: AlertsService;
  /** Adds a firing listener (the Telegram notifier plugs in here). */
  onTriggered(listener: (alert: Alert) => void): void;
  /** Stops watching, ends the streams and writes held price changes. */
  stop(): Promise<void>;
}

class StoreError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'StoreError';
  }
}

export async function createAlerts(deps: AlertsDeps): Promise<Alerts> {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((line: string) => console.log(line));
  const store = deps.store ?? createAlertStore({ dir: deps.dataDir, now, log });
  const listeners: ((alert: Alert) => void)[] = deps.onTriggered ? [deps.onTriggered] : [];
  const subscribers = new Set<AlertSubscriber>();

  const symbols = createSymbolCache();
  let alerts: Alert[] = await store.load();
  if (!store.writable) log(`[alerts] data dir ${deps.dataDir} is not writable: alerts can be read but not changed (check VOST_DATA_DIR)`);

  const each = <T>(set: Iterable<T>, fn: (item: T) => void): void => {
    for (const item of [...set]) {
      try {
        fn(item);
      } catch (err) {
        log(`[alerts] listener failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };
  const announce = (): void => each(subscribers, (s) => s.onAlerts([...alerts]));

  const persist = (): Promise<void> => store.save([...alerts]);

  const evaluator = createEvaluator({
    relay: deps.relay,
    adapters: deps.adapters ?? defaultAdapters,
    ctx: deps.ctx ?? (() => ({ symbols })),
    timers: deps.timers,
    pollSeconds: deps.pollSeconds,
    log,
    alerts: () => alerts,
    onPrice(provider, symbol, price) {
      const fired: Alert[] = [];
      let changed = false;
      alerts = alerts.map((a) => {
        if (a.provider !== provider || a.symbol !== symbol) return a;
        const next = evaluate(a, price, now());
        if (next !== a) changed = true;
        if (next.status === 'triggered' && a.status === 'active') fired.push(next);
        return next;
      });
      if (!changed) return;
      if (fired.length === 0) return store.saveLazy([...alerts]);
      void (async () => {
        try {
          await persist();
        } catch (err) {
          log(`[alerts] could not save the trigger: ${err instanceof Error ? err.message : String(err)}`);
        }
        for (const a of fired) {
          log(`[alerts] fired ${a.id} ${a.provider} ${a.symbol} ${a.condition} ${a.level} at ${a.triggerPrice}`);
          each(listeners, (l) => l(a));
          each(subscribers, (s) => s.onTriggered(a));
        }
        announce();
      })();
      evaluator.sync();
    },
  });

  /** Runs a change in memory, saves it, and undoes it when the save fails. */
  const change = async <T>(apply: () => { value: T; undo: () => void }): Promise<T> => {
    const { value, undo } = apply();
    try {
      await persist();
    } catch (err) {
      undo();
      throw new StoreError(err);
    }
    announce();
    evaluator.sync();
    return value;
  };

  const service: AlertsService = {
    list: () => [...alerts],
    get writable() {
      return store.writable;
    },
    create: (body) =>
      change(() => {
        const alert = newAlert(parseAlertInput(body, alerts.length), randomUUID(), now());
        alerts = [...alerts, alert];
        return { value: alert, undo: () => void (alerts = alerts.filter((a) => a.id !== alert.id)) };
      }),
    async edit(id, body) {
      const edit = parseAlertEdit(body);
      const before = alerts.find((a) => a.id === id);
      if (!before) return null;
      return change(() => {
        const after = editAlert(before, edit);
        alerts = alerts.map((a) => (a.id === id ? after : a));
        return { value: after, undo: () => void (alerts = alerts.map((a) => (a.id === id ? before : a))) };
      });
    },
    async remove(id) {
      const index = alerts.findIndex((a) => a.id === id);
      if (index < 0) return false;
      const gone = alerts[index];
      return change(() => {
        alerts = alerts.filter((a) => a.id !== id);
        return { value: true, undo: () => void (alerts = [...alerts.slice(0, index), gone, ...alerts.slice(index)]) };
      });
    },
    subscribe(sub) {
      subscribers.add(sub);
      sub.onAlerts([...alerts]);
      return () => void subscribers.delete(sub);
    },
  };

  evaluator.sync();

  return {
    handle: (req, res, url) => handleAlerts(req, res, url, service, log, deps.heartbeatMs),
    service,
    onTriggered: (listener) => void listeners.push(listener),
    async stop() {
      evaluator.stop();
      each(subscribers, (s) => s.onEnd());
      subscribers.clear();
      await store.flush();
    },
  };
}
