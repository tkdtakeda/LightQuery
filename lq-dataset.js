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

    /** データ行 r・列 c の値（文字列） */
    cell(r, c) {
      const row = this.grid[this.rowIdx[r]];
      const col = this.columns[c];
      if (!row || !col) return '';
      const v = row[col.src];
      return v === undefined || v === null ? '' : v;
    }

    /** データ行 r の元の行番号（1 始まり。Excel の行番号と一致） */
    rowNumber(r) {
      return this.rowIdx[r] + 1;
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
