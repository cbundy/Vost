import { MoreIcon } from './Icons';
import { useEffect, useRef, useState, type ReactNode } from 'react';

/** A top-bar icon button and its popover: closes on outside click, resize and Escape (focus back to the button). */
export function TopBarPopover({
  label,
  icon,
  title,
  className,
  wrapClass = 'topbar-popwrap',
  align,
  children,
}: {
  label: string;
  icon: ReactNode;
  title?: string;
  /** Extra class for the pop-up. */
  className?: string;
  /** Class of the wrapper around the button and pop-up. */
  wrapClass?: string;
  align: 'left' | 'right';
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [left, setLeft] = useState(8);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (ev: MouseEvent) => {
      if (!wrapRef.current?.contains(ev.target as Node)) setOpen(false);
    };
    const onResize = () => setOpen(false);
    // On the document, so Escape still works when focus fell to the page (a disabled Load button drops it).
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      close(true);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  // A left-aligned pop-up starts under its button, clamped to stay 8px inside the viewport.
  useEffect(() => {
    if (!open || align !== 'left') return;
    const btn = btnRef.current;
    const pop = popRef.current;
    if (!btn || !pop) return;
    const max = document.documentElement.clientWidth - 8 - pop.offsetWidth;
    setLeft(Math.max(8, Math.min(btn.getBoundingClientRect().left, max)));
  });

  return (
    <div
      className={wrapClass}
      ref={wrapRef}
    >
      <button
        ref={btnRef}
        className="ghost"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        title={title ?? label}
        onClick={() => setOpen((v) => !v)}
      >
        {icon}
      </button>
      {open && (
        <div
          ref={popRef}
          className={`topbar-more-pop${align === 'left' ? ' topbar-pop-left' : ''}${className ? ` ${className}` : ''}`}
          style={align === 'left' ? { left } : undefined}
          role="dialog"
          aria-label={label}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/** The top bar's "More" button and its popover; the children are the controls that do not fit the row. */
export function TopBarMore({ children }: { children: (close: () => void) => ReactNode }) {
  return (
    <TopBarPopover label="More" icon={<MoreIcon />} align="right" wrapClass="topbar-more">
      {children}
    </TopBarPopover>
  );
}
