/* =========================================================================
 * LightQuery - lq-app-profiles.js
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

    /**
     * 選んだ表ごとに抽出条件を作る。選択中が空の抽出条件なら 1 件目はそこに入れ、残りはその下に並べる。
     * @param {Array<{dataset:LQ.Dataset, name:string}>} tables
     */
    createFromTables(tables) {
      const s = this.state;
      if (!tables.length) return;
      const snap = s.snapshot();
      const active = s.activeProfile;
      const rest = tables.slice();
      const names = [];
      let reused = false;
      if (active.isBlank()) {
        const t = rest.shift();
        s.setProfileCondition(active.id, t.dataset);
        s.renameProfile(active.id, t.name);
        names.push(active.name);
        reused = true;
      }
      const created = rest.map((t) => {
        const p = new LQ.Profile({ name: t.name });
        p.setCondition(t.dataset);
        return p;
      });
      const added = created.length ? s.insertProfiles(created, s.profiles.indexOf(active.id) + 1, !reused) : [];
      added.forEach((p) => names.push(p.name));
      const skipped = created.length - added.length;
      s.openPanel('query');
      this.toasts.show({
        type: 'success',
        title: '抽出条件を ' + names.length + ' 件用意しました',
        message: names.map((n) => '「' + n + '」').join('・') + '。一覧で 1 件ずつ選び、① のどの列と比べるか（条件）を設定してください。' +
          (skipped ? '上限（' + LQ.Profile.MAX + ' 件）のため ' + skipped + ' 件は作れませんでした。' : ''),
        actions: this._undo(snap, '表から作る前の一覧に戻しました')
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
      if (bundle.kind === 'library' && !this._ownListIsBlank()) {
        this.app.profileDialogs.openImportChoice({ fileName: file.name, count: bundle.profiles.length },
          (mode) => this.applyBundle(bundle, mode, file.name));
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
      s.setBusy({ kind: 'read', label: '準備中…', detail: 'サンプルデータを作成しています' });
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
        s.applyOutputPreset(built.output);
        s.setTab('result');
      } catch (err) {
        built = null;
        this.toasts.show({ type: 'error', title: 'サンプルを読み込めませんでした', message: err.message });
      } finally {
        s.setBusy(null);
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
