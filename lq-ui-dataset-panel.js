/* =========================================================================
 * LightQuery - lq-ui-dataset-panel.js
 * 読み込みの画面：条件データの切替と ① / ② の読み込みパネル
 * （下の区切りごとに独立した部品。読み込み順どおりに並べている）
 * ========================================================================= */

/* =========================================================================
 * ── 条件データの切替 ──
 * 条件データ（抽出条件ごとの ②）を並べて切り替える部品
 *   CondTableBar  … メインの「② 条件データ」タブの上に出す切替ボタン（結果の絞り込みと同じ見た目）
 *   CondTableList … 左の「②条件データ」パネルの上部に出す一覧
 *   どちらも選ぶと「選択中の抽出条件」を切り替える（選択は画面全体で 1 つ）。
 *   「条件データを追加」は、ファイルを選んで表ごとに抽出条件を作り、一覧の最後（優先順位が最も低い位置）に加える。
 *   固定値だけの条件で ② を使わない抽出条件は、条件データを持たないため並べない。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Dom = LQ.Dom;
  const Util = LQ.Util;
  const UI = LQ.UI;
  const h = Dom.h;
  const fmt = Util.formatInt;

  const ADD_TITLE = 'Excel のシートや CSV を選び、条件データを一覧の最後に追加します（複数のファイル・シートを選べます）';

  /**
   * 並べる条件データ（優先順位の順）
   * @returns {Array<{profile:LQ.Profile, rank:number, active:boolean, ds:LQ.Dataset|null}>}
   */
  function tableItems(state) {
    const activeId = state.activeProfile.id;
    const items = [];
    state.profiles.items.forEach((p, i) => {
      if (!p.condition && LQ.QueryOps.fixedOnly(p.query)) return;
      items.push({ profile: p, rank: i + 1, active: p.id === activeId, ds: p.condition });
    });
    return items;
  }

  /** 表の要約（ファイル名・シート・行数）。未読み込みなら前回のファイル名 */
  function describe(item) {
    const ds = item.ds;
    if (ds) {
      const src = ds.source;
      const sheet = src.hasSheets && src.sheetNames.length > 1 ? '［' + src.sheetName + '］' : '';
      return ds.name + sheet + '・' + fmt(ds.rowCount) + ' 行 × ' + ds.colCount + ' 列';
    }
    const ref = item.profile.conditionRef;
    return ref && ref.fileName ? '未読み込み（前回：' + ref.fileName + '）' : '未読み込み';
  }

  /* ---------------------------------------------------------------------
   * CondTableBar：② タブの切替ボタン
   * ------------------------------------------------------------------- */
  class CondTableBar {
    constructor(ctx) {
      this.state = ctx.state;
      this.app = ctx.app;
    }

    /** 並べる条件データの件数（タブの表示用） */
    static count(state) {
      return tableItems(state).length;
    }

    /** 切替ボタンの帯（描き直すたびに作る）。focusKey は描き直したあとにフォーカスを戻すための目印 */
    render() {
      const chips = tableItems(this.state).map((it) => this._chip(it));
      const add = h('button', {
        class: 'lq-fchip lq-fchip--add', type: 'button', title: ADD_TITLE, dataset: { focusKey: 'cond:add' },
        onclick: () => this.app.profiles.addTables()
      }, [Dom.icon('plus'), h('span', { class: 'lq-fchip__label', text: '条件データを追加' })]);
      return h('div', { class: 'lq-filterbar lq-condbar', role: 'toolbar', 'aria-label': '表示する条件データ' },
        [h('span', { class: 'lq-filterbar__label' }, [UI.badge('cond', '②'), '表示する条件データ'])].concat(chips, [add]));
    }

    _chip(it) {
      const p = it.profile;
      const title = it.rank + ' 位「' + p.name + '」：' + describe(it) + (p.enabled ? '' : '（無効：抽出に使いません）') +
        (it.active ? '' : '。押すとこの条件データを表示します');
      return h('button', {
        class: 'lq-fchip' + (it.active ? ' is-active' : '') + (it.ds ? '' : ' lq-fchip--none') + (p.enabled ? '' : ' is-disabled'),
        type: 'button', title: title, 'aria-pressed': it.active ? 'true' : 'false', dataset: { focusKey: 'cond:' + p.id },
        onclick: () => this.state.setActive(p.id)
      }, [
        h('span', { class: 'lq-fchip__rank', text: String(it.rank) }),
        h('span', { class: 'lq-fchip__label', text: p.name }),
        h('span', { class: 'lq-fchip__count lq-num', text: it.ds ? fmt(it.ds.rowCount) + ' 行' : '未読み込み' })
      ]);
    }
  }

  /* ---------------------------------------------------------------------
   * CondTableList：② パネルの一覧
   * ------------------------------------------------------------------- */
  class CondTableList {
    constructor(ctx) {
      this.state = ctx.state;
      this.app = ctx.app;
      this.count = h('span', { class: 'lq-badge lq-badge--count' });
      this.list = h('ul', { class: 'lq-condtables', 'aria-label': '条件データの一覧（上ほど優先）' });
      this.hint = h('p', { class: 'lq-field__hint' });
      const add = h('button', { class: 'lq-btn lq-btn--xs', type: 'button', title: ADD_TITLE, onclick: () => this.app.profiles.addTables() },
        [Dom.icon('plus'), '追加']);
      this.el = UI.section('条件データの一覧', [this.list, this.hint], [this.count, h('span', { class: 'lq-section__tools' }, [add])]);
      ['profiles', 'datasets', 'query', 'store'].forEach((topic) => ctx.bus.on(topic, () => this.render()));
      this.render();
    }

    render() {
      const items = tableItems(this.state);
      const focusId = this._focusedId();
      Dom.clear(this.list);
      items.forEach((it) => this.list.appendChild(this._row(it)));
      this.count.textContent = items.length + ' 件';
      this.hint.textContent = items.length > 1
        ? '選ぶと、下の読み込み設定と右の表がその条件データに切り替わります。上ほど優先されます（並べ替えは「抽出条件」パネルで）。'
        : '「追加」で条件データを増やすと、優先順位を付けて 1 つの結果にまとめられます（表ごとに列の構成が違っていて構いません）。';
      if (focusId) this._focus(focusId);
    }

    _row(it) {
      const p = it.profile;
      const main = h('button', {
        class: 'lq-condtable__main', type: 'button', dataset: { id: p.id }, 'aria-current': it.active ? 'true' : 'false',
        title: it.active ? '選択中の条件データです' : '「' + p.name + '」を選び、読み込み設定と表を切り替えます',
        onclick: () => this.state.setActive(p.id)
      }, [
        h('span', { class: 'lq-badge lq-badge--rank', text: it.rank + ' 位' }),
        h('span', { class: 'lq-condtable__body' }, [
          h('span', { class: 'lq-condtable__name', text: p.name }),
          h('span', { class: 'lq-condtable__meta', text: describe(it) })
        ]),
        p.enabled ? null : h('span', { class: 'lq-tag', text: '無効' })
      ]);
      const setup = it.active ? h('button', {
        class: 'lq-btn lq-btn--xs', type: 'button', title: '「' + p.name + '」の条件（① のどの列と比べるか）を設定します',
        onclick: () => this.state.openPanel('query')
      }, [Dom.icon('filter'), '条件を設定']) : null;
      return h('li', { class: 'lq-condtable' + (it.active ? ' is-active' : '') + (it.ds ? '' : ' is-empty') + (p.enabled ? '' : ' is-disabled') },
        [main, setup]);
    }

    /** 一覧の中でフォーカスしている条件データ（描き直したあとに戻す） */
    _focusedId() {
      const el = document.activeElement;
      return el && this.list.contains(el) && el.dataset ? el.dataset.id || null : null;
    }

    _focus(id) {
      const el = this.list.querySelector('[data-id="' + CSS.escape(id) + '"]');
      if (el) el.focus();
    }
  }

  LQ.CondTableBar = CondTableBar;
  LQ.CondTableList = CondTableList;
})(window);

