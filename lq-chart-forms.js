/* =========================================================================
 * LightQuery - lq-chart-forms.js
 * グラフの描き方（追加分）：パレート図・累積分布を、lq-chart-render.js の ChartRenderer に登録する。
 *   既存の描き方には手を入れず、ChartRenderer.register(種類, 組み立て) だけで増やす。
 *   軸は 1 本だけにする（2 本の目盛りを持つグラフは読み違えやすいため）：
 *     パレート図 … 棒も線も「全体に対する %」で描くので、目盛りは 0〜100% の 1 本で済む
 *     累積分布   … 縦軸は「その値以下の行の割合」（0〜100%）
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const R = LQ.ChartRenderer;
  const Palette = LQ.ChartPalette;
  const Stats = LQ.ChartStats;
  const pct = R.pct;

  /* ABC 分析の区切り（累積の構成比） */
  const CLASS_A = 0.8;
  const CLASS_B = 0.95;
  const CLASSES = [
    { id: 'A', label: 'A（累積 80% まで）' },
    { id: 'B', label: 'B（〜 95%）' },
    { id: 'C', label: 'C（残り）' }
  ];

  /* ---------------------------------------------------------------------
   * パレート図：値の大きい順の棒（構成比）＋累積構成比の線＋80% の線。棒は A・B・C で色分けする
   * ------------------------------------------------------------------- */
  R.register('pareto', (spec) => {
    const p = Palette.read();
    const raw = spec.series[0].values.map((v) => Math.max(0, v || 0));
    const total = raw.reduce((a, v) => a + v, 0) || 1;
    const share = raw.map((v) => v / total);
    const cum = [];
    const cls = [];
    let run = 0;
    share.forEach((x, i) => {
      /* その項目を足す前の累積で区分する（80% に届くまでの項目が A） */
      cls.push(spec.others[i] ? 'other' : (run < CLASS_A ? 'A' : (run < CLASS_B ? 'B' : 'C')));
      run += x;
      cum.push(Math.min(1, run));
    });
    const fFull = R.valueFormat(Object.assign({}, spec, { arrange: 'group', valuePct: false }), false);
    const bar = (id, label, color) => ({ type: 'bar', label: label, data: share.map((x, i) => (cls[i] === id ? x : null)), backgroundColor: color,
      borderRadius: p.barRadius, borderSkipped: 'start', maxBarThickness: p.barMax * 1.5, grouped: false, skipNull: true, order: 2, lqBase: color });
    const datasets = CLASSES.map((c, i) => bar(c.id, c.label, Palette.color(i))).filter((d) => d.data.some((x) => x !== null));
    if (cls.indexOf('other') >= 0) datasets.push(bar('other', 'その他', Palette.color(0, true)));
    datasets.push({ type: 'line', label: '累積構成比', data: cum, borderColor: p.title, backgroundColor: p.title, borderWidth: p.lineWidth,
      pointRadius: spec.labels.length > 40 ? 0 : 3, pointBackgroundColor: p.surface, pointBorderColor: p.title, pointBorderWidth: 1.5, tension: 0, order: 1, lqBase: p.title });
    const countA = cls.filter((c) => c === 'A').length;
    return {
      type: 'bar',
      data: { labels: spec.labels, datasets: datasets },
      map: () => 0,
      options: {
        animation: { duration: 300 },
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: R._scale(p, { grid: { display: false }, title: R._title(spec.catTitle), ticks: { color: p.text, autoSkip: true, maxRotation: 45,
            callback(value) {
              return R.clip(this.getLabelForValue(value), 12);
            } } }),
          y: R._scale(p, { beginAtZero: true, max: 1, title: R._title('全体に対する %（' + spec.valueLabel + '）'), ticks: { color: p.text, callback: (v) => pct(v) } })
        },
        plugins: {
          lqRefLines: { lines: [{ axis: 'y', value: CLASS_A, label: '80%（上位 ' + countA + ' 件）', color: p.mean, dash: [5, 4] }] },
          lqCrosshair: { enabled: true },
          tooltip: { filter: (item) => item.raw !== null, callbacks: {
            title: (items) => (items.length ? spec.labels[items[0].dataIndex] : ''),
            label: (item) => (item.dataset.type === 'line' ? '累積：' + pct(item.raw)
              : spec.valueLabel + '：' + fFull(spec.series[0].values[item.dataIndex]) + '（' + pct(item.raw) + '）　区分 ' + cls[item.dataIndex].replace('other', 'その他'))
          } }
        }
      }
    };
  });

  /* ---------------------------------------------------------------------
   * 累積分布：x の値以下の行の割合を階段状に描く。50%（中央値）の横線
   * ------------------------------------------------------------------- */
  R.register('ecdf', (spec) => {
    const p = Palette.read();
    const datasets = spec.series.map((s, i) => {
      const color = Palette.color(i, s.other);
      return { label: s.name, data: s.points, stepped: 'after', borderColor: color, backgroundColor: color, borderWidth: p.lineWidth,
        pointRadius: 0, pointHoverRadius: 4, pointHitRadius: 6, fill: false, lqBase: color };
    });
    return {
      type: 'line',
      data: { datasets: datasets },
      map: (d) => d,
      options: {
        animation: { duration: 300 },
        parsing: true,
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        scales: {
          x: R._scale(p, { type: 'linear', title: R._title(spec.valueLabel), ticks: { color: p.text, callback: (v) => Stats.shortNumber(v) } }),
          y: R._scale(p, { beginAtZero: true, max: 1, title: R._title('その値以下の行の割合'), ticks: { color: p.text, callback: (v) => pct(v) } })
        },
        plugins: {
          lqRefLines: { lines: spec.guide ? [{ axis: 'y', value: 0.5, label: '50%（中央値）', color: p.median, dash: [5, 4] }] : [] },
          tooltip: { callbacks: {
            title: () => '',
            label: (item) => (spec.series.length > 1 ? item.dataset.label + '：' : '') + Stats.fullNumber(item.raw.x) + ' 以下が ' + pct(item.raw.y)
          } }
        },
        layout: { padding: { top: 4, right: 16, bottom: 4, left: 4 } }
      }
    };
  });
})(window);
