/* =========================================================================
 * LightQuery - lq-prep.js
 * 前処理：照合・集計の前に表を整える処理（処理の順は固定）
 *   読み込み（縦に結合）→ 縦持ちにする → 列の追加 → 絞り込み → 重複の削除
 *   列の追加・絞り込みは lq-dataset.js。ここには縦の結合・縦持ち・重複の削除、処理の流れ（各段の行数）を置く。
 * ========================================================================= */

/* =========================================================================
 * ── 縦に結合 ──
 * SourceUnion：① の 1 つ目のファイルに、2 つ目以降のファイルの行を下に足して 1 つの表にする（Power Query の「追加」）。
 *   ・列は名前でそろえる（列の順番が違っても正しく重なる）。片方にしかない列は、ない側を空欄にする
 *   ・読み込み範囲は 1 つ目のファイルの設定を当てはめ、列名が合わないファイルだけ自動判定する
 *   ・どのファイルの行かが分かるよう、最後に「元ファイル」列を付ける
 *   ・ヘッダーなしの表は、列の位置でそろえる
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Util = LQ.Util;

  const FILE_COLUMN = '元ファイル';
  /* 縦に結合できるファイルの数（1 つ目を含む） */
  const MAX_FILES = 24;
  /* 列名がこの割合以上 1 つ目のファイルと同じなら、同じ構成の表とみなす */
  const FIT_RATIO = 0.5;

  /** 1 つ目のファイルの列名のうち、names にもある割合 */
  function fitRatio(primaryNames, names) {
    if (!primaryNames.length) return 0;
    const set = new Set(names);
    return primaryNames.filter((n) => set.has(n)).length / primaryNames.length;
  }

  /** 「元ファイル」列に入れる名前（シートが複数あるブックはシート名を添える） */
  function fileLabel(src) {
    return src.name + (src.hasSheets && src.sheetNames.length > 1 ? '［' + src.sheetName + '］' : '');
  }

  const SourceUnion = {
    FILE_COLUMN: FILE_COLUMN,
    MAX_FILES: MAX_FILES,

    /**
     * ファイルごとに読み込み範囲を決めて行を取り出す。
     * @returns {{source:LQ.SourceFile, label:string, settings:object, part:object, how:'primary'|'same'|'auto', ratio:number}}
     */
    _readMember(ds, src, primaryNames) {
      const grid = src.grid || [];
      let settings = ds.settings;
      let part = LQ.Dataset.extract(grid, settings);
      let how = 'same';
      let ratio = ds.settings.hasHeader ? fitRatio(primaryNames, part.columns.map((c) => c.name)) : 1;
      if (ds.settings.hasHeader && ratio < FIT_RATIO) {
        const auto = LQ.Dataset.normalizeSettings(LQ.Dataset.autoDetect(grid).settings);
        const p2 = LQ.Dataset.extract(grid, auto);
        const r2 = auto.hasHeader ? fitRatio(primaryNames, p2.columns.map((c) => c.name)) : 0;
        if (r2 > ratio) {
          settings = auto;
          part = p2;
          ratio = r2;
          how = 'auto';
        }
      }
      return { source: src, label: fileLabel(src), settings: settings, part: part, how: how, ratio: ratio };
    },

    /**
     * @param {LQ.Dataset} ds 1 つ目のファイル（ds.source）と、2 つ目以降（ds.members）
     * @param {{columns:Array, rows:number[], skippedEmpty:number}} part 1 つ目のファイルを読み込み範囲で取り出した結果
     * @returns {{table:Array[], columns:Array, rows:number[], rowNo:Int32Array, info:object}}
     */
    build(ds, part) {
      const hasHeader = ds.settings.hasHeader;
      const primaryNames = part.columns.map((c) => c.name);
      const files = [{ source: ds.source, label: fileLabel(ds.source), settings: ds.settings, part: part, how: 'primary', ratio: 1 }]
        .concat(ds.members.map((src) => SourceUnion._readMember(ds, src, primaryNames)));

      /* 列：1 つ目のファイルの列 → 2 つ目以降にだけある列（出てきた順）→ 元ファイル */
      const columns = part.columns.map((c) => ({ name: c.name, index: c.index, src: c.index, letter: c.letter }));
      const index = new Map(columns.map((c) => [c.name, c.index]));
      let lastSrc = part.columns.length ? part.columns[part.columns.length - 1].src : ds.settings.startCol - 2;
      const maps = files.map((f) => f.part.columns.map((c, pos) => {
        /* ヘッダーなしは位置でそろえる */
        const name = hasHeader ? c.name : (columns[pos] ? columns[pos].name : c.name);
        if (!index.has(name)) {
          lastSrc++;
          const col = { name: name, index: columns.length, src: columns.length, letter: Util.colLetter(lastSrc) };
          columns.push(col);
          index.set(name, col.index);
        }
        return index.get(name);
      }));
      let fileName = FILE_COLUMN;
      for (let k = 2; index.has(fileName); k++) fileName = FILE_COLUMN + ' (' + k + ')';
      const fileIdx = columns.length;
      columns.push({ name: fileName, index: fileIdx, src: fileIdx, letter: Util.colLetter(lastSrc + 1), fileCol: true });

      const width = columns.length;
      const table = [];
      const rowNo = [];
      files.forEach((f, fi) => {
        const grid = f.source.grid || [];
        const map = maps[fi];
        const srcCols = f.part.columns;
        f.part.rows.forEach((r) => {
          const row = grid[r] || [];
          const out = new Array(width);
          for (let k = 0; k < srcCols.length; k++) out[map[k]] = row[srcCols[k].src];
          out[fileIdx] = f.label;
          table.push(out);
          rowNo.push(r + 1);
        });
      });

      const nameSet = new Set(primaryNames);
      const info = {
        skippedEmpty: files.reduce((sum, f) => sum + f.part.skippedEmpty, 0),
        fileColumn: fileName,
        files: files.map((f) => {
          const names = f.part.columns.map((c) => c.name);
          const own = new Set(names);
          return {
            label: f.label,
            name: f.source.name,
            kind: f.source.kind,
            rows: f.part.rows.length,
            how: f.how,
            settings: f.settings,
            fits: f.ratio >= FIT_RATIO,
            extra: hasHeader ? names.filter((n) => !nameSet.has(n)) : [],
            missing: hasHeader ? primaryNames.filter((n) => !own.has(n)) : []
          };
        })
      };
      return { table: table, columns: columns, rows: table.map((_, i) => i), rowNo: Int32Array.from(rowNo), info: info };
    },

    /** ファイル 1 つの状態の文章（読み込みパネル・根拠用） */
    describeFile(f) {
      const parts = [Util.formatInt(f.rows) + ' 行'];
      if (f.how === 'auto') parts.push('列名が 1 つ目と合わないため読み込み範囲を自動判定（ヘッダー ' + f.settings.headerRow + ' 行目）');
      if (!f.fits) parts.push('列名が 1 つ目のファイルとほとんど一致しません');
      if (f.missing.length) parts.push('ない列 ' + f.missing.length + ' 列（' + f.missing.slice(0, 3).join('・') + (f.missing.length > 3 ? ' ほか' : '') + '）は空欄');
      if (f.extra.length) parts.push('この表だけの列 ' + f.extra.length + ' 列（' + f.extra.slice(0, 3).join('・') + (f.extra.length > 3 ? ' ほか' : '') + '）を追加');
      return parts.join('・');
    },

    /** 注意が要るファイルか（列名が合わない・読み込み範囲を自動判定した・ない列がある） */
    needsAttention(f) {
      return f.how !== 'primary' && (!f.fits || f.how === 'auto' || f.missing.length > 0);
    }
  };

  LQ.SourceUnion = SourceUnion;
})(window);

