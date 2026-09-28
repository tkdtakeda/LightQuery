/* =========================================================================
 * LightQuery - lq-ui-profile-dialogs.js
 * 抽出条件まわりの小窓：行の操作メニュー、JSON の書き出し（1 件／一括）、一括ファイルの読み込み方法、
 *   表（複数ファイル・複数シート）の選択、すべてクリアの確認
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Dom = LQ.Dom;
  const Util = LQ.Util;
  const UI = LQ.UI;
  const h = Dom.h;
  const fmt = Util.formatInt;

  class ProfileDialogs {
    constructor(ctx) {
      this.ctx = ctx;
      this.state = ctx.state;
      this.app = ctx.app;
      this.pop = ctx.popovers;
    }

    _head(icon, title) {
      return h('div', { class: 'lq-popover__head' }, [Dom.icon(icon), h('span', { text: title }), UI.iconButton('xmark', '閉じる（Esc）', () => this.pop.close(), 'lq-btn--sm')]);
    }

    /** 数字キーで選べるようにする（小窓を閉じると解除） */
    _keys(map) {
      const handler = (e) => {
        const fn = map[e.key];
        if (!fn || e.ctrlKey || e.altKey || e.metaKey || Dom.isEditable(e.target)) return;
        e.preventDefault();
        fn();
      };
      document.addEventListener('keydown', handler, true);
      return () => document.removeEventListener('keydown', handler, true);
    }

    /* ---------------- 行の操作メニュー ---------------- */

    openRowMenu(anchor, id) {
      const key = 'profmenu:' + id;
      if (this.pop.isOpen(key)) {
        this.pop.close();
        return;
      }
      const s = this.state;
      const p = s.profiles.find(id);
      if (!p) return;
      const rank = s.profiles.rank(id);
      const last = s.profiles.length;
      const item = (icon, label, sub, fn, opts) => UI.menuItem(this.pop, icon, label, sub, fn, opts);
      const move = (to) => () => this.app.profiles.moveTo(id, to);
      const menu = h('div', { class: 'lq-menu' }, [
        item('clone', '複製', '元のすぐ下に作ります（② も複製）', () => this.app.profiles.duplicate(id), { disabled: !s.profiles.canAdd() }),
        item('file-export', 'JSON に書き出す…', 'この抽出条件だけを .json に保存', () => this.openJsonExport(anchor, id)),
        h('div', { class: 'lq-menu__sep' }),
        item('angles-up', '一番上へ（1 位にする）', null, move(0), { disabled: rank === 1 }),
        item('angle-up', '1 つ上へ', 'Alt+↑ でも移動できます', move(rank - 2), { disabled: rank === 1 }),
        item('angle-down', '1 つ下へ', 'Alt+↓ でも移動できます', move(rank), { disabled: rank === last }),
        item('angles-down', '一番下へ', null, move(last - 1), { disabled: rank === last }),
        h('div', { class: 'lq-menu__sep' }),
        item('trash-can', '削除', '通知の「元に戻す」で戻せます', () => this.app.profiles.remove(id), { danger: true })
      ]);
      this.pop.open(anchor, [h('div', { class: 'lq-popover__head' }, [Dom.icon('filter'), h('span', { text: rank + ' 位「' + p.name + '」' })])].concat(menu),
        { key: key, placement: 'bottom-end' });
    }

    /* ---------------- JSON の書き出し ---------------- */

    /** id を渡すとその抽出条件 1 件を選んだ状態で開く */
    openJsonExport(anchor, id) {
      if (this.pop.isOpen('json')) {
        this.pop.close();
        return;
      }
      const s = this.state;
      const target = s.profiles.find(id) || s.activeProfile;
      let scope = id || s.profiles.length === 1 ? 'one' : 'all';
      let nameEdited = false;
      const choices = new Map();
      const list = h('div', { class: 'lq-choice-list', role: 'radiogroup' });
      const withData = UI.switchToggle('② 条件データの中身も含める（読み込むだけですぐ使えます）', true, () => {});
      const nameInput = h('input', { class: 'lq-input', type: 'text', title: 'ファイル名（拡張子 .json は自動で付きます）' });
      nameInput.addEventListener('input', () => {
        nameEdited = true;
      });
      const refresh = () => {
        choices.forEach((c, v) => {
          c.radio.checked = v === scope;
          c.el.classList.toggle('is-selected', v === scope);
        });
        if (!nameEdited) nameInput.value = this.app.profiles.defaultJsonName(scope, target);
      };
      [
        { value: 'one', title: '「' + target.name + '」だけ（1 件）', desc: 'この抽出条件だけを書き出します。ほかの人に渡す・別の一覧に追加するときに。' },
        { value: 'all', title: 'すべて（' + s.profiles.length + ' 件）', desc: '一覧の全件と優先順位・振り分けの設定・照合ルール・出力列をまとめて書き出します（バックアップ・別の PC への移行に）。' }
      ].forEach((opt) => {
        const radio = h('input', { type: 'radio', name: 'lq-json-scope' });
        const el = h('label', { class: 'lq-choice' }, [radio, h('span', { class: 'lq-choice__title', text: opt.title }), h('span', { class: 'lq-choice__desc', text: opt.desc })]);
        radio.addEventListener('change', () => {
          if (!radio.checked) return;
          scope = opt.value;
          refresh();
        });
        choices.set(opt.value, { el: el, radio: radio });
        list.appendChild(el);
      });
      const run = () => {
        this.pop.close();
        this.app.profiles.exportJson({ scope: scope, id: target.id, withData: withData.input.checked, fileName: nameInput.value });
      };
      nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing) {
          e.preventDefault();
          run();
        }
      });
      const runBtn = h('button', { class: 'lq-btn lq-btn--primary', type: 'button', onclick: run }, [Dom.icon('download'), '書き出す（.json）']);
      const body = h('div', { class: 'lq-popover__body' }, [h('div', { class: 'lq-stack' }, [
        UI.field('書き出す範囲', list),
        withData.el,
        h('p', { class: 'lq-field__hint', text: '② の中身を含めると、顧客 ID などのデータもファイルに入ります。含めない場合は、読み込んだあとで ② を読み込み直します。' }),
        UI.field('ファイル名', h('div', { class: 'lq-export-name' }, [nameInput, h('span', { class: 'lq-muted', text: '＋.json' })]))
      ])]);
      LQ.FormNav.attach(body);
      this.pop.open(anchor, [this._head('file-export', '抽出条件を JSON に書き出す'), body, h('div', { class: 'lq-popover__foot' }, [runBtn,
        h('span', { class: 'lq-field__hint', text: '読み込みは「読込」またはファイルのドラッグ＆ドロップ' })])], { key: 'json', size: 'lg' });
      refresh();
      runBtn.focus();
    }

    /* ---------------- 一括ファイルの読み込み方法 ---------------- */

    /** @param {{fileName:string, count:number}} info  @param {Function} onChoose ('replace'|'add') */
    openImportChoice(info, onChoose) {
      let release = null;
      const choose = (mode) => {
        this.pop.close();
        onChoose(mode);
      };
      const btn = (mode, icon, title, sub, key, primary) => h('button', {
        class: 'lq-btn lq-btn--block lq-btn--tall' + (primary ? ' lq-btn--primary' : ''), type: 'button', onclick: () => choose(mode)
      }, [Dom.icon(icon), h('span', { class: 'lq-btn__text' }, [h('span', { text: title }), h('span', { class: 'lq-btn__sub', text: sub })]), h('span', { class: 'lq-kbd', text: key })]);
      const first = btn('replace', 'arrows-rotate', '今の一覧と置き換える', '照合ルール・出力列・振り分けの設定もファイルの内容にします', '1', true);
      this.pop.open(null, [
        this._head('file-import', '抽出条件の一括ファイルを読み込みます'),
        h('div', { class: 'lq-popover__body' }, [h('div', { class: 'lq-stack' }, [
          h('p', { text: info.fileName + '（抽出条件 ' + info.count + ' 件）を、どのように読み込みますか？' }),
          first,
          btn('add', 'plus', '今の一覧の後ろに追加する', '今の設定はそのまま。優先順位は下になり、照合ルールが違う分は個別の設定として付けます', '2', false),
          h('p', { class: 'lq-field__hint', text: 'どちらも、通知の「元に戻す」で読み込む前に戻せます。' })
        ])])
      ], { key: 'importchoice', size: 'lg', onClose: () => release && release() });
      release = this._keys({ 1: () => choose('replace'), 2: () => choose('add') });
      first.focus();
    }

    /* ---------------- 表（複数ファイル・複数シート）の選択 ---------------- */

    /**
     * @param {Array<{dataset:LQ.Dataset, name:string, label:string}>} tables
     * @param {'active'|'new'|'append'} mode append：一覧の最後に加える（② のタブ・パネルの「条件データを追加」）
     * @param {Function} onConfirm (selectedTables, intoActive)
     */
    openTableChooser(tables, mode, onConfirm) {
      const s = this.state;
      const active = s.activeProfile;
      const items = tables.map((t) => {
        const input = h('input', { type: 'checkbox', checked: t.dataset.rowCount > 0 });
        const names = t.dataset.columnNames();
        const el = h('label', { class: 'lq-tablepick' + (t.dataset.rowCount ? '' : ' is-empty') }, [
          input,
          h('span', { class: 'lq-tablepick__name', text: t.name }),
          h('span', { class: 'lq-tablepick__size lq-num', text: t.dataset.rowCount ? fmt(t.dataset.rowCount) + ' 行 × ' + t.dataset.colCount + ' 列' : 'データなし' }),
          h('span', { class: 'lq-tablepick__src', text: t.label }),
          h('span', { class: 'lq-tablepick__cols', text: names.length ? '列：' + names.slice(0, 5).join('・') + (names.length > 5 ? ' ほか' : '') : '', title: names.join('、') })
        ]);
        return { t: t, input: input, el: el };
      });
      const confirmBtn = h('button', { class: 'lq-btn lq-btn--primary', type: 'button' }, [Dom.icon('check'), h('span')]);
      const note = h('p', { class: 'lq-field__hint' });
      const selected = () => items.filter((it) => it.input.checked).map((it) => it.t);
      const refresh = () => {
        const n = selected().length;
        const intoActive = mode === 'active' && n === 1;
        const append = mode === 'append';
        confirmBtn.disabled = n === 0;
        confirmBtn.lastChild.textContent = intoActive ? '「' + active.name + '」の ② に読み込む' : (append ? '条件データを ' + n + ' 件追加する' : '抽出条件を ' + n + ' 件作る');
        if (intoActive) note.textContent = '選択中の抽出条件「' + active.name + '」の ② を、選んだ表に差し替えます（元に戻せます）。';
        else note.textContent = (active.isBlank() ? '1 件目は空の抽出条件「' + active.name + '」に入れ、残りは' + (append ? '一覧の最後' : 'その下') + 'に並べます。'
          : (append ? '一覧の最後（優先順位が最も低い位置）に並べます。' : '選択中の抽出条件の下に並べます。')) +
          '名前は表の名前（あとで変えられます）、優先順位は表の順です。列の構成は表ごとに違っていて構いません。';
      };
      items.forEach((it) => it.input.addEventListener('change', refresh));
      const setAll = (on) => {
        items.forEach((it) => {
          it.input.checked = on && it.t.dataset.rowCount > 0;
        });
        refresh();
      };
      confirmBtn.addEventListener('click', () => {
        const list = selected();
        if (!list.length) return;
        this.pop.close();
        onConfirm(list, mode === 'active' && list.length === 1);
      });
      this.pop.open(null, [
        this._head('table-list', '② 条件データとして読み込む表を選んでください'),
        h('div', { class: 'lq-popover__body' }, [h('div', { class: 'lq-stack' }, [
          h('div', { class: 'lq-row' }, [
            h('span', { class: 'lq-sub', text: tables.length + ' 個の表があります。' }),
            h('button', { class: 'lq-btn lq-btn--xs', type: 'button', onclick: () => setAll(true) }, [Dom.icon('square-check'), 'すべて選ぶ']),
            h('button', { class: 'lq-btn lq-btn--xs', type: 'button', onclick: () => setAll(false) }, [Dom.icon('square'), 'すべて外す'])
          ]),
          h('div', { class: 'lq-tablepicks' }, items.map((it) => it.el)),
          note
        ])]),
        h('div', { class: 'lq-popover__foot' }, [confirmBtn, h('button', { class: 'lq-btn', type: 'button', onclick: () => this.pop.close() }, 'やめる')])
      ], { key: 'tables', size: 'xl' });
      refresh();
      confirmBtn.focus();
    }

    /* ---------------- すべてクリアの確認 ---------------- */

    /** ブラウザに保存した抽出条件も消えるため、先に書き出せるようにしてから確認する */
    openClearConfirm(anchor, count, onConfirm) {
      const run = (fn) => () => {
        this.pop.close();
        fn();
      };
      this.pop.open(anchor, [
        this._head('triangle-exclamation', 'すべてクリアしますか？'),
        h('div', { class: 'lq-popover__body' }, [h('div', { class: 'lq-stack' }, [
          h('p', { text: '① 元データ・結果に加え、抽出条件 ' + count + ' 件と出力列の並び（ブラウザに保存した分も）を消去します。' }),
          UI.note('tip', '残しておきたいときは、先に JSON に書き出してください（あとで「読込」で戻せます）。'),
          h('p', { class: 'lq-field__hint', text: '消去のあと、通知の「元に戻す」でも戻せます。' })
        ])]),
        h('div', { class: 'lq-popover__foot' }, [
          h('button', { class: 'lq-btn', type: 'button', onclick: run(() => this.openJsonExport(anchor)) }, [Dom.icon('file-export'), '先に書き出す']),
          h('button', { class: 'lq-btn lq-btn--danger', type: 'button', onclick: run(onConfirm) }, [Dom.icon('trash-can'), 'すべてクリア']),
          h('button', { class: 'lq-btn lq-btn--ghost', type: 'button', onclick: () => this.pop.close() }, 'やめる')
        ])
      ], { key: 'clearall', size: 'lg' });
    }
  }

  LQ.ProfileDialogs = ProfileDialogs;
})(window);
