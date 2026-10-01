/* =========================================================================
 * LightQuery - lq-ui-grid.js
 * 表：見た目の調整（3 段階・列幅）と描画
 * （下の区切りごとに独立した部品。読み込み順どおりに並べている）
 * ========================================================================= */

/* =========================================================================
 * ── 表の見た目と列幅 ──
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

/* =========================================================================
 * ── 表の描画 ──
 * 表の描画：見出しの固定、出どころのバッジ、見出しを押すと列の一覧（並べ替え・絞り込み・出力する）、列の移動（見出しドラッグ）、
 *   行番号からの操作（判定根拠・読み込み範囲の指定）、列幅の手動調整（ColumnSizer）。値はすべてエスケープして描く。
 *   列幅は中身の文字数に合わせ（表を画面幅に引き伸ばさない）、手で変えた列だけ幅を固定する。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Dom = LQ.Dom;
  const esc = LQ.Util.escapeHtml;

  const SORT_ICON = { asc: 'sort-up', desc: 'sort-down' };
  const BADGE = {
    source: '<span class="lq-badge lq-badge--src">①</span>',
    condition: '<span class="lq-badge lq-badge--cond">②</span>',
    meta: '<span class="lq-badge lq-badge--meta">根拠</span>'
  };
  const TITLE_LENGTH = 16;

  class GridView {
    /**
     * @param {object} ctx
     * @param {HTMLElement} root スクロールする入れ物
     * @param {{onSort:Function, onMove:Function, onRowHead:Function, onColHead:Function}} handlers
     */
    constructor(ctx, root, handlers) {
      this.ctx = ctx;
      this.root = root;
      this.handlers = handlers;
      this.model = null;
      this._scrollKey = null;
      this._dragKey = null;
      this._dropTarget = null;
      this.sizer = new LQ.ColumnSizer();
      this.sizer.attach(root);
      root.addEventListener('click', (e) => this._onClick(e));
      root.addEventListener('dragstart', (e) => this._onDragStart(e));
      root.addEventListener('dragover', (e) => this._onDragOver(e));
      root.addEventListener('drop', (e) => this._onDrop(e));
      root.addEventListener('dragend', () => this._endDrag());
    }

    showEmpty(node) {
      this.model = null;
      this._scrollKey = null;
      this.root.classList.add('is-empty');
      Dom.clear(this.root);
      this.root.appendChild(node);
      this.root.scrollTop = 0;
    }

    /**
     * model = {
     *   mode:'result'|'data'|'raw', role?, scrollKey,
     *   columns:[{key,label,kind,letter?,sortable?,draggable?,sortDir?,colIndex?,isStart?,out?}],
     *   rows:[{head:{text,tag?,tagKind?,action?,title?}, cells:[string], rowClass?}],
     *   numeric:Set<number>
     * }
     */
    render(model) {
      const keep = model.scrollKey && model.scrollKey === this._scrollKey;
      const top = this.root.scrollTop;
      const left = this.root.scrollLeft;
      this.model = model;
      this._scrollKey = model.scrollKey || null;
      this.root.classList.remove('is-empty');
      const out = [];
      out.push('<table class="lq-grid' + (model.mode === 'raw' ? ' lq-grid--raw' : '') + '"' +
        (model.role ? ' data-role="' + model.role + '"' : '') + '><thead><tr>');
      out.push('<th class="lq-grid__rowhead">' + (model.mode === 'raw' ? '行' : (model.mode === 'data' ? '行' : '#')) + '</th>');
      model.columns.forEach((col) => out.push(this._th(col, model.mode, this._sizeId(col, model))));
      out.push('</tr></thead><tbody>');
      const cellClass = this._cellClasses(model);
      const sizeIds = model.columns.map((col) => this._sizeId(col, model));
      const sizeStyle = sizeIds.map((id) => this.sizer.styleOf(id));
      model.rows.forEach((row, ri) => {
        out.push(row.rowClass ? '<tr class="' + row.rowClass + '">' : '<tr>');
        out.push('<th class="lq-grid__rowhead" scope="row">' + this._rowHead(row.head, ri, model.mode) + '</th>');
        const isToggleRow = ri === model.toggleRow;
        for (let c = 0; c < model.columns.length; c++) {
          const v = row.cells[c] === undefined || row.cells[c] === null ? '' : String(row.cells[c]);
          const col = model.columns[c];
          let cls = sizeStyle[c] ? (cellClass[c] ? cellClass[c] + ' is-sized' : 'is-sized') : cellClass[c];
          if (isToggleRow && col.toggleKey) {
            cls = (cls ? cls + ' ' : '') + 'is-toggle';
            out.push('<td class="' + cls + '"' + sizeStyle[c] + ' data-menu="' + esc(col.toggleName) + '" title="' + esc(this._toggleTitle(col)) + '">' +
              this._eye(col.off) + esc(v) + this._stateIcons(col) + '</td>');
            continue;
          }
          const title = v.length > TITLE_LENGTH || sizeStyle[c] ? ' title="' + esc(v) + '"' : '';
          out.push('<td' + (cls ? ' class="' + cls + '"' : '') + sizeStyle[c] + title + '>' + esc(v) + '</td>');
        }
        out.push('</tr>');
      });
      out.push('</tbody></table>');
      this.root.innerHTML = out.join('');
      if (keep) {
        this.root.scrollTop = top;
        this.root.scrollLeft = left;
      } else {
        this.root.scrollTop = 0;
      }
    }

    /** 列幅を記憶する名前（結果は列のキー、① / ② は役割と列名。元のシート表示は対象外） */
    _sizeId(col, model) {
      if (model.mode === 'result') return col.key;
      if (model.mode === 'data') return 'd:' + (model.role || '') + ':' + col.label;
      return null;
    }

    _cellClasses(model) {
      return model.columns.map((col, c) => {
        const list = [];
        if (model.numeric && model.numeric.has(c)) list.push('is-num');
        if (col.kind === 'condition' && model.mode === 'result') list.push('is-cond-cell');
        if (col.kind === 'meta') list.push('is-meta-cell');
        if (col.off) list.push('is-off');
        if (col.out) list.push('is-out-col');
        return list.join(' ');
      });
    }

    _th(col, mode, sizeId) {
      const style = this.sizer.styleOf(sizeId);
      const sized = style ? ' is-sized' : '';
      const grip = sizeId ? this.sizer.handle(sizeId) : '';
      if (mode === 'raw') {
        return '<th class="is-colhead' + (col.isStart ? ' is-start-col' : '') + '" data-col="' + col.colIndex + '" title="クリックして開始列に指定">' +
          esc(col.label) + '</th>';
      }
      if (mode === 'data') {
        const menu = col.toggleKey ? ' data-menu="' + esc(col.label) + '" title="' + esc(this._toggleTitle(col)) + '"' : '';
        const cls = 'is-resizable' + sized + (col.toggleKey ? ' is-toggle' + (col.off ? ' is-off' : '') : '');
        const eye = col.toggleKey ? this._eye(col.off) : '';
        return '<th class="' + cls + '"' + style + menu + '><div class="lq-th">' + eye + '<span class="lq-th__name">' + esc(col.label) + '</span><span class="lq-th__letter">' +
          esc(col.letter || '') + '</span>' + (col.toggleKey ? this._stateIcons(col) : '') + '</div>' + grip + '</th>';
      }
      const cls = ['is-sortable', 'is-resizable'];
      if (style) cls.push('is-sized');
      if (col.sortDir) cls.push('is-sorted');
      if (col.kind === 'condition') cls.push('is-cond');
      if (col.kind === 'meta') cls.push('is-meta');
      const sortText = col.sortDir === 'asc' ? '昇順' : (col.sortDir === 'desc' ? '降順' : '');
      const sortIcon = col.sortDir ? '<i class="fa-solid fa-' + SORT_ICON[col.sortDir] + ' lq-th__sort" aria-hidden="true"></i>' : '';
      return '<th class="' + cls.join(' ') + '"' + style + ' data-key="' + esc(col.key) + '" draggable="true" title="' +
        esc(col.label) + '：押すと一覧（並べ替え・出力する）・ドラッグで列を移動' + (sortText ? '（今は ' + sortText + '）' : '') + '">' +
        '<div class="lq-th">' + (BADGE[col.kind] || '') + '<span class="lq-th__name">' + esc(col.label) + '</span>' + sortIcon +
        '<i class="fa-solid fa-caret-down lq-th__caret" aria-hidden="true"></i></div>' + grip + '</th>';
    }

    _toggleTitle(col) {
      return (col.toggleName || col.label) + '：押すと一覧（絞り込み・出力する）' + (col.filtered ? '・絞り込み中' : '') + (col.off ? '・出力しない列' : '');
    }

    /** 見出しの状態のアイコン（絞り込み中は漏斗）と、一覧が開くことを示す ▼ */
    _stateIcons(col) {
      return (col.filtered ? '<i class="fa-solid fa-filter lq-th__filtered" aria-hidden="true"></i>' : '') +
        '<i class="fa-solid fa-caret-down lq-th__caret" aria-hidden="true"></i>';
    }

    _eye(off) {
      return '<i class="fa-solid fa-' + (off ? 'eye-slash' : 'eye') + ' lq-th__vis" aria-hidden="true"></i>';
    }

    /**
     * プレビューの見出しの表示／非表示だけを更新する（表を描き直さず、変わった列のクラスだけ付け替える）。
     * @param {Function} isVisible キー → 表示するか
     */
    refreshVisibility(isVisible) {
      const model = this.model;
      if (!model || (model.mode !== 'data' && model.mode !== 'raw')) return;
      const table = this.root.querySelector('table');
      if (!table) return;
      model.columns.forEach((col, c) => {
        if (!col.toggleKey) return;
        const off = !isVisible(col.toggleKey);
        if (off === !!col.off) return;
        col.off = off;
        const index = c + 1;
        Array.prototype.forEach.call(table.rows, (tr) => {
          const cell = tr.cells[index];
          if (cell) cell.classList.toggle('is-off', off);
        });
        const headRow = model.mode === 'raw' ? table.rows[model.toggleRow + 1] : table.rows[0];
        const head = headRow && model.toggleRow !== -1 ? headRow.cells[index] : null;
        if (!head) return;
        head.title = this._toggleTitle(col);
        const eye = head.querySelector('.lq-th__vis');
        if (eye) eye.className = 'fa-solid fa-' + (off ? 'eye-slash' : 'eye') + ' lq-th__vis';
        LQ.Flash.el(head);
      });
    }

    _rowHead(head, ri, mode) {
      if (!head.action) return esc(head.text);
      if (mode === 'raw') {
        const tag = head.tag ? '<span class="lq-rowtag lq-rowtag--' + (head.tagKind || 'header') + '">' + esc(head.tag) + '</span>' : '<span></span>';
        return '<button class="lq-grid__rowbtn" type="button" data-row="' + ri + '" title="この行をヘッダー行・開始行・終了行に指定">' +
          tag + '<span>' + esc(head.text) + '</span></button>';
      }
      return '<button class="lq-grid__rowbtn" type="button" data-row="' + ri + '" title="' + esc(head.title || '') + '">' +
        '<i class="fa-solid fa-circle-info" aria-hidden="true"></i><span>' + esc(head.text) + '</span></button>';
    }

    _onClick(e) {
      if (!this.model || this.sizer.justResized || e.target.closest('.lq-colresize')) return;
      const btn = e.target.closest('.lq-grid__rowbtn');
      if (btn) {
        const row = this.model.rows[Number(btn.dataset.row)];
        if (row) this.handlers.onRowHead(row.head, btn);
        return;
      }
      const th = e.target.closest('th[data-key]');
      if (th && this.model.mode === 'result') {
        this.handlers.onResultMenu(th.dataset.key, th);
        return;
      }
      const menu = e.target.closest('[data-menu]');
      if (menu) {
        this.handlers.onColumnMenu(menu.dataset.menu, menu);
        return;
      }
      const colHead = e.target.closest('th[data-col]');
      if (colHead) this.handlers.onColHead(Number(colHead.dataset.col), colHead);
    }

    /* ---------- 見出しのドラッグで列を移動 ---------- */
    _onDragStart(e) {
      const th = e.target.closest ? e.target.closest('th[data-key]') : null;
      if (!th) return;
      this._dragKey = th.dataset.key;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', th.dataset.key);
      th.classList.add('is-dragging');
    }

    _onDragOver(e) {
      if (!this._dragKey) return;
      const th = e.target.closest ? e.target.closest('th[data-key]') : null;
      this._clearDropMarks();
      this._dropTarget = null;
      if (!th || th.dataset.key === this._dragKey) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = th.getBoundingClientRect();
      const after = e.clientX > rect.left + rect.width / 2;
      th.classList.add(after ? 'is-drop-after' : 'is-drop-before');
      this._dropTarget = { key: th.dataset.key, after: after };
    }

    _onDrop(e) {
      if (!this._dragKey) return;
      e.preventDefault();
      const key = this._dragKey;
      const target = this._dropTarget;
      this._endDrag();
      if (target) this.handlers.onMove(key, target.key, target.after);
    }

    _endDrag() {
      this._dragKey = null;
      this._dropTarget = null;
      this._clearDropMarks();
      Dom.qsa('th.is-dragging', this.root).forEach((th) => th.classList.remove('is-dragging'));
    }

    _clearDropMarks() {
      Dom.qsa('.is-drop-before, .is-drop-after', this.root).forEach((el) => el.classList.remove('is-drop-before', 'is-drop-after'));
    }
  }

  LQ.GridView = GridView;
})(window);
