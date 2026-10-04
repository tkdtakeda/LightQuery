/* =========================================================================
 * LightQuery - lq-ui-dialogs.js
 * 小窓：メニュー・サンプル・読み込み範囲／出力・根拠／抽出条件の操作
 * （下の区切りごとに独立した部品。読み込み順どおりに並べている）
 * ========================================================================= */

/* =========================================================================
 * ── メニュー・サンプル・読み込み範囲 ──
 * 小窓（ポップオーバー）：その他の操作メニュー、サンプル選択、読み込み先の選択、読み込み範囲の指定（行・列）
 *   出力・根拠と抽出条件まわりの小窓は、このファイルの後半の区切りにある
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Dom = LQ.Dom;
  const Util = LQ.Util;
  const UI = LQ.UI;
  const h = Dom.h;

  const ROLE_LABEL = { source: '① 元データ', condition: '② 条件データ' };

  class Dialogs {
    constructor(ctx) {
      this.ctx = ctx;
      this.state = ctx.state;
      this.app = ctx.app;
      this.pop = ctx.popovers;
    }

    _item(icon, label, sub, onClick, opts) {
      return UI.menuItem(this.pop, icon, label, sub, onClick, opts);
    }

    _head(icon, title) {
      return h('div', { class: 'lq-popover__head' }, [Dom.icon(icon), h('span', { text: title }), UI.iconButton('xmark', '閉じる（Esc）', () => this.pop.close(), 'lq-btn--sm')]);
    }

    /* ---------------- その他の操作（⋮） ---------------- */

    openAppMenu(anchor) {
      if (this.pop.isOpen('menu')) {
        this.pop.close();
        return;
      }
      const s = this.state;
      const hasSample = s.hasSample();
      const own = s.userProfiles().filter((p) => !p.isBlank()).length;
      const hasAny = !!(s.datasets.source || own || s.profiles.items.some((p) => !p.isBlank()));
      const menu = h('div', { class: 'lq-menu' }, [
        this._item('flask', 'サンプルデータを読み込む…', LQ.Samples.list().length + ' 種類のパターンで動作を確認', () => this.openSamples(anchor, 'bottom-end')),
        this._item('file-export', '抽出条件を書き出す（.json）…', '1 件だけ・すべてを選べます（② のデータも含められます）', () => this.app.profileDialogs.openJsonExport(anchor)),
        this._item('folder-open', '抽出条件を読み込む（.json）…', '書き出した .json を追加・置き換え（ドラッグ＆ドロップも可）', () => this.app.pickFile('settings')),
        h('div', { class: 'lq-menu__sep' }),
        this._item('broom', 'サンプルデータのみクリア', hasSample ? 'サンプルの ①・② と抽出条件だけを消去（元に戻せます）' : 'サンプルデータは読み込まれていません',
          () => this.app.profiles.clearSamples(), { disabled: !hasSample }),
        this._item('trash-can', 'すべてクリア', hasAny ? '①・抽出条件・出力列の並び（ブラウザの保存分も）・結果を消去（元に戻せます）' : 'クリアするものがありません',
          () => this.app.clearAll(anchor), { danger: true, disabled: !hasAny }),
        h('div', { class: 'lq-menu__sep' }),
        this._item('book-open', '使い方（取扱説明書）', null, () => this.app.manual.open())
      ]);
      this.pop.open(anchor, menu, { key: 'menu' });
    }

    /* ---------------- サンプル ---------------- */

    openSamples(anchor, placement) {
      if (this.pop.isOpen('samples')) {
        this.pop.close();
        return;
      }
      const s = this.state;
      const hasSample = s.hasSample();
      const list = h('div', { class: 'lq-samples' }, LQ.Samples.list().map((sm) => h('button', {
        class: 'lq-sample', type: 'button',
        onclick: () => {
          this.pop.close();
          this.app.profiles.loadSample(sm.id);
        }
      }, [
        h('span', { class: 'lq-sample__icon' }, Dom.icon(sm.icon)),
        h('span', { class: 'lq-sample__title', text: sm.title }),
        h('span', { class: 'lq-sample__desc', text: sm.desc }),
        h('span', { class: 'lq-sample__tags' }, sm.tags.map((t) => h('span', { class: 'lq-tag', text: t })))
      ])));
      const clearBtn = h('button', { class: 'lq-btn lq-btn--sm', type: 'button', disabled: !hasSample,
        onclick: () => {
          this.pop.close();
          this.app.profiles.clearSamples();
        } }, [Dom.icon('broom'), 'サンプルデータのみクリア']);
      this.pop.open(anchor, [
        this._head('flask', 'サンプルデータで試す'),
        h('div', { class: 'lq-popover__body' }, [
          h('p', { class: 'lq-field__hint', text: '選ぶと ① と抽出条件がサンプルに切り替わります。自分の抽出条件は退避され、「サンプルデータのみクリア」で元に戻ります（通知の「元に戻す」でも戻せます）。' }),
          h('div', { class: 'lq-stack' }, [list])
        ]),
        h('div', { class: 'lq-popover__foot' }, [clearBtn, h('span', { class: 'lq-field__hint', text: hasSample ? '自分で読み込んだデータと抽出条件は消えません' : 'サンプルは読み込まれていません' })])
      ], { key: 'samples', size: 'xl', placement: placement || 'bottom-end' });
    }

    /* ---------------- 読み込み先の選択（貼り付け・ファイルの貼り付け） ---------------- */

    openRoleChooser(label, onChoose) {
      let keyHandler = null;
      const choose = (role) => {
        this.pop.close();
        onChoose(role);
      };
      const s = this.state;
      const target = s.profiles.length > 1 ? '（抽出条件「' + s.activeProfile.name + '」）' : '';
      const btn = (role) => h('button', { class: 'lq-btn lq-btn--block' + (role === 'source' ? ' lq-btn--primary' : ''), type: 'button', onclick: () => choose(role) },
        [UI.badge(role === 'source' ? 'src' : 'cond', role === 'source' ? '①' : '②'), (role === 'source' ? '元データ' : '条件データ' + target) + 'として読み込む',
          h('span', { class: 'lq-kbd', text: role === 'source' ? '1' : '2' })]);
      this.pop.open(null, [
        this._head('paste', '読み込む先を選んでください'),
        h('div', { class: 'lq-popover__body' }, [h('div', { class: 'lq-stack' }, [
          h('p', { text: label + ' を読み込みます。' }),
          btn('source'),
          btn('condition'),
          h('p', { class: 'lq-field__hint', text: '① または ② の読み込みパネルを開いた状態で貼り付けると、この確認は出ません。② は選択中の抽出条件に読み込みます。' })
        ])])
      ], {
        key: 'role',
        onClose: () => document.removeEventListener('keydown', keyHandler, true)
      });
      keyHandler = (e) => {
        if (e.key === '1') {
          e.preventDefault();
          choose('source');
        } else if (e.key === '2') {
          e.preventDefault();
          choose('condition');
        }
      };
      document.addEventListener('keydown', keyHandler, true);
    }

    /* ---------------- 読み込み範囲の指定（元のシート表示から） ---------------- */

    openRawRowMenu(anchor, role, rawIndex) {
      const ds = this.state.datasets[role];
      if (!ds) return;
      const rowNo = rawIndex + 1;
      const set = ds.settings;
      const apply = (patch, message) => {
        if (!this.app.updateReadSettings(role, patch)) return;
        this.ctx.toasts.show({ type: 'success', title: message, message: ROLE_LABEL[role] + '：' + Util.formatInt(ds.rowCount) + ' 行 × ' + ds.colCount + ' 列（範囲 ' + ds.stats.rangeText + '）' });
      };
      const belowHeader = !set.hasHeader || rowNo > set.headerRow;
      const menu = h('div', { class: 'lq-menu' }, [
        this._item('heading', 'この行をヘッダー行にする', 'データはこの次の行（' + (rowNo + 1) + ' 行目）から', () => apply({ hasHeader: true, headerRow: rowNo, startRow: rowNo + 1 }, 'ヘッダー行を ' + rowNo + ' 行目にしました')),
        this._item('arrow-right-to-bracket', 'この行からデータを開始', belowHeader ? 'データ開始行を ' + rowNo + ' 行目に' : 'ヘッダー行（' + set.headerRow + ' 行目）より下の行を選んでください',
          () => apply({ startRow: rowNo }, 'データ開始行を ' + rowNo + ' 行目にしました'), { disabled: !belowHeader }),
        this._item('arrow-right-from-bracket', 'この行でデータを終了', rowNo >= set.startRow ? '合計行などを除くときに使います' : 'データ開始行（' + set.startRow + ' 行目）以降の行を選んでください',
          () => apply({ endRow: rowNo }, '終了行を ' + rowNo + ' 行目にしました'), { disabled: rowNo < set.startRow }),
        set.endRow ? this._item('arrows-up-down', '終了行の指定を外す', '最後の行まで読み込みます', () => apply({ endRow: null }, '終了行の指定を外しました')) : null,
        h('div', { class: 'lq-menu__sep' }),
        set.hasHeader
          ? this._item('ban', 'ヘッダーなしにする', 'ヘッダー行（' + set.headerRow + ' 行目）もデータとして読み込み、列名は「列A」「列B」…になります',
            () => apply({ hasHeader: false, startRow: set.headerRow }, 'ヘッダーなしにしました'))
          : this._item('heading', 'ヘッダーありにする', 'この行をヘッダー行にします', () => apply({ hasHeader: true, headerRow: rowNo, startRow: rowNo + 1 }, 'ヘッダー行を ' + rowNo + ' 行目にしました'))
      ]);
      this.pop.open(anchor, [h('div', { class: 'lq-popover__head' }, [Dom.icon('crop-simple'), rowNo + ' 行目'])].concat(menu), { key: 'rawrow', placement: 'bottom-start' });
    }

    openRawColMenu(anchor, role, colIndex) {
      const ds = this.state.datasets[role];
      if (!ds) return;
      const letter = Util.colLetter(colIndex);
      const apply = (startCol, message) => {
        if (!this.app.updateReadSettings(role, { startCol: startCol })) return;
        this.ctx.toasts.show({ type: 'success', title: message, message: ROLE_LABEL[role] + '：' + ds.colCount + ' 列（範囲 ' + ds.stats.rangeText + '）' });
      };
      const menu = h('div', { class: 'lq-menu' }, [
        this._item('arrow-right-to-bracket', letter + ' 列から読み込む', '左側の列は読み込みません', () => apply(colIndex + 1, '開始列を ' + letter + ' 列にしました'),
          { disabled: ds.settings.startCol === colIndex + 1 }),
        ds.settings.startCol > 1 ? this._item('arrow-left', 'A 列から読み込む', '開始列の指定を外します', () => apply(1, '開始列を A 列にしました')) : null
      ]);
      this.pop.open(anchor, [h('div', { class: 'lq-popover__head' }, [Dom.icon('crop-simple'), letter + ' 列'])].concat(menu), { key: 'rawcol', placement: 'bottom-start' });
    }
  }

  LQ.Dialogs = Dialogs;
})(window);

