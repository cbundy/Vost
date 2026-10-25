import { useEffect, useMemo, useRef, useState } from 'react';
import { browserTimeZone, fmtClock, fmtOffset, listTimeZones, zoneOffsetMinutes } from '../lib/time';
import { useStore } from '../state/store';

interface ZoneRow {
  tz: string;
  offset: string;
  local: boolean;
}

export function ZoneClock() {
  const timeZone = useStore((s) => s.timeZone);
  const setTimeZone = useStore((s) => s.setTimeZone);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  /* Tick on the minute boundary, then every minute. */
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    const tick = () => setNow(Date.now() / 1000);
    const timeout = setTimeout(() => {
      tick();
      interval = setInterval(tick, 60_000);
    }, 60_000 - (Date.now() % 60_000) + 50);
    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (ev: MouseEvent) => {
      if (!wrapRef.current?.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const rows = useMemo<ZoneRow[]>(() => {
    if (!open) return [];
    const at = Date.now() / 1000;
    const local = browserTimeZone();
    const zones = listTimeZones();
    const ordered = ['UTC', ...(local !== 'UTC' ? [local] : []), ...zones.filter((z) => z !== 'UTC' && z !== local)];
    return ordered.map((tz) => ({ tz, offset: `UTC${fmtOffset(zoneOffsetMinutes(tz, at))}`, local: tz === local }));
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.tz.toLowerCase().includes(q) || r.offset.toLowerCase().includes(q));
  }, [rows, query]);

  useEffect(() => setActiveIdx(0), [query, open]);
  useEffect(() => {
    listRef.current?.querySelector('.zone-row.active')?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, open]);

  const close = () => {
    setOpen(false);
    setQuery('');
  };
  const pick = (tz: string) => {
    setTimeZone(tz);
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const r = filtered[activeIdx];
      if (r) pick(r.tz);
    }
  };

  return (
    <div className="zone-clock" ref={wrapRef}>
      <button
        className="ghost zone-clock-btn"
        title={`Time zone: ${timeZone}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {fmtClock(now, timeZone)}
      </button>
      {open && (
        <div className="zone-pop" onKeyDown={onKeyDown}>
          <input
            autoFocus
            className="zone-search"
            placeholder="Search time zone or offset"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="zone-list" role="listbox" ref={listRef}>
            {filtered.length === 0 && <div className="zone-empty">No matching zone</div>}
            {filtered.map((r, i) => (
              <div
                key={r.tz}
                role="option"
                aria-selected={r.tz === timeZone}
                className={`zone-row${i === activeIdx ? ' active' : ''}${r.tz === timeZone ? ' current' : ''}`}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => pick(r.tz)}
              >
                <span className="zone-name">
                  {r.tz}
                  {r.local && <span className="zone-local"> (local)</span>}
                </span>
                <span className="zone-off">{r.offset}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
