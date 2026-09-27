/* =========================================================================
 * LightQuery - lq-state.js
 * アプリの状態（読み込みデータ・条件・照合ルール・出力列・表示・結果）を一か所で管理し、
 *   変更を話題（topic）ごとに通知する。画面部品は状態を直接書き換えず、必ずここを通す。
 *   topic：datasets / query / rules / output / result / view / busy / panel（加えて change）
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Util = LQ.Util;
  const Prefs = LQ.Prefs;
  const Logic = LQ.Logic;

  const MAX_CONDITIONS = 26;
  const PAGE_SIZE_MAX = 5000;
  const DEFAULT_PAGE_SIZE = 100;
  const META_KEYS = ['m:srcRow', 'm:condRow', 'm:count'];

  function defaultQuery() {
    return { conditions: [], logic: { mode: 'and', expr: '' }, joinKind: 'inner', matchMode: 'first', origin: 'user' };
  }

  function clampPageSize(n) {
    const v = parseInt(n, 10);
    return Util.clamp(isFinite(v) && v > 0 ? v : DEFAULT_PAGE_SIZE, 1, PAGE_SIZE_MAX);
  }

  class AppState {
    constructor(bus) {
      this.bus = bus;
      this.datasets = { source: null, condition: null };
      this.query = defaultQuery();
      this.rules = Object.assign({}, LQ.Normalizer.DEFAULT_RULES, Prefs.get('rules', {}));
      this.output = { columns: [] };
      this.view = {
        tab: 'result',
        pageSize: clampPageSize(Prefs.get('pageSize', DEFAULT_PAGE_SIZE)),
        pages: { result: 0, source: 0, condition: 0 },
        sort: null,
        raw: { source: false, condition: false }
      };
      this.result = null;
      this.resultSignature = null;
      this.busy = null;
      this.panel = null;
    }

    static get MAX_CONDITIONS() {
      return MAX_CONDITIONS;
    }

    static get PAGE_SIZE_MAX() {
      return PAGE_SIZE_MAX;
    }

    _emit(topic, detail) {
      this.bus.emit(topic, detail || {});
      this.bus.emit('change', { topic: topic, detail: detail || {} });
    }

    /* ---------------- 読み込みデータ ---------------- */

    setDataset(role, dataset) {
      this.datasets[role] = dataset;
      this.view.pages[role] = 0;
      this._afterDatasetChange(role);
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
      const d = this.datasets;
      return !!((d.source && d.source.isSample) || (d.condition && d.condition.isSample));
    }

    /* ---------------- 条件 ---------------- */

    get conditionLabels() {
      return this.query.conditions.map((c) => c.label);
    }

    canAddCondition() {
      return this.query.conditions.length < MAX_CONDITIONS;
    }

    findCondition(id) {
      return this.query.conditions.find((c) => c.id === id) || null;
    }

    _nextLabel() {
      const used = new Set(this.conditionLabels);
      let max = -1;
      used.forEach((label) => {
        max = Math.max(max, label.charCodeAt(0) - 65);
      });
      for (let i = max + 1; i < 26; i++) {
        const label = String.fromCharCode(65 + i);
        if (!used.has(label)) return label;
      }
      for (let i = 0; i < 26; i++) {
        const label = String.fromCharCode(65 + i);
        if (!used.has(label)) return label;
      }
      return null;
    }

    addCondition(init) {
      if (!this.canAddCondition()) return null;
      const label = this._nextLabel();
      const base = { id: Util.uid('cond'), left: '', op: 'eq', right: { type: 'column', col: '', value: '' } };
      const cond = Object.assign(base, init || {}, { label: label });
      cond.right = Object.assign({ type: 'column', col: '', value: '' }, (init && init.right) || {});
      const labelsBefore = this.conditionLabels;
      this.query.conditions.push(cond);
      if (this.query.logic.mode === 'expr') {
        const parsed = Logic.parse(this.query.logic.expr, labelsBefore);
        if (parsed.ok) {
          const children = parsed.ast.type === 'and' ? parsed.ast.children.slice() : [parsed.ast];
          children.push({ type: 'cond', label: label });
          this.query.logic.expr = Logic.serialize({ type: 'and', children: children });
        } else {
          const expr = this.query.logic.expr.trim();
          this.query.logic.expr = expr ? expr + ' and ' + label : label;
        }
      }
      this._emit('query', { added: cond.id, exprChanged: this.query.logic.mode === 'expr' });
      return cond;
    }

    updateCondition(id, patch) {
      const cond = this.findCondition(id);
      if (!cond) return;
      Object.keys(patch).forEach((key) => {
        if (key === 'right') cond.right = Object.assign({}, cond.right, patch.right);
        else if (key !== 'id' && key !== 'label') cond[key] = patch[key];
      });
      this._emit('query', { updated: id });
    }

    removeCondition(id) {
      const idx = this.query.conditions.findIndex((c) => c.id === id);
      if (idx < 0) return null;
      const labelsBefore = this.conditionLabels;
      const removed = this.query.conditions.splice(idx, 1)[0];
      let exprChanged = false;
      if (this.query.logic.expr.trim()) {
        const parsed = Logic.parse(this.query.logic.expr, labelsBefore);
        if (parsed.ok) {
          const ast = Logic.removeLabel(parsed.ast, removed.label);
          this.query.logic.expr = ast ? Logic.serialize(ast) : '';
          exprChanged = true;
        }
      }
      this._emit('query', { removed: id, exprChanged: exprChanged && this.query.logic.mode === 'expr' });
      return removed;
    }

    setLogicMode(mode) {
      if (mode === this.query.logic.mode) return;
      if (mode === 'expr' && !this.query.logic.expr.trim()) {
        const ast = Logic.fromMode(this.query.logic.mode, this.conditionLabels);
        this.query.logic.expr = ast ? Logic.serialize(ast) : '';
      }
      this.query.logic.mode = mode;
      this._emit('query', { logic: true });
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

    /** 条件一式の差し替え（サンプル・設定ファイル読み込み用） */
    replaceQuery(query, origin) {
      const q = defaultQuery();
      q.origin = origin || 'user';
      q.logic = Object.assign({ mode: 'and', expr: '' }, query.logic || {});
      q.joinKind = query.joinKind || 'inner';
      q.matchMode = query.matchMode || 'first';
      this.query = q;
      (query.conditions || []).forEach((c) => {
        const cond = {
          id: Util.uid('cond'),
          label: c.label,
          left: c.left || '',
          op: c.op || 'eq',
          right: Object.assign({ type: 'column', col: '', value: '' }, c.right || {})
        };
        if (!cond.label || this.conditionLabels.indexOf(cond.label) !== -1) cond.label = this._nextLabel();
        q.conditions.push(cond);
      });
      this._emit('query', { replaced: true });
    }

    resetQuery() {
      this.query = defaultQuery();
      this._emit('query', { replaced: true });
    }

    /* ---------------- 照合ルール ---------------- */

    setRules(patch) {
      Object.assign(this.rules, patch);
      Prefs.set('rules', this.rules);
      this._emit('rules', { keys: Object.keys(patch) });
    }

    /* ---------------- 出力列 ---------------- */

    /** 読み込みデータの列に合わせて出力列の一覧を更新（既存の並び・表示は名前で引き継ぐ） */
    _syncOutputColumns() {
      const available = [];
      const src = this.datasets.source;
      const cond = this.datasets.condition;
      if (src) src.columns.forEach((c) => available.push({ key: 's:' + c.name, visible: true }));
      if (cond) cond.columns.forEach((c) => available.push({ key: 'c:' + c.name, visible: false }));
      META_KEYS.forEach((key) => available.push({ key: key, visible: false }));
      const availableKeys = new Set(available.map((a) => a.key));
      const list = this.output.columns.filter((c) => availableKeys.has(c.key));
      const known = new Set(list.map((c) => c.key));
      available.forEach((a) => {
        if (known.has(a.key)) return;
        const prefix = a.key.slice(0, 2);
        let at = -1;
        for (let i = list.length - 1; i >= 0; i--) {
          if (list[i].key.slice(0, 2) === prefix) {
            at = i + 1;
            break;
          }
        }
        if (at < 0) {
          if (prefix === 's:') at = 0;
          else if (prefix === 'c:') at = list.filter((c) => c.key.slice(0, 2) !== 'm:').length;
          else at = list.length;
        }
        list.splice(at, 0, { key: a.key, visible: a.visible });
        known.add(a.key);
      });
      this.output.columns = list;
    }

    setColumnVisible(key, visible) {
      const col = this.output.columns.find((c) => c.key === key);
      if (!col || col.visible === visible) return;
      col.visible = visible;
      this._emit('output', { key: key });
    }

    /** kind：'s:' / 'c:' / 'm:' */
    setGroupVisible(prefix, visible) {
      this.output.columns.forEach((c) => {
        if (c.key.slice(0, 2) === prefix) c.visible = visible;
      });
      this._emit('output', { group: prefix });
    }

    /** key を targetKey の前（after=true なら後ろ）へ移す */
    moveColumn(key, targetKey, after) {
      if (key === targetKey) return;
      const list = this.output.columns;
      const from = list.findIndex((c) => c.key === key);
      if (from < 0) return;
      const item = list.splice(from, 1)[0];
      let to = list.findIndex((c) => c.key === targetKey);
      if (to < 0) {
        list.splice(from, 0, item);
        return;
      }
      if (after) to += 1;
      list.splice(to, 0, item);
      this._emit('output', { moved: key });
    }

    /** 表示中の列だけを数えて delta 個分移動（キーボード操作用） */
    moveColumnBy(key, delta) {
      const list = this.output.columns;
      const idx = list.findIndex((c) => c.key === key);
      const target = idx + delta;
      if (idx < 0 || target < 0 || target >= list.length) return false;
      const item = list.splice(idx, 1)[0];
      list.splice(target, 0, item);
      this._emit('output', { moved: key });
      return true;
    }

    applyOutputPreset(visibleKeys) {
      const order = visibleKeys.filter((key) => this.output.columns.some((c) => c.key === key));
      const rest = this.output.columns.filter((c) => order.indexOf(c.key) === -1).map((c) => ({ key: c.key, visible: false }));
      this.output.columns = order.map((key) => ({ key: key, visible: true })).concat(rest);
      this._emit('output', { preset: true });
    }

    columnCounts() {
      const counts = { 's:': { visible: 0, total: 0 }, 'c:': { visible: 0, total: 0 }, 'm:': { visible: 0, total: 0 } };
      this.output.columns.forEach((c) => {
        const bucket = counts[c.key.slice(0, 2)];
        bucket.total++;
        if (c.visible) bucket.visible++;
      });
      return counts;
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

    setRaw(role, on) {
      if (this.view.raw[role] === on) return;
      this.view.raw[role] = on;
      this.view.pages[role] = 0;
      this._emit('view', { raw: role });
    }

    /* ---------------- 結果 ---------------- */

    querySignature() {
      const s = this.datasets.source;
      const c = this.datasets.condition;
      return JSON.stringify([
        s ? s.id + ':' + s.version : '',
        c ? c.id + ':' + c.version : '',
        this.query.conditions.map((k) => [k.label, k.left, k.op, k.right.type, k.right.col || '', k.right.value || '']),
        this.query.logic,
        this.query.joinKind,
        this.query.matchMode,
        this.rules
      ]);
    }

    /** signature：抽出を始めた時点の条件の署名（実行中に条件が変わっても「未反映」と判定できる） */
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
      const d = this.datasets;
      return {
        datasets: { source: d.source, condition: d.condition },
        versions: { source: d.source ? d.source.version : 0, condition: d.condition ? d.condition.version : 0 },
        query: Util.clone(this.query),
        output: Util.clone(this.output),
        view: Util.clone(this.view),
        result: this.result,
        resultSignature: this.resultSignature
      };
    }

    restore(snap) {
      this.datasets = { source: snap.datasets.source, condition: snap.datasets.condition };
      this.query = Util.clone(snap.query);
      this.output = Util.clone(snap.output);
      this.view = Util.clone(snap.view);
      const d = this.datasets;
      const sameVersions = (!d.source || d.source.version === snap.versions.source) &&
        (!d.condition || d.condition.version === snap.versions.condition);
      this.result = sameVersions ? snap.result : null;
      this.resultSignature = sameVersions ? snap.resultSignature : null;
      ['datasets', 'query', 'output', 'result', 'view'].forEach((topic) => this._emit(topic, { restored: true }));
    }

    /* ---------------- 条件設定の保存・読み込み（JSON） ---------------- */

    exportSettings() {
      const read = {};
      ['source', 'condition'].forEach((role) => {
        const ds = this.datasets[role];
        if (ds) read[role] = { settings: Util.clone(ds.settings), choices: ds.source.exportChoices(), fileName: ds.name };
      });
      return {
        app: 'LightQuery',
        format: 1,
        savedAt: new Date().toISOString(),
        query: {
          conditions: this.query.conditions.map((c) => ({ label: c.label, left: c.left, op: c.op, right: Util.clone(c.right) })),
          logic: Util.clone(this.query.logic),
          joinKind: this.query.joinKind,
          matchMode: this.query.matchMode
        },
        rules: Util.clone(this.rules),
        output: { columns: Util.clone(this.output.columns) },
        read: read,
        view: { pageSize: this.view.pageSize }
      };
    }

    /**
     * 保存した設定を適用する。読み込み範囲の設定は、同じ役割のデータが読み込まれていれば適用する。
     * @returns {{conditions:number, appliedRead:string[]}}
     */
    importSettings(obj) {
      if (!obj || obj.app !== 'LightQuery' || obj.format !== 1 || !obj.query || !Array.isArray(obj.query.conditions)) {
        throw new Error('LightQuery の条件設定ファイルではありません');
      }
      const appliedRead = [];
      ['source', 'condition'].forEach((role) => {
        const ds = this.datasets[role];
        const read = obj.read && obj.read[role];
        if (!ds || !read) return;
        if (ds.source.applyChoices(read.choices)) ds.reload(read.settings);
        else if (read.settings) ds.applySettings(LQ.Dataset.normalizeSettings(read.settings));
        appliedRead.push(role);
      });
      if (appliedRead.length) {
        this._syncOutputColumns();
        this._clearResult();
        this._emit('datasets', { role: 'both' });
      }
      if (obj.rules) this.setRules(obj.rules);
      this.replaceQuery(obj.query, 'user');
      if (obj.output && Array.isArray(obj.output.columns)) {
        this.output.columns = obj.output.columns
          .filter((c) => c && typeof c.key === 'string')
          .map((c) => ({ key: c.key, visible: !!c.visible }));
        this._syncOutputColumns();
        this._emit('output', { imported: true });
      }
      if (obj.view && obj.view.pageSize) this.setPageSize(obj.view.pageSize);
      return { conditions: this.query.conditions.length, appliedRead: appliedRead };
    }
  }

  LQ.AppState = AppState;
})(window);
