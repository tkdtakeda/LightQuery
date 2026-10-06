/* =========================================================================
 * LightQuery - lq-dataset.js
 * データセット：読み込んだ grid に「ヘッダー行・データ開始行・開始列・終了行」を当てはめ、
 *   列（名前付き）と行（元の行番号付き）を取り出す。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Util = LQ.Util;

  const ROLE_LABEL = { source: '① 元データ', condition: '② 照合表' };
  const DETECT_ROWS = 30;

  function isBlankCell(value) {
    return value === undefined || value === null || value === '' || String(value).trim() === '';
  }

  function countNonEmpty(row, fromCol) {
    if (!row) return { count: 0, first: -1 };
    let count = 0;
    let first = -1;
    for (let c = fromCol || 0; c < row.length; c++) {
      if (!isBlankCell(row[c])) {
        count++;
        if (first < 0) first = c;
      }
    }
    return { count: count, first: first };
  }

  class Dataset {
    /**
     * @param {'source'|'condition'} role
     * @param {LQ.SourceFile} source
     * @param {{isSample?:boolean, settings?:object, members?:LQ.SourceFile[], filters?:Array, dedup?:object, unpivot?:object}} options
     *        members：縦に結合する 2 つ目以降のファイル（① のみ）。filters・dedup・unpivot：絞り込み・重複の削除・縦持ちを引き継ぐとき
     */
    constructor(role, source, options) {
      const opts = options || {};
      this.id = Util.uid('ds');
      this.role = role;
      this.source = source;
      this.members = (opts.members || []).slice();
      this.filters = (opts.filters || []).slice();
      this.dedup = opts.dedup ? Util.clone(opts.dedup) : null;
      this.unpivot = opts.unpivot ? Util.clone(opts.unpivot) : null;
      this.isSample = !!opts.isSample;
      this.version = 0;
      this.grid = [];
      this.table = [];
      this.union = null;
      this.columns = [];
      this.rowIdx = new Int32Array(0);
      this.auto = null;
      this.settings = null;
      this.stats = null;
      this._colIndex = new Map();
      this.reload(opts.settings || null);
    }

    get name() {
      return this.source.name;
    }

    /** 縦に結合しているファイルの数（1 つなら 1） */
    get fileCount() {
      return this.members.length + 1;
    }

    get roleLabel() {
      return ROLE_LABEL[this.role];
    }

    get rowCount() {
      return this.rowIdx.length;
    }

    get colCount() {
      return this.columns.length;
    }

    get rawRowCount() {
      return this.grid.length;
    }

    get rawColCount() {
      let max = 0;
      for (let r = 0; r < this.grid.length; r++) if (this.grid[r].length > max) max = this.grid[r].length;
      return max;
    }

    /** grid を取り直す（ファイル側の文字コード・シート変更後など）。settings 未指定なら自動判定 */
    reload(settings) {
      this.grid = this.source.grid || [];
      this.auto = Dataset.autoDetect(this.grid);
      this.settings = Dataset.normalizeSettings(settings || this.auto.settings);
      this.derive();
    }

    /**
     * 同じ表を別の抽出条件で使うための複製。読み込み範囲・シートの変更が互いに影響しないよう、ファイル側も複製する。
     * @param {{isSample?:boolean}} options
     */
    clone(options) {
      const o = options || {};
      return new Dataset(this.role, this.source.clone(), {
        isSample: o.isSample === undefined ? this.isSample : !!o.isSample,
        settings: Util.clone(this.settings),
        members: this.members.map((m) => m.clone()),
        unpivot: this.unpivot
      });
    }

    /**
     * 縦に結合するファイルを入れ替えた新しいデータセット（読み込み範囲・絞り込み・重複の削除は引き継ぐ）。
     * 元のデータセットは変えないため、取り消し（スナップショット）で元に戻せる。
     * @param {LQ.SourceFile[]} members
     */
    withMembers(members) {
      return new Dataset(this.role, this.source, {
        isSample: this.isSample, settings: Util.clone(this.settings), members: members, filters: this.filters, dedup: this.dedup, unpivot: this.unpivot
      });
    }

    /** 自動判定の設定に戻す */
    resetToAuto() {
      this.settings = Dataset.normalizeSettings(this.auto.settings);
      this.derive();
    }

    /**
     * 読み込み範囲の設定を変更する。矛盾する値は自動で補正し、補正した項目名を返す。
     * @returns {{adjusted:string[]}}
     */
    applySettings(patch) {
      const requested = Object.assign({}, this.settings, patch);
      const next = Dataset.normalizeSettings(requested);
      const adjusted = Object.keys(next).filter((key) => next[key] !== requested[key]);
      this.settings = next;
      this.derive();
      return { adjusted: adjusted };
    }

    /** 設定から列と行を作り直す（縦に結合するファイルがあれば列の名前でそろえて 1 つの表にし、縦持ちの設定があれば縦持ちにする） */
    derive() {
      const part = Dataset.extract(this.grid, this.settings);
      let columns = part.columns;
      let rows = part.rows;
      this.table = this.grid;
      this._rowNo = null;
      this.union = null;
      if (this.members.length) {
        const u = LQ.SourceUnion.build(this, part);
        this.table = u.table;
        columns = u.columns;
        rows = u.rows;
        this._rowNo = u.rowNo;
        this.union = u.info;
      }
      this.unpivotInfo = null;
      /* 縦持ちにする前の列（縦持ちにする列を選ぶ画面に使う） */
      this.preUnpivotColumns = columns.map((c) => ({ name: c.name, letter: c.letter, fileCol: !!c.fileCol }));
      if (this.unpivot) {
        const rn = this._rowNo;
        const up = LQ.Unpivot.build(columns, rows, this.table, (r) => (rn ? rn[r] : r + 1), this.unpivot);
        this.unpivotInfo = up.info;
        if (up.table) {
          this.table = up.table;
          columns = up.columns;
          rows = up.rows;
          this._rowNo = up.rowNo;
        }
      }
      this.columns = columns;
      this._colIndex = new Map(columns.map((col) => [col.name, col.index]));
      this.rowIdx = Int32Array.from(rows);
      this._baseRowIdx = this.rowIdx;
      this._appendDerived();
      this._applyFilters();
      this._applyDedup();
      this.stats = {
        rows: rows.length,
        cols: columns.length,
        skippedEmpty: this.union ? this.union.skippedEmpty : part.skippedEmpty,
        firstRow: part.rows.length ? part.rows[0] + 1 : null,
        lastRow: part.rows.length ? part.rows[part.rows.length - 1] + 1 : null,
        rangeText: part.columns.length && part.rows.length
          ? part.columns[0].letter + (part.rows[0] + 1) + ':' + part.columns[part.columns.length - 1].letter + (part.rows[part.rows.length - 1] + 1)
          : '—'
      };
      this.version++;
    }

    /**
     * grid に読み込み範囲を当てはめ、列（名前・元の列番号・列記号）とデータ行（grid の行番号）を取り出す。
     * 空の行は除き、その数を skippedEmpty に数える。
     * @returns {{columns:Array<{name:string, index:number, src:number, letter:string}>, rows:number[], skippedEmpty:number}}
     */
    static extract(g, s) {
      const c0 = s.startCol - 1;
      const headerIdx = s.hasHeader ? s.headerRow - 1 : -1;
      const first = s.startRow - 1;
      const last = s.endRow ? Math.min(s.endRow, g.length) - 1 : g.length - 1;
      const rows = [];
      let skippedEmpty = 0;
      let maxCol = -1;
      for (let r = first; r <= last; r++) {
        if (r === headerIdx) continue;
        const row = g[r];
        let lastNonEmpty = -1;
        if (row) {
          for (let c = row.length - 1; c >= c0; c--) {
            if (!isBlankCell(row[c])) {
              lastNonEmpty = c;
              break;
            }
          }
        }
        if (lastNonEmpty < c0) {
          skippedEmpty++;
          continue;
        }
        rows.push(r);
        if (lastNonEmpty > maxCol) maxCol = lastNonEmpty;
      }
      const headerRow = headerIdx >= 0 ? (g[headerIdx] || []) : null;
      if (headerRow) {
        for (let c = headerRow.length - 1; c >= c0; c--) {
          if (!isBlankCell(headerRow[c])) {
            if (c > maxCol) maxCol = c;
            break;
          }
        }
      }
      const columns = [];
      const used = new Map();
      for (let c = c0; c <= maxCol; c++) {
        const letter = Util.colLetter(c);
        let name = headerRow && !isBlankCell(headerRow[c]) ? String(headerRow[c]).replace(/\s+/g, ' ').trim() : '列' + letter;
        const seen = used.get(name) || 0;
        used.set(name, seen + 1);
        if (seen > 0) {
          let k = seen + 1;
          while (used.has(name + ' (' + k + ')')) k++;
          name = name + ' (' + k + ')';
          used.set(name, 1);
        }
        columns.push({ name: name, index: columns.length, src: c, letter: letter });
      }
      return { columns: columns, rows: rows, skippedEmpty: skippedEmpty };
    }

    /** データ行 r・列 c の値（文字列）。追加した列（読み替え・計算）は作った値を返す */
    cell(r, c) {
      const col = this.columns[c];
      if (col && col.values) return col.values[r];
      const row = this.table[this.rowIdx[r]];
      if (!row || !col) return '';
      const v = row[col.src];
      return v === undefined || v === null ? '' : v;
    }

    /** データ行 r の元の行番号（1 始まり。Excel の行番号と一致。縦に結合しているときは、そのファイルでの行番号） */
    rowNumber(r) {
      const i = this.rowIdx[r];
      return this._rowNo ? this._rowNo[i] : i + 1;
    }

    /** 絞り込み前の b 行目の元の行番号（除いた行の内訳に使う） */
    baseRowNumber(b) {
      const i = (this._baseRowIdx || this.rowIdx)[b];
      return this._rowNo ? this._rowNo[i] : i + 1;
    }

    /** データ行 r が絞り込み前の何行目か（絞り込み・重複の削除で除いた行を指すため） */
    basePos(r) {
      return this._basePos ? this._basePos[r] : r;
    }

    /** 追加した列（読み替え・計算）を作り直す（定義が変わったとき） */
    refreshDerived() {
      this.rowIdx = this._baseRowIdx || this.rowIdx;
      this.columns = this.columns.filter((c) => !c.derived);
      this._colIndex = new Map(this.columns.map((col) => [col.name, col.index]));
      this._appendDerived();
      this._applyFilters();
      this._applyDedup();
      this.version++;
    }

    /** 縦持ちを置き換える（null で外す）。列が変わるため、表を作り直す */
    setUnpivot(def) {
      this.unpivot = def ? Util.clone(def) : null;
      this.derive();
    }

    /** 重複の削除を置き換える（null で外す）。def：{cols:string[]}（空ならすべての列で比べる） */
    setDedup(def) {
      this.dedup = def ? Util.clone(def) : null;
      this.refreshDerived();
    }

    /** 絞り込みを置き換える（[] で外す）。読み込み範囲を変えても掛けたまま残す */
    setFilters(filters) {
      this.filters = (filters || []).slice();
      this.refreshDerived();
    }

    /** 絞り込み前の行数 */
    get baseRowCount() {
      return this._baseRowIdx ? this._baseRowIdx.length : this.rowIdx.length;
    }

    /** 絞り込み前の b 行目・列 c の値（値の一覧・残る行数の見込みに使う） */
    baseCell(b, c) {
      const col = this.columns[c];
      if (!col) return '';
      if (col.values) return (col.baseValues || col.values)[b];
      const base = this._baseRowIdx || this.rowIdx;
      const row = this.table[base[b]];
      const v = row ? row[col.src] : undefined;
      return v === undefined || v === null ? '' : v;
    }

    /** filters をすべて満たす行が、絞り込み前の行のうち何行あるか（掛ける前の見込み） */
    countWith(filters) {
      const cell = (r, c) => this.baseCell(r, c);
      const tests = filters.map((f) => LQ.RowFilter.compile(f, this, cell).test).filter(Boolean);
      const n = this.baseRowCount;
      let kept = 0;
      for (let r = 0; r < n; r++) {
        let ok = true;
        for (let i = 0; i < tests.length && ok; i++) ok = tests[i](r);
        if (ok) kept++;
      }
      return kept;
    }

    /**
     * 絞り込みを当てはめる（すべてを満たす行だけ残す）。追加した列の値も残した行にそろえる。
     * 結果は filterInfo（{base, kept, items:[{id, ok, message}]}）に残す。
     */
    _applyFilters() {
      const filters = this.filters || [];
      this.filterInfo = null;
      this._basePos = null;
      if (!filters.length) return;
      const n = this.rowIdx.length;
      const items = [];
      const tests = [];
      filters.forEach((f) => {
        const compiled = LQ.RowFilter.compile(f, this);
        items.push({ id: f.id, ok: !!compiled.test, message: compiled.message || '' });
        if (compiled.test) tests.push(compiled.test);
      });
      const keep = [];
      for (let r = 0; r < n; r++) {
        let ok = true;
        for (let i = 0; i < tests.length && ok; i++) ok = tests[i](r);
        if (ok) keep.push(r);
      }
      const base = this.rowIdx;
      this.rowIdx = Int32Array.from(keep, (r) => base[r]);
      this._basePos = Int32Array.from(keep);
      this.columns.forEach((c) => {
        if (!c.values) return;
        c.baseValues = c.values;
        c.values = keep.map((r) => c.baseValues[r]);
      });
      const removed = [];
      for (let r = 0, k = 0; r < n; r++) {
        if (k < keep.length && keep[k] === r) k++;
        else removed.push(r);
      }
      this.filterInfo = { base: n, kept: keep.length, items: items, removed: Int32Array.from(removed) };
    }

    /** 重複の削除を当てはめる（絞り込みのあと。処理は lq-prep.js の Dedup）。結果は dedupInfo に残す */
    _applyDedup() {
      this.dedupInfo = this.dedup ? LQ.Dedup.apply(this, this.dedup) : null;
    }

    /** 列を残した行にそろえる（keep：今の行のうち残す行の位置）。絞り込み前の値は baseValues に残す */
    keepRows(keep) {
      const base = this.rowIdx;
      const pos = this._basePos;
      this.rowIdx = Int32Array.from(keep, (r) => base[r]);
      this._basePos = Int32Array.from(keep, (r) => (pos ? pos[r] : r));
      this.columns.forEach((c) => {
        if (!c.values) return;
        if (!c.baseValues) c.baseValues = c.values;
        const cur = c.values;
        c.values = keep.map((r) => cur[r]);
      });
    }

    /** 定義の順に列を加える（前に加えた列も式・読み替えの元にできる）。結果は derivedInfo に残す */
    _appendDerived() {
      this.derivedInfo = new Map();
      const defs = LQ.Derive ? LQ.Derive.defsFor(this.role) : [];
      const rows = this.rowIdx.length;
      defs.forEach((def) => {
        const out = LQ.Derive.compute(def, rows, (name) => this.findColumn(name), (r, c) => this.cell(r, c));
        let name = def.name;
        if (out.values && this._colIndex.has(name)) {
          out.info = { ok: false, message: '列「' + name + '」は元の表にもあるため作れません（名前を変えてください）' };
          out.values = null;
        }
        this.derivedInfo.set(def.id, out.info);
        if (!out.values) return;
        const col = { name: name, index: this.columns.length, src: -1, letter: LQ.Derive.KINDS[def.kind].badge, derived: def.kind, values: out.values };
        this.columns.push(col);
        this._colIndex.set(name, col.index);
      });
    }

    findColumn(name) {
      const idx = this._colIndex.get(name);
      return idx === undefined ? -1 : idx;
    }

    columnNames() {
      return this.columns.map((c) => c.name);
    }

    /** 読み込み範囲の状態（元データ表示で行・列を色分けするため） */
    rowState(rawIndex) {
      const s = this.settings;
      const rowNo = rawIndex + 1;
      if (s.hasHeader && rowNo === s.headerRow) return 'header';
      if (rowNo < s.startRow) return 'before';
      if (s.endRow && rowNo > s.endRow) return 'after';
      return 'data';
    }

    /** 設定値の型と範囲をそろえる */
    static normalizeSettings(settings) {
      const s = Object.assign({ hasHeader: true, headerRow: 1, startRow: 2, startCol: 1, endRow: null }, settings || {});
      const toPos = (v, fallback) => {
        const n = parseInt(v, 10);
        return isFinite(n) && n >= 1 ? n : fallback;
      };
      const out = {
        hasHeader: !!s.hasHeader,
        headerRow: toPos(s.headerRow, 1),
        startRow: toPos(s.startRow, 1),
        startCol: toPos(s.startCol, 1),
        endRow: s.endRow === null || s.endRow === undefined || s.endRow === '' ? null : toPos(s.endRow, null)
      };
      if (out.hasHeader && out.startRow <= out.headerRow) out.startRow = out.headerRow + 1;
      if (out.endRow !== null && out.endRow < out.startRow) out.endRow = null;
      return out;
    }

    /**
     * ヘッダー行・データ開始行・開始列を推定する。
     * 先頭 30 行のうち「空でないセルが最も多い行の 6 割以上」を満たす最初の行をヘッダーとみなす。
     */
    static autoDetect(grid) {
      const limit = Math.min(grid.length, DETECT_ROWS);
      const counts = [];
      let maxCount = 0;
      for (let r = 0; r < limit; r++) {
        const info = countNonEmpty(grid[r], 0);
        counts.push(info);
        if (info.count > maxCount) maxCount = info.count;
      }
      if (maxCount === 0) {
        return {
          settings: { hasHeader: true, headerRow: 1, startRow: 2, startCol: 1, endRow: null },
          reasons: ['データが見つからないため初期値を使用']
        };
      }
      const threshold = maxCount <= 1 ? 1 : Math.max(2, Math.ceil(maxCount * 0.6));
      let headerIdx = counts.findIndex((info) => info.count >= threshold);
      if (headerIdx < 0) headerIdx = 0;
      let startCol = Infinity;
      for (let r = headerIdx; r < Math.min(grid.length, headerIdx + DETECT_ROWS); r++) {
        const info = countNonEmpty(grid[r], 0);
        if (info.first >= 0 && info.first < startCol) startCol = info.first;
      }
      if (!isFinite(startCol)) startCol = 0;

      const headerCells = (grid[headerIdx] || []).slice(startCol).filter((v) => !isBlankCell(v));
      const looksLikeData = headerCells.length > 0 &&
        headerCells.filter((v) => !isNaN(LQ.ValueParser.parseNumber(v)) || !isNaN(LQ.ValueParser.parseDate(v))).length / headerCells.length >= 0.5;
      const reasons = [];
      let settings;
      if (looksLikeData) {
        settings = { hasHeader: false, headerRow: headerIdx + 1, startRow: headerIdx + 1, startCol: startCol + 1, endRow: null };
        reasons.push((headerIdx + 1) + ' 行目の半数以上が数値・日付のため「ヘッダーなし」と判定');
      } else {
        settings = { hasHeader: true, headerRow: headerIdx + 1, startRow: headerIdx + 2, startCol: startCol + 1, endRow: null };
        reasons.push('ヘッダー ' + (headerIdx + 1) + ' 行目：空でないセルが ' + counts[headerIdx].count + ' 個ある最初の行');
      }
      if (startCol > 0) reasons.push('開始列 ' + Util.colLetter(startCol) + '：左側の空の列を除外');
      return { settings: settings, reasons: reasons };
    }
  }

  LQ.Dataset = Dataset;
})(window);

