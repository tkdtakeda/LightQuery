/* =========================================================================
 * LightQuery - lq-output-columns.js
 * 出力列の並びと表示：今使える列（columns）と、覚えている並び（memory）を持つ。
 *   memory には今は使えない列（まだ読み込んでいない ① の列など）も残しておき、
 *   同じ名前の列を読み込んだときに前回の表示・並び順をそのまま使う。
 *   変更のたびに memory を更新する（ブラウザへの保存・JSON の書き出しは memory を使う）。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Util = LQ.Util;

  const GROUP_ORDER = ['lead', 's:', 'c:', 'm:'];
  const MEMORY_MAX = 600;
  const RE_KEY = /^[scm]:/;

  /** 並びのまとまり（抽出条件・優先順位は先頭にまとめる） */
  function groupOf(key) {
    return key === 'm:profile' || key === 'm:priority' ? 'lead' : key.slice(0, 2);
  }

  /** 保存・JSON から読んだ並びの値の種類をそろえる（重複・不正なキーは捨てる） */
  function cleanList(list) {
    const seen = new Set();
    const out = [];
    (Array.isArray(list) ? list : []).forEach((c) => {
      if (!c || typeof c.key !== 'string' || !RE_KEY.test(c.key) || seen.has(c.key)) return;
      seen.add(c.key);
      out.push({ key: c.key, visible: !!c.visible });
    });
    return out;
  }

  class OutputColumns {
    constructor() {
      this.columns = [];
      this.memory = [];
    }

    /**
     * 今使える列に合わせて columns を作り直す。覚えている列は覚えている表示・並び順、
     * 初めての列は既定の表示で、同じまとまり（① / ② / 根拠）の最後に入れる。
     * @param {Array<{key:string, visible:boolean}>} available 使える列（既定の並び・既定の表示）
     */
    sync(available) {
      const avail = new Set(available.map((a) => a.key));
      const list = [];
      const known = new Set();
      this.memory.forEach((m) => {
        if (!avail.has(m.key) || known.has(m.key)) return;
        list.push({ key: m.key, visible: m.visible });
        known.add(m.key);
      });
      available.forEach((a) => {
        if (known.has(a.key)) return;
        const g = GROUP_ORDER.indexOf(groupOf(a.key));
        let at = 0;
        for (let i = list.length - 1; i >= 0; i--) {
          if (GROUP_ORDER.indexOf(groupOf(list[i].key)) <= g) {
            at = i + 1;
            break;
          }
        }
        list.splice(at, 0, { key: a.key, visible: a.visible });
        known.add(a.key);
      });
      this.columns = list;
      this._remember();
    }

    /**
     * 今の columns を memory に書き戻す。今は使えない列は、memory で直前にあった使える列の後ろに残す
     * （読み込み直したときに元の位置へ戻るように）。上限を超えたら使っていない列から捨てる。
     */
    _remember() {
      const current = new Set(this.columns.map((c) => c.key));
      const after = new Map();
      let anchor = '';
      this.memory.forEach((m) => {
        if (current.has(m.key)) {
          anchor = m.key;
          return;
        }
        if (!after.has(anchor)) after.set(anchor, []);
        after.get(anchor).push({ key: m.key, visible: m.visible });
      });
      const next = (after.get('') || []).slice();
      this.columns.forEach((c) => {
        next.push({ key: c.key, visible: c.visible });
        (after.get(c.key) || []).forEach((m) => next.push(m));
      });
      for (let i = next.length - 1; i >= 0 && next.length > MEMORY_MAX; i--) {
        if (!current.has(next[i].key)) next.splice(i, 1);
      }
      this.memory = next;
    }

    /** @returns {boolean} 変わったか */
    setVisible(key, visible) {
      const col = this.columns.find((c) => c.key === key);
      if (!col || col.visible === visible) return false;
      col.visible = visible;
      this._remember();
      return true;
    }

    /** prefix：'s:' / 'c:' / 'm:' */
    setGroupVisible(prefix, visible) {
      this.columns.forEach((c) => {
        if (c.key.slice(0, 2) === prefix) c.visible = visible;
      });
      this._remember();
    }

    /** key を targetKey の前（after=true なら後ろ）へ移す。@returns {boolean} 動いたか */
    move(key, targetKey, after) {
      if (key === targetKey) return false;
      const list = this.columns;
      const from = list.findIndex((c) => c.key === key);
      if (from < 0) return false;
      const item = list.splice(from, 1)[0];
      let to = list.findIndex((c) => c.key === targetKey);
      if (to < 0) {
        list.splice(from, 0, item);
        return false;
      }
      if (after) to += 1;
      list.splice(to, 0, item);
      this._remember();
      return true;
    }

    /** delta 個分移動（キーボード操作用）。@returns {boolean} 動いたか */
    moveBy(key, delta) {
      const list = this.columns;
      const idx = list.findIndex((c) => c.key === key);
      const target = idx + delta;
      if (idx < 0 || target < 0 || target >= list.length) return false;
      const item = list.splice(idx, 1)[0];
      list.splice(target, 0, item);
      this._remember();
      return true;
    }

    /** 表示する列を順に指定する（サンプル用）。指定のない列は隠す */
    applyPreset(visibleKeys) {
      const order = visibleKeys.filter((key) => this.columns.some((c) => c.key === key));
      const rest = this.columns.filter((c) => order.indexOf(c.key) === -1).map((c) => ({ key: c.key, visible: false }));
      this.columns = order.map((key) => ({ key: key, visible: true })).concat(rest);
      this._remember();
    }

    /** 覚えている並びを差し替える（ブラウザ保存・JSON から）。columns は次の sync で作り直す */
    setMemory(list) {
      this.memory = cleanList(list);
    }

    /** 覚えている並びを消す（初期状態に戻す）。columns は次の sync で作り直す */
    clearMemory() {
      this.memory = [];
      this.columns = [];
    }

    counts() {
      const counts = { 's:': { visible: 0, total: 0 }, 'c:': { visible: 0, total: 0 }, 'm:': { visible: 0, total: 0 } };
      this.columns.forEach((c) => {
        const bucket = counts[c.key.slice(0, 2)];
        bucket.total++;
        if (c.visible) bucket.visible++;
      });
      return counts;
    }

    snapshot() {
      return { columns: Util.clone(this.columns), memory: Util.clone(this.memory) };
    }

    restore(snap) {
      this.columns = Util.clone(snap.columns || []);
      this.memory = Util.clone(snap.memory || snap.columns || []);
    }
  }

  LQ.OutputColumns = OutputColumns;
})(window);