/* =========================================================================
 * ── 読み込みパネル ──
 * ① 元データ / ② 条件データの読み込みパネル：
 *   ファイル（選択・シート・文字コード・区切り文字と判定の根拠）、読み込み範囲（ヘッダー・開始行・開始列・終了行）、
 *   列の追加、絞り込み、読み込み結果（行数・列数・列名）の順（処理の順）に並べる。入力欄は作り直さず値だけ更新し、フォーカスを保つ。
 *   「読み方」（文字コード・区切り文字）と「読み込み範囲」は、見出しに要約を出して畳んでおく（開閉は ① / ② ごとに記憶。
 *   判定が不確かなときは読み方を開く）。範囲は右の表の行番号・列記号でも指定できるため、畳んでいても操作できる。
 *   ② は選択中の抽出条件のもの（抽出条件を切り替えると、このパネルもその ② に切り替わる）。
 *   ② のパネルは上部に条件データの一覧（CondTableList）を置き、ここでも切り替え・追加できる。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Dom = LQ.Dom;
  const Util = LQ.Util;
  const UI = LQ.UI;
  const Flash = LQ.Flash;
  const h = Dom.h;

  const KIND_ICON = { excel: 'file-excel', csv: 'file-csv', paste: 'paste', sample: 'flask', stored: 'floppy-disk' };
  const FIELD_LABEL = { hasHeader: 'ヘッダー', headerRow: 'ヘッダー行', startRow: 'データ開始行', startCol: '開始列', endRow: '終了行' };

  /* ---------------------------------------------------------------------
   * ColumnChips：読み込んだ列のタグ。クリックで表示／非表示（出力列パネルと同じ設定）を切り替える
   *   列名・列記号（AAB など）での絞り込みと「すべて ON／OFF」（絞り込み中は一覧に出ている列だけ）。状態はアイコン＋見た目＋文字で示す
   *   ・絞り込みの語は右のプレビューにも伝え、当てはまる列の見出しを強調してその位置まで送る（列が多い表で列を探せる）
   *   ・選択中の抽出条件の条件で使っている列には、その条件の記号（A・B…）を付ける（① と ② の対応を見比べられる）
   * ------------------------------------------------------------------- */
  class ColumnChips {
    /**
     * @param {object} ctx
     * @param {string} prefix 出力列のキーの頭（① 's:' / ② 'c:'）
     */
    constructor(ctx, prefix) {
      this.ctx = ctx;
      this.state = ctx.state;
      this.app = ctx.app;
      this.prefix = prefix;
      this.ds = null;
      this._shown = [];
      this.role = prefix === 's:' ? 'source' : 'condition';
      this.filter = h('input', { class: 'lq-input lq-input--sm', type: 'search', placeholder: '列名・列記号で探す',
        title: '列名の一部か列記号でタグを絞り込み、右の表の当てはまる列を強調してその位置まで送ります' });
      this.filter.addEventListener('input', () => {
        this.render();
        this._find();
      });
      this.count = h('span', { class: 'lq-colbulk__count lq-num' });
      this.allOn = h('button', { class: 'lq-btn lq-btn--xs', type: 'button', onclick: () => this._bulk(true) }, [Dom.icon('eye'), 'すべて ON']);
      this.allOff = h('button', { class: 'lq-btn lq-btn--xs', type: 'button', onclick: () => this._bulk(false) }, [Dom.icon('eye-slash'), 'すべて OFF']);
      this.list = h('div', { class: 'lq-colchips lq-colchips--toggle' });
      this.list.addEventListener('click', (e) => {
        const chip = e.target.closest('[data-key]');
        if (!chip) return;
        this.state.setColumnVisible(chip.dataset.key, chip.getAttribute('aria-pressed') !== 'true');
        const again = this.list.querySelector('[data-key="' + CSS.escape(chip.dataset.key) + '"]');
        if (again) {
          again.focus();
          Flash.el(again);
        }
      });
      this.el = h('div', { class: 'lq-colpick' }, [
        h('div', { class: 'lq-colpick__head' }, [this.filter, this.allOn, this.allOff]),
        this.count,
        this.list,
        h('p', { class: 'lq-field__hint', text: 'タグを押すと出力する／しないを切り替えます。A・B は条件で使っている列です。',
          title: 'タグを押すと、その列を表示する／しないを切り替えます（出力列パネルと同じ設定）。A・B などの記号は、選択中の抽出条件のその条件で使っている列です。' })
      ]);
      ['output', 'query', 'profiles'].forEach((topic) => ctx.bus.on(topic, () => this.render()));
    }

    /** 右のプレビューに、今の絞り込みの語を伝える（空なら強調を消す） */
    _find() {
      this.ctx.bus.emit('column-find', { role: this.role, word: this.filter.value.trim() });
    }

    /** 列名 → その列を使う条件の記号（選択中の抽出条件。① は左の列、② は相手の列・範囲の終わりの列） */
    _labels() {
      const map = new Map();
      const add = (name, label) => {
        if (!name) return;
        if (!map.has(name)) map.set(name, []);
        if (map.get(name).indexOf(label) === -1) map.get(name).push(label);
      };
      this.state.activeProfile.query.conditions.forEach((c) => {
        if (this.prefix === 's:') {
          add(c.left, c.label);
          return;
        }
        if (c.right.type !== 'column') return;
        add(c.right.col, c.label);
        const op = LQ.Operators.get(c.op);
        if (op && op.pair) add(c.right.col2, c.label);
      });
      return map;
    }

    /** 列名・列記号の絞り込み（列記号は完全一致、列名は一部一致。全角半角・大文字小文字・カタカナひらがなは区別しない） */
    static matches(name, letter, word) {
      return LQ.ColumnSearch.matches(name, letter, word);
    }

    setDataset(ds) {
      this.ds = ds;
      this.render();
    }

    render() {
      Dom.clear(this.list);
      const ds = this.ds;
      if (!ds) return;
      const vis = new Map(this.state.output.columns.map((c) => [c.key, c.visible]));
      const word = this.filter.value.trim();
      const labels = this._labels();
      const items = ds.columns.filter((c) => ColumnChips.matches(c.name, c.letter, word)).map((c) => {
        const key = this.prefix + c.name;
        const v = vis.get(key);
        return { col: c, key: key, visible: v === undefined ? this.prefix === 's:' : v };
      });
      this._shown = items.map((it) => it.key);
      const frag = document.createDocumentFragment();
      items.forEach((it) => {
        frag.appendChild(h('button', {
          class: 'lq-colchip' + (it.visible ? ' is-on' : ' is-off'), type: 'button', dataset: { key: it.key },
          'aria-pressed': it.visible ? 'true' : 'false',
          title: it.col.letter + ' 列：' + it.col.name + (it.visible ? '（表示中・押すと隠す）' : '（非表示・押すと表示）')
        }, [Dom.icon(it.visible ? 'eye' : 'eye-slash'), h('span', { class: 'lq-colchip__letter', text: it.col.letter }),
          h('span', { class: 'lq-colchip__name', text: it.col.name })].concat((labels.get(it.col.name) || []).map((l) =>
          h('span', { class: 'lq-badge lq-badge--label lq-colchip__label', text: l, title: '条件 ' + l + ' で使っている列' })))));
      });
      this.list.appendChild(frag);
      const on = items.filter((it) => it.visible).length;
      this.count.textContent = (word ? '「' + word + '」に当てはまる ' + items.length + ' 列のうち' : '全 ' + items.length + ' 列のうち') + ' 表示 ' + on + ' 列';
      this.allOn.disabled = !items.length || on === items.length;
      this.allOff.disabled = !items.length || on === 0;
      this.allOn.title = this.allOn.disabled ? '対象の列はすべて表示中です' : (word ? '一覧に出ている ' : '') + items.length + ' 列を表示にする（元に戻せます）';
      this.allOff.title = this.allOff.disabled ? '対象の列はすべて非表示です' : (word ? '一覧に出ている ' : '') + items.length + ' 列を非表示にする（元に戻せます）';
    }

    _bulk(visible) {
      const keys = this._shown.slice();
      if (!keys.length) return;
      const snap = this.state.snapshot();
      this.state.setColumnsVisible(keys, visible);
      Flash.el(this.list);
      this.ctx.toasts.show({
        type: 'success',
        title: (this.filter.value.trim() ? '絞り込み中の ' : '') + keys.length + ' 列を' + (visible ? '表示' : '非表示') + 'にしました',
        message: visible ? '不要な列はタグを押して隠してください。' : '出力したい列のタグを押して表示にしてください。',
        actions: [{ label: '元に戻す', icon: 'rotate-left', onClick: () => this.app.restore(snap, '列の表示を元に戻しました') }]
      });
    }
  }

  LQ.ColumnChips = ColumnChips;

  class DatasetPanel {
    constructor(ctx, role) {
      this.ctx = ctx;
      this.state = ctx.state;
      this.app = ctx.app;
      this.role = role;
      this.isSource = role === 'source';
      this.icon = this.isSource ? 'table' : 'list-check';
      this.size = 'md';
      this.body = h('div', { class: 'lq-dsbody' });
      this.tables = this.isSource ? null : new LQ.CondTableList(ctx);
      this.el = h('div', {}, this.tables ? [this.tables.el, this.body] : [this.body]);
      this.f = {};
      this.chips = new ColumnChips(ctx, this.isSource ? 's:' : 'c:');
      if (!ctx.app.derivedEditor) ctx.app.derivedEditor = new LQ.DerivedEditor(ctx);
      this.derived = new LQ.DerivedSection(ctx, role, ctx.app.derivedEditor);
      this.filterSection = new LQ.FilterSection(ctx, role);
      this._builtKey = undefined;
      ctx.bus.on('datasets', () => this.refresh());
      ctx.bus.on('change', (e) => {
        if (e.topic === 'library') this.refresh(true);
      });
      this.refresh();
    }

    /** パネルの見出し（② は抽出条件が複数なら、どの抽出条件の ② かを添える） */
    get title() {
      if (this.isSource) return '① 元データ';
      const s = this.state;
      return s.profiles.length > 1 ? '② 条件データ：' + s.activeProfile.name : '② 条件データ';
    }

    onShow() {
      this.refresh();
    }

    refresh(force) {
      const ds = this.state.datasets[this.role];
      const owner = this.isSource ? '' : this.state.activeId + ':';
      const key = ds ? ds.id + ':' + ds.source.kind : owner + 'none';
      if (force || key !== this._builtKey) {
        this._build(ds);
        this._builtKey = key;
      }
      if (ds) this._update(ds);
    }

    /* ---------------- 組み立て ---------------- */

    _build(ds) {
      Dom.clear(this.body);
      this.f = {};
      if (!ds) {
        this.body.appendChild(this._emptySection());
        return;
      }
      /* 処理の順（読み込み範囲 → 列の追加 → 絞り込み）に並べ、その結果の列を最後に出す */
      this.body.appendChild(this._fileSection(ds));
      const read = this._readSection(ds);
      if (read) this.body.appendChild(read);
      this.body.appendChild(this._rangeSection());
      this.body.appendChild(this.derived.el);
      this.body.appendChild(this.filterSection.el);
      this.body.appendChild(this._resultSection());
    }

    _emptySection() {
      const pick = () => this.app.pickFile(this.role);
      const s = this.state;
      const p = this.isSource ? null : s.activeProfile;
      const drop = h('div', {
        class: 'lq-drop lq-drop--compact' + (this.isSource ? '' : ' lq-drop--cond'), role: 'button', tabindex: '0', onclick: pick,
        onkeydown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            pick();
          }
        }
      }, [
        Dom.icon('file-arrow-up', 'lq-drop__icon'),
        h('div', { class: 'lq-drop__title', text: p && s.profiles.length > 1 ? '「' + p.name + '」の ② を選択' : 'ファイルを選択' }),
        h('div', { class: 'lq-drop__sub', text: 'Excel（.xlsx .xlsm .xls .xlsb .ods）・CSV・TSV・TXT' }),
        h('div', { class: 'lq-drop__sub', text: 'ドラッグ＆ドロップ、または Excel でコピーした範囲を Ctrl+V でも読み込めます' })
      ]);
      const notes = [];
      const lib = LQ.ExcelLibrary;
      if (lib.failed) notes.push(UI.note('warn', lib.failureReason));
      if (p && p.conditionRef && p.conditionRef.fileName) {
        const ref = p.conditionRef;
        notes.push(UI.note('tip', '前回は「' + ref.fileName + '」' + (ref.sheetName ? '（シート「' + ref.sheetName + '」）' : '') +
          'を使っていました。同じファイルを選ぶと、シート・読み込み範囲も前回どおりにします。'));
      }
      notes.push(UI.note('info', this.isSource
        ? '抽出される側のデータです。読み込むとヘッダー行・データ開始行・開始列を自動で判定し、このパネルで調整できます。'
        : '② の 1 行が 1 セットの条件になります（例：地域＝東京 かつ 金額≧50,000）。空欄のセルは、その条件を判定しません。条件データを増やすときは、上の一覧の「追加」を使います（列の構成が違う表を、優先順位を付けて使い分けられます）。'));
      return UI.section('ファイル', [drop].concat(notes));
    }

    _fileSection(ds) {
      const src = ds.source;
      this.f.name = h('div', { class: 'lq-filecard__name' });
      this.f.meta = h('div', { class: 'lq-filecard__meta' });
      const card = h('div', { class: 'lq-filecard' + (this.isSource ? '' : ' lq-filecard--cond') }, [
        Dom.icon(KIND_ICON[src.kind] || 'file', 'lq-filecard__icon'),
        h('div', { class: 'lq-filecard__body' }, [this.f.name, this.f.meta]),
        h('div', { class: 'lq-filecard__actions' }, [
          h('button', { class: 'lq-btn lq-btn--xs', type: 'button', title: '別のファイルに置き換える（元に戻せます）', onclick: () => this.app.pickFile(this.role) },
            [Dom.icon('file-import'), '別のファイル']),
          h('button', { class: 'lq-btn lq-btn--xs lq-btn--danger', type: 'button', title: 'このデータを閉じる（元に戻せます）', onclick: () => this.app.clearDataset(this.role) },
            [Dom.icon('xmark'), '閉じる'])
        ])
      ]);
      const children = [card];
      if (src.storedRef) {
        const r = src.storedRef;
        children.push(UI.note('info', 'ブラウザや JSON に保存した ② です（元：' + (r.kindLabel || '不明') + (r.sheetName ? '・シート「' + r.sheetName + '」' : '') +
          '）。読み込み範囲はここで変えられます。シートや文字コードを変えるときは、元のファイルを「別のファイル」で読み込み直してください。'));
      }
      if (src.hasSheets) {
        this.f.sheet = h('select', { class: 'lq-select' });
        this.f.sheet.addEventListener('change', () => {
          const cur = this.state.datasets[this.role];
          if (!cur || this.f.sheet.value === cur.source.sheetName) return;
          this.app.changeSourceChoice(this.role, 'sheet', this.f.sheet.value);
          Flash.input(this.f.sheet);
        });
        children.push(UI.field('シート', this.f.sheet, 'シートを切り替えると、読み込み範囲を自動で判定し直します'));
        this.f.extentReason = h('div', { class: 'lq-reason' });
        children.push(this.f.extentReason);
      }
      return UI.section('ファイル', children);
    }

    /** 読み方（文字コード・区切り文字。CSV・テキストのとき）。判定どおりなら畳み、見出しに要約を出す */
    _readSection(ds) {
      const src = ds.source;
      if (!src.hasEncoding && !src.hasDelimiter) return null;
      const children = [];
      if (src.hasEncoding) {
        this.f.encoding = h('select', { class: 'lq-select' });
        this.f.encodingReason = h('div', { class: 'lq-reason' });
        this.f.encoding.addEventListener('change', () => this._changeChoice('encoding', this.f.encoding));
        children.push(UI.field('文字コード', this.f.encoding));
        children.push(this.f.encodingReason);
      }
      if (src.hasDelimiter) {
        this.f.delimiter = h('select', { class: 'lq-select' });
        this.f.delimiterReason = h('div', { class: 'lq-reason' });
        this.f.delimiter.addEventListener('change', () => this._changeChoice('delimiter', this.f.delimiter));
        children.push(UI.field('区切り文字', this.f.delimiter));
        children.push(this.f.delimiterReason);
      }
      const key = 'readOpen:' + this.role;
      const uncertain = [src.encoding, src.delimiter].some((info) => info && info.certain === false);
      this.f.readFold = UI.collapsible('読み方', children,
        { open: uncertain || LQ.Prefs.get(key, false), onToggle: (open) => LQ.Prefs.set(key, open) });
      this.f.readFold.el.title = '文字コード・区切り文字（自動で判定します。文字化けや列の分かれ方がおかしいときに切り替えます）';
      return this.f.readFold.el;
    }

    _rangeSection() {
      this.f.hasHeader = new LQ.Segmented([
        { value: true, label: 'ヘッダーあり', icon: 'heading' },
        { value: false, label: 'ヘッダーなし', icon: 'ban' }
      ], true, (v) => this._toggleHeader(v), 'lq-seg--block');
      this.f.headerRow = this._numberInput('headerRow', '例：1');
      this.f.startRow = this._numberInput('startRow', '例：2');
      this.f.startCol = h('input', { class: 'lq-input', type: 'text', placeholder: '例：A', title: '列記号（B）または列番号（2）' });
      this.f.startCol.addEventListener('change', () => this._changeStartCol());
      this.f.endRow = this._numberInput('endRow', '最後まで');
      this.f.autoReason = h('div', { class: 'lq-reason' });
      const reset = h('button', { class: 'lq-btn lq-btn--xs', type: 'button', title: '読み込み範囲を自動判定の結果に戻す', onclick: () => this.app.resetReadSettings(this.role) },
        [Dom.icon('wand-magic-sparkles'), '自動判定に戻す']);
      const key = 'rangeOpen:' + this.role;
      this.f.rangeFold = UI.collapsible('読み込み範囲', [
        UI.field('ヘッダー（列名の行）', this.f.hasHeader.el),
        h('div', { class: 'lq-rangegrid' }, [
          UI.field(FIELD_LABEL.headerRow, this.f.headerRow, 'ヘッダーなしのときは使いません'),
          UI.field(FIELD_LABEL.startRow, this.f.startRow, 'データが始まる行'),
          UI.field(FIELD_LABEL.startCol, this.f.startCol, '列記号（B）または番号（2）'),
          UI.field(FIELD_LABEL.endRow, this.f.endRow, '空欄＝最後の行まで（合計行を除くときに指定）')
        ]),
        h('div', { class: 'lq-row lq-row--between' }, [this.f.autoReason, reset])
      ], { open: LQ.Prefs.get(key, false), onToggle: (open) => LQ.Prefs.set(key, open) });
      this.f.rangeFold.el.title = '右の表（読み込み範囲）の行番号や列記号をクリックしても指定できます';
      return this.f.rangeFold.el;
    }

    _resultSection() {
      this.f.status = h('div');
      return UI.section('読み込み結果', [this.f.status, UI.field('列（押して表示／非表示を切り替え）', this.chips.el)]);
    }

    _numberInput(key, placeholder) {
      const input = h('input', { class: 'lq-input lq-num', type: 'text', inputmode: 'numeric', placeholder: placeholder });
      input.addEventListener('change', () => {
        const ds = this.state.datasets[this.role];
        if (!ds) return;
        const n = Util.parseRowRef(input.value);
        const cur = ds.settings[key];
        if (key === 'endRow' && n === null) {
          input.classList.remove('is-invalid');
          if (cur !== null) this._apply({ endRow: null }, input);
          return;
        }
        if (n === null || Number.isNaN(n)) {
          this._invalid(input, FIELD_LABEL[key] + 'は 1 以上の整数で入力してください');
          return;
        }
        input.classList.remove('is-invalid');
        if (n === cur) {
          input.value = String(cur);
          return;
        }
        const patch = {};
        patch[key] = n;
        this._apply(patch, input);
      });
      return input;
    }

    /* ---------------- 変更の適用 ---------------- */

    /** ヘッダーの有無を切り替える（読み込む範囲は同じまま：ヘッダー行⇔先頭のデータ行） */
    _toggleHeader(hasHeader) {
      const ds = this.state.datasets[this.role];
      if (!ds || ds.settings.hasHeader === hasHeader) return;
      const set = ds.settings;
      const patch = hasHeader
        ? { hasHeader: true, headerRow: set.startRow, startRow: set.startRow + 1 }
        : { hasHeader: false, startRow: set.headerRow };
      this._apply(patch, this.f.hasHeader.el);
    }

    _changeChoice(kind, select) {
      const ds = this.state.datasets[this.role];
      if (!ds) return;
      const current = kind === 'encoding' ? ds.source.encodingChoice : ds.source.delimiterChoice;
      if (select.value === current) return;
      this.app.changeSourceChoice(this.role, kind, select.value);
      Flash.input(select);
    }

    _changeStartCol() {
      const ds = this.state.datasets[this.role];
      if (!ds) return;
      const input = this.f.startCol;
      const n = Util.parseColumnRef(input.value);
      if (Number.isNaN(n)) {
        this._invalid(input, '開始列は列記号（A〜）または 1 以上の番号で入力してください');
        return;
      }
      input.classList.remove('is-invalid');
      if (n === ds.settings.startCol) {
        input.value = Util.colLetter(n - 1);
        return;
      }
      this._apply({ startCol: n }, input);
    }

    _invalid(input, message) {
      input.classList.add('is-invalid');
      Flash.el(input, 'warn');
      this.ctx.toasts.show({ type: 'warn', title: message });
    }

    _apply(patch, sourceEl) {
      const result = this.app.updateReadSettings(this.role, patch);
      if (!result) {
        this.refresh(true);
        return;
      }
      if (sourceEl && sourceEl.tagName) Flash.input(sourceEl);
      else if (sourceEl) Flash.el(sourceEl);
      const ds = this.state.datasets[this.role];
      const extra = result.adjusted.filter((key) => !(key in patch));
      extra.forEach((key) => {
        const el = key === 'hasHeader' ? this.f.hasHeader.el : this.f[key];
        if (el && el.tagName === 'INPUT') Flash.input(el, 'warn', '自動調整');
      });
      if (extra.length && ds) {
        const texts = extra.map((key) => FIELD_LABEL[key] + 'を' + this._settingText(ds.settings, key) + 'に');
        this.ctx.toasts.show({ type: 'info', title: texts.join('・') + '合わせました', message: 'ヘッダー行・データ開始行・終了行の前後関係が崩れないよう自動で調整しました。' });
      }
    }

    _settingText(set, key) {
      if (key === 'startCol') return Util.colLetter(set.startCol - 1) + ' 列';
      if (key === 'endRow') return set.endRow ? set.endRow + ' 行目' : '最後まで';
      if (key === 'hasHeader') return set.hasHeader ? 'あり' : 'なし';
      return set[key] + ' 行目';
    }

    /* ---------------- 表示の更新 ---------------- */

    _update(ds) {
      const src = ds.source;
      const set = ds.settings;
      this.f.name.textContent = ds.name;
      this.f.name.title = ds.name;
      Dom.clear(this.f.meta);
      Dom.append(this.f.meta, [
        h('span', { text: src.kindLabel }),
        src.size ? h('span', { class: 'lq-num', text: Util.formatBytes(src.size) }) : null,
        h('span', { class: 'lq-num', text: Util.formatInt(ds.rowCount) + ' 行 × ' + ds.colCount + ' 列' }),
        ds.isSample ? h('span', { class: 'lq-tag lq-tag--sample', text: 'サンプル' }) : null
      ]);
      if (this.f.sheet) {
        UI.fillSelect(this.f.sheet, src.sheetNames.map((n) => ({ value: n, label: n })), src.sheetName);
        this._extentReason(src.extent);
      }
      this._readSummary(src);
      if (this.f.encoding) {
        const detected = src.encodingChoice === 'auto' && src.encoding ? LQ.EncodingDetector.label(src.encoding.value) : '';
        UI.fillSelect(this.f.encoding, [{ value: 'auto', label: '自動' + (detected ? '（判定：' + detected + '）' : '') }]
          .concat(LQ.EncodingDetector.list.map((e) => ({ value: e.value, label: e.label }))), src.encodingChoice);
        this._reason(this.f.encodingReason, src.encoding, '文字化けしている場合は、文字コードを切り替えてください（表示がすぐ変わります）。');
      }
      if (this.f.delimiter) {
        const detected = src.delimiterChoice === 'auto' && src.delimiter ? LQ.CsvParser.delimiterLabel(src.delimiter.value) : '';
        UI.fillSelect(this.f.delimiter, [{ value: 'auto', label: '自動' + (detected ? '（判定：' + detected + '）' : '') }]
          .concat(LQ.CsvParser.delimiters.map((d) => ({ value: d.value, label: d.label }))), src.delimiterChoice);
        this._reason(this.f.delimiterReason, src.delimiter, '列が正しく分かれていない場合は、区切り文字を切り替えてください。');
      }
      this.f.hasHeader.set(set.hasHeader);
      this.f.headerRow.disabled = !set.hasHeader;
      this.f.headerRow.value = String(set.headerRow);
      this.f.startRow.value = String(set.startRow);
      this.f.startCol.value = Util.colLetter(set.startCol - 1);
      this.f.endRow.value = set.endRow ? String(set.endRow) : '';
      ['headerRow', 'startRow', 'startCol', 'endRow'].forEach((key) => this.f[key].classList.remove('is-invalid'));
      const isAuto = JSON.stringify(LQ.Dataset.normalizeSettings(ds.auto.settings)) === JSON.stringify(set);
      Dom.clear(this.f.autoReason);
      Dom.append(this.f.autoReason, [Dom.icon('wand-magic-sparkles'),
        h('span', { text: (isAuto ? '自動判定のまま：' : '自動判定の結果（現在は変更済み）：') + ds.auto.reasons.join('／') })]);
      this._setSummary(this.f.rangeFold, (isAuto ? '自動判定：' : '変更済み：') + (set.hasHeader ? 'ヘッダー ' + set.headerRow + ' 行目' : 'ヘッダーなし') +
        '・範囲 ' + ds.stats.rangeText);
      this._updateResult(ds);
    }

    /** 読み方の要約：「UTF-8・カンマ（自動判定）」 */
    _readSummary(src) {
      if (!this.f.readFold) return;
      const parts = [];
      if (src.encoding) parts.push(LQ.EncodingDetector.label(src.encoding.value));
      if (src.delimiter) parts.push(LQ.CsvParser.delimiterLabel(src.delimiter.value));
      const manual = src.encodingChoice !== 'auto' || src.delimiterChoice !== 'auto';
      this._setSummary(this.f.readFold, (manual ? '手動：' : '自動判定：') + parts.join('・'));
    }

    /** 畳んだ区画の見出しの要約を変え、変わったときは反映の合図を出す */
    _setSummary(fold, text) {
      if (!fold || fold.summary.textContent === text) return;
      const changed = fold.summary.textContent !== '';
      fold.summary.textContent = text;
      if (changed) Flash.el(fold.summary);
    }

    /** Excel に記録された使用範囲の外にもデータがあったときだけ、実際の範囲で読んだことを示す */
    _extentReason(extent) {
      const el = this.f.extentReason;
      Dom.clear(el);
      el.hidden = !(extent && extent.beyond);
      if (el.hidden) return;
      Dom.append(el, [Dom.icon('circle-info'), h('span', {
        text: 'Excel に記録された使用範囲' + (extent.declared ? '（' + extent.declared + '）' : '') + 'の外にもデータがあったため、実際のデータの範囲（' +
          extent.actual + '）で読み込みました。'
      })]);
    }

    _reason(el, info, fallback) {
      Dom.clear(el);
      if (!info) return;
      const uncertain = info.certain === false;
      Dom.append(el, [Dom.icon(uncertain ? 'triangle-exclamation' : 'circle-info'),
        h('span', { text: (info.auto ? '判定の根拠：' + info.reason : '手動で指定しています') + '。' + fallback })]);
      el.classList.toggle('lq-status--warn', uncertain);
    }

    _updateResult(ds) {
      /* 行数と範囲を 1 行にまとめる（範囲は読み込み範囲の要約にも出している） */
      Dom.clear(this.f.status);
      const detail = '（範囲 ' + ds.stats.rangeText + (ds.stats.skippedEmpty ? '・空行 ' + Util.formatInt(ds.stats.skippedEmpty) + ' 行を除外' : '') +
        '・元の表は ' + Util.formatInt(ds.rawRowCount) + ' 行）';
      this.f.status.appendChild(ds.rowCount
        ? UI.status('ok', Util.formatInt(ds.rowCount) + ' 行 × ' + ds.colCount + ' 列を読み込みます' + detail)
        : UI.status('warn', 'データ行がありません。読み込み範囲のヘッダー行・データ開始行を確認してください' + detail));
      this.chips.setDataset(ds);
      this.filterSection.render(ds);
      this.derived.render(ds);
    }
  }

  LQ.DatasetPanel = DatasetPanel;
})(window);

