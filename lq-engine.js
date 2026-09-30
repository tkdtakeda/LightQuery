/* =========================================================================
 * LightQuery - lq-engine.js
 * 抽出の仕組み：期間の解釈・比較方法の登録簿・組み合わせ式・抽出エンジン
 * （下の区切りごとに独立した部品。読み込み順どおりに並べている）
 * ========================================================================= */

/* =========================================================================
 * ── 期間の解釈 ──
 * 期間の解釈：「2024」「2024/05」「2024年5月」「2024年度」「2024/05/10」のような年・年月・日と、
 *   今日を基準にした「今日・昨日・今週・先週・今月・先月・今年・昨年・今年度・前年度・直近 N 日・今後 N 日」を
 *   [start, end)（UTC 基準のミリ秒。end は含まない）に読み替える。年度は 4 月始まり、週は月曜始まり。
 *   日付の比較値は ValueParser.parseDate と同じ「UTC の 0 時」を 1 日の始まりとする。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const DAY = 86400000;
  const FY_START_MONTH = 4;

  const RE_YEAR = /^(\d{4})年?$/;
  const RE_FISCAL = /^(\d{4})年度$/;
  const RE_MONTH = /^(\d{4})(?:[\/\-.]|年)(\d{1,2})月?$/;
  const RE_LAST_DAYS = /^(?:直近|過去)(\d{1,4})日(?:間)?$/;
  const RE_NEXT_DAYS = /^(?:今後|この先)(\d{1,4})日(?:間)?$/;

  /** 今日を基準にした言葉（画面の候補にも使う） */
  const WORDS = ['今日', '昨日', '明日', '今週', '先週', '来週', '今月', '先月', '来月', '今年', '昨年', '来年', '今年度', '前年度', '来年度', '直近7日', '直近30日', '今後7日'];

  function todayUtc(now) {
    const d = now || new Date();
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function range(start, end, label) {
    return { start: start, end: end, label: label };
  }

  function monthRange(y, m, label) {
    return range(Date.UTC(y, m - 1, 1), Date.UTC(y, m, 1), label);
  }

  function fiscalRange(fy, label) {
    return range(Date.UTC(fy, FY_START_MONTH - 1, 1), Date.UTC(fy + 1, FY_START_MONTH - 1, 1), label);
  }

  function fmt(ms) {
    return LQ.ValueParser.formatDate(ms);
  }

  /** 今日を基準にした言葉 → 期間（言葉でなければ null） */
  function relative(s, today) {
    const t = new Date(today);
    const y = t.getUTCFullYear();
    const m = t.getUTCMonth() + 1;
    const monday = today - ((t.getUTCDay() + 6) % 7) * DAY;
    const fy = m >= FY_START_MONTH ? y : y - 1;
    switch (s) {
      case '今日': case '本日': return range(today, today + DAY, '今日');
      case '昨日': return range(today - DAY, today, '昨日');
      case '明日': return range(today + DAY, today + 2 * DAY, '明日');
      case '今週': return range(monday, monday + 7 * DAY, '今週（月曜〜日曜）');
      case '先週': return range(monday - 7 * DAY, monday, '先週（月曜〜日曜）');
      case '来週': return range(monday + 7 * DAY, monday + 14 * DAY, '来週（月曜〜日曜）');
      case '今月': return monthRange(y, m, '今月');
      case '先月': return monthRange(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1, '先月');
      case '来月': return monthRange(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, '来月');
      case '今年': return range(Date.UTC(y, 0, 1), Date.UTC(y + 1, 0, 1), '今年');
      case '昨年': case '去年': return range(Date.UTC(y - 1, 0, 1), Date.UTC(y, 0, 1), '昨年');
      case '来年': return range(Date.UTC(y + 1, 0, 1), Date.UTC(y + 2, 0, 1), '来年');
      case '今年度': return fiscalRange(fy, '今年度（' + fy + '年度）');
      case '前年度': case '昨年度': return fiscalRange(fy - 1, '前年度（' + (fy - 1) + '年度）');
      case '来年度': return fiscalRange(fy + 1, '来年度（' + (fy + 1) + '年度）');
      default: break;
    }
    let r = RE_LAST_DAYS.exec(s);
    if (r && Number(r[1]) > 0) return range(today - (Number(r[1]) - 1) * DAY, today + DAY, '直近 ' + Number(r[1]) + ' 日（今日を含む）');
    r = RE_NEXT_DAYS.exec(s);
    if (r && Number(r[1]) > 0) return range(today, today + Number(r[1]) * DAY, '今後 ' + Number(r[1]) + ' 日（今日を含む）');
    return null;
  }

  const Period = {
    WORDS: WORDS,
    DAY: DAY,

    /**
     * 期間として読む（読めなければ null）。
     * @param {*} raw
     * @param {Date} [now] 今日の基準（省略時は現在）
     * @returns {{start:number, end:number, label:string}|null}
     */
    parse(raw, now) {
      if (raw === null || raw === undefined) return null;
      const s = String(raw).normalize('NFKC').replace(/\s+/g, '');
      if (!s) return null;
      const rel = relative(s, todayUtc(now));
      if (rel) return rel;
      let r = RE_FISCAL.exec(s);
      if (r) return fiscalRange(Number(r[1]), r[1] + '年度（4月〜翌3月）');
      r = RE_YEAR.exec(s);
      if (r) return range(Date.UTC(Number(r[1]), 0, 1), Date.UTC(Number(r[1]) + 1, 0, 1), r[1] + '年');
      r = RE_MONTH.exec(s);
      if (r) {
        const mo = Number(r[2]);
        if (mo < 1 || mo > 12) return null;
        return monthRange(Number(r[1]), mo, r[1] + '年' + mo + '月');
      }
      const d = LQ.ValueParser.parseDate(s);
      if (Number.isNaN(d)) return null;
      const day = Math.floor(d / DAY) * DAY;
      return range(day, day + DAY, fmt(day));
    },

    /** 期間の説明（根拠表示用）：「今月（2025/06/01〜2025/06/30）」 */
    describe(p) {
      if (!p) return '';
      const range = fmt(p.start) + '〜' + fmt(p.end - DAY);
      if (p.start + DAY === p.end) return p.label === fmt(p.start) ? p.label : p.label + '（' + fmt(p.start) + '）';
      return p.label + '（' + range + '）';
    },

    /** 今日の日付の文字（計算結果の再利用のキーに使う） */
    todayKey(now) {
      return String(todayUtc(now));
    }
  };

  LQ.Period = Period;
})(window);

