/* =========================================================================
 * LightQuery - lq-ui-drill.js
 * 内訳：ピボットのセルをダブルクリック（Enter）すると、そのセルに入った行をピボットの表の上に重ねて表示する
 *   （ピボットテーブルの「詳細の表示」と同じ考え方）。タブやパネルは動かさず、閉じると元の行に戻る。
 *   内訳は見るだけ（ページ送りのみ）。右上の「コピー」「Excel」で書き出せる。
 *   列は出力列パネルの表示・並び順（「② の行」を使ったピボットでは ① の列）。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Dom = LQ.Dom;
  const Util = LQ.Util;
  const UI = LQ.UI;
  const h = Dom.h;
  const fmt = Util.formatInt;

  /* 数値の列と判定する割合と、判定に使う行数 */
  const NUMERIC_RATIO = 0.8;
  const NUMERIC_SAMPLE = 200;
  /* 閉じずに描き直すだけの話題（表示中の内訳と関係しない変化） */
  const KEEP_TOPICS = new Set(['busy', 'panel', 'library', 'start', 'worksets', 'aggregate-ready']);

  /* ---------------------------------------------------------------------
   * DrillTable：内訳の表（Exporters の table と同じ形＋ページ用の rowAt）
   * ------------------------------------------------------------------- */
  const DrillTable = {
    /**
     * @param {LQ.ResultView} view 集計に使った見せ方
     * @param {{by:Array, keys?:number[], src?:number[]}} entry 集計の 1 行分の内訳
     * @param {Array<{key:string, visible:boolean}>} outputColumns 出力列の設定
     */
    create(view, entry, outputColumns) {
      let header;
      let cellsOf;
      let count;
      if (entry.keys) {
        const defs = view.resolveColumns(outputColumns).filter((d) => d.available);
        const sourceNames = new Set(defs.filter((d) => d.kind !== 'condition').map((d) => d.name));
        header = defs.map((d) => (d.kind === 'condition' && sourceNames.has(d.name) ? '② ' : '') + d.name);
        count = entry.keys.length;
        cellsOf = (i) => defs.map((d) => view.rawValue(d, entry.keys[i]));
      } else {
        /* ② の行ごとの集計：その ② の行に一致した ① の行。① の列（と ① の行番号）を出力列の並びで出す */
        const src = view.source;
        const cols = outputColumns.filter((c) => c.visible && (c.key.slice(0, 2) === 's:' || c.key === 'm:srcRow'))
          .map((c) => (c.key === 'm:srcRow' ? { name: '① 行番号', row: true } : { name: LQ.ResultView.nameOf(c.key), idx: src.findColumn(LQ.ResultView.nameOf(c.key)) }))
          .filter((c) => c.row || c.idx >= 0);
        header = cols.map((c) => c.name);
        count = entry.src.length;
        cellsOf = (i) => cols.map((c) => (c.row ? String(src.rowNumber(entry.src[i])) : src.cell(entry.src[i], c.idx)));
      }
      return {
        header: header,
        defs: header.map((name) => ({ name: name })),
        rowCount: count,
        rowAt: (i) => cellsOf(i).map((v) => (v === undefined || v === null ? '' : String(v))),
        forEachRow(fn) {
          for (let i = 0; i < count; i++) fn(this.rowAt(i), i);
        }
      };
    },

    /** 先頭の行で、値の 8 割以上が数値の列（右寄せにする） */
    numericColumns(table) {
      const n = Math.min(table.rowCount, NUMERIC_SAMPLE);
      const hits = table.header.map(() => ({ num: 0, filled: 0 }));
      for (let i = 0; i < n; i++) {
        table.rowAt(i).forEach((v, c) => {
          if (LQ.Normalizer.isBlank(v)) return;
          hits[c].filled++;
          if (!Number.isNaN(LQ.ValueParser.parseNumber(v))) hits[c].num++;
        });
      }
      const set = new Set();
      hits.forEach((x, c) => {
        if (x.filled && x.num / x.filled >= NUMERIC_RATIO) set.add(c);
      });
      return set;
    }
  };

  /* ---------------------------------------------------------------------
   * DrillView：集計表の上に重ねる内訳の表示
   * ------------------------------------------------------------------- */
  class DrillView {
    /**
     * @param {object} ctx
     * @param {HTMLElement} host 重ねる領域（メイン領域）
     */
    constructor(ctx, host) {
      this.ctx = ctx;
      this.state = ctx.state;
      this.app = ctx.app;
      this.toasts = ctx.toasts;
      this.entry = null;
      this.table = null;
      this.page = 0;
      this._return = null;
      this.title = h('h2', { class: 'lq-drill__title' });
      this.count = h('span', { class: 'lq-drill__count lq-num' });
      this.scope = h('div', { class: 'lq-drill__scope' });
      this.gridRoot = h('div', { class: 'lq-gridwrap lq-drill__grid' });
      this.pager = h('div', { class: 'lq-drill__pager' });
      const copyBtn = h('button', { class: 'lq-btn lq-btn--sm', type: 'button', title: '内訳をタブ区切りでコピーします（Excel に貼り付けられます）',
        onclick: () => this._copy() }, [Dom.icon('copy'), 'コピー']);
      const xlsxBtn = h('button', { class: 'lq-btn lq-btn--sm', type: 'button', title: '内訳を Excel（.xlsx）で出力します',
        onclick: () => this._exportXlsx() }, [Dom.icon('file-excel'), 'Excel']);
      this.el = h('section', { class: 'lq-drill', hidden: true, role: 'dialog', 'aria-label': 'ピボットの内訳', tabindex: '-1' }, [
        h('div', { class: 'lq-drill__head' }, [
          h('span', { class: 'lq-drill__icon' }, Dom.icon('magnifying-glass-chart')),
          h('div', { class: 'lq-drill__heading' }, [h('div', { class: 'lq-drill__line' }, [this.title, this.count]), this.scope]),
          h('span', { class: 'lq-topbar__spacer' }),
          copyBtn, xlsxBtn,
          UI.iconButton('xmark', '閉じてピボットに戻る（Esc）', () => this.close(), 'lq-btn--sm')
        ]),
        this.gridRoot,
        this.pager
      ]);
      this.grid = new LQ.GridView(ctx, this.gridRoot, {});
      this.el.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        this.close();
      });
      host.appendChild(this.el);
      ctx.bus.on('change', (e) => this._onChange(e));
    }

    isOpen() {
      return !this.el.hidden;
    }

    /**
     * @param {{by:Array, keys?:number[], src?:number[]}} entry 集計の 1 行分の内訳
     * @param {LQ.ResultView} view 集計に使った見せ方
     * @param {string} scopeText 集計の対象（例：抽出結果すべて）
     * @param {Function} returnFocus 閉じたときにフォーカスを戻す処理
     */
    open(entry, view, scopeText, returnFocus) {
      this.entry = entry;
      this.view = view;
      this.scopeText = scopeText;
      this._return = returnFocus || null;
      this.page = 0;
      /* 表の見た目（列の間隔・行の間隔・文字サイズ）はメインの表と同じにする */
      const main = this.el.parentNode.querySelector('.lq-gridwrap:not(.lq-drill__grid)');
      if (main) ['pad', 'row', 'font'].forEach((k) => {
        if (main.dataset[k]) this.gridRoot.dataset[k] = main.dataset[k];
        else delete this.gridRoot.dataset[k];
      });
      this.el.hidden = false;
      this.el.classList.remove('is-in');
      void this.el.offsetWidth;
      this.el.classList.add('is-in');
      this._build();
      this.el.focus();
    }

    close() {
      if (!this.isOpen()) return;
      this.el.hidden = true;
      this.entry = null;
      this.table = null;
      this.grid.showEmpty(h('span'));
      const back = this._return;
      this._return = null;
      if (back) back();
    }

    /** 状態が変わったら閉じる（出力列の変更だけなら列を作り直す。集計タブ以外に移ったら閉じる） */
    _onChange(e) {
      if (!this.isOpen() || KEEP_TOPICS.has(e.topic)) return;
      if (e.topic === 'output') {
        this._build();
        return;
      }
      if (e.topic === 'view' && this.state.view.tab === 'aggregate' && !(e.detail && e.detail.tab)) return;
      this.close();
    }

    _build() {
      this.table = DrillTable.create(this.view, this.entry, this.state.output.columns);
      this.numeric = DrillTable.numericColumns(this.table);
      const by = this.entry.by.length ? this.entry.by.map((b) => b.name + '＝' + b.value).join(' × ') : '全体';
      this.title.textContent = '内訳：' + by;
      this.title.title = this.title.textContent;
      this.count.textContent = fmt(this.table.rowCount) + ' 行';
      this.scope.textContent = '対象：' + this.scopeText + '。列は' + (this.entry.keys ? '出力列パネルの表示・並び順' : ' ① の列（出力列パネルの表示・並び順）') + 'です。';
      this._render();
    }

    _render() {
      const t = this.table;
      if (!t.header.length) {
        this.grid.showEmpty(h('div', { class: 'lq-empty' }, [UI.note('warn', '表示する列がありません。出力列パネルで列を表示にしてください。')]));
        Dom.clear(this.pager);
        return;
      }
      const size = this.state.view.pageSize;
      const pages = Math.max(1, Math.ceil(t.rowCount / size));
      this.page = Math.min(this.page, pages - 1);
      const start = this.page * size;
      const end = Math.min(t.rowCount, start + size);
      const rows = [];
      for (let i = start; i < end; i++) rows.push({ head: { text: fmt(i + 1) }, cells: t.rowAt(i) });
      this.grid.render({
        mode: 'data',
        role: 'drill',
        scrollKey: 'drill:' + this.page,
        columns: t.header.map((name) => ({ key: name, label: name, letter: '' })),
        rows: rows,
        numeric: this.numeric
      });
      this._renderPager(pages, start, end);
    }

    _renderPager(pages, start, end) {
      Dom.clear(this.pager);
      this.pager.hidden = pages < 2;
      if (pages < 2) return;
      const go = (p) => {
        this.page = Math.max(0, Math.min(pages - 1, p));
        this._render();
      };
      const btn = (icon, title, page, disabled) => {
        const b = UI.iconButton(icon, title, () => go(page), 'lq-btn--sm');
        b.disabled = disabled;
        return b;
      };
      const atFirst = this.page === 0;
      const atLast = this.page >= pages - 1;
      const first = btn('angles-left', '最初のページ', 0, atFirst);
      const prev = btn('angle-left', '前のページ', this.page - 1, atFirst);
      const next = btn('angle-right', '次のページ', this.page + 1, atLast);
      const last = btn('angles-right', '最後のページ', pages - 1, atLast);
      Dom.append(this.pager, [first, prev, h('span', { class: 'lq-num', text: (this.page + 1) + ' / ' + pages + ' ページ' }), next, last,
        h('span', { class: 'lq-topbar__spacer' }), h('span', { class: 'lq-num', text: fmt(start + 1) + '–' + fmt(end) + ' 行目 ／ 全 ' + fmt(this.table.rowCount) + ' 行' })]);
    }

    _fileName() {
      const by = this.entry.by.map((b) => b.value).join('_') || '全体';
      return Util.sanitizeFileName('LightQuery_内訳_' + by + '_' + Util.timestamp());
    }

    async _copy() {
      const ok = await LQ.Exporters.copyText(LQ.Exporters.toClipboardText(this.table));
      this.toasts.show(ok
        ? { type: 'success', title: '内訳をコピーしました', message: fmt(this.table.rowCount) + ' 行 × ' + this.table.header.length + ' 列（見出し付き）。Excel に貼り付けられます。' }
        : { type: 'error', title: 'コピーできませんでした', message: 'ブラウザがクリップボードへの書き込みを許可していません。「Excel」で出力してください。' });
    }

    async _exportXlsx() {
      try {
        const meta = [['項目', '内容'], ['内訳', this.title.textContent.replace(/^内訳：/, '')], ['対象', this.scopeText], ['行数', String(this.table.rowCount)],
          ['ピボットの設定', LQ.Aggregator.describe(this.state.aggregate)], ['出力日時', new Date().toLocaleString('ja-JP')]];
        const out = await LQ.Exporters.build('xlsx', this.table, { metaLines: meta, sheets: [{ name: '内訳', table: this.table }] });
        const name = this._fileName() + '.xlsx';
        LQ.Exporters.download(out.blob, name);
        this.toasts.show({ type: 'success', title: '内訳を出力しました', message: name + '（' + fmt(this.table.rowCount) + ' 行・' + Util.formatBytes(out.blob.size) + '）' });
      } catch (err) {
        this.toasts.show({ type: 'error', title: '出力できませんでした', message: err.message });
      }
    }
  }

  LQ.DrillTable = DrillTable;
  LQ.DrillView = DrillView;
})(window);
