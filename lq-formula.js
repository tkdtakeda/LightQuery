/* =========================================================================
 * LightQuery - lq-formula.js
 * 計算の式（列の追加の「計算」）：値の扱い・関数の登録簿・式の解析と計算。関数そのものは lq-formula-funcs.js。
 *   書き方は Excel に合わせる：[列名]・"文字"・数・TRUE / FALSE、
 *   演算子は 比較（= <> < > <= >=。≧ ≦ ≠ も可）→ &（文字をつなぐ）→ + − → × ÷ → ^（べき乗）の順に弱く、括弧で変えられる。
 *   全角の記号・数字は半角として読む（[列名] と "文字" の中は変えない）。
 *   値の種類：数・文字・真偽（TRUE / FALSE）・日付（DateVal。UTC のミリ秒を持つ）。
 *     空欄は計算では 0、文字の関数では ""。日付の列 ＋ 数 は日付（日数を足す）、日付 − 日付 は日数。
 *   1 行の計算で困ったこと（数として読めない・0 で割る・計算できない値）は FormulaFault で知らせ、その行は空欄にして数える。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const ValueParser = LQ.ValueParser;

  const DAY_MS = 86400000;
  /* Excel の日付のシリアル値 0 は 1899/12/30（1900 年のうるう年の誤りを含めて Excel と同じ値になる） */
  const SERIAL_EPOCH = Date.UTC(1899, 11, 30);

  /* 式の中の全角の記号を半角にそろえる（[列名] と "文字" の中は変えない） */
  const SYMBOLS = { '＋': '+', '－': '-', '−': '-', '＊': '*', '×': '*', '／': '/', '÷': '/', '（': '(', '）': ')', '＆': '&',
    '［': '[', '］': ']', '，': ',', '、': ',', '．': '.', '”': '"', '“': '"', '＂': '"', '　': ' ',
    '＝': '=', '＜': '<', '＞': '>', '＾': '^' };
  /* 1 文字で書く比較（≧ ≦ ≠）→ Excel の書き方 */
  const COMPARE_ALIAS = { '≧': '>=', '≦': '<=', '≠': '<>' };

  /* ---------------------------------------------------------------------
   * 値の扱い
   * ------------------------------------------------------------------- */
  class DateVal {
    constructor(ms) {
      this.ms = ms;
    }
  }

  /** 1 行の計算で困ったこと（code：nan＝数として読めない／div0＝0 で割る／value＝計算できない値） */
  class FormulaFault {
    constructor(code, message) {
      this.code = code;
      this.message = message || '';
    }
  }
  const NOT_NUMBER = new FormulaFault('nan');
  const DIV_ZERO = new FormulaFault('div0');

  /** 計算できない値（引数の範囲外・日付として読めない・見つからない など） */
  function fault(message) {
    return new FormulaFault('value', message);
  }

  function isBlank(v) {
    return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
  }

  function formatNumber(v) {
    const r = Number(v.toPrecision(15));
    return String(Object.is(r, -0) ? 0 : r);
  }

  const V = {
    DAY_MS: DAY_MS,
    DateVal: DateVal,
    fault: fault,
    isBlank: isBlank,

    /** 日付の値を作る（ミリ秒が NaN なら計算できない値） */
    date(ms) {
      if (Number.isNaN(ms) || !isFinite(ms)) throw fault('日付になりません');
      return new DateVal(ms);
    },

    /** 数として読む（空欄は 0・TRUE は 1・日付は Excel のシリアル値） */
    num(v) {
      if (typeof v === 'number') return v;
      if (typeof v === 'boolean') return v ? 1 : 0;
      if (v instanceof DateVal) return (v.ms - SERIAL_EPOCH) / DAY_MS;
      if (isBlank(v)) return 0;
      const n = ValueParser.parseNumber(v);
      if (Number.isNaN(n)) throw NOT_NUMBER;
      return n;
    },

    /** 整数として読む（小数は切り捨て） */
    int(v) {
      return Math.trunc(V.num(v));
    },

    /** 文字として読む（日付は yyyy/mm/dd、真偽は TRUE / FALSE） */
    text(v) {
      if (v === null || v === undefined) return '';
      if (typeof v === 'number') return formatNumber(v);
      if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
      if (v instanceof DateVal) return ValueParser.formatDate(v.ms);
      return String(v);
    },

    /** 真偽として読む（数は 0 以外が TRUE、"TRUE" / "FALSE" の文字も可、空欄は FALSE） */
    bool(v) {
      if (typeof v === 'boolean') return v;
      if (typeof v === 'number') return v !== 0;
      if (v instanceof DateVal) return true;
      if (isBlank(v)) return false;
      const s = String(v).normalize('NFKC').trim().toUpperCase();
      if (s === 'TRUE') return true;
      if (s === 'FALSE') return false;
      const n = ValueParser.parseNumber(v);
      if (!Number.isNaN(n)) return n !== 0;
      throw fault('「' + v + '」は条件（TRUE / FALSE）として読めません');
    },

    /** 日付として読む（ミリ秒）。数は Excel のシリアル値として読む */
    dateMs(v) {
      if (v instanceof DateVal) return v.ms;
      if (typeof v === 'number') return SERIAL_EPOCH + Math.round(v * DAY_MS);
      if (isBlank(v)) throw fault('日付が空欄です');
      const ms = ValueParser.parseDate(v);
      if (Number.isNaN(ms)) {
        const n = ValueParser.parseNumber(v);
        if (!Number.isNaN(n)) return SERIAL_EPOCH + Math.round(n * DAY_MS);
        throw fault('「' + v + '」は日付として読めません');
      }
      return ms;
    },

    /** 日付として扱う値か（日付の値、または数としては読めず日付として読める文字） */
    isDateLike(v) {
      if (v instanceof DateVal) return true;
      if (typeof v !== 'string' || isBlank(v)) return false;
      return Number.isNaN(ValueParser.parseNumber(v)) && !Number.isNaN(ValueParser.parseDate(v));
    },

    /**
     * Excel の比較（= <> < > <= >=）。大文字小文字は区別しない。
     * 日付どうし → 日付、数どうし（空欄は 0）→ 数、それ以外は文字で比べる。
     * @returns {number} 負：a が小さい／0：等しい／正：a が大きい
     */
    compare(a, b) {
      const ba = isBlank(a);
      const bb = isBlank(b);
      if (ba && bb) return 0;
      if ((V.isDateLike(a) || a instanceof DateVal) && (V.isDateLike(b) || b instanceof DateVal || typeof b === 'number')) {
        return Math.sign(V.dateMs(a) - V.dateMs(b));
      }
      if ((V.isDateLike(b) || b instanceof DateVal) && typeof a === 'number') return Math.sign(V.dateMs(a) - V.dateMs(b));
      const na = numberOrNaN(a, bb);
      const nb = numberOrNaN(b, ba);
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return Math.sign(na - nb);
      const ta = V.text(a).normalize('NFKC').toLowerCase();
      const tb = V.text(b).normalize('NFKC').toLowerCase();
      return ta === tb ? 0 : (ta < tb ? -1 : 1);
    },

    /** 足し算（日付 ＋ 数 は日付） */
    add(a, b) {
      if (V.isDateLike(a) && !V.isDateLike(b)) return V.date(V.dateMs(a) + Math.round(V.num(b) * DAY_MS));
      if (V.isDateLike(b) && !V.isDateLike(a)) return V.date(V.dateMs(b) + Math.round(V.num(a) * DAY_MS));
      return V.num(a) + V.num(b);
    },

    /** 引き算（日付 − 日付 は日数、日付 − 数 は日付） */
    sub(a, b) {
      const da = V.isDateLike(a);
      const db = V.isDateLike(b);
      if (da && db) return Math.round((V.dateMs(a) - V.dateMs(b)) / DAY_MS);
      if (da) return V.date(V.dateMs(a) - Math.round(V.num(b) * DAY_MS));
      return V.num(a) - V.num(b);
    }
  };

  /** 比較用：数として読めれば数（相手が空欄なら真偽・数として、空欄どうしの比較は呼び出し側で済ませる） */
  function numberOrNaN(v, otherBlank) {
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (isBlank(v)) return otherBlank ? NaN : 0;
    return ValueParser.parseNumber(v);
  }

  /* ---------------------------------------------------------------------
   * 関数の登録簿（追加は register() だけでよい）
   * ------------------------------------------------------------------- */
  const CATEGORIES = [
    { id: 'cond', label: '条件', icon: 'code-branch' },
    { id: 'text', label: '文字', icon: 'font' },
    { id: 'num', label: '数値', icon: 'calculator' },
    { id: 'date', label: '日付', icon: 'calendar-days' }
  ];
  const registry = new Map();

  const Funcs = {
    CATEGORIES: CATEGORIES,

    /**
     * @param {{name:string, cat:string, args:[number, number], syntax:string, desc:string, example?:string, lazy?:boolean, fn:Function}} def
     *   args：引数の数の [最小, 最大]（最大は Infinity 可）。lazy：引数を計算する関数（thunk）の配列で受け取る（IF など、使う引数だけ計算する）
     */
    register(def) {
      registry.set(def.name, def);
    },

    get(name) {
      return registry.get(name) || null;
    },

    /** 分類ごとの関数（登録順） */
    byCategory(cat) {
      return Array.from(registry.values()).filter((d) => d.cat === cat);
    },

    names() {
      return Array.from(registry.keys());
    }
  };

  /* ---------------------------------------------------------------------
   * 字句解析
   * ------------------------------------------------------------------- */
  class FormulaError extends Error {
    constructor(message, pos) {
      super(message);
      this.pos = pos;
    }
  }

  function halfWidth(ch) {
    const s = SYMBOLS[ch] || ch;
    return /[０-９]/.test(s) ? String.fromCharCode(s.charCodeAt(0) - 0xFEE0) : s;
  }

  function tokenize(src) {
    const out = [];
    let i = 0;
    while (i < src.length) {
      const ch = halfWidth(src[i]);
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        i++;
        continue;
      }
      if (ch === '[') {
        let end = i + 1;
        while (end < src.length && src[end] !== ']' && src[end] !== '］') end++;
        if (end >= src.length) throw new FormulaError('「]」で閉じていない列名があります', i);
        out.push({ t: 'col', v: src.slice(i + 1, end).trim(), pos: i });
        i = end + 1;
        continue;
      }
      if (ch === '"') {
        let j = i + 1;
        let text = '';
        while (j < src.length) {
          if (halfWidth(src[j]) === '"') {
            /* "" は " 1 文字（Excel と同じ） */
            if (j + 1 < src.length && halfWidth(src[j + 1]) === '"') {
              text += '"';
              j += 2;
              continue;
            }
            break;
          }
          text += src[j];
          j++;
        }
        if (j >= src.length) throw new FormulaError('「"」で閉じていない文字があります', i);
        out.push({ t: 'str', v: text, pos: i });
        i = j + 1;
        continue;
      }
      if (/[0-9.]/.test(ch)) {
        let j = i;
        let num = '';
        while (j < src.length && /[0-9.]/.test(halfWidth(src[j]))) num += halfWidth(src[j++]);
        if (num === '.' || Number.isNaN(Number(num))) throw new FormulaError('数「' + num + '」を読めません', i);
        out.push({ t: 'num', v: Number(num), pos: i });
        i = j;
        continue;
      }
      if (COMPARE_ALIAS[ch]) {
        out.push({ t: 'op', v: COMPARE_ALIAS[ch], pos: i });
        i++;
        continue;
      }
      if (ch === '<' || ch === '>') {
        const next = i + 1 < src.length ? halfWidth(src[i + 1]) : '';
        const two = ch + next;
        if (two === '<=' || two === '>=' || two === '<>') {
          out.push({ t: 'op', v: two, pos: i });
          i += 2;
          continue;
        }
        out.push({ t: 'op', v: ch, pos: i });
        i++;
        continue;
      }
      if ('+-*/()&,=^'.indexOf(ch) !== -1) {
        out.push({ t: 'op', v: ch, pos: i });
        i++;
        continue;
      }
      const m = /^[A-Za-zＡ-Ｚａ-ｚ]+/.exec(src.slice(i));
      if (m) {
        const name = m[0].normalize('NFKC').toUpperCase();
        if (name === 'TRUE' || name === 'FALSE') out.push({ t: 'bool', v: name === 'TRUE', pos: i });
        else if (Funcs.get(name)) out.push({ t: 'fn', v: name, pos: i });
        else throw new FormulaError('「' + m[0] + '」という関数はありません（列名は [ ] で囲みます。使える関数は「関数」の一覧にあります）', i);
        i += m[0].length;
        continue;
      }
      throw new FormulaError('「' + src[i] + '」は使えません（列名は [ ] で囲みます）', i);
    }
    return out;
  }

  /* ---------------------------------------------------------------------
   * 構文解析（再帰下降）。結果は 1 行分の値を返す関数の木
   * ------------------------------------------------------------------- */
  const COMPARE = {
    '=': (c) => c === 0, '<>': (c) => c !== 0, '<': (c) => c < 0, '>': (c) => c > 0, '<=': (c) => c <= 0, '>=': (c) => c >= 0
  };

  function argRange(def) {
    const [min, max] = def.args;
    if (min === max) return min + ' 個';
    return max === Infinity ? min + ' 個以上' : min + '〜' + max + ' 個';
  }

  /**
   * @param {string} expr
   * @param {Function} columnIndex 列名 → 列番号（なければ -1）
   * @returns {{evaluate:function(Function):*, columns:string[], functions:string[]}} evaluate(cellOf) は 1 行分の値を返す
   */
  function compile(expr, columnIndex) {
    const src = String(expr || '');
    const tokens = tokenize(src);
    if (!tokens.length) throw new FormulaError('式を入力してください', 0);
    let p = 0;
    const columns = [];
    const functions = [];
    const peek = () => tokens[p];
    const isOp = (v) => peek() && peek().t === 'op' && peek().v === v;
    const expect = (v) => {
      if (!isOp(v)) throw new FormulaError('「' + v + '」が必要です', peek() ? peek().pos : src.length);
      p++;
    };

    function call(tk) {
      const def = Funcs.get(tk.v);
      expect('(');
      const args = [];
      if (!isOp(')')) {
        args.push(compare());
        while (isOp(',')) {
          p++;
          args.push(compare());
        }
      }
      expect(')');
      if (args.length < def.args[0] || args.length > def.args[1]) {
        throw new FormulaError(tk.v + ' の引数は ' + argRange(def) + 'です（' + def.syntax + '）', tk.pos);
      }
      if (functions.indexOf(tk.v) === -1) functions.push(tk.v);
      if (def.lazy) return (cell) => def.fn(args.map((a) => () => a(cell)));
      return (cell) => def.fn.apply(null, args.map((a) => a(cell)));
    }

    function primary() {
      const tk = peek();
      if (!tk) throw new FormulaError('式が途中で終わっています', src.length);
      p++;
      if (tk.t === 'num' || tk.t === 'str' || tk.t === 'bool') return () => tk.v;
      if (tk.t === 'col') {
        const idx = columnIndex(tk.v);
        if (idx < 0) throw new FormulaError('列「' + tk.v + '」がありません', tk.pos);
        if (columns.indexOf(tk.v) === -1) columns.push(tk.v);
        return (cell) => cell(idx);
      }
      if (tk.t === 'fn') return call(tk);
      if (tk.t === 'op' && tk.v === '(') {
        const inner = compare();
        expect(')');
        return inner;
      }
      if (tk.t === 'op' && (tk.v === '-' || tk.v === '+')) {
        const inner = primary();
        return tk.v === '-' ? (cell) => -V.num(inner(cell)) : (cell) => V.num(inner(cell));
      }
      throw new FormulaError('「' + tk.v + '」の位置がおかしいです', tk.pos);
    }
    function power() {
      let left = primary();
      while (isOp('^')) {
        p++;
        const l = left;
        const r = primary();
        left = (cell) => {
          const v = Math.pow(V.num(l(cell)), V.num(r(cell)));
          if (!isFinite(v)) throw fault('べき乗を計算できません');
          return v;
        };
      }
      return left;
    }
    function mul() {
      let left = power();
      while (isOp('*') || isOp('/')) {
        const op = peek().v;
        p++;
        const l = left;
        const r = power();
        left = op === '*' ? (cell) => V.num(l(cell)) * V.num(r(cell)) : (cell) => {
          const d = V.num(r(cell));
          if (d === 0) throw DIV_ZERO;
          return V.num(l(cell)) / d;
        };
      }
      return left;
    }
    function add() {
      let left = mul();
      while (isOp('+') || isOp('-')) {
        const op = peek().v;
        p++;
        const l = left;
        const r = mul();
        left = op === '+' ? (cell) => V.add(l(cell), r(cell)) : (cell) => V.sub(l(cell), r(cell));
      }
      return left;
    }
    function concat() {
      let left = add();
      while (isOp('&')) {
        p++;
        const l = left;
        const r = add();
        left = (cell) => V.text(l(cell)) + V.text(r(cell));
      }
      return left;
    }
    function compare() {
      let left = concat();
      while (peek() && peek().t === 'op' && COMPARE[peek().v]) {
        const test = COMPARE[peek().v];
        p++;
        const l = left;
        const r = concat();
        left = (cell) => test(V.compare(l(cell), r(cell)));
      }
      return left;
    }

    const root = compare();
    if (p < tokens.length) throw new FormulaError('「' + tokens[p].v + '」の位置がおかしいです', tokens[p].pos);
    return { evaluate: root, columns: columns, functions: functions };
  }

  /**
   * 文字の位置 pos がどの関数の何番目の引数の中か（入力中の書き方の表示に使う）。
   * 式が途中でも分かるよう、閉じていない括弧をたどる。
   * @returns {{name:string, arg:number}|null}
   */
  function callAt(expr, pos) {
    const src = String(expr || '').slice(0, pos);
    const stack = [];
    let i = 0;
    while (i < src.length) {
      const ch = halfWidth(src[i]);
      if (ch === '[') {
        const end = src.indexOf(']', i + 1);
        const end2 = src.indexOf('］', i + 1);
        const close = [end, end2].filter((x) => x >= 0).sort((a, b) => a - b)[0];
        if (close === undefined) return stack.length ? stack[stack.length - 1] : null;
        i = close + 1;
        continue;
      }
      if (ch === '"') {
        let j = i + 1;
        while (j < src.length && halfWidth(src[j]) !== '"') j++;
        if (j >= src.length) return stack.length ? stack[stack.length - 1] : null;
        i = j + 1;
        continue;
      }
      const m = /^[A-Za-zＡ-Ｚａ-ｚ]+/.exec(src.slice(i));
      if (m) {
        let j = i + m[0].length;
        while (j < src.length && /\s/.test(src[j])) j++;
        if (j < src.length && halfWidth(src[j]) === '(') {
          stack.push({ name: m[0].normalize('NFKC').toUpperCase(), arg: 0 });
          i = j + 1;
          continue;
        }
        i += m[0].length;
        continue;
      }
      if (ch === '(') stack.push({ name: '', arg: 0 });
      else if (ch === ')') stack.pop();
      else if (ch === ',' && stack.length) stack[stack.length - 1].arg++;
      i++;
    }
    for (let k = stack.length - 1; k >= 0; k--) if (stack[k].name && Funcs.get(stack[k].name)) return stack[k];
    return null;
  }

  LQ.Formula = {
    compile: compile,
    callAt: callAt,
    FormulaError: FormulaError,
    FormulaFault: FormulaFault,
    Funcs: Funcs,
    V: V,
    DIV_ZERO: DIV_ZERO,
    NOT_NUMBER: NOT_NUMBER,
    /** 計算結果を列の値（文字）にする */
    toText: (v) => V.text(v),
    /** 1 行の計算で起きたことの種類（nan / div0 / value）。式の誤りなどそれ以外は null */
    faultCode(err) {
      return err instanceof FormulaFault ? err.code : null;
    }
  };
})(window);
