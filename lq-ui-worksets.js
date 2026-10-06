/* =========================================================================
 * LightQuery - lq-ui-worksets.js
 * 作業セットの切替：上部バーの「今開いているセット名」のボタンと、押すと開く一覧の小窓。
 *   いまどの作業をしているかを常に見える場所に出し、押すだけで切り替えられるようにする。
 *   一覧：最近使った順・名前で探す・開いているセットに印／行の操作：名前の変更・複製・書き出し・削除（開いているセットは削除不可）
 *   下部：新しいセット・JSON から読み込む。変更は開いているセットに自動で保存される。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Dom = LQ.Dom;
  const UI = LQ.UI;
  const h = Dom.h;
  const fmt = LQ.Util.formatInt;

  /* 名前で探す欄を出す件数 */
  const SEARCH_FROM = 6;
  const POP_KEY = 'worksets';

  /** ISO 日時 → 「10/02 14:30」（今年以外は年も付ける） */
  function when(iso) {
    if (!iso) return '未使用';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const pad = LQ.Util.pad2;
    const md = (d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    return d.getFullYear() === new Date().getFullYear() ? md : d.getFullYear() + '/' + md;
  }

  class WorksetMenu {
    constructor(ctx, worksets) {
      this.ctx = ctx;
      this.app = ctx.app;
      this.pop = ctx.popovers;
      this.ws = worksets;
      this.word = '';
      this._renaming = null;
      this.list = null;
      ctx.bus.on('worksets', () => {
        if (this.pop.isOpen(POP_KEY) && !this._renaming) this._renderList();
      });
    }

    toggle(anchor) {
      if (this.pop.isOpen(POP_KEY)) {
        this.pop.close();
        return;
      }
      this.open(anchor);
    }

    open(anchor, renameId) {
      this.word = '';
      this._renaming = null;
      this.list = h('ul', { class: 'lq-wslist', 'aria-label': '作業セットの一覧（最近使った順）' });
      this.count = h('span', { class: 'lq-badge lq-badge--count' });
      const search = h('input', { class: 'lq-input lq-input--sm', type: 'search', placeholder: 'セットの名前で探す' });
      search.addEventListener('input', () => {
        this.word = search.value.trim();
        this._renderList();
      });
      this.search = search;
      const newBtn = h('button', { class: 'lq-btn lq-btn--primary lq-btn--sm', type: 'button', title: '空の作業セットを作って開きます（① 元データはそのまま）',
        onclick: () => this._create() }, [Dom.icon('plus'), '新しいセット']);
      const importBtn = h('button', { class: 'lq-btn lq-btn--sm', type: 'button', title: '書き出した作業セット・抽出条件（.json）を読み込みます（新しいセットとして追加できます）',
        onclick: () => {
          this.pop.close();
          this.app.pickFile('settings');
        } }, [Dom.icon('folder-open'), '読み込み（.json）']);
      this.pop.open(anchor, [
        h('div', { class: 'lq-popover__head' }, [Dom.icon('folder-open'), h('span', { text: '作業セット' }), this.count,
          UI.iconButton('xmark', '閉じる（Esc）', () => this.pop.close(), 'lq-btn--sm')]),
        h('div', { class: 'lq-popover__body' }, [h('div', { class: 'lq-stack' }, [
          this.ws.sets.length >= SEARCH_FROM ? search : null,
          this.list,
          h('p', { class: 'lq-field__hint', text: '作業ごとに、抽出条件・② のデータ・照合ルール・出力列・集計の設定をまとめて保存します。変更は開いているセットに自動で保存されます。① 元データは切り替えてもそのままです。抽出条件だけをファイルで渡す・残すときは、抽出条件パネルの「書き出し」（.json）を使います。' })
        ])]),
        h('div', { class: 'lq-popover__foot' }, [newBtn, importBtn])
      ], { key: POP_KEY, size: 'lg', placement: 'bottom-start', onClose: () => {
        this._renaming = null;
      } });
      this._renderList();
      if (renameId) this._startRename(renameId);
      else if (this.ws.sets.length >= SEARCH_FROM) search.focus();
    }

    _renderList() {
      if (!this.list) return;
      const ws = this.ws;
      const word = LQ.ColumnSearch.normalize(this.word);
      const items = ws.list().filter((r) => !word || LQ.ColumnSearch.normalize(r.name).indexOf(word) !== -1);
      Dom.clear(this.list);
      items.forEach((r) => this.list.appendChild(this._row(r)));
      if (!items.length) this.list.appendChild(h('li', { class: 'lq-wslist__empty', text: '「' + this.word + '」に当てはまるセットはありません' }));
      this.count.textContent = ws.sets.length + ' / ' + LQ.Worksets.MAX;
    }

    _row(r) {
      const active = r.id === this.ws.activeId;
      const st = r.stats || {};
      const meta = '抽出条件 ' + fmt(st.profiles || 0) + ' 件・② ' + fmt(st.tables || 0) + ' 件・' + (active ? '開いています' : '最終使用 ' + when(r.usedAt));
      const main = h('button', {
        class: 'lq-wsrow__main', type: 'button', dataset: { id: r.id }, 'aria-current': active ? 'true' : 'false',
        title: active ? '開いている作業セットです' : '「' + r.name + '」に切り替えます（今のセットは保存されます）',
        onclick: () => {
          if (active) return;
          this.pop.close();
          this.ws.switchTo(r.id);
        }
      }, [
        Dom.icon(active ? 'folder-open' : 'folder', 'lq-wsrow__icon'),
        h('span', { class: 'lq-wsrow__body' }, [h('span', { class: 'lq-wsrow__name', text: r.name }), h('span', { class: 'lq-wsrow__meta', text: meta })]),
        active ? Dom.icon('check', 'lq-wsrow__check') : null
      ]);
      const tools = h('span', { class: 'lq-wsrow__tools' }, [
        UI.iconButton('pen', '名前を変える', () => this._startRename(r.id), 'lq-btn--sm'),
        UI.iconButton('copy', '複製する（中身ごとコピー）', () => this.ws.duplicate(r.id), 'lq-btn--sm'),
        UI.iconButton('file-export', '書き出す（.json・② のデータを含む。ほかの PC に渡せます）', () => this.ws.exportSet(r.id), 'lq-btn--sm'),
        UI.iconButton('trash-can', active ? '開いているセットは削除できません（別のセットに切り替えてから）' : '削除する（元に戻せます）',
          () => this.ws.remove(r.id), 'lq-btn--sm')
      ]);
      tools.lastChild.disabled = active;
      return h('li', { class: 'lq-wsrow' + (active ? ' is-active' : ''), dataset: { id: r.id } }, [main, tools]);
    }

    async _create() {
      const record = await this.ws.create();
      if (record) this.open(this.app.worksetButton.el, record.id);
    }

    /** 行の名前を入力欄にする。Enter で確定、Esc で取り消し、欄を離れても確定 */
    _startRename(id) {
      const row = this.list && this.list.querySelector('.lq-wsrow[data-id="' + CSS.escape(id) + '"]');
      const record = this.ws.sets.find((s) => s.id === id);
      if (!row || !record) return;
      this._renaming = id;
      const input = h('input', { class: 'lq-input lq-input--sm lq-wsrow__input', type: 'text', value: record.name, maxlength: '40', title: '作業セットの名前（Enter で確定・Esc で取り消し）' });
      const msg = h('span', { class: 'lq-field__hint' });
      let closed = false;
      const finish = (commit) => {
        if (closed) return;
        if (commit) {
          const err = this.ws.rename(id, input.value);
          if (err) {
            msg.textContent = err;
            LQ.Flash.el(input, 'warn');
            input.focus();
            return;
          }
        }
        closed = true;
        this._renaming = null;
        this._renderList();
        const again = this.list.querySelector('.lq-wsrow[data-id="' + CSS.escape(id) + '"]');
        if (again && commit) LQ.Flash.el(again);
      };
      input.addEventListener('keydown', (e) => {
        if (e.isComposing || e.keyCode === 229) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          finish(false);
        }
      });
      input.addEventListener('blur', () => finish(true));
      Dom.clear(row);
      Dom.append(row, [Dom.icon('pen', 'lq-wsrow__icon'), h('span', { class: 'lq-wsrow__body' }, [input, msg])]);
      input.focus();
      input.select();
    }
  }

  /* ---------------------------------------------------------------------
   * WorksetButton：上部バーの「📁 セット名 ▾」
   * ------------------------------------------------------------------- */
  class WorksetButton {
    /**
     * @param {object} ctx
     * @param {HTMLElement} topbar ボタンを置く上部バー（ロゴの右に入れる）
     * @param {LQ.Worksets} worksets
     */
    constructor(ctx, topbar, worksets) {
      this.ws = worksets;
      this.menu = new WorksetMenu(ctx, worksets);
      this.name = h('span', { class: 'lq-wsbtn__name' });
      this.el = h('button', { class: 'lq-wsbtn', type: 'button', onclick: () => this.menu.toggle(this.el) },
        [Dom.icon('folder-open', 'lq-wsbtn__icon'), this.name, Dom.icon('chevron-down', 'lq-wsbtn__caret')]);
      const brand = topbar.querySelector('.lq-brand');
      if (brand && brand.nextSibling) topbar.insertBefore(this.el, brand.nextSibling);
      else topbar.appendChild(this.el);
      ctx.bus.on('worksets', () => this.render());
      this.render();
    }

    render() {
      const ws = this.ws;
      const active = ws.active;
      const prev = this.name.textContent;
      if (!ws.available) {
        this.name.textContent = ws.failure ? '作業セットは使えません' : '準備中…';
        this.el.disabled = !!ws.failure || !ws.ready;
        this.el.title = ws.failure || '作業セットの保管庫を開いています';
        return;
      }
      this.el.disabled = false;
      this.name.textContent = active ? active.name : '作業セット';
      this.el.title = '作業セット「' + this.name.textContent + '」を開いています。押すと切り替え・新規・複製・書き出しができます（変更は自動で保存）';
      if (prev && prev !== this.name.textContent) LQ.Flash.el(this.el);
    }
  }

  LQ.WorksetButton = WorksetButton;
})(window);
