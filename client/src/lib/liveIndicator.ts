export type LiveStatus = 'off' | 'connecting' | 'live' | 'reconnecting' | 'error';

/** The Live dot's CSS class (empty = live green) and its words, for the tooltip and the aria-label. */
export function liveIndicator(status: LiveStatus, detail?: string): { dotClass: string; label: string } {
  switch (status) {
    case 'live':
      return { dotClass: '', label: 'Live: on' };
    case 'connecting':
      return { dotClass: 'connecting', label: 'Live: connecting' };
    case 'reconnecting':
      return { dotClass: 'connecting', label: 'Live: reconnecting' };
    case 'error':
      return { dotClass: 'error', label: `Live: error${detail ? ` (${detail})` : ''} - click to open the inbox` };
    default:
      return { dotClass: 'off', label: 'Live: off - click to stream live candles' };
  }
}
