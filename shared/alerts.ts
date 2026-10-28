/** Wire types of the price-alert API (`/api/alerts`), shared by the server and the client. Times are unix ms. */

export type AlertCondition = 'crossing-up' | 'crossing-down' | 'crossing';

export const ALERT_CONDITIONS: readonly AlertCondition[] = ['crossing-up', 'crossing-down', 'crossing'];

export type AlertStatus = 'active' | 'triggered';

export interface Alert {
  id: string;
  provider: string;
  symbol: string;
  condition: AlertCondition;
  level: number;
  note: string;
  createdAt: number;
  status: AlertStatus;
  /** The last price the server saw; null until the first observation. */
  lastPrice: number | null;
  triggeredAt: number | null;
  triggerPrice: number | null;
}

/** Body of `POST /api/alerts`. */
export interface AlertInput {
  provider: string;
  symbol: string;
  condition: AlertCondition;
  level: number;
  note?: string;
}

/** Body of `PUT /api/alerts/<id>`: what may change. Any edit re-arms a triggered alert. */
export interface AlertEdit {
  condition?: AlertCondition;
  level?: number;
  note?: string;
}

/** Event names of the `GET /api/alerts/events` stream. */
export interface AlertEvents {
  /** The full list, on connect and after every change. */
  alerts: { alerts: Alert[] };
  /** One alert that just fired. */
  triggered: Alert;
}
