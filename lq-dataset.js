/* =========================================================================
 * LightQuery - lq-dataset.js
 * データセット：読み込んだ grid に「ヘッダー行・データ開始行・開始列・終了行」を当てはめ、
 *   列（名前付き）と行（元の行番号付き）を取り出す。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Util = LQ.Util;

  const ROLE_LABEL = { source: '① 元データ', condition: '② 条件データ' };
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
     * @param {{isSample?:boolean, settings?:object}} options
     */
    constructor(role, source, options) {
      const opts = options || {};
      this.id = Util.uid('ds');
      this.role = role;
      this.source = source;
      this.isSample = !!opts.isSample;
      this.version = 0;
      this.grid = [];
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
        settings: Util.clone(this.settings)
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

    /** 設定から列と行を作り直す */
    derive() {
      const g = this.grid;
      const s = this.settings;
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
      this.columns = columns;
      this._colIndex = new Map(columns.map((col) => [col.name, col.index]));
      this.rowIdx = Int32Array.from(rows);
      this._baseRowIdx = this.rowIdx;
      this._appendDerived();
      this._applyFilters();
      this.stats = {
        rows: rows.length,
        cols: columns.length,
        skippedEmpty: skippedEmpty,
        firstRow: rows.length ? rows[0] + 1 : null,
        lastRow: rows.length ? rows[rows.length - 1] + 1 : null,
        rangeText: columns.length && rows.length
          ? columns[0].letter + (rows[0] + 1) + ':' + columns[columns.length - 1].letter + (rows[rows.length - 1] + 1)
          : '—'
      };
      this.version++;
    }

    /** データ行 r・列 c の値（文字列）。追加した列（読み替え・計算）は作った値を返す */
    cell(r, c) {
      const col = this.columns[c];
      if (col && col.values) return col.values[r];
      const row = this.grid[this.rowIdx[r]];
      if (!row || !col) return '';
      const v = row[col.src];
      return v === undefined || v === null ? '' : v;
    }

    /** データ行 r の元の行番号（1 始まり。Excel の行番号と一致） */
    rowNumber(r) {
      return this.rowIdx[r] + 1;
    }

    /** 追加した列（読み替え・計算）を作り直す（定義が変わったとき） */
    refreshDerived() {
      this.rowIdx = this._baseRowIdx || this.rowIdx;
      this.columns = this.columns.filter((c) => !c.derived);
      this._colIndex = new Map(this.columns.map((col) => [col.name, col.index]));
      this._appendDerived();
      this._applyFilters();
      this.version++;
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
      const row = this.grid[base[b]];
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
      this.columns.forEach((c) => {
        if (!c.values) return;
        c.baseValues = c.values;
        c.values = keep.map((r) => c.baseValues[r]);
      });
      this.filterInfo = { base: n, kept: keep.length, items: items };
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
 *   計算（calc）：[列名] を使った式。+ - × ÷（* /）・括弧・& （文字のつなぎ合わせ）・"文字"・ROUND / ROUNDUP / ROUNDDOWN。
 *                 空欄は 0 として計算（Excel と同じ）。数値として読めない値・0 での割り算の行は空欄にして件数を数える
 *   定義：{id, kind:'map'|'calc', name, from, rows:[[元, 後]], unmatched:'keep'|'blank'|'value', value, expr}
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const ValueParser = LQ.ValueParser;

  const KINDS = { map: { label: '読み替え', badge: '読替', icon: 'right-left' }, calc: { label: '計算', badge: '計算', icon: 'calculator' } };
  const UNMATCHED = ['keep', 'blank', 'value'];
  const MAX_ROWS = 20000;
  const MAX_DEFS = 30;
  const FUNCS = {
    ROUND: (x, n) => roundTo(x, n, (v) => Math.round(v)),
    ROUNDUP: (x, n) => roundTo(x, n, (v) => Math.ceil(v)),
    ROUNDDOWN: (x, n) => roundTo(x, n, (v) => Math.floor(v))
  };
  /* 式の中の全角の記号・数字を半角にそろえる（[列名] と "文字" の中は変えない） */
  const SYMBOLS = { '＋': '+', '－': '-', '−': '-', '＊': '*', '×': '*', '／': '/', '÷': '/', '（': '(', '）': ')', '＆': '&',
    '［': '[', '］': ']', '，': ',', '、': ',', '．': '.', '”': '"', '“': '"', '＂': '"', '　': ' ' };

  /** Excel と同じく、0 から遠ざかる向きに丸める（ROUND）。小数の誤差を抑えるため桁を指数で動かす */
  function roundTo(x, n, fn) {
    const digits = Math.trunc(n || 0);
    const sign = x < 0 ? -1 : 1;
    const shifted = Number(Math.abs(x) + 'e' + digits);
    const v = fn(Number(shifted.toPrecision(15)));
    return sign * Number(v + 'e' + (-digits));
  }

  class FormulaError extends Error {
    constructor(message, pos) {
      super(message);
      this.pos = pos;
    }
  }

  /* ---------------------------------------------------------------------
   * 式の字句解析と構文解析（再帰下降）。結果は評価関数の木
   * ------------------------------------------------------------------- */
  function tokenize(src) {
    const out = [];
    let i = 0;
    while (i < src.length) {
      let ch = SYMBOLS[src[i]] || src[i];
      if (/[０-９]/.test(ch)) ch = String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
      if (ch === ' ' || ch === '\t' || ch === '\n') {
        i++;
        continue;
      }
      if (ch === '[') {
        let end = i + 1;
        while (end < src.length && src[end] !== ']' && src[end] !== '］') end++;
        if (end >= src.length) throw new FormulaError('「]」で閉じていない列名があります', i);
        out.push({ t: 'col', v: src.slice(i + 1, end).trim(), pos: i });
        i = end + 1;
        continue;
      }
      if (ch === '"') {
        let j = i + 1;
        while (j < src.length && (SYMBOLS[src[j]] || src[j]) !== '"') j++;
        if (j >= src.length) throw new FormulaError('「"」で閉じていない文字があります', i);
        out.push({ t: 'str', v: src.slice(i + 1, j), pos: i });
        i = j + 1;
        continue;
      }
      if (/[0-9.]/.test(ch)) {
        let j = i;
        let num = '';
        while (j < src.length) {
          let c = SYMBOLS[src[j]] || src[j];
          if (/[０-９]/.test(c)) c = String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
          if (!/[0-9.]/.test(c)) break;
          num += c;
          j++;
        }
        if (Number.isNaN(Number(num))) throw new FormulaError('数「' + num + '」を読めません', i);
        out.push({ t: 'num', v: Number(num), pos: i });
        i = j;
        continue;
      }
      if ('+-*/()&,'.indexOf(ch) !== -1) {
        out.push({ t: 'op', v: ch, pos: i });
        i++;
        continue;
      }
      const m = /^[A-Za-zＡ-Ｚａ-ｚ]+/.exec(src.slice(i));
      if (m) {
        const name = m[0].normalize('NFKC').toUpperCase();
        if (!FUNCS[name]) throw new FormulaError('「' + m[0] + '」は使えません（列名は [ ] で囲みます。関数は ROUND・ROUNDUP・ROUNDDOWN）', i);
        out.push({ t: 'fn', v: name, pos: i });
        i += m[0].length;
        continue;
      }
      throw new FormulaError('「' + src[i] + '」は使えません（列名は [ ] で囲みます）', i);
    }
    return out;
  }

  /** 値を数として読む（空欄は 0。読めなければ NaN） */
  function toNumber(v) {
    if (typeof v === 'number') return v;
    if (v === '' || v === null || v === undefined || String(v).trim() === '') return 0;
    return ValueParser.parseNumber(v);
  }

  function toText(v) {
    return typeof v === 'number' ? formatNumber(v) : String(v === null || v === undefined ? '' : v);
  }

  function formatNumber(v) {
    const r = Number(v.toPrecision(15));
    return String(Object.is(r, -0) ? 0 : r);
  }

  const NOT_NUMBER = { code: 'nan' };
  const DIV_ZERO = { code: 'div0' };

  function num(v) {
    const n = toNumber(v);
    if (Number.isNaN(n)) throw NOT_NUMBER;
    return n;
  }

  /**
   * @param {string} expr
   * @param {Function} columnIndex 列名 → 列番号（なければ -1）
   * @returns {{evaluate:function(Function):*, columns:string[]}} evaluate(cellOf) は 1 行分の値を返す
   */
  function compile(expr, columnIndex) {
    const tokens = tokenize(String(expr || ''));
    if (!tokens.length) throw new FormulaError('式を入力してください', 0);
    let p = 0;
    const columns = [];
    const peek = () => tokens[p];
    const isOp = (v) => peek() && peek().t === 'op' && peek().v === v;
    const expect = (v) => {
      if (!isOp(v)) throw new FormulaError('「' + v + '」が必要です', peek() ? peek().pos : String(expr).length);
      p++;
    };
    function primary() {
      const tk = peek();
      if (!tk) throw new FormulaError('式が途中で終わっています', String(expr).length);
      p++;
      if (tk.t === 'num') return () => tk.v;
      if (tk.t === 'str') return () => tk.v;
      if (tk.t === 'col') {
        const idx = columnIndex(tk.v);
        if (idx < 0) throw new FormulaError('列「' + tk.v + '」がありません', tk.pos);
        if (columns.indexOf(tk.v) === -1) columns.push(tk.v);
        return (cell) => cell(idx);
      }
      if (tk.t === 'fn') {
        expect('(');
        const args = [concat()];
        while (isOp(',')) {
          p++;
          args.push(concat());
        }
        expect(')');
        if (args.length > 2) throw new FormulaError(tk.v + ' の引数は（値, 桁数）の 2 つまでです', tk.pos);
        const fn = FUNCS[tk.v];
        return (cell) => fn(num(args[0](cell)), args[1] ? num(args[1](cell)) : 0);
      }
      if (tk.t === 'op' && tk.v === '(') {
        const inner = concat();
        expect(')');
        return inner;
      }
      if (tk.t === 'op' && tk.v === '-') {
        const inner = primary();
        return (cell) => -num(inner(cell));
      }
      throw new FormulaError('「' + tk.v + '」の位置がおかしいです', tk.pos);
    }
    function mul() {
      let left = primary();
      while (isOp('*') || isOp('/')) {
        const op = peek().v;
        p++;
        const l = left;
        const r = primary();
        left = op === '*' ? (cell) => num(l(cell)) * num(r(cell)) : (cell) => {
          const d = num(r(cell));
          if (d === 0) throw DIV_ZERO;
          return num(l(cell)) / d;
        };
      }
      return left;
    }
    function add() {
      let left = mul();
      while (isOp('+') || isOp('-')) {
        const op = peek().v;
        p++;
        const l = left;
        const r = mul();
        left = op === '+' ? (cell) => num(l(cell)) + num(r(cell)) : (cell) => num(l(cell)) - num(r(cell));
      }
      return left;
    }
    function concat() {
      let left = add();
      while (isOp('&')) {
        p++;
        const l = left;
        const r = add();
        left = (cell) => toText(l(cell)) + toText(r(cell));
      }
      return left;
    }
    const root = concat();
    if (p < tokens.length) throw new FormulaError('「' + tokens[p].v + '」の位置がおかしいです', tokens[p].pos);
    return { evaluate: root, columns: columns };
  }

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
    FormulaError: FormulaError,

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
        const c = compile(expr, (n) => names.indexOf(n));
        return { ok: true, columns: c.columns };
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
        compiled = compile(def.expr, columnIndex);
      } catch (err) {
        return { values: null, info: { ok: false, message: '式：' + err.message } };
      }
      const values = new Array(rows);
      const errors = { nan: 0, div0: 0 };
      for (let r = 0; r < rows; r++) {
        try {
          values[r] = toText(compiled.evaluate((c) => cell(r, c)));
        } catch (err) {
          if (err === NOT_NUMBER) errors.nan++;
          else if (err === DIV_ZERO) errors.div0++;
          else throw err;
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
      const pattern = op.wildcard ? norm.glob(f.value) : null;
      if (pattern) return { test: (r) => pattern.test(norm.text(at(r, col))) !== op.negative };
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
