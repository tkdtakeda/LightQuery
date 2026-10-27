/* =========================================================================
 * LightQuery - lq-ui-command.js
 * 機能を探す（Ctrl+K）：機能の名前を入力して開く・実行する補助の入口（主な入口は左のアイコン列のまま）
 *   機能が増えても、名前で見て選べるようにする（記憶より再認）。
 *
 * ── 登録簿 ──
 *   Commands.register({ id, group, label, icon, keywords?, run(app), disabled?(app) → 理由の文字 | '' })
 *   keywords には言いかえと、漢字の読み（ひらがな）を入れる（日本語の変換の途中でも探せるように）
 *   登録するだけで一覧に出る（既存のコードを変えずに足せる）。押せないものは薄くして理由を出す（1-4）。
 *
 * ── 一覧の小窓 ──
 *   CommandPalette：入力で絞り込み（全角半角・大文字小文字・ひらがなカタカナを区別しない）、↑↓・Enter で実行、Esc で閉じる。
 *
 * ── 標準の機能 ──
 *   パネル・タブ・主要動作・表示密度・サンプル・取扱説明書・書き出しなど。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Dom = LQ.Dom;
  const h = Dom.h;

  const registry = [];

  const Commands = {
    register(cmd) {
      const i = registry.findIndex((c) => c.id === cmd.id);
      if (i >= 0) registry[i] = cmd;
      else registry.push(cmd);
    },
    list() {
      return registry.slice();
    }
  };

  /* ---------------------------------------------------------------------
   * CommandPalette
   * ------------------------------------------------------------------- */
  class CommandPalette {
    constructor(ctx) {
      this.ctx = ctx;
      this.app = ctx.app;
      this.el = null;
      this._hits = [];
      this._index = 0;
    }

    isOpen() {
      return !!this.el;
    }

    toggle() {
      if (this.el) this.close();
      else this.open();
    }

    open() {
      if (this.el) return;
      this.ctx.popovers.close();
      this._return = document.activeElement;
      this.input = h('input', { class: 'lq-input lq-cmd__input', type: 'text', placeholder: '機能の名前で探す（例：ピボット・出力・密度・履歴）', 'aria-label': '機能を探す',
        oninput: () => this._filter(), onkeydown: (e) => this._onKey(e) });
      this.listEl = h('ul', { class: 'lq-cmd__list', role: 'listbox' });
      this.box = h('div', { class: 'lq-cmd', role: 'dialog', 'aria-label': '機能を探す' }, [
        h('div', { class: 'lq-cmd__head' }, [Dom.icon('magnifying-glass'), this.input, h('kbd', { class: 'lq-kbd', text: 'Esc' })]),
        this.listEl,
        h('div', { class: 'lq-cmd__foot', text: '↑↓ で選ぶ・Enter で開く・Esc で閉じる' })
      ]);
      this.el = h('div', { class: 'lq-cmd-backdrop', onmousedown: (e) => {
        if (e.target === this.el) this.close();
      } }, this.box);
      document.body.appendChild(this.el);
      this._filter();
      this.input.focus();
    }

    close() {
      if (!this.el) return false;
      this.el.remove();
      this.el = null;
      if (this._return && this._return.focus) this._return.focus();
      return true;
    }

    _filter() {
      const word = this.input.value.trim();
      const items = Commands.list().map((c) => ({ label: c.label + ' ' + c.group + ' ' + (c.keywords || ''), cmd: c }));
      const hits = word ? LQ.ColumnSearch.rank(items, word).map((x) => x.item.cmd) : items.map((x) => x.cmd);
      this._hits = hits;
      this._index = Math.max(0, hits.findIndex((c) => !this._reason(c)));
      this._render();
    }

    _reason(cmd) {
      try {
        return cmd.disabled ? cmd.disabled(this.app) || '' : '';
      } catch (e) {
        return '';
      }
    }

    _render() {
      Dom.clear(this.listEl);
      if (!this._hits.length) {
        this.listEl.appendChild(h('li', { class: 'lq-cmd__empty', text: '当てはまる機能がありません。別の言葉（例：集計 → ピボット、見た目 → 表示密度）で探すか、左のアイコン列・右上の ⋮ メニューも見てください。' }));
        return;
      }
      this._hits.forEach((c, i) => {
        const reason = this._reason(c);
        this.listEl.appendChild(h('li', {
          class: 'lq-cmd__item' + (i === this._index ? ' is-active' : '') + (reason ? ' is-disabled' : ''), role: 'option',
          'aria-selected': i === this._index ? 'true' : 'false', 'aria-disabled': reason ? 'true' : null,
          onmousemove: () => this._select(i), onclick: () => this._run(i)
        }, [Dom.icon(c.icon || 'circle'), h('span', { class: 'lq-cmd__label', text: c.label }),
          reason ? h('span', { class: 'lq-cmd__reason', text: reason }) : null,
          h('span', { class: 'lq-cmd__group', text: c.group })]));
      });
      const cur = this.listEl.children[this._index];
      if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
    }

    _select(i) {
      if (i === this._index) return;
      this._index = i;
      Array.prototype.forEach.call(this.listEl.children, (li, j) => {
        li.classList.toggle('is-active', j === i);
        li.setAttribute('aria-selected', j === i ? 'true' : 'false');
      });
    }

    _onKey(e) {
      if (e.isComposing) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!this._hits.length) return;
        const n = this._hits.length;
        this._index = (this._index + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
        this._render();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this._run(this._index);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    }

    _run(i) {
      const cmd = this._hits[i];
      if (!cmd || this._reason(cmd)) return;
      this._return = null;
      this.close();
      cmd.run(this.app);
    }
  }

  LQ.Commands = Commands;
  LQ.CommandPalette = CommandPalette;
})(window);

