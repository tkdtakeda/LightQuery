/* =========================================================================
 * LightQuery - lq-ui-review.js
 * 抽出結果を確かめる部品（抽出結果タブの要約の下に、処理の流れと同じ見た目の帯で出す）
 *   CondMissBar … ② で一致しなかった行：抽出条件ごとに、① のどの行とも一致しなかった ② の行数。押すとその行を内訳で表示
 *   CompareBar  … 前回との違い：基準（直前の抽出結果・ファイル）と比べた 増えた行・消えた行・変わった行。押すと内訳
 *   内訳はピボット・処理の流れと同じ重ねる表示（DrillView）で、コピー・Excel 出力もできる。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Dom = LQ.Dom;
  const Util = LQ.Util;
  const UI = LQ.UI;
  const h = Dom.h;
  const fmt = Util.formatInt;

  /** 表（header・行の取り出し）を、内訳の表示が受け取る形にする */
  function drillTable(header, count, rowAt) {
    return {
      header: header,
      defs: header.map((name) => ({ name: name })),
      rowCount: count,
      rowAt: rowAt,
      forEachRow(fn) {
        for (let i = 0; i < count; i++) fn(rowAt(i), i);
      }
    };
  }

  /** 帯の 1 項目（件数が 0 なら押せない文字、1 以上なら押すと内訳） */
  function countStep(icon, label, count, title, onOpen, opts) {
    const o = opts || {};
    const children = [Dom.icon(icon), h('span', { text: label }), h('span', { class: 'lq-num lq-flow__rows' + (count ? ' lq-flow__removed' : ''), text: (o.sign || '') + fmt(count) + (o.unit === false ? '' : ' 行') })];
    if (!count) return h('span', { class: 'lq-flow__step', title: title + '。' + (o.zeroText || '該当する行はありません') }, children);
    const btn = h('button', { class: 'lq-flow__step lq-flow__step--btn', type: 'button', title: title + '。押すとその ' + fmt(count) + ' 行を表で見られます' }, children);
    btn.addEventListener('click', () => onOpen(btn));
    return btn;
  }

  /* ---------------------------------------------------------------------
   * CondMissBar：② で一致しなかった行
   * ------------------------------------------------------------------- */
  const CondMissBar = {
    /**
     * @param {object} ctx
     * @param {LQ.ResultView} view
     * @returns {Element|null} ② を使う抽出条件がなければ null
     */
    render(ctx, view) {
      const parts = view.parts.map((p, i) => ({ p: p, i: i })).filter((x) => x.p.needsCondition && x.p.condUnmatched);
      if (!parts.length) return null;
      const multi = view.parts.length > 1;
      const items = [h('span', { class: 'lq-filterbar__label' }, [UI.badge('cond', '②'), '一致しなかった ② の行'])];
      const total = parts.reduce((sum, x) => sum + x.p.condUnmatched.length, 0);
      if (!total) {
        items.push(h('span', { class: 'lq-flow__step', title: '② の行はすべて、① のどれかの行と一致しました' },
          [Dom.icon('circle-check'), h('span', { text: 'なし（② の行はすべて ① と一致）' })]));
      } else {
        parts.forEach((x) => {
          const name = view.partName(x.i);
          const label = multi ? x.p.priority + ' 位「' + name + '」' : '② ' + fmt(x.p.condition.rowCount) + ' 行のうち';
          items.push(countStep('list-check', label, x.p.condUnmatched.length, '① のどの行とも一致しなかった ② の行（' + name + '）',
            (anchor) => CondMissBar.open(ctx, x.p, name, anchor), { zeroText: 'すべて一致しました' }));
        });
      }
      return h('div', { class: 'lq-filterbar lq-flow', role: 'group', 'aria-label': '一致しなかった ② の行',
        title: '顧客リストのうち受注がなかった顧客など、① のどの行とも一致しなかった ② の行です（優先順位の振り分けの前に数えます）' }, items);
    },

    /** 一致しなかった ② の行を、② の列で内訳に出す */
    open(ctx, part, name, anchor) {
      const ds = part.condition;
      const list = part.condUnmatched;
      const header = ['② 行番号'].concat(ds.columns.map((c) => c.name));
      const table = drillTable(header, list.length, (i) => [String(ds.rowNumber(list[i]))].concat(ds.columns.map((c, ci) => {
        const v = ds.cell(list[i], ci);
        return v === undefined || v === null ? '' : String(v);
      })));
      const back = anchor && anchor.isConnected ? () => anchor.focus() : null;
      ctx.app.main.drillView().open({ by: [], table: table, title: '一致しなかった ② の行（' + name + '）', fileTag: '②_一致しなかった行_' + name }, null,
        '① のどの行とも一致しなかった ② の行です（優先順位の振り分けの前に数えています）。', back,
        { label: '抽出条件', text: name + '：' + part.snapshot.exprJa });
    }
  };

  /* ---------------------------------------------------------------------
   * CompareBar：前回との違い（比べているときだけ出す）
   * ------------------------------------------------------------------- */
  const CompareBar = {
    render(ctx) {
      const cmp = ctx.app.compare;
      if (!cmp.active) return null;
      const res = cmp.result();
      if (!res) return null;
      const items = [h('span', { class: 'lq-filterbar__label', title: '基準：' + cmp.base.name + '（' + fmt(cmp.base.rows.length) + ' 行）' }, [Dom.icon('not-equal'), '前回との違い']),
        h('span', { class: 'lq-flow__base', title: '基準の表と、行を見分ける列' }, '基準：' + cmp.base.name + '・' + (cmp.key ? '列「' + cmp.key + '」で見分ける' : '行全体で比べる'))];
      if (!res.ok) {
        items.push(UI.status('warn', res.message));
      } else {
        const open = (kind) => (anchor) => CompareBar.open(ctx, res, kind, anchor);
        items.push(countStep('circle-plus', '増えた行', res.added.length, '基準になく、今の結果にある行', open('added'), { sign: '+' }));
        items.push(countStep('circle-minus', '消えた行', res.removed.length, '基準にあり、今の結果にない行', open('removed'), { sign: '−' }));
        if (res.key) items.push(countStep('pen-to-square', '変わった行', res.changed.length, '両方にあり、同じ名前の列の値が違う行（' + res.columns.length + ' 列を比べています）', open('changed')));
        items.push(h('span', { class: 'lq-flow__step', title: '基準と同じ行' }, [Dom.icon('equals'), h('span', { text: '同じ' }), h('span', { class: 'lq-num lq-flow__rows', text: fmt(res.same) + ' 行' })]));
        if (res.dupKeys) items.push(h('span', { class: 'lq-flow__step', title: '列「' + res.key + '」の値が重複している行は、出てきた順に組にして比べています' },
          [Dom.icon('triangle-exclamation'), h('span', { text: 'キーの重複 ' + fmt(res.dupKeys) + ' 行' })]));
      }
      items.push(h('span', { class: 'lq-flow__edit' }, [
        h('button', { class: 'lq-btn lq-btn--xs', type: 'button', title: '比べる相手・行を見分ける列を変える', onclick: (e) => CompareDialog.open(ctx, e.currentTarget) }, [Dom.icon('sliders'), '設定']),
        UI.iconButton('xmark', '前回との比較を外す（元に戻せます）', () => cmp.stop(), 'lq-btn--xs')
      ]));
      return h('div', { class: 'lq-filterbar lq-flow', role: 'group', 'aria-label': '前回との違い' }, items);
    },

    open(ctx, res, kind, anchor) {
      const cmp = ctx.app.compare;
      const base = cmp.base;
      const cur = res.cur;
      let table;
      let title;
      let scope;
      if (kind === 'added') {
        table = drillTable(cur.header, res.added.length, (i) => cur.rows[res.added[i]]);
        title = '増えた行';
        scope = '基準「' + base.name + '」になく、今の結果にある行です。';
      } else if (kind === 'removed') {
        table = drillTable(base.header, res.removed.length, (i) => base.rows[res.removed[i]]);
        title = '消えた行';
        scope = '基準「' + base.name + '」にあり、今の結果にない行です（列は基準の表のとおり）。';
      } else {
        /* 変わった値を 1 つ 1 行で並べる（どの列がどう変わったかを縦に読める） */
        const lines = [];
        const k = cur.header.indexOf(res.key);
        res.changed.forEach((c) => c.cols.forEach((d) => lines.push([cur.rows[c.cur][k], d.name, d.before, d.after])));
        table = drillTable([res.key, '変わった列', '前回', '今回'], lines.length, (i) => lines[i]);
        title = '変わった行（' + fmt(res.changed.length) + ' 行・' + fmt(lines.length) + ' か所）';
        scope = '列「' + res.key + '」が同じ行で、値が違う列を 1 つずつ並べています。';
      }
      const back = anchor && anchor.isConnected ? () => anchor.focus() : null;
      ctx.app.main.drillView().open({ by: [], table: table, title: title, fileTag: '前回との違い_' + title.replace(/（.*$/, '') }, null, scope, back,
        { label: '前回との違い', text: LQ.Compare.summary(res) + '（基準：' + base.name + '）' });
    }
  };

  /* ---------------------------------------------------------------------
   * CompareDialog：比べる相手（直前の抽出結果・ファイル）と行を見分ける列を選ぶ小窓
   * ------------------------------------------------------------------- */
  const CompareDialog = {
    open(ctx, anchor) {
      const pop = ctx.popovers;
      if (pop.isOpen('compare')) {
        pop.close();
        return;
      }
      const cmp = ctx.app.compare;
      const cur = cmp.currentTable();
      if (!cur) {
        ctx.toasts.show({ type: 'warn', title: '比べる抽出結果がありません', message: '抽出してから、表示する列を選んで比べてください。' });
        return;
      }
      const st = {
        kind: cmp.base ? cmp.base.kind : (cmp.previous ? 'previous' : 'file'),
        file: cmp.base && cmp.base.kind === 'file' ? cmp.base : null,
        key: cmp.key
      };
      const baseOf = () => (st.kind === 'previous' ? cmp.previous : st.file);
      const radios = new Map();
      const choice = (value, icon, title) => {
        const radio = h('input', { type: 'radio', name: 'lq-compare-base' });
        const desc = h('span', { class: 'lq-choice__desc' });
        const el = h('label', { class: 'lq-choice' }, [radio, h('span', { class: 'lq-choice__title' }, [Dom.icon(icon), ' ' + title]), desc]);
        radio.addEventListener('change', () => {
          if (!radio.checked) return;
          st.kind = value;
          if (value === 'file' && !st.file) pickFile();
          refresh();
        });
        radios.set(value, { el: el, radio: radio, desc: desc });
        return el;
      };
      const pickBtn = h('button', { class: 'lq-btn lq-btn--xs', type: 'button', onclick: () => pickFile() }, [Dom.icon('file-import'), 'ファイルを選ぶ']);
      const viewBtn = h('button', { class: 'lq-btn lq-btn--xs', type: 'button', title: '直前の抽出結果を表で見る（コピー・Excel 出力もできます）',
        onclick: (e) => {
          pop.close();
          cmp.showPrevious(e.currentTarget);
        } }, [Dom.icon('table-list'), '表で見る']);
      const list = h('div', { class: 'lq-choice-list', role: 'radiogroup' }, [
        choice('previous', 'clock-rotate-left', '直前の抽出結果'),
        choice('file', 'file-excel', '前回出力したファイル（Excel・CSV）')
      ]);
      radios.get('file').el.appendChild(pickBtn);
      radios.get('previous').el.appendChild(viewBtn);
      const keySelect = h('select', { class: 'lq-select', title: '同じ値の行どうしを比べます（受注番号・顧客 ID など、行ごとに違う値の列）' });
      keySelect.addEventListener('change', () => {
        st.key = keySelect.value || null;
        refresh();
      });
      const status = h('div');
      const runBtn = h('button', { class: 'lq-btn lq-btn--primary', type: 'button', onclick: () => {
        const base = baseOf();
        if (!base) return;
        pop.close();
        cmp.start(base, st.key);
      } }, [Dom.icon('not-equal'), '比べる']);
      const stopBtn = cmp.active ? h('button', { class: 'lq-btn', type: 'button', onclick: () => {
        pop.close();
        cmp.stop();
      } }, [Dom.icon('xmark'), '比較を外す']) : null;

      const pickFile = () => {
        Dom.qsa('input.lq-filepick').forEach((el) => el.remove());
        const input = h('input', { type: 'file', class: 'lq-filepick lq-offscreen', tabindex: '-1', 'aria-hidden': 'true', accept: '.xlsx,.xlsm,.xls,.xlsb,.ods,.csv,.tsv,.txt' });
        input.addEventListener('change', async () => {
          const file = (input.files || [])[0];
          input.remove();
          if (!file) return;
          const table = await cmp.loadFile(file);
          if (!table) return;
          st.file = table;
          st.kind = 'file';
          st.key = null;
          refresh();
        });
        input.addEventListener('cancel', () => input.remove());
        document.body.appendChild(input);
        input.click();
      };

      const refresh = () => {
        const prev = cmp.previous;
        radios.forEach((r, v) => {
          r.radio.checked = v === st.kind;
          r.el.classList.toggle('is-selected', v === st.kind);
        });
        const pr = radios.get('previous');
        pr.radio.disabled = !prev;
        pr.el.classList.toggle('is-disabled', !prev);
        pr.desc.textContent = prev ? prev.name + '・' + fmt(prev.rows.length) + ' 行（作業セットに保存。ブラウザを閉じても残ります）'
          : 'まだありません。抽出し直すと、その前の結果と比べられます（① を来月のファイルに差し替えて抽出し直す など）';
        viewBtn.hidden = !prev;
        radios.get('file').desc.textContent = st.file ? st.file.name + '・' + fmt(st.file.rows.length) + ' 行' : 'LightQuery で前回出力したファイルなら、列の名前がそろいます';
        pickBtn.lastChild.textContent = st.file ? '別のファイルを選ぶ' : 'ファイルを選ぶ';
        const base = baseOf();
        Dom.clear(status);
        if (!base) {
          UI.fillSelect(keySelect, [], '', '（比べる相手を選んでください）');
          keySelect.disabled = true;
          runBtn.disabled = true;
          return;
        }
        const common = LQ.Compare.commonColumns(base, cur);
        const suggested = LQ.Compare.suggestKey(base, cur);
        if (st.key && common.indexOf(st.key) === -1) st.key = null;
        if (st.key === null && st._auto !== base) {
          st.key = suggested;
          st._auto = base;
        }
        UI.fillSelect(keySelect, [{ value: '', label: '使わない（行全体が同じかで比べる）' }]
          .concat(common.map((n) => ({ value: n, label: n + (n === suggested ? '（おすすめ）' : '') }))), st.key || '');
        keySelect.disabled = !common.length;
        runBtn.disabled = !common.length;
        status.appendChild(common.length
          ? UI.status('info', '同じ名前の列 ' + common.length + ' 列を比べます（今の結果 ' + fmt(cur.rows.length) + ' 行 ⇔ 基準 ' + fmt(base.rows.length) + ' 行）')
          : UI.status('warn', '同じ名前の列がありません。前回出力したファイルか確かめてください'));
      };

      pop.open(anchor, [
        h('div', { class: 'lq-popover__head' }, [Dom.icon('not-equal'), h('span', { text: '前回の結果と比べる' }), UI.iconButton('xmark', '閉じる（Esc）', () => pop.close(), 'lq-btn--sm')]),
        h('div', { class: 'lq-popover__body' }, [h('div', { class: 'lq-stack' }, [
          UI.field('比べる相手（基準）', list),
          UI.field('行を見分ける列', keySelect, '同じ値の行どうしを比べ、ほかの列の値が違えば「変わった行」にします'),
          status
        ])]),
        h('div', { class: 'lq-popover__foot' }, [runBtn, stopBtn])
      ], { key: 'compare', size: 'lg' });
      refresh();
      runBtn.focus();
    }
  };

  LQ.ReviewParts = { drillTable: drillTable, countStep: countStep };
  LQ.CondMissBar = CondMissBar;
  LQ.CompareBar = CompareBar;
  LQ.CompareDialog = CompareDialog;
})(window);
