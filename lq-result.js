/* =========================================================================
 * LightQuery - lq-result.js
 * 結果の処理：複数の抽出条件の一括実行と振り分け・結果の見せ方（集計・ピボットは lq-pivot.js）
 * （下の区切りごとに独立した部品。読み込み順どおりに並べている）
 * ========================================================================= */

/* =========================================================================
 * ── 一括実行と振り分け ──
 * 複数の抽出条件をまとめて実行し、優先順位に従って 1 つの結果にまとめる。
 *   ・各抽出条件は QueryEngine でそれぞれ実行する（① の値の下ごしらえは共有キャッシュで再利用）
 *   ・照合ルールは抽出条件ごとの設定（個別の設定がなければ全体の設定）を使う
 *   ・振り分け（assign）：複数に該当した ① の行は、優先順位が最も高い抽出条件にだけ入れる。① の行の順に並ぶ
 *   ・それぞれに出力（independent）：該当したすべての抽出条件に入れる。優先順位の順に続けて並ぶ
 *   ・どれにも該当しない行は、指定があれば「該当なし」（抽出条件の番号 -1）として加える
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Async = LQ.Async;

  const MAX_OUTPUT_ROWS = 1000000;
  const ALL_ROWS_ID = '__all_rows__';
  const COMBINE_MODES = [
    { id: 'assign', label: '優先順位で振り分け', short: '振り分け', icon: 'arrow-down-1-9',
      desc: '複数の抽出条件に該当した行は、優先順位が最も高い抽出条件にだけ入れます（重複なし）。① の行の順に並びます。' },
    { id: 'independent', label: 'それぞれに出力', short: 'それぞれに出力', icon: 'clone',
      desc: '該当したすべての抽出条件に入れます（同じ行が複数の抽出条件に出ることがあります）。優先順位の順に続けて並びます。' }
  ];

  /* 伸長する Int32 配列 4 本（抽出条件・① 行・② 行・一致数） */
  class RowsBuilder {
    constructor(capacity) {
      this.cap = Math.max(1024, capacity || 0);
      this.prof = new Int32Array(this.cap);
      this.src = new Int32Array(this.cap);
      this.cond = new Int32Array(this.cap);
      this.count = new Int32Array(this.cap);
      this.length = 0;
    }

    push(p, s, c, n) {
      if (this.length === this.cap) this._grow();
      const i = this.length++;
      this.prof[i] = p;
      this.src[i] = s;
      this.cond[i] = c;
      this.count[i] = n;
    }

    _grow() {
      this.cap *= 2;
      ['prof', 'src', 'cond', 'count'].forEach((key) => {
        const next = new Int32Array(this.cap);
        next.set(this[key]);
        this[key] = next;
      });
    }

    finish() {
      return {
        prof: this.prof.slice(0, this.length),
        src: this.src.slice(0, this.length),
        cond: this.cond.slice(0, this.length),
        count: this.count.slice(0, this.length),
        length: this.length
      };
    }
  }

  /** 抽出条件ごとの結果に含まれる ① の行の印（1＝含む） */
  function membership(result, N) {
    const mark = new Uint8Array(N);
    for (let k = 0; k < result.length; k++) mark[result.src[k]] = 1;
    return mark;
  }

  /**
   * 抽出条件ごとの結果（どれも ① の行の昇順）を 1 つにまとめる。
   * @returns {{rows:object, members:Uint8Array[], hits:number[], assigned:number[], counts:number[], matched:number, unmatched:number, truncated:boolean}}
   */
  function merge(results, N, combine) {
    const P = results.length;
    const members = results.map((r) => membership(r, N));
    const hits = members.map((m) => {
      let c = 0;
      for (let x = 0; x < N; x++) c += m[x];
      return c;
    });
    const assigned = new Array(P).fill(0);
    const counts = new Array(P).fill(0);
    const out = new RowsBuilder(Math.min(MAX_OUTPUT_ROWS, N));
    let truncated = false;
    let matched = 0;
    let unmatched = 0;
    const push = (p, x, c, n) => {
      if (out.length >= MAX_OUTPUT_ROWS) {
        truncated = true;
        return false;
      }
      out.push(p, x, c, n);
      return true;
    };
    const owner = (x) => {
      for (let i = 0; i < P; i++) if (members[i][x]) return i;
      return -1;
    };

    if (combine.mode === 'independent') {
      for (let i = 0; i < P && !truncated; i++) {
        const r = results[i];
        let last = -1;
        for (let k = 0; k < r.length; k++) {
          if (!push(i, r.src[k], r.cond[k], r.count[k])) break;
          counts[i]++;
          if (r.src[k] !== last) {
            assigned[i]++;
            last = r.src[k];
          }
        }
      }
      for (let x = 0; x < N; x++) {
        if (owner(x) >= 0) {
          matched++;
          continue;
        }
        unmatched++;
        if (combine.includeUnmatched && !truncated) push(-1, x, -1, 0);
      }
    } else {
      const cursors = new Int32Array(P);
      for (let x = 0; x < N; x++) {
        const i = owner(x);
        if (i < 0) {
          unmatched++;
          if (combine.includeUnmatched && !truncated) push(-1, x, -1, 0);
          continue;
        }
        matched++;
        assigned[i]++;
        const r = results[i];
        let c = cursors[i];
        while (c < r.length && r.src[c] < x) c++;
        while (c < r.length && r.src[c] === x) {
          if (!truncated && push(i, x, r.cond[c], r.count[c])) counts[i]++;
          c++;
        }
        cursors[i] = c;
      }
    }
    return { rows: out.finish(), members: members, hits: hits, assigned: assigned, counts: counts, matched: matched, unmatched: unmatched, truncated: truncated };
  }

  class BatchRunner {
    constructor(engine) {
      this.engine = engine;
    }

    static get COMBINE_MODES() {
      return COMBINE_MODES;
    }

    /**
     * 有効な抽出条件をまとめて実行する。
     * @param {{source:LQ.Dataset, rules:object, combine:{mode:string, includeUnmatched:boolean},
     *          profiles:Array<{id:string, name:string, priority:number, query:object, condition:LQ.Dataset|null,
     *                          rules?:object, ownRules?:boolean}>}} ctx
     *        rules は全体の照合ルール。profiles は優先順位の順（検証済みのもの）で、rules があればそれを使う
     * @param {{onProgress?:Function, token?:LQ.CancelToken}} hooks
     * @returns {Promise<object>} 結果（中止時は {cancelled:true}）
     */
    async run(ctx, hooks) {
      const h = hooks || {};
      const onProgress = h.onProgress || function () {};
      const token = h.token || new LQ.CancelToken();
      const started = performance.now();
      const list = ctx.profiles;
      const n = list.length;
      const results = [];
      for (let i = 0; i < n; i++) {
        const p = list[i];
        const prefix = n > 1 ? '抽出条件 ' + (i + 1) + '/' + n + '「' + p.name + '」：' : '';
        const res = await this.engine.run({ source: ctx.source, condition: p.condition, query: p.query, rules: p.rules || ctx.rules }, {
          token: token,
          onProgress: (e) => onProgress({ phase: e.phase, ratio: 0.97 * (i + e.ratio) / n, label: prefix + e.label, done: e.done, total: e.total })
        });
        if (res.cancelled) return res;
        results.push(res);
      }
      onProgress({ phase: 'merge', ratio: 0.98, label: n > 1 ? '結果をまとめています' : '仕上げ中' });
      await Async.yieldToUI();
      if (token.cancelled) return { cancelled: true };

      const N = ctx.source.rowCount;
      const merged = merge(results, N, ctx.combine);
      const parts = list.map((p, i) => {
        const st = results[i].stats;
        return {
          id: p.id,
          name: p.name,
          priority: p.priority,
          condition: st.needsCondition ? p.condition : null,
          joinKind: st.joinKind,
          matchMode: st.matchMode,
          needsCondition: st.needsCondition,
          ownRules: !!p.ownRules,
          query: p.query,
          rules: p.rules || ctx.rules,
          hits: merged.hits[i],
          assigned: merged.assigned[i],
          rows: merged.counts[i],
          stats: st,
          snapshot: results[i].snapshot
        };
      });
      const built = merged.rows;
      return {
        id: LQ.Util.uid('res'),
        parts: parts,
        prof: built.prof,
        src: built.src,
        cond: built.cond,
        count: built.count,
        length: built.length,
        members: merged.members,
        stats: {
          sourceRows: N,
          mode: ctx.combine.mode,
          includeUnmatched: !!ctx.combine.includeUnmatched,
          matchedSources: merged.matched,
          unmatchedRows: merged.unmatched,
          outputRows: built.length,
          elapsedMs: performance.now() - started,
          truncated: merged.truncated || results.some((r) => r.stats.truncated)
        },
        snapshot: {
          sourceName: ctx.source.name,
          rules: new LQ.Normalizer(ctx.rules).describe(),
          ownRules: parts.filter((p) => p.ownRules).length,
          finishedAt: new Date()
        }
      };
    }
  }

  /**
   * ① の全行をそのまま並べた結果（抽出なし）。② を使わずに ① だけを集計するときに、抽出結果と同じ形で扱う。
   *   抽出条件は 1 つ（① 元データ）で、② の行はひも付かない
   * @param {LQ.Dataset} source
   * @param {object} rules 全体の照合ルール
   */
  BatchRunner.allRows = function (source, rules) {
    const n = source.rowCount;
    const src = new Int32Array(n);
    for (let i = 0; i < n; i++) src[i] = i;
    const cond = new Int32Array(n).fill(-1);
    return {
      id: LQ.Util.uid('all'),
      allRows: true,
      parts: [{ id: ALL_ROWS_ID, name: '① 元データ', priority: 1, condition: null, joinKind: 'left', matchMode: 'first', needsCondition: false,
        ownRules: false, query: null, rules: rules, hits: n, assigned: n, rows: n, stats: null, snapshot: null }],
      prof: new Int32Array(n),
      src: src,
      cond: cond,
      count: new Int32Array(n),
      length: n,
      members: null,
      stats: { sourceRows: n, mode: 'assign', includeUnmatched: false, matchedSources: n, unmatchedRows: 0, outputRows: n, elapsedMs: 0, truncated: false },
      snapshot: { sourceName: source.name, rules: new LQ.Normalizer(rules).describe(), ownRules: 0, finishedAt: new Date() }
    };
  };

  LQ.BatchRunner = BatchRunner;
})(window);

/* =========================================================================
 * ── 結果の見せ方 ──
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
