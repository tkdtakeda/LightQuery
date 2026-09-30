/* =========================================================================
 * LightQuery - lq-ui-output-panel.js
 * 出力列パネル（① / ② / 根拠の列の表示切替・ドラッグとキーボードでの並べ替え・初期状態に戻す）
 *   ② の列は全抽出条件の ② の列を名前でまとめて並べ、どの抽出条件の ② の列かを添える。
 *   並びと表示は列の名前でブラウザに記憶する（今は使っていない列の分も覚えておく）。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Dom = LQ.Dom;
  const UI = LQ.UI;
  const Flash = LQ.Flash;
  const h = Dom.h;

  const GROUPS = [
    { prefix: 's:', label: '① 元データ', short: '元データ', badge: ['src', '①'] },
    { prefix: 'c:', label: '② 条件データ', short: '条件データ', badge: ['cond', '②'] },
    { prefix: 'm:', label: '根拠（抽出条件・行番号・一致数）', short: '抽出条件・行番号など', badge: ['meta', '根拠'] }
  ];

  class OutputPanel {
    constructor(ctx) {
      this.ctx = ctx;
      this.state = ctx.state;
      this.app = ctx.app;
      this.title = '出力列';
      this.icon = 'table-columns';
      this.size = 'md';
      this._dragKey = null;
      this._drop = null;
      this.groupCounts = new Map();
      const groups = h('div', { class: 'lq-colgroups' }, GROUPS.map((g) => this._groupCard(g)));
      this.filter = h('input', { class: 'lq-input', type: 'search', placeholder: '列名で絞り込み', title: '列名の一部で一覧を絞り込みます' });
      this.filter.addEventListener('input', () => this.render());
      this.list = h('ul', { class: 'lq-collist' });
      this._shownKeys = [];
      this.bulkCount = h('span', { class: 'lq-colbulk__count lq-num' });
      this.allOn = h('button', { class: 'lq-btn lq-btn--xs', type: 'button', onclick: () => this._bulk(true) }, [Dom.icon('square-check'), 'すべて ON']);
      this.allOff = h('button', { class: 'lq-btn lq-btn--xs', type: 'button', onclick: () => this._bulk(false) }, [Dom.icon('square'), 'すべて OFF']);
      this.bulk = h('div', { class: 'lq-colbulk' }, [this.bulkCount, h('span', { class: 'lq-colbulk__actions' }, [this.allOn, this.allOff])]);
      this.empty = h('p', { class: 'lq-field__hint', text: '① または ② を読み込むと、ここに列が表示されます。' });
      this.memo = h('p', { class: 'lq-field__hint lq-colmemo' });
      const reset = h('button', { class: 'lq-btn lq-btn--xs', type: 'button', title: '覚えている並びを消し、① の列を表示・② の列を非表示の初期状態に戻す（元に戻せます）',
        onclick: () => this._reset() }, [Dom.icon('rotate-left'), '初期状態に戻す']);
      this.el = h('div', {}, [
        UI.section('まとめて切り替え', [groups]),
        UI.section('列の一覧（上から順に表示・出力）', [
          this.filter,
          this.empty,
          this.bulk,
          this.list,
          this.memo,
          UI.note('tip', '列が多いときは「すべて OFF」にしてから、必要な列だけチェックを入れると早く選べます。絞り込み中は、一覧に出ている列だけが対象です。'),
          UI.note('tip', '左端のつまみをドラッグして並べ替えます。表の見出しをドラッグしても同じ順序が変わります。チェックボックスを選んで Alt+↑／Alt+↓ でも移動できます。'),
          UI.note('info', '並びと表示は列の名前でこのブラウザに記憶し、次に同じ名前の列を読み込んだときも使います（サンプル表示中の変更は記憶しません）。')
        ], [reset])
      ]);
      this._bindDrag();
      ['output', 'datasets', 'query', 'profiles'].forEach((topic) => ctx.bus.on(topic, () => this.render()));
      this.render();
    }

    _groupCard(g) {
      const count = h('span', { class: 'lq-colgroup__count' });
      this.groupCounts.set(g.prefix, count);
      return h('div', { class: 'lq-colgroup' }, [
        h('div', { class: 'lq-colgroup__head' }, [UI.badge(g.badge[0], g.badge[1]), g.short, count]),
        h('div', { class: 'lq-colgroup__actions' }, [
          h('button', { class: 'lq-btn lq-btn--xs', type: 'button', title: g.label + 'の列をすべて表示', onclick: () => this._group(g.prefix, true) }, [Dom.icon('eye'), '表示']),
          h('button', { class: 'lq-btn lq-btn--xs', type: 'button', title: g.label + 'の列をすべて非表示', onclick: () => this._group(g.prefix, false) }, [Dom.icon('eye-slash'), '隠す'])
        ])
      ]);
    }

    _group(prefix, visible) {
      this.state.setGroupVisible(prefix, visible);
      Flash.el(this.list);
    }

    /** 一覧に出ている列（絞り込み中はその列だけ）をまとめて表示／非表示にする（元に戻せる） */
    _bulk(visible) {
      const keys = this._shownKeys.slice();
      if (!keys.length) return;
      const snap = this.state.snapshot();
      this.state.setColumnsVisible(keys, visible);
      Flash.el(this.list);
      const scope = this.filter.value.trim() ? '絞り込み中の ' : '';
      this.ctx.toasts.show({
        type: 'success',
        title: scope + keys.length + ' 列を' + (visible ? '表示' : '非表示') + 'にしました',
        message: visible ? '不要な列はチェックを外してください。' : '出力したい列にチェックを入れてください。',
        actions: [{ label: '元に戻す', icon: 'rotate-left', onClick: () => this.app.restore(snap, '出力列の表示を元に戻しました') }]
      });
    }

    /** 「すべて ON／OFF」の件数と、押しても変わらないときの無効化・理由 */
    _renderBulk(shown) {
      const on = shown.filter((c) => c.visible).length;
      const filtered = !!this.filter.value.trim();
      this.bulk.hidden = !shown.length;
      this.bulkCount.textContent = (filtered ? '絞り込み中の ' + shown.length + ' 列のうち' : '全 ' + shown.length + ' 列のうち') + ' 表示 ' + on + ' 列';
      this.allOn.disabled = on === shown.length;
      this.allOff.disabled = on === 0;
      const scope = filtered ? '一覧に出ている ' + shown.length + ' 列' : 'すべての列（' + shown.length + ' 列）';
      this.allOn.title = this.allOn.disabled ? '対象の列はすべて表示中です' : scope + 'を表示にする（元に戻せます）';
      this.allOff.title = this.allOff.disabled ? '対象の列はすべて非表示です' : scope + 'を非表示にする（元に戻せます）';
    }

    _reset() {
      const s = this.state;
      const snap = s.snapshot();
      s.resetOutputColumns();
      Flash.el(this.list);
      this.ctx.toasts.show({
        type: 'success',
        title: '出力列を初期状態に戻しました',
        message: '① の列を表示・② の列を非表示にし、覚えていた並び（今は使っていない列の分も）を消しました。',
        actions: [{ label: '元に戻す', icon: 'rotate-left', onClick: () => this.app.restore(snap, '出力列の並びを元に戻しました') }]
      });
    }

    /** ② の行がひも付く（「一致しなかった行」でも固定値だけでもない）有効な抽出条件 */
    _linkedProfiles() {
      return this.state.profiles.enabled().filter((p) => {
        if (p.query.joinKind === 'anti' || !p.condition) return false;
        const v = this.app.validationOf(p);
        return !(v.ast && !v.needsCondition);
      });
    }

    /**
     * ② / 根拠の列が今の抽出条件で出力できない理由（出力できれば null）。
     * @returns {{text:string, soft:boolean}|null} soft：警告ではなく補足（抽出条件が 1 つのときの抽出条件列など）
     */
    _unavailableReason(key) {
      const s = this.state;
      const prefix = key.slice(0, 2);
      if (prefix === 's:' || key === 'm:srcRow') return null;
      if (key === 'm:profile' || key === 'm:priority') {
        return s.profiles.length > 1 ? null : { text: '抽出条件が 1 つのときは表示しません', soft: true };
      }
      const linked = this._linkedProfiles();
      if (prefix === 'c:' && linked.some((p) => p.condition.findColumn(key.slice(2)) >= 0)) return null;
      if (prefix === 'm:' && linked.length) return null;
      const enabled = s.profiles.enabled();
      if (prefix === 'c:' && linked.length) return { text: '有効な抽出条件の ② にない列です', soft: true };
      if (enabled.length && enabled.every((p) => p.query.joinKind === 'anti')) return { text: '「一致しなかった行」では出力できません', soft: false };
      return { text: '② を参照する条件がありません', soft: false };
    }

    /** ② の列を持つ抽出条件の名前（抽出条件が複数のときだけ） */
    _owners(key) {
      const s = this.state;
      if (key.slice(0, 2) !== 'c:' || s.profiles.length < 2) return '';
      const name = key.slice(2);
      return s.profiles.items.filter((p) => p.condition && p.condition.findColumn(name) >= 0).map((p) => p.name).join('・');
    }

    render() {
      const s = this.state;
      const counts = s.columnCounts();
      GROUPS.forEach((g) => {
        const c = counts[g.prefix];
        this.groupCounts.get(g.prefix).textContent = c.visible + ' / ' + c.total + ' 列';
      });
      const active = document.activeElement;
      const focusKey = active && active.closest && this.list.contains(active) ? (active.closest('[data-key]') || {}).dataset : null;
      const keep = focusKey ? focusKey.key : null;
      const word = this.filter.value.trim().toLowerCase();
      Dom.clear(this.list);
      this.empty.hidden = s.output.columns.length > 0;
      const dormant = s.output.memory.length - s.output.columns.length;
      this.memo.hidden = dormant <= 0;
      this.memo.textContent = dormant > 0 ? 'ほかに、今は読み込んでいない列 ' + dormant + ' 列の並びと表示を覚えています。' : '';
      const shown = s.output.columns.filter((col) => !word || LQ.ResultView.nameOf(col.key).toLowerCase().indexOf(word) !== -1);
      this._shownKeys = shown.map((col) => col.key);
      this._renderBulk(shown);
      shown.forEach((col) => {
        const name = LQ.ResultView.nameOf(col.key);
        const reason = this._unavailableReason(col.key);
        const owners = this._owners(col.key);
        const check = h('input', { type: 'checkbox', checked: col.visible, title: col.visible ? '表示中（外すと隠します）' : '非表示（入れると表示します）' });
        check.addEventListener('change', () => {
          this.state.setColumnVisible(col.key, check.checked);
          const item = this.list.querySelector('[data-key="' + CSS.escape(col.key) + '"]');
          if (item) Flash.el(item);
        });
        check.addEventListener('keydown', (e) => {
          if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
          e.preventDefault();
          if (this.state.moveColumnBy(col.key, e.key === 'ArrowUp' ? -1 : 1)) this._refocus(col.key, true);
        });
        const li = h('li', {
          class: 'lq-colitem' + (col.visible ? '' : ' is-hidden') + (reason && !reason.soft ? ' is-unavailable' : ''),
          draggable: 'true',
          dataset: { key: col.key }
        }, [
          h('span', { class: 'lq-colitem__handle', title: 'ドラッグして並べ替え' }, Dom.icon('grip-vertical')),
          check,
          UI.sourceBadge(col.key.slice(0, 2)),
          h('span', { class: 'lq-colitem__name', text: name, title: owners ? name + '（② を持つ抽出条件：' + owners + '）' : name }),
          owners ? h('span', { class: 'lq-colitem__owner', text: owners, title: 'この列を持つ ② の抽出条件' }) : null,
          reason ? h('span', { class: 'lq-colitem__reason' + (reason.soft ? ' is-soft' : ''), title: reason.text },
            [Dom.icon(reason.soft ? 'circle-info' : 'triangle-exclamation'), reason.text]) : null
        ]);
        this.list.appendChild(li);
      });
      if (keep) this._refocus(keep, false);
    }

    _refocus(key, flash) {
      const item = this.list.querySelector('[data-key="' + CSS.escape(key) + '"]');
      if (!item) return;
      const check = item.querySelector('input');
      if (check) check.focus();
      if (flash) Flash.el(item);
    }

    _bindDrag() {
      const list = this.list;
      list.addEventListener('dragstart', (e) => {
        const li = e.target.closest('[data-key]');
        if (!li) return;
        this._dragKey = li.dataset.key;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', li.dataset.key);
        li.classList.add('is-dragging');
      });
      list.addEventListener('dragover', (e) => {
        if (!this._dragKey) return;
        const li = e.target.closest('[data-key]');
        this._clearMarks();
        this._drop = null;
        if (!li || li.dataset.key === this._dragKey) return;
        e.preventDefault();
        const rect = li.getBoundingClientRect();
        const after = e.clientY > rect.top + rect.height / 2;
        li.classList.add(after ? 'is-drop-after' : 'is-drop-before');
        this._drop = { key: li.dataset.key, after: after };
      });
      list.addEventListener('drop', (e) => {
        if (!this._dragKey) return;
        e.preventDefault();
        const key = this._dragKey;
        const drop = this._drop;
        this._endDrag();
        if (drop) {
          this.state.moveColumn(key, drop.key, drop.after);
          const item = this.list.querySelector('[data-key="' + CSS.escape(key) + '"]');
          if (item) Flash.el(item);
        }
      });
      list.addEventListener('dragend', () => this._endDrag());
    }

    _clearMarks() {
      Dom.qsa('.is-drop-before, .is-drop-after', this.list).forEach((el) => el.classList.remove('is-drop-before', 'is-drop-after'));
    }

    _endDrag() {
      this._dragKey = null;
      this._drop = null;
      this._clearMarks();
      Dom.qsa('.is-dragging', this.list).forEach((el) => el.classList.remove('is-dragging'));
    }
  }

  LQ.OutputPanel = OutputPanel;
})(window);
