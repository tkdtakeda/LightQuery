/* =========================================================================
 * LightQuery - lq-engine.js
 * 抽出エンジン：② の 1 行＝1 セットの条件として ① の各行を照合する（Power Query の結合に近い動き）
 *   ・② の空欄セルを参照する条件は「判定しない」（AND / OR から除外）
 *   ・出力する行：一致した行（内部結合）/ 一致しなかった行（左反結合）/ すべての行（左外部結合）
 *   ・複数一致：最初の 1 行のみ / すべての組み合わせ
 *   ・「完全一致」が必須の条件は索引で候補を絞り込み、処理は小分けにして進捗を通知する
 *   ・完全一致・一致しないでは、② の値・固定値の「*」をワイルドカードとして当てはめる（照合ルールで切替）
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Normalizer = LQ.Normalizer;
  const Operators = LQ.Operators;
  const Logic = LQ.Logic;
  const Async = LQ.Async;

  const JOIN_KINDS = [
    { id: 'inner', label: '一致した行', note: '内部結合', desc: '② のいずれかの行の条件を満たす ① の行を出力します。' },
    { id: 'anti', label: '一致しなかった行', note: '左反結合', desc: '② のどの行の条件も満たさない ① の行を出力します（除外リストとして使うとき）。' },
    { id: 'left', label: 'すべての行', note: '左外部結合', desc: '① の全行を出力し、一致した ② の行があればその列を付けます。' }
  ];
  const MATCH_MODES = [
    { id: 'first', label: '最初の 1 行のみ', desc: '① の 1 行につき、最初に一致した ② の行だけを使います（結果は ① の行数以下）。' },
    { id: 'all', label: 'すべての組み合わせ', desc: '一致した ② の行ごとに 1 行ずつ出力します（① の行が重複します）。' }
  ];
  const MAX_OUTPUT_ROWS = 1000000;
  const CANCELLED = { cancelled: true };
  const EMPTY_LIST = [];

  /* ---------------------------------------------------------------------
   * 索引：必須条件（AND の直下）を使い、① の各行で照合すべき ② の行を絞り込む。
   *   list(x) … ① の行 x の候補（昇順）/ always … 常に照合する行（空欄・短い語、昇順）
   * ------------------------------------------------------------------- */
  function affixIndex(p, M, keyOf, weight) {
    const map = new Map();
    const always = [];
    for (let r = 0; r < M; r++) {
      const s = p.right[r];
      if (p.blank[r] || s.length < 2) {
        always.push(r);
        continue;
      }
      const key = keyOf(s);
      const list = map.get(key);
      if (list) list.push(r);
      else map.set(key, [r]);
    }
    return {
      p: p,
      always: always,
      score: weight * map.size / (1 + always.length),
      list: (x) => {
        const s = p.left[x];
        return s.length < 2 ? EMPTY_LIST : (map.get(keyOf(s)) || EMPTY_LIST);
      }
    };
  }

  const INDEXERS = {
    eq(p, M) {
      const map = new Map();
      const always = [];
      const pattern = p.pattern;
      for (let r = 0; r < M; r++) {
        if (p.blank[r] || (pattern && pattern[r])) {
          always.push(r);
          continue;
        }
        const key = p.right[r];
        const list = map.get(key);
        if (list) list.push(r);
        else map.set(key, [r]);
      }
      return {
        p: p,
        always: always,
        score: map.size / (1 + always.length),
        list: (x) => {
          const key = p.left[x];
          return key === '' ? EMPTY_LIST : (map.get(key) || EMPTY_LIST);
        }
      };
    },

    startsWith(p, M) {
      return affixIndex(p, M, (s) => s.slice(0, 2), 0.5);
    },

    endsWith(p, M) {
      return affixIndex(p, M, (s) => s.slice(-2), 0.5);
    },

    /* 含む：各キーワードの「最も珍しい 2 文字」で登録し、① の文字列の 2 文字ずつで候補を引く */
    contains(p, M) {
      const always = [];
      const grams = new Array(M);
      const freq = new Map();
      for (let r = 0; r < M; r++) {
        const s = p.right[r];
        if (p.blank[r] || s.length < 2) {
          always.push(r);
          continue;
        }
        const set = new Set();
        for (let i = 0; i + 2 <= s.length; i++) set.add(s.substr(i, 2));
        grams[r] = set;
        set.forEach((g) => freq.set(g, (freq.get(g) || 0) + 1));
      }
      const map = new Map();
      for (let r = 0; r < M; r++) {
        const set = grams[r];
        if (!set) continue;
        let best = null;
        let bestFreq = Infinity;
        set.forEach((g) => {
          const f = freq.get(g);
          if (f < bestFreq) {
            bestFreq = f;
            best = g;
          }
        });
        const list = map.get(best);
        if (list) list.push(r);
        else map.set(best, [r]);
      }
      const stamp = new Int32Array(M).fill(-1);
      const buf = [];
      return {
        p: p,
        always: always,
        score: 0.3 * map.size / (1 + always.length),
        list: (x) => {
          const s = p.left[x];
          buf.length = 0;
          for (let i = 0; i + 2 <= s.length; i++) {
            const rows = map.get(s.substr(i, 2));
            if (!rows) continue;
            for (let k = 0; k < rows.length; k++) {
              const r = rows[k];
              if (stamp[r] !== x) {
                stamp[r] = x;
                buf.push(r);
              }
            }
          }
          if (buf.length > 1) buf.sort((a, b) => a - b);
          return buf;
        }
      };
    }
  };

  /* 伸長する Int32 配列 3 本（① 行・② 行・一致数） */
  class ResultBuilder {
    constructor(capacity) {
      this.cap = Math.max(1024, capacity || 0);
      this.src = new Int32Array(this.cap);
      this.cond = new Int32Array(this.cap);
      this.count = new Int32Array(this.cap);
      this.length = 0;
    }

    push(s, c, n) {
      if (this.length === this.cap) this._grow();
      const i = this.length++;
      this.src[i] = s;
      this.cond[i] = c;
      this.count[i] = n;
    }

    fillCount(from, n) {
      this.count.fill(n, from, this.length);
    }

    _grow() {
      this.cap *= 2;
      ['src', 'cond', 'count'].forEach((key) => {
        const next = new Int32Array(this.cap);
        next.set(this[key]);
        this[key] = next;
      });
    }

    finish() {
      return {
        src: this.src.slice(0, this.length),
        cond: this.cond.slice(0, this.length),
        count: this.count.slice(0, this.length),
        length: this.length
      };
    }
  }

  class QueryEngine {
    constructor() {
      this._cache = new WeakMap();
    }

    static get JOIN_KINDS() {
      return JOIN_KINDS;
    }

    static get MATCH_MODES() {
      return MATCH_MODES;
    }

    /** 条件 1 件の文章表現（根拠表示・出力ファイルの記録用） */
    static describeCondition(c) {
      const op = Operators.get(c.op);
      const left = c.left ? '① ' + c.left : '（① 未選択）';
      const right = c.right.type === 'column'
        ? (c.right.col ? '② ' + c.right.col : '（② 未選択）')
        : '固定値「' + (c.right.value || '') + '」';
      return c.label + '：' + left + ' が ' + right + ' ' + (op ? op.phrase : '（比較方法未選択）');
    }

    /** 条件 1 件の不備を調べる */
    checkCondition(c, source, condition) {
      const out = [];
      if (!c.left) out.push({ field: 'left', code: 'left', message: '① の列を選んでください' });
      else if (source && source.findColumn(c.left) < 0) out.push({ field: 'left', code: 'leftMissing', message: '① に列「' + c.left + '」がありません' });
      if (!Operators.get(c.op)) out.push({ field: 'op', code: 'op', message: '比較方法を選んでください' });
      if (c.right.type === 'column') {
        if (!condition) out.push({ field: 'right', code: 'noConditionData', message: '② 条件データが読み込まれていません（固定値にすることもできます）' });
        else if (!c.right.col) out.push({ field: 'right', code: 'right', message: '② の列を選ぶか、固定値を入力してください' });
        else if (condition.findColumn(c.right.col) < 0) out.push({ field: 'right', code: 'rightMissing', message: '② に列「' + c.right.col + '」がありません' });
      } else if (Normalizer.isBlank(c.right.value)) {
        out.push({ field: 'right', code: 'value', message: '固定値を入力してください' });
      }
      return out;
    }

    /**
     * 実行前の検証。式で使われる条件の不備は error、使われない条件の不備は warn とする。
     */
    validate(query, source, condition) {
      const issues = [];
      const conds = query.conditions;
      const labels = conds.map((c) => c.label);
      const add = (level, message, extra) => issues.push(Object.assign({ level: level, message: message }, extra || {}));
      if (!source) add('error', '① 元データが読み込まれていません', { code: 'noSource' });
      if (!conds.length) add('error', '条件がありません。「条件を追加」から作成してください', { code: 'noCondition' });
      let ast = null;
      let exprError = null;
      let unused = [];
      if (conds.length) {
        if (query.logic.mode === 'expr') {
          const parsed = Logic.parse(query.logic.expr, labels);
          if (parsed.ok) {
            ast = parsed.ast;
            unused = parsed.unused;
          } else {
            exprError = parsed.error;
            add('error', '式：' + parsed.error.message, { code: 'expr' });
          }
        } else {
          ast = Logic.fromMode(query.logic.mode, labels);
        }
      }
      const used = new Set(ast ? Logic.labelsIn(ast) : labels);
      conds.forEach((c) => {
        const inUse = used.has(c.label);
        this.checkCondition(c, source, condition).forEach((p) => {
          add(inUse ? 'error' : 'warn', '条件 ' + c.label + '：' + p.message, { code: p.code, condId: c.id, field: p.field });
        });
      });
      unused.forEach((label) => {
        const c = conds.find((x) => x.label === label);
        add('warn', '条件 ' + label + ' は式に含まれていないため使われません', { code: 'unused', condId: c ? c.id : null });
      });
      const errors = issues.filter((i) => i.level === 'error');
      const needsCondition = !!ast && conds.some((c) => used.has(c.label) && c.right.type === 'column');
      return {
        ok: errors.length === 0,
        issues: issues,
        errors: errors,
        warnings: issues.filter((i) => i.level === 'warn'),
        ast: ast,
        exprError: exprError,
        needsCondition: needsCondition
      };
    }

    /**
     * 抽出を実行する。
     * @param {{source:LQ.Dataset, condition:LQ.Dataset|null, query:object, rules:object}} ctx
     * @param {{onProgress?:Function, token?:LQ.CancelToken}} hooks
     * @returns {Promise<object>} 結果（中止時は {cancelled:true}）
     */
    async run(ctx, hooks) {
      const h = hooks || {};
      const onProgress = h.onProgress || function () {};
      const token = h.token || new LQ.CancelToken();
      const check = this.validate(ctx.query, ctx.source, ctx.condition);
      if (!check.ok) throw new Error(check.errors[0].message);
      try {
        return await this._execute(ctx, check, onProgress, token);
      } catch (err) {
        if (err === CANCELLED) return CANCELLED;
        throw err;
      }
    }

    async _execute(ctx, check, onProgress, token) {
      const started = performance.now();
      const source = ctx.source;
      const condition = ctx.condition;
      const query = ctx.query;
      const norm = new Normalizer(ctx.rules);
      const ast = check.ast;
      const needsCond = check.needsCondition;
      const N = source.rowCount;
      const M = needsCond ? condition.rowCount : 0;
      const conds = Logic.labelsIn(ast).map((label) => query.conditions.find((c) => c.label === label));

      /* 1) 値の下ごしらえ（進捗 0〜20%） */
      const slicer = Async.createSlicer(24);
      let prepTotal = 0;
      conds.forEach((c) => {
        prepTotal += N;
        if (c.right.type === 'column') prepTotal += M * 2;
      });
      let prepDone = 0;
      const tick = async (inc) => {
        prepDone += inc;
        if (!slicer.due()) return;
        onProgress({ phase: 'prepare', ratio: 0.2 * Math.min(1, prepDone / Math.max(1, prepTotal)), label: '値を準備中' });
        await Async.yieldToUI();
        slicer.reset();
        if (token.cancelled) throw CANCELLED;
      };
      const prepared = [];
      for (let i = 0; i < conds.length; i++) {
        const c = conds[i];
        const op = Operators.get(c.op);
        const p = { cond: c, label: c.label, op: op, test: op.test, isColumn: c.right.type === 'column', incomparable: 0, blankCount: 0,
          pattern: null, valuePattern: null, patternCount: 0 };
        const lc = source.findColumn(c.left);
        const glob = op.wildcard && norm.rules.wildcard;
        p.left = await this._column(source, lc, op.prep, norm, tick);
        if (p.isColumn) {
          const rc = condition.findColumn(c.right.col);
          p.right = await this._column(condition, rc, op.prep, norm, tick);
          p.blank = await this._column(condition, rc, 'blank', norm, tick);
          for (let r = 0; r < p.blank.length; r++) p.blankCount += p.blank[r];
          if (glob) {
            const pattern = await this._column(condition, rc, 'glob', norm, tick);
            for (let r = 0; r < pattern.length; r++) if (pattern[r]) p.patternCount++;
            if (p.patternCount) p.pattern = pattern;
          }
        } else {
          p.value = norm.converter(op.prep)(c.right.value);
          if (glob) p.valuePattern = norm.glob(c.right.value);
          if (p.valuePattern) p.patternCount = 1;
        }
        if (p.patternCount) p.leftText = await this._column(source, lc, 'text', norm, tick);
        prepared.push(p);
      }
      const byLabel = new Map(prepared.map((p) => [p.label, p]));

      /* 2) 索引（必須の「完全一致」条件で ② の候補行を絞る） */
      const index = needsCond ? this._buildIndex(ast, prepared, M) : null;

      /* 3) 照合（進捗 20〜100%） */
      const evaluate = this._compile(ast, byLabel);
      const joinKind = query.joinKind;
      const matchMode = needsCond ? query.matchMode : 'first';
      const pairs = matchMode === 'all' && joinKind !== 'anti';
      const stopAtFirst = joinKind === 'anti';
      const out = new ResultBuilder(joinKind === 'left' ? N : Math.min(N, 65536));
      let matchedSources = 0;
      let truncated = false;
      slicer.reset();
      for (let x = 0; x < N; x++) {
        if ((x & 127) === 0 && slicer.due()) {
          onProgress({ phase: 'match', ratio: 0.2 + 0.8 * (x / N), label: '照合中', done: x, total: N });
          await Async.yieldToUI();
          slicer.reset();
          if (token.cancelled) throw CANCELLED;
        }
        let count = 0;
        let first = -1;
        const startLen = out.length;
        if (!needsCond) {
          if (evaluate(x, -1) === 1) count = 1;
        } else {
          const list = index ? index.list(x) : null;
          const blanks = index ? index.always : null;
          let i = 0;
          let j = 0;
          let r = 0;
          for (;;) {
            if (index) {
              if (i < list.length && (j >= blanks.length || list[i] < blanks[j])) r = list[i++];
              else if (j < blanks.length) r = blanks[j++];
              else break;
            } else if (r >= M) {
              break;
            }
            if (evaluate(x, r) === 1) {
              count++;
              if (first < 0) first = r;
              if (pairs) {
                if (out.length >= MAX_OUTPUT_ROWS) {
                  truncated = true;
                  break;
                }
                out.push(x, r, 0);
              }
              if (stopAtFirst) break;
            }
            if (!index) r++;
          }
        }
        if (count > 0) matchedSources++;
        if (pairs) {
          if (count > 0) out.fillCount(startLen, count);
          else if (joinKind === 'left') out.push(x, -1, 0);
        } else if (joinKind === 'inner') {
          if (count > 0) out.push(x, first, count);
        } else if (joinKind === 'left') {
          out.push(x, first, count);
        } else if (count === 0) {
          out.push(x, -1, 0);
        }
        if (truncated) break;
      }
      onProgress({ phase: 'match', ratio: 1, label: '照合中', done: N, total: N });

      const built = out.finish();
      return {
        id: LQ.Util.uid('res'),
        src: built.src,
        cond: built.cond,
        count: built.count,
        length: built.length,
        stats: {
          sourceRows: N,
          conditionRows: M,
          needsCondition: needsCond,
          matchedSources: matchedSources,
          outputRows: built.length,
          elapsedMs: performance.now() - started,
          truncated: truncated,
          joinKind: joinKind,
          matchMode: matchMode,
          indexLabel: index ? index.p.label : null,
          indexOp: index ? index.p.op.name : null,
          perCondition: prepared.map((p) => ({
            label: p.label,
            incomparable: p.incomparable,
            blankRows: p.isColumn ? p.blankCount : 0,
            wildcardRows: p.isColumn ? p.patternCount : 0,
            wildcardValue: !!p.valuePattern
          }))
        },
        snapshot: {
          expr: Logic.serialize(ast),
          exprJa: Logic.toJapanese(ast),
          conditions: conds.map((c) => QueryEngine.describeCondition(c)),
          rules: norm.describe(),
          sourceName: source.name,
          conditionName: needsCond ? condition.name : '',
          finishedAt: new Date()
        }
      };
    }

    /** 列の値を下ごしらえする（データセットの版とルールが同じなら再利用） */
    async _column(ds, colIdx, prep, norm, tick) {
      let entry = this._cache.get(ds);
      if (!entry || entry.version !== ds.version) {
        entry = { version: ds.version, map: new Map() };
        this._cache.set(ds, entry);
      }
      const key = colIdx + '|' + prep + '|' + (prep === 'blank' ? '' : norm.signature);
      const n = ds.rowCount;
      if (entry.map.has(key)) {
        await tick(n);
        return entry.map.get(key);
      }
      let out;
      if (prep === 'blank') {
        out = new Uint8Array(n);
        for (let r = 0; r < n; r++) {
          out[r] = Normalizer.isBlank(ds.cell(r, colIdx)) ? 1 : 0;
          if ((r & 4095) === 4095) await tick(4096);
        }
      } else {
        const convert = norm.converter(prep);
        out = new Array(n);
        for (let r = 0; r < n; r++) {
          out[r] = convert(ds.cell(r, colIdx));
          if ((r & 4095) === 4095) await tick(4096);
        }
      }
      await tick(n & 4095);
      entry.map.set(key, out);
      return out;
    }

    _buildIndex(ast, prepared, M) {
      const required = new Set(Logic.requiredLabels(ast));
      let best = null;
      prepared.forEach((p) => {
        const build = INDEXERS[p.op.id];
        if (!build || !required.has(p.label) || !p.isColumn) return;
        const index = build(p, M);
        if (!best || index.score > best.score) best = index;
      });
      return best;
    }

    /** 構文木 → 評価関数（1＝真 / 0＝偽 / -1＝判定しない） */
    _compile(node, byLabel) {
      if (node.type === 'cond') {
        const p = byLabel.get(node.label);
        const test = p.test;
        const L = p.left;
        const LT = p.leftText;
        const neg = p.op.negative;
        if (p.isColumn) {
          const R = p.right;
          const B = p.blank;
          const P = p.pattern;
          return (x, r) => {
            if (B[r] === 1) return -1;
            if (P && P[r]) return P[r].test(LT[x]) !== neg ? 1 : 0;
            const res = test(L[x], R[r]);
            if (res === null) {
              p.incomparable++;
              return 0;
            }
            return res ? 1 : 0;
          };
        }
        const value = p.value;
        const VP = p.valuePattern;
        if (VP) return (x) => (VP.test(LT[x]) !== neg ? 1 : 0);
        return (x) => {
          const res = test(L[x], value);
          if (res === null) {
            p.incomparable++;
            return 0;
          }
          return res ? 1 : 0;
        };
      }
      const kids = node.children.map((child) => this._compile(child, byLabel));
      const n = kids.length;
      if (node.type === 'and') {
        return (x, r) => {
          let seen = false;
          for (let i = 0; i < n; i++) {
            const v = kids[i](x, r);
            if (v === 0) return 0;
            if (v === 1) seen = true;
          }
          return seen ? 1 : -1;
        };
      }
      return (x, r) => {
        let seen = false;
        for (let i = 0; i < n; i++) {
          const v = kids[i](x, r);
          if (v === 1) return 1;
          if (v === 0) seen = true;
        }
        return seen ? 0 : -1;
      };
    }

    /**
     * 1 行分の判定根拠（行の詳細表示用）。r は ② の行（ひも付かない場合は -1）。
     * @returns {{items:Array, exprJa:string}|null}
     */
    explain(ctx, x, r) {
      const check = this.validate(ctx.query, ctx.source, ctx.condition);
      if (!check.ok || !ctx.source) return null;
      const norm = new Normalizer(ctx.rules);
      const items = Logic.labelsIn(check.ast).map((label) => {
        const c = ctx.query.conditions.find((k) => k.label === label);
        const op = Operators.get(c.op);
        const leftValue = ctx.source.cell(x, ctx.source.findColumn(c.left));
        const base = { label: label, leftName: '① ' + c.left, leftValue: leftValue, phrase: op.phrase };
        if (c.right.type === 'column') {
          base.rightName = '② ' + c.right.col;
          if (r < 0 || !ctx.condition) return Object.assign(base, { state: 'none', rightValue: '' });
          base.rightValue = ctx.condition.cell(r, ctx.condition.findColumn(c.right.col));
          if (Normalizer.isBlank(base.rightValue)) return Object.assign(base, { state: 'ignored' });
        } else {
          base.rightName = '固定値';
          base.rightValue = c.right.value;
        }
        const pattern = op.wildcard ? norm.glob(base.rightValue) : null;
        if (pattern) {
          base.state = pattern.test(norm.text(leftValue)) !== op.negative ? 'true' : 'false';
          base.phrase = (op.negative ? 'に当てはまらない' : 'に当てはまる') + '（* はワイルドカード：' + LQ.Wildcard.kindLabel(pattern.kind) + '）';
          return base;
        }
        const convert = norm.converter(op.prep);
        const res = op.test(convert(leftValue), convert(base.rightValue));
        base.state = res === null ? 'incomparable' : (res ? 'true' : 'false');
        return base;
      });
      return { items: items, exprJa: Logic.toJapanese(check.ast) };
    }
  }

  LQ.QueryEngine = QueryEngine;
})(window);
