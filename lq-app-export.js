/* =========================================================================
 * LightQuery - lq-app-export.js
 * 出力の操作：表示中の結果（絞り込み・並べ替え・列）を表にし、Excel・CSV・クリップボードへ出力する。
 *   Excel は「まとめ＋抽出条件ごとのシート」にも分けられる。出力の根拠（抽出条件シート）の行も作る。
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
     * @param {{split?:boolean}} opts split：まとめ＋抽出条件ごとのシートにも分ける（Excel 用）
     * @returns {{view:LQ.ResultView, defs:Array, table:object, sheets:Array|null}|null}
     */
    prepare(opts) {
      const view = this.app.main.resultView();
      if (!view) return null;
      const defs = this._defsOf(view);
      if (!defs.length) return null;
      const out = { view: view, defs: defs, table: view.toTable(defs), sheets: null };
      if (opts && opts.split && view.multi) out.sheets = this._sheets(view);
      return out;
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
      const s = this.state;
      const opts = options || {};
      const prepared = this.prepare({ split: formatId === 'xlsx' && !!opts.split });
      if (!prepared) {
        this.toasts.show({ type: 'warn', title: '出力できる列がありません', message: '出力列パネルで列を選んでください。' });
        return;
      }
      const format = LQ.Exporters.get(formatId);
      s.setBusy({ kind: 'export', label: '出力中…', detail: format.label + 'を作成しています' });
      await Async.paint();
      try {
        const out = await LQ.Exporters.build(formatId, prepared.table, { metaLines: this.metaLines(prepared), protect: !!opts.protect, sheets: prepared.sheets });
        const fileName = Util.sanitizeFileName(opts.fileName) + '.' + format.ext;
        LQ.Exporters.download(out.blob, fileName);
        LQ.Prefs.set('exportFormat', formatId);
        const size = prepared.sheets
          ? 'シート ' + prepared.sheets.length + ' 枚・まとめ ' + fmt(prepared.sheets[0].table.rowCount) + ' 行'
          : fmt(prepared.table.rowCount) + ' 行 × ' + prepared.defs.length + ' 列';
        this.toasts.show({ type: 'success', title: '出力しました', message: fileName + '（' + size + '・' + Util.formatBytes(out.blob.size) + '）' });
        out.warnings.forEach((w) => this.toasts.show({ type: 'warn', title: '文字の置き換えがあります', message: w }));
      } catch (err) {
        this.toasts.show({ type: 'error', title: '出力できませんでした', message: err.message });
      } finally {
        s.setBusy(null);
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
      return ds.name + '（' + parts.join('・') + '）';
    }

    /** 抽出条件 1 件分の根拠の行 */
    _partLines(part, head) {
      const st = part.stats;
      const snap = part.snapshot;
      const join = LQ.QueryEngine.JOIN_KINDS.find((j) => j.id === st.joinKind);
      const match = LQ.QueryEngine.MATCH_MODES.find((m) => m.id === st.matchMode);
      const lines = [];
      if (head) lines.push(['抽出条件', head]);
      if (part.condition) lines.push(['② 条件データ', this._describeDataset(part.condition)]);
      snap.conditions.forEach((text, i) => lines.push([i === 0 ? '条件' : '', text]));
      lines.push(['組み合わせ', snap.exprJa]);
      lines.push(['出力する行', join.label + '（' + join.note + '）']);
      if (st.needsCondition && st.joinKind !== 'anti') lines.push(['複数一致したとき', match.label]);
      if (part.ownRules) lines.push(['照合ルール（個別）', snap.rules]);
      const shadow = part.hits - part.assigned;
      lines.push(['件数', '該当 ' + fmt(part.hits) + ' 行・出力 ' + fmt(part.rows) + ' 行' +
        (shadow > 0 ? '（うち ' + fmt(shadow) + ' 行は優先順位が上の抽出条件に振り分け）' : '')]);
      return lines;
    }

    metaLines(prepared) {
      const s = this.state;
      const view = prepared.view;
      const res = view.result;
      const st = res.stats;
      const multi = view.parts.length > 1;
      const lines = [['項目', '内容'], ['出力日時', Util.dateTimeText(new Date())], ['① 元データ', this._describeDataset(s.datasets.source)]];
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
      if (prepared.sheets) lines.push(['シート', prepared.sheets.map((sh) => sh.name).join('、')]);
      else if (view.filter !== null) lines.push(['出力した範囲', view.filter < 0 ? '該当なしの行のみ' : '抽出条件「' + view.partName(view.filter) + '」の行のみ']);
      if (s.view.sort) lines.push(['並び順', LQ.ResultView.nameOf(s.view.sort.key) + '（' + (s.view.sort.dir === 'desc' ? '降順' : '昇順') + '）']);
      lines.push(['出力した列', prepared.defs.map((d) => d.name).join('、')]);
      if (s.isStale()) lines.push(['注意', '出力時点の画面の条件は、この結果を作った条件から変更されています']);
      lines.push(['作成', 'LightQuery（簡易クエリ）']);
      return lines;
    }
  }

  LQ.ExportActions = ExportActions;
})(window);
