/* =========================================================================
 * LightQuery - lq-ui-result-dialogs.js
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
      const multi = view.multi;
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
        protectLabel.title = fmtDef.protectable ? '' : 'Excel 形式では不要です（値の種類をそのまま保存します）';
        downloadBtn.lastChild.textContent = 'ダウンロード（.' + fmtDef.ext + '）';
        title.textContent = scope === 'split'
          ? '出力：まとめ ' + fmt(view.result.length) + ' 行＋抽出条件ごとのシート'
          : '出力：' + fmt(prepared.table.rowCount) + ' 行 × ' + prepared.defs.length + ' 列';
        if (!nameEdited) nameInput.value = this.app.exporter.defaultFileName(scope === 'split');
      };
      formats.forEach((fmtDef) => {
        const avail = LQ.Exporters.availability(fmtDef.id);
        const radio = h('input', { type: 'radio', name: 'lq-export-format', disabled: !avail.ok });
        const el = h('label', { class: 'lq-format' + (avail.ok ? '' : ' is-disabled') }, [
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
        this.app.exporter.exportResult(formatId, { fileName: nameInput.value, protect: protect.checked && !protect.disabled, split: scope === 'split' });
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
        if (p.wildcardRows) notes.push('条件 ' + p.label + '：② の ' + fmt(p.wildcardRows) + ' 行は「*」を含むため、ワイルドカード（例：山田* ＝ 山田で始まる）として判定しました。');
        if (p.wildcardValue) notes.push('条件 ' + p.label + '：固定値に「*」を含むため、ワイルドカードとして判定しました。');
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