/* =========================================================================
 * ── 縦持ちにする（ピボット解除） ──
 * Unpivot：横に並んだ列（4月・5月・6月 など）を、「項目」と「値」の 2 列の行に並べ替える（Power Query の「列のピボット解除」）。
 *   選んだ列以外（顧客名など）はそのまま残し、選んだ列 1 つにつき 1 行を作る。値が空欄のセルは行にしない（選べる）。
 *   読み込み（縦に結合）のすぐあとに当てはめるため、列の追加・絞り込み・重複の削除は縦持ちにした表に掛かる。
 *   定義：{cols:string[], name:string, value:string, keepBlank:boolean}
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const DEFAULT_NAME = '項目';
  const DEFAULT_VALUE = '値';
  /* 横に並べがちな見出し：月（4月・2024/04・2024年4月）・年度・四半期・日付・数 */
  const SERIES_NAME = /^(\d{1,2}月|\d{4}[\/\-年.]\d{1,2}月?|\d{4}年度?|FY\d{2,4}|Q[1-4]|第?[1-4]四半期|\d+)$/i;

  /** 列の名前が、ほかの列と重ならないようにする */
  function uniqueName(name, used) {
    let out = name;
    for (let k = 2; used.has(out); k++) out = name + ' (' + k + ')';
    used.add(out);
    return out;
  }

  const Unpivot = {
    DEFAULT_NAME: DEFAULT_NAME,
    DEFAULT_VALUE: DEFAULT_VALUE,

    /** 保存・JSON から読んだ定義をそろえる（使えなければ null） */
    clean(raw) {
      if (!raw || typeof raw !== 'object' || !Array.isArray(raw.cols)) return null;
      const cols = raw.cols.filter((c) => typeof c === 'string' && c);
      return {
        cols: Array.from(new Set(cols)),
        name: String(raw.name || '').trim() || DEFAULT_NAME,
        value: String(raw.value || '').trim() || DEFAULT_VALUE,
        keepBlank: !!raw.keepBlank
      };
    },

    /** 縦持ちにする列のおすすめ（月・年度・日付・数の見出しの列。2 列以上あるときだけ） */
    suggest(columns) {
      const names = columns.filter((c) => !c.fileCol && (SERIES_NAME.test(c.name) || !Number.isNaN(LQ.ValueParser.parseDate(c.name)))).map((c) => c.name);
      return names.length >= 2 ? names : [];
    },

    /**
     * 列と行を縦持ちにする
     * @param {Array} columns 今の列（{name, index, src, letter, fileCol?}）
     * @param {number[]} rows 今の行（table の行番号）
     * @param {Array[]} table 今の表
     * @param {function(number):number} rowNo table の行番号 → 元の行番号
     * @param {object} def
     * @returns {{columns?:Array, rows?:number[], table?:Array[], rowNo?:Int32Array, info:object}} 縦持ちにする列がなければ info だけ
     */
    build(columns, rows, table, rowNo, def) {
      const picked = new Set(def.cols);
      const melt = columns.filter((c) => picked.has(c.name));
      const keep = columns.filter((c) => !picked.has(c.name));
      const missing = def.cols.filter((n) => !columns.some((c) => c.name === n));
      const info = { base: rows.length, kept: rows.length, cols: melt.map((c) => c.name), missing: missing, ok: melt.length > 0, message: '' };
      if (missing.length) info.message = '列「' + missing.join('」「') + '」がないため、残りの列で縦持ちにしています';
      if (!melt.length) {
        info.message = '縦持ちにする列がないため、使っていません';
        return { info: info };
      }
      const used = new Set(keep.map((c) => c.name));
      const nameCol = uniqueName(def.name || DEFAULT_NAME, used);
      const valueCol = uniqueName(def.value || DEFAULT_VALUE, used);
      const width = keep.length + 2;
      const outCols = keep.map((c, i) => Object.assign({}, c, { index: i, src: i }))
        .concat([{ name: nameCol, index: keep.length, src: keep.length, letter: '項', unpivot: 'name' },
          { name: valueCol, index: keep.length + 1, src: keep.length + 1, letter: '値', unpivot: 'value' }]);
      const out = [];
      const nums = [];
      rows.forEach((r) => {
        const row = table[r] || [];
        const head = keep.map((c) => row[c.src]);
        melt.forEach((m) => {
          const v = row[m.src];
          if (!def.keepBlank && (v === undefined || v === null || String(v).trim() === '')) return;
          const line = new Array(width);
          for (let i = 0; i < head.length; i++) line[i] = head[i];
          line[keep.length] = m.name;
          line[keep.length + 1] = v;
          out.push(line);
          nums.push(rowNo(r));
        });
      });
      info.kept = out.length;
      info.nameCol = nameCol;
      info.valueCol = valueCol;
      return { columns: outCols, rows: out.map((_, i) => i), table: out, rowNo: Int32Array.from(nums), info: info };
    },

    /** 設定の文章（タグ・根拠用） */
    describe(def) {
      const cols = def.cols;
      return '列「' + cols.slice(0, 3).join('」「') + '」' + (cols.length > 3 ? 'ほか ' + (cols.length - 3) + ' 列' : '') + 'を「' + def.name + '」「' + def.value + '」の行に';
    }
  };

  LQ.Unpivot = Unpivot;
})(window);