/* =========================================================================
 * ── 列の追加（読み替え・計算） ──
 * DerivedSection：読み込みパネルの区画（定義の一覧・状態・編集・削除）
 * DerivedEditor：定義を作る／直すモーダル
 *   読み替え：新しい列の名前・元の列・対応表（直接入力／Excel から貼り付け／ファイル）・対応表にない値の扱い
 *   計算：新しい列の名前・式（列名のボタンで [列名] を入れる）。入力中に式の誤りと先頭の行の計算結果を示す
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Dom = LQ.Dom;
  const UI = LQ.UI;
  const Flash = LQ.Flash;
  const Derive = LQ.Derive;
  const h = Dom.h;
  const fmt = LQ.Util.formatInt;

  const PREVIEW_ROWS = 5;
  const MISSING_LIMIT = 30;
  const UNMATCHED_OPTIONS = [
    { value: 'keep', label: '元の値のまま' },
    { value: 'blank', label: '空欄' },
    { value: 'value', label: '指定した値' }
  ];

  /* ---------------------------------------------------------------------
   * DerivedEditor：モーダル
   * ------------------------------------------------------------------- */
  class DerivedEditor {
    constructor(ctx) {
      this.ctx = ctx;
      this.state = ctx.state;
      this.app = ctx.app;
      this.el = null;
    }

    isOpen() {
      return !!this.el;
    }

    /**
     * @param {'source'|'condition'} role
     * @param {'map'|'calc'} kind
     * @param {object|null} def 直す定義（新しく作るときは null）
     */
    open(role, kind, def) {
      if (this.el) this.close();
      this.ctx.popovers.close();
      const ds = this.state.datasets[role];
      if (!ds) return;
      this.role = role;
      this.ds = ds;
      this.kind = def ? def.kind : kind;
      this.def = def ? LQ.Util.clone(def) : (this.kind === 'map'
        ? { id: LQ.Util.uid('drv'), kind: 'map', name: '', from: '', rows: [], unmatched: 'keep', value: '', tableName: '' }
        : { id: LQ.Util.uid('drv'), kind: 'calc', name: '', expr: '' });
      this.isNew = !def;
      this._returnFocus = document.activeElement;
      const meta = Derive.KINDS[this.kind];
      this.saveBtn = h('button', { class: 'lq-btn lq-btn--primary', type: 'button', onclick: () => this._save() }, [Dom.icon('check'), this.isNew ? '列を追加する' : '変更を保存する']);
      this.saveReason = h('span', { class: 'lq-field__hint' });
      this.nameInput = h('input', { class: 'lq-input', type: 'text', value: this.def.name, placeholder: this.kind === 'map' ? '例：分類' : '例：粗利', title: '追加する列の名前（Enter で次の欄へ）' });
      this.nameInput.addEventListener('input', () => {
        this.def.name = this.nameInput.value;
        this._validate();
      });
      const body = h('div', { class: 'lq-derive' }, [
        UI.field('新しい列の名前', this.nameInput),
        this.kind === 'map' ? this._mapFields() : this._calcFields()
      ]);
      const modal = h('div', { class: 'lq-modal lq-modal--derive', role: 'dialog', 'aria-modal': 'true', 'aria-label': meta.label },
        [h('div', { class: 'lq-modal__head' }, [Dom.icon(meta.icon, 'lq-panel__icon'),
          h('h2', { class: 'lq-modal__title', text: (role === 'source' ? '① ' : '② ') + '列を' + meta.label + 'で追加' }),
          UI.iconButton('xmark', '閉じる（Esc）', () => this.close())]),
        h('div', { class: 'lq-modal__body lq-modal__body--scroll' }, body),
        h('div', { class: 'lq-modal__foot' }, [this.saveReason, h('span', { class: 'lq-topbar__spacer' }),
          h('button', { class: 'lq-btn', type: 'button', onclick: () => this.close() }, 'キャンセル'), this.saveBtn])]);
      this.el = h('div', { class: 'lq-modal-backdrop', onmousedown: (e) => {
        if (e.target === this.el) this.close();
      } }, modal);
      this.el.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          this.close();
        }
      });
      LQ.FormNav.attach(body);
      Dom.qs('#lqOverlay').appendChild(this.el);
      this._validate();
      this.nameInput.focus();
      this.nameInput.select();
    }

    close() {
      if (!this.el) return;
      this.el.remove();
      this.el = null;
      if (this._returnFocus && this._returnFocus.focus) this._returnFocus.focus();
    }

    /** この定義より前に作られる列（元の列＋前の定義の列）の名前 */
    _names() {
      const defs = this.state.derived[this.role];
      const idx = defs.findIndex((d) => d.id === this.def.id);
      const before = new Set((idx < 0 ? defs : defs.slice(0, idx)).map((d) => d.name));
      return this.ds.columns.filter((c) => !c.derived || before.has(c.name)).map((c) => c.name);
    }

    /* ---------------- 読み替え ---------------- */

    _mapFields() {
      const d = this.def;
      this.fromSelect = h('select', { class: 'lq-select', title: '読み替える元の列' });
      UI.fillSelect(this.fromSelect, this._names().map((n) => ({ value: n, label: n })), d.from, '元の列を選択（入力して探せます）');
      this.fromCombo = LQ.ColumnCombo.enhance(this.fromSelect, { letterOf: (v) => LQ.ColumnCombo.letterIn(this.ds, v) });
      this.fromSelect.addEventListener('change', () => {
        d.from = this.fromSelect.value;
        Flash.el(this.fromSelect);
        this._renderMissing();
        this._validate();
      });
      this.tableBody = h('tbody');
      this.tableCount = h('span', { class: 'lq-field__hint lq-num' });
      const table = h('div', { class: 'lq-maptable', tabindex: '0', title: 'Excel の 2 列（元の値・読み替え後）をコピーして、ここで Ctrl+V で貼り付けられます' }, [
        h('table', {}, [h('thead', {}, h('tr', {}, [h('th', { text: '元の値（* も使えます）' }), h('th', { text: '読み替え後' }), h('th')])), this.tableBody])
      ]);
      table.addEventListener('paste', (e) => {
        const text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
        if (!text || text.indexOf('\t') === -1 && text.indexOf('\n') === -1) return;
        e.preventDefault();
        e.stopPropagation();
        this._addRows(LQ.CsvParser.parse(text, '\t'), '貼り付け');
      });
      const addRow = h('button', { class: 'lq-btn lq-btn--xs', type: 'button', onclick: () => {
        d.rows.push(['', '']);
        this._renderRows(true);
      } }, [Dom.icon('plus'), '行を追加']);
      const fileInput = h('input', { type: 'file', accept: '.xlsx,.xlsm,.xls,.xlsb,.ods,.csv,.tsv,.txt', hidden: true });
      fileInput.addEventListener('change', () => {
        if (fileInput.files[0]) this._loadFile(fileInput.files[0]);
        fileInput.value = '';
      });
      const fileBtn = h('button', { class: 'lq-btn lq-btn--xs', type: 'button', title: '1 列目＝元の値、2 列目＝読み替え後の表（Excel・CSV）を読み込みます（今の対応表に加えます）',
        onclick: () => fileInput.click() }, [Dom.icon('file-import'), 'ファイルから']);
      const clearBtn = h('button', { class: 'lq-btn lq-btn--xs', type: 'button', title: '対応表を空にする', onclick: () => {
        d.rows = [];
        this._renderRows();
      } }, [Dom.icon('eraser'), '空にする']);
      this.missingBox = h('div', { class: 'lq-mapmissing' });
      this.unmatchedValue = h('input', { class: 'lq-input lq-input--sm', type: 'text', value: d.value, placeholder: '例：その他' });
      this.unmatchedValue.addEventListener('input', () => {
        d.value = this.unmatchedValue.value;
      });
      const seg = new LQ.Segmented(UNMATCHED_OPTIONS, d.unmatched, (v) => {
        d.unmatched = v;
        this.unmatchedValue.hidden = v !== 'value';
        if (v === 'value') this.unmatchedValue.focus();
      });
      this.unmatchedValue.hidden = d.unmatched !== 'value';
      this._renderRows();
      this._renderMissing();
      return h('div', { class: 'lq-stack' }, [
        UI.field('元の列', this.fromCombo.el),
        UI.field('対応表（マスタ）', h('div', { class: 'lq-stack' }, [
          h('div', { class: 'lq-maptable__tools' }, [this.tableCount, h('span', { class: 'lq-topbar__spacer' }), addRow, fileBtn, fileInput, clearBtn]),
          table,
          h('p', { class: 'lq-field__hint', text: 'Excel の 2 列（元の値・読み替え後）をコピーし、表をクリックしてから Ctrl+V で貼り付けられます。前後の空白・全角半角・大文字小文字はそろえて照らし合わせます。「*ぶどう*」のように * を使うと、ぶどうを含む値をまとめて読み替えます（上の行ほど優先）。' })
        ])),
        this.missingBox,
        UI.field('対応表にない値', h('div', { class: 'lq-row' }, [seg.el, this.unmatchedValue]))
      ]);
    }

    _renderRows(focusLast) {
      const d = this.def;
      Dom.clear(this.tableBody);
      d.rows.forEach((row, i) => {
        const cell = (k, placeholder) => {
          const input = h('input', { class: 'lq-input lq-input--sm', type: 'text', value: row[k], placeholder: placeholder });
          input.addEventListener('input', () => {
            row[k] = input.value;
            if (k === 0) this._renderMissingSoon();
          });
          return h('td', {}, input);
        };
        this.tableBody.appendChild(h('tr', {}, [cell(0, '例：ぶどう'), cell(1, '例：果物'),
          h('td', {}, UI.iconButton('xmark', 'この行を消す', () => {
            d.rows.splice(i, 1);
            this._renderRows();
            this._renderMissing();
          }, 'lq-btn--sm'))]));
      });
      this.tableCount.textContent = '対応表 ' + fmt(d.rows.length) + ' 件';
      if (focusLast) {
        const inputs = this.tableBody.querySelectorAll('tr:last-child input');
        if (inputs[0]) inputs[0].focus();
      }
      this._validate();
    }

    /** 貼り付け・ファイルの行を対応表に加える（1 行目が見出しらしければ飛ばす） */
    _addRows(grid, how) {
      const rows = grid.filter((r) => r && (String(r[0] || '').trim() || String(r[1] || '').trim()));
      if (rows.length && /元|from|変換前|before|値/i.test(String(rows[0][0])) && /後|to|変換後|after|読/i.test(String(rows[0][1] || ''))) rows.shift();
      const room = Derive.MAX_ROWS - this.def.rows.length;
      rows.slice(0, room).forEach((r) => this.def.rows.push([String(r[0] || '').trim(), String(r[1] === undefined ? '' : r[1]).trim()]));
      this._renderRows();
      this._renderMissing();
      Flash.el(this.tableBody);
      this.ctx.toasts.show({ type: 'success', title: how + 'で対応表に ' + fmt(Math.min(rows.length, room)) + ' 件を加えました',
        message: rows.length > room ? '対応表は最大 ' + fmt(Derive.MAX_ROWS) + ' 件のため、残りは加えていません。' : '' });
    }

    async _loadFile(file) {
      try {
        const src = await LQ.SourceFile.fromFile(file);
        this.def.tableName = file.name;
        this._addRows(src.grid, '「' + file.name + '」');
      } catch (err) {
        this.ctx.toasts.show({ type: 'error', title: '対応表を読み込めませんでした', message: err.message });
      }
    }

    _renderMissingSoon() {
      clearTimeout(this._missingTimer);
      this._missingTimer = setTimeout(() => this._renderMissing(), 300);
    }

    /** 元の列にあって対応表にない値（種類）を示し、まとめて対応表に加えられるようにする */
    _renderMissing() {
      const box = this.missingBox;
      Dom.clear(box);
      const d = this.def;
      const col = this.ds.findColumn(d.from);
      if (col < 0) return;
      const probe = Object.assign({}, d, { unmatched: 'blank' });
      const out = Derive.compute(probe, this.ds.rowCount, (n) => this.ds.findColumn(n), (r, c) => this.ds.cell(r, c));
      const missing = [];
      const seen = new Set();
      for (let r = 0; r < this.ds.rowCount; r++) {
        const v = this.ds.cell(r, col);
        if (LQ.Normalizer.isBlank(v) || out.values[r] !== '' || seen.has(v)) continue;
        seen.add(v);
        missing.push(String(v));
      }
      if (!missing.length) {
        box.appendChild(UI.status('ok', '元の列の値はすべて対応表にあります'));
        return;
      }
      const add = h('button', { class: 'lq-btn lq-btn--xs', type: 'button', title: '対応表にない値を、読み替え後を空欄にして対応表の最後に加えます（あとで読み替え後を入力します）',
        onclick: () => this._addRows(missing.map((v) => [v, '']), '対応表にない値の追加') }, [Dom.icon('plus'), fmt(missing.length) + ' 種類をすべて対応表に加える']);
      box.appendChild(UI.note('info', h('div', {}, [
        h('div', { text: '対応表にない値 ' + fmt(missing.length) + ' 種類：' + missing.slice(0, MISSING_LIMIT).join('、') + (missing.length > MISSING_LIMIT ? ' ほか' : '') })
      ]), add));
    }

    /* ---------------- 計算 ---------------- */

    _calcFields() {
      const d = this.def;
      this.exprInput = h('input', { class: 'lq-input lq-expr', type: 'text', value: d.expr, spellcheck: 'false', placeholder: '例：([単価]+[送料])×[数量]÷[係数]' });
      this.exprInput.addEventListener('input', () => {
        d.expr = this.exprInput.value;
        this._renderPreview();
        this._validate();
      });
      const chips = h('div', { class: 'lq-colchips lq-colchips--insert' }, this._names().map((n) => h('button', {
        class: 'lq-colchip', type: 'button', title: '[' + n + '] を式に入れる', onclick: () => this._insert('[' + n + ']')
      }, [Dom.icon('plus'), h('span', { class: 'lq-colchip__name', text: n })])));
      const ops = h('div', { class: 'lq-row' }, ['+', '-', '×', '÷', '(', ')', '&', 'ROUND(', 'ROUNDUP(', 'ROUNDDOWN('].map((op) =>
        h('button', { class: 'lq-btn lq-btn--xs', type: 'button', title: op + ' を入れる', onclick: () => this._insert(op) }, op)));
      this.exprStatus = h('div');
      this.preview = h('div', { class: 'lq-derive__preview' });
      this._renderPreview();
      return h('div', { class: 'lq-stack' }, [
        UI.field('式', h('div', { class: 'lq-stack' }, [this.exprInput, ops, this.exprStatus])),
        UI.field('列（押すと式に入ります）', chips),
        h('p', { class: 'lq-field__hint', text: '列名は [ ] で囲みます。+ − ×（*）÷（/）と括弧で計算し、& で文字をつなぎます（例：[姓]&" "&[名]）。ROUND（四捨五入）・ROUNDUP（切り上げ）・ROUNDDOWN（切り捨て）は ROUND([金額]×1.1, 0) のように桁数を指定します。空欄は 0 として計算し、数値として読めない値や 0 での割り算になる行は空欄にします。' }),
        UI.field('先頭 ' + PREVIEW_ROWS + ' 行の計算結果', this.preview)
      ]);
    }

    _insert(text) {
      const input = this.exprInput;
      const start = input.selectionStart === null ? input.value.length : input.selectionStart;
      const end = input.selectionEnd === null ? start : input.selectionEnd;
      input.value = input.value.slice(0, start) + text + input.value.slice(end);
      input.focus();
      input.setSelectionRange(start + text.length, start + text.length);
      input.dispatchEvent(new Event('input'));
    }

    _renderPreview() {
      Dom.clear(this.preview);
      Dom.clear(this.exprStatus);
      const d = this.def;
      if (!d.expr.trim()) {
        this.exprStatus.appendChild(UI.status('info', '式を入力してください'));
        return;
      }
      const check = Derive.check(d.expr, this._names());
      this.exprInput.classList.toggle('is-invalid', !check.ok);
      if (!check.ok) {
        this.exprStatus.appendChild(UI.status('warn', check.message + (check.pos >= 0 ? '（' + (check.pos + 1) + ' 文字目）' : '')));
        return;
      }
      this.exprStatus.appendChild(UI.status('ok', '正しい式です（使う列：' + check.columns.join('・') + '）'));
      const rows = Math.min(PREVIEW_ROWS, this.ds.rowCount);
      const out = Derive.compute(d, rows, (n) => this.ds.findColumn(n), (r, c) => this.ds.cell(r, c));
      const table = h('table', { class: 'lq-derive__table' }, [
        h('thead', {}, h('tr', {}, check.columns.map((n) => h('th', { text: n })).concat([h('th', { class: 'is-result', text: d.name || '（新しい列）' })]))),
        h('tbody', {}, Array.from({ length: rows }, (v, r) => h('tr', {}, check.columns.map((n) => h('td', { text: String(this.ds.cell(r, this.ds.findColumn(n))) }))
          .concat([h('td', { class: 'is-result', text: out.values ? (out.values[r] === '' ? '（空欄）' : out.values[r]) : '' })]))))
      ]);
      this.preview.appendChild(table);
    }

    /* ---------------- 保存 ---------------- */

    /** 保存できない理由（できれば null） */
    _problem() {
      const d = this.def;
      const name = d.name.trim();
      if (!name) return '新しい列の名前を入力してください';
      const original = this.ds.columns.some((c) => !c.derived && c.name === name);
      if (original) return '「' + name + '」は元の表にある列名です。別の名前にしてください';
      if (this.state.derived[this.role].some((x) => x.id !== d.id && x.name === name)) return '「' + name + '」はほかの追加した列と同じ名前です';
      if (d.kind === 'map') {
        if (!d.from) return '元の列を選んでください';
        if (!d.rows.some((r) => String(r[0]).trim())) return '対応表に 1 件以上入力してください';
        return null;
      }
      const check = Derive.check(d.expr, this._names());
      return check.ok ? null : '式：' + check.message;
    }

    _validate() {
      if (!this.saveBtn) return;
      const problem = this._problem();
      this.saveBtn.disabled = !!problem;
      Dom.clear(this.saveReason);
      if (problem) this.saveReason.appendChild(UI.status('warn', problem));
    }

    _save() {
      if (this._problem()) return;
      const d = Object.assign({}, this.def, { name: this.def.name.trim() });
      if (d.kind === 'map') d.rows = d.rows.filter((r) => String(r[0]).trim());
      const snap = this.state.snapshot();
      const list = this.state.derived[this.role].slice();
      const idx = list.findIndex((x) => x.id === d.id);
      if (idx >= 0) list[idx] = d;
      else list.push(d);
      this.state.setDerived(this.role, list);
      this.close();
      const info = this.ds.derivedInfo ? this.ds.derivedInfo.get(d.id) : null;
      this.ctx.toasts.show({
        type: info && !info.ok ? 'warn' : 'success',
        title: '列「' + d.name + '」を' + (idx >= 0 ? '更新しました' : '追加しました'),
        message: info ? Derive.infoText(info, this.ds.rowCount) : '',
        actions: [{ label: '元に戻す', icon: 'rotate-left', onClick: () => this.app.restore(snap, '列の追加を元に戻しました') }]
      });
    }
  }

  /* ---------------------------------------------------------------------
   * DerivedSection：読み込みパネルの区画
   * ------------------------------------------------------------------- */
  class DerivedSection {
    constructor(ctx, role, editor) {
      this.ctx = ctx;
      this.state = ctx.state;
      this.app = ctx.app;
      this.role = role;
      this.editor = editor;
      this.list = h('div', { class: 'lq-derivedlist' });
      const add = (kind) => h('button', { class: 'lq-btn lq-btn--xs', type: 'button', title: Derive.KINDS[kind].label + 'で列を追加する',
        onclick: () => this.editor.open(this.role, kind, null) }, [Dom.icon(Derive.KINDS[kind].icon), Derive.KINDS[kind].label]);
      this.el = UI.section('列を追加（読み替え・計算）', [this.list],
        [h('span', { class: 'lq-section__tools' }, [add('map'), add('calc')])]);
      this.el.title = '追加した列は、元の列と同じように条件・出力・集計で使えます。設定はこのブラウザに記憶し、次に同じ列のある表を読み込んだときも自動で作ります。';
    }

    render(ds) {
      Dom.clear(this.list);
      const defs = this.state.derived[this.role];
      if (!defs.length) {
        this.list.appendChild(h('p', { class: 'lq-field__hint', text: '例：ぶどう ⇒ 果物 の読み替え、[単価]×[数量] の計算。条件・出力・集計で使えます。' }));
        return;
      }
      defs.forEach((def) => {
        const info = ds && ds.derivedInfo ? ds.derivedInfo.get(def.id) : null;
        const status = !info ? UI.status('info', 'この表には使う列がないため、作っていません')
          : (info.ok ? UI.status('ok', Derive.infoText(info, ds.rowCount)) : UI.status('warn', info.message));
        this.list.appendChild(h('div', { class: 'lq-derived' + (info && info.ok ? '' : ' is-off') }, [
          h('span', { class: 'lq-badge lq-badge--meta', text: Derive.KINDS[def.kind].badge }),
          h('div', { class: 'lq-derived__body' }, [
            h('div', { class: 'lq-derived__name', text: def.name }),
            h('div', { class: 'lq-derived__summary', text: Derive.summary(def), title: Derive.summary(def) }),
            status
          ]),
          UI.iconButton('pen', '「' + def.name + '」を直す', () => this.editor.open(this.role, def.kind, def), 'lq-btn--sm'),
          UI.iconButton('trash-can', '「' + def.name + '」を削除（元に戻せます）', () => this._remove(def), 'lq-btn--sm')
        ]));
      });
    }

    _remove(def) {
      const snap = this.state.snapshot();
      this.state.setDerived(this.role, this.state.derived[this.role].filter((d) => d.id !== def.id));
      this.ctx.toasts.show({ type: 'success', title: '列「' + def.name + '」を削除しました', message: '',
        actions: [{ label: '元に戻す', icon: 'rotate-left', onClick: () => this.app.restore(snap, '列「' + def.name + '」を元に戻しました') }] });
    }
  }

  LQ.DerivedEditor = DerivedEditor;
  LQ.DerivedSection = DerivedSection;
})(window);
