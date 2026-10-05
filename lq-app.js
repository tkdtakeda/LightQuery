/* =========================================================================
 * LightQuery - lq-app.js
 * 操作：出力の操作・抽出条件の操作・組み立てと主要動作
 * （下の区切りごとに独立した部品。読み込み順どおりに並べている）
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
      if (res.allRows) return this._allRowsMetaLines(prepared);
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
      if (prepared.aggregate) {
        lines.push(['ピボット', LQ.Aggregator.describe(s.aggregate) + '（対象 ' + fmt(prepared.aggregate.rowCount) + ' 行・表 ' + fmt(prepared.aggregate.groupCount) + ' 行）']);
        prepared.aggregate.notes.forEach((n) => lines.push(['', n]));
      }
      if (prepared.sheets && prepared.sheets.length > 1) lines.push(['シート', prepared.sheets.map((sh) => sh.name).join('、')]);
      else if (view.filter !== null) lines.push(['出力した範囲', view.filter < 0 ? '該当なしの行のみ' : '抽出条件「' + view.partName(view.filter) + '」の行のみ']);
      if (s.view.sort) lines.push(['並び順', LQ.ResultView.nameOf(s.view.sort.key) + '（' + (s.view.sort.dir === 'desc' ? '降順' : '昇順') + '）']);
      lines.push(['出力した列', prepared.defs.map((d) => d.name).join('、')]);
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
      if (src.filters && src.filters.length) lines.push(['① の絞り込み', fmt(src.baseRowCount) + ' 行中 ' + fmt(src.rowCount) + ' 行（列ごとの絞り込み ' + src.filters.length + ' 件）']);
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

/* =========================================================================
 * ── 抽出条件の操作 ──
 * 抽出条件の操作：選択・追加・複製・削除・優先順位・有効／無効・振り分けの設定・照合ルールの対象、
 *   条件（A・B…）の追加と削除、表（ファイル・シート）からの作成、JSON の書き出し／読み込み、サンプルの読み込み／消去。
 *   消去や置き換えは確認ダイアログではなく、通知の「元に戻す」で取り消せるようにする。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Util = LQ.Util;
  const Async = LQ.Async;

  class ProfileActions {
    constructor(app) {
      this.app = app;
      this.state = app.state;
      this.bus = app.bus;
      this.toasts = app.toasts;
    }

    _undo(snap, title) {
      return [{ label: '元に戻す', icon: 'rotate-left', onClick: () => this.app.restore(snap, title) }];
    }

    _limit() {
      this.toasts.show({ type: 'warn', title: '抽出条件は最大 ' + LQ.Profile.MAX + ' 件です', message: '使わない抽出条件を削除するか、JSON に書き出してから一覧から外してください。' });
    }

    /* =================================================================
     * 一覧
     * ================================================================= */

    select(id) {
      this.state.setActive(id);
      this.state.openPanel('query');
    }

    /** 空の抽出条件を一覧の最後（最も低い優先順位）に追加し、名前の入力へ進む */
    add() {
      const s = this.state;
      if (!s.profiles.canAdd()) {
        this._limit();
        return null;
      }
      const p = s.addProfile({ name: s.profiles.defaultName() });
      s.openPanel('query');
      this.bus.emit('focus-profile-name', { id: p.id });
      return p;
    }

    /** 複製して元のすぐ下に入れる */
    duplicate(id) {
      const s = this.state;
      const p = s.profiles.find(id);
      if (!p) return;
      if (!s.profiles.canAdd()) {
        this._limit();
        return;
      }
      const copy = p.duplicate();
      copy.name = p.name + ' のコピー';
      s.addProfile(copy, s.profiles.indexOf(id) + 1);
      s.openPanel('query');
      this.toasts.show({
        type: 'success',
        title: '「' + p.name + '」を複製しました',
        message: '「' + copy.name + '」を ' + s.profiles.rank(copy.id) + ' 位（元のすぐ下）に入れました。' + (p.isSample ? 'サンプルの複製は、自分の抽出条件として保存されます。' : '')
      });
    }

    remove(id) {
      const s = this.state;
      const snap = s.snapshot();
      const removed = s.removeProfile(id);
      if (!removed) return;
      this.toasts.show({
        type: 'info',
        title: '抽出条件「' + removed.name + '」を削除しました',
        message: '残りは ' + s.profiles.length + ' 件です。',
        actions: this._undo(snap, '抽出条件「' + removed.name + '」を元に戻しました')
      });
    }

    /** @returns {boolean} 動いたか */
    moveTo(id, index) {
      return this.state.moveProfile(id, index);
    }

    moveBy(id, delta) {
      return this.state.moveProfileBy(id, delta);
    }

    setEnabled(id, enabled) {
      this.state.setProfileEnabled(id, enabled);
    }

    setCombine(patch) {
      this.state.setCombine(patch);
    }

    /**
     * 照合ルールの対象を切り替える。own：今の全体の設定を写して、この抽出条件だけの設定にする /
     * global：個別の設定を外して全体の設定を使う（元に戻せる）
     */
    setRulesScope(id, scope) {
      const s = this.state;
      const p = s.profiles.find(id);
      if (!p || (scope === 'own') === !!p.rules) return;
      const snap = s.snapshot();
      const undo = this._undo(snap, '「' + p.name + '」の照合ルールを元に戻しました');
      if (scope === 'own') {
        s.setProfileRules(id, s.rules);
        this.toasts.show({ type: 'success', title: '「' + p.name + '」だけの照合ルールにしました',
          message: '今の全体の設定を写しました。ここで変えた項目は、この抽出条件だけに使います。', actions: undo });
        return;
      }
      const own = p.rules;
      const same = LQ.Normalizer.sameRules(own, s.rules);
      s.setProfileRules(id, null);
      this.toasts.show({ type: 'success', title: '「' + p.name + '」は全体の設定で比べます',
        message: same ? '個別の設定は全体の設定と同じでした。' : '外した個別の設定：' + new LQ.Normalizer(own).describe(), actions: undo });
    }

    /* =================================================================
     * 条件（選択中の抽出条件）
     * ================================================================= */

    addCondition(init) {
      const s = this.state;
      if (!s.canAddCondition()) {
        this.toasts.show({ type: 'warn', title: '条件は最大 ' + LQ.AppState.MAX_CONDITIONS + ' 件です', message: '不要な条件を削除してから追加してください。' });
        return null;
      }
      const base = init || { right: { type: s.datasets.condition ? 'column' : 'value' } };
      const c = s.addCondition(base);
      this.bus.emit('focus-condition', { id: c.id, field: base.left ? 'right' : 'left' });
      return c;
    }

    /** ① と ② で同じ名前の列を「完全一致」の条件としてまとめて追加 */
    addSameNameConditions(names) {
      const s = this.state;
      const added = [];
      names.forEach((name) => {
        if (!s.canAddCondition()) return;
        added.push(s.addCondition({ left: name, op: 'eq', right: { type: 'column', col: name } }).label);
      });
      if (added.length) this.toasts.show({ type: 'success', title: '条件 ' + added.join('・') + ' を追加しました', message: '同じ名前の列を「完全一致」で対応付けました。' });
    }

    removeCondition(id) {
      const s = this.state;
      const snap = s.snapshot();
      const removed = s.removeCondition(id);
      if (!removed) return;
      this.toasts.show({
        type: 'info',
        title: '条件 ' + removed.label + ' を削除しました',
        message: LQ.QueryEngine.describeCondition(removed),
        actions: this._undo(snap, '条件 ' + removed.label + ' を元に戻しました')
      });
    }

    /** 否定の条件だけのとき：「含む／一致」＋「一致しなかった行」に切り替える（NG リストの使い方） */
    convertToExclusion() {
      const s = this.state;
      const snap = s.snapshot();
      s.query.conditions.forEach((c) => {
        const op = LQ.Operators.get(c.op);
        if (op && op.negative && op.positive) s.updateCondition(c.id, { op: op.positive });
      });
      s.setJoinKind('anti');
      this.toasts.show({
        type: 'success',
        title: '除外リストの設定に切り替えました',
        message: '比較方法を「含む／完全一致」にし、出力する行を「一致しなかった行」にしました。',
        actions: this._undo(snap, '切り替える前に戻しました')
      });
    }

    /* =================================================================
     * 表（ファイル・シート）から作る
     * ================================================================= */

    /** 条件データ（表）を選んで一覧の最後に加える（② のタブ・パネルから）。上限に達していればファイルを選ぶ前に知らせる */
    addTables() {
      const s = this.state;
      if (!s.activeProfile.isBlank() && !s.profiles.canAdd()) {
        this._limit();
        return;
      }
      this.app.pickFile('append');
    }

    /**
     * 選んだ表ごとに抽出条件を作る。選択中が空の抽出条件なら 1 件目はそこに入れ、
     * 残りは選択中の下（append のときは一覧の最後）に並べる。
     * @param {Array<{dataset:LQ.Dataset, name:string}>} tables
     * @param {{append?:boolean}} opts append：② のタブ・パネルの「条件データを追加」から（画面はそのまま、追加した表を表示する）
     */
    createFromTables(tables, opts) {
      const s = this.state;
      const append = !!(opts && opts.append);
      if (!tables.length) return;
      const snap = s.snapshot();
      const active = s.activeProfile;
      const rest = tables.slice();
      const made = [];
      if (active.isBlank()) {
        const t = rest.shift();
        s.setProfileCondition(active.id, t.dataset);
        s.renameProfile(active.id, t.name);
        made.push(active);
      }
      const created = rest.map((t) => {
        const p = new LQ.Profile({ name: t.name });
        p.setCondition(t.dataset);
        return p;
      });
      const at = append ? s.profiles.length : s.profiles.indexOf(active.id) + 1;
      const added = created.length ? s.insertProfiles(created, at, !made.length) : [];
      added.forEach((p) => made.push(p));
      const skipped = created.length - added.length;
      if (!made.length) {
        this._limit();
        return;
      }
      const list = made.map((p) => '「' + p.name + '」（' + s.profiles.rank(p.id) + ' 位）').join('・');
      const limit = skipped ? '上限（' + LQ.Profile.MAX + ' 件）のため ' + skipped + ' 件は作れませんでした。' : '';
      const undo = this._undo(snap, (append ? '条件データを追加する' : '表から作る') + '前の一覧に戻しました');
      if (append) {
        s.setTab('condition');
        this.toasts.show({
          type: 'success',
          title: '条件データを ' + made.length + ' 件追加しました',
          message: list + '。「条件を設定」で、① のどの列と比べるかを決めてください。' + limit,
          actions: [{ label: '条件を設定', icon: 'filter', primary: true, onClick: () => s.openPanel('query') }].concat(undo)
        });
        return;
      }
      s.openPanel('query');
      this.toasts.show({
        type: 'success',
        title: '抽出条件を ' + made.length + ' 件用意しました',
        message: list + '。一覧で 1 件ずつ選び、① のどの列と比べるか（条件）を設定してください。' + limit,
        actions: undo
      });
    }

    /* =================================================================
     * JSON の書き出し・読み込み
     * ================================================================= */

    defaultJsonName(scope, profile) {
      return scope === 'all'
        ? 'LightQuery_抽出条件一式_' + Util.timestamp()
        : 'LightQuery_抽出条件_' + Util.sanitizeFileName(profile.name) + '_' + Util.timestamp();
    }

    /** @param {{scope:'one'|'all', id?:string, withData:boolean, fileName:string}} opts */
    exportJson(opts) {
      const s = this.state;
      let obj;
      let count = 1;
      if (opts.scope === 'all') {
        obj = LQ.Bundle.exportLibrary(s, opts.withData);
        count = s.profiles.length;
      } else {
        const p = s.profiles.find(opts.id) || s.activeProfile;
        obj = LQ.Bundle.exportProfile(p, s.profiles.rank(p.id), opts.withData, s.rules);
      }
      const blob = new Blob([LQ.Bundle.stringify(obj)], { type: 'application/json' });
      const name = Util.sanitizeFileName(opts.fileName) + '.json';
      LQ.Exporters.download(blob, name);
      this.toasts.show({
        type: 'success',
        title: '抽出条件を書き出しました',
        message: name + '（' + count + ' 件・' + (opts.withData ? '② のデータを含む' : '② はファイル名のみ') + '・' + Util.formatBytes(blob.size) +
          '）。「読込」またはドラッグ＆ドロップで再利用できます。'
      });
    }

    async importJsonFile(file) {
      if (this.app._blockedByBusy()) return;
      let obj;
      try {
        obj = JSON.parse(await file.text());
      } catch (err) {
        this.toasts.show({ type: 'error', title: '抽出条件を読み込めませんでした', message: file.name + ' は JSON 形式ではありません。' });
        return;
      }
      let bundle;
      try {
        bundle = LQ.Bundle.parse(obj, file.name);
      } catch (err) {
        this.toasts.show({ type: 'error', title: '抽出条件を読み込めませんでした', message: file.name + '：' + err.message });
        return;
      }
      const ws = this.app.worksets;
      const canNewSet = bundle.kind === 'library' && !!ws && ws.available;
      if (bundle.kind === 'library' && !this._ownListIsBlank()) {
        this.app.profileDialogs.openImportChoice({ fileName: file.name, count: bundle.profiles.length, canNewSet: canNewSet },
          (mode) => (mode === 'newSet' ? ws.importAsNew(bundle, file.name, obj.worksetName) : this.applyBundle(bundle, mode, file.name)));
        return;
      }
      this.applyBundle(bundle, bundle.kind === 'library' ? 'replace' : 'add', file.name);
    }

    /** 自分の抽出条件が空（追加したままのものだけ）か */
    _ownListIsBlank() {
      return this.state.userProfiles().every((p) => p.isBlank());
    }

    /**
     * 読み込んだ抽出条件を適用する。サンプル表示中ならサンプルを閉じてから適用する。
     * 一式（旧形式を含む）で置き換えるときは、全体の照合ルール・振り分け・出力列・表示件数・① の読み込み範囲もファイルの内容にする。
     * それ以外（追加・1 件のファイル）は今の設定を変えず、ファイルの全体の照合ルールが今と違えば、
     * それを使っていた抽出条件に個別の設定として付ける（書き出し元と同じ結果になるように）。
     * @param {object} bundle LQ.Bundle.parse の結果
     * @param {'replace'|'add'} mode
     */
    applyBundle(bundle, mode, fileName) {
      const s = this.state;
      const snap = s.snapshot();
      const leftSample = !!s.sampleStash || s.profiles.items.some((p) => p.isSample);
      if (leftSample) s.exitSample();
      const replace = mode === 'replace' || this._ownListIsBlank();
      let added = bundle.profiles;
      if (replace) s.replaceProfiles(bundle.profiles, bundle.profiles[0].id);
      else added = s.insertProfiles(bundle.profiles, s.profiles.length, true);
      const whole = replace && bundle.kind !== 'profile';
      if (whole) {
        if (bundle.rules) s.setRules(bundle.rules);
        if (bundle.combine) s.setCombine(bundle.combine);
        if (bundle.output) s.importOutputColumns(bundle.output.columns);
        if (bundle.derived) ['source', 'condition'].forEach((role) => s.setDerived(role, bundle.derived[role]));
        if (bundle.aggregate) s.setAggregate(bundle.aggregate);
        if (bundle.view) s.setPageSize(bundle.view.pageSize);
      }
      const adopted = whole ? 0 : this._adoptRules(added, bundle.rules);
      const readApplied = whole && bundle.read ? this._applySourceRead(bundle.read.source) : false;
      s.openPanel('query');
      const missing = added.filter((p) => !p.condition && p.conditionRef && p.conditionRef.fileName).length;
      const skipped = bundle.skipped + (bundle.profiles.length - added.length);
      const notes = [];
      if (missing) notes.push('② のデータが入っていない ' + missing + ' 件は、使う前に ② を読み込んでください（前回のファイル名を表示しています）');
      if (adopted) notes.push('ファイルの照合ルールが今の全体の設定と違うため、' + adopted + ' 件には個別の照合ルールとして付けました');
      if (readApplied) notes.push('① の読み込み範囲も適用しました');
      if (skipped) notes.push('上限（' + LQ.Profile.MAX + ' 件）のため ' + skipped + ' 件は読み込みませんでした');
      if (leftSample) notes.push('サンプルは閉じました');
      this.toasts.show({
        type: 'success',
        title: '抽出条件を ' + added.length + ' 件読み込みました' + (replace ? '' : '（一覧の後ろに追加）'),
        message: fileName + (notes.length ? '。' + notes.join('。') + '。' : ''),
        actions: this._undo(snap, '読み込む前の抽出条件に戻しました')
      });
    }

    /**
     * 書き出し元の全体の照合ルールが今の全体の設定と違うとき、それを使っていた抽出条件に個別の設定として付ける。
     * @returns {number} 付けた件数
     */
    _adoptRules(list, rules) {
      const s = this.state;
      if (!rules || LQ.Normalizer.sameRules(rules, s.rules)) return 0;
      let count = 0;
      list.forEach((p) => {
        if (p.rules) return;
        s.setProfileRules(p.id, rules);
        count++;
      });
      return count;
    }

    /** 一括・旧形式の JSON に入っている ① の読み込み範囲を、読み込み済みの ① に適用する */
    _applySourceRead(read) {
      const s = this.state;
      const ds = s.datasets.source;
      if (!ds || ds.isSample || !read || (!read.settings && !read.choices)) return false;
      try {
        if (ds.source.applyChoices(read.choices)) ds.reload(read.settings);
        else if (read.settings) ds.applySettings(LQ.Dataset.normalizeSettings(read.settings));
      } catch (err) {
        return false;
      }
      s.datasetChanged('source');
      return true;
    }

    /* =================================================================
     * サンプル
     * ================================================================= */

    async loadSample(id) {
      const s = this.state;
      if (this.app._blockedByBusy()) return;
      const snap = s.snapshot();
      const hadStash = !!s.sampleStash;
      const progress = this.app.startProgress({ kind: 'read', label: '準備中…', title: 'サンプルを準備しています', detail: 'サンプルデータを作成しています',
        steps: [{ id: 'build', label: 'サンプルデータの作成' }] });
      progress.begin('build', false);
      await Async.paint();
      let built = null;
      try {
        built = LQ.Samples.build(id);
        const make = (role, spec) => new LQ.Dataset(role, LQ.SourceFile.fromGrid(spec.grid, spec.name, 'sample'), { isSample: true, settings: spec.settings || null });
        const profiles = built.profiles.map((spec) => {
          const p = new LQ.Profile({ name: spec.name, origin: 'sample', query: LQ.QueryOps.fromPlain(spec.query), rules: spec.rules || null });
          if (spec.condition) p.setCondition(make('condition', spec.condition));
          return p;
        });
        s.enterSample(make('source', built.source), profiles, built.combine || null);
        const derived = built.derived || (s.sampleStash && s.sampleStash.derived) || s.derived;
        ['source', 'condition'].forEach((role) => s.setDerived(role, derived[role] || []));
        s.applyOutputPreset(built.output);
        s.setAggregate(built.aggregate || (s.sampleStash ? s.sampleStash.aggregate : s.aggregate));
        s.setTab(built.tab || 'result');
      } catch (err) {
        built = null;
        this.toasts.show({ type: 'error', title: 'サンプルを読み込めませんでした', message: err.message });
      } finally {
        progress.close();
      }
      if (!built) return;
      const stashed = !hadStash && s.sampleStash ? s.sampleStash.profiles.filter((p) => !p.isBlank()).length : 0;
      this.toasts.show({
        type: 'success',
        title: 'サンプル「' + built.title + '」を読み込みました',
        message: '右上の「' + this.app.cta().label + '」で結果を確認できます。' +
          (stashed ? '自分の抽出条件 ' + stashed + ' 件は退避しました（「サンプルデータのみクリア」で戻ります）。' : ''),
        actions: this._undo(snap, 'サンプルを読み込む前に戻しました')
      });
    }

    /** サンプルの ①・② と抽出条件だけを消し、退避していた自分の ① と抽出条件に戻す */
    clearSamples() {
      const s = this.state;
      if (!s.hasSample() || this.app._blockedByBusy()) return;
      const snap = s.snapshot();
      const back = s.sampleStash ? s.sampleStash.profiles.filter((p) => !p.isBlank()).length : 0;
      s.exitSample();
      this.toasts.show({
        type: 'info',
        title: 'サンプルデータを消去しました',
        message: 'サンプルの ①・② と抽出条件を消去しました。' +
          (back ? '退避していた自分の抽出条件 ' + back + ' 件を戻しました。' : '自分で読み込んだデータと抽出条件は残っています。'),
        actions: this._undo(snap, 'サンプルデータを元に戻しました')
      });
    }
  }

  LQ.ProfileActions = ProfileActions;
})(window);

