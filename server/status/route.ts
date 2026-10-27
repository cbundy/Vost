/** `GET /api/status` (add `?refresh=1` to run a full round first). */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiError } from '../../shared/market.ts';
import { sendJson } from '../respond.ts';
import type { StatusService } from './scheduler.ts';

export async function handleStatus(req: IncomingMessage, res: ServerResponse, url: URL, status: StatusService): Promise<void> {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Only GET is supported' } satisfies ApiError);
  }
  const refresh = url.searchParams.get('refresh') === '1';
  const refreshed = refresh ? (await status.scheduler.refresh()).refreshed : undefined;
  sendJson(res, 200, { ...status.response(), ...(refreshed === undefined ? {} : { refreshed }) });
}
