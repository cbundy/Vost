import { useLayoutEffect, useRef } from 'react';
import { TEXT_MAX } from '../lib/drawings';

type Props = {
  /** Pixel position inside the chart area (the top-left corner of the note). */
  left: number;
  top: number;
  initialText: string;
  onCommit(text: string): void;
  onCancel(): void;
};

/** A single-line input over the chart where a note is typed. Enter or blur commits, Escape cancels. */
export function DrawingTextEditor({ left, top, initialText, onCommit, onCancel }: Props) {
  const ref = useRef<HTMLInputElement | null>(null);
  const done = useRef(false);

  // Focus inside the gesture that opened it (the caller renders synchronously), so a phone keyboard can open.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit) onCommit(ref.current?.value ?? '');
    else onCancel();
  };

  return (
    <input
      ref={ref}
      className="drawing-text-editor"
      aria-label="Note text"
      type="text"
      maxLength={TEXT_MAX}
      defaultValue={initialText}
      style={{ left, top }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          finish(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          finish(false);
        }
      }}
      onBlur={() => finish(true)}
    />
  );
}
