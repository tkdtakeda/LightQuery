/* =========================================================================
 * 「照合しないで絞り込みだけ」5 案のモック：共通の骨組み
 *   FO.render(opts) … 上部バー・アイコン列・パネル・タブ・本文を描く。各案は opts で入口と流れだけを変える
 *   状態：loaded（① を読み込み、照合は未設定）／ filtered（絞り込みだけの結果）／ match（照合に戻した・照合の設定中）
 * ========================================================================= */
(function (global) {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const RAIL = [
    ['入力'], ['src', 'table', '①元データ'], ['cond', 'list-check', '②照合表'],
    ['抽出'], ['query', 'code-compare', '抽出条件'],
    ['結果'], ['out', 'table-columns', '出力列'], ['pivot', 'table-cells', 'ピボット'], ['chart', 'chart-column', 'グラフ'],
    ['grow'], ['設定'], ['rules', 'spell-check', '照合ルール'], ['hist', 'clock-rotate-left', '履歴'], ['smp', 'flask', 'サンプル']
  ];
  const FILTERS = '<span class="ftags"><span class="muted"><i class="fa-solid fa-filter"></i> ① の絞り込み：</span>' +
    '<span class="ftag">カテゴリ ＝ 文具・家電 <i class="fa-solid fa-xmark"></i></span><span class="ftag">売上数 ≧ 100 <i class="fa-solid fa-xmark"></i></span></span>';

  function rail(o) {
    $('#rail').innerHTML = RAIL.map((r) => {
      if (r[0] === 'grow') return '<span class="grow"></span>';
      if (r.length === 1) return '<h6>' + r[0] + '</h6>';
      const rest = (o.restRail || []).indexOf(r[0]) >= 0;
      return '<button class="' + (r[0] === o.railOn ? 'on' : '') + (rest ? ' rest' : '') + '" title="' + (rest ? '照合しない設定のため使いません' : '') + '">' +
        '<i class="fa-solid fa-' + r[1] + '"></i>' + r[2] + (r[0] === 'src' ? '<i class="fa-solid fa-circle-check ok"></i>' : '') +
        (rest ? '<span class="zz">休止</span>' : '') + '</button>';
    }).join('');
  }

  function tabs(o) {
    return '<nav class="tabs"><a class="' + (o.tab === 'src' ? 'on' : '') + '"><span class="badge badge--src">①</span>売上帳票.xlsx <span class="small muted">' + (o.filtered ? '18 行（絞り込み後）' : '30 行') + '</span>' +
      (o.filtered ? ' <i class="fa-solid fa-filter small" style="color:var(--color-primary)"></i>' : '') + '</a>' +
      '<a class="' + (o.restCond ? 'rest' : '') + '"><span class="badge badge--cond">②</span>照合表 <span class="small muted">' + (o.restCond ? '使わない' : '未読み込み') + '</span></a><span class="sep"></span>' +
      '<a class="' + (o.tab === 'result' ? 'on' : '') + '"><i class="fa-solid fa-table-list"></i>' + (o.resultLabel || '抽出結果') + ' <span class="small muted">' + (o.resultCount || '未実行') + '</span></a>' +
      '<a><i class="fa-solid fa-table-cells"></i>ピボット</a><a><i class="fa-solid fa-chart-column"></i>グラフ</a></nav>';
  }

  function table() {
    return '<div class="tbl-wrap">' + MOCK.table({ limit: 18 }) + '</div>';
  }

  /**
   * @param {object} o railOn, restRail, panel(html), cta(html), tab, filtered, restCond, resultLabel, resultCount, summary(html), info(html), body(html), overlay(html), planNote
   */
  function render(o) {
    rail(o);
    $('#cta').innerHTML = o.cta || '';
    const panel = $('#panel');
    panel.hidden = !o.panel;
    panel.innerHTML = o.panel || '';
    let html = tabs(o);
    html += '<div class="summary">' + (o.summary || '') + '</div>';
    html += '<div>' + (o.info || '') + '</div>';
    html += o.body || table();
    html += '<div class="pager"><span>1 / 1 ページ ・ 100 行／ページ</span><span>' + (o.pagerText || '1–18 行目 ／ 全 18 行') + '</span></div>';
    $('#main').innerHTML = html;
    $('#overlay').innerHTML = o.overlay || '';
    $('#plannote').innerHTML = o.planNote ? '<div class="plan-note"><b>案の仮説：</b>' + o.planNote + '</div>' : '';
  }

  const SHELL = '<div class="app"><header class="top"><span class="logo"><i class="fa-solid fa-magnifying-glass"></i>LightQuery</span>' +
    '<button class="btn"><i class="fa-regular fa-folder-open"></i>作業セット 1<i class="fa-solid fa-chevron-down small"></i></button><span class="spacer"></span>' +
    '<div class="cta-wrap" id="cta"></div><button class="btn btn--ghost"><i class="fa-solid fa-circle-question"></i>使い方</button>' +
    '<button class="icon-btn"><i class="fa-solid fa-ellipsis-vertical"></i></button></header>' +
    '<div class="body"><nav class="rail" id="rail"></nav><aside class="panel" id="panel" hidden></aside><main class="main" id="main"></main></div></div>' +
    '<div id="overlay"></div><div id="plannote"></div>';

  function boot(states, fn) {
    document.body.insertAdjacentHTML('afterbegin', SHELL);
    MOCK.boot(states, (st) => render(fn(st)));
  }

  global.FO = { boot: boot, FILTERS: FILTERS };
})(window);
