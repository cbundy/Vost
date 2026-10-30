import { useLayoutEffect, useRef, useState } from 'react';
import { TEXT_MAX } from '../lib/drawings';
import { noteFont, noteLine } from '../lib/textLayout';
import { NOTE_PAD, boxOpts, layoutOf } from './chart/tools/textBox';

type Props = {
  /** Pixel position inside the chart area (the top-left corner of the note). */
  left: number;
  top: number;
  initialText: string;
  /** The tool's resolved style values: font, size, bold, italic, alignment and wrap. */
  style: Readonly<Record<string, unknown>>;
  onCommit(text: string): void;
  onCancel(): void;
};

/**
 * A multi-line input over the chart where a note is typed, in the tool's font and alignment. It grows with its
 * text. Enter adds a line, Ctrl+Enter or Cmd+Enter or leaving it commits, Escape cancels.
 */
export function DrawingTextEditor({ left, top, initialText, style, onCommit, onCancel }: Props) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const done = useRef(false);
  const [value, setValue] = useState(initialText);
  const opts = boxOpts(style);
  // A wrapping note is as wide as its wrap width; one that does not wrap is as wide as its text (plus the caret).
  const width = opts.wrap ? opts.wrapWidth + NOTE_PAD * 2 : Math.max(layoutOf(value, style).width, 40 + NOTE_PAD * 2) + 2;

  // Focus inside the gesture that opened it (the caller renders synchronously), so a phone keyboard can open.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  // Grow with the text: measure the content at the current width.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value, width, opts.size]);

  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit) onCommit(ref.current?.value ?? '');
    else onCancel();
  };

  return (
    <textarea
      ref={ref}
      className="drawing-text-editor"
      aria-label="Note text"
      rows={1}
      maxLength={TEXT_MAX}
      value={value}
      wrap={opts.wrap ? 'soft' : 'off'}
      style={{
        left,
        top,
        width,
        font: noteFont(opts),
        lineHeight: `${noteLine(opts.size)}px`,
        textAlign: opts.align,
        // The 1px border takes one pixel of the padding, so the text sits where the chart draws it.
        padding: NOTE_PAD - 1,
        whiteSpace: opts.wrap ? 'pre-wrap' : 'pre',
      }}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          e.stopPropagation();
          finish(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          finish(false);
        } else if (e.key === 'Enter') {
          e.stopPropagation();
        }
      }}
      onBlur={() => finish(true)}
    />
  );
}
