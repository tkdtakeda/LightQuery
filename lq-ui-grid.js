/* =========================================================================
 * LightQuery - lq-ui-grid.js
 * 表の描画：見出しの固定、出どころのバッジ、並べ替え（見出しクリック）、列の移動（見出しドラッグ）、
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
        for (let c = 0; c < model.columns.length; c++) {
          const v = row.cells[c] === undefined || row.cells[c] === null ? '' : String(row.cells[c]);
          const cls = sizeStyle[c] ? (cellClass[c] ? cellClass[c] + ' is-sized' : 'is-sized') : cellClass[c];
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
        return '<th class="is-resizable' + sized + '"' + style + '><div class="lq-th"><span class="lq-th__name">' + esc(col.label) + '</span><span class="lq-th__letter">' +
          esc(col.letter || '') + '</span></div>' + grip + '</th>';
      }
      const cls = ['is-sortable', 'is-resizable'];
      if (style) cls.push('is-sized');
      if (col.sortDir) cls.push('is-sorted');
      if (col.kind === 'condition') cls.push('is-cond');
      if (col.kind === 'meta') cls.push('is-meta');
      const sortIcon = SORT_ICON[col.sortDir] || 'sort';
      const sortText = col.sortDir === 'asc' ? '昇順' : (col.sortDir === 'desc' ? '降順' : '');
      return '<th class="' + cls.join(' ') + '"' + style + ' data-key="' + esc(col.key) + '" draggable="true" title="' +
        esc(col.label) + '：クリックで並べ替え（昇順→降順→解除）・ドラッグで列を移動' + (sortText ? '（現在 ' + sortText + '）' : '') + '">' +
        '<div class="lq-th">' + (BADGE[col.kind] || '') + '<span class="lq-th__name">' + esc(col.label) + '</span>' +
        '<i class="fa-solid fa-' + sortIcon + ' lq-th__sort" aria-hidden="true"></i></div>' + grip + '</th>';
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
        this.handlers.onSort(th.dataset.key);
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