/* =========================================================================
 * ── 比較方法の登録簿 ──
 * 比較方法（演算子）の登録簿。新しい比較方法は register() で追加するだけでよい。
 *   prep：値の下ごしらえ方法（key＝同値判定用 / text＝文字列比較用 / typed＝大小比較用）
 *   test(left, right)：true / false / null（比較できない）を返す
 *   wildcard：② の値・固定値の「*」をワイルドカードとして扱う（照合ルールが ON のとき。negative なら当てはまらない行が真）
 *   rightPrep：② の値・固定値の下ごしらえが ① と違うとき（期間 = period）
 *   pair：② の値を 2 つ使う（範囲：開始〜終了。test(left, right, right2)）
 *   date：① が日付の列のときの呼び方 {name, phrase}（以降・以前など）
 *   日付どうしの「以下・超え・範囲の終わり」は、時刻のない日付を「その日の終わり」までとして比べる
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const TYPE = LQ.Normalizer.TYPE;
  const collator = new Intl.Collator('ja', { numeric: true });

  const GROUPS = [
    { id: 'match', label: '一致', dateLabel: '一致' },
    { id: 'partial', label: '部分一致', dateLabel: '部分一致' },
    { id: 'compare', label: '大小比較（数値・日付）', dateLabel: '日付（から・まで・範囲）' },
    { id: 'period', label: '期間（日付の列）', dateLabel: '期間（年・年月・今月など）' }
  ];
  const DAY = 86400000;

  const registry = new Map();

  /**
   * 大小比較。左が空欄なら undefined（不一致だが「比較不能」には数えない）、
   * 型が異なれば null（比較不能）、それ以外は差を返す。
   */
  function compareTyped(left, right) {
    if (left.t === TYPE.EMPTY) return undefined;
    if (left.t !== right.t) return null;
    if (left.t === TYPE.TEXT) return collator.compare(left.s, right.s);
    return left.n - right.n;
  }

  /** 時刻のない日付を「その日の終わり」にする（まで・より後の比較用） */
  function dayEnd(right) {
    return right.t === TYPE.DATE && right.n % DAY === 0 ? { t: TYPE.DATE, n: right.n + DAY - 1, s: '' } : right;
  }

  function comparator(predicate, untilEndOfDay) {
    return (left, r) => {
      const right = untilEndOfDay ? dayEnd(r) : r;
      const diff = compareTyped(left, right);
      if (diff === undefined) return false;
      if (diff === null) return null;
      return predicate(diff);
    };
  }

  const Operators = {
    register(def) {
      registry.set(def.id, Object.freeze(Object.assign({ negative: false, positive: null, wildcard: false, rightPrep: null, pair: false, date: null }, def)));
    },

    get(id) {
      return registry.get(id) || null;
    },

    list() {
      return Array.from(registry.values()).sort((a, b) => a.order - b.order);
    },

    /** @param {boolean} [isDate] ① が日付の列なら、日付の比較を先頭にして日付向けの呼び方にする */
    groups(isDate) {
      const all = Operators.list();
      const groups = GROUPS.map((g) => ({ id: g.id, label: isDate ? g.dateLabel : g.label, items: all.filter((op) => op.group === g.id) }))
        .filter((g) => g.items.length);
      if (!isDate) return groups;
      const first = groups.filter((g) => g.id === 'compare' || g.id === 'period');
      return first.concat(groups.filter((g) => first.indexOf(g) === -1));
    },

    /** 画面に出す呼び方（日付の列なら日付向け） */
    nameOf(op, isDate) {
      return isDate && op.date ? op.date.name : op.name;
    },

    phraseOf(op, isDate) {
      return isDate && op.date ? op.date.phrase : op.phrase;
    },

    compareTyped: compareTyped,

    /** 型の違いによる比較不能の説明 */
    typeLabel(t) {
      return { 0: '空欄', 1: '数値', 2: '日付', 3: '文字' }[t] || '';
    }
  };

  Operators.register({
    id: 'eq', name: '完全一致', phrase: 'と完全一致', group: 'match', order: 10, prep: 'key', wildcard: true,
    test: (l, r) => l === r
  });
  Operators.register({
    id: 'neq', name: '一致しない', phrase: 'と一致しない', group: 'match', order: 20, prep: 'key',
    negative: true, positive: 'eq', wildcard: true,
    test: (l, r) => l !== r
  });
  Operators.register({
    id: 'contains', name: '含む', phrase: 'を含む', group: 'partial', order: 30, prep: 'text',
    test: (l, r) => l.indexOf(r) !== -1
  });
  Operators.register({
    id: 'notContains', name: '含まない', phrase: 'を含まない', group: 'partial', order: 40, prep: 'text',
    negative: true, positive: 'contains',
    test: (l, r) => l.indexOf(r) === -1
  });
  Operators.register({
    id: 'startsWith', name: '前方一致', phrase: 'で始まる', group: 'partial', order: 50, prep: 'text',
    test: (l, r) => l.startsWith(r)
  });
  Operators.register({
    id: 'endsWith', name: '後方一致', phrase: 'で終わる', group: 'partial', order: 60, prep: 'text',
    test: (l, r) => l.endsWith(r)
  });
  Operators.register({
    id: 'gte', name: '以上', phrase: '以上', group: 'compare', order: 70, prep: 'typed',
    date: { name: '以降（から）', phrase: '以降（その日を含む）' },
    test: comparator((d) => d >= 0)
  });
  Operators.register({
    id: 'gt', name: '超え', phrase: 'を超える', group: 'compare', order: 80, prep: 'typed',
    date: { name: 'より後', phrase: 'より後（翌日から）' },
    test: comparator((d) => d > 0, true)
  });
  Operators.register({
    id: 'lte', name: '以下', phrase: '以下', group: 'compare', order: 90, prep: 'typed',
    date: { name: '以前（まで）', phrase: '以前（その日を含む）' },
    test: comparator((d) => d <= 0, true)
  });
  Operators.register({
    id: 'lt', name: '未満', phrase: '未満', group: 'compare', order: 100, prep: 'typed',
    date: { name: 'より前', phrase: 'より前（前日まで）' },
    test: comparator((d) => d < 0)
  });
  /* 範囲：開始・終了のどちらかが空欄ならその側は無制限。両端を含む */
  Operators.register({
    id: 'between', name: '範囲（以上〜以下）', phrase: 'の範囲内（両端を含む）', group: 'compare', order: 105, prep: 'typed', pair: true,
    date: { name: '範囲（から〜まで）', phrase: 'の範囲内（両端の日を含む）' },
    test: (left, lo, hi) => {
      if (left.t === TYPE.EMPTY) return false;
      if (lo && lo.t !== TYPE.EMPTY) {
        const d = compareTyped(left, lo);
        if (d === null) return null;
        if (d < 0) return false;
      }
      if (hi && hi.t !== TYPE.EMPTY) {
        const d = compareTyped(left, dayEnd(hi));
        if (d === null) return null;
        if (d > 0) return false;
      }
      return true;
    }
  });
  /* 期間：② の値（2024・2024/05・2024年度・今月・直近30日 など）が表す期間に ① の日付が入るか */
  Operators.register({
    id: 'period', name: '期間に含まれる', phrase: 'の期間内', group: 'period', order: 110, prep: 'typed', rightPrep: 'period',
    date: { name: '期間に含まれる（年・年月・今月など）', phrase: 'の期間内' },
    test: (left, period) => {
      if (left.t === TYPE.EMPTY) return false;
      if (!period || left.t !== TYPE.DATE) return null;
      return left.n >= period.start && left.n < period.end;
    }
  });

  LQ.Operators = Operators;
})(window);

