/* =========================================================================
 * LightQuery レイアウト案（モック）共通の部品
 *   MOCK.rows / MOCK.history … 5 案で同じデータ
 *   MOCK.table(opts)         … 表の HTML
 *   MOCK.boot(states, render) … URL の # で状態を切り替える（例：plan-a.html#running）
 *   ?shot=1 を付けると状態切替の帯を隠す（評価用の画面写真）
 * ========================================================================= */
(function (global) {
  'use strict';

  const ROWS = [
    [5, 'A-101-1', 'ボールペン 黒', '文具', 21, 2520], [6, 'A-102-1', 'ボールペン 赤', '文具', 350, 42000],
    [7, 'A-110-1', 'ノート A4 5冊', '文具', 211, 143480], [8, 'A-120-1', '試作ペン（新色）', '文具', 45, 6750],
    [9, 'A-130-1', '付箋 75mm', '文具', 351, 84240], [10, 'B-201-1', 'USB ケーブル 1m', '家電', 149, 146020],
    [11, 'B-202-1', 'USB 充電器 20W', '家電', 215, 425700], [12, 'B-210-1', 'モバイルバッテリー', '家電', 161, 560280],
    [13, 'B-220-1', '電気ケトル', '家電', 172, 856560], [14, 'B-230-1', '中古 ノートPC', '家電', 291, 11058000],
    [18, 'D-401-1', 'ハンドソープ 詰替', '日用品', 383, 145540], [19, 'D-410-1', 'ティッシュ 5箱', '日用品', 83, 34860],
    [20, 'D-420-1', 'USB 加湿器', '日用品', 77, 190960], [21, 'A-101-2', 'ボールペン 黒', '文具', 248, 29760],
    [22, 'A-102-2', 'ボールペン 赤', '文具', 16, 1920], [23, 'A-110-2', 'ノート A4 5冊', '文具', 358, 243440],
    [24, 'A-120-2', '試作ペン（新色）', '文具', 80, 12000], [25, 'A-130-2', '付箋 75mm', '文具', 12, 2880],
    [26, 'B-201-2', 'USB ケーブル 1m', '家電', 94, 92120], [27, 'B-202-2', 'USB 充電器 20W', '家電', 61, 120780],
    [28, 'B-210-2', 'モバイルバッテリー', '家電', 30, 104400], [29, 'B-220-2', '電気ケトル', '家電', 44, 219120]
  ];
  const COLS = [
    { label: '行番号', src: '①', n: true }, { label: '商品コード', src: '①' }, { label: '商品名', src: '①' },
    { label: 'カテゴリ', src: '①' }, { label: '売上数', src: '①', n: true }, { label: '売上金額', src: '①', n: true }
  ];
  const HISTORY = [
    { icon: 'circle-check', kind: 'ok', what: '抽出', when: '10/18 14:32', result: '39 行が一致（48 行中 81.3%）', meta: '作業セット 1・抽出条件 1 件（コードの頭文字）・0.4 秒' },
    { icon: 'file-export', kind: 'ok', what: '出力', when: '10/18 14:33', result: 'Excel 39 行', meta: '抽出結果_20261018.xlsx（ダウンロード）・6 列・シート 2 枚' },
    { icon: 'triangle-exclamation', kind: 'warn', what: '読み込み', when: '10/18 14:30', result: '① 48 行（警告 1 件）', meta: '売上帳票.xlsx・ヘッダー 4 行目・使用範囲の外にデータあり' },
    { icon: 'circle-xmark', kind: 'err', what: '読み込み', when: '10/17 09:12', result: '失敗：列「商品コード」がありません', meta: '売上_9月.csv（Shift_JIS）・記憶した設定を当てはめられず' },
    { icon: 'circle-stop', kind: 'muted', what: '抽出', when: '10/17 09:05', result: '中止（12,400 / 100,000 行で中止）', meta: '作業セット 月次・抽出条件 3 件' }
  ];

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const fmt = (v) => (typeof v === 'number' ? v.toLocaleString('ja-JP') : esc(v));

  function table(opts) {
    const o = opts || {};
    const rows = ROWS.slice(0, o.limit || ROWS.length);
    let html = '<table class="tbl"><thead><tr><th>#</th>';
    COLS.forEach((c) => {
      html += '<th><span class="badge ' + (c.src === '①' ? 'badge--src' : 'badge--cond') + '">' + c.src + '</span> ' + esc(c.label) +
        ' <i class="fa-solid fa-caret-down muted"></i></th>';
    });
    html += '</tr></thead><tbody>';
    rows.forEach((r, i) => {
      html += '<tr' + (o.selected === i ? ' class="is-selected"' : '') + '><td>' + (i + 1) + '</td>';
      r.forEach((v, j) => { html += '<td' + (COLS[j].n ? ' class="n num"' : '') + '>' + fmt(v) + '</td>'; });
      html += '</tr>';
    });
    return html + '</tbody></table>';
  }

  function history(limit) {
    return '<ul class="hist">' + HISTORY.slice(0, limit || HISTORY.length).map((h) =>
      '<li><i class="fa-solid fa-' + h.icon + '" style="color:var(--color-' + (h.kind === 'muted' ? 'text-muted' : h.kind) + ')"></i>' +
      '<span><span class="what">' + h.what + '</span>　' + esc(h.result) + '</span><span class="small muted num">' + h.when + '</span>' +
      '<span class="meta">' + esc(h.meta) + '</span></li>').join('') + '</ul>';
  }

  /** 表示密度の切替（どの案でも同じ部品。置き場所だけ各案で決める） */
  function density() {
    const cur = document.documentElement.dataset.density || 'standard';
    return '<span class="density" role="group" aria-label="表示密度">' +
      [['compact', 'コンパクト'], ['standard', '標準'], ['comfortable', 'ゆったり']].map((d) =>
        '<button type="button" data-density="' + d[0] + '" aria-pressed="' + (cur === d[0]) + '">' + d[1] + '</button>').join('') + '</span>';
  }

  function boot(states, render) {
    const shot = /[?&]shot=1/.test(location.search);
    if (shot) document.body.classList.add('shot');
    const bar = document.createElement('nav');
    bar.className = 'mockbar';
    document.body.appendChild(bar);
    const apply = () => {
      const st = location.hash.slice(1) || states[0][0];
      bar.innerHTML = '<span>モックの状態：</span>' + states.map((s) => '<a href="#' + s[0] + '" class="' + (s[0] === st ? 'on' : '') + '">' + s[1] + '</a>').join('');
      render(st);
    };
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-density]');
      if (!b || b.tagName !== 'BUTTON') return;
      document.documentElement.dataset.density = b.dataset.density;
      document.querySelectorAll('.density button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.density === b.dataset.density)));
    });
    global.addEventListener('hashchange', apply);
    apply();
  }

  /** モックで共通に見せる状態の名前 */
  const STATES = [['empty', '初期'], ['result', '結果'], ['edit', '条件の編集'], ['running', '抽出中'], ['stalled', '更新なし'], ['history', '履歴']];

  global.MOCK = { rows: ROWS, cols: COLS, table: table, history: history, density: density, boot: boot, STATES: STATES, esc: esc };
})(window);
