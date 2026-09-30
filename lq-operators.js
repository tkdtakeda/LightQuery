/* =========================================================================
 * LightQuery - lq-operators.js
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