/* =========================================================================
 * ── 列の追加（読み替え・計算） ──
 * 読み込んだ表に、ほかの列から作る列を加える（Dataset が読み込み範囲を当てはめるたびに作り直す）。
 *   読み替え（map）：対応表（元の値 → 読み替え後）で置き換える。前後の空白・全角半角・大文字小文字をそろえて照らし合わせ、
 *                    「*」のワイルドカードも使える。対応表にない値は「元の値のまま／空欄／指定した値」
 *   計算（calc）：[列名] を使った式（Excel と同じ書き方。演算子・比較・関数は lq-formula.js / lq-formula-funcs.js）。
 *                 空欄は 0 として計算（Excel と同じ）。数値として読めない値・0 での割り算・計算できない値の行は空欄にして件数を数える
 *   定義：{id, kind:'map'|'calc', name, from, rows:[[元, 後]], unmatched:'keep'|'blank'|'value', value, expr}
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;

  const KINDS = { map: { label: '読み替え', badge: '読替', icon: 'right-left' }, calc: { label: '計算', badge: '計算', icon: 'calculator' } };
  const UNMATCHED = ['keep', 'blank', 'value'];
  const MAX_ROWS = 20000;
  const MAX_DEFS = 30;
  const Formula = LQ.Formula;

  /* ---------------------------------------------------------------------
   * 読み替え
   * ------------------------------------------------------------------- */
  function buildMapper(def) {
    const norm = new LQ.Normalizer({ numeric: false, date: false, wildcard: true });
    const exact = new Map();
    const patterns = [];
    (def.rows || []).forEach((row) => {
      const from = row[0];
      if (LQ.Normalizer.isBlank(from)) return;
      const key = norm.text(from);
      const glob = norm.glob(from);
      if (glob) patterns.push({ glob: glob, to: row[1] === undefined ? '' : String(row[1]) });
      else if (!exact.has(key)) exact.set(key, row[1] === undefined ? '' : String(row[1]));
    });
    return (value) => {
      if (LQ.Normalizer.isBlank(value)) return null;
      const key = norm.text(value);
      if (exact.has(key)) return exact.get(key);
      for (let i = 0; i < patterns.length; i++) if (patterns[i].glob.test(key)) return patterns[i].to;
      return null;
    };
  }

  const registry = { source: [], condition: [] };

  const Derive = {
    KINDS: KINDS,

    /** 役割（source / condition）ごとの今の定義。Dataset は読み込み範囲を当てはめるたびにここから作る */
    defsFor(role) {
      return registry[role] || [];
    },

    setDefs(role, defs) {
      registry[role] = defs.slice();
    },

    MAX_ROWS: MAX_ROWS,
    MAX_DEFS: MAX_DEFS,
    FormulaError: Formula.FormulaError,

    /** 保存・JSON から読んだ定義の値の種類を確かめる（使えないものは null） */
    clean(raw) {
      if (!raw || typeof raw !== 'object' || !KINDS[raw.kind]) return null;
      const name = String(raw.name || '').replace(/\s+/g, ' ').trim();
      if (!name) return null;
      const def = { id: typeof raw.id === 'string' ? raw.id : LQ.Util.uid('drv'), kind: raw.kind, name: name };
      if (raw.kind === 'map') {
        def.from = String(raw.from || '');
        def.rows = (Array.isArray(raw.rows) ? raw.rows : []).filter(Array.isArray).slice(0, MAX_ROWS)
          .map((r) => [String(r[0] === undefined || r[0] === null ? '' : r[0]), String(r[1] === undefined || r[1] === null ? '' : r[1])]);
        def.unmatched = UNMATCHED.indexOf(raw.unmatched) !== -1 ? raw.unmatched : 'keep';
        def.value = String(raw.value || '');
        def.tableName = String(raw.tableName || '');
      } else {
        def.expr = String(raw.expr || '');
      }
      return def;
    },

    cleanList(list) {
      return (Array.isArray(list) ? list : []).map(Derive.clean).filter(Boolean).slice(0, MAX_DEFS);
    },

    /** 式の確認（画面の入力中の表示用）。@returns {{ok:boolean, message?:string, pos?:number, columns?:string[]}} */
    check(expr, names) {
      try {
        const c = Formula.compile(expr, (n) => names.indexOf(n));
        return { ok: true, columns: c.columns, functions: c.functions };
      } catch (err) {
        return { ok: false, message: err.message, pos: err.pos };
      }
    },

    /** 定義が使う元の列 */
    sources(def) {
      if (def.kind === 'map') return def.from ? [def.from] : [];
      const found = [];
      String(def.expr || '').replace(/[[［]([^\]］]*)[\]］]/g, (m, name) => {
        if (found.indexOf(name.trim()) === -1) found.push(name.trim());
        return m;
      });
      return found;
    },

    /**
     * 1 つの定義の列の値を作る。
     * @param {object} def
     * @param {number} rows 行数
     * @param {Function} columnIndex 列名 → 列番号
     * @param {Function} cell (r, c) → 値
     * @returns {{values:string[]|null, info:object}} info：{ok, message, matched, unmatched, errors:{nan, div0}}
     */
    compute(def, rows, columnIndex, cell) {
      if (def.kind === 'map') {
        const from = columnIndex(def.from);
        if (from < 0) return { values: null, info: { ok: false, message: '列「' + def.from + '」がないため作れません' } };
        const map = buildMapper(def);
        const values = new Array(rows);
        let matched = 0;
        let unmatched = 0;
        for (let r = 0; r < rows; r++) {
          const v = cell(r, from);
          const to = map(v);
          if (to !== null) {
            matched++;
            values[r] = to;
            continue;
          }
          if (!LQ.Normalizer.isBlank(v)) unmatched++;
          values[r] = def.unmatched === 'blank' ? '' : (def.unmatched === 'value' && !LQ.Normalizer.isBlank(v) ? def.value : String(v));
        }
        return { values: values, info: { ok: true, matched: matched, unmatched: unmatched } };
      }
      let compiled;
      try {
        compiled = Formula.compile(def.expr, columnIndex);
      } catch (err) {
        return { values: null, info: { ok: false, message: '式：' + err.message } };
      }
      const values = new Array(rows);
      const errors = { nan: 0, div0: 0, value: 0 };
      for (let r = 0; r < rows; r++) {
        try {
          values[r] = Formula.toText(compiled.evaluate((c) => cell(r, c)));
        } catch (err) {
          const code = Formula.faultCode(err);
          if (!code) throw err;
          errors[code]++;
          values[r] = '';
        }
      }
      return { values: values, info: { ok: true, errors: errors } };
    },

    /** 状態の文章（画面の一覧・根拠用） */
    infoText(info, rows) {
      if (!info) return '';
      if (!info.ok) return info.message;
      const fmt = LQ.Util.formatInt;
      if (info.errors) {
        const bad = [];
        if (info.errors.nan) bad.push('数値として読めない値 ' + fmt(info.errors.nan) + ' 行');
        if (info.errors.div0) bad.push('0 での割り算 ' + fmt(info.errors.div0) + ' 行');
        if (info.errors.value) bad.push('計算できない値（日付でない・見つからない など）' + fmt(info.errors.value) + ' 行');
        return fmt(rows) + ' 行を計算' + (bad.length ? '（' + bad.join('・') + 'は空欄）' : '');
      }
      return '読み替え ' + fmt(info.matched) + ' 行' + (info.unmatched ? '・対応表にない値 ' + fmt(info.unmatched) + ' 行' : '');
    },

    /** 定義の説明（一覧の 2 行目） */
    summary(def) {
      if (def.kind === 'calc') return '＝ ' + def.expr;
      const rest = { keep: '元の値のまま', blank: '空欄', value: '「' + def.value + '」' }[def.unmatched];
      return '「' + def.from + '」を対応表 ' + LQ.Util.formatInt(def.rows.length) + ' 件で読み替え（ない値は' + rest + '）';
    }
  };

  LQ.Derive = Derive;
})(window);

