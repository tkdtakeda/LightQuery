/* =========================================================================
 * LightQuery - lq-logic.js
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
