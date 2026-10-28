import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { convertToV6, conversionSummary } from './convert';

const read = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}.pine`, import.meta.url)), 'utf8');

/** Convert and drop the version header line. */
const conv = (src: string) => convertToV6(src);
const body = (src: string) => convertToV6(src).code.replace(/^\/\/@version=6\n/, '');

describe('convertToV6 version line', () => {
  it('replaces an existing marker and keeps the other lines', () => {
    const r = conv('// hi\n//@version=4\nstudy("x")\n');
    expect(r.from).toBe(4);
    expect(r.code).toBe('// hi\n//@version=6\nindicator("x")\n');
  });
  it('inserts a marker as line 1 when there is none', () => {
    const r = conv('study("x")');
    expect(r.from).toBe(1);
    expect(r.code).toBe('//@version=6\nindicator("x")');
  });
});

describe('convertToV6 renames', () => {
  it('study, security, tostring, color(), iff', () => {
    expect(body('study("x")')).toBe('indicator("x")');
    expect(body('a = security(tickerid, period, close)')).toBe('a = request.security(syminfo.tickerid, timeframe.period, close)');
    expect(body('t = tostring(close)')).toBe('t = str.tostring(close)');
    expect(body('c = color(red, 50)')).toBe('c = color.new(color.red, 50)');
    expect(body('x = iff(close > open, 1, 2)')).toBe('x = (close > open ? 1 : 2)');
    expect(body('x = iff(a ? b : c, 1, iff(d, 2, 3))')).toBe('x = ((a ? b : c) ? 1 : (d ? 2 : 3))');
  });
  it('ta and math built-ins and variables', () => {
    expect(body('a = ema(abs(close - sma(close, 5)), 3) + tr + vwap + obv + accdist')).toBe(
      'a = ta.ema(math.abs(close - ta.sma(close, 5)), 3) + ta.tr + ta.vwap + ta.obv + ta.accdist',
    );
    for (const n of ['cross', 'highestbars', 'pivothigh', 'percentrank', 'valuewhen']) {
      expect(body(`a = ${n}(close, 3)`)).toBe(`a = ta.${n}(close, 3)`);
    }
    for (const n of ['pow', 'log10', 'avg', 'sum', 'max']) expect(body(`a = ${n}(1, 2)`)).toBe(`a = math.${n}(1, 2)`);
  });
  it('bare colors', () => {
    expect(body('plot(close, color=red)\nbgcolor(lime)')).toBe('plot(close, color=color.red)\nbgcolor(color.lime)');
  });
  it('styles and line styles', () => {
    expect(body('plot(close, style=histogram)')).toBe('plot(close, style=plot.style_histogram)');
    expect(body('plot(close, style = linebr)')).toBe('plot(close, style = plot.style_linebr)');
    expect(body('hline(0, linestyle=dashed)')).toBe('hline(0, linestyle=hline.style_dashed)');
  });
});

describe('convertToV6 safety', () => {
  it('never rewrites strings or comments', () => {
    expect(body('t = "ema(red)" // sma(red)\nlabel = \'abs(x)\'')).toBe('t = "ema(red)" // sma(red)\nlabel = \'abs(x)\'');
  });
  it('never rewrites a member after a dot', () => {
    expect(body('a = obj.ema(1)\nb = x.red')).toBe('a = obj.ema(1)\nb = x.red');
  });
  it('never renames a name the script assigns', () => {
    expect(body('ema = close\nred = 1\nplot(ema + red)')).toBe('ema = close\nred = 1\nplot(ema + red)');
    expect(body('abs(x) => x < 0 ? -x : x\nplot(abs(close))')).toBe('abs(x) => x < 0 ? -x : x\nplot(abs(close))');
  });
  it('does not rename named arguments', () => {
    expect(body('plot(close, color=red, title="a")')).toBe('plot(close, color=color.red, title="a")');
  });
  it('is idempotent on v6 code', () => {
    const v6 = read('wavetrend-v6');
    const r = conv(v6);
    expect(r.code).toBe(v6);
    expect(r.notes).toEqual([]);
    const again = conv(conv(read('legacy-wavetrend')).code);
    expect(again.code).toBe(conv(read('legacy-wavetrend')).code);
  });
  it('never throws on garbage', () => {
    const junk = ['', '(((', ')))', '"unterminated', "input(", 'plot(close, transp=', 'iff(', '\u0000x', 'a = [1,2', '#', 'x = input(\n', 'strategy.entry(when=', '1.2.3e', '@@@ ###', 'a =\r\nb = input(1,'];
    for (const j of junk) {
      expect(() => convertToV6(j)).not.toThrow();
      expect(typeof convertToV6(j).code).toBe('string');
    }
  });
});

describe('convertToV6 input', () => {
  it('types by default value', () => {
    expect(body('a = input(10)')).toBe('a = input.int(10)');
    expect(body('a = input(-0.5, "x")')).toBe('a = input.float(-0.5, "x")');
    expect(body('a = input(true, "x")')).toBe('a = input.bool(true, "x")');
    expect(body('a = input("abc")')).toBe('a = input.string("abc")');
    expect(body('a = input(close, "Src")')).toBe('a = input.source(close, "Src")');
    expect(body('a = input(hlc3)')).toBe('a = input.source(hlc3)');
    expect(body('a = input(defval=14, title="Len")')).toBe('a = input.int(defval=14, title="Len")');
  });
  it('types by type= and drops it', () => {
    expect(body('a = input(14, "x", type=integer)')).toBe('a = input.int(14, "x")');
    expect(body('a = input(1.5, type=float, minval=0)')).toBe('a = input.float(1.5, minval=0)');
    expect(body('a = input("D", "tf", type=resolution)')).toBe('a = input.timeframe("D", "tf")');
    expect(body('a = input(close, "s", type=input.source)')).toBe('a = input.source(close, "s")');
    expect(body('a = input(14, "x", input.integer)')).toBe('a = input.int(14, "x")');
    expect(body('a = input(title="x", type=session, defval="0930-1600")')).toBe('a = input.session(title="x", defval="0930-1600")');
  });
  it('leaves unknown forms with a TODO', () => {
    const r = conv('//@version=4\nx = input(foo)\n');
    expect(r.code).toBe('//@version=6\n// TODO(convert): input() with a default Vost cannot type: convert it to the matching input.* function\nx = input(foo)\n');
    expect(r.notes).toEqual([{ line: 2, message: expect.stringContaining('input()') }]);
    expect(conv('x = input(1, "a", 3, 4)').notes).toHaveLength(1);
  });
});

describe('convertToV6 transp', () => {
  it('folds transp into the color', () => {
    expect(body('plot(close, color=red, transp=70)')).toBe('plot(close, color=color.new(color.red, 70))');
    expect(body('plot(close, transp=70, color=#ff0000)')).toBe('plot(close, color=color.new(#ff0000, 70))');
    expect(body('bgcolor(red, transp=90)')).toBe('bgcolor(color.new(color.red, 90))');
    expect(body('plotshape(x, color=blue, transp=10, style=shape.circle)')).toBe(
      'plotshape(x, color=color.new(color.blue, 10), style=shape.circle)',
    );
    expect(body('plot(close,\n  color=red,\n  transp=70\n)')).toBe('plot(close,\n  color=color.new(color.red, 70)\n)');
  });
  it('removes transp without a color and notes it', () => {
    const r = conv('//@version=4\nplot(close, transp=70)\n');
    expect(r.code).toBe('//@version=6\n// TODO(convert): transp was removed and plot() has no color argument: set the transparency with color.new(...)\nplot(close)\n');
    expect(r.notes).toHaveLength(1);
  });
});

describe('convertToV6 when=', () => {
  it('turns a whole-line strategy call into an if', () => {
    expect(body('strategy.entry("L", strategy.long, when = close > open)')).toBe(
      'if close > open\n    strategy.entry("L", strategy.long)',
    );
    expect(body('if x\n    strategy.close("L", when=ema(close, 3) > 1) // done')).toBe(
      'if x\n    if ta.ema(close, 3) > 1\n        strategy.close("L") // done',
    );
  });
  it('notes when= inside an expression', () => {
    const r = conv('//@version=4\nx = strategy.entry("L", strategy.long, when=a)\n');
    expect(r.code).toContain('// TODO(convert): when= is not supported');
    expect(r.code).toContain('x = strategy.entry("L", strategy.long, when=a)');
    expect(r.notes).toHaveLength(1);
  });
});

describe('convertToV6 other notes', () => {
  it('flags a variable reading its own history', () => {
    const r = conv('//@version=2\nx = nz(x[1]) + 1\nplot(x)\n');
    expect(r.code).toContain('// TODO(convert): "x" reads its own history');
    expect(r.notes).toHaveLength(1);
  });
  it('flags removed built-ins', () => {
    const r = conv('//@version=4\nh = heikenashi(tickerid)\n');
    expect(r.notes).toHaveLength(1);
    expect(r.code).toContain('syminfo.tickerid');
  });
  it('summarises', () => {
    expect(conversionSummary(4, [])).toBe('Converted from Pine v4 to v6.');
    expect(conversionSummary(1, [{ line: 1, message: 'x' }])).toBe('Converted from Pine v1 to v6. 1 place needs a look: search for TODO(convert).');
    expect(conversionSummary(1, [{ line: 1, message: 'x' }, { line: 2, message: 'y' }])).toContain('2 places need a look');
  });
});

describe('legacy-wavetrend', () => {
  it('converts the reported script with no notes', () => {
    const r = conv(read('legacy-wavetrend'));
    expect(r.from).toBe(1);
    expect(r.notes).toEqual([]);
    expect(r.code).toContain('indicator(title="WaveTrend');
    expect(r.code).toContain('plot(wt1-wt2, color=color.new(#498eac, 73), style=plot.style_area)');
  });
});
