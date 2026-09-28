/* =========================================================================
 * LightQuery - lq-batch.js
 * 複数の抽出条件をまとめて実行し、優先順位に従って 1 つの結果にまとめる。
 *   ・各抽出条件は QueryEngine でそれぞれ実行する（① の値の下ごしらえは共有キャッシュで再利用）
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
     *          profiles:Array<{id:string, name:string, priority:number, query:object, condition:LQ.Dataset|null}>}} ctx
     *        profiles は優先順位の順（検証済みのもの）
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
        const res = await this.engine.run({ source: ctx.source, condition: p.condition, query: p.query, rules: ctx.rules }, {
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
          finishedAt: new Date()
        }
      };
    }
  }

  LQ.BatchRunner = BatchRunner;
})(window);