/* =========================================================================
 * ── 組み立てと主要動作 ──
 * アプリ本体（組み立て役）：状態・エンジン・画面部品をつなぎ、利用者の操作（アクション）を実行する。
 *   ・主要動作（CTA）は cta() が「次にすることを 1 つだけ」決める
 *   ・消去や置き換えは確認ダイアログではなく「元に戻す」を通知に付ける
 *   ・抽出条件の操作は ProfileActions（app.profiles）、出力は ExportActions（app.exporter）が受け持つ
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Util = LQ.Util;
  const Dom = LQ.Dom;
  const Async = LQ.Async;
  const fmt = Util.formatInt;

  const ROLE_LABEL = { source: '① 元データ', condition: '② 条件データ' };
  /* 読み込みの最後の段階（読み込んだ表を画面の表にする。割合は測れない） */
  const TABLE_STEP = { id: 'table', label: '表の準備', weight: 1 };
  const FILE_ACCEPT = '.xlsx,.xlsm,.xls,.xlsb,.ods,.csv,.tsv,.txt';
  const RE_GENERIC_SHEET = /^(sheet|シート)\s*\d+$/i;

  class App {
    constructor() {
      this.bus = new LQ.EventBus();
      this.state = new LQ.AppState(this.bus);
      this.engine = new LQ.QueryEngine();
      this.batch = new LQ.BatchRunner(this.engine);
      this.toasts = new LQ.ToastHost(Dom.qs('#lqToasts'));
      this.popovers = new LQ.PopoverHost(Dom.qs('#lqPopovers'));
      this.store = new LQ.ProfileStore(this.state, this.bus);
      this.profiles = new LQ.ProfileActions(this);
      this.exporter = new LQ.ExportActions(this);
      this._token = null;
      this._validations = new Map();
      this._tabBeforePanel = null;
      this.ctx = { app: this, state: this.state, bus: this.bus, engine: this.engine, toasts: this.toasts, popovers: this.popovers };
    }

    start() {
      const ctx = this.ctx;
      const restored = this.store.restore();
      /* 保存してある ② には、記憶した絞り込みを掛け直す（タグと「絞り込み中」の表示で分かる） */
      this.state.profiles.items.forEach((p) => {
        if (p.condition && !p.condition.isSample) LQ.LoadMemory.applyFilters(LQ.LoadMemory.keyOf('condition', p.id), p.condition);
      });
      this.dialogs = new LQ.Dialogs(ctx);
      this.resultDialogs = new LQ.ResultDialogs(ctx);
      this.profileDialogs = new LQ.ProfileDialogs(ctx);
      this.manual = new LQ.ManualModal(ctx);
      this.columnMenu = new LQ.ColumnMenu(ctx);
      this.resultColumnMenu = new LQ.ResultColumnMenu(ctx);
      this.panels = {
        source: new LQ.DatasetPanel(ctx, 'source'),
        condition: new LQ.DatasetPanel(ctx, 'condition'),
        query: new LQ.QueryPanel(ctx),
        rules: new LQ.RulesPanel(ctx),
        output: new LQ.OutputPanel(ctx),
        aggregate: new LQ.AggregatePanel(ctx)
      };
      this.main = new LQ.MainView(ctx);
      this.progressCard = new LQ.ProgressCard(ctx, Dom.qs('#lqMain'));
      this.shell = new LQ.Shell(ctx, this.panels);
      this.worksets = new LQ.Worksets(this);
      this.worksetButton = new LQ.WorksetButton(ctx, Dom.qs('#lqTopbar'), this.worksets);
      this.worksets.init(restored);
      this.store.attach((notice) => this.toasts.show(notice));
      this.bus.on('panel', () => this._syncPanelView());
      LQ.ExcelLibrary.subscribe(() => this.bus.emit('change', { topic: 'library' }));
      LQ.ExcelLibrary.ensure().catch(() => {});
      this.bus.emit('change', { topic: 'start' });
      if (restored) this._announceRestore(restored);
      if (this.manual.shouldAutoOpen()) this.manual.open();
    }

    _announceRestore(r) {
      this.toasts.show({
        type: r.missing ? 'info' : 'success',
        title: '前回の抽出条件 ' + r.count + ' 件を復元しました',
        message: r.missing
          ? '② のデータを保存していない ' + r.missing + ' 件は、使う前に ② を読み込んでください（一覧に前回のファイル名を表示しています）。'
          : 'ブラウザに自動保存されています。① 元データを読み込めば、そのまま抽出できます。'
      });
    }

    /* =================================================================
     * 検証と主要動作（CTA）
     * ================================================================= */

    /** 抽出条件 1 件の検証（① / ② の版と条件が同じなら前回の結果を使う） */
    validationOf(profile) {
      const src = this.state.datasets.source;
      const cond = profile.condition;
      const key = (src ? src.id + ':' + src.version : '') + '|' + (cond ? cond.id + ':' + cond.version : '') + '|' + LQ.QueryOps.signature(profile.query);
      const hit = this._validations.get(profile.id);
      if (hit && hit.key === key) return hit.value;
      const value = this.engine.validate(profile.query, src, cond);
      this._validations.set(profile.id, { key: key, value: value });
      return value;
    }

    /** 選択中の抽出条件の検証（条件パネル用） */
    validation() {
      return this.validationOf(this.state.activeProfile);
    }

    /** 有効な抽出条件すべての検証（優先順位の順に最初の不備を返す） */
    validationAll() {
      const enabled = this.state.profiles.enabled();
      let first = null;
      let errorCount = 0;
      enabled.forEach((p) => {
        const v = this.validationOf(p);
        errorCount += v.errors.length;
        if (!first && !v.ok) first = { profile: p, issue: v.errors[0] };
      });
      return { ok: enabled.length > 0 && !first, enabledCount: enabled.length, first: first, errorCount: errorCount };
    }

    /** 次にすることを 1 つだけ返す（ラベルに件数を含める）。target は先に選択する抽出条件 */
    cta() {
      const s = this.state;
      const busy = s.busy;
      if (busy) {
        const status = { kind: 'info', text: busy.title + '… ' + Util.formatPercent(busy.ratio || 0, 0) + (busy.step && busy.steps.length > 1 ? '（' + busy.step.label + '）' : '') };
        if (busy.cancellable) return { id: 'cancel', label: '中止する', icon: 'stop', variant: 'stop', progress: busy.ratio || 0, status: status };
        return { id: 'busy', label: busy.label, icon: 'spinner', spin: true, disabled: true, progress: busy.ratio || 0, status: status };
      }
      const src = s.datasets.source;
      if (!src) {
        const last = this.worksets ? this.worksets.lastSourceName() : '';
        return { id: 'loadSource', label: '① 元データを読み込む', icon: 'file-import',
          status: { kind: 'info', text: last ? 'このセットは前回「' + last + '」を使いました' : 'ドラッグ＆ドロップや Ctrl+V の貼り付けでも読み込めます' } };
      }
      const aggCta = this._sourceAggregateCta();
      if (aggCta) return aggCta;
      const all = this.validationAll();
      if (!all.enabledCount) {
        return { id: 'review', label: '抽出条件を有効にする', icon: 'toggle-on', status: { kind: 'warn', text: 'すべての抽出条件が無効です。一覧のスイッチで有効にしてください' } };
      }
      if (!all.ok) return this._fixCta(all.first.profile, all.first.issue);
      const rows = fmt(src.rowCount);
      if (!s.result || s.isStale()) {
        const rerun = !!s.result;
        return { id: 'run', label: rows + ' 行から' + (rerun ? '再抽出する' : '抽出する'), icon: rerun ? 'arrows-rotate' : 'play',
          status: rerun ? { kind: 'warn', text: '条件が変わりました（結果は未反映）' } : { kind: 'info', text: this._runSummary() } };
      }
      if (s.result.length === 0) return { id: 'review', label: '条件を見直す', icon: 'sliders', status: { kind: 'warn', text: '一致する行はありませんでした' } };
      const agg = s.view.tab === 'aggregate' && this.main ? this.main.aggregate.computed() : null;
      if (agg) {
        return { id: 'export', label: 'ピボット（' + fmt(agg.groupCount) + ' 行）を出力する', icon: 'file-export',
          status: { kind: 'ok', text: 'ピボットの表を Excel・CSV・コピーで出力できます' } };
      }
      if (!this._hasOutputColumn()) {
        return { id: 'chooseColumns', label: '出力する列を選ぶ', icon: 'table-columns', status: { kind: 'warn', text: '出力できる列が 0 列のため出力できません（左の「出力列」で選びます）' } };
      }
      return this._exportCta();
    }

    /** ピボットタブで ① の全行を使っているときの CTA（② を使わない流れ。ピボットの設定 → 出力） */
    _sourceAggregateCta() {
      const s = this.state;
      const aggTab = this.main ? this.main.aggregate : null;
      if (s.view.tab !== 'aggregate' || !aggTab || aggTab.target() !== 'source') return null;
      const c = aggTab.computed();
      if (c) {
        return { id: 'export', label: 'ピボット（' + fmt(c.groupCount) + ' 行）を出力する', icon: 'file-export',
          status: { kind: 'ok', text: '① 元データの全行（' + fmt(c.rowCount) + ' 行）のピボットを Excel・CSV・コピーで出力できます' } };
      }
      if (aggTab.pending) return { id: 'busy', label: '計算中…', icon: 'spinner', spin: true, disabled: true, status: { kind: 'info', text: 'ピボットを計算しています' } };
      /* ピボットの設定を開いているときは押しても何も起きないため、押せない状態にして次にすることを示す */
      const open = s.panel === 'aggregate';
      if (LQ.PivotSettings.usesCondRow(s.aggregate)) {
        return { id: 'setupAggregate', label: 'ピボットを設定する', icon: 'table-cells', disabled: open,
          status: { kind: 'warn', text: '「② の行」は ① の全行では使えません（行から外すか、抽出してから作ります）' } };
      }
      return { id: 'setupAggregate', label: 'ピボットを設定する', icon: 'table-cells', disabled: open,
        status: { kind: 'info', text: open ? '左の「ピボット」で項目を押すと表に入ります（② は不要です）'
          : '② を使わずに ① 元データの全行でピボットを作れます（行・列・値を選びます）' } };
    }

    /** 出力の CTA：件数は出力ダイアログと同じ数え方（表示中の行）にし、内訳を状態の文に入れる */
    _exportCta() {
      const s = this.state;
      const view = this.main ? this.main.resultView() : null;
      if (!view) {
        return { id: 'export', label: fmt(s.result.length) + ' 行を出力する', icon: 'file-export', status: { kind: 'ok', text: 'Excel・CSV・コピーで出力できます' } };
      }
      if (view.filter !== null && !view.length) {
        return { id: 'showAll', label: 'すべての行を表示する', icon: 'list',
          status: { kind: 'warn', text: '「' + view.partName(view.filter) + '」の行は 0 行のため出力できません' } };
      }
      let text = 'Excel・CSV・コピーで出力できます';
      if (view.filter !== null) {
        text = '表示中の「' + view.partName(view.filter) + '」の行だけを出力します（全 ' + fmt(view.counts().total) + ' 行は「すべて」を選びます）';
      } else if (view.multi && view.counts().unmatched) {
        const c = view.counts();
        text = '抽出条件の行 ' + fmt(c.total - c.unmatched) + ' 行＋該当なし ' + fmt(c.unmatched) + ' 行を出力します';
      }
      return { id: 'export', label: fmt(view.length) + ' 行を出力する', icon: 'file-export', status: { kind: 'ok', text: text } };
    }

    /** 表示・出力できる列が 1 列以上あるか */
    _hasOutputColumn() {
      const view = this.main ? this.main.resultView() : null;
      return !view || view.resolveColumns(this.state.output.columns).some((d) => d.available);
    }

    /** 不備のある抽出条件を直すための CTA（抽出条件が複数なら名前を添える） */
    _fixCta(p, e) {
      const multi = this.state.profiles.length > 1;
      const of = multi ? '「' + p.name + '」の' : '';
      const ref = p.conditionRef && p.conditionRef.fileName;
      if (e.code === 'noConditionData' || (e.code === 'noCondition' && !p.condition)) {
        return { id: 'loadCondition', target: p.id, label: (of ? of + ' ' : '') + '② 条件データを読み込む', icon: 'file-import',
          status: { kind: e.code === 'noCondition' ? 'info' : 'warn',
            text: ref ? '前回は「' + ref + '」を使っていました（同じファイルなら読み込み範囲も前回どおり）' : '固定値だけの条件なら ② は不要です（左の「抽出条件」）' } };
      }
      if (e.code === 'noCondition') {
        return { id: 'addCondition', target: p.id, label: (multi ? '「' + p.name + '」に' : '') + '条件を追加する', icon: 'plus',
          status: { kind: 'info', text: '① のどの列を ② のどの列と比べるかを決めます' } };
      }
      const c = e.condId ? p.query.conditions.find((k) => k.id === e.condId) : null;
      return { id: 'fixCondition', target: p.id, label: e.code === 'expr' ? of + '式を修正する' : of + '条件 ' + (c ? c.label : '') + ' を設定する',
        icon: 'pen', issue: e, status: { kind: 'warn', text: (multi ? '「' + p.name + '」：' : '') + e.message } };
    }

    _runSummary() {
      const s = this.state;
      const enabled = s.profiles.enabled();
      if (s.profiles.length === 1) {
        const v = this.validationOf(enabled[0]);
        return '条件 ' + LQ.Logic.labelsIn(v.ast).length + ' 件：' + LQ.Logic.toJapanese(v.ast);
      }
      const mode = LQ.BatchRunner.COMBINE_MODES.find((m) => m.id === s.combine.mode);
      return '抽出条件 ' + enabled.length + ' 件（' + mode.short + '）：' + enabled.map((p) => p.name).join(' → ');
    }

    runCta(anchor) {
      const c = this.cta();
      if (c.target) this.state.setActive(c.target);
      switch (c.id) {
        case 'cancel': this.cancel(); break;
        case 'loadSource': this.pickFile('source'); break;
        case 'loadCondition': this.pickFile('condition'); break;
        case 'addCondition':
          this.state.openPanel('query');
          this.profiles.addCondition();
          break;
        case 'fixCondition':
          this.state.openPanel('query');
          this.bus.emit('focus-issue', c.issue);
          break;
        case 'run': this.run(); break;
        case 'review': this.state.openPanel('query'); break;
        case 'chooseColumns': this.state.openPanel('output'); break;
        case 'showAll': this.state.setFilter(null); break;
        case 'setupAggregate': this.state.openPanel('aggregate'); break;
        case 'export': this.resultDialogs.openExport(anchor); break;
        default: break;
      }
    }

    /**
     * 進み具合を作り、変わるたびに状態（busy）へ反映する。終わったら呼び出し側で progress.close() にする。
     * @param {object} spec LQ.Progress の spec
     * @returns {LQ.Progress}
     */
    startProgress(spec) {
      return new LQ.Progress(spec, (snap) => this.state.setBusy(snap));
    }

    /** 処理中は、結果とデータの対応が崩れる操作を止めて理由を知らせる */
    _blockedByBusy() {
      if (!this.state.busy) return false;
      this.toasts.show({ type: 'warn', title: '処理中のため操作できません', message: '完了するまで待つか、右上の「中止する」で止めてから操作してください。' });
      return true;
    }

    /** ライブラリ等の英語のエラーを、次の行動が分かる日本語にする */
    _friendlyError(err) {
      const msg = String((err && err.message) || err || '');
      if (/password|encrypt/i.test(msg)) return 'パスワード付き（暗号化された）ファイルは読み込めません。Excel でパスワードを解除して保存し直してください。';
      if (/unsupported|corrupt|invalid|zip|signature|cfb/i.test(msg)) return 'ファイルの形式を読み取れませんでした（破損しているか、対応していない形式です）。Excel で開いて .xlsx か CSV で保存し直してください。';
      return msg;
    }

    /* =================================================================
     * 読み込み
     * ================================================================= */

    /**
     * role：'source'（①）/ 'condition'（選択中の抽出条件の ②・複数可）/ 'tables'（表ごとに抽出条件を作る）/
     *       'append'（条件データを一覧の最後に追加する）/ 'settings'（JSON）
     */
    pickFile(role) {
      const isJson = role === 'settings';
      const TABLE_MODE = { condition: 'active', tables: 'new', append: 'append' };
      Dom.qsa('input.lq-filepick').forEach((el) => el.remove());
      const input = Dom.h('input', {
        type: 'file', class: 'lq-filepick lq-offscreen', tabindex: '-1', 'aria-hidden': 'true',
        accept: isJson ? '.json' : FILE_ACCEPT, multiple: !!TABLE_MODE[role]
      });
      input.addEventListener('change', () => {
        const files = Array.from(input.files || []);
        input.remove();
        if (!files.length) return;
        if (isJson) this.profiles.importJsonFile(files[0]);
        else if (role === 'source') this.loadFile('source', files[0]);
        else this.loadTables(files, TABLE_MODE[role]);
      });
      input.addEventListener('cancel', () => input.remove());
      /* 選択画面を開いている間に要素が片付けられて選択が届かないことがないよう、文書に置いてから開く */
      document.body.appendChild(input);
      input.click();
    }

    async loadFile(role, file) {
      if (role === 'condition') {
        this.loadTables([file], 'active');
        return;
      }
      if (this._blockedByBusy()) return;
      if (Util.extName(file.name) === 'json') {
        this.profiles.importJsonFile(file);
        return;
      }
      const progress = this.startProgress({ kind: 'read', label: '読み込み中…', title: ROLE_LABEL[role] + 'を読み込んでいます',
        detail: file.name + '（' + Util.formatBytes(file.size) + '）', steps: LQ.SourceFile.loadSteps(file.name).concat([TABLE_STEP]) });
      await Async.paint();
      try {
        const source = await LQ.SourceFile.fromFile(file, progress);
        progress.begin(TABLE_STEP.id, false);
        await Async.paint();
        this._putDataset(role, new LQ.Dataset(role, source));
      } catch (err) {
        this.toasts.show({ type: 'error', title: ROLE_LABEL[role] + 'を読み込めませんでした', message: file.name + '：' + this._friendlyError(err) });
      } finally {
        progress.close();
      }
    }

    /**
     * ② の表を読み込む。表が複数（複数ファイル・複数シート）なら選ぶ小窓を出す。
     * @param {File[]} files
     * @param {'active'|'new'|'append'} mode active：選択中の抽出条件の ② に / new：表ごとに抽出条件を作る（選択中の下へ）/
     *        append：表ごとに抽出条件を作る（一覧の最後へ。② のタブ・パネルの「条件データを追加」）
     */
    async loadTables(files, mode) {
      if (this._blockedByBusy()) return;
      const list = Array.from(files || []);
      const json = list.find((f) => Util.extName(f.name) === 'json');
      if (json) {
        this.profiles.importJsonFile(json);
        return;
      }
      if (!list.length) return;
      const progress = this.startProgress({ kind: 'read', label: '読み込み中…', title: ROLE_LABEL.condition + 'を読み込んでいます' });
      const tables = [];
      const failed = [];
      try {
        for (let i = 0; i < list.length; i++) {
          try {
            if (list.length > 1) progress.item(i, list.length, list[i].name);
            progress.plan(LQ.SourceFile.loadSteps(list[i].name).concat([TABLE_STEP]));
            progress.setDetail(list[i].name + '（' + Util.formatBytes(list[i].size) + '）');
            await Async.paint();
            const src = await LQ.SourceFile.fromFile(list[i], progress);
            progress.begin(TABLE_STEP.id, false);
            await Async.paint();
            this._collectTables(src, list[i].name).forEach((t) => tables.push(t));
          } catch (err) {
            failed.push(list[i].name + '：' + this._friendlyError(err));
          }
        }
      } finally {
        progress.close();
      }
      failed.forEach((msg) => this.toasts.show({ type: 'error', title: '② 条件データを読み込めませんでした', message: msg }));
      if (!tables.length) return;
      const opts = { append: mode === 'append' };
      if (tables.length === 1) {
        if (mode === 'active') this._putDataset('condition', tables[0].dataset, tables[0].name);
        else this.profiles.createFromTables(tables, opts);
        return;
      }
      this.profileDialogs.openTableChooser(tables, mode, (selected, intoActive) => {
        if (intoActive) this._putDataset('condition', selected[0].dataset, selected[0].name);
        else this.profiles.createFromTables(selected, opts);
      });
    }

    /** 読み込んだファイル → 表の一覧（Excel は中身のあるシートごと）。name は抽出条件の名前の候補 */
    _collectTables(src, fileName) {
      const base = Util.baseName(fileName);
      const sheets = src.usedSheetNames();
      if (sheets.length <= 1) return [{ dataset: new LQ.Dataset('condition', src), name: base, label: fileName }];
      return sheets.map((sheet) => ({
        dataset: new LQ.Dataset('condition', src.forSheet(sheet)),
        name: RE_GENERIC_SHEET.test(sheet) ? base + ' ' + sheet : sheet,
        label: fileName + ' › ' + sheet
      }));
    }

    loadText(role, text) {
      if (this._blockedByBusy()) return;
      const d = new Date();
      const name = '貼り付けデータ（' + Util.pad2(d.getHours()) + ':' + Util.pad2(d.getMinutes()) + '）';
      try {
        this._putDataset(role, new LQ.Dataset(role, LQ.SourceFile.fromText(text, name)), '貼り付けデータ');
      } catch (err) {
        this.toasts.show({ type: 'error', title: '貼り付けたデータを読み込めませんでした', message: err.message });
      }
    }

    /**
     * 画面のどこかで Ctrl+V されたとき（入力欄以外）。
     * Excel でコピーすると「タブ区切りの文字」と「セル範囲の画像」が同時に入るため、
     * 読み込めるファイル（Excel・CSV・抽出条件の JSON）→ 表の文字 の順に採用し、画像は使わない。
     */
    handlePaste(text, files) {
      const panelRole = this.state.panel === 'source' || this.state.panel === 'condition' ? this.state.panel : null;
      const list = Array.from(files || []);
      const settings = list.find((f) => Util.extName(f.name) === 'json');
      if (settings) {
        this.profiles.importJsonFile(settings);
        return;
      }
      const dataFile = list.find((f) => LQ.SourceFile.isDataFile(f));
      if (dataFile) {
        if (panelRole) this.loadFile(panelRole, dataFile);
        else this.dialogs.openRoleChooser(dataFile.name, (role) => this.loadFile(role, dataFile));
        return;
      }
      const body = (text || '').replace(/\s+$/, '');
      if (/[\t\n]/.test(body)) {
        if (panelRole) this.loadText(panelRole, text);
        else this.dialogs.openRoleChooser('貼り付けたデータ', (role) => this.loadText(role, text));
        return;
      }
      if (body) {
        this.toasts.show({ type: 'info', title: '表のデータではないため読み込みませんでした', message: '1 つの値だけが貼り付けられました。Excel で見出しを含むセル範囲を選んでコピーしてから Ctrl+V を押してください。' });
        return;
      }
      if (list.length) {
        this.toasts.show({ type: 'info', title: '画像などのため読み込みませんでした', message: '表として読み込むには、Excel でセル範囲を選んでコピー（Ctrl+C）してから Ctrl+V を押してください。' });
      }
    }

    /**
     * 読み込んだデータを ① または選択中の抽出条件の ② にする。
     * ② は、前回と同じファイル名なら前回の読み込み範囲を適用し、「抽出条件 N」のままの名前は表の名前にする。
     */
    _putDataset(role, dataset, tableName) {
      const s = this.state;
      const snap = s.snapshot();
      const target = role === 'condition' ? s.activeProfile : null;
      const replaced = role === 'source' ? s.datasets.source : target.condition;
      const ref = target && !target.condition ? target.conditionRef : null;
      const sameFile = !!(ref && ref.fileName && ref.fileName === dataset.name);
      if (sameFile) this._applyRef(dataset, ref);
      const memKey = LQ.LoadMemory.keyOf(role, target ? target.id : null);
      const readNote = sameFile || dataset.isSample ? null : LQ.LoadMemory.applyRead(memKey, dataset);
      const filtered = dataset.isSample ? null : LQ.LoadMemory.applyFilters(memKey, dataset);
      s.setDataset(role, dataset);
      let renamed = null;
      if (target && LQ.Profile.isDefaultName(target.name)) {
        const r = s.renameProfile(target.id, tableName || Util.baseName(dataset.name));
        if (r && r.name !== snap.profiles.find((p) => p.id === target.id).name) renamed = r.name;
      }
      s.setTab(role);
      const src = dataset.source;
      const parts = [fmt(dataset.rowCount) + ' 行 × ' + dataset.colCount + ' 列'];
      if (src.encoding) parts.push('文字コード ' + LQ.EncodingDetector.label(src.encoding.value));
      if (src.hasSheets) parts.push('シート「' + src.sheetName + '」');
      const notes = [];
      if (sameFile) notes.push('前回と同じ読み込み範囲を適用しました');
      if (readNote) notes.push(readNote);
      if (renamed) notes.push('抽出条件の名前を「' + renamed + '」にしました');
      if (!dataset.rowCount) notes.push('データ行がありません。読み込み範囲を確認してください');
      const who = target && s.profiles.length > 1 ? '（抽出条件「' + target.name + '」）' : '';
      this.toasts.show({
        type: dataset.rowCount ? 'success' : 'warn',
        title: ROLE_LABEL[role] + 'を読み込みました' + who,
        message: dataset.name + '：' + parts.join('・') + (notes.length ? '。' + notes.join('。') : ''),
        actions: replaced || renamed ? [{ label: '元に戻す', icon: 'rotate-left', onClick: () => this.restore(snap, '読み込む前の状態に戻しました') }] : []
      });
      if (filtered) this._announceFilters(role, dataset, filtered);
      this.bus.emit('dataset-loaded', { role: role });
    }

    /** 前回の絞り込みを掛け直したことを、外せるボタン付きで知らせる（気付かずに行が欠けないように） */
    _announceFilters(role, dataset, filtered) {
      const s = this.state;
      const lines = [fmt(dataset.baseRowCount) + ' 行中 ' + fmt(dataset.rowCount) + ' 行を使います'].concat(filtered.notes);
      this.toasts.show({
        type: filtered.notes.length ? 'warn' : 'info',
        title: '前回の絞り込み ' + filtered.count + ' 件を掛けました',
        message: lines.join('。') + '。',
        actions: [{ label: 'すべて外す', icon: 'filter-circle-xmark', onClick: () => s.setFilters(role, []) }]
      });
    }

    /** 前回の ② と同じファイルなら、シート・文字コード・読み込み範囲を前回どおりにする */
    _applyRef(dataset, ref) {
      try {
        if (dataset.source.applyChoices(ref.choices)) dataset.reload(ref.settings);
        else if (ref.settings) dataset.applySettings(ref.settings);
      } catch (err) {
        /* 前回の設定が合わないときは自動判定のまま使う */
      }
    }

    changeSourceChoice(role, kind, value) {
      const ds = this.state.datasets[role];
      if (!ds || this._blockedByBusy()) return;
      try {
        if (kind === 'encoding') ds.source.setEncoding(value);
        else if (kind === 'delimiter') ds.source.setDelimiter(value);
        else if (kind === 'sheet') ds.source.setSheet(value);
        ds.reload(kind === 'sheet' ? null : ds.settings);
        this.state.datasetChanged(role);
      } catch (err) {
        this.toasts.show({ type: 'error', title: '読み込み方法を変更できませんでした', message: err.message });
      }
    }

    /** @returns {{adjusted:string[]}|null} 変更できなかったときは null */
    updateReadSettings(role, patch) {
      const ds = this.state.datasets[role];
      if (!ds || this._blockedByBusy()) return null;
      const result = ds.applySettings(patch);
      this.state.datasetChanged(role);
      return result;
    }

    resetReadSettings(role) {
      const ds = this.state.datasets[role];
      if (!ds || this._blockedByBusy()) return;
      ds.resetToAuto();
      this.state.datasetChanged(role);
      this.toasts.show({ type: 'success', title: '読み込み範囲を自動判定に戻しました', message: ds.auto.reasons.join('／') });
    }

    clearDataset(role) {
      const s = this.state;
      const ds = s.datasets[role];
      if (!ds || this._blockedByBusy()) return;
      const snap = s.snapshot();
      const target = role === 'condition' ? s.activeProfile : null;
      s.setDataset(role, null);
      this.toasts.show({
        type: 'info',
        title: role === 'source' ? '① 元データを閉じました' : '② 条件データを外しました' + (target && s.profiles.length > 1 ? '（抽出条件「' + target.name + '」）' : ''),
        message: ds.name,
        actions: [{ label: '元に戻す', icon: 'rotate-left', onClick: () => this.restore(snap, ROLE_LABEL[role] + 'を元に戻しました') }]
      });
    }

    /* =================================================================
     * 抽出
     * ================================================================= */

    async run() {
      const s = this.state;
      if (s.busy || !this.validationAll().ok) return;
      const token = new LQ.CancelToken();
      this._token = token;
      const signature = s.querySignature();
      const profiles = [];
      s.profiles.items.forEach((p, i) => {
        if (!p.enabled) return;
        profiles.push({ id: p.id, name: p.name, priority: i + 1, query: Util.clone(p.query), condition: p.condition,
          rules: Util.clone(s.rulesFor(p)), ownRules: !!p.rules });
      });
      const ctx = { source: s.datasets.source, rules: Util.clone(s.rules), combine: s.effectiveCombine(), profiles: profiles };
      const progress = this.startProgress({ kind: 'run', label: '抽出中…', title: '抽出しています', detail: this._runSummary(), cancellable: true,
        steps: [{ id: 'run', label: '照合' }] });
      progress.begin('run', true);
      progress.update(0, '準備中');
      await Async.paint();
      try {
        const result = await this.batch.run(ctx, {
          token: token,
          onProgress: (p) => progress.update(p.ratio, p.done !== undefined ? p.label + ' ' + fmt(p.done) + ' / ' + fmt(p.total) + ' 行' : p.label)
        });
        if (result.cancelled) {
          this.toasts.show({ type: 'info', title: '抽出を中止しました', message: s.result ? '表示中の結果は前回のものです。' : '' });
          return;
        }
        const changed = s.datasets.source !== ctx.source || profiles.some((p) => {
          const cur = s.profiles.find(p.id);
          return !!cur && cur.condition !== p.condition;
        });
        if (changed) {
          this.toasts.show({ type: 'warn', title: '抽出中にデータが変わったため、結果を破棄しました', message: 'もう一度抽出してください。' });
          return;
        }
        s.setResult(result, signature);
        if (s.view.tab !== 'aggregate') s.setTab('result');
        this._announce(result);
      } catch (err) {
        this.toasts.show({ type: 'error', title: '抽出できませんでした', message: err.message });
      } finally {
        this._token = null;
        progress.close();
      }
    }

    cancel() {
      if (this._token) this._token.cancel();
    }

    _announce(result) {
      const st = result.stats;
      const parts = result.parts;
      const time = '処理時間 ' + Util.formatSeconds(st.elapsedMs);
      if (parts.length === 1 && !st.includeUnmatched) {
        const ps = parts[0].stats;
        const pct = Util.formatPercent(ps.matchedSources / Math.max(1, ps.sourceRows));
        const title = ps.joinKind === 'anti'
          ? fmt(ps.outputRows) + ' 行が一致しませんでした（除外後）'
          : fmt(ps.matchedSources) + ' 行が一致しました（' + pct + '）';
        this.toasts.show({ type: st.outputRows ? 'success' : 'warn', title: title, message: '出力 ' + fmt(st.outputRows) + ' 行・' + time });
      } else {
        const pct = Util.formatPercent(st.matchedSources / Math.max(1, st.sourceRows));
        const detail = parts.map((p) => p.priority + ' 位「' + p.name + '」' + fmt(p.rows) + ' 行').join('・') +
          (st.includeUnmatched ? '・該当なし ' + fmt(st.unmatchedRows) + ' 行' : '');
        this.toasts.show({ type: st.outputRows ? 'success' : 'warn', title: fmt(st.matchedSources) + ' 行が抽出条件に該当しました（' + pct + '）', message: detail + '。' + time });
      }
      const notes = [];
      if (st.truncated) notes.push('組み合わせが 1,000,000 行に達したため、途中で打ち切りました。');
      parts.forEach((part) => {
        part.stats.perCondition.forEach((p) => {
          if (p.incomparable) notes.push((parts.length > 1 ? '「' + part.name + '」' : '') + '条件 ' + p.label + '：数値と文字など比較できない組み合わせが ' + fmt(p.incomparable) + ' 件あり、不一致として扱いました。');
        });
      });
      if (notes.length) this.toasts.show({ type: 'warn', title: '確認してください', message: notes.join('\n') });
    }

    /** 結果の i 行目（表示順）の判定根拠。振り分け・独立のときは、ほかに該当した抽出条件も返す */
    explainRow(i) {
      const view = this.main.resultView();
      if (!view) return null;
      const s = this.state;
      const pair = view.pairAt(i);
      const part = pair.prof >= 0 ? view.parts[pair.prof] : null;
      const profile = part ? s.profiles.find(part.id) : null;
      let explanation = null;
      if (part && profile) {
        explanation = this.engine.explain({ source: s.datasets.source, condition: part.condition || profile.condition, query: profile.query, rules: s.rulesFor(profile) },
          pair.src, pair.cond);
      }
      const others = [];
      view.parts.forEach((q, j) => {
        if (j !== pair.prof && s.result.members[j][pair.src]) others.push({ name: view.partName(j), priority: q.priority });
      });
      return {
        pair: pair,
        part: part,
        partName: part ? view.partName(pair.prof) : null,
        multi: view.multi,
        explanation: explanation,
        missing: !!part && !profile,
        stale: s.isStale(),
        mode: s.result.stats.mode,
        others: others
      };
    }

    /* =================================================================
     * 消去・取り消し
     * ================================================================= */

    /** ①・抽出条件（ブラウザの保存分を含む）・結果を消す。自分の抽出条件があるときは確認してから */
    clearAll(anchor) {
      if (this._blockedByBusy()) return;
      const own = this.state.userProfiles().filter((p) => !p.isBlank()).length;
      if (own) {
        this.profileDialogs.openClearConfirm(anchor, own, () => this._clearAllNow());
        return;
      }
      this._clearAllNow();
    }

    _clearAllNow() {
      const s = this.state;
      const snap = s.snapshot();
      s.resetAll();
      s.setTab('result');
      s.closePanel();
      this.toasts.show({
        type: 'info',
        title: 'すべてクリアしました',
        message: '① 元データ・抽出条件（ブラウザに保存した分も）・出力列の並び・結果を消去しました。',
        actions: [{ label: '元に戻す', icon: 'rotate-left', onClick: () => this.restore(snap, 'クリアする前に戻しました') }]
      });
    }

    restore(snap, title) {
      this.state.restore(snap);
      this.toasts.show({ type: 'success', title: title });
    }

    /* 読み込みパネルを開いている間は、その表を「読み込み範囲」表示にする。
     * ピボットの設定を開いたら、結果が見えるようピボットタブにする（閉じてもピボットタブのまま） */
    _syncPanelView() {
      const s = this.state;
      const p = s.panel;
      if (p === 'aggregate' && s.datasets.source && s.view.tab !== 'aggregate') {
        if (this._tabBeforePanel !== null) this._tabBeforePanel = null;
        s.setTab('aggregate');
      }
      ['source', 'condition'].forEach((role) => {
        if (p !== role) s.setRaw(role, false);
      });
      if ((p === 'source' || p === 'condition') && s.datasets[p]) {
        if (this._tabBeforePanel === null) this._tabBeforePanel = s.view.tab;
        s.setTab(p);
        s.setRaw(p, true);
      } else if (this._tabBeforePanel !== null) {
        const back = this._tabBeforePanel;
        this._tabBeforePanel = null;
        if (s.view.tab === 'source' || s.view.tab === 'condition') s.setTab(back);
      }
    }
  }

  LQ.App = App;

  document.addEventListener('DOMContentLoaded', () => {
    LQ.app = new App();
    LQ.app.start();
  });
})(window);
