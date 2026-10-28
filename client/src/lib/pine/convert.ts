/**
 * Best-effort converter from Pine v1 to v4 source to v6. Pure and deterministic:
 * a small tokenizer (so strings, comments and members after "." are never
 * touched) plus rewrites for calls. Anything it cannot convert safely stays as
 * written, with a `// TODO(convert): ...` line above it and an entry in `notes`.
 * It never throws.
 */
import { VERSION_MARKER, detectPineVersion } from './version';

export interface ConvertNote {
  line: number;
  message: string;
}

export interface ConvertResult {
  code: string;
  /** The version the script was written for (1 when it had no version line). */
  from: number;
  notes: ConvertNote[];
}

type TokType = 'comment' | 'string' | 'ident' | 'number' | 'hex' | 'op' | 'ws' | 'nl';
interface Tok {
  type: TokType;
  text: string;
  start: number;
  line: number;
}

const OPS = ['==', '!=', '<=', '>=', ':=', '=>', '+=', '-=', '*=', '/=', '%='];

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  let line = 1;
  const push = (type: TokType, end: number) => {
    toks.push({ type, text: src.slice(i, end), start: i, line });
    i = end;
  };
  while (i < src.length) {
    const c = src[i];
    if (c === '\n' || (c === '\r' && src[i + 1] === '\n')) {
      push('nl', i + (c === '\r' ? 2 : 1));
      line++;
    } else if (c === ' ' || c === '\t' || c === '\r') {
      let e = i;
      while (e < src.length && (src[e] === ' ' || src[e] === '\t' || src[e] === '\r') && !(src[e] === '\r' && src[e + 1] === '\n')) e++;
      push('ws', e);
    } else if (c === '/' && src[i + 1] === '/') {
      let e = i;
      while (e < src.length && src[e] !== '\n' && !(src[e] === '\r' && src[e + 1] === '\n')) e++;
      push('comment', e);
    } else if (c === '"' || c === "'") {
      let e = i + 1;
      while (e < src.length && src[e] !== c && src[e] !== '\n') {
        if (src[e] === '\\' && e + 1 < src.length && src[e + 1] !== '\n') e++;
        e++;
      }
      if (src[e] === c) e++;
      push('string', e);
    } else if (c === '#' && /^#[0-9a-fA-F]{3,8}/.test(src.slice(i, i + 9))) {
      push('hex', i + /^#[0-9a-fA-F]+/.exec(src.slice(i, i + 9))![0].length);
    } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i, i + 40))!;
      push('number', i + m[0].length);
    } else if (/[A-Za-z_]/.test(c)) {
      let e = i + 1;
      while (e < src.length && /[A-Za-z0-9_]/.test(src[e])) e++;
      push('ident', e);
    } else {
      const two = src.slice(i, i + 2);
      push('op', i + (OPS.includes(two) ? 2 : 1));
    }
  }
  return toks;
}