/* =========================================================================
 * ── 組み合わせ式 ──
 * 条件の組み合わせ式（例：(A or B) and C）の解析・検証・書き戻し・読み下し
 *   構文木：{type:'cond', label:'A'} / {type:'and'|'or', children:[...]}
 *   and は or より先に結び付く（一般的な優先順位）。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;

  class LogicError extends Error {
    constructor(message, pos) {
      super(message);
      this.pos = pos;
    }
  }

  /* 日本語・記号の別表記（NFKC 正規化後に照合する） */
  const SYMBOLS = [
    ['かつ', 'and'], ['または', 'or'], ['又は', 'or'], ['&&', 'and'], ['||', 'or'], ['&', 'and'], ['|', 'or']
  ];
  const JA = { and: 'かつ', or: 'または' };

  function tokenize(input) {
    const s = String(input || '').normalize('NFKC');
    const tokens = [];
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (/\s/.test(ch)) {
        i++;
        continue;
      }
      if (ch === '(' || ch === ')') {
        tokens.push({ type: ch === '(' ? 'lp' : 'rp', pos: i, text: ch });
        i++;
        continue;
      }
      const sym = SYMBOLS.find((pair) => s.startsWith(pair[0], i));
      if (sym) {
        tokens.push({ type: sym[1], pos: i, text: sym[0] });
        i += sym[0].length;
        continue;
      }
      if (/[A-Za-z]/.test(ch)) {
        let j = i;
        while (j < s.length && /[A-Za-z]/.test(s[j])) j++;
        const word = s.slice(i, j);
        const lower = word.toLowerCase();
        if (lower === 'and' || lower === 'or') tokens.push({ type: lower, pos: i, text: word });
        else if (lower === 'not') throw new LogicError('「not」は使えません。比較方法の「含まない」「一致しない」を使ってください', i);
        else if (word.length === 1) tokens.push({ type: 'id', value: word.toUpperCase(), pos: i, text: word });
        else throw new LogicError('「' + word + '」を解釈できません。記号と and / or の間には空白を入れてください', i);
        i = j;
        continue;
      }
      throw new LogicError('「' + ch + '」は式に使えない文字です', i);
    }
    return { tokens: tokens, length: s.length };
  }

  function flatten(type, items) {
    const out = [];
    items.forEach((item) => {
      if (item.type === type) Array.prototype.push.apply(out, item.children);
      else out.push(item);
    });
    return out;
  }

  class Parser {
    constructor(tokens, length) {
      this.tokens = tokens;
      this.length = length;
      this.index = 0;
    }

    peek() {
      return this.tokens[this.index];
    }

    next() {
      return this.tokens[this.index++];
    }

    parseExpr() {
      const items = [this.parseTerm()];
      while (this.peek() && this.peek().type === 'or') {
        this.next();
        items.push(this.parseTerm());
      }
      return items.length === 1 ? items[0] : { type: 'or', children: flatten('or', items) };
    }

    parseTerm() {
      const items = [this.parseFactor()];
      while (this.peek() && this.peek().type === 'and') {
        this.next();
        items.push(this.parseFactor());
      }
      return items.length === 1 ? items[0] : { type: 'and', children: flatten('and', items) };
    }

    parseFactor() {
      const tok = this.next();
      if (!tok) throw new LogicError('式が途中で終わっています。最後に条件の記号（A など）が必要です', this.length);
      if (tok.type === 'id') return { type: 'cond', label: tok.value };
      if (tok.type === 'lp') {
        const inner = this.parseExpr();
        const close = this.next();
        if (!close || close.type !== 'rp') throw new LogicError('「(」に対応する「)」がありません', tok.pos);
        return inner;
      }
      if (tok.type === 'rp') throw new LogicError('「)」に対応する「(」がありません', tok.pos);
      throw new LogicError('「' + tok.text + '」の前に条件の記号（A など）が必要です', tok.pos);
    }
  }

  function collectLabels(node, out) {
    if (!node) return out;
    if (node.type === 'cond') out.push(node.label);
    else node.children.forEach((child) => collectLabels(child, out));
    return out;
  }

  const Logic = {
    LogicError: LogicError,

    /**
     * 式を解析して検証する。
     * @param {string} input
     * @param {string[]} knownLabels 存在する条件の記号
     * @returns {{ok:boolean, ast:object|null, error:{message:string,pos:number}|null, used:string[], unused:string[]}}
     */
    parse(input, knownLabels) {
      const known = new Set(knownLabels || []);
      try {
        const tk = tokenize(input);
        if (!tk.tokens.length) throw new LogicError('式が空です。例：(A or B) and C', 0);
        const parser = new Parser(tk.tokens, tk.length);
        const ast = parser.parseExpr();
        const rest = parser.peek();
        if (rest) {
          if (rest.type === 'rp') throw new LogicError('「)」に対応する「(」がありません', rest.pos);
          throw new LogicError('「' + rest.text + '」の前に and または or が必要です', rest.pos);
        }
        const used = Array.from(new Set(collectLabels(ast, [])));
        const unknown = used.filter((label) => !known.has(label));
        if (unknown.length) {
          throw new LogicError('条件 ' + unknown.join('・') + ' はありません（使える記号：' + (Array.from(known).join('・') || 'なし') + '）', -1);
        }
        const unused = (knownLabels || []).filter((label) => used.indexOf(label) === -1);
        return { ok: true, ast: ast, error: null, used: used, unused: unused };
      } catch (err) {
        if (!(err instanceof LogicError)) throw err;
        return { ok: false, ast: null, error: { message: err.message, pos: err.pos }, used: [], unused: [] };
      }
    },

    /** 「すべて満たす / いずれか満たす」を構文木にする */
    fromMode(mode, labels) {
      if (!labels.length) return null;
      if (labels.length === 1) return { type: 'cond', label: labels[0] };
      return { type: mode === 'or' ? 'or' : 'and', children: labels.map((label) => ({ type: 'cond', label: label })) };
    },

    /** 構文木 → 式の文字列（異なる種類が入れ子になる所には必ず括弧を付ける） */
    serialize(node, parentType, words) {
      if (!node) return '';
      const w = words || { and: 'and', or: 'or' };
      if (node.type === 'cond') return node.label;
      const inner = node.children.map((child) => Logic.serialize(child, node.type, w)).join(' ' + w[node.type] + ' ');
      return parentType && parentType !== node.type ? '(' + inner + ')' : inner;
    },

    /** 日本語の読み下し（(A または B) かつ C） */
    toJapanese(node) {
      return Logic.serialize(node, null, JA);
    },

    /** 読み下しを部品に分ける（記号はバッジ表示するため） */
    toParts(node, parentType) {
      if (!node) return [];
      if (node.type === 'cond') return [{ kind: 'label', text: node.label }];
      const parts = [];
      const nested = parentType && parentType !== node.type;
      if (nested) parts.push({ kind: 'paren', text: '(' });
      node.children.forEach((child, i) => {
        if (i > 0) parts.push({ kind: 'op', text: JA[node.type], op: node.type });
        Array.prototype.push.apply(parts, Logic.toParts(child, node.type));
      });
      if (nested) parts.push({ kind: 'paren', text: ')' });
      return parts;
    },

    /** 条件を削除したときに式から取り除く（空になれば null） */
    removeLabel(node, label) {
      if (!node) return null;
      if (node.type === 'cond') return node.label === label ? null : node;
      const children = node.children.map((child) => Logic.removeLabel(child, label)).filter(Boolean);
      if (!children.length) return null;
      if (children.length === 1) return children[0];
      return { type: node.type, children: flatten(node.type, children) };
    },

    /** 式全体が真になるために必ず満たす（または判定しない）必要がある条件の記号 */
    requiredLabels(node) {
      if (!node) return [];
      if (node.type === 'cond') return [node.label];
      if (node.type === 'and') {
        const out = [];
        node.children.forEach((child) => Array.prototype.push.apply(out, Logic.requiredLabels(child)));
        return out;
      }
      return [];
    },

    labelsIn(node) {
      return Array.from(new Set(collectLabels(node, [])));
    }
  };

  LQ.Logic = Logic;
})(window);