/* =========================================================================
 * ── 出力・根拠 ──
 * 結果まわりの小窓：出力（形式・範囲・ファイル名）、行の判定根拠、結果の根拠（抽出条件ごとの内容と件数）
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Dom = LQ.Dom;
  const Util = LQ.Util;
  const UI = LQ.UI;
  const h = Dom.h;
  const fmt = Util.formatInt;

  const EXPLAIN_STATE = {
    true: { icon: 'circle-check', text: '満たす' },
    false: { icon: 'circle-xmark', text: '満たさない' },
    ignored: { icon: 'minus', text: '判定しない（② が空欄）' },
    incomparable: { icon: 'triangle-exclamation', text: '比較できない（数値と文字など）' },
    none: { icon: 'minus', text: 'ひも付く ② の行なし' }
  };

  class ResultDialogs {
    constructor(ctx) {
      this.ctx = ctx;
      this.state = ctx.state;
      this.app = ctx.app;
      this.pop = ctx.popovers;
    }

    _head(icon, title) {
      return h('div', { class: 'lq-popover__head' }, [Dom.icon(icon), h('span', { text: title }), UI.iconButton('xmark', '閉じる（Esc）', () => this.pop.close(), 'lq-btn--sm')]);
    }

    _choiceList(name, options, onChange) {
      const map = new Map();
      const el = h('div', { class: 'lq-choice-list', role: 'radiogroup' });
      options.forEach((opt) => {
        const radio = h('input', { type: 'radio', name: name });
        const item = h('label', { class: 'lq-choice' }, [radio, h('span', { class: 'lq-choice__title', text: opt.title }), h('span', { class: 'lq-choice__desc', text: opt.desc })]);
        radio.addEventListener('change', () => {
          if (radio.checked) onChange(opt.value);
        });
        map.set(opt.value, { el: item, radio: radio });
        el.appendChild(item);
      });
      return {
        el: el,
        set(value, disabled) {
          map.forEach((c, v) => {
            c.radio.checked = v === value;
            c.radio.disabled = !!(disabled && disabled[v]);
            c.el.classList.toggle('is-selected', v === value);
            c.el.classList.toggle('is-disabled', !!(disabled && disabled[v]));
          });
        }
      };
    }

    /* ---------------- 出力 ---------------- */

    openExport(anchor) {
      if (this.pop.isOpen('export')) {
        this.pop.close();
        return;
      }
      const prepared = this.app.exporter.prepare();
      if (!prepared) {
        this.ctx.toasts.show({ type: 'warn', title: '出力できる列がありません', message: '出力列パネルで列を選んでください。' });
        return;
      }
      const view = prepared.view;
      const isAgg = prepared.kind === 'aggregate';
      const multi = view.multi && !isAgg;
      const canAgg = !isAgg && this.app.exporter.hasAggregate();
      const aggCheck = h('input', { type: 'checkbox', checked: LQ.Prefs.get('exportAggregate', true) });
      aggCheck.addEventListener('change', () => LQ.Prefs.set('exportAggregate', aggCheck.checked));
      const aggLabel = canAgg ? h('label', { class: 'lq-switch' }, [aggCheck, h('span', { class: 'lq-switch__track' }),
        h('span', { text: '「ピボット」シートを付ける（' + LQ.Aggregator.describe(this.state.aggregate) + '）' })]) : null;
      const formats = LQ.Exporters.formats;
      let formatId = LQ.Prefs.get('exportFormat', 'xlsx');
      if (!LQ.Exporters.availability(formatId).ok) formatId = (formats.find((f) => LQ.Exporters.availability(f.id).ok) || formats[1]).id;
      let scope = multi && view.filter === null ? 'split' : 'view';
      let nameEdited = false;
      const cards = new Map();
      const list = h('div', { class: 'lq-formats', role: 'radiogroup' });
      const protect = h('input', { type: 'checkbox', checked: false });
      const protectLabel = h('label', { class: 'lq-switch' }, [protect, h('span', { class: 'lq-switch__track' }), h('span', { text: 'Excel で開いたときの自動変換を防ぐ（先頭の 0・12 桁以上の数字・「1/2」などを ="…" 形式で出力）' })]);
      const nameInput = h('input', { class: 'lq-input', type: 'text', title: 'ファイル名（拡張子は自動で付きます）' });
      nameInput.addEventListener('input', () => {
        nameEdited = true;
      });
      const title = h('span');
      const scopeList = multi ? this._choiceList('lq-export-scope', [
        { value: 'view', title: '表示中の表（' + fmt(view.length) + ' 行）', desc: '画面の表（絞り込み・並び順・列）をそのまま 1 つの表で出力します。CSV もこちらです。' },
        { value: 'split', title: 'まとめ＋抽出条件ごとのシート（Excel）', desc: '「まとめ」シートと、優先順位の順に抽出条件ごとのシート' + (view.counts().unmatched ? '・「該当なし」シート' : '') + 'に分けて出力します。' }
      ], (v) => {
        scope = v;
        refresh();
      }) : null;
      const downloadBtn = h('button', { class: 'lq-btn lq-btn--primary', type: 'button' }, [Dom.icon('download'), h('span', { text: 'ダウンロード' })]);
      const refresh = () => {
        const fmtDef = LQ.Exporters.get(formatId);
        const isXlsx = formatId === 'xlsx';
        if (scope === 'split' && !isXlsx) scope = 'view';
        cards.forEach((card, id) => {
          card.el.classList.toggle('is-selected', id === formatId);
          card.radio.checked = id === formatId;
        });
        if (scopeList) scopeList.set(scope, { split: !isXlsx });
        protect.disabled = !fmtDef.protectable;
        if (aggLabel) {
          aggCheck.disabled = !isXlsx;
          aggLabel.title = isXlsx ? '' : 'ピボットのシートは Excel 形式のときだけ付けられます（CSV はピボットタブを表示中に出力するとピボットの表になります）';
        }
        protectLabel.title = fmtDef.protectable ? '' : 'Excel 形式では不要です（値の種類をそのまま保存します）';
        downloadBtn.lastChild.textContent = 'ダウンロード（.' + fmtDef.ext + '）';
        if (isAgg) title.textContent = '出力：ピボット ' + fmt(prepared.table.rowCount) + ' 行 × ' + prepared.defs.length + ' 列';
        else title.textContent = scope === 'split'
          ? '出力：まとめ ' + fmt(view.result.length) + ' 行＋抽出条件ごとのシート'
          : '出力：' + fmt(prepared.table.rowCount) + ' 行 × ' + prepared.defs.length + ' 列';
        if (!nameEdited) nameInput.value = this.app.exporter.defaultFileName(scope === 'split');
      };
      formats.forEach((fmtDef) => {
        const avail = LQ.Exporters.availability(fmtDef.id);
        const radio = h('input', { type: 'radio', name: 'lq-export-format', disabled: !avail.ok });
        /* 説明は選んでいる形式だけに出す（ほかはポインタを合わせると表示）。縦に長くならず、狭い画面でもファイル名まで見える */
        const el = h('label', { class: 'lq-format' + (avail.ok ? '' : ' is-disabled'), title: fmtDef.label + '：' + (avail.ok ? fmtDef.note : avail.reason) }, [
          radio,
          Dom.icon(fmtDef.icon, 'lq-format__icon'),
          h('span', { class: 'lq-format__title' }, [fmtDef.label, fmtDef.recommended ? h('span', { class: 'lq-tag lq-tag--rec', text: 'おすすめ' }) : null]),
          h('span', { class: 'lq-format__note', text: avail.ok ? fmtDef.note : avail.reason })
        ]);
        radio.addEventListener('change', () => {
          formatId = fmtDef.id;
          refresh();
        });
        cards.set(fmtDef.id, { el: el, radio: radio });
        list.appendChild(el);
      });
      const run = () => {
        this.pop.close();
        this.app.exporter.exportResult(formatId, { fileName: nameInput.value, protect: protect.checked && !protect.disabled, split: scope === 'split',
          aggregate: !!aggLabel && aggCheck.checked && !aggCheck.disabled });
      };
      downloadBtn.addEventListener('click', run);
      nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing) {
          e.preventDefault();
          run();
        }
      });
      const copyBtn = h('button', { class: 'lq-btn', type: 'button', title: '表示中の表をタブ区切りでコピーします（Excel に貼り付け可）',
        onclick: () => {
          this.pop.close();
          this.app.exporter.copyResult();
        } }, [Dom.icon('copy'), 'コピー']);
      const body = h('div', { class: 'lq-popover__body' }, [h('div', { class: 'lq-stack' }, [
        UI.field('ファイルの形式', list),
        scopeList ? UI.field('出力する範囲', scopeList.el) : null,
        isAgg ? UI.note('info', 'ピボットタブを表示中のため、ピボットの表を出力します。抽出結果の行を出力するときは「抽出結果」タブに切り替えてください。') : null,
        aggLabel,
        protectLabel,
        UI.field('ファイル名', h('div', { class: 'lq-export-name' }, [nameInput, h('span', { class: 'lq-muted', text: '＋拡張子' })])),
        h('p', { class: 'lq-field__hint', text: '並び順・列の並びは画面の表示と同じです。' + (this.state.isStale() ? '注意：表示中の結果は条件変更前のものです。' : '') })
      ])]);
      LQ.FormNav.attach(body);
      this.pop.open(anchor, [h('div', { class: 'lq-popover__head' }, [Dom.icon('file-export'), title, UI.iconButton('xmark', '閉じる（Esc）', () => this.pop.close(), 'lq-btn--sm')]),
        body, h('div', { class: 'lq-popover__foot' }, [downloadBtn, copyBtn])], { key: 'export', size: 'lg' });
      refresh();
      downloadBtn.focus();
    }

    /* ---------------- 行の判定根拠 ---------------- */

    openRowDetail(anchor, index) {
      const info = this.app.explainRow(index);
      if (!info) return;
      const s = this.state;
      const pair = info.pair;
      const part = info.part;
      const src = s.datasets.source;
      const where = ['① ' + src.rowNumber(pair.src) + ' 行目'];
      if (part && pair.cond >= 0 && part.condition) where.push('② ' + part.condition.rowNumber(pair.cond) + ' 行目');
      if (part && part.needsCondition && part.joinKind !== 'anti') where.push('② 一致数 ' + pair.count);
      const notes = [];
      if (info.stale) notes.push(UI.note('warn', 'この結果の後に条件が変更されています。以下は現在の条件での判定です。'));
      if (info.missing) notes.push(UI.note('warn', 'この行の抽出条件は一覧から削除されています。'));
      if (!part) {
        notes.push(UI.note('info', 'この行は、どの抽出条件にも該当しませんでした（「該当なし」として出力しています）。'));
      } else {
        if (part.needsCondition && pair.cond < 0) {
          notes.push(UI.note('info', part.joinKind === 'anti'
            ? 'この行は ② のどの行の条件も満たさなかったため出力されています（一致しなかった行）。'
            : 'この行は ② のどの行の条件も満たしませんでした（すべての行を出力する設定のため表示しています）。'));
        }
        if (info.others.length) {
          const names = info.others.map((o) => o.priority + ' 位「' + o.name + '」').join('・');
          notes.push(UI.note('tip', info.mode === 'assign'
            ? 'ほかに ' + names + ' にも該当していますが、優先順位が上のこの抽出条件に振り分けました。'
            : 'この行は ' + names + ' の結果にも含まれています（それぞれに出力）。'));
        }
      }
      const items = info.explanation ? info.explanation.items : [];
      const list = h('ul', { class: 'lq-explain' }, items.map((it) => {
        const stInfo = EXPLAIN_STATE[it.state] || EXPLAIN_STATE.none;
        return h('li', { class: 'lq-explain__item lq-explain__item--' + it.state }, [
          UI.badge('label', it.label),
          h('span', { class: 'lq-explain__state' }, [Dom.icon(stInfo.icon), stInfo.text]),
          h('span', { class: 'lq-explain__text' }, [
            it.leftName + '「', h('span', { class: 'lq-explain__value', text: it.leftValue }), '」が ',
            it.rightName + '「', h('span', { class: 'lq-explain__value', text: it.rightValue }), '」' + it.phrase
          ])
        ]);
      }));
      const headline = info.multi
        ? h('div', { class: 'lq-explain__profile' }, part
          ? [Dom.icon('filter'), '抽出条件：', h('strong', { text: part.priority + ' 位「' + info.partName + '」' })]
          : [Dom.icon('minus'), h('strong', { text: '該当なし' })])
        : null;
      this.pop.open(anchor, [
        this._head('circle-info', '結果 ' + fmt(index + 1) + ' 行目の根拠'),
        h('div', { class: 'lq-popover__body' }, [h('div', { class: 'lq-stack' }, [
          headline,
          h('div', { class: 'lq-row lq-sub lq-num', text: where.join('・') })
        ].concat(notes, [list]))]),
        h('div', { class: 'lq-popover__foot' }, [Dom.icon('code-branch'), h('span', { text: '組み合わせ：' + (info.explanation ? info.explanation.exprJa : '—') })])
      ], { key: 'row', size: 'lg', placement: 'bottom-start' });
    }

    /* ---------------- 結果の根拠（要約の「根拠を見る」） ---------------- */

    openResultDetails(anchor) {
      const res = this.state.result;
      const view = this.app.main.resultView();
      if (!res || !view) return;
      const st = res.stats;
      const multi = res.parts.length > 1;
      const mode = LQ.BatchRunner.COMBINE_MODES.find((m) => m.id === st.mode);
      const own = res.snapshot.ownRules || 0;
      const rows = [
        ['実行日時', Util.dateTimeText(res.snapshot.finishedAt) + '（' + Util.formatSeconds(st.elapsedMs) + '）'],
        ['① 元データ', res.snapshot.sourceName + '（' + fmt(st.sourceRows) + ' 行）'],
        multi ? ['重複の扱い', mode.label + '：' + mode.desc] : null,
        st.includeUnmatched ? ['該当なしの行', '出力する（' + fmt(st.unmatchedRows) + ' 行）'] : null,
        own < res.parts.length ? [own ? '照合ルール（全体の設定）' : '照合ルール', res.snapshot.rules] : null,
        ['結果', '① ' + fmt(st.matchedSources) + ' 行が該当・出力 ' + fmt(st.outputRows) + ' 行']
      ].filter(Boolean);
      const blocks = res.parts.map((part, i) => this._partBlock(part, view.partName(i), multi, st.mode));
      this.pop.open(anchor, [
        this._head('magnifying-glass', 'この結果の根拠'),
        h('div', { class: 'lq-popover__body' }, [h('div', { class: 'lq-stack' }, blocks.concat([
          h('table', { class: 'lq-grid lq-grid--kv' }, h('tbody', {}, rows.map((r) => h('tr', {}, [h('th', { text: r[0] }), h('td', { text: r[1] })]))))
        ]))])
      ], { key: 'details', size: 'lg', placement: 'bottom-end' });
    }

    /** 抽出条件 1 件分の根拠（条件・組み合わせ・② の注意・件数） */
    _partBlock(part, name, multi, mode) {
      const st = part.stats;
      const snap = part.snapshot;
      const join = LQ.QueryEngine.JOIN_KINDS.find((j) => j.id === st.joinKind);
      const match = LQ.QueryEngine.MATCH_MODES.find((m) => m.id === st.matchMode);
      const facts = [
        st.needsCondition ? '② ' + snap.conditionName + '（' + fmt(st.conditionRows) + ' 行）' : '② は使っていません（固定値の条件のみ）',
        '組み合わせ：' + snap.exprJa,
        '出力する行：' + join.label + (st.needsCondition && st.joinKind !== 'anti' ? '・' + match.label : ''),
        part.ownRules ? '照合ルール（個別）：' + snap.rules : null,
        st.indexLabel ? '高速化：条件 ' + st.indexLabel + '（' + st.indexOp + '）で ② の候補行を絞り込み' : null
      ].filter(Boolean);
      const shadow = part.hits - part.assigned;
      const count = '該当 ' + fmt(part.hits) + ' 行・出力 ' + fmt(part.rows) + ' 行' +
        (mode === 'assign' && shadow > 0 ? '（うち ' + fmt(shadow) + ' 行は優先順位が上の抽出条件に振り分け）' : '');
      const notes = [];
      st.perCondition.forEach((p) => {
        if (p.blankRows) notes.push('条件 ' + p.label + '：② の空欄 ' + fmt(p.blankRows) + ' 行は、この条件を判定していません。');
        if (p.wildcardRows) notes.push('条件 ' + p.label + '：② の ' + fmt(p.wildcardRows) + ' 行は「*」や「>=」などの書き方を含むため、その書き方（例：山田* ＝ 山田で始まる、>=0.1 ＝ 0.1 以上）で判定しました。');
        if (p.wildcardValue) notes.push('条件 ' + p.label + '：固定値に「*」や「>=」などの書き方を含むため、その書き方で判定しました。');
        if (p.incomparable) notes.push('条件 ' + p.label + '：数値と文字など比較できない組み合わせが ' + fmt(p.incomparable) + ' 件あり、不一致として扱いました。');
      });
      return h('div', { class: 'lq-resultpart' }, [
        multi ? h('div', { class: 'lq-resultpart__head' }, [h('span', { class: 'lq-badge lq-badge--rank', text: part.priority + ' 位' }), h('strong', { text: name }),
          h('span', { class: 'lq-resultpart__count lq-num', text: count })]) : h('div', { class: 'lq-resultpart__count lq-num', text: count }),
        h('ul', { class: 'lq-explain' }, snap.conditions.map((text) => h('li', { class: 'lq-explain__item' }, [UI.badge('label', text.charAt(0)), h('span', { text: text.slice(2) })]))),
        h('div', { class: 'lq-resultpart__facts' }, facts.map((f) => h('div', { text: f }))),
        notes.length ? UI.note('info', h('div', {}, notes.map((n) => h('div', { text: n })))) : null
      ]);
    }
  }

  LQ.ResultDialogs = ResultDialogs;
})(window);

