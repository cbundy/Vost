/** Errors the API maps to a status: 400, 404 and 502. Plain classes (erasable syntax only). */

/** The request itself is wrong (400). */
export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputError';
  }
}

/** The provider answered but has nothing for the symbol (404). */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

/** The upstream failed or answered something unusable (502). */
export class UpstreamError extends Error {
  provider: string;
  host: string;
  /** HTTP status of the upstream answer, or null when there was none (network error, timeout). */
  status: number | null;
  /** First 180 characters of the upstream body. */
  body: string;

  constructor(provider: string, host: string, status: number | null, body: string, message?: string) {
    super(message ?? (status === null ? `${provider}: ${body}` : `${provider}: HTTP ${status}${body ? ` - ${body}` : ''}`));
    this.name = 'UpstreamError';
    this.provider = provider;
    this.host = host;
    this.status = status;
    this.body = body;
  }
}