/* =========================================================================
 * ── 絞り込み（① / ② の行を前もって減らす） ──
 * 列ごとの絞り込み。すべてを満たす行だけを残す（Excel のオートフィルターと同じ AND）。
 *   条件で絞る（mode:'op'）：比較方法（抽出条件と同じ登録簿）と値。ワイルドカード・範囲・期間も同じ書き方
 *   値を選ぶ（mode:'values'）：選んだ値のどれかと同じ行（空欄は '' で表す）
 *   値は初期値の照合ルール（前後の空白・全角半角・大文字小文字をそろえ、数値・日付として比較）でそろえる。
 *   絞り込みは LoadMemory（lq-storage.js）が列の名前で記憶し、次に読み込んだ表に掛け直す。
 *   定義：{id, col, mode:'op'|'values', op, value, value2, values:[]}
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;

  function normalizer() {
    return new LQ.Normalizer(LQ.Normalizer.DEFAULT_RULES);
  }

  const RowFilter = {
    /**
     * @param {object} f 絞り込みの定義
     * @param {LQ.Dataset} ds
     * @returns {{test:function(number):boolean|null, message?:string}}
     */
    compile(f, ds, cellOf) {
      const at = cellOf || ((r, c) => ds.cell(r, c));
      const col = ds.findColumn(f.col);
      if (col < 0) return { test: null, message: '列「' + f.col + '」がないため、この絞り込みは使っていません' };
      const norm = normalizer();
      if (f.mode === 'values') {
        const set = new Set((f.values || []).map((v) => norm.text(v)));
        return { test: (r) => set.has(norm.text(at(r, col))) };
      }
      const op = LQ.Operators.get(f.op);
      if (!op) return { test: null, message: '比較方法を選んでください' };
      const blank = LQ.Normalizer.isBlank;
      if (op.pair) {
        if (blank(f.value) && blank(f.value2)) return { test: null, message: '開始・終了の少なくとも一方を入力してください' };
        const conv = norm.converter('typed');
        const lo = blank(f.value) ? undefined : conv(f.value);
        const hi = blank(f.value2) ? undefined : conv(f.value2);
        return { test: (r) => op.test(conv(at(r, col)), lo, hi) === true };
      }
      if (blank(f.value)) return { test: null, message: '値を入力してください' };
      const pattern = op.wildcard ? norm.criteria(f.value) : null;
      if (pattern) {
        return { test: (r) => {
          const v = at(r, col);
          return pattern.test(norm.key(v), norm.text(v), norm.typed(v)) !== op.negative;
        } };
      }
      if (op.validate && op.validate(f.value)) return { test: null, message: op.validate(f.value) };
      const right = norm.converter(op.rightPrep || op.prep)(f.value);
      if (op.rightPrep === 'period' && !right) return { test: null, message: '「' + f.value + '」は期間として読めません（例：2024/05・今月・直近30日）' };
      const left = norm.converter(op.prep);
      return { test: (r) => op.test(left(at(r, col)), right) === true };
    },

    /** 絞り込みの文章（タグ・根拠用） */
    describe(f, isDate) {
      if (f.mode === 'values') {
        const shown = f.values.slice(0, 3).map((v) => (v === '' ? '（空欄）' : v));
        return f.col + '：' + shown.join('・') + (f.values.length > 3 ? ' ほか ' + (f.values.length - 3) + ' 件' : '');
      }
      const op = LQ.Operators.get(f.op);
      if (!op) return f.col;
      const phrase = LQ.Operators.phraseOf(op, isDate);
      if (op.pair) {
        const v = (x) => (LQ.Normalizer.isBlank(x) ? '（指定なし）' : '「' + x + '」');
        return f.col + ' が ' + v(f.value) + '〜' + v(f.value2) + ' ' + phrase;
      }
      return f.col + ' が「' + f.value + '」' + phrase;
    }
  };

  LQ.RowFilter = RowFilter;
})(window);
