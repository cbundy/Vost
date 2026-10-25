import { describe, expect, it } from 'vitest';
import {
  fmtClock,
  fmtTick,
  fmtOffset,
  formatInZone,
  isValidTimeZone,
  listTimeZones,
  zonedTimeToUtc,
  zoneOffsetMinutes,
} from './time';

const utc = (y: number, m: number, d: number, h = 0, min = 0) => Date.UTC(y, m - 1, d, h, min) / 1000;
const NY = 'America/New_York';

describe('time helpers', () => {
  it('formatInZone formats a fixed timestamp per zone', () => {
    const t = 1355320800; // 2012-12-12 14:00 UTC
    expect(formatInZone(t, 'UTC')).toBe('12 Dec 2012, 14:00');
    expect(formatInZone(t, NY)).toBe('12 Dec 2012, 09:00');
    expect(formatInZone(t, 'Asia/Tehran')).toBe('12 Dec 2012, 17:30');
    expect(formatInZone(t, 'Asia/Tehran', { dateOnly: true })).toBe('12 Dec 2012');
  });

  it('formats midnight as 00:00 not 24:00', () => {
    expect(formatInZone(utc(2024, 1, 1, 0, 5), 'UTC')).toBe('01 Jan 2024, 00:05');
  });

  it('zoneOffsetMinutes follows DST', () => {
    expect(zoneOffsetMinutes(NY, utc(2024, 3, 10, 6, 59))).toBe(-300);
    expect(zoneOffsetMinutes(NY, utc(2024, 3, 10, 7, 0))).toBe(-240);
    expect(zoneOffsetMinutes('Asia/Tehran', utc(2024, 1, 1))).toBe(210);
    expect(zoneOffsetMinutes('UTC', utc(2024, 1, 1))).toBe(0);
  });

  it('fmtOffset', () => {
    expect(fmtOffset(0)).toBe('+00:00');
    expect(fmtOffset(210)).toBe('+03:30');
    expect(fmtOffset(-300)).toBe('-05:00');
  });

  it('fmtClock shows HH:mm and a zone name', () => {
    expect(fmtClock(utc(2024, 1, 1, 14, 5), 'UTC')).toBe('14:05 UTC');
    expect(fmtClock(utc(2024, 1, 1, 14, 5), NY)).toBe('09:05 GMT-5');
  });

  it('zonedTimeToUtc handles normal, skipped and repeated times', () => {
    expect(zonedTimeToUtc(2024, 1, 15, 12, 0, 'UTC')).toBe(utc(2024, 1, 15, 12, 0));
    expect(zonedTimeToUtc(2024, 1, 15, 12, 0, 'Asia/Tehran')).toBe(utc(2024, 1, 15, 8, 30));
    expect(zonedTimeToUtc(2024, 1, 15, 12, 0, NY)).toBe(utc(2024, 1, 15, 17, 0));
    // skipped hour: 02:30 does not exist, moves forward to 03:30 EDT = 07:30 UTC
    expect(zonedTimeToUtc(2024, 3, 10, 2, 30, NY)).toBe(utc(2024, 3, 10, 7, 30));
    // repeated hour: 01:30 happens twice, earlier is EDT = 05:30 UTC
    expect(zonedTimeToUtc(2024, 11, 3, 1, 30, NY)).toBe(utc(2024, 11, 3, 5, 30));
  });

  it('listTimeZones starts with UTC and has the IANA zones', () => {
    const zones = listTimeZones();
    expect(zones[0]).toBe('UTC');
    expect(zones).toContain(NY);
    expect(zones.filter((z) => z === 'UTC')).toHaveLength(1);
  });

  it('isValidTimeZone', () => {
    expect(isValidTimeZone('Asia/Tehran')).toBe(true);
    expect(isValidTimeZone('Nope/Zone')).toBe(false);
    expect(isValidTimeZone(42)).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});

describe('fmtTick', () => {
  it('picks the shape from the tick type in the zone', () => {
    const t = utc(2024, 3, 12, 22, 0);
    expect(fmtTick(t, 0, 'UTC')).toBe('2024');
    expect(fmtTick(t, 1, 'UTC')).toBe('Mar');
    expect(fmtTick(t, 2, 'UTC')).toBe('12');
    expect(fmtTick(t, 3, 'UTC')).toBe('22:00');
    expect(fmtTick(t, 2, 'Asia/Tehran')).toBe('13');
    expect(fmtTick(t, 3, 'Asia/Tehran')).toBe('01:30');
  });
});
