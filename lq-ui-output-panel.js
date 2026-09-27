/* =========================================================================
 * LightQuery - lq-ui-output-panel.js
 * 出力列パネル（① / ② / 根拠の列の表示切替・ドラッグとキーボードでの並べ替え）と
 * 照合ルールパネル（空白・全角半角・大文字小文字・数値・日付）
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
    { prefix: 'm:', label: '根拠（行番号・一致数）', short: '行番号など', badge: ['meta', '根拠'] }
  ];

  /* ---------------------------------------------------------------------
   * OutputPanel
   * ------------------------------------------------------------------- */
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
      this.empty = h('p', { class: 'lq-field__hint', text: '① または ② を読み込むと、ここに列が表示されます。' });
      this.el = h('div', {}, [
        UI.section('まとめて切り替え', [groups]),
        UI.section('列の一覧（上から順に表示・出力）', [
          this.filter,
          this.empty,
          this.list,
          UI.note('tip', '左端のつまみをドラッグして並べ替えます。表の見出しをドラッグしても同じ順序が変わります。チェックボックスを選んで Alt+↑／Alt+↓ でも移動できます。')
        ])
      ]);
      this._bindDrag();
      ['output', 'datasets', 'query'].forEach((topic) => ctx.bus.on(topic, () => this.render()));
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

    /** ② / 根拠の列が今の条件で出力できない理由（出力できれば null） */
    _unavailableReason(key) {
      const q = this.state.query;
      const prefix = key.slice(0, 2);
      if (prefix === 's:' || key === 'm:srcRow') return null;
      if (q.joinKind === 'anti') return '「一致しなかった行」では出力できません';
      const v = this.app.validation();
      if (v.ast && !v.needsCondition) return '② を参照する条件がありません';
      return null;
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
      s.output.columns.forEach((col) => {
        const name = LQ.ResultView.nameOf(col.key);
        if (word && name.toLowerCase().indexOf(word) === -1) return;
        const reason = this._unavailableReason(col.key);
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
          class: 'lq-colitem' + (col.visible ? '' : ' is-hidden') + (reason ? ' is-unavailable' : ''),
          draggable: 'true',
          dataset: { key: col.key }
        }, [
          h('span', { class: 'lq-colitem__handle', title: 'ドラッグして並べ替え' }, Dom.icon('grip-vertical')),
          check,
          UI.sourceBadge(col.key.slice(0, 2)),
          h('span', { class: 'lq-colitem__name', text: name, title: name }),
          reason ? h('span', { class: 'lq-colitem__reason', title: reason }, [Dom.icon('triangle-exclamation'), reason]) : null
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

  /* ---------------------------------------------------------------------
   * RulesPanel
   * ------------------------------------------------------------------- */
  const RULES = [
    { key: 'space', type: 'select', label: '空白',
      options: [{ value: 'trim', label: '前後の空白を無視' }, { value: 'all', label: 'すべての空白を無視' }, { value: 'keep', label: '空白も区別する' }],
      example: '例：「 東京 」＝「東京」。「すべて無視」なら「山田 太郎」＝「山田太郎」' },
    { key: 'width', type: 'switch', label: '全角・半角を区別しない', example: '例：ＡＢＣ＝ABC、１２３＝123、ｱｲｳ＝アイウ、（）＝()' },
    { key: 'caseless', type: 'switch', label: '大文字・小文字を区別しない', example: '例：abc＝ABC、Ｃ００１＝c001' },
    { key: 'numeric', type: 'switch', label: '数値として読める値は数値で比較', example: '例：1,000＝1000、00123＝123、▲500＝-500、12%＝0.12。以上・未満は数の大きさで比べます' },
    { key: 'date', type: 'switch', label: '日付として読める値は日付で比較', example: '例：2024/1/5＝2024-01-05＝2024年1月5日＝令和6年1月5日' }
  ];

  class RulesPanel {
    constructor(ctx) {
      this.ctx = ctx;
      this.state = ctx.state;
      this.title = '照合ルール';
      this.icon = 'spell-check';
      this.size = 'md';
      this.controls = new Map();
      const cards = RULES.map((rule) => this._card(rule));
      const reset = h('button', { class: 'lq-btn lq-btn--xs', type: 'button', title: '照合ルールを初期値に戻す', onclick: () => this._reset() },
        [Dom.icon('rotate-left'), '初期値に戻す']);
      this.el = h('div', {}, [
        UI.section('値をそろえてから比べます', [
          h('div', { class: 'lq-rules' }, cards),
          UI.note('info', '変更すると、表示中の結果は「未反映」になります。右上のボタンで再抽出すると反映されます。設定はこのパソコンのブラウザに記憶されます。')
        ], [reset])
      ]);
      ctx.bus.on('rules', () => this.sync());
      this.sync();
    }

    _card(rule) {
      let control;
      if (rule.type === 'select') {
        const select = h('select', { class: 'lq-select' });
        UI.fillSelect(select, rule.options, this.state.rules[rule.key]);
        select.addEventListener('change', () => this._set(rule.key, select.value));
        this.controls.set(rule.key, { get: () => select.value, set: (v) => { select.value = v; } });
        control = UI.field(rule.label, select);
      } else {
        const sw = UI.switchToggle(rule.label, !!this.state.rules[rule.key], (checked) => this._set(rule.key, checked));
        this.controls.set(rule.key, { get: () => sw.input.checked, set: (v) => { sw.input.checked = !!v; } });
        control = sw.el;
      }
      const card = h('div', { class: 'lq-rule', dataset: { rule: rule.key } }, [control, h('div', { class: 'lq-rule__example', text: rule.example })]);
      this.controls.get(rule.key).card = card;
      return card;
    }

    _set(key, value) {
      if (this.state.rules[key] === value) return;
      const patch = {};
      patch[key] = value;
      this.state.setRules(patch);
      const c = this.controls.get(key);
      Flash.el(c.card);
      Flash.applied(c.card.querySelector('.lq-field') || c.card);
    }

    _reset() {
      const defaults = LQ.Normalizer.DEFAULT_RULES;
      const changed = Object.keys(defaults).filter((key) => this.state.rules[key] !== defaults[key]);
      if (!changed.length) {
        this.ctx.toasts.show({ type: 'info', title: '照合ルールはすでに初期値です' });
        return;
      }
      this.state.setRules(Object.assign({}, defaults));
      changed.forEach((key) => Flash.el(this.controls.get(key).card));
      this.ctx.toasts.show({ type: 'success', title: '照合ルールを初期値に戻しました' });
    }

    sync() {
      this.controls.forEach((c, key) => {
        if (c.get() !== this.state.rules[key]) c.set(this.state.rules[key]);
      });
    }
  }

  LQ.OutputPanel = OutputPanel;
  LQ.RulesPanel = RulesPanel;
})(window);
