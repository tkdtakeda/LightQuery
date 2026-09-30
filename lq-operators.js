/* =========================================================================
 * LightQuery - lq-operators.js
 * 比較方法（演算子）の登録簿。新しい比較方法は register() で追加するだけでよい。
 *   prep：値の下ごしらえ方法（key＝同値判定用 / text＝文字列比較用 / typed＝大小比較用）
 *   test(left, right)：true / false / null（比較できない）を返す
 *   wildcard：② の値・固定値の「*」をワイルドカードとして扱う（照合ルールが ON のとき。negative なら当てはまらない行が真）
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const TYPE = LQ.Normalizer.TYPE;
  const collator = new Intl.Collator('ja', { numeric: true });

  const GROUPS = [
    { id: 'match', label: '一致' },
    { id: 'partial', label: '部分一致' },
    { id: 'compare', label: '大小比較（数値・日付）' }
  ];

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

  function comparator(predicate) {
    return (left, right) => {
      const diff = compareTyped(left, right);
      if (diff === undefined) return false;
      if (diff === null) return null;
      return predicate(diff);
    };
  }

  const Operators = {
    register(def) {
      registry.set(def.id, Object.freeze(Object.assign({ negative: false, positive: null, wildcard: false }, def)));
    },

    get(id) {
      return registry.get(id) || null;
    },

    list() {
      return Array.from(registry.values()).sort((a, b) => a.order - b.order);
    },

    groups() {
      const all = Operators.list();
      return GROUPS.map((g) => ({ id: g.id, label: g.label, items: all.filter((op) => op.group === g.id) }))
        .filter((g) => g.items.length);
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
    test: comparator((d) => d >= 0)
  });
  Operators.register({
    id: 'gt', name: '超え', phrase: 'を超える', group: 'compare', order: 80, prep: 'typed',
    test: comparator((d) => d > 0)
  });
  Operators.register({
    id: 'lte', name: '以下', phrase: '以下', group: 'compare', order: 90, prep: 'typed',
    test: comparator((d) => d <= 0)
  });
  Operators.register({
    id: 'lt', name: '未満', phrase: '未満', group: 'compare', order: 100, prep: 'typed',
    test: comparator((d) => d < 0)
  });

  LQ.Operators = Operators;
})(window);
