import { describe, expect, it } from 'vitest';
import { liveIndicator } from './liveIndicator';

describe('liveIndicator', () => {
  it('maps each status to a dot class and words', () => {
    expect(liveIndicator('live')).toEqual({ dotClass: '', label: 'Live: on' });
    expect(liveIndicator('connecting')).toEqual({ dotClass: 'connecting', label: 'Live: connecting' });
    expect(liveIndicator('reconnecting')).toEqual({ dotClass: 'connecting', label: 'Live: reconnecting' });
    expect(liveIndicator('error').dotClass).toBe('error');
    expect(liveIndicator('off')).toEqual({ dotClass: 'off', label: 'Live: off - click to stream live candles' });
  });
  it('off is not the error colour', () => {
    expect(liveIndicator('off').dotClass).not.toBe('error');
  });
  it('error carries the detail and the inbox hint', () => {
    const { label } = liveIndicator('error', 'socket closed');
    expect(label).toContain('socket closed');
    expect(label).toContain('open the inbox');
    expect(liveIndicator('error').label).toBe('Live: error - click to open the inbox');
  });
});
