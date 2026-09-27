/* =========================================================================
 * LightQuery - lq-resultview.js
 * 抽出結果の見せ方：出力列（① / ② / 根拠）の解決、値の取り出し、並べ替え、出力用の行生成
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Normalizer = LQ.Normalizer;
  const TYPE = Normalizer.TYPE;
  const collator = new Intl.Collator('ja', { numeric: true });

  const META_COLUMNS = [
    { key: 'm:srcRow', name: '① 行番号', desc: '① 元データでの行番号（Excel の行番号と同じ）' },
    { key: 'm:condRow', name: '② 行番号', desc: '一致した ② 条件データの行番号' },
    { key: 'm:count', name: '② 一致数', desc: '① の行に一致した ② の行の数' }
  ];

  const KIND_OF = { 's:': 'source', 'c:': 'condition', 'm:': 'meta' };

  class ResultView {
    /**
     * @param {object} result QueryEngine の結果
     * @param {LQ.Dataset} source
     * @param {LQ.Dataset|null} condition
     * @param {object} rules 並べ替えで数値・日付を解釈するための照合ルール
     */
    constructor(result, source, condition, rules) {
      this.result = result;
      this.source = source;
      this.condition = condition;
      this.norm = new Normalizer(rules);
      this.order = null;
      this.sort = null;
    }

    static get META_COLUMNS() {
      return META_COLUMNS;
    }

    /** 並べ替えで使う照合ルールを差し替える */
    setRules(rules) {
      this.norm = new Normalizer(rules);
    }

    static kindOf(key) {
      return KIND_OF[String(key).slice(0, 2)] || null;
    }

    static nameOf(key) {
      const kind = ResultView.kindOf(key);
      if (kind === 'meta') {
        const meta = META_COLUMNS.find((m) => m.key === key);
        return meta ? meta.name : key;
      }
      return String(key).slice(2);
    }

    get length() {
      return this.result.length;
    }

    /** ② の列がこの結果で使えない理由（使えるなら null） */
    conditionUnavailableReason() {
      const stats = this.result.stats;
      if (stats.joinKind === 'anti') return '「一致しなかった行」では ② の行がひも付かないため出力できません';
      if (!stats.needsCondition) return '② を参照する条件がないため ② の行はひも付きません';
      return null;
    }

    /** 出力列のキー → 表示用の列定義 */
    resolve(key) {
      const kind = ResultView.kindOf(key);
      const name = ResultView.nameOf(key);
      if (kind === 'source') {
        const idx = this.source.findColumn(name);
        return { key: key, kind: kind, name: name, idx: idx, available: idx >= 0, reason: idx >= 0 ? null : '① に列がありません' };
      }
      if (kind === 'condition') {
        const idx = this.condition ? this.condition.findColumn(name) : -1;
        const reason = idx < 0 ? '② に列がありません' : this.conditionUnavailableReason();
        return { key: key, kind: kind, name: name, idx: idx, available: !reason, reason: reason };
      }
      if (kind === 'meta') {
        let reason = null;
        if (key !== 'm:srcRow') reason = this.conditionUnavailableReason();
        return { key: key, kind: kind, name: name, idx: -1, available: !reason, reason: reason };
      }
      return null;
    }

    /** 表示する列の定義一覧（出力列設定の並び順・表示のみ） */
    resolveColumns(outputColumns) {
      return outputColumns.filter((c) => c.visible).map((c) => this.resolve(c.key)).filter(Boolean);
    }

    /** 並べ替え後の i 行目が指す結果の行 */
    rowAt(i) {
      return this.order ? this.order[i] : i;
    }

    /** 結果の行 k（並べ替え前）の値 */
    rawValue(def, k) {
      if (!def.available) return '';
      const res = this.result;
      if (def.kind === 'source') return this.source.cell(res.src[k], def.idx);
      if (def.kind === 'condition') {
        const r = res.cond[k];
        return r >= 0 ? this.condition.cell(r, def.idx) : '';
      }
      if (def.key === 'm:srcRow') return String(this.source.rowNumber(res.src[k]));
      if (def.key === 'm:condRow') return res.cond[k] >= 0 ? String(this.condition.rowNumber(res.cond[k])) : '';
      if (def.key === 'm:count') return String(res.count[k]);
      return '';
    }

    value(def, i) {
      return this.rawValue(def, this.rowAt(i));
    }

    /** ① と ② の行番号（行の詳細表示用） */
    pairAt(i) {
      const k = this.rowAt(i);
      return { src: this.result.src[k], cond: this.result.cond[k], count: this.result.count[k] };
    }

    /**
     * 並べ替え。sort = {key, dir:'asc'|'desc'} / null。
     * 数値 → 日付 → 文字の順にまとめ、空欄は常に末尾。
     */
    setSort(sort) {
      this.sort = sort || null;
      if (!sort) {
        this.order = null;
        return true;
      }
      const def = this.resolve(sort.key);
      if (!def || !def.available) {
        this.sort = null;
        this.order = null;
        return false;
      }
      const n = this.length;
      const keys = new Array(n);
      for (let k = 0; k < n; k++) keys[k] = this.norm.typed(this.rawValue(def, k));
      const dir = sort.dir === 'desc' ? -1 : 1;
      const idx = new Array(n);
      for (let k = 0; k < n; k++) idx[k] = k;
      idx.sort((a, b) => {
        const ka = keys[a];
        const kb = keys[b];
        if (ka.t === TYPE.EMPTY || kb.t === TYPE.EMPTY) {
          if (ka.t === kb.t) return a - b;
          return ka.t === TYPE.EMPTY ? 1 : -1;
        }
        if (ka.t !== kb.t) return (ka.t - kb.t) * dir;
        const diff = ka.t === TYPE.TEXT ? collator.compare(ka.s, kb.s) : ka.n - kb.n;
        return diff === 0 ? a - b : diff * dir;
      });
      this.order = Int32Array.from(idx);
      return true;
    }

    /** 表示ページ分の行 */
    page(start, count, defs) {
      const end = Math.min(this.length, start + count);
      const rows = [];
      for (let i = start; i < end; i++) {
        rows.push({ index: i, cells: defs.map((def) => this.value(def, i)) });
      }
      return rows;
    }

    /** 出力用：見出しと全行を返す（並べ替え・列の並びを反映） */
    toTable(defs) {
      const sourceNames = new Set(defs.filter((d) => d.kind !== 'condition').map((d) => d.name));
      const header = defs.map((def) => (def.kind === 'condition' && sourceNames.has(def.name) ? '② ' : '') + def.name);
      const n = this.length;
      const self = this;
      return {
        header: header,
        defs: defs,
        rowCount: n,
        forEachRow(fn) {
          for (let i = 0; i < n; i++) {
            const row = new Array(defs.length);
            for (let c = 0; c < defs.length; c++) row[c] = self.value(defs[c], i);
            fn(row, i);
          }
        }
      };
    }
  }

  LQ.ResultView = ResultView;
})(window);
