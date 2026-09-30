/* =========================================================================
 * LightQuery - lq-text.js
 * 値の解釈と正規化：数値・日付の読み取り、照合ルール（空白・全角半角・大小文字）
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;

  /* ---------------------------------------------------------------------
   * ValueParser：文字列を数値・日付として読む（読めなければ NaN）
   * ------------------------------------------------------------------- */
  const RE_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
  const RE_THOUSANDS = /^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;
  const RE_DATE = /^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/;
  const RE_DATE_JA = /^(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日(?:\s*(\d{1,2})[:時]\s*(\d{1,2})分?(?:[:]?\s*(\d{1,2})秒?)?)?$/;
  const RE_DATE_ERA = /^(令和|平成|昭和|大正|明治|[RHSTM])\s*(元|\d{1,2})\s*[年.\/\-]\s*(\d{1,2})\s*[月.\/\-]\s*(\d{1,2})\s*日?$/i;
  const ERA_BASE = { '令和': 2018, R: 2018, '平成': 1988, H: 1988, '昭和': 1925, S: 1925, '大正': 1911, T: 1911, '明治': 1867, M: 1867 };
  const MAX_DIGITS = 15;

  function buildDate(y, mo, d, hh, mi, ss) {
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return NaN;
    const h = hh ? Number(hh) : 0;
    const m = mi ? Number(mi) : 0;
    const s = ss ? Number(ss) : 0;
    if (h > 23 || m > 59 || s > 59) return NaN;
    const time = Date.UTC(y, mo - 1, d, h, m, s);
    const check = new Date(time);
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return NaN;
    return time;
  }

  const ValueParser = {
    /**
     * 数値として読む。カンマ区切り・通貨記号・円・%・▲△（負数）・(123)（負数）に対応。
     * 有効桁が 15 桁を超えるもの（長い ID など）は数値として扱わない。
     */
    parseNumber(raw) {
      if (raw === null || raw === undefined) return NaN;
      if (typeof raw === 'number') return isFinite(raw) ? raw : NaN;
      let s = String(raw).normalize('NFKC').trim();
      if (s === '' || s.length > 40) return NaN;
      let negative = false;
      if (s.charAt(0) === '(' && s.charAt(s.length - 1) === ')') {
        negative = true;
        s = s.slice(1, -1).trim();
      }
      const head = s.charAt(0);
      if (head === '▲' || head === '△' || head === '−') {
        negative = !negative;
        s = s.slice(1).trim();
      }
      s = s.replace(/^[¥$]\s*/, '').replace(/\s*円$/, '');
      let percent = false;
      if (s.charAt(s.length - 1) === '%') {
        percent = true;
        s = s.slice(0, -1).trim();
      }
      if (s.indexOf(',') !== -1) {
        if (!RE_THOUSANDS.test(s)) return NaN;
        s = s.replace(/,/g, '');
      }
      if (!RE_NUMBER.test(s)) return NaN;
      const digits = s.replace(/^[+-]/, '').replace(/e.*$/i, '').replace('.', '').replace(/^0+/, '');
      if (digits.length > MAX_DIGITS) return NaN;
      let value = Number(s);
      if (!isFinite(value)) return NaN;
      if (percent) value = value / 100;
      return negative ? -value : value;
    },

    /**
     * 日付として読む。yyyy/m/d・yyyy-m-d・yyyy.m.d・yyyy年m月d日・和暦（令和6年1月5日 / R6.1.5）と時刻に対応。
     * 戻り値は UTC 基準のミリ秒（タイムゾーンの影響を受けない比較用の値）。
     */
    parseDate(raw) {
      if (raw === null || raw === undefined) return NaN;
      const s = String(raw).normalize('NFKC').trim();
      if (s.length < 6 || s.length > 32) return NaN;
      let m = RE_DATE.exec(s);
      if (m) return buildDate(Number(m[1]), Number(m[2]), Number(m[3]), m[4], m[5], m[6]);
      m = RE_DATE_JA.exec(s);
      if (m) return buildDate(Number(m[1]), Number(m[2]), Number(m[3]), m[4], m[5], m[6]);
      m = RE_DATE_ERA.exec(s);
      if (m) {
        const base = ERA_BASE[m[1]] || ERA_BASE[m[1].toUpperCase()];
        const year = m[2] === '元' ? 1 : Number(m[2]);
        return buildDate(base + year, Number(m[3]), Number(m[4]));
      }
      return NaN;
    },

    /** 比較用のミリ秒を表示用の日付文字列へ戻す */
    formatDate(ms) {
      const d = new Date(ms);
      const pad = LQ.Util.pad2;
      let text = d.getUTCFullYear() + '/' + pad(d.getUTCMonth() + 1) + '/' + pad(d.getUTCDate());
      if (d.getUTCHours() || d.getUTCMinutes() || d.getUTCSeconds()) {
        text += ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
        if (d.getUTCSeconds()) text += ':' + pad(d.getUTCSeconds());
      }
      return text;
    }
  };

  /* ---------------------------------------------------------------------
   * Wildcard：② の値の「*」「＊」（0 文字以上の任意の文字）による当てはめ。「?」や「~*」は扱わない。
   *   山田* ＝ 前方一致 / *田 ＝ 後方一致 / *山田* ＝ 含む / 山*郎 ＝ パターン / * ＝ 空欄以外すべて
   *   値は照合ルールでそろえた文字列（Normalizer.text）どうしで比べる。
   * ------------------------------------------------------------------- */
  const WILDCARD_KIND = Object.freeze({ startsWith: '前方一致', endsWith: '後方一致', contains: '含む', pattern: 'パターン', any: '空欄以外すべて' });

  const Wildcard = {
    kindLabel(kind) {
      return WILDCARD_KIND[kind] || '';
    },

    /** @returns {{source:string, kind:string, test:function(string):boolean}} */
    compile(source) {
      const parts = source.split('*');
      const head = parts[0];
      const tail = parts[parts.length - 1];
      const mids = parts.slice(1, -1).filter((m) => m !== '');
      let kind = 'pattern';
      if (!mids.length) {
        if (head && !tail) kind = 'startsWith';
        else if (!head && tail) kind = 'endsWith';
        else if (!head && !tail) kind = 'any';
      } else if (mids.length === 1 && !head && !tail) {
        kind = 'contains';
      }
      const min = mids.reduce((n, m) => n + m.length, head.length + tail.length);
      return {
        source: source,
        kind: kind,
        test(text) {
          if (text === '' || text.length < min) return false;
          if (!text.startsWith(head) || !text.endsWith(tail)) return false;
          const end = text.length - tail.length;
          let pos = head.length;
          for (let i = 0; i < mids.length; i++) {
            const at = text.indexOf(mids[i], pos);
            if (at < 0 || at + mids[i].length > end) return false;
            pos = at + mids[i].length;
          }
          return true;
        }
      };
    }
  };

  /* ---------------------------------------------------------------------
   * Normalizer：照合ルールに従って値をそろえる
   *   text()  … 含む・前方一致などの文字列比較用
   *   key()   … 完全一致・一致しない用（数値・日付・文字列で同値を判定）
   *   typed() … 以上・未満などの大小比較や並べ替え用
   * ------------------------------------------------------------------- */
  const DEFAULT_RULES = Object.freeze({ space: 'trim', width: true, caseless: true, numeric: true, date: true, wildcard: true });
  const SPACE_VALUES = ['trim', 'all', 'keep'];
  const TYPE = Object.freeze({ EMPTY: 0, NUMBER: 1, DATE: 2, TEXT: 3 });
  const EMPTY_TYPED = Object.freeze({ t: TYPE.EMPTY, n: 0, s: '' });
  const CACHE_LIMIT = 300000;

  class Normalizer {
    constructor(rules) {
      this.rules = Object.assign({}, DEFAULT_RULES, rules || {});
      this._textCache = new Map();
    }

    static get DEFAULT_RULES() {
      return DEFAULT_RULES;
    }

    static get TYPE() {
      return TYPE;
    }

    /** 保存・JSON から読んだ照合ルールの値の種類を確かめる（不正な値は捨てる。使える値がなければ null） */
    static cleanRules(rules) {
      if (!rules || typeof rules !== 'object') return null;
      const out = {};
      let count = 0;
      Object.keys(DEFAULT_RULES).forEach((key) => {
        const v = rules[key];
        if (typeof v !== typeof DEFAULT_RULES[key]) return;
        if (key === 'space' && SPACE_VALUES.indexOf(v) === -1) return;
        out[key] = v;
        count++;
      });
      return count ? out : null;
    }

    /** 2 つの照合ルールが同じか（欠けている項目は初期値とみなす） */
    static sameRules(a, b) {
      const x = Object.assign({}, DEFAULT_RULES, a || {});
      const y = Object.assign({}, DEFAULT_RULES, b || {});
      return Object.keys(DEFAULT_RULES).every((key) => x[key] === y[key]);
    }

    /** 空欄（空白のみを含む）か */
    static isBlank(value) {
      return value === null || value === undefined || String(value).trim() === '';
    }

    /** ルールの組み合わせを表す文字列（計算結果の再利用・結果が最新かの判定に使う。欠けている項目は初期値） */
    static signatureOf(rules) {
      const r = Object.assign({}, DEFAULT_RULES, rules || {});
      return [r.space, r.width ? 1 : 0, r.caseless ? 1 : 0, r.numeric ? 1 : 0, r.date ? 1 : 0, r.wildcard ? 1 : 0].join('|');
    }

    get signature() {
      return Normalizer.signatureOf(this.rules);
    }

    text(value) {
      const raw = value === null || value === undefined ? '' : String(value);
      const cached = this._textCache.get(raw);
      if (cached !== undefined) return cached;
      let out = raw;
      if (this.rules.width) out = out.normalize('NFKC');
      if (this.rules.space === 'trim') out = out.trim();
      else if (this.rules.space === 'all') out = out.replace(/\s+/g, '');
      if (this.rules.caseless) out = out.toLowerCase();
      if (this._textCache.size > CACHE_LIMIT) this._textCache.clear();
      this._textCache.set(raw, out);
      return out;
    }

    number(value) {
      return this.rules.numeric ? ValueParser.parseNumber(value) : NaN;
    }

    date(value) {
      return this.rules.date ? ValueParser.parseDate(value) : NaN;
    }

    key(value) {
      if (Normalizer.isBlank(value)) return '';
      const n = this.number(value);
      if (!Number.isNaN(n)) return 'n:' + n;
      const d = this.date(value);
      if (!Number.isNaN(d)) return 'd:' + d;
      return 's:' + this.text(value);
    }

    typed(value) {
      if (Normalizer.isBlank(value)) return EMPTY_TYPED;
      const n = this.number(value);
      if (!Number.isNaN(n)) return { t: TYPE.NUMBER, n: n, s: '' };
      const d = this.date(value);
      if (!Number.isNaN(d)) return { t: TYPE.DATE, n: d, s: '' };
      return { t: TYPE.TEXT, n: 0, s: this.text(value) };
    }

    /**
     * 「*」を含む値ならワイルドカードの型（Wildcard.compile の結果）、それ以外・ルールが OFF なら null。
     * 全角の「＊」は、全角・半角を区別する設定でも「*」として扱う（ほかの文字は設定どおり区別する）。
     */
    glob(value) {
      if (!this.rules.wildcard || Normalizer.isBlank(value)) return null;
      const s = this.text(value).replace(/＊/g, '*');
      return s.indexOf('*') === -1 ? null : Wildcard.compile(s);
    }

    /** prep 種別（key / text / typed / glob）に応じた変換関数を返す */
    converter(prep) {
      if (prep === 'key') return (v) => this.key(v);
      if (prep === 'glob') return (v) => this.glob(v);
      if (prep === 'period') {
        const now = new Date();
        return (v) => LQ.Period.parse(v, now);
      }
      if (prep === 'typed') return (v) => this.typed(v);
      return (v) => this.text(v);
    }

    /** 現在のルールを人が読める文に（根拠表示用） */
    describe() {
      const r = this.rules;
      const space = { keep: '空白を区別', trim: '前後の空白を無視', all: 'すべての空白を無視' }[r.space] || '';
      return [
        space,
        r.width ? '全角・半角を区別しない' : '全角・半角を区別',
        r.caseless ? '大文字・小文字を区別しない' : '大文字・小文字を区別',
        r.numeric ? '数値は数値で比較' : '数値も文字で比較',
        r.date ? '日付は日付で比較' : '日付も文字で比較',
        r.wildcard ? '完全一致で * はワイルドカード' : '* も文字として比較'
      ].join('・');
    }
  }

  LQ.Wildcard = Wildcard;
  LQ.ValueParser = ValueParser;
  LQ.Normalizer = Normalizer;
})(window);
