/* =========================================================================
 * LightQuery - lq-ui-grid-sizing.js
 * 表の見た目の調整：
 *   GridDisplay … 列の間隔・行の間隔・文字サイズ（各 3 段階）。表の入れ物に data 属性で付け、値は CSS のトークンで決める
 *   ColumnSizer … 見出しの右端をドラッグして列幅を変える（ダブルクリックで中身に合わせた幅に戻す）
 *   どちらもブラウザに記憶する（列幅は列の名前ごと）。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Dom = LQ.Dom;
  const UI = LQ.UI;
  const Flash = LQ.Flash;
  const Prefs = LQ.Prefs;
  const h = Dom.h;

  const DISPLAY_KEY = 'grid.display';
  const WIDTH_KEY = 'grid.widths';
  const WIDTH_LIMIT = 300;
  const MIN_WIDTH = 40;
  const MAX_WIDTH = 1200;
  const LEVELS = ['s', 'm', 'l'];
  const SETTINGS = [
    { key: 'pad', label: '列の間隔', icon: 'arrows-left-right', names: ['狭い', '標準', '広い'], hint: 'セルの左右の余白' },
    { key: 'row', label: '行の間隔', icon: 'arrows-up-down', names: ['狭い', '標準', '広い'], hint: '1 行の高さ' },
    { key: 'font', label: '文字サイズ', icon: 'text-height', names: ['小', '標準', '大'], hint: '表の文字の大きさ' }
  ];
  const DEFAULT_DISPLAY = Object.freeze({ pad: 'm', row: 'm', font: 'm' });

  class GridDisplay {
    /**
     * @param {object} ctx
     * @param {HTMLElement} target 表の入れ物（data-pad / data-row / data-font を付ける）
     */
    constructor(ctx, target) {
      this.ctx = ctx;
      this.target = target;
      this.value = GridDisplay.clean(Prefs.get(DISPLAY_KEY, null));
      this._apply();
    }

    static clean(raw) {
      const out = Object.assign({}, DEFAULT_DISPLAY);
      if (raw && typeof raw === 'object') {
        SETTINGS.forEach((s) => {
          if (LEVELS.indexOf(raw[s.key]) !== -1) out[s.key] = raw[s.key];
        });
      }
      return out;
    }

    get isDefault() {
      return SETTINGS.every((s) => this.value[s.key] === DEFAULT_DISPLAY[s.key]);
    }

    _apply() {
      SETTINGS.forEach((s) => {
        this.target.dataset[s.key] = this.value[s.key];
      });
    }

    set(key, level) {
      if (this.value[key] === level) return;
      this.value[key] = level;
      Prefs.set(DISPLAY_KEY, this.value);
      this._apply();
      if (this._button) this._button.classList.toggle('is-customized', !this.isDefault);
      Flash.el(this.target);
    }

    /** 表の右上に置くボタン（標準から変えているときは印を付ける） */
    button() {
      this._button = h('button', {
        class: 'lq-btn lq-btn--sm' + (this.isDefault ? '' : ' is-customized'),
        type: 'button',
        title: '表の見た目：列の間隔・行の間隔・文字サイズ（各 3 段階）',
        onclick: (e) => this.open(e.currentTarget)
      }, [Dom.icon('text-height'), '表示']);
      return this._button;
    }

    open(anchor) {
      const pop = this.ctx.popovers;
      if (pop.isOpen('grid-display')) {
        pop.close();
        return;
      }
      const segs = [];
      const rows = SETTINGS.map((s) => {
        const seg = new LQ.Segmented(LEVELS.map((lv, i) => ({ value: lv, label: s.names[i] })), this.value[s.key], (v) => this.set(s.key, v), 'lq-seg--block');
        segs.push({ key: s.key, seg: seg });
        return h('div', { class: 'lq-display__row' }, [
          h('div', { class: 'lq-display__label' }, [Dom.icon(s.icon), h('span', { text: s.label }), h('span', { class: 'lq-field__hint', text: s.hint })]),
          seg.el
        ]);
      });
      const reset = h('button', { class: 'lq-btn lq-btn--xs', type: 'button', title: '3 つとも「標準」に戻す', onclick: () => {
        SETTINGS.forEach((s) => this.set(s.key, DEFAULT_DISPLAY[s.key]));
        segs.forEach((x) => x.seg.set(DEFAULT_DISPLAY[x.key]));
      } }, [Dom.icon('rotate-left'), '標準に戻す']);
      const widths = h('p', { class: 'lq-field__hint', text: '列の幅は中身の文字数に合わせます。見出しの右端をドラッグすると幅を変えられ、ダブルクリックで元に戻ります。' });
      pop.open(anchor, [
        h('div', { class: 'lq-popover__head' }, [Dom.icon('text-height'), h('span', { text: '表の見た目' }),
          UI.iconButton('xmark', '閉じる（Esc）', () => pop.close(), 'lq-btn--sm')]),
        h('div', { class: 'lq-popover__body lq-display' }, rows.concat([widths])),
        h('div', { class: 'lq-popover__foot' }, [reset, h('span', { class: 'lq-field__hint', text: 'このブラウザに記憶します' })])
      ], { key: 'grid-display', placement: 'bottom-end' });
    }
  }

  class ColumnSizer {
    constructor() {
      const saved = Prefs.get(WIDTH_KEY, null);
      this.widths = new Map(Array.isArray(saved) ? saved.filter((e) => Array.isArray(e) && typeof e[1] === 'number') : []);
      this._drag = null;
      this.justResized = false;
    }

    widthOf(id) {
      return id ? this.widths.get(id) || null : null;
    }

    /** 列幅の style（幅を決めていなければ空文字） */
    styleOf(id) {
      const w = this.widthOf(id);
      return w ? ' style="width:' + w + 'px;min-width:' + w + 'px;max-width:' + w + 'px"' : '';
    }

    handle(id) {
      return '<span class="lq-colresize" data-resize="' + LQ.Util.escapeHtml(id) + '" title="ドラッグで幅を変更・ダブルクリックで中身に合わせる"></span>';
    }

    _save() {
      const list = Array.from(this.widths.entries());
      Prefs.set(WIDTH_KEY, list.slice(Math.max(0, list.length - WIDTH_LIMIT)));
    }

    /** 表の入れ物にドラッグ操作を付ける */
    attach(root) {
      root.addEventListener('mousedown', (e) => {
        const grip = e.target.closest ? e.target.closest('.lq-colresize') : null;
        if (!grip || e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const th = grip.closest('th');
        this._drag = { id: grip.dataset.resize, th: th, table: th.closest('table'), index: th.cellIndex, startX: e.clientX, startW: th.getBoundingClientRect().width };
        document.body.classList.add('is-col-resizing');
      });
      root.addEventListener('dblclick', (e) => {
        const grip = e.target.closest ? e.target.closest('.lq-colresize') : null;
        if (!grip) return;
        e.preventDefault();
        this.widths.delete(grip.dataset.resize);
        this._save();
        const th = grip.closest('th');
        this._applyWidth(th.closest('table'), th.cellIndex, null);
      });
      root.addEventListener('dragstart', (e) => {
        if (this._drag || (e.target.closest && e.target.closest('.lq-colresize'))) e.preventDefault();
      }, true);
      document.addEventListener('mousemove', (e) => {
        const d = this._drag;
        if (!d) return;
        const w = Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, d.startW + e.clientX - d.startX)));
        d.width = w;
        this._applyWidth(d.table, d.index, w);
      });
      document.addEventListener('mouseup', () => {
        const d = this._drag;
        if (!d) return;
        this._drag = null;
        document.body.classList.remove('is-col-resizing');
        if (!d.width) return;
        this.widths.delete(d.id);
        this.widths.set(d.id, d.width);
        this._save();
        this.justResized = true;
        global.setTimeout(() => {
          this.justResized = false;
        }, 0);
      });
    }

    /* 実行時に決まる列幅だけは style で与える（見た目の値ではないため） */
    _applyWidth(table, index, w) {
      Array.prototype.forEach.call(table.rows, (tr) => {
        const cell = tr.cells[index];
        if (!cell) return;
        const v = w ? w + 'px' : '';
        cell.style.width = v;
        cell.style.minWidth = v;
        cell.style.maxWidth = v;
        cell.classList.toggle('is-sized', !!w);
      });
    }
  }

  LQ.GridDisplay = GridDisplay;
  LQ.ColumnSizer = ColumnSizer;
})(window);
