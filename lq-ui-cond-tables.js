/* =========================================================================
 * LightQuery - lq-ui-cond-tables.js
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
