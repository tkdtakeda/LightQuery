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
 *   読み込み結果（行数・列数・列名）。入力欄は作り直さず値だけ更新し、フォーカスを保つ。
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
  const COLUMN_CHIP_LIMIT = 60;
  const FIELD_LABEL = { hasHeader: 'ヘッダー', headerRow: 'ヘッダー行', startRow: 'データ開始行', startCol: '開始列', endRow: '終了行' };

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
      this.body.appendChild(this._fileSection(ds));
      this.body.appendChild(this._rangeSection());
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
      return UI.section('ファイル', children);
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
      return UI.section('読み込み範囲', [
        UI.field('ヘッダー（列名の行）', this.f.hasHeader.el),
        h('div', { class: 'lq-rangegrid' }, [
          UI.field(FIELD_LABEL.headerRow, this.f.headerRow, 'ヘッダーなしのときは使いません'),
          UI.field(FIELD_LABEL.startRow, this.f.startRow, 'データが始まる行'),
          UI.field(FIELD_LABEL.startCol, this.f.startCol, '列記号（B）または番号（2）'),
          UI.field(FIELD_LABEL.endRow, this.f.endRow, '空欄＝最後の行まで（合計行を除くときに指定）')
        ]),
        this.f.autoReason,
        UI.note('tip', '右の表（読み込み範囲）の行番号や列記号をクリックしても指定できます。Enter で次の欄へ進みます。')
      ], [reset]);
    }

    _resultSection() {
      this.f.status = h('div');
      this.f.detail = h('div', { class: 'lq-reason' });
      this.f.columns = h('div', { class: 'lq-colchips' });
      return UI.section('読み込み結果', [this.f.status, this.f.detail, this.f.columns]);
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
      this._updateResult(ds);
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
      Dom.clear(this.f.status);
      this.f.status.appendChild(ds.rowCount
        ? UI.status('ok', Util.formatInt(ds.rowCount) + ' 行 × ' + ds.colCount + ' 列を読み込みます')
        : UI.status('warn', 'データ行がありません。ヘッダー行・データ開始行を確認してください'));
      Dom.clear(this.f.detail);
      Dom.append(this.f.detail, [Dom.icon('crop-simple'), h('span', {
        text: '範囲 ' + ds.stats.rangeText + (ds.stats.skippedEmpty ? '・空行 ' + Util.formatInt(ds.stats.skippedEmpty) + ' 行を除外' : '') +
          '・元の表は ' + Util.formatInt(ds.rawRowCount) + ' 行'
      })]);
      Dom.clear(this.f.columns);
      ds.columns.slice(0, COLUMN_CHIP_LIMIT).forEach((c) => {
        this.f.columns.appendChild(h('span', { class: 'lq-colchip', title: c.letter + ' 列：' + c.name }, [
          h('span', { class: 'lq-colchip__letter', text: c.letter }), h('span', { class: 'lq-colchip__name', text: c.name })
        ]));
      });
      if (ds.columns.length > COLUMN_CHIP_LIMIT) {
        this.f.columns.appendChild(h('span', { class: 'lq-colchip', text: '＋' + (ds.columns.length - COLUMN_CHIP_LIMIT) + ' 列' }));
      }
    }
  }

  LQ.DatasetPanel = DatasetPanel;
})(window);
