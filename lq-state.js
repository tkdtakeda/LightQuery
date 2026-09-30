/* =========================================================================
 * LightQuery - lq-state.js
 * アプリの状態（① 元データ・抽出条件の一覧・照合ルール・出力列・表示・結果）を一か所で管理し、
 *   変更を話題（topic）ごとに通知する。画面部品は状態を直接書き換えず、必ずここを通す。
 *   topic：datasets / profiles / query / rules / output / result / view / busy / panel（加えて change）
 *   query と datasets.condition は「選択中の抽出条件」のものを指す（条件パネル・② パネルはそれを編集する）。
 *   照合ルールは全体の設定（rules）を既定とし、抽出条件ごとに個別の設定（profile.rules）で上書きできる。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Util = LQ.Util;
  const Prefs = LQ.Prefs;
  const QueryOps = LQ.QueryOps;
  const Profile = LQ.Profile;
  const Normalizer = LQ.Normalizer;

  const PAGE_SIZE_MAX = 5000;
  const DEFAULT_PAGE_SIZE = 100;
  const META_KEYS = ['m:profile', 'm:priority', 'm:srcRow', 'm:condRow', 'm:count'];
  const META_VISIBLE = { 'm:profile': true };
  const UNMATCHED_FILTER = '__none__';

  function clampPageSize(n) {
    const v = parseInt(n, 10);
    return Util.clamp(isFinite(v) && v > 0 ? v : DEFAULT_PAGE_SIZE, 1, PAGE_SIZE_MAX);
  }

  function cleanCombine(value) {
    const v = value || {};
    return { mode: v.mode === 'independent' ? 'independent' : 'assign', includeUnmatched: !!v.includeUnmatched };
  }

  class AppState {
    constructor(bus) {
      this.bus = bus;
      const self = this;
      /* ① は共通、② は選択中の抽出条件のもの */
      this.datasets = Object.defineProperty({ source: null }, 'condition', {
        enumerable: true,
        get() {
          const p = self.activeProfile;
          return p ? p.condition : null;
        }
      });
      this.profiles = new LQ.ProfileList();
      this.activeId = null;
      this.combine = cleanCombine(null);
      this.sampleStash = null;
      this.rules = Object.assign({}, Normalizer.DEFAULT_RULES, Normalizer.cleanRules(Prefs.get('rules', null)) || {});
      this.output = new LQ.OutputColumns();
      this.view = {
        tab: 'result',
        pageSize: clampPageSize(Prefs.get('pageSize', DEFAULT_PAGE_SIZE)),
        pages: { result: 0, source: 0, condition: 0 },
        sort: null,
        filter: null,
        raw: { source: false, condition: false }
      };
      this.result = null;
      this.resultSignature = null;
      this.busy = null;
      this.panel = null;
      this._ensureProfile();
    }

    static get MAX_CONDITIONS() {
      return QueryOps.MAX_CONDITIONS;
    }

    static get PAGE_SIZE_MAX() {
      return PAGE_SIZE_MAX;
    }

    /** 結果の絞り込みで「どの抽出条件にも該当しない行」を表す値 */
    static get UNMATCHED_FILTER() {
      return UNMATCHED_FILTER;
    }

    _emit(topic, detail) {
      this.bus.emit(topic, detail || {});
      this.bus.emit('change', { topic: topic, detail: detail || {} });
    }

    /* ---------------- 読み込みデータ ---------------- */

    /** role：'source'（① 共通）/ 'condition'（選択中の抽出条件の ②） */
    setDataset(role, dataset) {
      if (role === 'source') this.datasets.source = dataset;
      else this.activeProfile.setCondition(dataset);
      this.view.pages[role] = 0;
      this._afterDatasetChange(role);
    }

    /** 指定した抽出条件の ② を差し替える */
    setProfileCondition(id, dataset) {
      const p = this.profiles.find(id);
      if (!p) return;
      p.setCondition(dataset);
      if (id === this.activeId) this.view.pages.condition = 0;
      this._afterDatasetChange('condition');
    }

    /** 読み込み範囲・文字コード・シートなどを変えたあとに呼ぶ */
    datasetChanged(role) {
      this.view.pages[role] = 0;
      this._afterDatasetChange(role);
    }

    _afterDatasetChange(role) {
      this._syncOutputColumns();
      this._clearResult();
      this._emit('datasets', { role: role });
    }

    hasSample() {
      const src = this.datasets.source;
      if (src && src.isSample) return true;
      return this.profiles.items.some((p) => p.isSample || (p.condition && p.condition.isSample));
    }

    /* ---------------- 抽出条件の一覧 ---------------- */

    get activeProfile() {
      return this.profiles.find(this.activeId) || this.profiles.items[0] || null;
    }

    /** 選択中の抽出条件の query（条件パネルが編集する） */
    get query() {
      return this.activeProfile.query;
    }

    /** 実行に使う組み合わせの設定（抽出条件が 1 つのときは振り分けの設定を使わない） */
    effectiveCombine() {
      return this.profiles.length > 1 ? Util.clone(this.combine) : cleanCombine(null);
    }

    _ensureProfile() {
      if (!this.profiles.length) this.profiles.insert(new Profile({ name: this.profiles.defaultName() }));
      if (!this.profiles.find(this.activeId)) this.activeId = this.profiles.items[0].id;
    }

    /** 選択中の抽出条件が変わった（または一覧が大きく変わった）ことを知らせる */
    _emitSwitched(detail) {
      this._syncOutputColumns();
      this._emit('profiles', detail || {});
      this._emit('query', { replaced: true });
      this._emit('datasets', { role: 'condition', switched: true });
      this._emit('output', {});
    }

    setActive(id) {
      if (!this.profiles.find(id) || this.activeId === id) return false;
      this.activeId = id;
      this.view.pages.condition = 0;
      this._emit('profiles', { active: id });
      this._emit('query', { replaced: true });
      this._emit('datasets', { role: 'condition', switched: true });
      return true;
    }

    /** 1 件追加して選択する（index 省略時は最後＝最も低い優先順位） */
    addProfile(profile, index) {
      if (!this.profiles.canAdd()) return null;
      const p = profile instanceof Profile ? profile : new Profile(profile);
      p.name = this.profiles.uniqueName(p.name, p.id);
      this.profiles.insert(p, index);
      this.activeId = p.id;
      this.view.pages.condition = 0;
      this._emitSwitched({ added: [p.id] });
      return p;
    }

    /**
     * まとめて追加する（表から作成・JSON の追加読み込み）。上限を超える分は入れない。
     * @returns {Profile[]} 追加したもの
     */
    insertProfiles(list, index, activateFirst) {
      const room = Math.max(0, Profile.MAX - this.profiles.length);
      const items = list.slice(0, room);
      let at = index === undefined || index === null ? this.profiles.length : index;
      items.forEach((p) => {
        p.name = this.profiles.uniqueName(p.name, p.id);
        at = this.profiles.insert(p, at) + 1;
      });
      if (items.length && activateFirst) this.activeId = items[0].id;
      this._emitSwitched({ added: items.map((p) => p.id) });
      return items;
    }

    removeProfile(id) {
      const idx = this.profiles.indexOf(id);
      if (idx < 0) return null;
      const removed = this.profiles.remove(id);
      if (!this.profiles.length) this.profiles.insert(new Profile({ name: this.profiles.defaultName() }));
      if (this.activeId === id) this.activeId = this.profiles.items[Math.min(idx, this.profiles.length - 1)].id;
      if (this.view.filter === id) this.view.filter = null;
      this.view.pages.condition = 0;
      this._emitSwitched({ removed: id });
      return removed;
    }

    /** 優先順位を変える（to は 0 始まりの位置） */
    moveProfile(id, to) {
      if (!this.profiles.move(id, to)) return false;
      this._emit('profiles', { moved: id });
      return true;
    }

    moveProfileBy(id, delta) {
      const idx = this.profiles.indexOf(id);
      return idx >= 0 && this.moveProfile(id, idx + delta);
    }

    /**
     * 名前を変える。空欄なら元の名前のまま、重なるときは「名前 (2)」にする。
     * @returns {{name:string, adjusted:boolean, empty:boolean}|null}
     */
    renameProfile(id, name) {
      const p = this.profiles.find(id);
      if (!p) return null;
      const requested = Profile.cleanName(name);
      const next = requested ? this.profiles.uniqueName(requested, id) : p.name;
      if (next !== p.name) {
        p.name = next;
        this._emit('profiles', { renamed: id });
      }
      return { name: next, adjusted: !!requested && next !== requested, empty: !requested };
    }

    setProfileEnabled(id, enabled) {
      const p = this.profiles.find(id);
      if (!p || p.enabled === !!enabled) return;
      p.enabled = !!enabled;
      this._emit('profiles', { enabled: id });
    }

    /** patch：{mode:'assign'|'independent', includeUnmatched:boolean} */
    setCombine(patch) {
      const next = cleanCombine(Object.assign({}, this.combine, patch));
      if (next.mode === this.combine.mode && next.includeUnmatched === this.combine.includeUnmatched) return;
      this.combine = next;
      this._emit('profiles', { combine: true });
    }

    /** 一覧をまとめて差し替える（JSON の置き換え・サンプル・全消去） */
    replaceProfiles(list, activeId) {
      this.profiles = new LQ.ProfileList(list.slice(0, Profile.MAX));
      this.activeId = activeId;
      this._ensureProfile();
      this.view.filter = null;
      this.view.pages.condition = 0;
      this._emitSwitched({ replaced: true });
    }

    /* ---------------- サンプル（自分の ① と抽出条件は退避する） ---------------- */

    /**
     * サンプルに切り替える。初回は自分の ①・抽出条件・出力列の並びを退避し、
     * サンプル表示中に自分で作った抽出条件（サンプルの複製など）は残す。
     */
    enterSample(source, list, combine) {
      let own = [];
      if (!this.sampleStash) {
        const src = this.datasets.source;
        this.sampleStash = {
          profiles: this.profiles.items.filter((p) => !p.isSample),
          activeId: this.activeId,
          source: src && !src.isSample ? src : null,
          combine: Util.clone(this.combine),
          outputMemory: Util.clone(this.output.memory)
        };
      } else {
        own = this.profiles.items.filter((p) => !p.isSample);
      }
      this.datasets.source = source;
      this.view.pages.source = 0;
      this.combine = cleanCombine(combine);
      this.replaceProfiles(list.concat(own), list.length ? list[0].id : null);
      this._clearResult();
      this._emit('datasets', { role: 'source' });
    }

    /** サンプルを消し、退避していた ①・抽出条件・出力列の並びに戻す（サンプル表示中に作った抽出条件は後ろに残す） */
    exitSample() {
      const stash = this.sampleStash;
      const own = this.profiles.items.filter((p) => !p.isSample);
      this.sampleStash = null;
      const src = this.datasets.source;
      if (src && src.isSample) {
        this.datasets.source = stash ? stash.source : null;
        this.view.pages.source = 0;
      }
      if (stash) {
        this.combine = stash.combine;
        this.output.setMemory(stash.outputMemory);
      }
      const active = stash && stash.profiles.some((p) => p.id === stash.activeId) ? stash.activeId : null;
      this.replaceProfiles((stash ? stash.profiles : []).concat(own), active);
      this._clearResult();
      this._emit('datasets', { role: 'source' });
    }

    /** 保存の対象：サンプルを除いた自分の抽出条件（サンプル表示中は退避分を先頭に含める） */
    userProfiles() {
      const own = this.profiles.items.filter((p) => !p.isSample);
      return this.sampleStash ? this.sampleStash.profiles.concat(own) : own;
    }

    userActiveId() {
      const p = this.activeProfile;
      if (p && !p.isSample) return p.id;
      return this.sampleStash ? this.sampleStash.activeId : null;
    }

    userCombine() {
      return this.sampleStash ? this.sampleStash.combine : this.combine;
    }

    /** 保存の対象：自分の出力列の並び（サンプル表示中は退避した並び） */
    userOutputMemory() {
      return this.sampleStash ? this.sampleStash.outputMemory : this.output.memory;
    }

    /** ①・抽出条件・出力列の並び・結果をすべて初期状態に戻す */
    resetAll() {
      this.sampleStash = null;
      this.datasets.source = null;
      this.view.pages.source = 0;
      this.combine = cleanCombine(null);
      this.output.clearMemory();
      this.replaceProfiles([], null);
      this._clearResult();
      this._emit('datasets', { role: 'source' });
    }

    /* ---------------- 条件（選択中の抽出条件） ---------------- */

    get conditionLabels() {
      return QueryOps.labels(this.query);
    }

    canAddCondition() {
      return QueryOps.canAdd(this.query);
    }

    findCondition(id) {
      return QueryOps.find(this.query, id);
    }

    addCondition(init) {
      const r = QueryOps.add(this.query, init);
      if (!r) return null;
      this._emit('query', { added: r.cond.id, exprChanged: r.exprChanged });
      return r.cond;
    }

    updateCondition(id, patch) {
      if (QueryOps.update(this.query, id, patch)) this._emit('query', { updated: id });
    }

    removeCondition(id) {
      const r = QueryOps.remove(this.query, id);
      if (!r) return null;
      this._emit('query', { removed: id, exprChanged: r.exprChanged });
      return r.removed;
    }

    setLogicMode(mode) {
      if (QueryOps.setLogicMode(this.query, mode)) this._emit('query', { logic: true });
    }

    setExpr(text) {
      this.query.logic.expr = text;
      this._emit('query', { expr: true });
    }

    setJoinKind(kind) {
      this.query.joinKind = kind;
      this._emit('query', { joinKind: true });
      this._emit('output', {});
    }

    setMatchMode(mode) {
      this.query.matchMode = mode;
      this._emit('query', { matchMode: true });
    }

    /* ---------------- 照合ルール（全体の設定と、抽出条件ごとの個別の設定） ---------------- */

    /** 全体の設定を変える（個別の設定をしていない抽出条件すべてに使う） */
    setRules(patch) {
      Object.assign(this.rules, patch);
      Prefs.set('rules', this.rules);
      this._emit('rules', { keys: Object.keys(patch) });
    }

    /** 抽出条件に使う照合ルール（個別の設定がなければ全体の設定） */
    rulesFor(profile) {
      return profile && profile.rules ? Object.assign({}, Normalizer.DEFAULT_RULES, profile.rules) : this.rules;
    }

    /** 個別の設定を付ける（rules）／外して全体の設定を使う（null） */
    setProfileRules(id, rules) {
      const p = this.profiles.find(id);
      if (!p) return;
      p.rules = rules ? Object.assign({}, Normalizer.DEFAULT_RULES, Normalizer.cleanRules(rules) || {}) : null;
      this._emit('rules', { profile: id });
      this._emit('profiles', { rules: id });
    }

    /** 個別の設定の一部を変える */
    updateProfileRules(id, patch) {
      const p = this.profiles.find(id);
      if (!p || !p.rules) return;
      Object.assign(p.rules, patch);
      this._emit('rules', { profile: id, keys: Object.keys(patch) });
      this._emit('profiles', { rules: id });
    }

    /* ---------------- 出力列（並び・表示は OutputColumns が覚える） ---------------- */

    /** 今使える列（既定の並び・既定の表示）。② の列は全抽出条件の ② の列を名前でまとめる（同じ名前は 1 列） */
    _availableColumns() {
      const available = [];
      const seen = new Set();
      const push = (key, visible) => {
        if (seen.has(key)) return;
        seen.add(key);
        available.push({ key: key, visible: visible });
      };
      const src = this.datasets.source;
      if (src) src.columns.forEach((c) => push('s:' + c.name, true));
      this.profiles.items.forEach((p) => {
        if (p.condition) p.condition.columns.forEach((c) => push('c:' + c.name, false));
      });
      META_KEYS.forEach((key) => push(key, !!META_VISIBLE[key]));
      return available;
    }

    /** 読み込みデータの列に合わせて出力列の一覧を更新する（覚えている表示・並びを名前で引き継ぐ） */
    _syncOutputColumns() {
      this.output.sync(this._availableColumns());
    }

    setColumnVisible(key, visible) {
      if (this.output.setVisible(key, visible)) this._emit('output', { key: key });
    }

    /** prefix：'s:' / 'c:' / 'm:' */
    setGroupVisible(prefix, visible) {
      this.output.setGroupVisible(prefix, visible);
      this._emit('output', { group: prefix });
    }

    /** 指定した列（keys）の表示をまとめて切り替える（一覧の「すべて」用） */
    setColumnsVisible(keys, visible) {
      if (this.output.setManyVisible(keys, visible)) this._emit('output', { many: true });
    }

    /** key を targetKey の前（after=true なら後ろ）へ移す */
    moveColumn(key, targetKey, after) {
      if (this.output.move(key, targetKey, after)) this._emit('output', { moved: key });
    }

    /** delta 個分移動（キーボード操作用） */
    moveColumnBy(key, delta) {
      if (!this.output.moveBy(key, delta)) return false;
      this._emit('output', { moved: key });
      return true;
    }

    applyOutputPreset(visibleKeys) {
      this.output.applyPreset(visibleKeys);
      this._emit('output', { preset: true });
    }

    /** 保存・JSON の出力列の並びを適用する（今ない列も覚えておき、読み込んだときに使う） */
    importOutputColumns(columns) {
      if (!Array.isArray(columns)) return;
      this.output.setMemory(columns);
      this._syncOutputColumns();
      this._emit('output', { imported: true });
    }

    /** 覚えている並びを消し、出力列を初期状態（① の列を表示・② の列を非表示）に戻す */
    resetOutputColumns() {
      this.output.clearMemory();
      this._syncOutputColumns();
      this._emit('output', { reset: true });
    }

    columnCounts() {
      return this.output.counts();
    }

    /* ---------------- 表示 ---------------- */

    setTab(tab) {
      if (this.view.tab === tab) return;
      this.view.tab = tab;
      this._emit('view', { tab: true });
    }

    setPage(tab, page) {
      this.view.pages[tab] = Math.max(0, page);
      this._emit('view', { page: tab });
    }

    setPageSize(size) {
      const next = clampPageSize(size);
      const old = this.view.pageSize;
      Object.keys(this.view.pages).forEach((tab) => {
        this.view.pages[tab] = Math.floor((this.view.pages[tab] * old) / next);
      });
      this.view.pageSize = next;
      Prefs.set('pageSize', next);
      this._emit('view', { pageSize: true });
      return next;
    }

    setSort(sort) {
      this.view.sort = sort;
      this.view.pages.result = 0;
      this._emit('view', { sort: true });
    }

    /** 結果の絞り込み：null＝すべて / 抽出条件の id / UNMATCHED_FILTER＝該当なし */
    setFilter(filter) {
      const next = filter || null;
      if (this.view.filter === next) return;
      this.view.filter = next;
      this.view.pages.result = 0;
      this._emit('view', { filter: true });
    }

    setRaw(role, on) {
      if (this.view.raw[role] === on) return;
      this.view.raw[role] = on;
      this.view.pages[role] = 0;
      this._emit('view', { raw: role });
    }

    /* ---------------- 結果 ---------------- */

    /**
     * 結果に影響する内容の署名。名前の変更は含めない（名前を変えても再抽出は不要）。
     * 照合ルールは抽出条件ごとに実際に使うものを含める（個別の設定に切り替えただけで中身が同じなら変わらない）。
     */
    querySignature() {
      const s = this.datasets.source;
      return JSON.stringify([
        s ? s.id + ':' + s.version : '',
        this.profiles.enabled().map((p) => [p.id, p.condition ? p.condition.id + ':' + p.condition.version : '', QueryOps.signature(p.query),
          Normalizer.signatureOf(this.rulesFor(p))]),
        this.effectiveCombine()
      ]);
    }

    /** signature：抽出を始めた時点の署名（実行中に条件が変わっても「未反映」と判定できる） */
    setResult(result, signature) {
      this.result = result;
      this.resultSignature = result ? (signature || this.querySignature()) : null;
      this.view.pages.result = 0;
      this.view.sort = null;
      this._emit('result', {});
    }

    _clearResult() {
      if (!this.result) return;
      this.result = null;
      this.resultSignature = null;
      this.view.sort = null;
      this._emit('result', { cleared: true });
    }

    isStale() {
      return !!this.result && this.resultSignature !== this.querySignature();
    }

    /* ---------------- 処理中・パネル ---------------- */

    setBusy(busy) {
      this.busy = busy;
      this._emit('busy', {});
    }

    openPanel(id) {
      if (this.panel === id) return;
      this.panel = id;
      this._emit('panel', {});
    }

    closePanel() {
      if (this.panel === null) return;
      this.panel = null;
      this._emit('panel', {});
    }

    togglePanel(id) {
      if (this.panel === id) this.closePanel();
      else this.openPanel(id);
    }

    /* ---------------- 取り消し用のスナップショット ---------------- */

    snapshot() {
      const src = this.datasets.source;
      const stash = this.sampleStash;
      return {
        source: src,
        sourceVersion: src ? src.version : 0,
        profiles: this.profiles.items.map((p) => p.snapshot()),
        activeId: this.activeId,
        combine: Util.clone(this.combine),
        rules: Util.clone(this.rules),
        sampleStash: stash ? {
          profiles: stash.profiles.map((p) => p.snapshot()),
          activeId: stash.activeId,
          source: stash.source,
          combine: Util.clone(stash.combine),
          outputMemory: Util.clone(stash.outputMemory)
        } : null,
        output: this.output.snapshot(),
        view: Util.clone(this.view),
        result: this.result,
        resultSignature: this.resultSignature
      };
    }

    restore(snap) {
      this.datasets.source = snap.source;
      this.profiles = new LQ.ProfileList(snap.profiles.map((s) => Profile.fromSnapshot(s)));
      this.activeId = snap.activeId;
      this._ensureProfile();
      this.combine = cleanCombine(snap.combine);
      if (snap.rules && !Normalizer.sameRules(snap.rules, this.rules)) {
        this.rules = Object.assign({}, Normalizer.DEFAULT_RULES, snap.rules);
        Prefs.set('rules', this.rules);
      }
      const st = snap.sampleStash;
      this.sampleStash = st ? {
        profiles: st.profiles.map((s) => Profile.fromSnapshot(s)),
        activeId: st.activeId,
        source: st.source,
        combine: cleanCombine(st.combine),
        outputMemory: Util.clone(st.outputMemory || [])
      } : null;
      this.output.restore(snap.output);
      this.view = Util.clone(snap.view);
      const src = this.datasets.source;
      const same = (!src || src.version === snap.sourceVersion) &&
        snap.profiles.every((s) => !s.condition || s.condition.version === s.conditionVersion);
      this.result = same ? snap.result : null;
      this.resultSignature = same ? snap.resultSignature : null;
      ['datasets', 'profiles', 'query', 'rules', 'output', 'result', 'view'].forEach((topic) => this._emit(topic, { restored: true }));
    }
  }

  LQ.AppState = AppState;
})(window);