const TA = [
  'sma', 'ema', 'rma', 'wma', 'vwma', 'swma', 'alma', 'rsi', 'macd', 'bb', 'bbw', 'atr', 'stoch', 'cross',
  'crossover', 'crossunder', 'highest', 'lowest', 'highestbars', 'lowestbars', 'change', 'mom', 'roc', 'cci',
  'cmo', 'mfi', 'sar', 'stdev', 'variance', 'dev', 'median', 'linreg', 'pivothigh', 'pivotlow', 'valuewhen',
  'barssince', 'cum', 'kc', 'tsi', 'wpr', 'falling', 'rising', 'correlation', 'percentrank',
];
const MATH = [
  'abs', 'ceil', 'floor', 'round', 'sqrt', 'pow', 'exp', 'log', 'log10', 'max', 'min', 'sign', 'sum', 'avg',
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
];
const CALL_RENAMES = new Map<string, string>([
  ['study', 'indicator'],
  ['security', 'request.security'],
  ['tostring', 'str.tostring'],
  ['tonumber', 'str.tonumber'],
  ...TA.map((n): [string, string] => [n, `ta.${n}`]),
  ...MATH.map((n): [string, string] => [n, `math.${n}`]),
]);
const VAR_RENAMES = new Map<string, string>([
  ['tr', 'ta.tr'],
  ['vwap', 'ta.vwap'],
  ['obv', 'ta.obv'],
  ['accdist', 'ta.accdist'],
  ['tickerid', 'syminfo.tickerid'],
  ['period', 'timeframe.period'],
]);
const COLORS = [
  'aqua', 'black', 'blue', 'fuchsia', 'gray', 'green', 'lime', 'maroon', 'navy', 'olive', 'orange', 'purple',
  'red', 'silver', 'teal', 'white', 'yellow',
];
const PLOT_STYLES = ['line', 'stepline', 'histogram', 'cross', 'area', 'columns', 'circles', 'linebr', 'areabr'];
const LINE_STYLES = ['dotted', 'dashed', 'solid'];
const SOURCES = ['open', 'high', 'low', 'close', 'volume', 'hl2', 'hlc3', 'ohlc4', 'hlcc4'];
const REMOVED = new Map<string, string>([
  ['heikenashi', 'use ticker.heikinashi(syminfo.tickerid) with request.security'],
  ['renko', 'use ticker.renko(...) with request.security'],
  ['kagi', 'use ticker.kagi(...) with request.security'],
  ['linebreak', 'use ticker.linebreak(...) with request.security'],
  ['pointfigure', 'use ticker.pointfigure(...) with request.security'],
]);
const TRANSP_CALLS = new Set(['plot', 'plotshape', 'plotchar', 'bgcolor', 'fill', 'barcolor']);
const INPUT_TYPES = new Map<string, string>([
  ['integer', 'int'], ['int', 'int'], ['float', 'float'], ['bool', 'bool'], ['string', 'string'],
  ['source', 'source'], ['resolution', 'timeframe'], ['timeframe', 'timeframe'], ['symbol', 'symbol'],
  ['session', 'session'], ['color', 'color'],
]);

const SENTINEL = '';

interface Arg {
  lead: string;
  trail: string;
  name: string | null;
  /** Text between the name and the value (the "=" and its spaces). */
  eq: string;
  /** Emitted lazily so a rewrite that gives up leaves no duplicate notes. */
  value: string | null;
  /** Raw significant tokens of the value. */
  vs: number;
  ve: number;
  empty: boolean;
}

export function convertToV6(source: string): ConvertResult {
  const { version } = detectPineVersion(source);
  const from = version ?? 1;
  const notes: ConvertNote[] = [];
  try {
    if (source.includes(SENTINEL)) throw new Error('reserved character');
    return convertUnsafe(source, from);
  } catch {
    notes.push({ line: 1, message: 'The converter could not read this script; it was left as written.' });
    return { code: source, from, notes };
  }
}

