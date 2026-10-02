/* =========================================================================
 * LightQuery - lq-ui-profile-list.js
 * 抽出条件の一覧（条件パネルの上部）：上ほど優先。1 行＝順位・有効／無効・名前と ② の要約・状態・操作。
 *   並べ替えはつまみのドラッグ・順位の数字の入力・Alt+↑／↓。行を押すと、その抽出条件を下で編集する。
 *   抽出条件が 2 件以上のときは「1 行が複数に該当したとき」（振り分け／それぞれに出力）と「該当なし」の設定を出す
 *   （全体を束ねる最後の段階の設定のため、1 行の要約を付けて畳んでおき、下の編集欄を押し下げない）。
 *   行は id ごとに使い回し、入力中のフォーカスを失わないようにする。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Dom = LQ.Dom;
  const Util = LQ.Util;
  const UI = LQ.UI;
  const Flash = LQ.Flash;
  const h = Dom.h;
  const fmt = Util.formatInt;

  class ProfileListView {
    constructor(ctx) {
      this.ctx = ctx;
      this.state = ctx.state;
      this.app = ctx.app;
      this.rows = new Map();
      this._dragId = null;
      this._drop = null;
      this.count = h('span', { class: 'lq-badge lq-badge--count' });
      this.list = h('ul', { class: 'lq-proflist', 'aria-label': '抽出条件の一覧（上ほど優先）' });
      this.hint = h('p', { class: 'lq-field__hint' });
      this.combine = this._buildCombine();
      const tools = h('span', { class: 'lq-section__tools' }, [
        h('button', {
          class: 'lq-btn lq-btn--xs', type: 'button', title: 'Excel のシートや CSV を選び、表ごとに抽出条件を作ります（複数のファイル・シートを選べます）',
          onclick: () => this.app.pickFile('tables')
        }, [Dom.icon('file-circle-plus'), '表から作成']),
        h('button', {
          class: 'lq-btn lq-btn--xs', type: 'button', title: '空の抽出条件を一覧の最後（最も低い優先順位）に追加します',
          onclick: () => this.app.profiles.add()
        }, [Dom.icon('plus'), '追加'])
      ]);
      this.el = UI.section('抽出条件の一覧', [this.list, this.hint, this.combine.el], [this.count, tools]);
      this._bindDrag();
      ctx.bus.on('profiles', (d) => this.render(d));
      ['query', 'datasets', 'result', 'store'].forEach((topic) => ctx.bus.on(topic, () => this.render({})));
      this.render({});
    }

    /* ---------------- 組み立て ---------------- */

    _buildRow(id) {
      const row = { id: id };
      row.rank = h('input', {
        class: 'lq-input lq-input--sm lq-prof__rank lq-num', type: 'text', inputmode: 'numeric',
        title: '優先順位（数字を入れて Enter で移動。1 が最優先）', 'aria-label': '優先順位', dataset: { navStop: 'true' }
      });
      row.rank.addEventListener('change', () => this._commitRank(id, row.rank));
      row.rank.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.isComposing) return;
        e.preventDefault();
        this._commitRank(id, row.rank);
      });
      row.toggle = h('input', { type: 'checkbox', 'aria-label': '有効／無効' });
      row.toggle.addEventListener('change', () => {
        this.app.profiles.setEnabled(id, row.toggle.checked);
        Flash.el(row.el);
      });
      row.title = h('span', { class: 'lq-prof__title' });
      row.tags = h('span', { class: 'lq-prof__tags' });
      row.meta = h('span', { class: 'lq-prof__meta' });
      row.body = h('button', { class: 'lq-prof__body', type: 'button', onclick: () => this.app.profiles.select(id) },
        [h('span', { class: 'lq-prof__line' }, [row.title, row.tags]), row.meta]);
      row.status = h('span', { class: 'lq-prof__status' });
      row.menu = UI.iconButton('ellipsis-vertical', 'この抽出条件の操作（複製・書き出し・並べ替え・削除）',
        (e) => this.app.profileDialogs.openRowMenu(e.currentTarget, id), 'lq-btn--sm');
      row.switchEl = h('label', { class: 'lq-switch lq-switch--sm' }, [row.toggle, h('span', { class: 'lq-switch__track' })]);
      row.el = h('li', { class: 'lq-prof', draggable: 'true', dataset: { id: id } }, [
        h('span', { class: 'lq-prof__handle', title: 'ドラッグして優先順位を変更' }, Dom.icon('grip-vertical')),
        row.rank, row.switchEl, row.body, row.status, row.menu
      ]);
      row.el.addEventListener('keydown', (e) => {
        if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
        e.preventDefault();
        if (this.app.profiles.moveBy(id, e.key === 'ArrowUp' ? -1 : 1)) this._refocus(id, e.target);
      });
      return row;
    }

    _buildCombine() {
      const modes = LQ.BatchRunner.COMBINE_MODES;
      const seg = new LQ.Segmented(modes.map((m) => ({ value: m.id, label: m.label, icon: m.icon, title: m.desc })), 'assign', (v) => {
        this.app.profiles.setCombine({ mode: v });
        Flash.el(seg.el);
      }, 'lq-seg--block');
      const desc = h('div', { class: 'lq-field__hint' });
      const sw = UI.switchToggle('どの抽出条件にも該当しない行も「該当なし」として出力する', false, (on) => {
        this.app.profiles.setCombine({ includeUnmatched: on });
        Flash.el(sw.el);
      });
      const fold = UI.collapsible('振り分け', [UI.field('1 行が複数の抽出条件に該当したとき', seg.el), desc, sw.el],
        { open: LQ.Prefs.get('combineOpen', false), onToggle: (open) => LQ.Prefs.set('combineOpen', open) });
      fold.el.classList.add('lq-combine');
      return { el: fold.el, summary: fold.summary, seg: seg, desc: desc, sw: sw };
    }

    /* ---------------- 更新 ---------------- */

    render(detail) {
      const d = detail || {};
      const s = this.state;
      const items = s.profiles.items;
      const counts = this._resultCounts();
      const ids = new Set(items.map((p) => p.id));
      this.rows.forEach((row, id) => {
        if (!ids.has(id)) {
          row.el.remove();
          this.rows.delete(id);
        }
      });
      items.forEach((p, i) => {
        let row = this.rows.get(p.id);
        if (!row) {
          row = this._buildRow(p.id);
          this.rows.set(p.id, row);
        }
        if (this.list.children[i] !== row.el) this.list.insertBefore(row.el, this.list.children[i] || null);
        this._updateRow(row, p, i, counts);
      });
      (d.added || []).forEach((id) => {
        const row = this.rows.get(id);
        if (row) Flash.el(row.el);
      });
      this.count.textContent = items.length + ' 件';
      const multi = items.length > 1;
      this.hint.textContent = multi
        ? '上ほど優先されます。つまみのドラッグ・順位の数字・Alt+↑／↓ で並べ替えます。行を押すと下で編集できます。'
        : '抽出条件を増やすと、② の表ごと（列が違っていてよい）に名前と優先順位を付けて使い分けられます。';
      this.combine.el.hidden = !multi;
      if (multi) this._renderCombine(d);
    }

    _updateRow(row, p, index, counts) {
      const s = this.state;
      const active = p.id === s.activeId;
      row.el.classList.toggle('is-active', active);
      row.el.classList.toggle('is-disabled', !p.enabled);
      row.el.setAttribute('aria-current', active ? 'true' : 'false');
      if (document.activeElement !== row.rank) row.rank.value = String(index + 1);
      row.toggle.checked = p.enabled;
      row.switchEl.title = p.enabled ? '有効（外すと抽出に使いません）' : '無効（入れると抽出に使います）';
      row.title.textContent = p.name;
      row.body.title = p.name + '：押すと下で編集します';
      row.meta.textContent = this._metaText(p);
      Dom.clear(row.tags);
      if (p.isSample) row.tags.appendChild(h('span', { class: 'lq-tag lq-tag--sample', text: 'サンプル' }));
      if (!p.enabled) row.tags.appendChild(h('span', { class: 'lq-tag', text: '無効' }));
      if (p.rules) {
        row.tags.appendChild(h('span', { class: 'lq-tag lq-tag--own', title: 'この抽出条件だけの照合ルールで比べます：' + new LQ.Normalizer(p.rules).describe() },
          [Dom.icon('spell-check'), '個別ルール']));
      }
      Dom.clear(row.status);
      if (p.enabled && s.datasets.source) {
        const v = this.app.validationOf(p);
        row.status.appendChild(v.ok
          ? h('span', { class: 'lq-prof__ok', title: '設定は整っています' }, Dom.icon('circle-check'))
          : h('span', { class: 'lq-prof__warn', title: v.errors.map((e) => e.message).join('\n') }, [Dom.icon('triangle-exclamation'), String(v.errors.length)]));
      }
      const c = counts.get(p.id);
      if (c) {
        row.status.appendChild(h('span', {
          class: 'lq-prof__count lq-num' + (c.stale ? ' is-stale' : ''),
          title: c.title,
          text: fmt(c.rows) + ' 行'
        }));
      }
    }

    /** 一覧の 2 行目：② の表・条件の数 */
    _metaText(p) {
      const n = '条件 ' + p.query.conditions.length + ' 件';
      const ds = p.condition;
      if (ds) {
        const src = ds.source;
        const sheet = src.hasSheets && src.sheetNames.length > 1 ? '［' + src.sheetName + '］' : '';
        return '② ' + ds.name + sheet + '・' + fmt(ds.rowCount) + ' 行・' + n;
      }
      if (p.conditionRef && p.conditionRef.fileName) return '② 未読み込み（前回：' + p.conditionRef.fileName + '）・' + n;
      if (LQ.QueryOps.fixedOnly(p.query)) return '固定値のみ（② 不要）・' + n;
      return '② 未読み込み・' + n;
    }

    /** 結果に含まれる抽出条件ごとの行数 */
    _resultCounts() {
      const map = new Map();
      const res = this.state.result;
      if (!res) return map;
      const stale = this.state.isStale();
      const assign = res.stats.mode === 'assign' && res.parts.length > 1;
      res.parts.forEach((part) => {
        const shadow = part.hits - part.assigned;
        const title = (stale ? '（未反映）' : '') + '結果 ' + fmt(part.rows) + ' 行' +
          (assign && shadow > 0 ? '。該当 ' + fmt(part.hits) + ' 行のうち ' + fmt(shadow) + ' 行は、優先順位が上の抽出条件に振り分けました' : '');
        map.set(part.id, { rows: part.rows, stale: stale, title: title });
      });
      return map;
    }

    _renderCombine(d) {
      const c = this.state.combine;
      const mode = LQ.BatchRunner.COMBINE_MODES.find((m) => m.id === c.mode);
      this.combine.seg.set(c.mode);
      this.combine.desc.textContent = mode ? mode.desc : '';
      this.combine.sw.input.checked = c.includeUnmatched;
      this.combine.summary.textContent = (mode ? mode.label : '') + (c.includeUnmatched ? '・該当なしも出力' : '');
      if (d.combine) Flash.el(this.combine.el);
    }

    /* ---------------- 並べ替え ---------------- */

    _commitRank(id, input) {
      const s = this.state;
      const cur = s.profiles.rank(id);
      if (!cur) return;
      const n = Util.parseRowRef(input.value);
      if (n === null || Number.isNaN(n)) {
        input.value = String(cur);
        Flash.el(input, 'warn');
        return;
      }
      const target = Util.clamp(n, 1, s.profiles.length);
      if (target === cur) {
        input.value = String(cur);
        return;
      }
      this.app.profiles.moveTo(id, target - 1);
      this._refocus(id, input);
    }

    /** 動かした行にフォーカスを戻し、瞬かせて位置を知らせる */
    _refocus(id, el) {
      const row = this.rows.get(id);
      if (!row) return;
      const target = el && row.el.contains(el) ? el : row.rank;
      target.focus();
      if (target === row.rank) row.rank.select();
      row.el.scrollIntoView({ block: 'nearest' });
      Flash.el(row.el);
    }

    _bindDrag() {
      const list = this.list;
      list.addEventListener('dragstart', (e) => {
        const li = e.target.closest ? e.target.closest('.lq-prof') : null;
        if (!li) return;
        this._dragId = li.dataset.id;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', li.dataset.id);
        li.classList.add('is-dragging');
      });
      list.addEventListener('dragover', (e) => {
        if (!this._dragId) return;
        const li = e.target.closest ? e.target.closest('.lq-prof') : null;
        this._clearMarks();
        this._drop = null;
        if (!li || li.dataset.id === this._dragId) return;
        e.preventDefault();
        const rect = li.getBoundingClientRect();
        const after = e.clientY > rect.top + rect.height / 2;
        li.classList.add(after ? 'is-drop-after' : 'is-drop-before');
        this._drop = { id: li.dataset.id, after: after };
      });
      list.addEventListener('drop', (e) => {
        if (!this._dragId) return;
        e.preventDefault();
        e.stopPropagation();
        const id = this._dragId;
        const drop = this._drop;
        this._endDrag();
        if (!drop) return;
        const s = this.state;
        const from = s.profiles.indexOf(id);
        let to = s.profiles.indexOf(drop.id) + (drop.after ? 1 : 0);
        if (from < to) to -= 1;
        if (this.app.profiles.moveTo(id, to)) this._refocus(id, null);
      });
      list.addEventListener('dragend', () => this._endDrag());
    }

    _clearMarks() {
      Dom.qsa('.is-drop-before, .is-drop-after', this.list).forEach((el) => el.classList.remove('is-drop-before', 'is-drop-after'));
    }

    _endDrag() {
      this._dragId = null;
      this._drop = null;
      this._clearMarks();
      Dom.qsa('.is-dragging', this.list).forEach((el) => el.classList.remove('is-dragging'));
    }
  }

  LQ.ProfileListView = ProfileListView;
})(window);
