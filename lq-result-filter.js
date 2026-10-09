/* =========================================================================
 * LightQuery - lq-result-filter.js
 * 抽出結果の見出しからの絞り込み：結果だけに掛けるのではなく、元の表（① / ②）の絞り込みとして掛ける。
 *   こうすると絞り込みは常に 1 か所（元の表）にしかなく、結果と元データが食い違わない。
 *   ・① の列 → ① の絞り込み
 *   ・② の列 → 結果にその列の値を出している抽出条件の ② すべて（列の名前で掛ける。① と同じ考え方）
 *   ・根拠の列（抽出条件・行番号など）→ 元の表がないため絞り込まない
 *   値の一覧で外した値は「その値を除く」として掛ける。結果に出ていない値の行（該当なしになる行など）は消さない。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const BLANK = '';
  const VALUE_LIMIT = 1000;

  function normalizer() {
    return new LQ.Normalizer(LQ.Normalizer.DEFAULT_RULES);
  }

  function blankOr(raw) {
    return LQ.Normalizer.isBlank(raw) ? BLANK : String(raw);
  }

  const ResultFilter = {
    VALUE_LIMIT: VALUE_LIMIT,

    /** 結果の列のキーで絞り込めるか（① / ② の列だけ） */
    supports(key) {
      const kind = LQ.ResultView.kindOf(key);
      return kind === 'source' || kind === 'condition';
    },

    /**
     * 絞り込みを掛ける先の表。
     * @returns {Array<{role:'source'|'condition', profileId:string|null, ds:LQ.Dataset, label:string}>}
     */
    targets(state, view, key) {
      const kind = LQ.ResultView.kindOf(key);
      const name = LQ.ResultView.nameOf(key);
      if (kind === 'source') {
        const ds = state.datasets.source;
        return ds && ds.findColumn(name) >= 0 ? [{ role: 'source', profileId: null, ds: ds, label: '① 元データ' }] : [];
      }
      if (kind !== 'condition' || !view) return [];
      const def = view.resolve(key);
      const seen = new Set();
      const list = [];
      view.parts.forEach((part, i) => {
        if (!def || !def.idxByPart || def.idxByPart[i] < 0) return;
        const p = state.profiles.find(part.id);
        /* 抽出したあとに ② を差し替えた抽出条件には掛けない（結果の値と別の表のため） */
        if (!p || p.condition !== part.condition || seen.has(p.condition)) return;
        seen.add(p.condition);
        list.push({ role: 'condition', profileId: p.id, ds: p.condition, label: '② ' + part.priority + ' 位「' + (p.name || part.name) + '」' });
      });
      return list;
    },

    /**
     * 表示中の結果にある値（種類と件数。多い順）。② の列は ② の行がひも付く行だけを数える（該当なしの空欄は数えない）。
     * @returns {{list:Array<{value:string,count:number}>, total:number, rows:number}}
     */
    distinct(view, key) {
      const def = view.resolve(key);
      const counts = new Map();
      let rows = 0;
      if (def && def.available) {
        const res = view.result;
        for (let i = 0; i < view.length; i++) {
          const k = view.rowAt(i);
          if (def.kind === 'condition') {
            const p = res.prof[k];
            if (p < 0 || res.cond[k] < 0 || def.idxByPart[p] < 0) continue;
          }
          const v = blankOr(view.rawValue(def, k));
          counts.set(v, (counts.get(v) || 0) + 1);
          rows++;
        }
      }
      const list = Array.from(counts.entries()).map(([value, count]) => ({ value: value, count: count }))
        .sort((a, b) => b.count - a.count || (a.value === BLANK ? 1 : b.value === BLANK ? -1 : a.value.localeCompare(b.value, 'ja', { numeric: true })));
      return { list: list.slice(0, VALUE_LIMIT), total: list.length, rows: rows };
    },

    /** 一覧に出した値のうち、選ばなかった値 */
    unchecked(listed, chosen) {
      const on = new Set(chosen);
      return listed.filter((v) => !on.has(v));
    },

    /**
     * 結果の一覧での指定を、その表の絞り込みに直した新しい一覧（変わらなければ null）。
     *   条件（op）：その列の絞り込みを置き換える（① / ② の見出しの一覧で直すのと同じ）
     *   値の一覧：選ばなかった値を、その列の今の絞り込みから除く（今の絞り込みがなければ「その値を除く」を足す）
     * @param {LQ.Dataset} ds
     * @param {object} f 一覧で作った絞り込み（mode：'values' | 'op'）
     * @param {string[]} removed 値の一覧で選ばなかった値
     */
    mergeInto(ds, f, removed) {
      const filters = ds.filters || [];
      const current = filters.find((x) => x.col === f.col) || null;
      const others = filters.filter((x) => x !== current);
      if (f.mode !== 'values') {
        return others.concat([{ id: current ? current.id : LQ.Util.uid('flt'), col: f.col, mode: 'op', op: f.op, value: f.value || '', value2: f.value2 || '' }]);
      }
      if (!removed.length) return null;
      const norm = normalizer();
      const drop = new Set(removed.map((v) => norm.text(v)));
      const keep = (v) => !drop.has(norm.text(v));
      const id = current ? current.id : LQ.Util.uid('flt');
      if (!current) return others.concat([{ id: id, col: f.col, mode: 'values', exclude: true, values: removed.slice() }]);
      if (current.mode === 'values' && current.exclude) {
        const known = new Set(current.values.map((v) => norm.text(v)));
        const add = removed.filter((v) => !known.has(norm.text(v)));
        return others.concat([Object.assign({}, current, { values: current.values.concat(add) })]);
      }
      if (current.mode === 'values') {
        return others.concat([Object.assign({}, current, { values: current.values.filter(keep) })]);
      }
      /* 条件（op）の絞り込み → 条件を満たす値の一覧から、選ばなかった値を除いた一覧にする */
      const allowed = ResultFilter._valuesPassing(ds, current);
      return others.concat([{ id: id, col: f.col, mode: 'values', values: allowed.values.filter(keep), known: allowed.known }]);
    },

    /** 絞り込み前の行のうち、filter を満たす行の値の一覧（と、すべての値） */
    _valuesPassing(ds, filter) {
      const c = ds.findColumn(filter.col);
      const test = LQ.RowFilter.compile(filter, ds, (r, col) => ds.baseCell(r, col)).test;
      const values = new Map();
      const known = new Map();
      const norm = normalizer();
      for (let r = 0; r < ds.baseRowCount; r++) {
        const v = blankOr(ds.baseCell(r, c));
        const k = norm.text(v);
        if (!known.has(k)) known.set(k, v);
        if ((!test || test(r)) && !values.has(k)) values.set(k, v);
      }
      return { values: Array.from(values.values()), known: Array.from(known.values()) };
    },

    /** その列の絞り込みを外した一覧（なければ null） */
    removeFrom(ds, col) {
      const filters = ds.filters || [];
      return filters.some((x) => x.col === col) ? filters.filter((x) => x.col !== col) : null;
    },

    /**
     * 表示中の結果のうち、新しい指定で残る行数（目安。振り分けの付け直し・該当なしの増減は抽出し直すまで分からない）
     * @returns {number}
     */
    estimate(view, key, f, removed) {
      const def = view.resolve(key);
      if (!def || !def.available) return view.length;
      const res = view.result;
      let test;
      if (f.mode === 'values') {
        const norm = normalizer();
        const drop = new Set(removed.map((v) => norm.text(v)));
        test = (v) => !drop.has(norm.text(v));
      } else {
        const one = { findColumn: () => 0 };
        let cur = '';
        const compiled = LQ.RowFilter.compile(f, one, () => cur);
        if (!compiled.test) return view.length;
        test = (v) => {
          cur = v;
          return compiled.test(0);
        };
      }
      let kept = 0;
      for (let i = 0; i < view.length; i++) {
        const k = view.rowAt(i);
        if (def.kind === 'condition') {
          const p = res.prof[k];
          if (p < 0 || res.cond[k] < 0 || def.idxByPart[p] < 0) {
            kept++;
            continue;
          }
        }
        if (test(blankOr(view.rawValue(def, k)))) kept++;
      }
      return kept;
    }
  };

  LQ.ResultFilter = ResultFilter;
})(window);
