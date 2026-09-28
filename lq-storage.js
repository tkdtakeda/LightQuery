/* =========================================================================
 * LightQuery - lq-storage.js
 * 抽出条件の一覧をブラウザ（localStorage）に自動保存し、次に開いたときに復元する。
 *   ・保存するのは自分の抽出条件（サンプルは保存しない）と、並び順・選択中・振り分けの設定
 *   ・② の中身も保存する。1 件 1,000,000 文字・合計 2,000,000 文字を超える分はファイル名と読み込み範囲だけを記録する
 *   ・書き込みは変更から少し待ってまとめて行い、変わっていないものは書き直さない
 *   ・① 元データは保存しない
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const QueryOps = LQ.QueryOps;

  const PREFIX = 'lightquery.v1.';
  const KEY_LIBRARY = PREFIX + 'library';
  const KEY_PROFILE = PREFIX + 'profile.';
  const KEY_DATA = PREFIX + 'pdata.';
  const DATA_LIMIT = 1000000;
  const TOTAL_LIMIT = 2000000;
  const SAVE_DELAY = 400;
  const TOPICS = new Set(['profiles', 'query', 'datasets']);
  const REASON_TEXT = {
    size: '② が大きいため、ブラウザにはファイル名だけを保存しています（次回は ② を読み込み直してください）',
    total: '保存容量の上限のため、ブラウザにはファイル名だけを保存しています（次回は ② を読み込み直してください）',
    quota: 'ブラウザの保存容量を超えたため、② はファイル名だけを保存しています',
    unavailable: 'このブラウザの設定では保存できません。JSON に書き出して保管してください'
  };

  function storage() {
    try {
      return global.localStorage || null;
    } catch (e) {
      return null;
    }
  }

  function read(ls, key) {
    try {
      const raw = ls.getItem(key);
      return raw === null ? null : JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  class ProfileStore {
    constructor(state, bus) {
      this.state = state;
      this.bus = bus;
      this._written = new Map();
      this._dataGrid = new Map();
      this._gridText = new WeakMap();
      this._status = new Map();
      this._timer = null;
      this._notice = null;
      this._warned = new Set();
    }

    static reasonText(reason) {
      return REASON_TEXT[reason] || '';
    }

    /**
     * 前回の一覧を状態に読み込む（画面を組み立てる前に呼ぶ）。
     * @returns {{count:number, missing:number}|null} 復元した件数と、② を読み込み直す必要がある件数
     */
    restore() {
      const ls = storage();
      if (!ls) return null;
      const lib = read(ls, KEY_LIBRARY);
      if (!lib || !Array.isArray(lib.order)) return null;
      const profiles = [];
      let missing = 0;
      lib.order.forEach((id) => {
        if (typeof id !== 'string') return;
        const def = read(ls, KEY_PROFILE + id);
        if (!def) return;
        const cond = def.condition && typeof def.condition === 'object' ? def.condition : null;
        const data = cond && cond.stored ? read(ls, KEY_DATA + id) : null;
        const p = LQ.Profile.fromPlain(def, { id: id, grid: data && Array.isArray(data.grid) ? data.grid : null });
        if (p.condition) {
          this._dataGrid.set(id, p.condition.grid);
          this._status.set(id, { stored: true, reason: null });
        } else if (cond && cond.fileName) {
          missing++;
          this._status.set(id, { stored: false, reason: cond.stored ? 'quota' : (cond.reason || 'size') });
        }
        profiles.push(p);
      });
      if (!profiles.length || profiles.every((p) => p.isBlank())) return null;
      this.state.replaceProfiles(profiles, typeof lib.activeId === 'string' ? lib.activeId : null);
      if (lib.combine) this.state.setCombine(lib.combine);
      return { count: profiles.length, missing: missing };
    }

    /** 状態の変化を見て自動保存を始める。onNotice({type,title,message}) は保存できないときの知らせ */
    attach(onNotice) {
      this._notice = onNotice || null;
      this.bus.on('change', (e) => {
        if (TOPICS.has(e.topic)) this.schedule();
      });
      global.addEventListener('pagehide', () => this.flush());
      global.addEventListener('beforeunload', () => this.flush());
    }

    schedule() {
      clearTimeout(this._timer);
      this._timer = setTimeout(() => this.flush(), SAVE_DELAY);
    }

    /** ② の保存状態（{stored, reason}）。② がない・未保存なら null */
    statusOf(id) {
      return this._status.get(id) || null;
    }

    /** 今すぐ保存する */
    flush() {
      clearTimeout(this._timer);
      this._timer = null;
      const ls = storage();
      if (!ls) {
        this._warnOnce('unavailable');
        return;
      }
      const s = this.state;
      const profiles = s.userProfiles();
      const previous = this._status;
      const before = JSON.stringify(Array.from(previous.entries()));
      this._status = new Map();
      let total = 0;
      let quota = false;
      let failed = false;
      profiles.forEach((p) => {
        const ref = p.currentRef();
        let stored = false;
        let reason = null;
        if (p.condition) {
          const grid = p.condition.grid;
          const text = this._gridJson(grid);
          if (text.length > DATA_LIMIT) reason = 'size';
          else if (total + text.length > TOTAL_LIMIT) reason = 'total';
          else if (this._dataGrid.get(p.id) === grid || this._write(ls, KEY_DATA + p.id, '{"grid":' + text + '}')) {
            stored = true;
            total += text.length;
            this._dataGrid.set(p.id, grid);
          } else {
            reason = 'quota';
            quota = true;
          }
          this._status.set(p.id, { stored: stored, reason: reason });
        } else if (ref && previous.has(p.id)) {
          /* ② を読み込み直す前は、保存しなかった理由を引き継ぐ */
          this._status.set(p.id, previous.get(p.id));
          reason = previous.get(p.id).reason;
        }
        if (!stored) this._removeData(ls, p.id);
        if (ref) {
          ref.stored = stored;
          if (reason) ref.reason = reason;
        }
        const def = { name: p.name, enabled: p.enabled, createdAt: p.createdAt, query: QueryOps.toPlain(p.query), condition: ref };
        if (!this._write(ls, KEY_PROFILE + p.id, JSON.stringify(def))) failed = true;
      });
      const lib = { format: 1, order: profiles.map((p) => p.id), activeId: s.userActiveId(), combine: s.userCombine() };
      if (!this._write(ls, KEY_LIBRARY, JSON.stringify(lib))) failed = true;
      this._sweep(ls, new Set(lib.order));
      if (failed) this._warnOnce('unavailable');
      else if (quota) this._warnOnce('quota');
      if (JSON.stringify(Array.from(this._status.entries())) !== before) this.bus.emit('store', {});
    }

    _gridJson(grid) {
      let text = this._gridText.get(grid);
      if (text === undefined) {
        text = JSON.stringify(grid);
        this._gridText.set(grid, text);
      }
      return text;
    }

    /** 変わったときだけ書き込む。@returns {boolean} 書き込めたか（同じ内容なら true） */
    _write(ls, key, text) {
      if (this._written.get(key) === text) return true;
      try {
        ls.setItem(key, text);
        this._written.set(key, text);
        return true;
      } catch (e) {
        return false;
      }
    }

    _removeData(ls, id) {
      this._dataGrid.delete(id);
      const key = KEY_DATA + id;
      this._written.delete(key);
      try {
        ls.removeItem(key);
      } catch (e) {
        /* 消せなくても次の保存で再び試す */
      }
    }

    /** 一覧にない抽出条件の保存分を消す */
    _sweep(ls, ids) {
      try {
        for (let i = ls.length - 1; i >= 0; i--) {
          const key = ls.key(i);
          if (!key) continue;
          let id = null;
          if (key.indexOf(KEY_PROFILE) === 0) id = key.slice(KEY_PROFILE.length);
          else if (key.indexOf(KEY_DATA) === 0) id = key.slice(KEY_DATA.length);
          if (id !== null && !ids.has(id)) {
            ls.removeItem(key);
            this._written.delete(key);
            this._dataGrid.delete(id);
          }
        }
      } catch (e) {
        /* 読み取りできない環境では掃除しないだけ */
      }
    }

    _warnOnce(kind) {
      if (this._warned.has(kind) || !this._notice) return;
      this._warned.add(kind);
      this._notice({
        type: 'warn',
        title: kind === 'quota' ? '② の一部をブラウザに保存できませんでした' : '抽出条件をブラウザに保存できませんでした',
        message: REASON_TEXT[kind] + '。抽出条件パネルの「書き出し」で JSON に保管できます。'
      });
    }
  }

  LQ.ProfileStore = ProfileStore;
})(window);
