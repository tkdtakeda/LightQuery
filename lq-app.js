/* =========================================================================
 * LightQuery - lq-app.js
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
      this.dialogs = new LQ.Dialogs(ctx);
      this.resultDialogs = new LQ.ResultDialogs(ctx);
      this.profileDialogs = new LQ.ProfileDialogs(ctx);
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
      if (busy && busy.kind === 'run') {
        return { id: 'cancel', label: '中止する', icon: 'stop', variant: 'stop', progress: busy.ratio || 0,
          status: { kind: 'info', text: busy.label + '… ' + Util.formatPercent(busy.ratio || 0, 0) } };
      }
      if (busy) return { id: 'busy', label: busy.label, icon: 'spinner', spin: true, disabled: true, status: { kind: 'info', text: busy.detail || '処理中です' } };
      const src = s.datasets.source;
      if (!src) {
        return { id: 'loadSource', label: '① 元データを読み込む', icon: 'file-import',
          status: { kind: 'info', text: 'ドラッグ＆ドロップや Ctrl+V の貼り付けでも読み込めます' } };
      }
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
      return { id: 'export', label: fmt(s.result.length) + ' 行を出力する', icon: 'file-export',
        status: { kind: 'ok', text: 'Excel・CSV・コピーで出力できます' } };
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
        case 'export': this.resultDialogs.openExport(anchor); break;
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

    /** role：'source'（①）/ 'condition'（選択中の抽出条件の ②・複数可）/ 'tables'（表ごとに抽出条件を作る）/ 'settings'（JSON） */
    pickFile(role) {
      const isJson = role === 'settings';
      Dom.qsa('input.lq-filepick').forEach((el) => el.remove());
      const input = Dom.h('input', {
        type: 'file', class: 'lq-filepick lq-offscreen', tabindex: '-1', 'aria-hidden': 'true',
        accept: isJson ? '.json' : FILE_ACCEPT, multiple: role === 'condition' || role === 'tables'
      });
      input.addEventListener('change', () => {
        const files = Array.from(input.files || []);
        input.remove();
        if (!files.length) return;
        if (isJson) this.profiles.importJsonFile(files[0]);
        else if (role === 'source') this.loadFile('source', files[0]);
        else this.loadTables(files, role === 'tables' ? 'new' : 'active');
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

    /**
     * ② の表を読み込む。表が複数（複数ファイル・複数シート）なら選ぶ小窓を出す。
     * @param {File[]} files
     * @param {'active'|'new'} mode active：選択中の抽出条件の ② に / new：表ごとに抽出条件を作る
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
      this.state.setBusy({ kind: 'read', label: '読み込み中…', detail: list.map((f) => f.name).join('、') + ' を読み込んでいます' });
      await Async.paint();
      const tables = [];
      const failed = [];
      try {
        for (let i = 0; i < list.length; i++) {
          try {
            const src = await LQ.SourceFile.fromFile(list[i]);
            this._collectTables(src, list[i].name).forEach((t) => tables.push(t));
          } catch (err) {
            failed.push(list[i].name + '：' + this._friendlyError(err));
          }
        }
      } finally {
        this.state.setBusy(null);
      }
      failed.forEach((msg) => this.toasts.show({ type: 'error', title: '② 条件データを読み込めませんでした', message: msg }));
      if (!tables.length) return;
      if (tables.length === 1) {
        if (mode === 'active') this._putDataset('condition', tables[0].dataset, tables[0].name);
        else this.profiles.createFromTables(tables);
        return;
      }
      this.profileDialogs.openTableChooser(tables, mode, (selected, intoActive) => {
        if (intoActive) this._putDataset('condition', selected[0].dataset, selected[0].name);
        else this.profiles.createFromTables(selected);
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
      if (renamed) notes.push('抽出条件の名前を「' + renamed + '」にしました');
      if (!dataset.rowCount) notes.push('データ行がありません。読み込み範囲を確認してください');
      const who = target && s.profiles.length > 1 ? '（抽出条件「' + target.name + '」）' : '';
      this.toasts.show({
        type: dataset.rowCount ? 'success' : 'warn',
        title: ROLE_LABEL[role] + 'を読み込みました' + who,
        message: dataset.name + '：' + parts.join('・') + (notes.length ? '。' + notes.join('。') : ''),
        actions: replaced || renamed ? [{ label: '元に戻す', icon: 'rotate-left', onClick: () => this.restore(snap, '読み込む前の状態に戻しました') }] : []
      });
      this.bus.emit('dataset-loaded', { role: role });
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
        if (p.enabled) profiles.push({ id: p.id, name: p.name, priority: i + 1, query: Util.clone(p.query), condition: p.condition });
      });
      const ctx = { source: s.datasets.source, rules: Util.clone(s.rules), combine: s.effectiveCombine(), profiles: profiles };
      s.setBusy({ kind: 'run', label: '準備中', ratio: 0 });
      await Async.paint();
      let last = 0;
      try {
        const result = await this.batch.run(ctx, {
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
        const changed = s.datasets.source !== ctx.source || profiles.some((p) => {
          const cur = s.profiles.find(p.id);
          return !!cur && cur.condition !== p.condition;
        });
        if (changed) {
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
        explanation = this.engine.explain({ source: s.datasets.source, condition: part.condition || profile.condition, query: profile.query, rules: s.rules }, pair.src, pair.cond);
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
        message: '① 元データ・抽出条件（ブラウザに保存した分も）・結果を消去しました。',
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
