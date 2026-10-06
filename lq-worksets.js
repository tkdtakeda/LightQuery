/* =========================================================================
 * LightQuery - lq-worksets.js
 * 作業セット：「毎月の顧客抽出」「NG ワードチェック」のような作業ごとの設定一式に名前を付けて
 *   ブラウザ（IndexedDB）に保存し、切り替えて使う。
 *   ・中身は JSON の「すべて」と同じ（抽出条件の一覧と ② のデータ・振り分け・照合ルール・出力列・列の追加・集計・
 *     ① の読み込み範囲と前回のファイル名・表示件数）。① のデータは保存しない（切り替えても読み込み済みの ① はそのまま）
 *   ・開いているセットに変更を自動で保存する（サンプル表示中は保存しない）
 *   ・② の表はセットとは別に保存し、表が入れ替わったときだけ書き直す（条件を直すたびに大きな表を書かない）
 *   ・今の状態の復元は従来どおり localStorage（lq-storage.js）。こちらはセットの保管庫と切り替えを受け持つ
 *
 * （下の区切りごとに独立した部品）
 *   WorksetDB    … IndexedDB の読み書き
 *   WorksetCodec … 状態 ⇄ セットの中身、セット → JSON（「すべて」と同じ形式）
 *   Worksets     … 一覧・自動保存・切替・新規・複製・名前の変更・削除・書き出し
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Util = LQ.Util;
  const Prefs = LQ.Prefs;

  /* ---------------------------------------------------------------------
   * WorksetDB：IndexedDB（sets：セットの中身 / grids：② の表。キーは「セットの id|抽出条件の id」／
   *   results：セットで最後に抽出した結果（前回との比較の「直前の抽出結果」。キーはセットの id）
   * ------------------------------------------------------------------- */
  const DB_NAME = 'lightquery';
  const DB_VERSION = 2;
  const STORE_SETS = 'sets';
  const STORE_GRIDS = 'grids';
  const STORE_RESULTS = 'results';
  /* 覚えておく抽出結果の行数の上限（大きすぎる結果はブラウザの容量を圧迫するため覚えない） */
  const RESULT_MAX_ROWS = 200000;
  const SEP = '|';

  function promisify(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function done(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('保存を中断しました'));
    });
  }

  function gridRange(setId) {
    return IDBKeyRange.bound(setId + SEP, setId + SEP + '￿');
  }

  class WorksetDB {
    constructor() {
      this.db = null;
    }

    open() {
      return new Promise((resolve, reject) => {
        if (!global.indexedDB) {
          reject(new Error('このブラウザではセットを保存できません'));
          return;
        }
        const req = global.indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_SETS)) db.createObjectStore(STORE_SETS, { keyPath: 'id' });
          if (!db.objectStoreNames.contains(STORE_GRIDS)) db.createObjectStore(STORE_GRIDS);
          if (!db.objectStoreNames.contains(STORE_RESULTS)) db.createObjectStore(STORE_RESULTS);
        };
        req.onsuccess = () => {
          this.db = req.result;
          resolve(this);
        };
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('ほかのタブで LightQuery を開いているため、セットの保管庫を開けません'));
      });
    }

    allSets() {
      return promisify(this.db.transaction(STORE_SETS).objectStore(STORE_SETS).getAll());
    }

    getSet(id) {
      return promisify(this.db.transaction(STORE_SETS).objectStore(STORE_SETS).get(id));
    }

    /** セットの ② の表（抽出条件の id → 表） */
    async getGrids(setId) {
      const store = this.db.transaction(STORE_GRIDS).objectStore(STORE_GRIDS);
      const range = gridRange(setId);
      const [keys, values] = await Promise.all([promisify(store.getAllKeys(range)), promisify(store.getAll(range))]);
      const map = new Map();
      keys.forEach((key, i) => map.set(String(key).slice(setId.length + 1), values[i]));
      return map;
    }

    /**
     * セットを書き込む。grids は書き直す表だけ（抽出条件の id → 表）、keep は残す抽出条件の id（ほかの表は消す）。
     * @param {object} record
     * @param {Map<string, Array>} grids
     * @param {Set<string>|null} keep null なら表を消さない
     */
    async putSet(record, grids, keep) {
      const tx = this.db.transaction([STORE_SETS, STORE_GRIDS], 'readwrite');
      tx.objectStore(STORE_SETS).put(record);
      const gstore = tx.objectStore(STORE_GRIDS);
      (grids || new Map()).forEach((grid, pid) => gstore.put(grid, record.id + SEP + pid));
      if (keep) {
        const keys = await promisify(gstore.getAllKeys(gridRange(record.id)));
        keys.forEach((key) => {
          if (!keep.has(String(key).slice(record.id.length + 1))) gstore.delete(key);
        });
      }
      return done(tx);
    }

    removeSet(id) {
      const tx = this.db.transaction([STORE_SETS, STORE_GRIDS, STORE_RESULTS], 'readwrite');
      tx.objectStore(STORE_SETS).delete(id);
      tx.objectStore(STORE_GRIDS).delete(gridRange(id));
      tx.objectStore(STORE_RESULTS).delete(id);
      return done(tx);
    }

    /** セットで最後に抽出した結果（なければ undefined） */
    getResult(setId) {
      return promisify(this.db.transaction(STORE_RESULTS).objectStore(STORE_RESULTS).get(setId));
    }

    putResult(setId, table) {
      const tx = this.db.transaction(STORE_RESULTS, 'readwrite');
      tx.objectStore(STORE_RESULTS).put(table, setId);
      return done(tx);
    }
  }

  /* ---------------------------------------------------------------------
   * WorksetCodec：状態 ⇄ セットの中身
   * ------------------------------------------------------------------- */
  const WorksetCodec = {
    /**
     * 今の状態（自分の分。サンプルは含めない）をセットの中身にする。
     * ① を読み込んでいないときは、前回の ① の記録（prev.read）を引き継ぐ。
     * @returns {{content:object, grids:Map<string, Array>}} grids：抽出条件の id → ② の表
     */
    capture(state, prev) {
      const grids = new Map();
      const profiles = state.userProfiles().map((p) => {
        const plain = { name: p.name, enabled: p.enabled, createdAt: p.createdAt, query: LQ.QueryOps.toPlain(p.query), condition: p.currentRef() };
        if (p.rules) plain.rules = Util.clone(p.rules);
        if (p.condition && !p.condition.isSample) grids.set(p.id, p.condition.grid);
        return { id: p.id, plain: plain, filters: p.condition ? Util.clone(p.condition.filters || []) : [],
          dedup: p.condition && p.condition.dedup ? Util.clone(p.condition.dedup) : null,
          unpivot: p.condition && p.condition.unpivot ? Util.clone(p.condition.unpivot) : null };
      });
      const src = state.datasets.source;
      const read = src && !src.isSample
        ? { source: { settings: Util.clone(src.settings), choices: src.source.exportChoices(), fileName: src.name } }
        : (prev && prev.read) || null;
      return {
        content: {
          profiles: profiles,
          activeId: state.userActiveId(),
          combine: Util.clone(state.userCombine()),
          rules: Util.clone(state.rules),
          output: Util.clone(state.userOutputMemory()),
          derived: Util.clone(state.derived),
          aggregate: Util.clone(state.aggregate),
          charts: Util.clone(state.charts),
          read: read,
          view: { pageSize: state.view.pageSize }
        },
        grids: grids
      };
    },

    /** 中身の要約（一覧に出す件数） */
    stats(content, grids) {
      const list = content.profiles || [];
      return { profiles: list.length, tables: list.filter((p) => grids.has(p.id) || (p.plain.condition && p.plain.condition.fileName)).length };
    },

    /** 空のセットの中身（今の照合ルール・表示件数は引き継ぐ） */
    blank(state) {
      return {
        profiles: [],
        activeId: null,
        combine: null,
        rules: Util.clone(state.rules),
        output: [],
        derived: { source: [], condition: [] },
        aggregate: null,
        charts: null,
        read: null,
        view: { pageSize: state.view.pageSize }
      };
    },

    /**
     * セットの中身を状態にする（① は読み込み済みのまま。同じファイルなら読み込み範囲も当てはめる）。
     * @returns {{missing:number, sourceNote:string}} missing：② のデータがない抽出条件の数
     */
    apply(state, content, grids, applySourceRead) {
      const c = content || {};
      let missing = 0;
      const list = (c.profiles || []).map((item) => {
        const p = LQ.Profile.fromPlain(item.plain, { id: item.id, grid: grids.get(item.id) || null });
        if (p.condition && item.unpivot) p.condition.setUnpivot(LQ.Unpivot.clean(item.unpivot));
        if (p.condition && item.filters && item.filters.length) p.condition.setFilters(item.filters);
        if (p.condition && item.dedup) p.condition.setDedup(item.dedup);
        if (!p.condition && p.conditionRef && p.conditionRef.fileName) missing++;
        return p;
      });
      if (c.rules) state.setRules(Object.assign({}, LQ.Normalizer.DEFAULT_RULES, c.rules));
      state.setCombine(c.combine || { mode: 'assign', includeUnmatched: false });
      ['source', 'condition'].forEach((role) => state.setDerived(role, (c.derived && c.derived[role]) || []));
      state.setAggregate(c.aggregate || null);
      state.setCharts(c.charts || null);
      if (c.view && c.view.pageSize) state.setPageSize(c.view.pageSize);
      state.replaceProfiles(list, c.activeId || null);
      state.importOutputColumns(c.output || []);
      state.setResult(null);
      return { missing: missing, sourceNote: WorksetCodec._sourceNote(state, c.read, applySourceRead) };
    },

    /** ① についての知らせ（同じファイルなら読み込み範囲を当てはめる） */
    _sourceNote(state, read, applySourceRead) {
      const last = read && read.source && read.source.fileName;
      const src = state.datasets.source;
      if (!src || src.isSample) return last ? '① は前回「' + last + '」を使いました' : '';
      if (!last) return '① は「' + src.name + '」のままです';
      if (src.name === last) return applySourceRead(read.source) ? '① に前回の読み込み範囲を当てはめました' : '';
      return '① は「' + src.name + '」のままです（このセットは前回「' + last + '」を使いました）';
    },

    /** セット → JSON（「すべて」と同じ形式。② のデータを含む） */
    toLibraryJson(record, grids) {
      const c = record.content || {};
      return {
        app: 'LightQuery',
        format: 2,
        kind: 'library',
        savedAt: new Date().toISOString(),
        worksetName: record.name,
        profiles: (c.profiles || []).map((item, i) => {
          const plain = Util.clone(item.plain);
          plain.priority = i + 1;
          if (plain.condition && grids.has(item.id)) plain.condition.grid = grids.get(item.id);
          return plain;
        }),
        combine: c.combine || { mode: 'assign', includeUnmatched: false },
        rules: c.rules || null,
        output: { columns: c.output || [] },
        derived: c.derived || { source: [], condition: [] },
        aggregate: c.aggregate || null,
        charts: c.charts || null,
        read: c.read || {},
        view: c.view || null
      };
    }
  };

  /* ---------------------------------------------------------------------
   * Worksets：一覧・自動保存・切替
   * ------------------------------------------------------------------- */
  const ACTIVE_KEY = 'worksets.active';
  const SAVE_DELAY = 800;
  const MAX_SETS = 50;
  const NAME_MAX = 40;
  const SAVE_TOPICS = new Set(['profiles', 'query', 'datasets', 'rules', 'output', 'aggregate', 'charts']);

  class Worksets {
    /**
     * @param {object} app LQ.App（状態・通知・① の読み込み範囲の当てはめに使う）
     */
    constructor(app) {
      this.app = app;
      this.state = app.state;
      this.bus = app.bus;
      this.toasts = app.toasts;
      this.db = new WorksetDB();
      this.sets = [];
      this.activeId = null;
      this.available = false;
      this.ready = false;
      this.failure = '';
      this._timer = null;
      this._applying = false;
      this._written = new Map();
      this._chain = Promise.resolve();
    }

    static get MAX() {
      return MAX_SETS;
    }

    get active() {
      return this.sets.find((s) => s.id === this.activeId) || null;
    }

    /** 最近使った順 */
    list() {
      return this.sets.slice().sort((a, b) => (b.usedAt || '').localeCompare(a.usedAt || ''));
    }

    /**
     * 保管庫を開き、開いていたセットを選ぶ。初めてなら今の状態を「作業セット 1」にする。
     * localStorage から復元できなかった ② があれば、セットに保存してある表で補う。
     * @param {{count:number, missing:number}|null} restored ProfileStore.restore の結果
     */
    async init(restored) {
      try {
        await this.db.open();
        this.sets = await this.db.allSets();
        this.available = true;
      } catch (err) {
        this.failure = (err && err.message) || 'セットの保管庫を開けません';
        this._changed();
        return;
      }
      const remembered = Prefs.get(ACTIVE_KEY, null);
      const found = this.sets.find((s) => s.id === remembered);
      if (!this.sets.length) {
        await this._createFromState(this._nextName());
      } else if (!found) {
        if (this._stateIsBlank()) await this._open(this.list()[0], { quiet: true });
        else await this._createFromState(this._nextName());
      } else {
        this.activeId = found.id;
        if (!restored || restored.missing) await this._open(found, { quiet: true, onlyIfContent: true });
      }
      this.ready = true;
      await this._loadResult(this.activeId);
      this.bus.on('change', (e) => {
        if (SAVE_TOPICS.has(e.topic) || (e.topic === 'view' && e.detail && e.detail.pageSize)) this.schedule();
      });
      global.addEventListener('pagehide', () => this.flush());
      this._changed();
    }

    _stateIsBlank() {
      return this.state.userProfiles().every((p) => p.isBlank());
    }

    _nextName() {
      const names = new Set(this.sets.map((s) => s.name));
      let n = this.sets.length + 1;
      while (names.has('作業セット ' + n)) n++;
      return '作業セット ' + n;
    }

    _uniqueName(base) {
      const names = new Set(this.sets.map((s) => s.name));
      const head = String(base || '').trim().slice(0, NAME_MAX) || this._nextName();
      if (!names.has(head)) return head;
      let n = 2;
      while (names.has(head + ' (' + n + ')')) n++;
      return head + ' (' + n + ')';
    }

    _changed() {
      this.bus.emit('worksets', {});
    }

    /** 保存できる状態か（サンプル表示中・切替中は保存しない） */
    _canSave() {
      return this.ready && this.available && !!this.active && !this._applying && !this.state.sampleStash && !this.state.hasSample();
    }

    schedule() {
      if (!this._canSave()) return;
      clearTimeout(this._timer);
      this._timer = setTimeout(() => this.flush(), SAVE_DELAY);
    }

    /** 開いているセットに今の状態を書き込む（順番に実行する） */
    flush() {
      clearTimeout(this._timer);
      this._timer = null;
      if (!this._canSave()) return this._chain;
      const record = this.active;
      const cap = WorksetCodec.capture(this.state, record.content);
      record.content = cap.content;
      record.updatedAt = new Date().toISOString();
      record.stats = WorksetCodec.stats(cap.content, cap.grids);
      const changed = new Map();
      cap.grids.forEach((grid, pid) => {
        const key = record.id + SEP + pid;
        if (this._written.get(key) !== grid) changed.set(pid, grid);
      });
      const keep = new Set(cap.grids.keys());
      return this._enqueue(async () => {
        await this.db.putSet(record, changed, keep);
        changed.forEach((grid, pid) => this._written.set(record.id + SEP + pid, grid));
      });
    }

    _enqueue(task) {
      this._chain = this._chain.then(task).catch((err) => {
        this.toasts.show({ type: 'warn', title: '作業セットを保存できませんでした', message: (err && err.message) || '' });
      });
      return this._chain;
    }

    /** 切り替えなどの前に確かめる（処理中・サンプル表示中は不可）。@returns {boolean} 進めてよいか */
    _guard() {
      if (!this.available) {
        this.toasts.show({ type: 'warn', title: '作業セットを使えません', message: this.failure });
        return false;
      }
      if (this.app._blockedByBusy()) return false;
      if (this.state.sampleStash || this.state.hasSample()) {
        this.toasts.show({
          type: 'warn', title: 'サンプルを表示中は作業セットを切り替えられません', message: '先にサンプルデータを消去してください（自分の設定に戻ります）。',
          actions: [{ label: 'サンプルデータのみクリア', icon: 'eraser', onClick: () => this.app.profiles.clearSamples() }]
        });
        return false;
      }
      return true;
    }

    /** セットを開く（今のセットは先に保存する） */
    async switchTo(id) {
      if (id === this.activeId || !this._guard()) return;
      const target = this.sets.find((s) => s.id === id);
      if (!target) return;
      const from = this.active;
      await this.flush();
      const info = await this._open(target, {});
      if (!info) return;
      this.toasts.show({
        type: 'success',
        title: '作業セット「' + target.name + '」に切り替えました',
        message: this._notes(info).join('。') || '抽出条件 ' + this.state.profiles.length + ' 件',
        actions: from ? [{ label: '元に戻す', icon: 'rotate-left', onClick: () => this.switchTo(from.id) }] : []
      });
    }

    _notes(info) {
      const notes = [];
      if (info.sourceNote) notes.push(info.sourceNote);
      if (info.missing) notes.push('② のデータがない ' + info.missing + ' 件は、使う前に ② を読み込んでください');
      return notes;
    }

    /**
     * セットの中身を状態にする。
     * @param {{quiet?:boolean, onlyIfContent?:boolean}} opts onlyIfContent：抽出条件がないセットなら何もしない
     */
    async _open(record, opts) {
      const o = opts || {};
      if (o.onlyIfContent && !(record.content && record.content.profiles && record.content.profiles.length)) return null;
      let grids;
      try {
        grids = await this.db.getGrids(record.id);
      } catch (err) {
        if (!o.quiet) this.toasts.show({ type: 'error', title: '作業セットを開けませんでした', message: (err && err.message) || '' });
        return null;
      }
      this._applying = true;
      let info;
      try {
        info = WorksetCodec.apply(this.state, record.content, grids, (read) => this.app.profiles._applySourceRead(read));
      } finally {
        this._applying = false;
      }
      grids.forEach((grid, pid) => this._written.set(record.id + SEP + pid, grid));
      this.activeId = record.id;
      record.usedAt = new Date().toISOString();
      Prefs.set(ACTIVE_KEY, record.id);
      this._enqueue(() => this.db.putSet(record, null, null));
      await this._loadResult(record.id);
      this._changed();
      return info;
    }

    /** セットで最後に抽出した結果を、前回との比較の「直前の抽出結果」の候補にする */
    async _loadResult(setId) {
      let table = null;
      try {
        table = setId && this.available ? (await this.db.getResult(setId)) || null : null;
      } catch (err) {
        table = null;
      }
      this.app.compare.useSaved(table);
    }

    /**
     * 抽出結果を、開いているセットの「最後に抽出した結果」として覚える（サンプル表示中・大きすぎる結果は覚えない）
     * @param {{name:string, header:string[], rows:string[][], at:Date}} table
     * @returns {boolean} 覚えたか
     */
    saveResult(table) {
      if (!this._canSave() || !table || table.rows.length > RESULT_MAX_ROWS) return false;
      const id = this.activeId;
      this._enqueue(() => this.db.putResult(id, { name: table.name, kind: 'previous', header: table.header, rows: table.rows, at: table.at }));
      return true;
    }

    /** 今の状態から新しいセットを作って開いている扱いにする（初回の引き継ぎ用） */
    async _createFromState(name) {
      const now = new Date().toISOString();
      const record = { id: Util.uid('ws'), name: name, createdAt: now, updatedAt: now, usedAt: now, content: WorksetCodec.blank(this.state), stats: { profiles: 0, tables: 0 } };
      this.sets.push(record);
      this.activeId = record.id;
      Prefs.set(ACTIVE_KEY, record.id);
      this.ready = true;
      await this.flush();
      this._changed();
      return record;
    }

    _full() {
      if (this.sets.length < MAX_SETS) return false;
      this.toasts.show({ type: 'warn', title: '作業セットは最大 ' + MAX_SETS + ' 件です', message: '使わないセットを書き出してから削除してください。' });
      return true;
    }

    /**
     * 空の新しいセットを作って開く。
     * @param {string} [name]
     * @param {{quiet?:boolean}} [opts] quiet：作ったことを知らせない（続けて中身を入れるとき）
     * @returns {Promise<object|null>} 作ったセット
     */
    async create(name, opts) {
      if (!this._guard() || this._full()) return null;
      await this.flush();
      const from = this.active;
      const now = new Date().toISOString();
      const record = { id: Util.uid('ws'), name: this._uniqueName(name || this._nextName()), createdAt: now, updatedAt: now, usedAt: now,
        content: WorksetCodec.blank(this.state), stats: { profiles: 0, tables: 0 } };
      this.sets.push(record);
      await this._enqueue(() => this.db.putSet(record, null, null));
      await this._open(record, {});
      if (opts && opts.quiet) return record;
      this.toasts.show({
        type: 'success', title: '作業セット「' + record.name + '」を作りました',
        message: '① 元データはそのままです。② と抽出条件を用意してください（変更はこのセットに自動で保存されます）。',
        actions: from ? [{ label: '元に戻す', icon: 'rotate-left', onClick: () => this._undoCreate(record.id, from.id) }] : []
      });
      return record;
    }

    async _undoCreate(newId, backId) {
      await this.switchTo(backId);
      if (this.activeId === backId) await this._delete(newId);
    }

    /** セットを複製する（抽出条件の id は振り直す）。開いているセットは保存してから複製する */
    async duplicate(id) {
      if (!this.available || this._full()) return null;
      if (id === this.activeId) await this.flush();
      const src = this.sets.find((s) => s.id === id);
      if (!src) return null;
      const grids = await this.db.getGrids(id);
      const remap = new Map();
      const content = Util.clone(src.content || {});
      (content.profiles || []).forEach((item) => {
        const next = Util.uid('prof');
        remap.set(item.id, next);
        item.id = next;
      });
      if (content.activeId) content.activeId = remap.get(content.activeId) || null;
      const copied = new Map();
      grids.forEach((grid, pid) => {
        if (remap.has(pid)) copied.set(remap.get(pid), grid);
      });
      const now = new Date().toISOString();
      const record = { id: Util.uid('ws'), name: this._uniqueName(src.name + ' のコピー'), createdAt: now, updatedAt: now, usedAt: '',
        content: content, stats: Util.clone(src.stats || {}) };
      this.sets.push(record);
      await this._enqueue(() => this.db.putSet(record, copied, null));
      this._changed();
      this.toasts.show({ type: 'success', title: '「' + src.name + '」を複製しました', message: '「' + record.name + '」を一覧に加えました（開くと使えます）。' });
      return record;
    }

    /** @returns {string|null} 変えられなかった理由 */
    rename(id, name) {
      const record = this.sets.find((s) => s.id === id);
      const next = String(name || '').trim().slice(0, NAME_MAX);
      if (!record) return null;
      if (!next) return '名前を入力してください';
      if (this.sets.some((s) => s.id !== id && s.name === next)) return '同じ名前のセットがあります';
      if (record.name === next) return null;
      record.name = next;
      this._enqueue(() => this.db.putSet(record, null, null));
      this._changed();
      return null;
    }

    /** 削除する（開いているセットは削除できない）。通知の「元に戻す」で戻せる */
    async remove(id) {
      if (!this.available || id === this.activeId) return;
      const record = this.sets.find((s) => s.id === id);
      if (!record) return;
      const grids = await this.db.getGrids(id);
      await this._delete(id);
      this.toasts.show({
        type: 'info', title: '作業セット「' + record.name + '」を削除しました', message: '',
        actions: [{ label: '元に戻す', icon: 'rotate-left', onClick: () => this._restore(record, grids) }]
      });
    }

    async _delete(id) {
      this.sets = this.sets.filter((s) => s.id !== id);
      await this._enqueue(() => this.db.removeSet(id));
      this._changed();
    }

    async _restore(record, grids) {
      if (this.sets.some((s) => s.id === record.id)) return;
      this.sets.push(record);
      await this._enqueue(() => this.db.putSet(record, grids, null));
      this._changed();
      this.toasts.show({ type: 'success', title: '作業セット「' + record.name + '」を戻しました', message: '' });
    }

    /** セットを JSON に書き出す（② のデータを含む。読み込みは「読込」またはドラッグ＆ドロップ） */
    async exportSet(id) {
      if (id === this.activeId) await this.flush();
      const record = this.sets.find((s) => s.id === id);
      if (!record) return;
      const grids = await this.db.getGrids(id);
      const blob = new Blob([LQ.Bundle.stringify(WorksetCodec.toLibraryJson(record, grids))], { type: 'application/json' });
      const name = Util.sanitizeFileName('LightQuery_' + record.name + '_' + Util.timestamp()) + '.json';
      LQ.Exporters.download(blob, name);
      this.toasts.show({ type: 'success', title: '作業セット「' + record.name + '」を書き出しました',
        message: name + '（' + Util.formatBytes(blob.size) + '・② のデータを含む）。ほかの PC では「読込」で新しいセットとして追加できます。' });
    }

    /**
     * 一括の JSON を新しいセットとして加えて開く。
     * @param {object} bundle LQ.Bundle.parse の結果
     * @param {string} fileName
     * @param {string} [name] セットの名前（JSON に入っている名前・ファイル名）
     */
    async importAsNew(bundle, fileName, name) {
      const record = await this.create(name || Util.baseName(fileName), { quiet: true });
      if (!record) return;
      this.app.profiles.applyBundle(bundle, 'replace', fileName);
    }

    /** 開いているセットで前回使った ① のファイル名（なければ ''） */
    lastSourceName() {
      const record = this.active;
      const read = record && record.content && record.content.read;
      return read && read.source ? read.source.fileName || '' : '';
    }
  }

  LQ.WorksetDB = WorksetDB;
  LQ.WorksetCodec = WorksetCodec;
  LQ.Worksets = Worksets;
})(window);
