import { readFileSync, readdirSync } from 'node:fs';
import { StringStream } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import { describe, expect, it } from 'vitest';
import { errorToDiagnostic, messageToError, pineCompletions, pineParser } from './language';

const dir = new URL('./fixtures/', import.meta.url);

function tokens(src: string): Array<[string, string | null]> {
  const out: Array<[string, string | null]> = [];
  for (const line of src.split('\n')) {
    const s = new StringStream(line, 4, 2);
    while (!s.eol()) {
      s.start = s.pos;
      const t = pineParser.token(s, {});
      if (s.pos === s.start) s.next();
      out.push([s.current(), t]);
    }
  }
  return out;
}
const kind = (src: string, text: string) => tokens(src).find(([w]) => w === text)?.[1];

describe('pine tokenizer', () => {
  it('classifies each token class', () => {
    const src = '//@version=6\n// note\nvar int x = 3.5\nif close > 1 and not true\n    s = "a b"\nta.sma(close, 14)';
    expect(kind(src, '//@version=6')).toBe('meta');
    expect(kind(src, '// note')).toBe('comment');
    expect(kind(src, 'var')).toBe('keyword');
    expect(kind(src, 'and')).toBe('keyword');
    expect(kind(src, 'int')).toBe('typeName');
    expect(kind(src, '3.5')).toBe('number');
    expect(kind(src, '"a b"')).toBe('string');
    expect(kind(src, 'ta')).toBe('namespace');
  });

  it('tokenizes every fixture without stalling and finds annotation, namespace and number', () => {
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.pine'))) {
      const toks = tokens(readFileSync(new URL(f, dir), 'utf8'));
      expect(toks.length).toBeGreaterThan(0);
    }
    const all = tokens(readFileSync(new URL('ema-cross.pine', dir), 'utf8'));
    expect(all.some(([, t]) => t === 'meta')).toBe(true);
    expect(all.some(([, t]) => t === 'namespace')).toBe(true);
    expect(all.some(([, t]) => t === 'number')).toBe(true);
  });
});

describe('pine completions', () => {
  const at = (doc: string) => pineCompletions(new CompletionContext(EditorState.create({ doc }), doc.length, false));
  it('offers ta functions after "ta."', () => {
    const labels = at('x = ta.')!.options.map((o) => o.label);
    for (const n of ['sma', 'ema', 'rsi', 'crossover']) expect(labels).toContain(n);
  });
  it('offers namespaces for a plain word', () => {
    expect(at('st')!.options.map((o) => o.label)).toContain('strategy');
  });
  it('offers nothing after an unknown namespace', () => {
    expect(at('foo.')).toBeNull();
  });
});

describe('errorToDiagnostic', () => {
  const doc = 'abc\ndefg\nhi';
  it('maps line/column to offsets', () => {
    const d = errorToDiagnostic({ message: 'm', line: 2, column: 3 }, doc)!;
    expect(d.from).toBe(6);
    expect(d.to).toBe(8);
    expect(d.severity).toBe('error');
  });
  it('clamps out-of-range values', () => {
    const d = errorToDiagnostic({ message: 'm', line: 99, column: 99 }, doc)!;
    expect(d.from).toBe(doc.length);
    expect(d.to).toBe(doc.length);
    expect(errorToDiagnostic({ message: 'm', line: 0, column: 0 }, doc)!.from).toBe(0);
  });
  it('returns null without a line', () => {
    expect(errorToDiagnostic({ message: 'm' }, doc)).toBeNull();
  });
});

describe('messageToError', () => {
  it('reads "at L:C"', () => {
    expect(messageToError('Syntax error at 3:7')).toEqual({ message: 'Syntax error at 3:7', line: 3, column: 7 });
    expect(messageToError('boom')).toEqual({ message: 'boom' });
  });
});
