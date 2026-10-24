import { StreamLanguage, type StreamParser } from '@codemirror/language';
import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import type { Diagnostic } from '@codemirror/lint';

export const PINE_KEYWORDS = [
  'if', 'else', 'for', 'to', 'by', 'in', 'while', 'switch', 'var', 'varip', 'and', 'or', 'not',
  'true', 'false', 'import', 'export', 'method', 'type', 'break', 'continue', 'return',
];
export const PINE_TYPES = [
  'int', 'float', 'bool', 'string', 'color', 'series', 'simple', 'const', 'array', 'map', 'matrix', 'label', 'line', 'box', 'table',
];

/** Namespace -> member functions offered after "ns.". */
export const PINE_NAMESPACES: Record<string, string[]> = {
  ta: [
    'sma', 'ema', 'rma', 'wma', 'vwma', 'hma', 'swma', 'alma', 'rsi', 'macd', 'bb', 'bbw', 'atr', 'tr', 'stoch',
    'crossover', 'crossunder', 'cross', 'highest', 'lowest', 'change', 'mom', 'roc', 'cci', 'cmo', 'mfi', 'obv',
    'sar', 'supertrend', 'stdev', 'variance', 'dev', 'median', 'linreg', 'pivothigh', 'pivotlow', 'valuewhen',
    'barssince', 'cum', 'kc', 'tsi', 'wpr', 'falling', 'rising',
  ],
  math: [
    'abs', 'ceil', 'floor', 'round', 'sqrt', 'pow', 'exp', 'log', 'log10', 'max', 'min', 'sign', 'sum', 'avg',
    'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'random', 'round_to_mintick', 'pi', 'e',
  ],
  strategy: [
    'entry', 'exit', 'close', 'close_all', 'order', 'cancel', 'cancel_all', 'long', 'short',
    'position_size', 'position_avg_price', 'equity', 'netprofit', 'initial_capital', 'percent_of_equity', 'fixed', 'cash',
  ],
  input: ['int', 'float', 'bool', 'string', 'color', 'source', 'symbol', 'timeframe', 'time', 'price', 'session', 'text_area'],
  color: [
    'new', 'rgb', 'from_gradient', 'r', 'g', 'b', 't', 'red', 'green', 'blue', 'orange', 'yellow', 'lime', 'teal',
    'aqua', 'navy', 'fuchsia', 'purple', 'maroon', 'olive', 'silver', 'gray', 'white', 'black',
  ],
  request: ['security', 'security_lower_tf', 'dividends', 'earnings', 'splits', 'financial', 'economic', 'currency_rate'],
  str: ['tostring', 'tonumber', 'format', 'length', 'contains', 'replace', 'split', 'substring', 'upper', 'lower', 'trim', 'startswith', 'endswith'],
};

const TOP_LEVEL_FUNCTIONS = [
  'indicator', 'strategy', 'library', 'plot', 'plotshape', 'plotchar', 'plotcandle', 'plotbar', 'hline', 'fill',
  'bgcolor', 'barcolor', 'alert', 'alertcondition', 'nz', 'na', 'fixnan', 'int', 'float', 'bool', 'string',
];
const BUILTIN_VARS = ['open', 'high', 'low', 'close', 'volume', 'hl2', 'hlc3', 'ohlc4', 'hlcc4', 'time', 'bar_index', 'na'];

const keywordSet = new Set(PINE_KEYWORDS);
const typeSet = new Set(PINE_TYPES);
const namespaceSet = new Set(Object.keys(PINE_NAMESPACES));
const builtinSet = new Set(BUILTIN_VARS);

/** Token names are the highlight tags the editor theme maps (see PineEditor). */
export type PineToken = 'keyword' | 'typeName' | 'namespace' | 'meta' | 'comment' | 'string' | 'number' | 'variableName' | 'operator';

export const pineParser: StreamParser<unknown> = {
  name: 'pine',
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match(/^\/\/@\w+/)) {
      stream.skipToEnd();
      return 'meta';
    }
    if (stream.match('//')) {
      stream.skipToEnd();
      return 'comment';
    }
    const q = stream.peek();
    if (q === '"' || q === "'") {
      stream.next();
      let esc = false;
      let c: string | void;
      while ((c = stream.next()) != null) {
        if (c === q && !esc) break;
        esc = !esc && c === '\\';
      }
      return 'string';
    }
    if (stream.match(/^(?:0x[0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/)) return 'number';
    if (stream.match(/^[A-Za-z_]\w*/)) {
      const w = stream.current();
      if (keywordSet.has(w)) return 'keyword';
      if (typeSet.has(w) && stream.peek() !== '.' && stream.peek() !== '(') return 'typeName';
      if (namespaceSet.has(w) && stream.peek() === '.') return 'namespace';
      if (builtinSet.has(w)) return 'variableName.special';
      return null;
    }
    if (stream.match(/^[-+*/%<>=!?:]+/)) return 'operator';
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: '//' } },
};

export const pineLanguage = StreamLanguage.define(pineParser);

/** Autocomplete: namespace members after "ns.", otherwise namespaces, keywords and common functions. */
export function pineCompletions(context: CompletionContext): CompletionResult | null {
  const member = context.matchBefore(/\b([A-Za-z_]\w*)\.(\w*)$/);
  if (member) {
    const dot = member.text.indexOf('.');
    const fns = PINE_NAMESPACES[member.text.slice(0, dot)];
    if (!fns) return null;
    return {
      from: member.from + dot + 1,
      options: fns.map((label) => ({ label, type: 'function' })),
      validFor: /^\w*$/,
    };
  }
  const word = context.matchBefore(/\w+/);
  if (!word && !context.explicit) return null;
  return {
    from: word ? word.from : context.pos,
    options: [
      ...Object.keys(PINE_NAMESPACES).map((label) => ({ label, type: 'namespace' })),
      ...PINE_KEYWORDS.map((label) => ({ label, type: 'keyword' })),
      ...PINE_TYPES.map((label) => ({ label, type: 'type' })),
      ...TOP_LEVEL_FUNCTIONS.map((label) => ({ label, type: 'function' })),
      ...BUILTIN_VARS.map((label) => ({ label, type: 'variable' })),
    ],
    validFor: /^\w*$/,
  };
}

export interface PineEditorError {
  message: string;
  line?: number;
  column?: number;
}

/** Map a runtime error (1-based line/column) to a lint diagnostic; out-of-range positions clamp into the document. */
export function errorToDiagnostic(error: PineEditorError, doc: string): Diagnostic | null {
  if (error.line === undefined) return null;
  const lines = doc.split('\n');
  const lineNo = Math.min(Math.max(Math.trunc(error.line), 1), lines.length);
  let start = 0;
  for (let i = 0; i < lineNo - 1; i++) start += lines[i].length + 1;
  const text = lines[lineNo - 1];
  const col = Math.min(Math.max(Math.trunc(error.column ?? 1), 1), text.length + 1) - 1;
  const from = start + col;
  const to = Math.max(from < start + text.length ? from + 1 : from, start + text.length);
  return { from, to: Math.min(to, doc.length), severity: 'error', message: error.message };
}

/** Recover a position from a message carrying "at L:C" (the shape runtime `parseError` reads). */
export function messageToError(message: string): PineEditorError {
  const m = /\bat (\d+):(\d+)/.exec(message);
  return m ? { message, line: Number(m[1]), column: Number(m[2]) } : { message };
}