/* =========================================================================
 * ── 重複の削除 ──
 * Dedup：選んだ列（空ならすべての列。「元ファイル」列と追加した列は除く）の値がすべて同じ行を重複とみなし、
 *   最初の行だけを残す（Excel の「重複の削除」と同じ）。値は絞り込みと同じく、前後の空白・全角半角・大文字小文字をそろえて比べる。
 *   絞り込みのあとに当てはめ、除いた行と「残した行」を dedupInfo に残す（処理の流れの内訳に使う）。
 *   定義：{cols:string[]}
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const SEP = '\u0001';

  const Dedup = {
    /** 比べる対象にできる列（元の表の列。「元ファイル」列と追加した列は除く） */
    candidates(ds) {
      return ds.columns.filter((c) => !c.derived && !c.fileCol);
    },

    /**
     * 比べる列の位置と、見つからない列の名前
     * @returns {{cols:number[], missing:string[], all:boolean}}
     */
    resolve(ds, def) {
      const names = (def && def.cols) || [];
      if (!names.length) return { cols: Dedup.candidates(ds).map((c) => c.index), missing: [], all: true };
      const cols = [];
      const missing = [];
      names.forEach((n) => {
        const c = ds.findColumn(n);
        if (c < 0) missing.push(n);
        else cols.push(c);
      });
      return { cols: cols, missing: missing, all: false };
    },

    /**
     * 重複の削除を当てはめる（ds の行を減らす）
     * @returns {{base:number, kept:number, removed:Int32Array, keptOf:Int32Array, cols:string[], all:boolean, missing:string[], ok:boolean, message:string}}
     */
    apply(ds, def) {
      const r = Dedup.resolve(ds, def);
      const names = r.cols.map((c) => ds.columns[c].name);
      const n = ds.rowIdx.length;
      const info = { base: n, kept: n, removed: new Int32Array(0), keptOf: new Int32Array(0), cols: names, all: r.all, missing: r.missing, ok: true, message: '' };
      if (r.missing.length) info.message = '列「' + r.missing.join('」「') + '」がないため、残りの列で比べています';
      if (!r.cols.length) {
        info.ok = false;
        info.message = '比べる列がないため、重複の削除を使っていません';
        return info;
      }
      const norm = new LQ.Normalizer(LQ.Normalizer.DEFAULT_RULES);
      const seen = new Map();
      const keep = [];
      const removed = [];
      const keptOf = [];
      for (let row = 0; row < n; row++) {
        let key = '';
        for (let i = 0; i < r.cols.length; i++) key += (i ? SEP : '') + norm.text(ds.cell(row, r.cols[i]));
        const first = seen.get(key);
        if (first === undefined) {
          seen.set(key, row);
          keep.push(row);
        } else {
          removed.push(ds.basePos(row));
          keptOf.push(ds.basePos(first));
        }
      }
      if (removed.length) ds.keepRows(keep);
      info.kept = keep.length;
      info.removed = Int32Array.from(removed);
      info.keptOf = Int32Array.from(keptOf);
      return info;
    },

    /** 設定の文章（タグ・根拠用） */
    describe(def) {
      const cols = (def && def.cols) || [];
      return cols.length ? '列「' + cols.join('」「') + '」が同じ行' : 'すべての列が同じ行';
    }
  };

  LQ.Dedup = Dedup;
})(window);