function convertUnsafe(source: string, from: number): ConvertResult {
  const toks = tokenize(source);
  const lines = source.split('\n');
  const notes: ConvertNote[] = [];
  const todos = new Map<number, string[]>();
  const todo = (line: number, message: string) => {
    notes.push({ line, message });
    const list = todos.get(line) ?? [];
    list.push(message);
    todos.set(line, list);
  };

  const headerMatch = VERSION_MARKER.exec(source);
  const headerStart = headerMatch ? headerMatch.index + headerMatch[0].indexOf('//') : -1;

  const nextNonWs = (k: number): number => {
    let j = k;
    while (j < toks.length && toks[j].type === 'ws') j++;
    return j;
  };
  const prevNonWs = (k: number): number => {
    let j = k;
    while (j >= 0 && toks[j].type === 'ws') j--;
    return j;
  };
  const isOp = (k: number, text: string) => k >= 0 && k < toks.length && toks[k].type === 'op' && toks[k].text === text;
  const isTrivia = (k: number) => toks[k].type === 'ws' || toks[k].type === 'nl' || toks[k].type === 'comment';

  const matchParen = (open: number): number => {
    let depth = 0;
    for (let k = open; k < toks.length; k++) {
      const t = toks[k];
      if (t.type !== 'op') continue;
      if (t.text === '(' || t.text === '[' || t.text === '{') depth++;
      else if (t.text === ')' || t.text === ']' || t.text === '}') {
        depth--;
        if (depth === 0) return t.text === ')' && toks[open].text === '(' ? k : -1;
        if (depth < 0) return -1;
      }
    }
    return -1;
  };

  /** Names the script itself assigns or declares: never renamed. */
  const userNames = new Set<string>();
  {
    let depth = 0;
    const brackets: number[] = [];
    const declared = new Set<string>();
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k];
      if (t.type === 'op') {
        if (t.text === '(' || t.text === '[' || t.text === '{') {
          depth++;
          if (t.text === '[') brackets.push(k);
        } else if (t.text === ')' || t.text === '}') depth = Math.max(0, depth - 1);
        else if (t.text === ']') {
          depth = Math.max(0, depth - 1);
          const open = brackets.pop();
          if (open !== undefined && depth === 0 && isOp(nextNonWs(k + 1), '=')) {
            for (let j = open; j < k; j++) if (toks[j].type === 'ident') userNames.add(toks[j].text);
          }
        }
        continue;
      }
      if (t.type !== 'ident' || depth !== 0) continue;
      const n = nextNonWs(k + 1);
      if (isOp(n, '=') || isOp(n, ':=')) {
        userNames.add(t.text);
        if (isOp(n, '=') && !declared.has(t.text)) {
          declared.add(t.text);
          for (let j = n + 1; j < toks.length && toks[j].type !== 'nl'; j++) {
            if (toks[j].type === 'ident' && toks[j].text === t.text && isOp(nextNonWs(j + 1), '[') && !isOp(prevNonWs(j - 1), '.')) {
              todo(t.line, `"${t.text}" reads its own history before it is declared: declare it with var and update it with :=`);
              break;
            }
          }
        }
      } else if (isOp(n, '(')) {
        const close = matchParen(n);
        if (close > 0 && isOp(nextNonWs(close + 1), '=>')) {
          userNames.add(t.text);
          for (let j = n + 1; j < close; j++) {
            if (toks[j].type !== 'ident') continue;
            const after = nextNonWs(j + 1);
            if (isOp(after, ',') || isOp(after, '=') || after === close) userNames.add(toks[j].text);
          }
        }
      }
    }
  }

  const tok = (t: Tok) => (t.type === 'nl' ? `${t.text}${SENTINEL}${t.line + 1}${SENTINEL}` : t.text);
  const raw = (i: number, j: number) => {
    let s = '';
    for (let k = i; k < j; k++) s += tok(toks[k]);
    return s;
  };

  const splitArgs = (open: number, close: number): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    let depth = 0;
    let s = open + 1;
    for (let k = open + 1; k < close; k++) {
      const t = toks[k];
      if (t.type !== 'op') continue;
      if (t.text === '(' || t.text === '[' || t.text === '{') depth++;
      else if (t.text === ')' || t.text === ']' || t.text === '}') depth--;
      else if (t.text === ',' && depth === 0) {
        out.push([s, k]);
        s = k + 1;
      }
    }
    out.push([s, close]);
    return out;
  };

  /** Emit tokens [i, j) with every rewrite applied. */
  const emit = (i: number, j: number): string => {
    let out = '';
    for (let k = i; k < j; ) {
      const t = toks[k];
      if (t.type === 'comment' && t.start === headerStart) {
        out += '//@version=6';
        k++;
        continue;
      }
      if (t.type !== 'ident') {
        out += tok(t);
        k++;
        continue;
      }
      const handled = identAt(k, j);
      if (handled) {
        out += handled.text;
        k = handled.end;
      } else {
        out += tok(t);
        k++;
      }
    }
    return out;
  };

  const parseArgs = (open: number, close: number): Arg[] =>
    splitArgs(open, close).map(([s, e]) => {
      let a = s;
      while (a < e && isTrivia(a)) a++;
      if (a === e) return { lead: raw(s, e), trail: '', name: null, eq: '', value: '', vs: e, ve: e, empty: true };
      let b = e;
      while (b > a && isTrivia(b - 1)) b--;
      let name: string | null = null;
      let eq = '';
      let vs = a;
      if (toks[a].type === 'ident') {
        const n = nextNonWs(a + 1);
        if (isOp(n, '=') && n < b) {
          name = toks[a].text;
          vs = n + 1;
          eq = raw(a + 1, vs);
          while (vs < b && toks[vs].type === 'ws') {
            eq += tok(toks[vs]);
            vs++;
          }
        }
      }
      return { lead: raw(s, a), trail: raw(b, e), name, eq, value: null, vs, ve: b, empty: false };
    });

  const sigTexts = (a: Arg) => {
    const out: string[] = [];
    for (let k = a.vs; k < a.ve; k++) if (toks[k].type !== 'ws') out.push(toks[k].text);
    return out;
  };

  const val = (a: Arg): string => (a.value ??= emit(a.vs, a.ve));

  const build = (head: string, args: Arg[]) =>
    `${head}(${args.map((a) => a.lead + (a.name ? a.name + a.eq : '') + val(a) + a.trail).join(',')})`;

  const removeArg = (args: Arg[], idx: number) => {
    const [gone] = args.splice(idx, 1);
    if (args.length === 0) return;
    if (idx === 0) args[0].lead = gone.lead + args[0].lead.replace(/^[ \t]+/, '');
    else if (idx === args.length) args[idx - 1].trail += gone.trail;
  };

  const isUserName = (n: string) => userNames.has(n);

  function identAt(k: number, limit: number): { text: string; end: number } | null {
    const t = toks[k];
    const name = t.text;
    const prev = prevNonWs(k - 1);
    if (isOp(prev, '.')) return null;
    const n = nextNonWs(k + 1);
    if (isOp(n, '.') && name === 'strategy') return strategyCall(k, limit);
    if (isUserName(name)) return null;
    if (isOp(n, '=')) return null;
    const call = isOp(n, '(');
    if (call) {
      const close = matchParen(n);
      if (close > 0 && close < limit) {
        const r = callAt(k, n, close);
        if (r) return r;
      }
      const renamed = CALL_RENAMES.get(name);
      if (renamed) return { text: renamed, end: k + 1 };
      const removed = REMOVED.get(name);
      if (removed) todo(t.line, `"${name}" was removed in Pine v5: ${removed}`);
    }
    const v = VAR_RENAMES.get(name);
    if (v) return { text: v, end: k + 1 };
    if (!call && COLORS.includes(name)) return { text: `color.${name}`, end: k + 1 };
    return null;
  }

  function callAt(k: number, open: number, close: number): { text: string; end: number } | null {
    const name = toks[k].text;
    if (name === 'input') return inputCall(k, open, close);
    if (name === 'iff') {
      const args = parseArgs(open, close);
      if (args.length !== 3 || args.some((a) => a.empty || a.name)) {
        todo(toks[k].line, 'iff(...) with unusual arguments: rewrite it as a ?: expression');
        return null;
      }
      const c = val(args[0]).trim();
      const cond = /[?]/.test(c) ? `(${c})` : c;
      return { text: `(${cond} ? ${val(args[1]).trim()} : ${val(args[2]).trim()})`, end: close + 1 };
    }
    if (name === 'color') {
      const args = parseArgs(open, close);
      if (args.length !== 2 || args.some((a) => a.empty || a.name)) return null;
      return { text: build('color.new', args), end: close + 1 };
    }
    if (name === 'hline') {
      const args = parseArgs(open, close);
      for (const a of args) {
        const s = sigTexts(a);
        if (a.name === 'linestyle' && s.length === 1 && LINE_STYLES.includes(s[0]) && !isUserName(s[0])) a.value = `hline.style_${s[0]}`;
      }
      return { text: build('hline', args), end: close + 1 };
    }
    if (TRANSP_CALLS.has(name)) {
      const args = parseArgs(open, close);
      if (name === 'plot') {
        for (const a of args) {
          const s = sigTexts(a);
          if (a.name === 'style' && s.length === 1 && PLOT_STYLES.includes(s[0]) && !isUserName(s[0])) a.value = `plot.style_${s[0]}`;
        }
      }
      const ti = args.findIndex((a) => a.name === 'transp');
      if (ti >= 0) {
        const colorArg = args.find((a) => a.name === 'color') ?? (name === 'bgcolor' ? args.find((a) => !a.name && !a.empty) : undefined);
        if (colorArg) {
          colorArg.value = `color.new(${val(colorArg).trim()}, ${val(args[ti]).trim()})`;
        } else {
          todo(toks[k].line, `transp was removed and ${name}() has no color argument: set the transparency with color.new(...)`);
        }
        removeArg(args, ti);
      }
      return { text: build(name, args), end: close + 1 };
    }
    return null;
  }

  function strategyCall(k: number, limit: number): { text: string; end: number } | null {
    const dot = nextNonWs(k + 1);
    const member = nextNonWs(dot + 1);
    const open = nextNonWs(member + 1);
    if (!(member < toks.length && toks[member].type === 'ident' && isOp(open, '('))) return null;
    const close = matchParen(open);
    if (close < 0 || close >= limit) return null;
    const args = parseArgs(open, close);
    const wi = args.findIndex((a) => a.name === 'when');
    if (wi < 0) return null;
    // Whole-line statement: only blanks before it on its line, only blanks or a comment after it.
    let s = k - 1;
    while (s >= 0 && toks[s].type === 'ws') s--;
    const startsLine = s < 0 || toks[s].type === 'nl';
    let e = close + 1;
    while (e < toks.length && toks[e].type === 'ws') e++;
    const endsLine = e >= toks.length || toks[e].type === 'nl' || toks[e].type === 'comment';
    if (!startsLine || !endsLine) {
      todo(toks[k].line, 'when= is not supported in Pine v6: wrap this call in an if block');
      return null;
    }
    const indent = s + 1 < k ? raw(s + 1, k) : '';
    const cond = val(args[wi]).trim();
    removeArg(args, wi);
    const head = raw(k, open);
    return { text: `if ${cond}\n${indent}    ${build(head, args)}`, end: close + 1 };
  }

  function inputCall(k: number, open: number, close: number): { text: string; end: number } | null {
    const line = toks[k].line;
    const args = parseArgs(open, close);
    if (args.length === 0 || args.some((a) => a.empty)) {
      todo(line, 'input() with no arguments: use input.int, input.float, input.bool, input.string or input.source');
      return null;
    }
    const isTypeWord = (a: Arg): string | null => {
      const s = sigTexts(a);
      if (s.length === 1 && INPUT_TYPES.has(s[0])) return INPUT_TYPES.get(s[0])!;
      if (s.length === 3 && s[0] === 'input' && s[1] === '.' && INPUT_TYPES.has(s[2])) return INPUT_TYPES.get(s[2])!;
      return null;
    };
    let type: string | null = null;
    let typeIdx = args.findIndex((a) => a.name === 'type');
    if (typeIdx >= 0) {
      type = isTypeWord(args[typeIdx]);
    } else if (args.length > 2 && !args[2].name) {
      type = isTypeWord(args[2]);
      if (type) typeIdx = 2;
    }
    if (typeIdx >= 0 && !type) {
      todo(line, 'input() with an unknown type: convert it to the matching input.* function');
      return null;
    }
    // Positional arguments after title / type use a v4 order that differs from v6.
    const positional = args.filter((a, i) => !a.name && i !== typeIdx);
    if (positional.length > 2) {
      todo(line, 'input() with extra positional arguments: convert it to the matching input.* function with named arguments');
      return null;
    }
    if (!type) {
      const def = args.find((a) => a.name === 'defval') ?? args.find((a) => !a.name);
      type = def ? inferInputType(sigTexts(def)) : null;
      if (!type) {
        todo(line, 'input() with a default Vost cannot type: convert it to the matching input.* function');
        return null;
      }
    }
    if (typeIdx >= 0) removeArg(args, typeIdx);
    return { text: build(`input.${type}`, args), end: close + 1 };
  }

  const inferInputType = (s: string[]): string | null => {
    const parts = s[0] === '-' || s[0] === '+' ? s.slice(1) : s;
    if (parts.length === 1) {
      const p = parts[0];
      if (/^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(p)) return /^\d+$/.test(p) ? 'int' : 'float';
      if (s.length === parts.length) {
        if (p === 'true' || p === 'false') return 'bool';
        if (p[0] === '"' || p[0] === "'") return 'string';
        if (SOURCES.includes(p) && !isUserName(p)) return 'source';
      }
    }
    return null;
  };

  let body = emit(0, toks.length);
  body = `${SENTINEL}1${SENTINEL}${body}`;
  body = body.replace(new RegExp(`${SENTINEL}(\\d+)${SENTINEL}`, 'g'), (_m, n: string) => {
    const msgs = todos.get(Number(n));
    if (!msgs) return '';
    const indent = /^[ \t]*/.exec(lines[Number(n) - 1] ?? '')![0];
    return msgs.map((m) => `${indent}// TODO(convert): ${m}\n`).join('');
  });
  const code = headerStart >= 0 ? body : `//@version=6\n${body}`;
  notes.sort((a, b) => a.line - b.line);
  return { code, from, notes };
}

/** The line shown after a conversion. */
export function conversionSummary(from: number, notes: ConvertNote[]): string {
  const base = `Converted from Pine v${from} to v6.`;
  if (notes.length === 0) return base;
  return `${base} ${notes.length} ${notes.length === 1 ? 'place needs' : 'places need'} a look: search for TODO(convert).`;
}
