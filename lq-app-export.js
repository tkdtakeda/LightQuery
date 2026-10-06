/* =========================================================================
 * LightQuery - lq-app-export.js
 * 操作：出力の操作（Excel・CSV・クリップボード。出力の根拠の行も作る）
 * ========================================================================= */

/* =========================================================================
 * ── 出力の操作 ──
 * 出力の操作：表示中の結果（絞り込み・並べ替え・列）を表にし、Excel・CSV・クリップボードへ出力する。
 *   Excel は「まとめ＋抽出条件ごとのシート」にも分けられ、「ピボット」シートも付けられる。出力の根拠（抽出条件シート）の行も作る。
 *   ピボットタブを表示中は、ピボットの表を出力する。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Util = LQ.Util;
  const Async = LQ.Async;
  const fmt = Util.formatInt;

  class ExportActions {
    constructor(app) {
      this.app = app;
      this.state = app.state;
      this.toasts = app.toasts;
    }

    _defsOf(view) {
      return view.resolveColumns(this.state.output.columns).filter((d) => d.available);
    }

    /**
     * 出力する表を用意する。
     * @param {{split?:boolean, aggregate?:boolean}} opts split：まとめ＋抽出条件ごとのシートにも分ける（Excel 用）／
     *        aggregate：「ピボット」シートを付ける（Excel 用）
     * @returns {{kind:'result'|'aggregate', view:LQ.ResultView, defs:Array, table:object, sheets:Array|null, aggregate:object|null}|null}
     */
    prepare(opts) {
      const o = opts || {};
      const aggTab = this.app.main.aggregate;
      const agg = aggTab.computed();
      if (this.state.view.tab === 'aggregate' && agg) {
        const table = LQ.Aggregator.toTable(agg);
        return { kind: 'aggregate', view: aggTab.view(), defs: table.defs, table: table, sheets: [{ name: 'ピボット', table: table }], aggregate: agg };
      }
      const view = this.app.main.resultView();
      if (!view) return null;
      const defs = this._defsOf(view);
      if (!defs.length) return null;
      const out = { kind: 'result', view: view, defs: defs, table: view.toTable(defs), sheets: null, aggregate: null };
      if (o.split && view.multi) out.sheets = this._sheets(view);
      if (o.aggregate && agg && aggTab.target() === 'result') {
        out.aggregate = agg;
        out.sheets = (out.sheets || [{ name: '抽出結果', table: out.table }]).concat([{ name: 'ピボット', table: LQ.Aggregator.toTable(agg) }]);
      }
      return out;
    }

    /** 抽出結果に「ピボット」シートを付けられるか（ピボットの対象が抽出結果で、項目が置かれている） */
    hasAggregate() {
      const aggTab = this.app.main.aggregate;
      return aggTab.target() === 'result' && !!aggTab.computed();
    }

    /** まとめ＋抽出条件ごと（優先順位の順）＋該当なし のシート。並び順は画面と同じ */
    _sheets(view) {
      const all = view.derive(null);
      const sheets = [{ name: 'まとめ', table: all.toTable(this._defsOf(all)) }];
      view.parts.forEach((part, i) => {
        const v = view.derive(i);
        const defs = this._defsOf(v);
        if (defs.length) sheets.push({ name: part.priority + '_' + view.partName(i), table: v.toTable(defs) });
      });
      if (view.counts().unmatched) {
        const v = view.derive(-1);
        const defs = this._defsOf(v);
        if (defs.length) sheets.push({ name: '該当なし', table: v.toTable(defs) });
      }
      return sheets;
    }

    /**
     * @param {string} formatId
     * @param {{fileName:string, protect:boolean, split:boolean}} options
     */
    async exportResult(formatId, options) {
      const opts = options || {};
      const xlsx = formatId === 'xlsx';
      const prepared = this.prepare({ split: xlsx && !!opts.split, aggregate: xlsx && !!opts.aggregate });
      if (!prepared) {
        this.toasts.show({ type: 'warn', title: '出力できる列がありません', message: '出力列パネルで列を選んでください。' });
        return;
      }
      const format = LQ.Exporters.get(formatId);
      const progress = this.app.startProgress({ kind: 'export', label: '出力中…', title: '出力しています', detail: format.label + 'を作成しています',
        steps: [{ id: 'build', label: format.label + 'の作成' }] });
      progress.begin('build', false);
      await Async.paint();
      try {
        const out = await LQ.Exporters.build(formatId, prepared.table, { metaLines: this.metaLines(prepared), protect: !!opts.protect, sheets: prepared.sheets });
        const fileName = Util.sanitizeFileName(opts.fileName) + '.' + format.ext;
        LQ.Exporters.download(out.blob, fileName);
        LQ.Prefs.set('exportFormat', formatId);
        const size = prepared.sheets && prepared.sheets.length > 1
          ? 'シート ' + prepared.sheets.length + ' 枚・' + prepared.sheets[0].name + ' ' + fmt(prepared.sheets[0].table.rowCount) + ' 行'
          : fmt(prepared.table.rowCount) + ' 行 × ' + prepared.defs.length + ' 列';
        this.toasts.show({ type: 'success', title: '出力しました', message: fileName + '（' + size + '・' + Util.formatBytes(out.blob.size) + '）' });
        out.warnings.forEach((w) => this.toasts.show({ type: 'warn', title: '文字の置き換えがあります', message: w }));
      } catch (err) {
        this.toasts.show({ type: 'error', title: '出力できませんでした', message: err.message });
      } finally {
        progress.close();
      }
    }

    async copyResult() {
      const prepared = this.prepare();
      if (!prepared) return;
      const text = LQ.Exporters.toClipboardText(prepared.table);
      const ok = await LQ.Exporters.copyText(text);
      if (ok) {
        this.toasts.show({ type: 'success', title: 'クリップボードにコピーしました', message: fmt(prepared.table.rowCount) + ' 行 × ' + prepared.defs.length + ' 列（見出し付き）。Excel に貼り付けられます。' });
      } else {
        this.toasts.show({ type: 'error', title: 'コピーできませんでした', message: 'ブラウザがクリップボードへの書き込みを許可していません。Excel 形式で出力してください。' });
      }
    }

    /** 既定のファイル名（絞り込み中はその抽出条件の名前を入れる） */
    defaultFileName(split) {
      const src = this.state.datasets.source;
      const view = this.app.main.resultView();
      let scope = '抽出結果';
      if (!split && view && view.filter !== null) scope = view.filter < 0 ? '該当なし' : view.partName(view.filter);
      const aggTab = this.app.main.aggregate;
      if (this.state.view.tab === 'aggregate' && aggTab.computed()) {
        scope = aggTab.target() === 'result' ? (view && view.filter !== null ? scope + '_' : '') + 'ピボット' : 'ピボット';
      }
      return Util.sanitizeFileName((src ? Util.baseName(src.name) : 'LightQuery') + '_' + scope + '_' + Util.timestamp());
    }

    _describeDataset(ds) {
      const src = ds.source;
      const parts = [src.storedRef ? '保存データ（元：' + (src.storedRef.kindLabel || '不明') + '）' : src.kindLabel];
      const sheet = src.hasSheets ? src.sheetName : (src.storedRef ? src.storedRef.sheetName : '');
      if (sheet) parts.push('シート「' + sheet + '」');
      if (src.encoding) parts.push(LQ.EncodingDetector.label(src.encoding.value));
      parts.push(ds.settings.hasHeader ? 'ヘッダー ' + ds.settings.headerRow + ' 行目' : 'ヘッダーなし');
      parts.push('範囲 ' + ds.stats.rangeText);
      parts.push(fmt(ds.rowCount) + ' 行');
      const others = ds.fileCount > 1 ? ' ほか ' + (ds.fileCount - 1) + ' ファイルを縦に結合' : '';
      return ds.name + others + '（' + parts.join('・') + '）';
    }

    /** 前処理（縦に結合・絞り込み・重複の削除）を使っていれば、その流れの行 */
    _prepLine(ds, label) {
      return LQ.PrepFlow.active(ds) ? [label, LQ.PrepFlow.text(ds)] : null;
    }

    /** 抽出条件 1 件分の根拠の行 */
    _partLines(part, head) {
      const st = part.stats;
      const snap = part.snapshot;
      const join = LQ.QueryEngine.JOIN_KINDS.find((j) => j.id === st.joinKind);
      const match = LQ.QueryEngine.MATCH_MODES.find((m) => m.id === st.matchMode);
      const lines = [];
      if (head) lines.push(['抽出条件', head]);
      if (part.condition) {
        lines.push(['② 照合表', this._describeDataset(part.condition)]);
        const prep = this._prepLine(part.condition, '② の前処理');
        if (prep) lines.push(prep);
      }
      snap.conditions.forEach((text, i) => lines.push([i === 0 ? '条件' : '', text]));
      lines.push(['組み合わせ', snap.exprJa]);
      lines.push(['出力する行', join.label + '（' + join.note + '）']);
      if (st.needsCondition && st.joinKind !== 'anti') lines.push(['複数一致したとき', match.label]);
      if (part.ownRules) lines.push(['照合ルール（個別）', snap.rules]);
      if (part.condUnmatched) lines.push(['一致しなかった ② の行', fmt(part.condUnmatched.length) + ' 行（② ' + fmt(part.condition.rowCount) + ' 行のうち、① のどの行とも一致しなかった行）']);
      const shadow = part.hits - part.assigned;
      lines.push(['件数', '該当 ' + fmt(part.hits) + ' 行・出力 ' + fmt(part.rows) + ' 行' +
        (shadow > 0 ? '（うち ' + fmt(shadow) + ' 行は優先順位が上の抽出条件に振り分け）' : '')]);
      return lines;
    }

    metaLines(prepared) {
      const s = this.state;
      const view = prepared.view;
      const res = view.result;
      if (res.allRows) return this._allRowsMetaLines(prepared);
      const st = res.stats;
      const multi = view.parts.length > 1;
      const lines = [['項目', '内容'], ['出力日時', Util.dateTimeText(new Date())], ['① 元データ', this._describeDataset(s.datasets.source)]];
      const prep = this._prepLine(s.datasets.source, '① の前処理');
      if (prep) lines.push(prep);
      if (multi) {
        const mode = LQ.BatchRunner.COMBINE_MODES.find((m) => m.id === st.mode);
        lines.push(['重複の扱い', mode.label + '：' + mode.desc]);
      }
      if (st.includeUnmatched) lines.push(['該当なしの行', 'どの抽出条件にも該当しない行も「該当なし」として出力']);
      view.parts.forEach((part, i) => {
        this._partLines(part, multi ? part.priority + ' 位「' + view.partName(i) + '」' : '').forEach((line) => lines.push(line));
      });
      const own = res.snapshot.ownRules || 0;
      if (own < view.parts.length) lines.push([own ? '照合ルール（全体の設定）' : '照合ルール', res.snapshot.rules]);
      lines.push(['結果', '① ' + fmt(st.sourceRows) + ' 行中 ' + fmt(st.matchedSources) + ' 行が該当・出力 ' + fmt(st.outputRows) + ' 行' +
        (st.includeUnmatched ? '（該当なし ' + fmt(st.unmatchedRows) + ' 行を含む）' : '')]);
      if (prepared.aggregate) {
        lines.push(['ピボット', LQ.Aggregator.describe(s.aggregate) + '（対象 ' + fmt(prepared.aggregate.rowCount) + ' 行・表 ' + fmt(prepared.aggregate.groupCount) + ' 行）']);
        prepared.aggregate.notes.forEach((n) => lines.push(['', n]));
      }
      if (prepared.sheets && prepared.sheets.length > 1) lines.push(['シート', prepared.sheets.map((sh) => sh.name).join('、')]);
      else if (view.filter !== null) lines.push(['出力した範囲', view.filter < 0 ? '該当なしの行のみ' : '抽出条件「' + view.partName(view.filter) + '」の行のみ']);
      if (s.view.sort) lines.push(['並び順', LQ.ResultView.nameOf(s.view.sort.key) + '（' + (s.view.sort.dir === 'desc' ? '降順' : '昇順') + '）']);
      lines.push(['出力した列', prepared.defs.map((d) => d.name).join('、')]);
      const cmpLine = this.app.compare.metaLine();
      if (cmpLine) lines.push(cmpLine);
      if (s.isStale()) lines.push(['注意', '出力時点の画面の条件は、この結果を作った条件から変更されています']);
      lines.push(['作成', 'LightQuery（簡易クエリ）']);
      return lines;
    }

    /** ① の全行（抽出なし）でピボットを作ったときの根拠の行 */
    _allRowsMetaLines(prepared) {
      const s = this.state;
      const src = s.datasets.source;
      const agg = prepared.aggregate;
      const lines = [['項目', '内容'], ['出力日時', Util.dateTimeText(new Date())], ['① 元データ', this._describeDataset(src)]];
      const prep = this._prepLine(src, '① の前処理');
      if (prep) lines.push(prep);
      lines.push(['ピボットの対象', '① 元データの全行（② は使わず、抽出なし）']);
      lines.push(['照合ルール', prepared.view.result.snapshot.rules]);
      lines.push(['ピボット', LQ.Aggregator.describe(s.aggregate) + '（対象 ' + fmt(agg.rowCount) + ' 行・表 ' + fmt(agg.groupCount) + ' 行）']);
      agg.notes.forEach((n) => lines.push(['', n]));
      lines.push(['出力した列', prepared.defs.map((d) => d.name).join('、')]);
      lines.push(['作成', 'LightQuery（簡易クエリ）']);
      return lines;
    }
  }

  LQ.ExportActions = ExportActions;
})(window);
