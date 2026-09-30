/* =========================================================================
 * LightQuery - lq-ui-aggregate-view.js
 * 集計タブ：抽出結果（表示中の絞り込みを反映）を集計した表を、メイン領域の表・注意帯・ページ送りに描く。
 *   計算結果は「結果・絞り込み・照合ルール・集計の設定・抽出条件の名前」が同じあいだ使い回す。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Dom = LQ.Dom;
  const Util = LQ.Util;
  const UI = LQ.UI;
  const h = Dom.h;
  const fmt = Util.formatInt;

  class AggregateTab {
    /** @param {LQ.MainView} main 表・注意帯・ページ送りを持つメイン領域 */
    constructor(main) {
      this.main = main;
      this.state = main.state;
      this._key = null;
      this._computed = null;
    }

    /** 今の集計結果（集計できない状態なら null）。出力にも使う */
    computed() {
      const s = this.state;
      const view = this.main.resultView();
      if (!view || !LQ.AggregateSettings.isActive(s.aggregate)) return null;
      const names = view.parts.map((p, i) => view.partName(i));
      const key = JSON.stringify([view.result.id, view.filter, s.rules, s.aggregate, names]);
      if (key !== this._key) {
        this._key = key;
        this._computed = LQ.Aggregator.compute(view, s.aggregate);
      }
      return this._computed;
    }

    /** タブの件数表示 */
    tabCount() {
      const s = this.state;
      if (!s.result) return '未実行';
      if (!LQ.AggregateSettings.isActive(s.aggregate)) return '未設定';
      const c = this.computed();
      return c ? fmt(c.groupCount) + ' グループ' : '';
    }

    render() {
      const s = this.state;
      const main = this.main;
      main.tools.appendChild(h('button', { class: 'lq-btn lq-btn--sm', type: 'button', title: 'グループにする列・集計する値・順位を設定する',
        onclick: () => s.togglePanel('aggregate') }, [Dom.icon('calculator'), '集計の設定']));
      if (!s.result) {
        main.grid.showEmpty(main._emptyMessage('calculator', 'まだ抽出していません', '抽出すると、その結果をグループごとに集計できます（件数・合計・平均・標準偏差・最小・最大・順位）。右上のボタンから進めてください。'));
        return;
      }
      if (!LQ.AggregateSettings.isActive(s.aggregate)) {
        main.grid.showEmpty(main._emptyMessage('calculator', '集計する値がありません', '「集計の設定」で、件数か集計する値を選んでください。',
          h('button', { class: 'lq-btn', type: 'button', onclick: () => s.openPanel('aggregate') }, [Dom.icon('calculator'), '集計を設定する'])));
        return;
      }
      const view = main.resultView();
      const c = this.computed();
      this._renderSummary(view, c);
      main._renderFilterBar(view);
      if (s.isStale()) {
        main.info.appendChild(UI.note('warn', h('span', {}, [h('strong', { text: '条件または照合ルールが変更されています。' }),
          '集計は変更前の抽出結果から計算しています。右上のボタンで再抽出すると反映されます。'])));
      }
      if (c.missing.length) main.info.appendChild(UI.note('warn', '次の列は今の抽出結果にないため、集計から外しました：' + c.missing.join('、') + '。'));
      if (c.notes.length) main.info.appendChild(UI.note('info', h('div', {}, c.notes.map((n) => h('div', { text: n })))));
      if (!c.rows.length) {
        main.grid.showEmpty(main._emptyMessage('calculator', '集計する行がありません', '表示中の抽出結果が 0 行です。絞り込みを「すべて」にするか、条件を見直してください。'));
        return;
      }
      const paging = main._paging('aggregate', c.rows.length);
      const rows = c.rows.slice(paging.start, paging.start + s.view.pageSize);
      main.grid.render({
        mode: 'data',
        role: 'aggregate',
        scrollKey: 'aggregate:' + paging.page + ':' + this._key,
        columns: c.header.map((name) => ({ key: name, label: name, letter: '' })),
        rows: rows.map((cells, i) => ({ head: { text: fmt(paging.start + i + 1) }, cells: cells })),
        numeric: c.numeric
      });
      main.gridwrap.classList.toggle('is-stale', s.isStale());
      main._renderPager('aggregate', c.rows.length, paging);
    }

    _renderSummary(view, c) {
      const s = this.state;
      const scope = view.filter === null ? '抽出結果すべて' : (view.filter < 0 ? '該当なしの行' : '「' + view.partName(view.filter) + '」の行');
      this.main.info.appendChild(h('div', { class: 'lq-summary' }, [
        h('span', { class: 'lq-summary__main' }, [Dom.icon('calculator'), fmt(c.groupCount) + ' グループ']),
        h('span', { class: 'lq-summary__item lq-num', text: '対象：' + scope + ' ' + fmt(c.rowCount) + ' 行' }),
        h('span', { class: 'lq-summary__item', text: LQ.Aggregator.describe(s.aggregate) })
      ]));
    }
  }

  LQ.AggregateTab = AggregateTab;
})(window);