/* =========================================================================
 * ── 標準の機能 ──
 * 左のアイコン列・タブ・⋮ メニューにある機能を、同じ名前で登録する（名前と位置を画面とそろえる）
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const reg = LQ.Commands.register;
  const busyReason = (app) => (app.state.busy ? '処理中のため使えません' : '');

  [
    ['source', 'table', '① 元データ', '入力', '読み込み ヘッダー 範囲 列の追加 絞り込み 縦に結合 縦持ち 重複 もとでーた よみこみ'],
    ['condition', 'list-check', '② 照合表', '入力', '読み込み ヘッダー 範囲 しょうごうひょう よみこみ'],
    ['query', 'code-compare', '抽出条件', '抽出', '条件 比較 優先順位 組み合わせ ちゅうしゅつじょうけん じょうけん'],
    ['output', 'table-columns', '出力列', '結果', '列 表示 並べ替え しゅつりょくれつ'],
    ['aggregate', 'table-cells', 'ピボット', '結果', '集計 行 列 値 合計 件数 しゅうけい'],
    ['chart', 'chart-column', 'グラフ', '結果', '棒 折れ線 散布図 ヒストグラム'],
    ['rules', 'spell-check', '照合ルール', '設定', '全角 半角 空白 大文字 表記ゆれ 年度 しょうごうるーる ねんど'],
    ['history', 'clock-rotate-left', '実行履歴', '記録', '履歴 ログ 結果 警告 りれき じっこうりれき']
  ].forEach((p) => reg({ id: 'panel:' + p[0], icon: p[1], label: p[2] + 'のパネルを開く', group: p[3], keywords: p[4],
    run: (app) => app.state.openPanel(p[0]) }));

  [
    ['source', 'table', '① 元データの表を見る'],
    ['condition', 'list-check', '② 照合表の表を見る'],
    ['result', 'table-list', '抽出結果を見る'],
    ['aggregate', 'table-cells', 'ピボットを見る'],
    ['chart', 'chart-column', 'グラフを見る']
  ].forEach((t) => reg({ id: 'tab:' + t[0], icon: t[1], label: t[2], group: 'タブ', run: (app) => app.state.setTab(t[0]) }));

  reg({ id: 'cta', icon: 'play', label: '次にすること（右上の青いボタン）', group: '主要動作', keywords: '抽出 出力 読み込み 実行 ちゅうしゅつ しゅつりょく',
    run: (app) => app.runCta(app.shell.topbar.cta),
    disabled: (app) => (app.cta().disabled ? '今は押せません：' + (app.cta().status ? app.cta().status.text : '') : '') });
  reg({ id: 'flow:filterOnly', icon: 'filter', label: '絞り込みだけに切り替える（② と照合しない）', group: '抽出',
    keywords: '照合しない 照合なし 絞り込み フィルター ② なし しぼりこみ しょうごうしない',
    run: (app) => app.filterOnly.set(true), disabled: (app) => (app.state.filterOnly ? '今は絞り込みだけです' : busyReason(app)) });
  reg({ id: 'flow:match', icon: 'code-compare', label: '照合して抽出に戻す', group: '抽出', keywords: '照合する ② を使う しょうごう ちゅうしゅつ',
    run: (app) => app.filterOnly.set(false), disabled: (app) => (app.state.filterOnly ? busyReason(app) : '今は照合して抽出しています') });
  reg({ id: 'load:source', icon: 'file-import', label: '① 元データのファイルを選ぶ', group: '入力', keywords: '読み込み 差し替え 開く',
    run: (app) => app.pickFile('source'), disabled: busyReason });
  reg({ id: 'load:condition', icon: 'file-import', label: '② 照合表のファイルを選ぶ', group: '入力', keywords: '読み込み 差し替え 開く',
    run: (app) => app.pickFile('condition'), disabled: busyReason });
  LQ.Density.LEVELS.forEach((d) => reg({ id: 'density:' + d.value, icon: 'text-height', label: '表示密度を「' + d.label + '」にする', group: '表示',
    keywords: '文字 大きさ 余白 行 間隔 見た目 密度 ひょうじみつど みつど もじ', run: (app) => app.density.set(d.value),
    disabled: (app) => (app.density.value === d.value ? '今の表示密度です' : '') }));
  reg({ id: 'samples', icon: 'flask', label: 'サンプルデータで試す', group: '記録', keywords: '例 お試し さんぷる',
    run: (app) => app.dialogs.openSamples(app.shell.topbar.menuBtn, 'bottom-end'), disabled: busyReason });
  reg({ id: 'samples:clear', icon: 'broom', label: 'サンプルデータのみクリア', group: '記録', keywords: '消す 削除',
    run: (app) => app.profiles.clearSamples(), disabled: (app) => (app.state.hasSample() ? busyReason(app) : 'サンプルデータは読み込まれていません') });
  reg({ id: 'json:export', icon: 'file-export', label: '抽出条件を書き出す（.json）', group: '保存', keywords: '保存 エクスポート',
    run: (app) => app.profileDialogs.openJsonExport(app.shell.topbar.menuBtn) });
  reg({ id: 'json:import', icon: 'folder-open', label: '抽出条件を読み込む（.json）', group: '保存', keywords: 'インポート 開く',
    run: (app) => app.pickFile('settings'), disabled: busyReason });
  reg({ id: 'manual', icon: 'book-open', label: '使い方（取扱説明書）を開く', group: 'ヘルプ', keywords: '説明 ヘルプ マニュアル つかいかた せつめい',
    run: (app) => app.manual.open() });
})(window);