/* =========================================================================
 * ── 抽出エンジン ──
 * 抽出エンジン：② の 1 行＝1 セットの条件として ① の各行を照合する（Power Query の結合に近い動き）
 *   ・② の空欄セルを参照する条件は「判定しない」（AND / OR から除外）
 *   ・出力する行：一致した行（内部結合）/ 一致しなかった行（左反結合）/ すべての行（左外部結合）
 *   ・複数一致：最初の 1 行のみ / すべての組み合わせ
 *   ・「完全一致」が必須の条件は索引で候補を絞り込み、処理は小分けにして進捗を通知する
 *   ・完全一致・一致しないでは、② の値・固定値の「*」をワイルドカードとして当てはめる（照合ルールで切替）
 *   ・範囲（pair）は ② の値を 2 つ（開始・終了）使い、空欄の側は無制限。期間は ② の値を期間として読む
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Normalizer = LQ.Normalizer;
  const Operators = LQ.Operators;
  const Logic = LQ.Logic;
  const Async = LQ.Async;

  const JOIN_KINDS = [
    { id: 'inner', label: '一致した行', note: '内部結合', desc: '② のいずれかの行の条件を満たす ① の行を出力します。' },
    { id: 'anti', label: '一致しなかった行', note: '左反結合', desc: '② のどの行の条件も満たさない ① の行を出力します（除外リストとして使うとき）。' },
    { id: 'left', label: 'すべての行', note: '左外部結合', desc: '① の全行を出力し、一致した ② の行があればその列を付けます。' }
  ];
  const MATCH_MODES = [
    { id: 'first', label: '最初の 1 行のみ', desc: '① の 1 行につき、最初に一致した ② の行だけを使います（結果は ① の行数以下）。' },
    { id: 'all', label: 'すべての組み合わせ', desc: '一致した ② の行ごとに 1 行ずつ出力します（① の行が重複します）。' }
  ];
  const MAX_OUTPUT_ROWS = 1000000;
  const CANCELLED = { cancelled: true };
  const EMPTY_LIST = [];

  /* ---------------------------------------------------------------------
   * 索引：必須条件（AND の直下）を使い、① の各行で照合すべき ② の行を絞り込む。
   *   list(x) … ① の行 x の候補（昇順）/ always … 常に照合する行（空欄・短い語、昇順）
   * ------------------------------------------------------------------- */
  function affixIndex(p, M, keyOf, weight) {
    const map = new Map();
    const always = [];
    for (let r = 0; r < M; r++) {
      const s = p.right[r];
      if (p.blank[r] || s.length < 2) {
        always.push(r);
        continue;
      }
      const key = keyOf(s);
      const list = map.get(key);
      if (list) list.push(r);
      else map.set(key, [r]);
    }
    return {
      p: p,
      always: always,
      score: weight * map.size / (1 + always.length),
      list: (x) => {
        const s = p.left[x];
        return s.length < 2 ? EMPTY_LIST : (map.get(keyOf(s)) || EMPTY_LIST);
      }
    };
  }

  const INDEXERS = {
    eq(p, M) {
      const map = new Map();
      const always = [];
      const pattern = p.pattern;
      for (let r = 0; r < M; r++) {
        if (p.blank[r] || (pattern && pattern[r])) {
          always.push(r);
          continue;
        }
        const key = p.right[r];
        const list = map.get(key);
        if (list) list.push(r);
        else map.set(key, [r]);
      }
      return {
        p: p,
        always: always,
        score: map.size / (1 + always.length),
        list: (x) => {
          const key = p.left[x];
          return key === '' ? EMPTY_LIST : (map.get(key) || EMPTY_LIST);
        }
      };
    },

    startsWith(p, M) {
      return affixIndex(p, M, (s) => s.slice(0, 2), 0.5);
    },

    endsWith(p, M) {
      return affixIndex(p, M, (s) => s.slice(-2), 0.5);
    },

    /* 含む：各キーワードの「最も珍しい 2 文字」で登録し、① の文字列の 2 文字ずつで候補を引く */
    contains(p, M) {
      const always = [];
      const grams = new Array(M);
      const freq = new Map();
      for (let r = 0; r < M; r++) {
        const s = p.right[r];
        if (p.blank[r] || s.length < 2) {
          always.push(r);
          continue;
        }
        const set = new Set();
        for (let i = 0; i + 2 <= s.length; i++) set.add(s.substr(i, 2));
        grams[r] = set;
        set.forEach((g) => freq.set(g, (freq.get(g) || 0) + 1));
      }
      const map = new Map();
      for (let r = 0; r < M; r++) {
        const set = grams[r];
        if (!set) continue;
        let best = null;
        let bestFreq = Infinity;
        set.forEach((g) => {
          const f = freq.get(g);
          if (f < bestFreq) {
            bestFreq = f;
            best = g;
          }
        });
        const list = map.get(best);
        if (list) list.push(r);
        else map.set(best, [r]);
      }
      const stamp = new Int32Array(M).fill(-1);
      const buf = [];
      return {
        p: p,
        always: always,
        score: 0.3 * map.size / (1 + always.length),
        list: (x) => {
          const s = p.left[x];
          buf.length = 0;
          for (let i = 0; i + 2 <= s.length; i++) {
            const rows = map.get(s.substr(i, 2));
            if (!rows) continue;
            for (let k = 0; k < rows.length; k++) {
              const r = rows[k];
              if (stamp[r] !== x) {
                stamp[r] = x;
                buf.push(r);
              }
            }
          }
          if (buf.length > 1) buf.sort((a, b) => a - b);
          return buf;
        }
      };
    }
  };

  /* 伸長する Int32 配列 3 本（① 行・② 行・一致数） */
  class ResultBuilder {
    constructor(capacity) {
      this.cap = Math.max(1024, capacity || 0);
      this.src = new Int32Array(this.cap);
      this.cond = new Int32Array(this.cap);
      this.count = new Int32Array(this.cap);
      this.length = 0;
    }

    push(s, c, n) {
      if (this.length === this.cap) this._grow();
      const i = this.length++;
      this.src[i] = s;
      this.cond[i] = c;
      this.count[i] = n;
    }

    fillCount(from, n) {
      this.count.fill(n, from, this.length);
    }

    _grow() {
      this.cap *= 2;
      ['src', 'cond', 'count'].forEach((key) => {
        const next = new Int32Array(this.cap);
        next.set(this[key]);
        this[key] = next;
      });
    }

    finish() {
      return {
        src: this.src.slice(0, this.length),
        cond: this.cond.slice(0, this.length),
        count: this.count.slice(0, this.length),
        length: this.length
      };
    }
  }

  class QueryEngine {
    constructor() {
      this._cache = new WeakMap();
    }

    static get JOIN_KINDS() {
      return JOIN_KINDS;
    }

    static get MATCH_MODES() {
      return MATCH_MODES;
    }

    /** 条件 1 件の文章表現（根拠表示・出力ファイルの記録用） */
    static describeCondition(c) {
      const op = Operators.get(c.op);
      const left = c.left ? '① ' + c.left : '（① 未選択）';
      return c.label + '：' + left + ' が ' + QueryEngine.describeRight(c, op) + ' ' + (op ? op.phrase : '（比較方法未選択）');
    }

    /** 比べる相手の文章表現（範囲は「開始〜終了」、空欄の側は「指定なし」） */
    static describeRight(c, op) {
      const r = c.right;
      if (op && op.pair) {
        if (r.type === 'column') return (r.col ? '② ' + r.col : '（指定なし）') + '〜' + (r.col2 ? '② ' + r.col2 : '（指定なし）');
        const v = (x) => (Normalizer.isBlank(x) ? '（指定なし）' : '「' + x + '」');
        return '固定値' + v(r.value) + '〜' + v(r.value2);
      }
      if (r.type === 'column') return r.col ? '② ' + r.col : '（② 未選択）';
      if (op && op.rightPrep === 'period') {
        const p = LQ.Period.parse(r.value);
        return '固定値「' + (r.value || '') + '」' + (p && p.label !== r.value ? '［' + LQ.Period.describe(p) + '］' : '');
      }
      return '固定値「' + (r.value || '') + '」';
    }

    /** 条件 1 件の不備を調べる */
    checkCondition(c, source, condition) {
      const out = [];
      if (!c.left) out.push({ field: 'left', code: 'left', message: '① の列を選んでください' });
      else if (source && source.findColumn(c.left) < 0) out.push({ field: 'left', code: 'leftMissing', message: '① に列「' + c.left + '」がありません' });
      const op = Operators.get(c.op);
      if (!op) out.push({ field: 'op', code: 'op', message: '比較方法を選んでください' });
      if (op && op.pair) return out.concat(this._checkPair(c, condition));
      if (c.right.type === 'column') {
        if (!condition) out.push({ field: 'right', code: 'noConditionData', message: '② 条件データが読み込まれていません（固定値にすることもできます）' });
        else if (!c.right.col) out.push({ field: 'right', code: 'right', message: '② の列を選ぶか、固定値を入力してください' });
        else if (condition.findColumn(c.right.col) < 0) out.push({ field: 'right', code: 'rightMissing', message: '② に列「' + c.right.col + '」がありません' });
      } else if (Normalizer.isBlank(c.right.value)) {
        out.push({ field: 'right', code: 'value', message: '固定値を入力してください' });
      } else if (op && op.rightPrep === 'period' && !LQ.Period.parse(c.right.value)) {
        out.push({ field: 'right', code: 'period', message: '「' + c.right.value + '」は期間として読めません（例：2024・2024/05・2024年度・今月・直近30日）' });
      }
      return out;
    }

    /** 範囲：開始・終了の少なくとも一方が必要 */
    _checkPair(c, condition) {
      const r = c.right;
      if (r.type === 'column') {
        if (!condition) return [{ field: 'right', code: 'noConditionData', message: '② 条件データが読み込まれていません（固定値にすることもできます）' }];
        if (!r.col && !r.col2) return [{ field: 'right', code: 'right', message: '② の開始の列・終了の列の少なくとも一方を選んでください' }];
        const missing = [r.col, r.col2].filter((name) => name && condition.findColumn(name) < 0);
        return missing.length ? [{ field: 'right', code: 'rightMissing', message: '② に列「' + missing[0] + '」がありません' }] : [];
      }
      if (Normalizer.isBlank(r.value) && Normalizer.isBlank(r.value2)) {
        return [{ field: 'right', code: 'value', message: '開始・終了の少なくとも一方を入力してください（空欄の側は制限なし）' }];
      }
      return [];
    }

    /**
     * 実行前の検証。式で使われる条件の不備は error、使われない条件の不備は warn とする。
     */
    validate(query, source, condition) {
      const issues = [];
      const conds = query.conditions;
      const labels = conds.map((c) => c.label);
      const add = (level, message, extra) => issues.push(Object.assign({ level: level, message: message }, extra || {}));
      if (!source) add('error', '① 元データが読み込まれていません', { code: 'noSource' });
      if (!conds.length) add('error', '条件がありません。「条件を追加」から作成してください', { code: 'noCondition' });
      let ast = null;
      let exprError = null;
      let unused = [];
      if (conds.length) {
        if (query.logic.mode === 'expr') {
          const parsed = Logic.parse(query.logic.expr, labels);
          if (parsed.ok) {
            ast = parsed.ast;
            unused = parsed.unused;
          } else {
            exprError = parsed.error;
            add('error', '式：' + parsed.error.message, { code: 'expr' });
          }
        } else {
          ast = Logic.fromMode(query.logic.mode, labels);
        }
      }
      const used = new Set(ast ? Logic.labelsIn(ast) : labels);
      conds.forEach((c) => {
        const inUse = used.has(c.label);
        this.checkCondition(c, source, condition).forEach((p) => {
          add(inUse ? 'error' : 'warn', '条件 ' + c.label + '：' + p.message, { code: p.code, condId: c.id, field: p.field });
        });
      });
      unused.forEach((label) => {
        const c = conds.find((x) => x.label === label);
        add('warn', '条件 ' + label + ' は式に含まれていないため使われません', { code: 'unused', condId: c ? c.id : null });
      });
      const errors = issues.filter((i) => i.level === 'error');
      const needsCondition = !!ast && conds.some((c) => used.has(c.label) && c.right.type === 'column');
      return {
        ok: errors.length === 0,
        issues: issues,
        errors: errors,
        warnings: issues.filter((i) => i.level === 'warn'),
        ast: ast,
        exprError: exprError,
        needsCondition: needsCondition
      };
    }

    /**
     * 抽出を実行する。
     * @param {{source:LQ.Dataset, condition:LQ.Dataset|null, query:object, rules:object}} ctx
     * @param {{onProgress?:Function, token?:LQ.CancelToken}} hooks
     * @returns {Promise<object>} 結果（中止時は {cancelled:true}）
     */
    async run(ctx, hooks) {
      const h = hooks || {};
      const onProgress = h.onProgress || function () {};
      const token = h.token || new LQ.CancelToken();
      const check = this.validate(ctx.query, ctx.source, ctx.condition);
      if (!check.ok) throw new Error(check.errors[0].message);
      try {
        return await this._execute(ctx, check, onProgress, token);
      } catch (err) {
        if (err === CANCELLED) return CANCELLED;
        throw err;
      }
    }

    async _execute(ctx, check, onProgress, token) {
      const started = performance.now();
      const source = ctx.source;
      const condition = ctx.condition;
      const query = ctx.query;
      const norm = new Normalizer(ctx.rules);
      const ast = check.ast;
      const needsCond = check.needsCondition;
      const N = source.rowCount;
      const M = needsCond ? condition.rowCount : 0;
      const conds = Logic.labelsIn(ast).map((label) => query.conditions.find((c) => c.label === label));

      /* 1) 値の下ごしらえ（進捗 0〜20%） */
      const slicer = Async.createSlicer(24);
      let prepTotal = 0;
      conds.forEach((c) => {
        prepTotal += N;
        if (c.right.type === 'column') prepTotal += M * 2;
      });
      let prepDone = 0;
      const tick = async (inc) => {
        prepDone += inc;
        if (!slicer.due()) return;
        onProgress({ phase: 'prepare', ratio: 0.2 * Math.min(1, prepDone / Math.max(1, prepTotal)), label: '値を準備中' });
        await Async.yieldToUI();
        slicer.reset();
        if (token.cancelled) throw CANCELLED;
      };
      const prepared = [];
      for (let i = 0; i < conds.length; i++) {
        const c = conds[i];
        const op = Operators.get(c.op);
        const p = { cond: c, label: c.label, op: op, test: op.test, isColumn: c.right.type === 'column', incomparable: 0, blankCount: 0,
          pattern: null, valuePattern: null, patternCount: 0 };
        const lc = source.findColumn(c.left);
        const glob = op.wildcard && norm.rules.wildcard;
        const rprep = op.rightPrep || op.prep;
        p.left = await this._column(source, lc, op.prep, norm, tick);
        if (op.pair) {
          await this._preparePair(p, c, condition, norm, tick);
        } else if (p.isColumn) {
          const rc = condition.findColumn(c.right.col);
          p.right = await this._column(condition, rc, rprep, norm, tick);
          p.blank = await this._column(condition, rc, 'blank', norm, tick);
          for (let r = 0; r < p.blank.length; r++) p.blankCount += p.blank[r];
          if (glob) {
            const pattern = await this._column(condition, rc, 'glob', norm, tick);
            for (let r = 0; r < pattern.length; r++) if (pattern[r]) p.patternCount++;
            if (p.patternCount) p.pattern = pattern;
          }
        } else {
          p.value = norm.converter(rprep)(c.right.value);
          if (glob) p.valuePattern = norm.glob(c.right.value);
          if (p.valuePattern) p.patternCount = 1;
        }
        if (p.patternCount) p.leftText = await this._column(source, lc, 'text', norm, tick);
        prepared.push(p);
      }
      const byLabel = new Map(prepared.map((p) => [p.label, p]));

      /* 2) 索引（必須の「完全一致」条件で ② の候補行を絞る） */
      const index = needsCond ? this._buildIndex(ast, prepared, M) : null;

      /* 3) 照合（進捗 20〜100%） */
      const evaluate = this._compile(ast, byLabel);
      const joinKind = query.joinKind;
      const matchMode = needsCond ? query.matchMode : 'first';
      const pairs = matchMode === 'all' && joinKind !== 'anti';
      const stopAtFirst = joinKind === 'anti';
      const out = new ResultBuilder(joinKind === 'left' ? N : Math.min(N, 65536));
      let matchedSources = 0;
      let truncated = false;
      slicer.reset();
      for (let x = 0; x < N; x++) {
        if ((x & 127) === 0 && slicer.due()) {
          onProgress({ phase: 'match', ratio: 0.2 + 0.8 * (x / N), label: '照合中', done: x, total: N });
          await Async.yieldToUI();
          slicer.reset();
          if (token.cancelled) throw CANCELLED;
        }
        let count = 0;
        let first = -1;
        const startLen = out.length;
        if (!needsCond) {
          if (evaluate(x, -1) === 1) count = 1;
        } else {
          const list = index ? index.list(x) : null;
          const blanks = index ? index.always : null;
          let i = 0;
          let j = 0;
          let r = 0;
          for (;;) {
            if (index) {
              if (i < list.length && (j >= blanks.length || list[i] < blanks[j])) r = list[i++];
              else if (j < blanks.length) r = blanks[j++];
              else break;
            } else if (r >= M) {
              break;
            }
            if (evaluate(x, r) === 1) {
              count++;
              if (first < 0) first = r;
              if (pairs) {
                if (out.length >= MAX_OUTPUT_ROWS) {
                  truncated = true;
                  break;
                }
                out.push(x, r, 0);
              }
              if (stopAtFirst) break;
            }
            if (!index) r++;
          }
        }
        if (count > 0) matchedSources++;
        if (pairs) {
          if (count > 0) out.fillCount(startLen, count);
          else if (joinKind === 'left') out.push(x, -1, 0);
        } else if (joinKind === 'inner') {
          if (count > 0) out.push(x, first, count);
        } else if (joinKind === 'left') {
          out.push(x, first, count);
        } else if (count === 0) {
          out.push(x, -1, 0);
        }
        if (truncated) break;
      }
      onProgress({ phase: 'match', ratio: 1, label: '照合中', done: N, total: N });

      const built = out.finish();
      return {
        id: LQ.Util.uid('res'),
        src: built.src,
        cond: built.cond,
        count: built.count,
        length: built.length,
        stats: {
          sourceRows: N,
          conditionRows: M,
          needsCondition: needsCond,
          matchedSources: matchedSources,
          outputRows: built.length,
          elapsedMs: performance.now() - started,
          truncated: truncated,
          joinKind: joinKind,
          matchMode: matchMode,
          indexLabel: index ? index.p.label : null,
          indexOp: index ? index.p.op.name : null,
          perCondition: prepared.map((p) => ({
            label: p.label,
            incomparable: p.incomparable,
            blankRows: p.isColumn ? p.blankCount : 0,
            wildcardRows: p.isColumn ? p.patternCount : 0,
            wildcardValue: !!p.valuePattern
          }))
        },
        snapshot: {
          expr: Logic.serialize(ast),
          exprJa: Logic.toJapanese(ast),
          conditions: conds.map((c) => QueryEngine.describeCondition(c)),
          rules: norm.describe(),
          sourceName: source.name,
          conditionName: needsCond ? condition.name : '',
          finishedAt: new Date()
        }
      };
    }

    /** 範囲：開始・終了の値（列の片方だけでもよい）。② の行はどちらも空欄なら判定しない */
    async _preparePair(p, c, condition, norm, tick) {
      const r = c.right;
      const convert = norm.converter('typed');
      if (!p.isColumn) {
        p.value = Normalizer.isBlank(r.value) ? undefined : convert(r.value);
        p.value2 = Normalizer.isBlank(r.value2) ? undefined : convert(r.value2);
        return;
      }
      const idx = [r.col, r.col2].map((name) => (name ? condition.findColumn(name) : -1));
      p.right = idx[0] >= 0 ? await this._column(condition, idx[0], 'typed', norm, tick) : null;
      p.right2 = idx[1] >= 0 ? await this._column(condition, idx[1], 'typed', norm, tick) : null;
      const blanks = [];
      for (let i = 0; i < 2; i++) if (idx[i] >= 0) blanks.push(await this._column(condition, idx[i], 'blank', norm, tick));
      const M = condition.rowCount;
      p.blank = new Uint8Array(M);
      for (let row = 0; row < M; row++) {
        p.blank[row] = blanks.every((b) => b[row] === 1) ? 1 : 0;
        p.blankCount += p.blank[row];
      }
    }

    /** 列の値を下ごしらえする（データセットの版とルールが同じなら再利用） */
    async _column(ds, colIdx, prep, norm, tick) {
      let entry = this._cache.get(ds);
      if (!entry || entry.version !== ds.version) {
        entry = { version: ds.version, map: new Map() };
        this._cache.set(ds, entry);
      }
      const key = colIdx + '|' + prep + '|' + (prep === 'blank' ? '' : norm.signature) + (prep === 'period' ? '|' + LQ.Period.todayKey() : '');
      const n = ds.rowCount;
      if (entry.map.has(key)) {
        await tick(n);
        return entry.map.get(key);
      }
      let out;
      if (prep === 'blank') {
        out = new Uint8Array(n);
        for (let r = 0; r < n; r++) {
          out[r] = Normalizer.isBlank(ds.cell(r, colIdx)) ? 1 : 0;
          if ((r & 4095) === 4095) await tick(4096);
        }
      } else {
        const convert = norm.converter(prep);
        out = new Array(n);
        for (let r = 0; r < n; r++) {
          out[r] = convert(ds.cell(r, colIdx));
          if ((r & 4095) === 4095) await tick(4096);
        }
      }
      await tick(n & 4095);
      entry.map.set(key, out);
      return out;
    }

    _buildIndex(ast, prepared, M) {
      const required = new Set(Logic.requiredLabels(ast));
      let best = null;
      prepared.forEach((p) => {
        const build = INDEXERS[p.op.id];
        if (!build || !required.has(p.label) || !p.isColumn) return;
        const index = build(p, M);
        if (!best || index.score > best.score) best = index;
      });
      return best;
    }

    /** 構文木 → 評価関数（1＝真 / 0＝偽 / -1＝判定しない） */
    _compile(node, byLabel) {
      if (node.type === 'cond') {
        const p = byLabel.get(node.label);
        const test = p.test;
        const L = p.left;
        const LT = p.leftText;
        const neg = p.op.negative;
        if (p.op.pair) {
          const R = p.right;
          const R2 = p.right2;
          const V = p.value;
          const V2 = p.value2;
          const B = p.blank;
          return (x, r) => {
            if (p.isColumn && B[r] === 1) return -1;
            const res = p.isColumn ? test(L[x], R ? R[r] : undefined, R2 ? R2[r] : undefined) : test(L[x], V, V2);
            if (res === null) {
              p.incomparable++;
              return 0;
            }
            return res ? 1 : 0;
          };
        }
        if (p.isColumn) {
          const R = p.right;
          const B = p.blank;
          const P = p.pattern;
          return (x, r) => {
            if (B[r] === 1) return -1;
            if (P && P[r]) return P[r].test(LT[x]) !== neg ? 1 : 0;
            const res = test(L[x], R[r]);
            if (res === null) {
              p.incomparable++;
              return 0;
            }
            return res ? 1 : 0;
          };
        }
        const value = p.value;
        const VP = p.valuePattern;
        if (VP) return (x) => (VP.test(LT[x]) !== neg ? 1 : 0);
        return (x) => {
          const res = test(L[x], value);
          if (res === null) {
            p.incomparable++;
            return 0;
          }
          return res ? 1 : 0;
        };
      }
      const kids = node.children.map((child) => this._compile(child, byLabel));
      const n = kids.length;
      if (node.type === 'and') {
        return (x, r) => {
          let seen = false;
          for (let i = 0; i < n; i++) {
            const v = kids[i](x, r);
            if (v === 0) return 0;
            if (v === 1) seen = true;
          }
          return seen ? 1 : -1;
        };
      }
      return (x, r) => {
        let seen = false;
        for (let i = 0; i < n; i++) {
          const v = kids[i](x, r);
          if (v === 1) return 1;
          if (v === 0) seen = true;
        }
        return seen ? 0 : -1;
      };
    }

    /**
     * 1 行分の判定根拠（行の詳細表示用）。r は ② の行（ひも付かない場合は -1）。
     * @returns {{items:Array, exprJa:string}|null}
     */
    explain(ctx, x, r) {
      const check = this.validate(ctx.query, ctx.source, ctx.condition);
      if (!check.ok || !ctx.source) return null;
      const norm = new Normalizer(ctx.rules);
      const items = Logic.labelsIn(check.ast).map((label) => {
        const c = ctx.query.conditions.find((k) => k.label === label);
        const op = Operators.get(c.op);
        const leftValue = ctx.source.cell(x, ctx.source.findColumn(c.left));
        const base = { label: label, leftName: '① ' + c.left, leftValue: leftValue, phrase: op.phrase };
        if (op.pair) return this._explainPair(ctx, c, op, norm, base, r);
        if (c.right.type === 'column') {
          base.rightName = '② ' + c.right.col;
          if (r < 0 || !ctx.condition) return Object.assign(base, { state: 'none', rightValue: '' });
          base.rightValue = ctx.condition.cell(r, ctx.condition.findColumn(c.right.col));
          if (Normalizer.isBlank(base.rightValue)) return Object.assign(base, { state: 'ignored' });
        } else {
          base.rightName = '固定値';
          base.rightValue = c.right.value;
        }
        const pattern = op.wildcard ? norm.glob(base.rightValue) : null;
        if (pattern) {
          base.state = pattern.test(norm.text(leftValue)) !== op.negative ? 'true' : 'false';
          base.phrase = (op.negative ? 'に当てはまらない' : 'に当てはまる') + '（* はワイルドカード：' + LQ.Wildcard.kindLabel(pattern.kind) + '）';
          return base;
        }
        const rightValue = norm.converter(op.rightPrep || op.prep)(base.rightValue);
        if (op.rightPrep === 'period' && rightValue) base.phrase = op.phrase + '（' + LQ.Period.describe(rightValue) + '）';
        const res = op.test(norm.converter(op.prep)(leftValue), rightValue);
        base.state = res === null ? 'incomparable' : (res ? 'true' : 'false');
        return base;
      });
      return { items: items, exprJa: Logic.toJapanese(check.ast) };
    }

    /** 範囲の判定根拠（開始・終了の値を「〜」でつなぐ。空欄の側は「指定なし」） */
    _explainPair(ctx, c, op, norm, base, r) {
      const R = c.right;
      let lo;
      let hi;
      if (R.type === 'column') {
        base.rightName = (R.col ? '② ' + R.col : '指定なし') + '〜' + (R.col2 ? '② ' + R.col2 : '指定なし');
        if (r < 0 || !ctx.condition) return Object.assign(base, { state: 'none', rightValue: '' });
        const cellOf = (name) => (name ? ctx.condition.cell(r, ctx.condition.findColumn(name)) : '');
        lo = cellOf(R.col);
        hi = cellOf(R.col2);
      } else {
        base.rightName = '固定値';
        lo = R.value;
        hi = R.value2;
      }
      const shown = (v) => (Normalizer.isBlank(v) ? '指定なし' : String(v));
      base.rightValue = shown(lo) + '〜' + shown(hi);
      if (Normalizer.isBlank(lo) && Normalizer.isBlank(hi)) return Object.assign(base, { state: 'ignored' });
      const convert = norm.converter('typed');
      const res = op.test(convert(base.leftValue), Normalizer.isBlank(lo) ? undefined : convert(lo), Normalizer.isBlank(hi) ? undefined : convert(hi));
      base.state = res === null ? 'incomparable' : (res ? 'true' : 'false');
      return base;
    }
  }

  LQ.QueryEngine = QueryEngine;
})(window);
