/* =========================================================================
 * LightQuery - lq-app.js
 * アプリ本体（組み立て役）：状態・エンジン・画面部品をつなぎ、利用者の操作（アクション）を実行する。
 *   ・主要動作（CTA）は cta() が「次にすることを 1 つだけ」決める
 *   ・消去や置き換えは確認ダイアログではなく「元に戻す」を通知に付ける
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Util = LQ.Util;
  const Dom = LQ.Dom;
  const Async = LQ.Async;

  const ROLE_LABEL = { source: '① 元データ', condition: '② 条件データ' };
  const FILE_ACCEPT = '.xlsx,.xlsm,.xls,.xlsb,.ods,.csv,.tsv,.txt';

  class App {
    constructor() {
      this.bus = new LQ.EventBus();
      this.state = new LQ.AppState(this.bus);
      this.engine = new LQ.QueryEngine();
      this.toasts = new LQ.ToastHost(Dom.qs('#lqToasts'));
      this.popovers = new LQ.PopoverHost(Dom.qs('#lqPopovers'));
      this._token = null;
      this._validation = null;
      this._validationKey = null;
      this._tabBeforePanel = null;
      this.ctx = { app: this, state: this.state, bus: this.bus, engine: this.engine, toasts: this.toasts, popovers: this.popovers };
    }

    start() {
      const ctx = this.ctx;
      this.dialogs = new LQ.Dialogs(ctx);
      this.manual = new LQ.ManualModal(ctx);
      this.panels = {
        source: new LQ.DatasetPanel(ctx, 'source'),
        condition: new LQ.DatasetPanel(ctx, 'condition'),
        query: new LQ.QueryPanel(ctx),
        rules: new LQ.RulesPanel(ctx),
        output: new LQ.OutputPanel(ctx)
      };
      this.main = new LQ.MainView(ctx);
      this.shell = new LQ.Shell(ctx, this.panels);
      this.bus.on('panel', () => this._syncPanelView());
      LQ.ExcelLibrary.subscribe(() => this.bus.emit('change', { topic: 'library' }));
      LQ.ExcelLibrary.ensure().catch(() => {});
      this.bus.emit('change', { topic: 'start' });
      if (this.manual.shouldAutoOpen()) this.manual.open();
    }

    /* =================================================================
     * 検証と主要動作（CTA）
     * ================================================================= */

    validation() {
      const key = this.state.querySignature();
      if (key !== this._validationKey) {
        this._validation = this.engine.validate(this.state.query, this.state.datasets.source, this.state.datasets.condition);
        this._validationKey = key;
      }
      return this._validation;
    }

    /** 次にすることを 1 つだけ返す（ラベルに件数を含める） */
    cta() {
      const s = this.state;
      const busy = s.busy;
      if (busy && busy.kind === 'run') {
        return { id: 'cancel', label: '中止する', icon: 'stop', variant: 'stop', progress: busy.ratio || 0,
          status: { kind: 'info', text: busy.label + '… ' + Util.formatPercent(busy.ratio || 0, 0) } };
      }
      if (busy) return { id: 'busy', label: busy.label, icon: 'spinner', spin: true, disabled: true, status: { kind: 'info', text: busy.detail || '処理中です' } };
      const src = s.datasets.source;
      const cond = s.datasets.condition;
      const q = s.query;
      if (!src) {
        return { id: 'loadSource', label: '① 元データを読み込む', icon: 'file-import',
          status: { kind: 'info', text: 'ドラッグ＆ドロップや Ctrl+V の貼り付けでも読み込めます' } };
      }
      if (!q.conditions.length && !cond) {
        return { id: 'loadCondition', label: '② 条件データを読み込む', icon: 'file-import',
          status: { kind: 'info', text: '固定値だけの条件なら ② は不要です（左の「条件」）' } };
      }
      if (!q.conditions.length) {
        return { id: 'addCondition', label: '条件を追加する', icon: 'plus', status: { kind: 'info', text: '① のどの列を ② のどの列と比べるかを決めます' } };
      }
      const v = this.validation();
      if (!v.ok) {
        const e = v.errors[0];
        if (e.code === 'noConditionData') return { id: 'loadCondition', label: '② 条件データを読み込む', icon: 'file-import', status: { kind: 'warn', text: e.message } };
        const c = e.condId ? s.findCondition(e.condId) : null;
        return { id: 'fixCondition', label: e.code === 'expr' ? '式を修正する' : '条件 ' + (c ? c.label : '') + ' を設定する',
          icon: 'pen', issue: e, status: { kind: 'warn', text: e.message } };
      }
      const rows = Util.formatInt(src.rowCount);
      if (!s.result || s.isStale()) {
        const rerun = !!s.result;
        return { id: 'run', label: rows + ' 行から' + (rerun ? '再抽出する' : '抽出する'), icon: rerun ? 'arrows-rotate' : 'play',
          status: rerun ? { kind: 'warn', text: '条件が変わりました（結果は未反映）' }
            : { kind: 'info', text: '条件 ' + LQ.Logic.labelsIn(v.ast).length + ' 件：' + LQ.Logic.toJapanese(v.ast) } };
      }
      if (s.result.length === 0) return { id: 'review', label: '条件を見直す', icon: 'sliders', status: { kind: 'warn', text: '一致する行はありませんでした' } };
      return { id: 'export', label: Util.formatInt(s.result.length) + ' 行を出力する', icon: 'file-export',
        status: { kind: 'ok', text: 'Excel・CSV・コピーで出力できます' } };
    }

    runCta(anchor) {
      const c = this.cta();
      switch (c.id) {
        case 'cancel': this.cancel(); break;
        case 'loadSource': this.pickFile('source'); break;
        case 'loadCondition': this.pickFile('condition'); break;
        case 'addCondition':
          this.state.openPanel('query');
          this.addCondition();
          break;
        case 'fixCondition':
          this.state.openPanel('query');
          this.bus.emit('focus-issue', c.issue);
          break;
        case 'run': this.run(); break;
        case 'review': this.state.openPanel('query'); break;
        case 'export': this.dialogs.openExport(anchor); break;
        default: break;
      }
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

    pickFile(role) {
      const input = Dom.h('input', { type: 'file', accept: role === 'settings' ? '.json' : FILE_ACCEPT });
      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        if (!file) return;
        if (role === 'settings') this.importSettingsFile(file);
        else this.loadFile(role, file);
      });
      input.click();
    }

    async loadFile(role, file) {
      if (this._blockedByBusy()) return;
      if (Util.extName(file.name) === 'json') {
        this.importSettingsFile(file);
        return;
      }
      this.state.setBusy({ kind: 'read', label: '読み込み中…', detail: file.name + '（' + Util.formatBytes(file.size) + '）を読み込んでいます' });
      await Async.paint();
      try {
        const source = await LQ.SourceFile.fromFile(file);
        this._putDataset(role, new LQ.Dataset(role, source));
      } catch (err) {
        this.toasts.show({ type: 'error', title: ROLE_LABEL[role] + 'を読み込めませんでした', message: file.name + '：' + this._friendlyError(err) });
      } finally {
        this.state.setBusy(null);
      }
    }

    loadText(role, text) {
      if (this._blockedByBusy()) return;
      const d = new Date();
      const name = '貼り付けデータ（' + Util.pad2(d.getHours()) + ':' + Util.pad2(d.getMinutes()) + '）';
      try {
        this._putDataset(role, new LQ.Dataset(role, LQ.SourceFile.fromText(text, name)));
      } catch (err) {
        this.toasts.show({ type: 'error', title: '貼り付けたデータを読み込めませんでした', message: err.message });
      }
    }

    /** 画面のどこかで Ctrl+V されたとき（入力欄以外） */
    /**
     * 画面のどこかで Ctrl+V されたとき（入力欄以外）。
     * Excel でコピーすると「タブ区切りの文字」と「セル範囲の画像」が同時に入るため、
     * 読み込めるファイル（Excel・CSV・条件設定）→ 表の文字 の順に採用し、画像は使わない。
     */
    handlePaste(text, files) {
      const panelRole = this.state.panel === 'source' || this.state.panel === 'condition' ? this.state.panel : null;
      const list = Array.from(files || []);
      const settings = list.find((f) => Util.extName(f.name) === 'json');
      if (settings) {
        this.importSettingsFile(settings);
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

    _putDataset(role, dataset) {
      const snap = this.state.snapshot();
      const replaced = this.state.datasets[role];
      this.state.setDataset(role, dataset);
      this.state.setTab(role);
      const src = dataset.source;
      const parts = [Util.formatInt(dataset.rowCount) + ' 行 × ' + dataset.colCount + ' 列'];
      if (src.encoding) parts.push('文字コード ' + LQ.EncodingDetector.label(src.encoding.value));
      if (src.hasSheets) parts.push('シート「' + src.sheetName + '」');
      this.toasts.show({
        type: dataset.rowCount ? 'success' : 'warn',
        title: ROLE_LABEL[role] + 'を読み込みました',
        message: dataset.name + '：' + parts.join('・') + (dataset.rowCount ? '' : '。データ行がありません。読み込み範囲を確認してください'),
        actions: replaced ? [{ label: '元に戻す', icon: 'rotate-left', onClick: () => this.restore(snap, '読み込む前の状態に戻しました') }] : []
      });
      this.bus.emit('dataset-loaded', { role: role });
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
      const ds = this.state.datasets[role];
      if (!ds || this._blockedByBusy()) return;
      const snap = this.state.snapshot();
      this.state.setDataset(role, null);
      this.toasts.show({
        type: 'info',
        title: ROLE_LABEL[role] + 'を閉じました',
        message: ds.name,
        actions: [{ label: '元に戻す', icon: 'rotate-left', onClick: () => this.restore(snap, ROLE_LABEL[role] + 'を元に戻しました') }]
      });
    }

    /* =================================================================
     * 条件
     * ================================================================= */

    addCondition(init) {
      if (!this.state.canAddCondition()) {
        this.toasts.show({ type: 'warn', title: '条件は最大 ' + LQ.AppState.MAX_CONDITIONS + ' 件です', message: '不要な条件を削除してから追加してください。' });
        return null;
      }
      const base = init || { right: { type: this.state.datasets.condition ? 'column' : 'value' } };
      const c = this.state.addCondition(base);
      this.bus.emit('focus-condition', { id: c.id, field: base.left ? 'right' : 'left' });
      return c;
    }

    /** ① と ② で同じ名前の列を「完全一致」の条件としてまとめて追加 */
    addSameNameConditions(names) {
      const added = [];
      names.forEach((name) => {
        if (!this.state.canAddCondition()) return;
        added.push(this.state.addCondition({ left: name, op: 'eq', right: { type: 'column', col: name } }).label);
      });
      if (added.length) this.toasts.show({ type: 'success', title: '条件 ' + added.join('・') + ' を追加しました', message: '同じ名前の列を「完全一致」で対応付けました。' });
    }

    removeCondition(id) {
      const snap = this.state.snapshot();
      const removed = this.state.removeCondition(id);
      if (!removed) return;
      this.toasts.show({
        type: 'info',
        title: '条件 ' + removed.label + ' を削除しました',
        message: LQ.QueryEngine.describeCondition(removed),
        actions: [{ label: '元に戻す', icon: 'rotate-left', onClick: () => this.restore(snap, '条件 ' + removed.label + ' を元に戻しました') }]
      });
    }

    /** 否定の条件だけのとき：「含む／一致」＋「一致しなかった行」に切り替える（NG リストの使い方） */
    convertToExclusion() {
      const snap = this.state.snapshot();
      this.state.query.conditions.forEach((c) => {
        const op = LQ.Operators.get(c.op);
        if (op && op.negative && op.positive) this.state.updateCondition(c.id, { op: op.positive });
      });
      this.state.setJoinKind('anti');
      this.toasts.show({
        type: 'success',
        title: '除外リストの設定に切り替えました',
        message: '比較方法を「含む／完全一致」にし、出力する行を「一致しなかった行」にしました。',
        actions: [{ label: '元に戻す', icon: 'rotate-left', onClick: () => this.restore(snap, '切り替える前に戻しました') }]
      });
    }

    /* =================================================================
     * 抽出
     * ================================================================= */

    async run() {
      const s = this.state;
      if (s.busy || !this.validation().ok) return;
      const token = new LQ.CancelToken();
      this._token = token;
      const signature = s.querySignature();
      const ctx = { source: s.datasets.source, condition: s.datasets.condition, query: Util.clone(s.query), rules: Util.clone(s.rules) };
      s.setBusy({ kind: 'run', label: '準備中', ratio: 0 });
      await Async.paint();
      let last = 0;
      try {
        const result = await this.engine.run(ctx, {
          token: token,
          onProgress: (p) => {
            const now = performance.now();
            if (now - last < 80 && p.ratio < 1) return;
            last = now;
            s.setBusy({ kind: 'run', label: p.label, ratio: p.ratio });
          }
        });
        if (result.cancelled) {
          this.toasts.show({ type: 'info', title: '抽出を中止しました', message: s.result ? '表示中の結果は前回のものです。' : '' });
          return;
        }
        if (s.datasets.source !== ctx.source || s.datasets.condition !== ctx.condition) {
          this.toasts.show({ type: 'warn', title: '抽出中にデータが変わったため、結果を破棄しました', message: 'もう一度抽出してください。' });
          return;
        }
        s.setResult(result, signature);
        s.setTab('result');
        this._announce(result);
      } catch (err) {
        this.toasts.show({ type: 'error', title: '抽出できませんでした', message: err.message });
      } finally {
        this._token = null;
        s.setBusy(null);
      }
    }

    cancel() {
      if (this._token) this._token.cancel();
    }

    _announce(result) {
      const st = result.stats;
      const pct = Util.formatPercent(st.matchedSources / Math.max(1, st.sourceRows));
      const title = st.joinKind === 'anti'
        ? Util.formatInt(st.outputRows) + ' 行が一致しませんでした（除外後）'
        : Util.formatInt(st.matchedSources) + ' 行が一致しました（' + pct + '）';
      this.toasts.show({ type: st.outputRows ? 'success' : 'warn', title: title, message: '出力 ' + Util.formatInt(st.outputRows) + ' 行・処理時間 ' + Util.formatSeconds(st.elapsedMs) });
      const notes = [];
      if (st.truncated) notes.push('組み合わせが 1,000,000 行に達したため、途中で打ち切りました。');
      st.perCondition.forEach((p) => {
        if (p.incomparable) notes.push('条件 ' + p.label + '：数値と文字など比較できない組み合わせが ' + Util.formatInt(p.incomparable) + ' 件あり、不一致として扱いました。');
      });
      if (notes.length) this.toasts.show({ type: 'warn', title: '確認してください', message: notes.join('\n') });
    }

    /** 結果の i 行目（表示順）の判定根拠 */
    explainRow(i) {
      const view = this.main.resultView();
      if (!view) return null;
      const pair = view.pairAt(i);
      const s = this.state;
      const explanation = this.engine.explain({ source: s.datasets.source, condition: s.datasets.condition, query: s.query, rules: s.rules }, pair.src, pair.cond);
      return { pair: pair, explanation: explanation, stale: s.isStale() };
    }

    /* =================================================================
     * 出力
     * ================================================================= */

    exportTable() {
      const view = this.main.resultView();
      if (!view) return null;
      const defs = view.resolveColumns(this.state.output.columns).filter((d) => d.available);
      return defs.length ? { view: view, defs: defs, table: view.toTable(defs) } : null;
    }

    async exportResult(formatId, options) {
      const s = this.state;
      const prepared = this.exportTable();
      if (!prepared) {
        this.toasts.show({ type: 'warn', title: '出力できる列がありません', message: '出力列パネルで列を選んでください。' });
        return;
      }
      const format = LQ.Exporters.get(formatId);
      s.setBusy({ kind: 'export', label: '出力中…', detail: format.label + 'を作成しています' });
      await Async.paint();
      try {
        const out = await LQ.Exporters.build(formatId, prepared.table, { metaLines: this._metaLines(prepared), protect: !!options.protect });
        const fileName = Util.sanitizeFileName(options.fileName) + '.' + format.ext;
        LQ.Exporters.download(out.blob, fileName);
        LQ.Prefs.set('exportFormat', formatId);
        this.toasts.show({ type: 'success', title: '出力しました', message: fileName + '（' + Util.formatInt(prepared.table.rowCount) + ' 行 × ' + prepared.defs.length + ' 列・' + Util.formatBytes(out.blob.size) + '）' });
        out.warnings.forEach((w) => this.toasts.show({ type: 'warn', title: '文字の置き換えがあります', message: w }));
      } catch (err) {
        this.toasts.show({ type: 'error', title: '出力できませんでした', message: err.message });
      } finally {
        s.setBusy(null);
      }
    }

    async copyResult() {
      const prepared = this.exportTable();
      if (!prepared) return;
      const text = LQ.Exporters.toClipboardText(prepared.table);
      const ok = await LQ.Exporters.copyText(text);
      if (ok) {
        this.toasts.show({ type: 'success', title: 'クリップボードにコピーしました', message: Util.formatInt(prepared.table.rowCount) + ' 行 × ' + prepared.defs.length + ' 列（見出し付き）。Excel に貼り付けられます。' });
      } else {
        this.toasts.show({ type: 'error', title: 'コピーできませんでした', message: 'ブラウザがクリップボードへの書き込みを許可していません。Excel 形式で出力してください。' });
      }
    }

    defaultFileName() {
      const src = this.state.datasets.source;
      return Util.sanitizeFileName((src ? Util.baseName(src.name) : 'LightQuery') + '_抽出結果_' + Util.timestamp());
    }

    _describeDataset(ds) {
      const src = ds.source;
      const parts = [src.kindLabel];
      if (src.hasSheets) parts.push('シート「' + src.sheetName + '」');
      if (src.encoding) parts.push(LQ.EncodingDetector.label(src.encoding.value));
      parts.push(ds.settings.hasHeader ? 'ヘッダー ' + ds.settings.headerRow + ' 行目' : 'ヘッダーなし');
      parts.push('範囲 ' + ds.stats.rangeText);
      parts.push(Util.formatInt(ds.rowCount) + ' 行');
      return ds.name + '（' + parts.join('・') + '）';
    }

    _metaLines(prepared) {
      const s = this.state;
      const res = prepared.view.result;
      const st = res.stats;
      const snap = res.snapshot;
      const join = LQ.QueryEngine.JOIN_KINDS.find((j) => j.id === st.joinKind);
      const match = LQ.QueryEngine.MATCH_MODES.find((m) => m.id === st.matchMode);
      const lines = [['項目', '内容'], ['出力日時', Util.dateTimeText(new Date())], ['① 元データ', this._describeDataset(s.datasets.source)]];
      if (st.needsCondition && s.datasets.condition) lines.push(['② 条件データ', this._describeDataset(s.datasets.condition)]);
      snap.conditions.forEach((text, i) => lines.push([i === 0 ? '条件' : '', text]));
      lines.push(['組み合わせ', snap.exprJa]);
      lines.push(['出力する行', join.label + '（' + join.note + '）']);
      if (st.needsCondition && st.joinKind !== 'anti') lines.push(['複数一致したとき', match.label]);
      lines.push(['照合ルール', snap.rules]);
      lines.push(['結果', '① ' + Util.formatInt(st.sourceRows) + ' 行中 ' + Util.formatInt(st.matchedSources) + ' 行が一致・出力 ' + Util.formatInt(st.outputRows) + ' 行']);
      if (s.view.sort) lines.push(['並び順', LQ.ResultView.nameOf(s.view.sort.key) + '（' + (s.view.sort.dir === 'desc' ? '降順' : '昇順') + '）']);
      lines.push(['出力した列', prepared.defs.map((d) => d.name).join('、')]);
      if (s.isStale()) lines.push(['注意', '出力時点の画面の条件は、この結果を作った条件から変更されています']);
      lines.push(['作成', 'LightQuery（簡易クエリ）']);
      return lines;
    }

    /* =================================================================
     * 条件設定の保存・読み込み
     * ================================================================= */

    saveSettings() {
      if (!this.state.query.conditions.length) {
        this.toasts.show({ type: 'warn', title: '保存する条件がありません', message: '条件を作成してから保存してください。' });
        return;
      }
      const json = JSON.stringify(this.state.exportSettings(), null, 2);
      const name = 'LightQuery_条件_' + Util.timestamp() + '.json';
      LQ.Exporters.download(new Blob([json], { type: 'application/json' }), name);
      this.toasts.show({ type: 'success', title: '条件設定を保存しました', message: name + '（データそのものは含みません）' });
    }

    async importSettingsFile(file) {
      if (this._blockedByBusy()) return;
      let obj;
      try {
        obj = JSON.parse(await file.text());
      } catch (err) {
        this.toasts.show({ type: 'error', title: '条件設定を読み込めませんでした', message: file.name + ' は JSON 形式ではありません。' });
        return;
      }
      const snap = this.state.snapshot();
      try {
        const r = this.state.importSettings(obj);
        this.state.openPanel('query');
        const read = r.appliedRead.map((role) => ROLE_LABEL[role]).join('・');
        this.toasts.show({
          type: 'success',
          title: '条件設定を読み込みました',
          message: '条件 ' + r.conditions + ' 件' + (read ? '。' + read + 'の読み込み範囲も適用しました' : ''),
          actions: [{ label: '元に戻す', icon: 'rotate-left', onClick: () => this.restore(snap, '読み込む前の条件に戻しました') }]
        });
      } catch (err) {
        this.state.restore(snap);
        this.toasts.show({ type: 'error', title: '条件設定を読み込めませんでした', message: err.message });
      }
    }

    /* =================================================================
     * サンプル・消去・取り消し
     * ================================================================= */

    async loadSample(id) {
      const s = this.state;
      if (this._blockedByBusy()) return;
      const snap = s.snapshot();
      s.setBusy({ kind: 'read', label: '準備中…', detail: 'サンプルデータを作成しています' });
      await Async.paint();
      let built = null;
      try {
        built = LQ.Samples.build(id);
        const make = (role, spec) => new LQ.Dataset(role, LQ.SourceFile.fromGrid(spec.grid, spec.name, 'sample'), { isSample: true, settings: spec.settings || null });
        s.setDataset('source', make('source', built.source));
        s.setDataset('condition', make('condition', built.condition));
        s.replaceQuery(built.query, 'sample');
        s.applyOutputPreset(built.output);
        s.setTab('result');
      } catch (err) {
        built = null;
        this.toasts.show({ type: 'error', title: 'サンプルを読み込めませんでした', message: err.message });
      } finally {
        s.setBusy(null);
      }
      if (!built) return;
      this.toasts.show({
        type: 'success',
        title: 'サンプル「' + built.title + '」を読み込みました',
        message: '右上の「' + this.cta().label + '」で結果を確認できます。条件は左の「条件」で確認・変更できます。',
        actions: [{ label: '元に戻す', icon: 'rotate-left', onClick: () => this.restore(snap, 'サンプルを読み込む前に戻しました') }]
      });
    }

    clearSamples() {
      const s = this.state;
      if (!s.hasSample() || this._blockedByBusy()) return;
      const snap = s.snapshot();
      const removed = [];
      ['source', 'condition'].forEach((role) => {
        const ds = s.datasets[role];
        if (ds && ds.isSample) {
          s.setDataset(role, null);
          removed.push(ROLE_LABEL[role]);
        }
      });
      if (s.query.origin === 'sample') {
        s.resetQuery();
        removed.push('サンプルの条件');
      }
      this.toasts.show({
        type: 'info',
        title: 'サンプルデータを消去しました',
        message: removed.join('・') + 'を消去しました。自分で読み込んだデータは残っています。',
        actions: [{ label: '元に戻す', icon: 'rotate-left', onClick: () => this.restore(snap, 'サンプルデータを元に戻しました') }]
      });
    }

    clearAll() {
      const s = this.state;
      if (this._blockedByBusy()) return;
      const snap = s.snapshot();
      s.setDataset('source', null);
      s.setDataset('condition', null);
      s.resetQuery();
      s.setTab('result');
      s.closePanel();
      this.toasts.show({
        type: 'info',
        title: 'すべてクリアしました',
        message: '読み込んだデータ・条件・結果を消去しました。',
        actions: [{ label: '元に戻す', icon: 'rotate-left', onClick: () => this.restore(snap, 'クリアする前に戻しました') }]
      });
    }

    restore(snap, title) {
      this.state.restore(snap);
      this.toasts.show({ type: 'success', title: title });
    }

    /* 読み込みパネルを開いている間は、その表を「読み込み範囲」表示にする */
    _syncPanelView() {
      const s = this.state;
      const p = s.panel;
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
