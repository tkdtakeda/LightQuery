/* =========================================================================
 * LightQuery - lq-result.js
 * 結果の処理：複数の抽出条件の一括実行と振り分け・結果の見せ方・集計
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
          onProgress: (e) => onProgress({ phase: e.phase, ratio: 0.97 * (i + e.ratio) / n, label: prefix + e.label })
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

/* =========================================================================
 * ── 集計 ──
 * 集計（グループバイ）：抽出結果（表示中の絞り込みを反映）をグループに分け、件数・合計・平均・
 *   標準偏差（標本 = Excel の STDEV.S）・最小・最大と、グループの順位（RANK.EQ と同じ同順位）を求める。
 *   設定は列のキー（s: / c: / m:）で持ち、ブラウザに記憶する（AggregateSettings）。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const ValueParser = LQ.ValueParser;
  const Normalizer = LQ.Normalizer;
  const collator = new Intl.Collator('ja', { numeric: true });

  const FUNCS = [
    { id: 'sum', label: '合計' },
    { id: 'avg', label: '平均' },
    { id: 'stdev', label: '標準偏差', note: '標本標準偏差（Excel の STDEV.S）。値が 2 つ未満のグループは空欄' },
    { id: 'min', label: '最小', note: '数値がなく日付だけの列は、最も古い日付' },
    { id: 'max', label: '最大', note: '数値がなく日付だけの列は、最も新しい日付' }
  ];
  const FUNC_IDS = FUNCS.map((f) => f.id);
  const MAX_GROUPS = 5;
  const MAX_MEASURES = 12;
  const BLANK_LABEL = '（空欄）';
  const COUNT_ID = 'count';

  /* ---------------------------------------------------------------------
   * AggregateSettings：集計の設定（不正な値は捨てて初期値で補う）
   *   {groupBy:[key], count:boolean, measures:[{key, fn}], rank:{target, dir}|null}
   *   rank.target は 'count' または measureId（fn + '|' + key）
   * ------------------------------------------------------------------- */
  const AggregateSettings = {
    FUNCS: FUNCS,
    MAX_GROUPS: MAX_GROUPS,
    MAX_MEASURES: MAX_MEASURES,
    COUNT_ID: COUNT_ID,

    MODES: [
      { id: 'condRows', label: '② の行ごと', icon: 'list-check', desc: '② 条件データの 1 行を 1 グループにします（一致が 0 件の行も出します）。列を選ぶ必要はありません。' },
      { id: 'columns', label: '列を選んで集計', icon: 'table-columns', desc: 'グループにする列を自由に選びます（地域 × カテゴリなど）。' }
    ],

    create() {
      return { mode: 'columns', groupBy: [], count: true, measures: [], rank: null };
    },

    clean(raw) {
      const out = AggregateSettings.create();
      if (!raw || typeof raw !== 'object') return out;
      const isKey = (k) => typeof k === 'string' && /^[scm]:/.test(k);
      if (Array.isArray(raw.groupBy)) out.groupBy = raw.groupBy.filter(isKey).filter((k, i, a) => a.indexOf(k) === i).slice(0, MAX_GROUPS);
      if (raw.mode === 'condRows') out.mode = 'condRows';
      if (typeof raw.count === 'boolean') out.count = raw.count;
      if (Array.isArray(raw.measures)) {
        out.measures = raw.measures.filter((m) => m && isKey(m.key) && FUNC_IDS.indexOf(m.fn) !== -1)
          .map((m) => ({ key: m.key, fn: m.fn }))
          .filter((m, i, a) => a.findIndex((x) => AggregateSettings.measureId(x) === AggregateSettings.measureId(m)) === i)
          .slice(0, MAX_MEASURES);
      }
      if (raw.rank && typeof raw.rank === 'object' && typeof raw.rank.target === 'string') {
        out.rank = { target: raw.rank.target, dir: raw.rank.dir === 'asc' ? 'asc' : 'desc' };
      }
      if (out.rank && !AggregateSettings.targets(out).some((t) => t.id === out.rank.target)) out.rank = null;
      return out;
    },

    measureId(m) {
      return m.fn + '|' + m.key;
    },

    funcLabel(fn) {
      const f = FUNCS.find((x) => x.id === fn);
      return f ? f.label : fn;
    },

    /** 集計列の見出し：「合計（金額）」 */
    measureLabel(m) {
      return AggregateSettings.funcLabel(m.fn) + '（' + LQ.ResultView.nameOf(m.key) + '）';
    },

    /** 順位の基準にできるもの（件数と集計する値） */
    targets(settings) {
      const list = settings.count ? [{ id: COUNT_ID, label: '件数' }] : [];
      return list.concat(settings.measures.map((m) => ({ id: AggregateSettings.measureId(m), label: AggregateSettings.measureLabel(m) })));
    },

    /** 何か集計する設定か（件数・集計する値のどちらかがある） */
    isActive(settings) {
      return !!settings && (settings.count || settings.measures.length > 0);
    },

    /** 利用者が集計を設定したか（初期値の「全体の件数だけ」は、抽出結果の行数と同じなので集計として扱わない） */
    isConfigured(settings) {
      return this.isActive(settings) && (settings.mode === 'condRows' || settings.groupBy.length > 0 || settings.measures.length > 0);
    }
  };

  /* ---------------------------------------------------------------------
   * 計算
   * ------------------------------------------------------------------- */
  function newAcc() {
    return { n: 0, mean: 0, m2: 0, sum: 0, min: Infinity, max: -Infinity, dmin: Infinity, dmax: -Infinity, dn: 0 };
  }

  /** 値を 1 つ加える（平均・分散は Welford 法で桁落ちを抑える）。@returns {string} 'num' / 'date' / 'blank' / 'invalid' */
  function addValue(acc, raw) {
    if (Normalizer.isBlank(raw)) return 'blank';
    const n = ValueParser.parseNumber(raw);
    if (!Number.isNaN(n)) {
      acc.n++;
      acc.sum += n;
      const delta = n - acc.mean;
      acc.mean += delta / acc.n;
      acc.m2 += delta * (n - acc.mean);
      if (n < acc.min) acc.min = n;
      if (n > acc.max) acc.max = n;
      return 'num';
    }
    const d = ValueParser.parseDate(raw);
    if (!Number.isNaN(d)) {
      acc.dn++;
      if (d < acc.dmin) acc.dmin = d;
      if (d > acc.dmax) acc.dmax = d;
      return 'date';
    }
    return 'invalid';
  }

  /** 結果の数値（計算できなければ null）と、表示・出力用の文字 */
  function finish(acc, fn) {
    let v = null;
    let date = false;
    if (fn === 'sum') v = acc.n ? acc.sum : (acc.dn ? null : 0);
    else if (fn === 'avg') v = acc.n ? acc.mean : null;
    else if (fn === 'stdev') v = acc.n >= 2 ? Math.sqrt(acc.m2 / (acc.n - 1)) : null;
    else if (fn === 'min' || fn === 'max') {
      if (acc.n) v = fn === 'min' ? acc.min : acc.max;
      else if (acc.dn) {
        v = fn === 'min' ? acc.dmin : acc.dmax;
        date = true;
      }
    }
    return { value: v, text: v === null ? '' : (date ? ValueParser.formatDate(v) : formatNumber(v, fn)) };
  }

  /** 合計・最小・最大は 15 桁、平均・標準偏差は小数 4 桁までに丸めて表示する */
  function formatNumber(v, fn) {
    const rounded = fn === 'avg' || fn === 'stdev' ? Math.round(v * 10000) / 10000 : Number(v.toPrecision(15));
    return String(Object.is(rounded, -0) ? 0 : rounded);
  }

  /** 順位（RANK.EQ と同じ：同じ値は同順位、次の順位は飛ぶ）。値がないグループは null */
  function ranks(values, dir) {
    const idx = values.map((v, i) => i).filter((i) => values[i] !== null);
    idx.sort((a, b) => (dir === 'asc' ? values[a] - values[b] : values[b] - values[a]));
    const out = new Array(values.length).fill(null);
    idx.forEach((i, pos) => {
      out[i] = pos > 0 && values[idx[pos - 1]] === values[i] ? out[idx[pos - 1]] : pos + 1;
    });
    return out;
  }

  const Aggregator = {
    /**
     * @param {LQ.ResultView} view 抽出結果の見せ方（絞り込みを反映）
     * @param {object} settings AggregateSettings
     * @returns {{header:string[], rows:Array<Array<string>>, numeric:Set<number>, groupCount:number, rowCount:number,
     *           missing:string[], notes:string[]}}
     */
    compute(view, settings) {
      const norm = new Normalizer(view.rules);
      const missing = [];
      const usable = (key) => {
        const def = view.resolve(key);
        if (def && def.available) return def;
        missing.push(LQ.ResultView.nameOf(key));
        return null;
      };
      const groupDefs = settings.groupBy.map(usable).filter(Boolean);
      const measures = settings.measures.map((m) => ({ m: m, def: usable(m.key) })).filter((x) => x.def);
      const groups = new Map();
      const skipped = measures.map(() => ({ blank: 0, invalid: 0 }));
      const n = view.length;
      for (let i = 0; i < n; i++) {
        const k = view.rowAt(i);
        const raws = groupDefs.map((d) => view.rawValue(d, k));
        const key = raws.map((v) => norm.text(v)).join('\u0001');
        let g = groups.get(key);
        if (!g) {
          g = { labels: raws.map((v) => (Normalizer.isBlank(v) ? BLANK_LABEL : String(v))), count: 0, accs: measures.map(newAcc) };
          groups.set(key, g);
        }
        g.count++;
        for (let j = 0; j < measures.length; j++) {
          const kind = addValue(g.accs[j], view.rawValue(measures[j].def, k));
          if (kind === 'blank') skipped[j].blank++;
          else if (kind === 'invalid' || (kind === 'date' && measures[j].m.fn !== 'min' && measures[j].m.fn !== 'max')) skipped[j].invalid++;
        }
      }
      const list = Array.from(groups.values()).map((g) => ({
        labels: g.labels,
        count: g.count,
        results: g.accs.map((acc, j) => finish(acc, measures[j].m.fn))
      }));
      const header = groupDefs.map((d) => d.name);
      if (settings.count) header.push('件数');
      measures.forEach((x) => header.push(AggregateSettings.measureLabel(x.m)));
      let rankOf = null;
      if (settings.rank) {
        const t = settings.rank.target;
        const j = measures.findIndex((x) => AggregateSettings.measureId(x.m) === t);
        const values = t === COUNT_ID && settings.count ? list.map((g) => g.count) : (j >= 0 ? list.map((g) => g.results[j].value) : null);
        if (values) {
          rankOf = ranks(values, settings.rank.dir);
          header.push('順位');
        }
      }
      const order = list.map((g, i) => i);
      order.sort((a, b) => {
        if (rankOf) {
          const ra = rankOf[a] === null ? Infinity : rankOf[a];
          const rb = rankOf[b] === null ? Infinity : rankOf[b];
          if (ra !== rb) return ra - rb;
        }
        for (let c = 0; c < groupDefs.length; c++) {
          const la = list[a].labels[c];
          const lb = list[b].labels[c];
          if (la === lb) continue;
          if (la === BLANK_LABEL || lb === BLANK_LABEL) return la === BLANK_LABEL ? 1 : -1;
          const diff = collator.compare(la, lb);
          if (diff) return diff;
        }
        return a - b;
      });
      const rows = order.map((i) => {
        const g = list[i];
        const row = g.labels.slice();
        if (settings.count) row.push(String(g.count));
        g.results.forEach((r) => row.push(r.text));
        if (rankOf) row.push(rankOf[i] === null ? '' : String(rankOf[i]));
        return row;
      });
      const numeric = new Set();
      for (let c = groupDefs.length; c < header.length; c++) numeric.add(c);
      const notes = [];
      measures.forEach((x, j) => {
        const sk = skipped[j];
        if (!sk.blank && !sk.invalid) return;
        const parts = [];
        if (sk.invalid) parts.push('数値として読めない値 ' + LQ.Util.formatInt(sk.invalid) + ' 件');
        if (sk.blank) parts.push('空欄 ' + LQ.Util.formatInt(sk.blank) + ' 件');
        notes.push(AggregateSettings.measureLabel(x.m) + '：' + parts.join('・') + 'を除いて計算しました');
      });
      return { header: header, rows: rows, numeric: numeric, groupCount: list.length, rowCount: n, missing: missing, notes: notes };
    },

    /**
     * ② の行ごとに集計する（② の 1 行＝1 グループ。一致が 0 件の行も出す）。
     * 抽出の「複数一致」の設定に関係なく、① の行が一致したすべての ② の行に数えるため、
     * 抽出条件ごとに「すべての組み合わせ」で照合し直し、その抽出条件の結果に入った ① の行だけを数える。
     * @param {LQ.ResultView} view
     * @param {object} settings
     * @param {LQ.QueryEngine} engine
     * @param {LQ.CancelToken} token
     * @returns {Promise<object|null>} compute と同じ形（中止したら null）
     */
    async computeByCondition(view, settings, engine, token) {
      const source = view.source;
      const nameOf = LQ.ResultView.nameOf;
      const multi = view.parts.length > 1;
      const scope = view.filter === null ? view.parts.map((p, i) => i) : (view.filter < 0 ? [] : [view.filter]);
      const missing = [];
      const notes = [];
      const measures = [];
      settings.measures.forEach((m) => {
        if (m.key.slice(0, 2) !== 's:') {
          missing.push(nameOf(m.key) + '（② の行ごとの集計では ① の列だけを集計します）');
          return;
        }
        const idx = source.findColumn(nameOf(m.key));
        if (idx < 0) missing.push(nameOf(m.key));
        else measures.push({ m: m, idx: idx });
      });
      const linked = scope.filter((i) => {
        const part = view.parts[i];
        const ok = !!part.condition && part.needsCondition && part.joinKind !== 'anti' && !!part.query;
        if (!ok) notes.push('「' + view.partName(i) + '」は ② の行がひも付かないため集計していません（固定値だけの条件、または「一致しなかった行」）');
        return ok;
      });
      const condNames = [];
      linked.forEach((i) => view.parts[i].condition.columns.forEach((c) => {
        if (condNames.indexOf(c.name) === -1) condNames.push(c.name);
      }));
      const header = (multi ? ['抽出条件'] : []).concat(condNames);
      const first = header.length;
      if (settings.count) header.push('件数');
      measures.forEach((x) => header.push(AggregateSettings.measureLabel(x.m)));
      const rankTarget = settings.rank ? settings.rank.target : null;
      const rankIdx = rankTarget === COUNT_ID ? -1 : measures.findIndex((x) => AggregateSettings.measureId(x.m) === rankTarget);
      const useRank = !!settings.rank && (rankTarget === COUNT_ID ? settings.count : rankIdx >= 0);
      if (useRank) header.push('順位');
      const skipped = measures.map(() => ({ blank: 0, invalid: 0 }));
      const rows = [];
      let pairs = 0;
      const N = source.rowCount;
      for (let n = 0; n < linked.length; n++) {
        const i = linked[n];
        const part = view.parts[i];
        const cond = part.condition;
        const query = Object.assign({}, part.query, { joinKind: 'inner', matchMode: 'all' });
        const res = await engine.run({ source: source, condition: cond, query: query, rules: part.rules }, { token: token });
        if (res.cancelled) return null;
        if (res.stats.truncated) notes.push('「' + view.partName(i) + '」：組み合わせが多すぎるため、途中までで集計しました');
        const mark = new Uint8Array(N);
        const prof = view.result.prof;
        const rsrc = view.result.src;
        for (let k = 0; k < view.result.length; k++) if (prof[k] === i) mark[rsrc[k]] = 1;
        const M = cond.rowCount;
        const counts = new Int32Array(M);
        const accs = [];
        for (let r = 0; r < M; r++) accs.push(measures.map(newAcc));
        for (let j = 0; j < res.length; j++) {
          const x = res.src[j];
          const r = res.cond[j];
          if (!mark[x] || r < 0) continue;
          counts[r]++;
          pairs++;
          for (let t = 0; t < measures.length; t++) {
            const kind = addValue(accs[r][t], source.cell(x, measures[t].idx));
            if (kind === 'blank') skipped[t].blank++;
            else if (kind === 'invalid' || (kind === 'date' && measures[t].m.fn !== 'min' && measures[t].m.fn !== 'max')) skipped[t].invalid++;
          }
        }
        const results = accs.map((list) => list.map((acc, t) => finish(acc, measures[t].m.fn)));
        const values = useRank ? Array.from(counts).map((c, r) => (rankIdx < 0 ? c : results[r][rankIdx].value)) : null;
        const rankOf = useRank ? ranks(values, settings.rank.dir) : null;
        const colIdx = condNames.map((name) => cond.findColumn(name));
        const order = [];
        for (let r = 0; r < M; r++) order.push(r);
        if (rankOf) order.sort((a, b) => ((rankOf[a] === null ? Infinity : rankOf[a]) - (rankOf[b] === null ? Infinity : rankOf[b])) || a - b);
        order.forEach((r) => {
          const row = multi ? [view.partName(i)] : [];
          colIdx.forEach((c) => row.push(c >= 0 ? String(cond.cell(r, c)) : ''));
          if (settings.count) row.push(String(counts[r]));
          results[r].forEach((x) => row.push(x.text));
          if (rankOf) row.push(rankOf[r] === null ? '' : String(rankOf[r]));
          rows.push(row);
        });
      }
      const numeric = new Set();
      for (let c = first; c < header.length; c++) numeric.add(c);
      measures.forEach((x, t) => {
        const sk = skipped[t];
        if (!sk.blank && !sk.invalid) return;
        const parts = [];
        if (sk.invalid) parts.push('数値として読めない値 ' + LQ.Util.formatInt(sk.invalid) + ' 件');
        if (sk.blank) parts.push('空欄 ' + LQ.Util.formatInt(sk.blank) + ' 件');
        notes.push(AggregateSettings.measureLabel(x.m) + '：' + parts.join('・') + 'を除いて計算しました');
      });
      if (multi && useRank) notes.push('順位は抽出条件ごとに付けています');
      return { header: header, rows: rows, numeric: numeric, groupCount: rows.length, rowCount: pairs, missing: missing, notes: notes, byCondition: true };
    },

    /** 出力用の表（Exporters の table と同じ形） */
    toTable(computed) {
      return {
        header: computed.header,
        defs: computed.header.map((name) => ({ name: name })),
        rowCount: computed.rows.length,
        forEachRow(fn) {
          computed.rows.forEach((row, i) => fn(row, i));
        }
      };
    },

    /** 設定の文章表現（根拠・出力の記録用） */
    describe(settings) {
      const name = LQ.ResultView.nameOf;
      let by = settings.groupBy.length ? settings.groupBy.map(name).join(' × ') + ' ごと' : '全体（グループなし）';
      if (settings.mode === 'condRows') by = '② の行ごと';
      const values = (settings.count ? ['件数'] : []).concat(settings.measures.map(AggregateSettings.measureLabel));
      const rank = settings.rank ? '・順位：' + (AggregateSettings.targets(settings).find((t) => t.id === settings.rank.target) || { label: '' }).label +
        '（' + (settings.rank.dir === 'asc' ? '小さい順' : '大きい順') + '）' : '';
      return by + '：' + values.join('・') + rank;
    }
  };

  LQ.AggregateSettings = AggregateSettings;
  LQ.Aggregator = Aggregator;
})(window);
