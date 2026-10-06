/* =========================================================================
 * LightQuery - lq-compare.js
 * 前回との比較：基準の表（直前の抽出結果・前回出力したファイル）と今の抽出結果を、行を見分ける列（キー）で突き合わせる。
 *   増えた行：今だけにあるキー／消えた行：基準だけにあるキー／変わった行：両方にあり、同じ名前の列の値が違う
 *   キーを使わないときは、同じ名前の列の値がすべて同じ行を同じ行とみなす（変わった行は出さない）。
 *   値は前後の空白・全角半角・大文字小文字をそろえ、数・日付として読めるものは数・日付として比べる（1,000 と 1000 は同じ）。
 *   キーが重複しているときは、出てきた順に組にして比べる。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Util = LQ.Util;
  const ValueParser = LQ.ValueParser;
  const Normalizer = LQ.Normalizer;

  /* 行を見分ける列の名前らしさ（キーのおすすめに使う） */
  const KEY_NAME = /(ID|ＩＤ|番号|コード|No\.?|NO|№|キー|key)$/i;
  const SAMPLE_ROWS = 5000;

  /**
   * 比べる表：{name, kind:'previous'|'file', header:string[], rows:string[][], at:Date}
   */
  const CompareTable = {
    /** 抽出結果の見せ方から、すべての行（表示する行の絞り込みは外す）を表にする */
    fromView(view, defs, name) {
      const all = view.derive(null);
      const t = all.toTable(defs);
      const rows = [];
      t.forEachRow((row) => rows.push(row.map((v) => (v === undefined || v === null ? '' : String(v)))));
      return { name: name, kind: 'previous', header: t.header.slice(), rows: rows, at: new Date() };
    },

    /** 読み込んだファイルのデータセットから表にする */
    fromDataset(ds) {
      const header = ds.columns.map((c) => c.name);
      const rows = [];
      for (let r = 0; r < ds.rowCount; r++) rows.push(header.map((_, c) => {
        const v = ds.cell(r, c);
        return v === undefined || v === null ? '' : String(v);
      }));
      const src = ds.source;
      const sheet = src.hasSheets && src.sheetNames.length > 1 ? '［' + src.sheetName + '］' : '';
      return { name: ds.name + sheet, kind: 'file', header: header, rows: rows, at: new Date() };
    }
  };

  const Compare = {
    /** 両方にある列の名前（今の表の並び） */
    commonColumns(base, cur) {
      const set = new Set(base.header);
      return cur.header.filter((n) => set.has(n));
    },

    /**
     * キーのおすすめ：両方にある列のうち、値の重複が少なく空欄がない列。名前が ID・番号・コードで終わる列を優先する
     * @returns {string|null}
     */
    suggestKey(base, cur) {
      const common = Compare.commonColumns(base, cur);
      let best = null;
      let bestScore = -1;
      const n = Math.min(cur.rows.length, SAMPLE_ROWS);
      common.forEach((name) => {
        const c = cur.header.indexOf(name);
        const seen = new Set();
        let filled = 0;
        for (let i = 0; i < n; i++) {
          const v = cur.rows[i][c];
          if (Normalizer.isBlank(v)) continue;
          filled++;
          seen.add(v);
        }
        if (!n || !filled) return;
        const unique = seen.size / n;
        const score = unique + (KEY_NAME.test(name) ? 0.5 : 0) + (seen.size === n ? 0.25 : 0);
        if (score > bestScore) {
          bestScore = score;
          best = name;
        }
      });
      return best && bestScore >= 0.75 ? best : null;
    },

    /**
     * 突き合わせる
     * @param {object} base 基準の表
     * @param {object} cur 今の表
     * @param {string|null} key 行を見分ける列（null なら行全体）
     * @returns {{ok:boolean, message?:string, added:number[], removed:number[], changed:Array, same:number, columns:string[], dupKeys:number, key:string|null}}
     *   added：cur の行番号／removed：base の行番号／changed：[{cur, base, cols:[{name, before, after}]}]
     */
    run(base, cur, key) {
      const columns = Compare.commonColumns(base, cur);
      if (!columns.length) return { ok: false, message: '同じ名前の列がないため比べられません。前回出力したファイルか確かめてください' };
      if (key && columns.indexOf(key) === -1) return { ok: false, message: '列「' + key + '」が' + (base.header.indexOf(key) === -1 ? '基準の表' : '今の結果') + 'にないため比べられません。行を見分ける列を選び直してください' };
      const norm = new Normalizer(Normalizer.DEFAULT_RULES);
      const bi = columns.map((n) => base.header.indexOf(n));
      const ci = columns.map((n) => cur.header.indexOf(n));
      const keyOf = key
        ? ((row, idx) => norm.text(row[idx[columns.indexOf(key)]]))
        : ((row, idx) => idx.map((i) => comparable(norm, row[i])).join('\u0001'));
      /* 基準の行をキーごとに並べ、今の行を出てきた順に組にする */
      const pool = new Map();
      let dupKeys = 0;
      base.rows.forEach((row, r) => {
        const k = keyOf(row, bi);
        const list = pool.get(k);
        if (list) {
          list.push(r);
          if (key) dupKeys++;
        } else pool.set(k, [r]);
      });
      const added = [];
      const changed = [];
      let same = 0;
      const curSeen = new Set();
      cur.rows.forEach((row, r) => {
        const k = keyOf(row, ci);
        if (key) {
          if (curSeen.has(k)) dupKeys++;
          else curSeen.add(k);
        }
        const list = pool.get(k);
        if (!list || !list.length) {
          added.push(r);
          return;
        }
        const b = list.shift();
        if (!key) {
          same++;
          return;
        }
        const diffs = [];
        columns.forEach((name, j) => {
          if (name === key) return;
          const before = base.rows[b][bi[j]];
          const after = row[ci[j]];
          if (!sameValue(norm, before, after)) diffs.push({ name: name, before: before, after: after });
        });
        if (diffs.length) changed.push({ cur: r, base: b, cols: diffs });
        else same++;
      });
      const removed = [];
      pool.forEach((list) => list.forEach((r) => removed.push(r)));
      removed.sort((a, b) => a - b);
      return { ok: true, added: added, removed: removed, changed: changed, same: same, columns: columns, dupKeys: dupKeys, key: key || null };
    },

    /** 比べた結果の 1 行の文章（出力の記録・通知用） */
    summary(res) {
      const fmt = Util.formatInt;
      return '増えた行 ' + fmt(res.added.length) + '・消えた行 ' + fmt(res.removed.length) + (res.key ? '・変わった行 ' + fmt(res.changed.length) : '') + '・同じ行 ' + fmt(res.same);
    }
  };

  /** 比べる値（数・日付として読めればそれを、ほかはそろえた文字） */
  function comparable(norm, v) {
    if (Normalizer.isBlank(v)) return '';
    const n = ValueParser.parseNumber(v);
    if (!Number.isNaN(n)) return '#' + n;
    const d = ValueParser.parseDate(v);
    if (!Number.isNaN(d)) return '@' + d;
    return norm.text(v);
  }

  function sameValue(norm, a, b) {
    return comparable(norm, a) === comparable(norm, b);
  }

  LQ.CompareTable = CompareTable;
  LQ.Compare = Compare;
})(window);
