/* =========================================================================
 * LightQuery - lq-ui-dialogs.js
 * 小窓（ポップオーバー）：その他の操作メニュー、サンプル選択、出力、読み込み先の選択、
 *   行の判定根拠、結果の根拠、読み込み範囲の指定（行・列）
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Dom = LQ.Dom;
  const Util = LQ.Util;
  const UI = LQ.UI;
  const h = Dom.h;

  const ROLE_LABEL = { source: '① 元データ', condition: '② 条件データ' };
  const EXPLAIN_STATE = {
    true: { icon: 'circle-check', text: '満たす' },
    false: { icon: 'circle-xmark', text: '満たさない' },
    ignored: { icon: 'minus', text: '判定しない（② が空欄）' },
    incomparable: { icon: 'triangle-exclamation', text: '比較できない（数値と文字など）' },
    none: { icon: 'minus', text: 'ひも付く ② の行なし' }
  };

  class Dialogs {
    constructor(ctx) {
      this.ctx = ctx;
      this.state = ctx.state;
      this.app = ctx.app;
      this.pop = ctx.popovers;
    }

    /** メニュー項目（無効のときは理由を小さく表示する） */
    _item(icon, label, sub, onClick, opts) {
      const o = opts || {};
      return h('button', {
        class: 'lq-menu__item' + (o.danger ? ' is-danger' : ''), type: 'button', disabled: !!o.disabled,
        onclick: () => {
          this.pop.close();
          onClick();
        }
      }, [Dom.icon(icon), h('span', { class: 'lq-menu__text' }, [h('span', { text: label }), sub ? h('span', { class: 'lq-menu__sub', text: sub }) : null])]);
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
      const hasAny = !!(s.datasets.source || s.datasets.condition || s.query.conditions.length);
      const hasConds = s.query.conditions.length > 0;
      const menu = h('div', { class: 'lq-menu' }, [
        this._item('flask', 'サンプルデータを読み込む…', LQ.Samples.list().length + ' 種類のパターンで動作を確認', () => this.openSamples(anchor, 'bottom-end')),
        this._item('floppy-disk', '条件設定を保存（.json）', hasConds ? '条件・照合ルール・出力列・読み込み範囲を保存' : '保存する条件がありません', () => this.app.saveSettings(), { disabled: !hasConds }),
        this._item('folder-open', '条件設定を読み込む…', '保存した .json を適用（ドラッグ＆ドロップも可）', () => this.app.pickFile('settings')),
        h('div', { class: 'lq-menu__sep' }),
        this._item('broom', 'サンプルデータのみクリア', hasSample ? 'サンプルの ①・②・条件だけを消去（元に戻せます）' : 'サンプルデータは読み込まれていません',
          () => this.app.clearSamples(), { disabled: !hasSample }),
        this._item('trash-can', 'すべてクリア', hasAny ? 'データ・条件・結果を消去（元に戻せます）' : 'クリアするものがありません', () => this.app.clearAll(), { danger: true, disabled: !hasAny }),
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
      const hasSample = this.state.hasSample();
      const list = h('div', { class: 'lq-samples' }, LQ.Samples.list().map((sm) => h('button', {
        class: 'lq-sample', type: 'button',
        onclick: () => {
          this.pop.close();
          this.app.loadSample(sm.id);
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
          this.app.clearSamples();
        } }, [Dom.icon('broom'), 'サンプルデータのみクリア']);
      this.pop.open(anchor, [
        this._head('flask', 'サンプルデータで試す'),
        h('div', { class: 'lq-popover__body' }, [
          h('p', { class: 'lq-field__hint', text: '選ぶと ①・② と条件がサンプルに置き換わります（通知の「元に戻す」で戻せます）。' }),
          h('div', { class: 'lq-stack' }, [list])
        ]),
        h('div', { class: 'lq-popover__foot' }, [clearBtn, h('span', { class: 'lq-field__hint', text: hasSample ? '自分で読み込んだデータは消えません' : 'サンプルは読み込まれていません' })])
      ], { key: 'samples', size: 'xl', placement: placement || 'bottom-end' });
    }

    /* ---------------- 出力 ---------------- */

    openExport(anchor) {
      if (this.pop.isOpen('export')) {
        this.pop.close();
        return;
      }
      const prepared = this.app.exportTable();
      if (!prepared) {
        this.ctx.toasts.show({ type: 'warn', title: '出力できる列がありません', message: '出力列パネルで列を選んでください。' });
        return;
      }
      const formats = LQ.Exporters.formats;
      let formatId = LQ.Prefs.get('exportFormat', 'xlsx');
      if (!LQ.Exporters.availability(formatId).ok) formatId = (formats.find((f) => LQ.Exporters.availability(f.id).ok) || formats[1]).id;
      const cards = new Map();
      const list = h('div', { class: 'lq-formats', role: 'radiogroup' });
      const protect = h('input', { type: 'checkbox', checked: false });
      const protectLabel = h('label', { class: 'lq-switch' }, [protect, h('span', { class: 'lq-switch__track' }), h('span', { text: 'Excel で開いたときの自動変換を防ぐ（先頭の 0・12 桁以上の数字・「1/2」などを ="…" 形式で出力）' })]);
      const refresh = () => {
        cards.forEach((card, id) => {
          card.el.classList.toggle('is-selected', id === formatId);
          card.radio.checked = id === formatId;
        });
        const fmt = LQ.Exporters.get(formatId);
        protect.disabled = !fmt.protectable;
        protectLabel.title = fmt.protectable ? '' : 'Excel 形式では不要です（値の種類をそのまま保存します）';
        downloadBtn.lastChild.textContent = 'ダウンロード（.' + fmt.ext + '）';
      };
      formats.forEach((fmt) => {
        const avail = LQ.Exporters.availability(fmt.id);
        const radio = h('input', { type: 'radio', name: 'lq-export-format', disabled: !avail.ok });
        const el = h('label', { class: 'lq-format' + (avail.ok ? '' : ' is-disabled') }, [
          radio,
          Dom.icon(fmt.icon, 'lq-format__icon'),
          h('span', { class: 'lq-format__title' }, [fmt.label, fmt.recommended ? h('span', { class: 'lq-tag lq-tag--rec', text: 'おすすめ' }) : null]),
          h('span', { class: 'lq-format__note', text: avail.ok ? fmt.note : avail.reason })
        ]);
        radio.addEventListener('change', () => {
          formatId = fmt.id;
          refresh();
        });
        cards.set(fmt.id, { el: el, radio: radio });
        list.appendChild(el);
      });
      const nameInput = h('input', { class: 'lq-input', type: 'text', value: this.app.defaultFileName(), title: 'ファイル名（拡張子は自動で付きます）' });
      const run = () => {
        this.pop.close();
        this.app.exportResult(formatId, { fileName: nameInput.value, protect: protect.checked && !protect.disabled });
      };
      nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing) {
          e.preventDefault();
          run();
        }
      });
      const downloadBtn = h('button', { class: 'lq-btn lq-btn--primary', type: 'button', onclick: run }, [Dom.icon('download'), h('span', { text: 'ダウンロード' })]);
      const copyBtn = h('button', { class: 'lq-btn', type: 'button', title: 'タブ区切りでコピーします（Excel に貼り付け可）',
        onclick: () => {
          this.pop.close();
          this.app.copyResult();
        } }, [Dom.icon('copy'), 'コピー']);
      const t = prepared.table;
      const body = h('div', { class: 'lq-popover__body' }, [h('div', { class: 'lq-stack' }, [
        UI.field('ファイルの形式', list),
        protectLabel,
        UI.field('ファイル名', h('div', { class: 'lq-export-name' }, [nameInput, h('span', { class: 'lq-muted', text: '＋拡張子' })])),
        h('p', { class: 'lq-field__hint', text: '並び順・列の並びは画面の表示と同じです。' + (this.state.isStale() ? '注意：表示中の結果は条件変更前のものです。' : '') })
      ])]);
      LQ.FormNav.attach(body);
      this.pop.open(anchor, [
        this._head('file-export', '出力：' + Util.formatInt(t.rowCount) + ' 行 × ' + prepared.defs.length + ' 列'),
        body,
        h('div', { class: 'lq-popover__foot' }, [downloadBtn, copyBtn])
      ], { key: 'export', size: 'lg' });
      refresh();
      downloadBtn.focus();
    }

    /* ---------------- 読み込み先の選択（貼り付け・ファイルの貼り付け） ---------------- */

    openRoleChooser(label, onChoose) {
      let keyHandler = null;
      const choose = (role) => {
        this.pop.close();
        onChoose(role);
      };
      const btn = (role) => h('button', { class: 'lq-btn lq-btn--block' + (role === 'source' ? ' lq-btn--primary' : ''), type: 'button', onclick: () => choose(role) },
        [UI.badge(role === 'source' ? 'src' : 'cond', role === 'source' ? '①' : '②'), (role === 'source' ? '元データ' : '条件データ') + 'として読み込む', h('span', { class: 'lq-kbd', text: role === 'source' ? '1' : '2' })]);
      this.pop.open(null, [
        this._head('paste', '読み込む先を選んでください'),
        h('div', { class: 'lq-popover__body' }, [h('div', { class: 'lq-stack' }, [
          h('p', { text: label + ' を読み込みます。' }),
          btn('source'),
          btn('condition'),
          h('p', { class: 'lq-field__hint', text: '① または ② の読み込みパネルを開いた状態で貼り付けると、この確認は出ません。' })
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

    /* ---------------- 行の判定根拠 ---------------- */

    openRowDetail(anchor, index) {
      const info = this.app.explainRow(index);
      if (!info) return;
      const s = this.state;
      const pair = info.pair;
      const src = s.datasets.source;
      const cond = s.datasets.condition;
      const where = ['① ' + src.rowNumber(pair.src) + ' 行目'];
      if (pair.cond >= 0 && cond) where.push('② ' + cond.rowNumber(pair.cond) + ' 行目');
      const st = s.result.stats;
      if (st.needsCondition) where.push('② 一致数 ' + pair.count);
      const notes = [];
      if (info.stale) notes.push(UI.note('warn', 'この結果の後に条件が変更されています。以下は現在の条件での判定です。'));
      if (st.needsCondition && pair.cond < 0) {
        notes.push(UI.note('info', st.joinKind === 'anti'
          ? 'この行は ② のどの行の条件も満たさなかったため出力されています（一致しなかった行）。'
          : 'この行は ② のどの行の条件も満たしませんでした（すべての行を出力する設定のため表示しています）。'));
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
      this.pop.open(anchor, [
        this._head('circle-info', '結果 ' + Util.formatInt(index + 1) + ' 行目の根拠'),
        h('div', { class: 'lq-popover__body' }, [h('div', { class: 'lq-stack' }, [
          h('div', { class: 'lq-row lq-sub lq-num', text: where.join('・') })
        ].concat(notes, [list]))]),
        h('div', { class: 'lq-popover__foot' }, [Dom.icon('code-branch'), h('span', { text: '組み合わせ：' + (info.explanation ? info.explanation.exprJa : '—') })])
      ], { key: 'row', size: 'lg', placement: 'bottom-start' });
    }

    /* ---------------- 結果の根拠（要約の「根拠を見る」） ---------------- */

    openResultDetails(anchor) {
      const res = this.state.result;
      if (!res) return;
      const st = res.stats;
      const snap = res.snapshot;
      const join = LQ.QueryEngine.JOIN_KINDS.find((j) => j.id === st.joinKind);
      const match = LQ.QueryEngine.MATCH_MODES.find((m) => m.id === st.matchMode);
      const rows = [
        ['実行日時', Util.dateTimeText(snap.finishedAt) + '（' + Util.formatSeconds(st.elapsedMs) + '）'],
        ['① 元データ', snap.sourceName + '（' + Util.formatInt(st.sourceRows) + ' 行）'],
        st.needsCondition ? ['② 条件データ', snap.conditionName + '（' + Util.formatInt(st.conditionRows) + ' 行）'] : ['② 条件データ', '使用していません（固定値の条件のみ）'],
        ['組み合わせ', snap.exprJa],
        ['出力する行', join.label + '（' + join.note + '）'],
        st.needsCondition && st.joinKind !== 'anti' ? ['複数一致したとき', match.label] : null,
        ['照合ルール', snap.rules],
        ['高速化', st.indexLabel ? '条件 ' + st.indexLabel + '（' + st.indexOp + '）で ② の候補行を絞り込みました' : '② の全行と照合しました'],
        ['結果', '① ' + Util.formatInt(st.matchedSources) + ' 行が一致・出力 ' + Util.formatInt(st.outputRows) + ' 行']
      ].filter(Boolean);
      const notes = [];
      st.perCondition.forEach((p) => {
        if (p.blankRows) notes.push('条件 ' + p.label + '：② の空欄 ' + Util.formatInt(p.blankRows) + ' 行は、この条件を判定していません。');
        if (p.incomparable) notes.push('条件 ' + p.label + '：数値と文字など比較できない組み合わせが ' + Util.formatInt(p.incomparable) + ' 件あり、不一致として扱いました。');
      });
      const table = h('table', { class: 'lq-grid' }, h('tbody', {}, rows.map((r) => h('tr', {}, [h('th', { text: r[0] }), h('td', { text: r[1] })]))));
      this.pop.open(anchor, [
        this._head('magnifying-glass', 'この結果の根拠'),
        h('div', { class: 'lq-popover__body' }, [h('div', { class: 'lq-stack' }, [
          h('ul', { class: 'lq-explain' }, snap.conditions.map((text) => h('li', { class: 'lq-explain__item' }, [UI.badge('label', text.charAt(0)), h('span', { text: text.slice(2) })]))),
          table,
          notes.length ? UI.note('info', h('div', {}, notes.map((n) => h('div', { text: n })))) : null
        ])])
      ], { key: 'details', size: 'lg', placement: 'bottom-end' });
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
