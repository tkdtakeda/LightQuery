/* =========================================================================
 * LightQuery - lq-ui-pivot.js
 * ピボットの表示：メインの「ピボット」タブに、行 × 列 × 値 の表を描く。
 *   ・見出しは 列の項目の段（＋値が複数なら値の名前の段）。左上には行に置いた項目の名前
 *   ・行の項目が上の行と同じなら薄く表示して、まとまりを見やすくする
 *   ・右端・下端に総計。セルをダブルクリック（Enter）すると、そのセルに入った行（内訳）を重ねて表示する
 *   ・計算結果は「対象・結果・絞り込み・照合ルール・設定・抽出条件の名前」が同じあいだ使い回す
 *   ・右上の「表｜グラフ｜並べて」で、同じ結果をグラフでも見られる（グラフは lq-ui-chart.js の PivotChart）
 *   （計算は lq-pivot.js。外からは以前の名前 LQ.AggregateTab で使う）
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Dom = LQ.Dom;
  const Util = LQ.Util;
  const UI = LQ.UI;
  const h = Dom.h;
  const fmt = Util.formatInt;
  const Settings = LQ.PivotSettings;

  /* 表とグラフの切り替え */
  const VIEW_MODES = [
    { value: 'table', label: '表', icon: 'table', title: 'ピボットを表で見る' },
    { value: 'chart', label: 'グラフ', icon: 'chart-column', title: 'ピボットをグラフで見る（総計は描きません）' },
    { value: 'split', label: '並べて', icon: 'table-columns', title: '左に表・右にグラフ。棒にポイントすると表の対応するセルを強調します' }
  ];

  /* 平均・標準偏差を画面に出すときの小数の桁数 */
  const AVG_DIGITS = 2;

  function esc(text) {
    return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  }

  /** 画面用の値の文字（桁区切りあり。出力用の文字とは別） */
  function display(cell, fn) {
    if (cell.value === null) return '';
    if (cell.pct || cell.date) return cell.text;
    const digits = fn === 'avg' || fn === 'stdev' ? AVG_DIGITS : 6;
    return cell.value.toLocaleString('ja-JP', { maximumFractionDigits: digits });
  }

  /* ---------------------------------------------------------------------
   * PivotTable：表の HTML（行はページ分だけ描く）
   * ------------------------------------------------------------------- */
  const PivotTable = {
    /**
     * @param {LQ.PivotModel} m
     * @param {Array} rows 描く行（m.rows の一部）
     * @returns {string}
     */
    html(m, rows) {
      const labelCols = Math.max(1, m.rowHeaders.length);
      const vc = m.values.length;
      const levels = m.colHeaders.length;
      const valueRow = m.valueHeader;
      const headRows = levels + (valueRow ? 1 : 0);
      const out = ['<table class="lq-grid lq-pivot"><thead>'];
      for (let L = 0; L < levels; L++) {
        out.push('<tr>');
        const last = L === headRows - 1;
        out.push(last ? PivotTable._rowFieldCells(m, labelCols)
          : '<th class="lq-pivot__corner" colspan="' + labelCols + '"><span class="lq-pivot__colfield">' + esc(m.colHeaders[L]) + ' <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></span></th>');
        let c = 0;
        while (c < m.cols.length) {
          /* 上の段は、同じ項目が続く列をまとめて 1 つの見出しにする */
          let span = 1;
          const key = (i) => m.cols[i].labels.slice(0, L + 1).join('\u0001');
          while (L < levels - 1 && c + span < m.cols.length && key(c + span) === key(c)) span++;
          out.push('<th class="lq-pivot__col" colspan="' + span * vc + '">' + esc(m.cols[c].labels[L]) + '</th>');
          c += span;
        }
        if (L === 0 && m.showRightTotal) out.push('<th class="lq-pivot__col is-total" colspan="' + vc + '"' + (headRows > 1 ? ' rowspan="' + (valueRow ? levels : headRows) + '"' : '') + '>総計</th>');
        out.push('</tr>');
      }
      if (valueRow) {
        out.push('<tr>' + PivotTable._rowFieldCells(m, labelCols));
        const colCount = Math.max(1, m.cols.length);
        for (let c = 0; c < colCount; c++) m.values.forEach((v) => out.push('<th class="lq-pivot__value">' + esc(v.label) + '</th>'));
        if (m.showRightTotal) m.values.forEach((v) => out.push('<th class="lq-pivot__value is-total">' + esc(v.label) + '</th>'));
        out.push('</tr>');
      }
      out.push('</thead><tbody>');
      let prev = null;
      rows.forEach((row) => {
        out.push('<tr>');
        const labels = m.rowHeaders.length ? row.labels : ['全体'];
        let same = !!prev;
        labels.forEach((label, i) => {
          same = same && prev[i] === label && i < labels.length - 1;
          out.push('<th class="lq-pivot__label' + (same ? ' is-repeat' : '') + '" scope="row" title="' + esc(label) + '">' + esc(label) + '</th>');
        });
        prev = labels;
        PivotTable._cells(m, row.i, out);
        out.push('</tr>');
      });
      if (m.showBottomTotal) {
        out.push('<tr class="is-total"><th class="lq-pivot__label" scope="row" colspan="' + labelCols + '">総計</th>');
        PivotTable._cells(m, -1, out);
        out.push('</tr>');
      }
      out.push('</tbody></table>');
      return out.join('');
    },

    _rowFieldCells(m, labelCols) {
      if (!m.rowHeaders.length) return '<th class="lq-pivot__corner" colspan="' + labelCols + '"></th>';
      return m.rowHeaders.map((name) => '<th class="lq-pivot__rowfield">' + esc(name) + '</th>').join('');
    },

    _cells(m, r, out) {
      const cols = m.cols.length ? m.cols : [{ i: 0 }];
      const cell = (c, vi, total) => {
        const v = m.values[vi];
        const x = m.get(r, c, vi);
        out.push('<td class="is-num' + (total ? ' is-total' : '') + '" tabindex="-1" data-r="' + r + '" data-c="' + c + '">' + esc(display(x, v.fn)) + '</td>');
      };
      cols.forEach((col) => m.values.forEach((v, vi) => cell(col.i, vi, false)));
      if (m.showRightTotal) m.values.forEach((v, vi) => cell(-1, vi, true));
    }
  };

  /* ---------------------------------------------------------------------
   * PivotTab：メインのタブ
   * ------------------------------------------------------------------- */
  class PivotTab {
    /** @param {LQ.MainView} main 表・注意帯・ページ送りを持つメイン領域 */
    constructor(main) {
      this.main = main;
      this.state = main.state;
      this._key = null;
      this._computed = null;
      this._pending = false;
      this._error = null;
      this._token = null;
      this._chart = null;
      this.node = h('div', { class: 'lq-pivotwrap' });
      this.tableHost = h('div', { class: 'lq-pvsplit__table' });
      this.chartHost = h('div', { class: 'lq-pvsplit__chart' });
      this.split = h('div', { class: 'lq-pvsplit' }, [this.tableHost, this.chartHost]);
      this.node.addEventListener('dblclick', (e) => this._openCell(e));
      this.node.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing) this._openCell(e);
      });
    }

    /** 対象（'result'：抽出結果／'source'：① の全行。抽出結果がなければ ① の全行）。① がなければ null */
    target() {
      const s = this.state;
      return Settings.effectiveTarget(s.aggregate, !!s.datasets.source, !!s.result);
    }

    /** 使う見せ方（抽出結果なら表示中の絞り込みを反映したもの、① の全行なら抽出なしの結果） */
    view() {
      const target = this.target();
      return target ? this.main.targetView(target) : null;
    }

    /** ピボットのグラフ（初めて使うときに作る） */
    chart() {
      if (!this._chart) this._chart = new LQ.PivotChart(this);
      return this._chart;
    }

    /** 「② の行」は ② の行がひも付く抽出結果でだけ使える */
    _blockedReason() {
      return this.target() === 'source' && Settings.usesCondRow(this.state.aggregate)
        ? '「② の行」は ② の行がひも付く抽出結果でだけ使えます。行から「② の行」を外すか、抽出してから対象を「抽出結果」にしてください。' : null;
    }

    /** 今の計算結果（PivotModel。計算できない・計算中なら null。列の種類が多すぎるときは {error}） */
    computed() {
      const s = this.state;
      const view = this.view();
      if (!view || !Settings.isConfigured(s.aggregate) || this._blockedReason()) return null;
      const names = view.parts.map((p, i) => view.partName(i));
      const key = JSON.stringify([view.result.id, view.filter, s.rules, s.aggregate, names, LQ.Fiscal.start()]);
      if (key !== this._key) {
        this._key = key;
        this._error = null;
        if (this._token) this._token.cancel();
        this._token = null;
        if (Settings.usesCondRow(s.aggregate)) this._startByCondition(view, s.aggregate, key);
        else {
          this._pending = false;
          this._computed = LQ.Pivot.compute(view, s.aggregate);
        }
      }
      if (this._pending || !this._computed || this._computed.error) return null;
      return this._computed;
    }

    /** 列の種類が多すぎるなどで表にできない理由（なければ null） */
    errorOf() {
      this.computed();
      return this._computed && this._computed.error ? this._computed : null;
    }

    /** 「② の行」は照合し直すため、画面を止めずに計算し、終わったら描き直す */
    _startByCondition(view, settings, key) {
      const token = new LQ.CancelToken();
      this._token = token;
      this._pending = true;
      this._computed = null;
      const done = () => {
        if (token.cancelled || key !== this._key) return;
        this._pending = false;
        this._token = null;
        this.main.ctx.bus.emit('change', { topic: 'aggregate-ready' });
      };
      LQ.Pivot.computeByCondition(view, settings, this.main.ctx.engine, token).then((c) => {
        if (c && !token.cancelled && key === this._key) this._computed = c;
        done();
      }).catch((err) => {
        if (key === this._key) this._error = err.message;
        done();
      });
    }

    get pending() {
      return this._pending;
    }

    /** タブの件数表示 */
    tabCount() {
      const s = this.state;
      if (!s.datasets.source) return '未読み込み';
      if (!Settings.isConfigured(s.aggregate)) return '未設定';
      if (this._blockedReason()) return '使えません';
      const c = this.computed();
      if (this._pending) return '計算中…';
      if (this.errorOf()) return '列が多すぎます';
      return c ? fmt(c.groupCount) + ' 行' : '';
    }

    _scopeText(view) {
      return this.main.scopeText(view);
    }

    _setupButton(label) {
      const s = this.state;
      return s.panel === 'aggregate' ? null
        : h('button', { class: 'lq-btn', type: 'button', onclick: () => s.openPanel('aggregate') }, [Dom.icon('table-cells'), label]);
    }

    render() {
      const s = this.state;
      const main = this.main;
      main.tools.appendChild(h('button', { class: 'lq-btn lq-btn--sm', type: 'button', title: '行・列・値を設定する',
        onclick: () => s.togglePanel('aggregate') }, [Dom.icon('sliders'), 'ピボットの設定']));
      if (!s.datasets.source) {
        main.grid.showEmpty(main._emptyMessage('table-cells', '① 元データを読み込むとピボットを作れます',
          '② を使わずに ① だけでも作れます。行（地域など）× 列（月など）で、件数・合計・平均などを表にします。抽出したあとは、その抽出結果でも作れます。'));
        return;
      }
      const blocked = this._blockedReason();
      if (blocked) {
        main.grid.showEmpty(main._emptyMessage('triangle-exclamation', '① の全行では「② の行」は使えません', blocked, this._setupButton('ピボットの設定を開く')));
        return;
      }
      if (!Settings.isConfigured(s.aggregate)) {
        main.grid.showEmpty(main._emptyMessage('table-cells', 'まだ何も置いていません',
          '「ピボットの設定」で項目を押すと、数値は「値」（合計）、文字や日付は「行」に入り、すぐ表になります。2 つ目の文字・日付は「列」に入ります。' +
          (s.result ? '' : '抽出していないので、① 元データの全行で作ります（② は不要です）。'), this._setupButton('ピボットを設定する')));
        return;
      }
      const view = this.view();
      const c = this.computed();
      const err = this.errorOf();
      if (err) {
        main.grid.showEmpty(main._emptyMessage('triangle-exclamation', '列の種類が多すぎます', err.message, this._moveColsButton()));
        return;
      }
      if (this._pending || !c) {
        main.grid.showEmpty(main._emptyMessage(this._pending ? 'spinner' : 'triangle-exclamation', this._pending ? '② の行ごとに計算しています…' : '計算できませんでした',
          this._pending ? '抽出条件ごとに ① と ② をすべての組み合わせで照合し直しています。終わると表が表示されます。' : (this._error || '設定を見直してください。')));
        return;
      }
      this._renderSummary(view, c);
      const onResult = this.target() === 'result';
      if (onResult) main._renderFilterBar(view);
      if (onResult && s.isStale()) {
        main.info.appendChild(UI.note('warn', h('span', {}, [h('strong', { text: '条件または照合ルールが変更されています。' }),
          'ピボットは変更前の抽出結果から計算しています。右上のボタンで再抽出すると反映されます。'])));
      }
      if (c.missing.length) main.info.appendChild(UI.note('warn', '次の項目は使えないため外しました：' + c.missing.join('、') + '。'));
      if (c.notes.length) main.info.appendChild(UI.note('info', h('div', {}, c.notes.map((n) => h('div', { text: n })))));
      if (!c.rows.length) {
        main.grid.showEmpty(main._emptyMessage('table-cells', '集計する行がありません', view.result.allRows
          ? '① 元データが 0 行です。① パネルの絞り込みを見直してください。'
          : '表示中の抽出結果が 0 行です。絞り込みを「すべて」にするか、条件を見直してください。'));
        return;
      }
      const mode = s.charts.pivot.view;
      const seg = new LQ.Segmented(VIEW_MODES, mode, (v) => main.chart.actions.setPivot({ view: v }));
      main.tools.insertBefore(seg.el, main.tools.firstChild);
      main.gridwrap.classList.toggle('is-stale', onResult && s.isStale());
      if (mode === 'chart') {
        main.grid.showNode(this.chart().frame.el);
        main.gridwrap.classList.add('is-chart');
        this.chart().draw(c, view, null);
        return;
      }
      const paging = main._paging('aggregate', c.rows.length);
      const rows = c.rows.slice(paging.start, paging.start + s.view.pageSize);
      const scroller = mode === 'split' ? this.tableHost : main.gridwrap;
      const scrollKey = mode + ':' + this._key + ':' + paging.page;
      const keep = this._scrollKey === scrollKey;
      const top = scroller.scrollTop;
      const left = scroller.scrollLeft;
      this._scrollKey = scrollKey;
      this.node.innerHTML = PivotTable.html(c, rows);
      if (mode === 'split') {
        if (this.node.parentNode !== this.tableHost) this.tableHost.appendChild(this.node);
        if (this.chart().frame.el.parentNode !== this.chartHost) this.chartHost.appendChild(this.chart().frame.el);
        main.grid.showNode(this.split);
        main.gridwrap.classList.add('is-chart');
        this.chart().draw(c, view, this.node);
      } else {
        main.grid.showNode(this.node);
      }
      scroller.scrollTop = keep ? top : 0;
      scroller.scrollLeft = keep ? left : 0;
      main._renderPager('aggregate', c.rows.length, paging);
    }

    /** 列に置いた項目を行の後ろに移すボタン（列の種類が多すぎるとき） */
    _moveColsButton() {
      const s = this.state;
      return h('button', { class: 'lq-btn lq-btn--primary', type: 'button', onclick: () => {
        const next = Util.clone(s.aggregate);
        next.rows = next.rows.concat(next.cols).slice(0, Settings.LIMIT.rows);
        next.cols = [];
        s.setAggregate(next);
      } }, [Dom.icon('arrow-down-wide-short'), '列の項目を行に移す']);
    }

    _renderSummary(view, c) {
      const s = this.state;
      this.main.info.appendChild(h('div', { class: 'lq-summary' }, [
        h('span', { class: 'lq-summary__main' }, [Dom.icon('table-cells'), fmt(c.groupCount) + ' 行' + (c.cols.length > 1 ? ' × ' + fmt(c.cols.length) + ' 列' : '')]),
        h('span', { class: 'lq-summary__item lq-num', text: '対象：' + this._scopeText(view) + ' ' + fmt(c.rowCount) + ' 行' }),
        h('span', { class: 'lq-summary__item', text: Settings.describe(s.aggregate) }),
        h('span', { class: 'lq-summary__item lq-summary__hint' }, [Dom.icon('magnifying-glass-chart'), 'セルをダブルクリックで内訳を表示'])
      ]));
    }

    /** セルのダブルクリック・Enter：そのセルに入った行を重ねて表示する（総計のセルは、その行・列のすべて） */
    _openCell(e) {
      const td = e.target.closest('td[data-r]');
      const c = this.computed();
      if (!td || !c) return;
      e.preventDefault();
      const r = Number(td.dataset.r);
      const col = Number(td.dataset.c);
      const view = this.view();
      const index = Array.prototype.indexOf.call(this.node.querySelectorAll('td[data-r]'), td);
      this.main.drillView().open(c.drill(r, col), view, this._scopeText(view), () => {
        const again = this.node.querySelectorAll('td[data-r]')[index];
        if (again) again.focus();
      }, { label: 'ピボットの設定', text: LQ.Aggregator.describe(this.state.aggregate) });
    }
  }

  LQ.PivotTable = PivotTable;
  LQ.PivotTab = PivotTab;
  LQ.AggregateTab = PivotTab;
})(window);