/* =========================================================================
 * ── 抽出条件の操作 ──
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
      /* 作業セットが使えるときは「新しいセットとして追加」を先頭にする（今の作業を上書きしないため） */
      const modes = (info.canNewSet ? ['newSet'] : []).concat(['replace', 'add']);
      const DEF = {
        newSet: ['folder-plus', '新しい作業セットとして追加する', '今のセットはそのまま。ファイルの内容で新しいセットを作って開きます'],
        replace: ['arrows-rotate', '今の一覧と置き換える', '照合ルール・出力列・振り分けの設定もファイルの内容にします'],
        add: ['plus', '今の一覧の後ろに追加する', '今の設定はそのまま。優先順位は下になり、照合ルールが違う分は個別の設定として付けます']
      };
      const buttons = modes.map((m, i) => btn(m, DEF[m][0], DEF[m][1], DEF[m][2], String(i + 1), i === 0));
      this.pop.open(null, [
        this._head('file-import', '抽出条件の一括ファイルを読み込みます'),
        h('div', { class: 'lq-popover__body' }, [h('div', { class: 'lq-stack' }, [
          h('p', { text: info.fileName + '（抽出条件 ' + info.count + ' 件）を、どのように読み込みますか？' })
        ].concat(buttons, [
          h('p', { class: 'lq-field__hint', text: 'どれも、通知の「元に戻す」で読み込む前に戻せます。' })
        ]))])
      ], { key: 'importchoice', size: 'lg', onClose: () => release && release() });
      const keys = {};
      modes.forEach((m, i) => {
        keys[i + 1] = () => choose(m);
      });
      release = this._keys(keys);
      buttons[0].focus();
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