/* =========================================================================
 * ── 処理の流れ ──
 * PrepFlow：読み込みから使う行までの各段の行数（処理の流れの表示に使う）と、段で除いた行の内訳の表
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Util = LQ.Util;

  const ROLE_MARK = { source: '①', condition: '②' };

  const PrepFlow = {
    /** 前処理を使っているか（流れを見せる必要があるか） */
    active(ds) {
      return !!ds && (ds.members.length > 0 || !!ds.unpivotInfo || !!ds.filterInfo || !!ds.dedupInfo);
    },

    /**
     * 各段（読み込み・絞り込み・重複の削除）の行数
     * @returns {Array<{id:string, icon:string, label:string, rows:number, removed?:number, ok?:boolean, title:string}>}
     */
    steps(ds) {
      const out = [];
      const files = ds.fileCount;
      const up = ds.unpivotInfo;
      out.push({ id: 'read', icon: files > 1 ? 'layer-group' : 'file-lines', label: files > 1 ? '読み込み ' + files + ' ファイル' : '読み込み',
        rows: up ? up.base : ds.baseRowCount, title: files > 1 ? '縦に結合した ' + files + ' ファイルの合計' : ds.name });
      if (up) out.push({ id: 'unpivot', icon: 'arrows-turn-to-dots', label: '縦持ち', rows: up.kept, reshape: true, ok: up.ok,
        title: LQ.Unpivot.describe(ds.unpivot) + '（' + up.cols.length + ' 列 → 1 列ずつの行）' + (up.message ? '。' + up.message : '') });
      const fi = ds.filterInfo;
      if (fi) out.push({ id: 'filter', icon: 'filter', label: '絞り込み', rows: fi.kept, removed: fi.base - fi.kept,
        title: '列ごとの絞り込み ' + ds.filters.length + ' 件（すべてを満たす行だけ残す）' });
      const di = ds.dedupInfo;
      if (di) out.push({ id: 'dedup', icon: 'clone', label: '重複の削除', rows: di.kept, removed: di.removed.length, ok: di.ok,
        title: di.ok ? LQ.Dedup.describe(ds.dedup) + 'は最初の行だけを残す' + (di.message ? '（' + di.message + '）' : '') : di.message });
      return out;
    },

    /**
     * 段で除いた行の内訳の表（DrillView に渡す。Exporters の table と同じ形＋ rowAt）
     * @param {LQ.Dataset} ds
     * @param {'filter'|'dedup'} stage
     */
    removedTable(ds, stage) {
      const mark = ROLE_MARK[ds.role] || '';
      const isDedup = stage === 'dedup';
      const info = isDedup ? ds.dedupInfo : ds.filterInfo;
      const list = (info && info.removed) || new Int32Array(0);
      const cols = ds.columns;
      const header = [mark + ' 行番号'].concat(cols.map((c) => c.name));
      if (isDedup) header.splice(1, 0, '残した行（' + mark + ' 行番号）');
      const at = (b) => cols.map((c, ci) => {
        const v = ds.baseCell(b, ci);
        return v === undefined || v === null ? '' : String(v);
      });
      /* 縦に結合しているときは、残した行がどのファイルの行かも添える（行番号はファイルごとのため） */
      const fileCol = ds.fileCount > 1 ? ds.findColumn(ds.union.fileColumn) : -1;
      const keptText = (b) => (fileCol >= 0 ? ds.baseCell(b, fileCol) + ' の ' : '') + ds.baseRowNumber(b) + (fileCol >= 0 ? ' 行目' : '');
      const rowAt = (i) => {
        const b = list[i];
        const head = [String(ds.baseRowNumber(b))];
        if (isDedup) head.push(keptText(info.keptOf[i]));
        return head.concat(at(b));
      };
      return {
        header: header,
        defs: header.map((name) => ({ name: name })),
        rowCount: list.length,
        rowAt: rowAt,
        forEachRow(fn) {
          for (let i = 0; i < list.length; i++) fn(rowAt(i), i);
        }
      };
    },

    /** 流れを 1 行の文章にする（出力の記録・根拠用）：「読み込み 3 ファイル 36,000 行 → 絞り込み −1,200 → …」 */
    text(ds) {
      return PrepFlow.steps(ds).map((s, i) => (i === 0 || s.reshape ? s.label + ' ' + Util.formatInt(s.rows) + ' 行' : s.label + ' −' + Util.formatInt(s.removed))).join(' → ') +
        ' → 使う行 ' + Util.formatInt(ds.rowCount) + ' 行';
    }
  };

  LQ.PrepFlow = PrepFlow;
})(window);
