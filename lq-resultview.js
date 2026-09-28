/* =========================================================================
 * LightQuery - lq-resultview.js
 * 抽出結果の見せ方：出力列（① / ② / 根拠）の解決、値の取り出し、抽出条件での絞り込み、並べ替え、出力用の行生成
 *   結果の各行は「どの抽出条件の行か」を持ち、② の値はその抽出条件の ② から取り出す（列構成が違ってよい）。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Normalizer = LQ.Normalizer;
  const TYPE = Normalizer.TYPE;
  const collator = new Intl.Collator('ja', { numeric: true });

  const META_COLUMNS = [
    { key: 'm:profile', name: '抽出条件', desc: '行が該当した抽出条件の名前（振り分けでは優先順位が最も高いもの）' },
    { key: 'm:priority', name: '優先順位', desc: '該当した抽出条件の優先順位（1 が最優先）' },
    { key: 'm:srcRow', name: '① 行番号', desc: '① 元データでの行番号（Excel の行番号と同じ）' },
    { key: 'm:condRow', name: '② 行番号', desc: '一致した ② 条件データの行番号' },
    { key: 'm:count', name: '② 一致数', desc: '① の行に一致した ② の行の数' }
  ];

  const KIND_OF = { 's:': 'source', 'c:': 'condition', 'm:': 'meta' };
  const UNMATCHED = -1;
  const UNMATCHED_LABEL = '（該当なし）';

  class ResultView {
    /**
     * @param {object} result BatchRunner の結果
     * @param {LQ.Dataset} source
     * @param {object} rules 並べ替えで数値・日付を解釈するための照合ルール
     * @param {Function} [nameOf] 抽出条件の id → 現在の名前（名前の変更をすぐ表示に反映するため）
     */
    constructor(result, source, rules, nameOf) {
      this.result = result;
      this.source = source;
      this.parts = result.parts;
      this.nameOf = nameOf || (() => null);
      this.rules = rules;
      this.norm = new Normalizer(rules);
      this.filter = null;
      this.base = null;
      this.order = null;
      this.sort = null;
      this._counts = null;
    }

    static get META_COLUMNS() {
      return META_COLUMNS;
    }

    static get UNMATCHED() {
      return UNMATCHED;
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

    /** 並べ替えで使う照合ルールを差し替える */
    setRules(rules) {
      this.rules = rules;
      this.norm = new Normalizer(rules);
    }

    /** 抽出条件が複数ある、または「該当なし」の行を含む結果か（抽出条件の列・絞り込みを使うか） */
    get multi() {
      return this.parts.length > 1 || this.counts().unmatched > 0 || !!this.result.stats.includeUnmatched;
    }

    /** 抽出条件の表示名（i が -1 なら該当なし） */
    partName(i) {
      if (i < 0) return UNMATCHED_LABEL;
      const part = this.parts[i];
      return this.nameOf(part.id) || part.name;
    }

    /** 抽出条件ごとの行数と、該当なしの行数（絞り込みの件数表示用） */
    counts() {
      if (this._counts) return this._counts;
      const per = new Array(this.parts.length).fill(0);
      let unmatched = 0;
      const prof = this.result.prof;
      for (let k = 0; k < this.result.length; k++) {
        if (prof[k] < 0) unmatched++;
        else per[prof[k]]++;
      }
      this._counts = { per: per, unmatched: unmatched, total: this.result.length };
      return this._counts;
    }

    /** 絞り込み（null：すべて / 0 以上：その抽出条件 / -1：該当なし）。並べ替えは setSort で付け直す */
    setFilter(filter) {
      this.filter = filter === null || filter === undefined ? null : filter;
      this.order = null;
      if (this.filter === null) {
        this.base = null;
        return;
      }
      const prof = this.result.prof;
      const list = [];
      for (let k = 0; k < this.result.length; k++) {
        if (prof[k] === this.filter) list.push(k);
      }
      this.base = Int32Array.from(list);
    }

    get length() {
      if (this.order) return this.order.length;
      return this.base ? this.base.length : this.result.length;
    }

    /** 表示の i 行目が指す結果の行 */
    rowAt(i) {
      if (this.order) return this.order[i];
      return this.base ? this.base[i] : i;
    }

    /** 今の表示範囲に含まれる抽出条件の番号 */
    _scope() {
      if (this.filter === null) return this.parts.map((p, i) => i);
      return this.filter < 0 ? [] : [this.filter];
    }

    /** その抽出条件の結果に ② の行がひも付くか */
    _linksCondition(part) {
      return !!part.condition && part.needsCondition && part.joinKind !== 'anti';
    }

    /** ② の列・行番号が使えない理由 */
    _conditionReason() {
      if (this.filter === UNMATCHED) return '「該当なし」の行には ② の行がひも付きません';
      const parts = this._scope().map((i) => this.parts[i]);
      if (parts.length && parts.every((p) => p.joinKind === 'anti')) return '「一致しなかった行」では ② の行がひも付かないため出力できません';
      return '② を参照する条件がないため ② の行はひも付きません';
    }

    /**
     * 出力列のキー → 表示用の列定義。
     * available=false でも silent=true のものは「出力できない列」の案内に出さない（表示範囲に関係しないだけの列）。
     */
    resolve(key) {
      const kind = ResultView.kindOf(key);
      const name = ResultView.nameOf(key);
      const def = { key: key, kind: kind, name: name, idx: -1, idxByPart: null, available: true, reason: null, silent: false };
      if (kind === 'source') {
        def.idx = this.source.findColumn(name);
        if (def.idx < 0) Object.assign(def, { available: false, reason: '① に列がありません' });
        return def;
      }
      if (kind === 'condition') {
        def.idxByPart = this.parts.map((p) => (this._linksCondition(p) ? p.condition.findColumn(name) : -1));
        if (this._scope().some((i) => def.idxByPart[i] >= 0)) return def;
        def.available = false;
        if (def.idxByPart.some((v) => v >= 0)) {
          def.reason = '表示中の抽出条件の ② にない列です';
          def.silent = true;
        } else if (this.parts.some((p) => p.condition && p.condition.findColumn(name) >= 0) || this.filter === UNMATCHED) {
          def.reason = this._conditionReason();
          def.silent = this.filter === UNMATCHED;
        } else {
          def.reason = '② に列がありません';
        }
        return def;
      }
      if (kind === 'meta') {
        if (key === 'm:srcRow') return def;
        if (key === 'm:profile' || key === 'm:priority') {
          if (!this.multi) Object.assign(def, { available: false, reason: '抽出条件が 1 つのときは表示しません', silent: true });
          return def;
        }
        if (!this._scope().some((i) => this._linksCondition(this.parts[i]))) {
          Object.assign(def, { available: false, reason: this._conditionReason(), silent: this.filter === UNMATCHED });
        }
        return def;
      }
      return null;
    }

    /** 表示する列の定義一覧（出力列設定の並び順・表示のみ） */
    resolveColumns(outputColumns) {
      return outputColumns.filter((c) => c.visible).map((c) => this.resolve(c.key)).filter(Boolean);
    }

    /** 結果の行 k（並べ替え前）の値 */
    rawValue(def, k) {
      if (!def.available) return '';
      const res = this.result;
      if (def.kind === 'source') return this.source.cell(res.src[k], def.idx);
      const p = res.prof[k];
      if (def.kind === 'condition') {
        if (p < 0) return '';
        const idx = def.idxByPart[p];
        const r = res.cond[k];
        return idx >= 0 && r >= 0 ? this.parts[p].condition.cell(r, idx) : '';
      }
      switch (def.key) {
        case 'm:srcRow':
          return String(this.source.rowNumber(res.src[k]));
        case 'm:profile':
          return this.partName(p);
        case 'm:priority':
          return p < 0 ? '' : String(this.parts[p].priority);
        case 'm:condRow': {
          const r = res.cond[k];
          return p >= 0 && r >= 0 && this.parts[p].condition ? String(this.parts[p].condition.rowNumber(r)) : '';
        }
        case 'm:count':
          return p >= 0 && this._linksCondition(this.parts[p]) ? String(res.count[k]) : '';
        default:
          return '';
      }
    }

    value(def, i) {
      return this.rawValue(def, this.rowAt(i));
    }

    /** 表示の i 行目の抽出条件・① と ② の行番号（行の詳細表示用） */
    pairAt(i) {
      const k = this.rowAt(i);
      const res = this.result;
      return { k: k, prof: res.prof[k], src: res.src[k], cond: res.cond[k], count: res.count[k] };
    }

    /**
     * 並べ替え。sort = {key, dir:'asc'|'desc'} / null。
     * 数値 → 日付 → 文字の順にまとめ、空欄は常に末尾。同じ値は元の順を保つ。
     */
    setSort(sort) {
      this.sort = sort || null;
      this.order = null;
      if (!sort) return true;
      const def = this.resolve(sort.key);
      if (!def || !def.available) {
        this.sort = null;
        return false;
      }
      const n = this.base ? this.base.length : this.result.length;
      const rows = new Int32Array(n);
      for (let i = 0; i < n; i++) rows[i] = this.base ? this.base[i] : i;
      const keys = new Array(n);
      for (let i = 0; i < n; i++) keys[i] = this.norm.typed(this.rawValue(def, rows[i]));
      const dir = sort.dir === 'desc' ? -1 : 1;
      const idx = new Array(n);
      for (let i = 0; i < n; i++) idx[i] = i;
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
      const order = new Int32Array(n);
      for (let i = 0; i < n; i++) order[i] = rows[idx[i]];
      this.order = order;
      return true;
    }

    /** 同じ結果・同じ並び順で、別の絞り込みの見せ方を作る（シートごとの出力用） */
    derive(filter) {
      const view = new ResultView(this.result, this.source, this.rules, this.nameOf);
      view.setFilter(filter);
      view.setSort(this.sort);
      return view;
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

    /** 出力用：見出しと全行を返す（絞り込み・並べ替え・列の並びを反映） */
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
