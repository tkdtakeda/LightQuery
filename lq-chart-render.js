/* =========================================================================
 * LightQuery - lq-chart-render.js
 * グラフの描画：描画ライブラリ（Chart.js と箱ひげ・バイオリン用の追加部品）を必要になった時点で CDN から読み込み、
 *   lq-chart-data.js の「描く内容」を Chart.js の設定に置き換えて描く。ライブラリに触れるのはこのファイルだけ
 *   （描画ライブラリを替えるときは ChartRenderer を差し替える）。
 *   色・文字・線の太さは lq-tokens.css のトークン（--chart-*）を読む。
 *
 * （下の区切りごとに独立した部品）
 *   ChartLibrary  … ライブラリの読み込み（改ざん検知付き）と状態の通知
 *   ChartPalette  … トークンから色・寸法を読む
 *   ChartPlugins  … 背景・値の表示・線の端の名前・平均と中央値の線・縦の補助線
 *   ChartRenderer … 描く内容 → Chart.js の設定（種類を増やすときは register()。パレート図・累積分布は lq-chart-forms.js）
 *   ChartCanvas   … 画面に置く描画領域（描く・描き直す・画像にする・ドラッグで範囲を囲む）
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Dom = LQ.Dom;
  const Stats = LQ.ChartStats;
  const h = Dom.h;

  /* ---------------------------------------------------------------------
   * ChartLibrary
   * ------------------------------------------------------------------- */
  const LIBS = [
    { url: 'https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js',
      integrity: 'sha384-jb8JQMbMoBUzgWatfe6COACi2ljcDdZQ2OxczGA3bGNeWe+6DChMTBJemed7ZnvJ', ready: () => !!global.Chart },
    { url: 'https://cdn.jsdelivr.net/npm/@sgratzl/chartjs-chart-boxplot@4.4.5/build/index.umd.min.js',
      integrity: 'sha384-gdbF/I+Cr4dfXk+jVTKN97eXIQvJRSzhLVYTbyQEH2vXtmgEl1jeoY7PDpf4ka3A', ready: () => !!global.ChartBoxPlot }
  ];

  function loadScript(lib) {
    return new Promise((resolve, reject) => {
      if (lib.ready()) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = lib.url;
      script.integrity = lib.integrity;
      script.crossOrigin = 'anonymous';
      script.referrerPolicy = 'no-referrer';
      script.onload = () => (lib.ready() ? resolve() : reject(new Error('load')));
      script.onerror = () => reject(new Error('load'));
      document.head.appendChild(script);
    });
  }

  const ChartLibrary = {
    state: 'idle',
    _promise: null,
    _listeners: new Set(),

    get failureReason() {
      return 'グラフ用ライブラリ（Chart.js）を読み込めませんでした。インターネット接続を確認してください（表とピボットは使えます）。';
    },

    get ready() {
      return this.state === 'ready';
    },

    subscribe(fn) {
      this._listeners.add(fn);
      return () => this._listeners.delete(fn);
    },

    _setState(state) {
      this.state = state;
      this._listeners.forEach((fn) => fn(state));
    },

    ensure() {
      if (this.state === 'ready') return Promise.resolve(global.Chart);
      if (this._promise) return this._promise;
      this._setState('loading');
      this._promise = LIBS.reduce((p, lib) => p.then(() => loadScript(lib)), Promise.resolve()).then(() => {
        const B = global.ChartBoxPlot;
        global.Chart.register(B.BoxPlotController, B.BoxAndWiskers, B.ViolinController, B.Violin);
        ChartPalette.applyDefaults(global.Chart);
        this._setState('ready');
        return global.Chart;
      }).catch(() => {
        this._promise = null;
        this._setState('failed');
        throw new Error(this.failureReason);
      });
      return this._promise;
    }
  };

  /* ---------------------------------------------------------------------
   * ChartPalette
   * ------------------------------------------------------------------- */
  let cache = null;

  const ChartPalette = {
    read() {
      if (cache) return cache;
      const cs = getComputedStyle(document.documentElement);
      const v = (name) => cs.getPropertyValue(name).trim();
      const px = (name) => parseFloat(v(name)) || 0;
      cache = {
        series: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => v('--chart-' + i)),
        other: v('--chart-other'),
        mean: v('--chart-mean'),
        median: v('--chart-median'),
        trend: v('--chart-trend'),
        grid: v('--chart-grid'),
        axis: v('--chart-axis'),
        text: v('--chart-text'),
        title: v('--chart-title'),
        surface: v('--chart-surface'),
        areaAlpha: parseFloat(v('--chart-area-alpha')) || 0.12,
        overlayAlpha: parseFloat(v('--chart-overlay-alpha')) || 0.55,
        dimAlpha: parseFloat(v('--chart-dim-alpha')) || 0.18,
        barMax: px('--chart-bar-max'),
        barRadius: px('--chart-bar-radius'),
        lineWidth: px('--chart-line-width'),
        pointRadius: px('--chart-point-radius'),
        pointDense: px('--chart-point-radius-dense'),
        fontSize: px('--chart-font-size'),
        titleSize: px('--chart-title-size'),
        font: v('--font-family')
      };
      return cache;
    },

    /** 系列の色：固定の順に割り当てる。「その他」は灰色 */
    color(i, other) {
      const p = ChartPalette.read();
      return other ? p.other : p.series[i % p.series.length];
    },

    alpha(color, a) {
      const m = /^#([0-9a-f]{6})$/i.exec(color);
      if (!m) return color;
      const n = parseInt(m[1], 16);
      return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
    },

    applyDefaults(Chart) {
      const p = ChartPalette.read();
      Chart.defaults.font.family = p.font;
      Chart.defaults.font.size = p.fontSize;
      Chart.defaults.color = p.text;
      Chart.defaults.borderColor = p.grid;
    }
  };

  /* ---------------------------------------------------------------------
   * ChartPlugins（このファイルの中だけで使う小さな描画の追加）
   * ------------------------------------------------------------------- */
  const ChartPlugins = {
    /** 背景を白で塗る（画像に保存したときに透明にならないように） */
    background: {
      id: 'lqBackground',
      beforeDraw(chart) {
        const ctx = chart.ctx;
        ctx.save();
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = ChartPalette.read().surface;
        ctx.fillRect(0, 0, chart.width, chart.height);
        ctx.restore();
      }
    },

    /** 棒の先・積み上げの先に値を書く（options.plugins.lqValues = {enabled, format, stacked}） */
    values: {
      id: 'lqValues',
      afterDatasetsDraw(chart, args, opts) {
        if (!opts || !opts.enabled) return;
        const ctx = chart.ctx;
        const p = ChartPalette.read();
        const horizontal = chart.options.indexAxis === 'y';
        ctx.save();
        ctx.font = p.fontSize - 1 + 'px ' + p.font;
        ctx.fillStyle = p.text;
        ctx.textBaseline = 'middle';
        const draw = (el, text) => {
          if (!el || text === '') return;
          if (horizontal) {
            ctx.textAlign = 'left';
            ctx.fillText(text, el.x + 4, el.y);
          } else {
            ctx.textAlign = 'center';
            ctx.fillText(text, el.x, el.y - 8);
          }
        };
        if (opts.stacked) {
          const last = chart.data.datasets.length - 1;
          const meta = chart.getDatasetMeta(last);
          if (meta.hidden) return ctx.restore();
          meta.data.forEach((el, i) => draw(el, opts.format(opts.totals[i])));
        } else {
          chart.data.datasets.forEach((ds, d) => {
            const meta = chart.getDatasetMeta(d);
            if (meta.hidden) return;
            meta.data.forEach((el, i) => draw(el, opts.format(ds.data[i])));
          });
        }
        ctx.restore();
      }
    },

    /** 折れ線の右端に系列の名前を書く（系列が 4 つまで。凡例と合わせて色だけに頼らない） */
    endLabels: {
      id: 'lqEndLabels',
      afterDatasetsDraw(chart, args, opts) {
        if (!opts || !opts.enabled) return;
        const ctx = chart.ctx;
        const p = ChartPalette.read();
        ctx.save();
        ctx.font = p.fontSize + 'px ' + p.font;
        ctx.fillStyle = p.text;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const placed = [];
        chart.data.datasets.forEach((ds, d) => {
          const meta = chart.getDatasetMeta(d);
          if (meta.hidden || ds.lqTrend) return;
          let el = null;
          for (let i = meta.data.length - 1; i >= 0; i--) {
            if (ds.data[i] !== null && ds.data[i] !== undefined) {
              el = meta.data[i];
              break;
            }
          }
          if (!el) return;
          let y = el.y;
          placed.forEach((py) => {
            if (Math.abs(py - y) < p.fontSize + 2) y = py + (y >= py ? 1 : -1) * (p.fontSize + 2);
          });
          placed.push(y);
          ctx.fillText(LQ.ChartRenderer.clip(ds.label, 10), el.x + 8, y);
        });
        ctx.restore();
      }
    },

    /**
     * 補助線（options.plugins.lqRefLines = {lines:[{value, label, color, dash, axis?}], toIndex?}）
     *   axis が 'y' なら横線（パレート図の 80%・累積分布の 50%）、それ以外は縦線（ヒストグラムの平均・中央値）
     */
    refLines: {
      id: 'lqRefLines',
      afterDatasetsDraw(chart, args, opts) {
        if (!opts || !opts.lines || !opts.lines.length) return;
        const ctx = chart.ctx;
        const area = chart.chartArea;
        const scale = chart.scales.x;
        const p = ChartPalette.read();
        ctx.save();
        ctx.font = p.fontSize - 1 + 'px ' + p.font;
        ctx.textBaseline = 'top';
        opts.lines.forEach((line, n) => {
          if (line.axis === 'y') {
            ChartPlugins._hLine(chart, line, p);
            return;
          }
          const x = scale.getPixelForValue(opts.toIndex ? opts.toIndex(line.value) : line.value);
          if (!(x >= area.left && x <= area.right)) return;
          ctx.strokeStyle = line.color;
          ctx.lineWidth = p.lineWidth;
          ctx.setLineDash(line.dash || []);
          ctx.beginPath();
          ctx.moveTo(x, area.top);
          ctx.lineTo(x, area.bottom);
          ctx.stroke();
          ctx.setLineDash([]);
          const w = ctx.measureText(line.label).width;
          const left = x + 4 + w > area.right ? x - 4 - w : x + 4;
          ctx.fillStyle = p.surface;
          ctx.fillRect(left - 2, area.top + 2 + n * (p.fontSize + 4), w + 4, p.fontSize + 2);
          ctx.fillStyle = p.title;
          ctx.textAlign = 'left';
          ctx.fillText(line.label, left, area.top + 3 + n * (p.fontSize + 4));
        });
        ctx.restore();
      }
    },

    _hLine(chart, line, p) {
      const ctx = chart.ctx;
      const area = chart.chartArea;
      const y = chart.scales.y.getPixelForValue(line.value);
      if (!(y >= area.top && y <= area.bottom)) return;
      ctx.strokeStyle = line.color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash(line.dash || []);
      ctx.beginPath();
      ctx.moveTo(area.left, y);
      ctx.lineTo(area.right, y);
      ctx.stroke();
      ctx.setLineDash([]);
      const w = ctx.measureText(line.label).width;
      ctx.fillStyle = p.surface;
      ctx.fillRect(area.right - w - 6, y - p.fontSize - 3, w + 4, p.fontSize + 2);
      ctx.fillStyle = p.title;
      ctx.textAlign = 'left';
      ctx.fillText(line.label, area.right - w - 4, y - p.fontSize - 2);
    },

    /** ポイント中の位置に縦の補助線（折れ線） */
    crosshair: {
      id: 'lqCrosshair',
      afterDatasetsDraw(chart, args, opts) {
        if (!opts || !opts.enabled) return;
        const active = chart.tooltip && chart.tooltip.getActiveElements ? chart.tooltip.getActiveElements() : [];
        if (!active.length) return;
        const x = active[0].element.x;
        const area = chart.chartArea;
        const ctx = chart.ctx;
        ctx.save();
        ctx.strokeStyle = ChartPalette.read().axis;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, area.top);
        ctx.lineTo(x, area.bottom);
        ctx.stroke();
        ctx.restore();
      }
    }
  };

  /* ---------------------------------------------------------------------
   * ChartRenderer：描く内容 → Chart.js の設定
   * ------------------------------------------------------------------- */
  const LABEL_MAX = 16;
  const VALUES_MAX = 24;
  const DENSE_POINTS = 5000;
  const BUBBLE_MIN = 3;
  const BUBBLE_MAX = 22;
  /* ドラッグで範囲を囲むと判定する動きの大きさ（px）と、その直後のクリックを無視する時間 */
  const BRUSH_MIN = 5;
  const BRUSH_QUIET_MS = 350;
  const QUIET_POINTS = 1000;

  function pctText(v) {
    return v === null || v === undefined || !isFinite(v) ? '' : Number((v * 100).toFixed(1)) + '%';
  }

  const ChartRenderer = {
    /** 描く内容の種類（spec.kind）に対応する組み立てを加える（Open/Closed：既存の種類に手を入れずに増やせる） */
    register(kind, build) {
      ChartRenderer['_' + kind] = build;
    },

    pct: pctText,

    clip(text, max) {
      const s = String(text === null || text === undefined ? '' : text);
      return s.length > max ? s.slice(0, max - 1) + '…' : s;
    },

    /** 値の書き方：short＝軸の目盛り用（万・億）／ full＝ポイントしたとき用 */
    valueFormat(spec, short) {
      if (spec.valuePct || spec.arrange === 'pct') return pctText;
      if (spec.valueDate) return (v) => (v === null || v === undefined ? '' : LQ.ValueParser.formatDate(v));
      return short ? Stats.shortNumber : (v) => Stats.fullNumber(v, spec.valueDigits);
    },

    /**
     * @param {object} spec 描く内容（title・subtitle を含む）
     * @param {{pick?:Function, hover?:Function}} handlers
     */
    config(spec, handlers) {
      const base = ChartRenderer['_' + spec.kind](spec);
      const p = ChartPalette.read();
      const opts = base.options;
      opts.responsive = true;
      opts.maintainAspectRatio = false;
      opts.layout = Object.assign({ padding: { top: 4, right: 16, bottom: 4, left: 4 } }, opts.layout || {});
      opts.plugins = Object.assign({}, opts.plugins);
      opts.plugins.title = { display: !!spec.title, text: spec.title, align: 'start', color: p.title,
        font: { size: p.titleSize, weight: '600' }, padding: { top: 4, bottom: spec.subtitle ? 2 : 10 } };
      opts.plugins.subtitle = { display: !!spec.subtitle, text: spec.subtitle, align: 'start', color: p.text, padding: { bottom: 10 } };
      const multi = base.data.datasets.filter((d) => !d.lqTrend).length > 1 || spec.kind === 'category' && spec.mode === 'donut';
      opts.plugins.legend = Object.assign({ display: multi, position: spec.mode === 'donut' ? 'right' : 'top', align: 'start',
        labels: { usePointStyle: true, pointStyle: 'rectRounded', boxWidth: 10, boxHeight: 10, padding: 12 } }, opts.plugins.legend || {});
      opts.plugins.tooltip = Object.assign({ backgroundColor: p.title, titleColor: p.surface, bodyColor: p.surface, padding: 10,
        cornerRadius: 6, boxPadding: 4, usePointStyle: true }, opts.plugins.tooltip || {});
      opts.onClick = (e, els) => {
        if (!els.length || !handlers.pick) return;
        const el = els[0];
        if (base.data.datasets[el.datasetIndex] && base.data.datasets[el.datasetIndex].lqTrend) return;
        handlers.pick(base.map ? base.map(el.datasetIndex) : el.datasetIndex, el.index);
      };
      opts.onHover = (e, els) => {
        const target = e.native && e.native.target;
        const usable = els.filter((el) => !(base.data.datasets[el.datasetIndex] || {}).lqTrend);
        if (target) target.style.cursor = usable.length ? 'pointer' : 'default';
        if (handlers.hover) handlers.hover(usable.length ? (base.map ? base.map(usable[0].datasetIndex) : usable[0].datasetIndex) : null, usable.length ? usable[0].index : null);
      };
      base.plugins = [ChartPlugins.background, ChartPlugins.values, ChartPlugins.endLabels, ChartPlugins.refLines, ChartPlugins.crosshair];
      return base;
    },

    _scale(p, extra) {
      return Object.assign({ grid: { color: p.grid, drawTicks: false }, border: { color: p.axis }, ticks: { color: p.text, padding: 6 } }, extra);
    },

    _title(text) {
      return { display: !!text, text: text, color: ChartPalette.read().text, font: { weight: '600' } };
    },

    /* ---- 棒・折れ線・ドーナツ ---- */
    _category(spec) {
      if (spec.mode === 'donut') return ChartRenderer._donut(spec);
      const p = ChartPalette.read();
      const horizontal = spec.orient === 'h';
      const stacked = spec.arrange === 'stack' || spec.arrange === 'pct' || (spec.mode === 'line' && spec.area && spec.arrange === 'stack');
      const isLine = spec.mode === 'line';
      const lineStacked = isLine && spec.area && spec.arrange === 'stack';
      const totals = spec.labels.map((l, i) => spec.series.reduce((a, s) => a + (s.values[i] || 0), 0));
      const pct = spec.arrange === 'pct' && !isLine;
      const data = (s) => (pct ? s.values.map((v, i) => (totals[i] ? (v || 0) / totals[i] : null)) : s.values);
      const fShort = ChartRenderer.valueFormat(spec, true);
      const fFull = ChartRenderer.valueFormat(spec, false);
      const many = spec.labels.length > 60;
      const datasets = spec.series.map((s, i) => {
        const color = ChartPalette.color(i, s.other);
        if (isLine) {
          return { label: s.name, data: data(s), borderColor: color, backgroundColor: spec.area ? ChartPalette.alpha(color, p.areaAlpha) : color,
            fill: spec.area ? (lineStacked && i > 0 ? '-1' : 'origin') : false, borderWidth: p.lineWidth, tension: 0, spanGaps: true,
            pointRadius: many ? 0 : 3, pointHoverRadius: 5, pointBackgroundColor: color, pointBorderColor: p.surface, pointBorderWidth: 1.5,
            lqBase: color, lqRaw: s.values };
        }
        return { label: s.name, data: data(s), backgroundColor: color, borderColor: p.surface, borderWidth: stacked ? 1 : 0,
          borderRadius: stacked ? 0 : p.barRadius, borderSkipped: 'start', maxBarThickness: p.barMax, lqBase: color, lqRaw: s.values };
      });
      const valueAxis = ChartRenderer._scale(p, { beginAtZero: true, stacked: stacked || lineStacked, max: pct ? 1 : undefined,
        title: ChartRenderer._title(spec.valueLabel + (pct && !spec.valuePct ? '（構成比）' : '')),
        ticks: { color: p.text, padding: 6, callback: (v) => fShort(v) } });
      const catAxis = ChartRenderer._scale(p, { stacked: stacked || lineStacked, grid: { display: false }, title: ChartRenderer._title(spec.catTitle),
        ticks: { color: p.text, padding: 6, autoSkip: true, maxRotation: horizontal ? 0 : 45,
          callback(value) {
            return ChartRenderer.clip(this.getLabelForValue(value), LABEL_MAX);
          } } });
      const showValues = spec.showValues && !isLine && spec.labels.length * (stacked ? 1 : spec.series.length) <= VALUES_MAX && !pct;
      const endLabels = isLine && spec.series.length > 1 && spec.series.length <= 4;
      return {
        type: isLine ? 'line' : 'bar',
        data: { labels: spec.labels, datasets: datasets },
        options: {
          indexAxis: horizontal ? 'y' : 'x',
          animation: { duration: 300 },
          interaction: isLine ? { mode: 'index', intersect: false } : { mode: 'nearest', intersect: true },
          scales: horizontal ? { x: valueAxis, y: catAxis } : { x: catAxis, y: valueAxis },
          layout: { padding: { top: 4, right: endLabels ? 96 : (horizontal && showValues ? 56 : 16), bottom: 4, left: 4 } },
          plugins: {
            lqValues: { enabled: showValues, stacked: stacked, totals: totals, format: fShort },
            lqEndLabels: { enabled: endLabels },
            lqCrosshair: { enabled: isLine },
            tooltip: { callbacks: {
              title: (items) => (items.length ? spec.labels[items[0].dataIndex] : ''),
              label: (item) => {
                const raw = item.dataset.lqRaw[item.dataIndex];
                const share = totals[item.dataIndex] && spec.series.length > 1 && !spec.valuePct ? '（' + pctText((raw || 0) / totals[item.dataIndex]) + '）' : '';
                return item.dataset.label + '：' + (raw === null ? '—' : fFull(raw)) + share;
              },
              footer: (items) => (spec.series.length > 1 && !spec.valuePct && !spec.valueDate && items.length ? '合計：' + fFull(totals[items[0].dataIndex]) : '')
            } }
          }
        }
      };
    },

    _donut(spec) {
      const p = ChartPalette.read();
      const s = spec.series[0];
      const values = s.values.map((v) => (v === null || v < 0 ? 0 : v));
      const total = values.reduce((a, v) => a + v, 0);
      const colors = spec.labels.map((l, i) => ChartPalette.color(i, spec.others[i]));
      const fFull = ChartRenderer.valueFormat(spec, false);
      return {
        type: 'doughnut',
        data: { labels: spec.labels, datasets: [{ label: s.name, data: values, backgroundColor: colors, borderColor: p.surface, borderWidth: 2, lqBase: colors }] },
        map: () => 0,
        options: {
          cutout: '58%',
          animation: { duration: 300 },
          plugins: {
            legend: { labels: { usePointStyle: true, pointStyle: 'rectRounded', boxWidth: 10, boxHeight: 10, padding: 10,
              generateLabels: (chart) => spec.labels.map((label, i) => ({ text: ChartRenderer.clip(label, 14) + '  ' + pctText(total ? values[i] / total : 0),
                fillStyle: colors[i], strokeStyle: colors[i], fontColor: p.text, hidden: !chart.getDataVisibility(i), index: i, pointStyle: 'rectRounded' })) } },
            tooltip: { callbacks: { label: (item) => item.label + '：' + fFull(s.values[item.dataIndex]) + '（' + pctText(total ? values[item.dataIndex] / total : 0) + '）' } }
          }
        }
      };
    },

    /* ---- ヒストグラム ---- */
    _hist(spec) {
      const p = ChartPalette.read();
      const overlay = spec.overlay;
      const datasets = spec.series.map((s, i) => {
        const color = ChartPalette.color(i, s.other);
        return { label: s.name, data: s.values, backgroundColor: overlay ? ChartPalette.alpha(color, p.overlayAlpha) : color,
          borderColor: p.surface, borderWidth: 1, borderRadius: 0, barPercentage: 1, categoryPercentage: 1, grouped: false, lqBase: color, lqRaw: s.values };
      });
      const b = spec.bins;
      const toIndex = (v) => (v - b.lo) / b.width - 0.5;
      const colorOf = { mean: p.mean, median: p.median };
      return {
        type: 'bar',
        data: { labels: spec.labels, datasets: datasets },
        options: {
          animation: { duration: 300 },
          interaction: { mode: 'index', intersect: false },
          scales: {
            x: ChartRenderer._scale(p, { grid: { display: false }, title: ChartRenderer._title(spec.valueLabel), ticks: { color: p.text, autoSkip: true, maxRotation: 45 } }),
            y: ChartRenderer._scale(p, { beginAtZero: true, title: ChartRenderer._title('件数'), ticks: { color: p.text, precision: 0, callback: (v) => Stats.shortNumber(v) } })
          },
          plugins: {
            lqRefLines: { toIndex: toIndex, lines: spec.lines.map((l) => ({ value: l.value, label: l.label, color: colorOf[l.role], dash: l.role === 'median' ? [5, 4] : [] })) },
            tooltip: { callbacks: {
              title: (items) => (items.length ? spec.ranges[items[0].dataIndex] : ''),
              label: (item) => item.dataset.label + '：' + Stats.fullNumber(item.raw) + ' 件'
            } }
          }
        }
      };
    },

    /* ---- 箱ひげ・バイオリン ---- */
    _box(spec) {
      const p = ChartPalette.read();
      const color = ChartPalette.color(0);
      const labels = spec.groups.map((g) => [ChartRenderer.clip(g.name, LABEL_MAX), 'n=' + g.stats.n.toLocaleString('ja-JP') + (g.stats.n < 5 ? '（少数）' : '')]);
      const data = spec.groups.map((g) => g.values);
      const points = spec.points ? 2 : 0;
      const common = { label: spec.valueLabel, data: data, itemRadius: points, itemStyle: 'circle', itemBackgroundColor: ChartPalette.alpha(color, 0.45),
        itemBorderColor: 'rgba(0,0,0,0)', outlierRadius: 3, outlierBackgroundColor: ChartPalette.alpha(color, 0.6), outlierBorderColor: color,
        meanRadius: 0, coef: 1.5, lqBase: color };
      const datasets = [];
      if (spec.shape !== 'box') {
        datasets.push(Object.assign({}, common, { type: 'violin', backgroundColor: ChartPalette.alpha(color, spec.shape === 'both' ? p.areaAlpha * 1.6 : 0.35),
          borderColor: color, borderWidth: 1.5, barPercentage: 0.9, categoryPercentage: 0.9, itemRadius: spec.shape === 'both' ? 0 : points }));
      }
      if (spec.shape !== 'violin') {
        datasets.push(Object.assign({}, common, { type: 'boxplot', backgroundColor: ChartPalette.alpha(color, spec.shape === 'both' ? 0.55 : 0.3),
          borderColor: color, borderWidth: 1.5, medianColor: p.title, barPercentage: spec.shape === 'both' ? 0.18 : 0.5, categoryPercentage: 0.9,
          maxBarThickness: spec.shape === 'both' ? 18 : 64 }));
      }
      if (datasets.length === 2) datasets.forEach((d) => {
        d.grouped = false;
      });
      const f = (v) => Stats.fullNumber(v, 2);
      return {
        type: spec.shape === 'box' ? 'boxplot' : 'violin',
        data: { labels: labels, datasets: datasets },
        map: () => 0,
        options: {
          animation: { duration: 300 },
          /* バイオリンと箱ひげを重ねたときも、ポイントした列の要約を 1 回だけ出す */
          interaction: { mode: 'index', intersect: false },
          scales: {
            x: ChartRenderer._scale(p, { grid: { display: false }, title: ChartRenderer._title(spec.catTitle), ticks: { color: p.text } }),
            y: ChartRenderer._scale(p, { title: ChartRenderer._title(spec.valueLabel), ticks: { color: p.text, callback: (v) => Stats.shortNumber(v) } })
          },
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: {
              title: (items) => (items.length ? spec.groups[items[0].dataIndex].name : ''),
              label: (item) => {
                if (item.datasetIndex !== datasets.length - 1) return null;
                const s = spec.groups[item.dataIndex].stats;
                return ['件数：' + s.n.toLocaleString('ja-JP'), '最大：' + f(s.max), '上側の四分位：' + f(s.q3), '中央値：' + f(s.median),
                  '下側の四分位：' + f(s.q1), '最小：' + f(s.min), '平均：' + f(s.mean)];
              }
            } }
          }
        }
      };
    },

    /* ---- 散布図 ---- */
    _scatter(spec) {
      const p = ChartPalette.read();
      const total = spec.series.reduce((a, s) => a + s.points.length, 0);
      const dense = total > DENSE_POINTS;
      /* バブル図：値の大きさを円の面積に比例させる（半径は平方根） */
      const radius = (size) => Math.max(BUBBLE_MIN, Math.sqrt(size / (spec.maxSize || 1)) * BUBBLE_MAX);
      const datasets = spec.series.map((s, i) => {
        const color = ChartPalette.color(i, s.other);
        if (spec.bubble) {
          return { type: 'bubble', label: s.name, data: s.points.map((pt) => ({ x: pt.x, y: pt.y, r: radius(pt.s), s: pt.s })),
            backgroundColor: ChartPalette.alpha(color, 0.45), borderColor: color, borderWidth: 1, hoverBorderWidth: 2, lqBase: color };
        }
        return { label: s.name, data: s.points.map((pt) => ({ x: pt.x, y: pt.y })), backgroundColor: ChartPalette.alpha(color, dense ? p.overlayAlpha : 0.8),
          borderColor: p.surface, borderWidth: dense ? 0 : 1, pointRadius: dense ? p.pointDense : p.pointRadius, pointHoverRadius: p.pointRadius + 2, lqBase: color };
      });
      const map = (d) => d;
      const t = spec.trend;
      if (t) {
        const xs = [];
        spec.series.forEach((s) => s.points.forEach((pt) => xs.push(pt.x)));
        const lo = Math.min.apply(null, xs);
        const hi = Math.max.apply(null, xs);
        const line = [];
        const steps = spec.logx || spec.logy ? 40 : 1;
        for (let i = 0; i <= steps; i++) {
          const x = spec.logx ? Math.pow(10, Math.log10(lo) + (Math.log10(hi) - Math.log10(lo)) * i / steps) : lo + (hi - lo) * i / steps;
          const yl = t.intercept + t.slope * (spec.logx ? Math.log10(x) : x);
          line.push({ x: x, y: spec.logy ? Math.pow(10, yl) : yl });
        }
        datasets.push({ type: 'line', label: '回帰直線', data: line, borderColor: p.trend, borderWidth: p.lineWidth, pointRadius: 0, fill: false, lqTrend: true });
      }
      const xf = spec.xDate ? (v) => LQ.ValueParser.formatDate(v) : Stats.shortNumber;
      return {
        type: 'scatter',
        data: { datasets: datasets },
        map: map,
        options: {
          animation: total > QUIET_POINTS ? false : { duration: 300 },
          interaction: { mode: 'nearest', intersect: true },
          scales: {
            x: ChartRenderer._scale(p, { type: spec.logx ? 'logarithmic' : 'linear', title: ChartRenderer._title(spec.xLabel), ticks: { color: p.text, callback: (v) => xf(v) } }),
            y: ChartRenderer._scale(p, { type: spec.logy ? 'logarithmic' : 'linear', title: ChartRenderer._title(spec.yLabel), ticks: { color: p.text, callback: (v) => Stats.shortNumber(v) } })
          },
          plugins: {
            tooltip: { callbacks: {
              label: (item) => (item.dataset.lqTrend ? '回帰直線' : (spec.series.length > 1 ? item.dataset.label + '　' : '') +
                spec.xLabel + '：' + (spec.xDate ? LQ.ValueParser.formatDate(item.raw.x) : Stats.fullNumber(item.raw.x)) + '、' + spec.yLabel + '：' + Stats.fullNumber(item.raw.y) +
                (spec.bubble ? '、' + spec.sizeLabel + '：' + Stats.fullNumber(item.raw.s) : ''))
            } }
          }
        }
      };
    }
  };

  /* ---------------------------------------------------------------------
   * ChartCanvas：描画領域（キャンバス）。凡例にポイントすると、ほかの系列を薄くする。
   *   散布図・バブル図は、グラフの中をドラッグして範囲を囲むと、そこに入った行を handlers.select に渡す
   * ------------------------------------------------------------------- */
  class ChartCanvas {
    constructor() {
      this.canvas = h('canvas', { class: 'lq-chart__canvas', role: 'img' });
      this.box = h('div', { class: 'lq-chart__brush', hidden: true });
      this.el = h('div', { class: 'lq-chart__plot' }, [this.canvas, this.box]);
      this.chart = null;
      this.spec = null;
      this._select = null;
      this._quietUntil = 0;
      this._bindBrush();
    }

    /**
     * @param {object} spec 描く内容（title・subtitle を含む）
     * @param {{pick?:Function, hover?:Function, select?:Function}} handlers select：範囲選択（spec.brush のとき）
     */
    draw(spec, handlers) {
      this.destroy();
      this.spec = spec;
      const hd = handlers || {};
      this._select = spec.brush && spec.select && hd.select ? hd.select : null;
      this.el.classList.toggle('is-brushable', !!this._select);
      /* 範囲を囲んだ直後のクリックは、点の内訳を開かない */
      const pick = hd.pick ? (d, i) => {
        if (Date.now() < this._quietUntil) return;
        hd.pick(d, i);
      } : null;
      const config = ChartRenderer.config(spec, Object.assign({}, hd, { pick: pick }));
      this._legendHover(config);
      this.canvas.setAttribute('aria-label', spec.title || 'グラフ');
      this.chart = new global.Chart(this.canvas, config);
    }

    _pos(e) {
      const r = this.canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    _bindBrush() {
      let start = null;
      let moved = false;
      const clamp = (pt) => {
        const a = this.chart.chartArea;
        return { x: Math.min(a.right, Math.max(a.left, pt.x)), y: Math.min(a.bottom, Math.max(a.top, pt.y)) };
      };
      this.canvas.addEventListener('pointerdown', (e) => {
        if (!this._select || !this.chart || e.button !== 0) return;
        const pt = this._pos(e);
        const a = this.chart.chartArea;
        if (pt.x < a.left || pt.x > a.right || pt.y < a.top || pt.y > a.bottom) return;
        start = pt;
        moved = false;
        this.canvas.setPointerCapture(e.pointerId);
      });
      this.canvas.addEventListener('pointermove', (e) => {
        if (!start) return;
        const pt = clamp(this._pos(e));
        if (!moved && Math.abs(pt.x - start.x) < BRUSH_MIN && Math.abs(pt.y - start.y) < BRUSH_MIN) return;
        moved = true;
        /* 実行時に決まる位置だけは style で与える */
        const left = Math.min(start.x, pt.x) + this.canvas.offsetLeft;
        const top = Math.min(start.y, pt.y) + this.canvas.offsetTop;
        Object.assign(this.box.style, { left: left + 'px', top: top + 'px', width: Math.abs(pt.x - start.x) + 'px', height: Math.abs(pt.y - start.y) + 'px' });
        this.box.hidden = false;
      });
      const finish = (e, cancel) => {
        if (!start) return;
        const from = start;
        start = null;
        this.box.hidden = true;
        if (!moved || cancel || !this.chart) return;
        this._quietUntil = Date.now() + BRUSH_QUIET_MS;
        const to = clamp(this._pos(e));
        const sx = this.chart.scales.x;
        const sy = this.chart.scales.y;
        const xs = [sx.getValueForPixel(from.x), sx.getValueForPixel(to.x)].sort((a, b) => a - b);
        const ys = [sy.getValueForPixel(from.y), sy.getValueForPixel(to.y)].sort((a, b) => a - b);
        const hidden = this.spec.series.map((s, d) => !this.chart.isDatasetVisible(d));
        this._select(this.spec.select(xs[0], xs[1], ys[0], ys[1], hidden));
      };
      this.canvas.addEventListener('pointerup', (e) => finish(e, false));
      this.canvas.addEventListener('pointercancel', (e) => finish(e, true));
    }

    _legendHover(config) {
      if (config.type === 'doughnut') return;
      const legend = config.options.plugins.legend;
      const p = ChartPalette.read();
      const paint = (chart, focus) => {
        chart.data.datasets.forEach((ds, i) => {
          if (!ds.lqBase || ds.lqTrend) return;
          const dim = focus !== null && i !== focus;
          const base = ds.lqBase;
          if (ds.type === 'violin' || ds.type === 'boxplot') return;
          ds.borderColor = config.type === 'line' ? (dim ? ChartPalette.alpha(base, p.dimAlpha) : base) : ds.borderColor;
          if (config.type === 'line') ds.backgroundColor = ds.fill ? ChartPalette.alpha(base, dim ? p.areaAlpha / 3 : p.areaAlpha) : (dim ? ChartPalette.alpha(base, p.dimAlpha) : base);
          else ds.backgroundColor = dim ? ChartPalette.alpha(base, p.dimAlpha) : (ds.lqOverlay ? ChartPalette.alpha(base, p.overlayAlpha) : ds.lqFill || base);
        });
        chart.update('none');
      };
      config.data.datasets.forEach((ds) => {
        if (ds.lqBase && typeof ds.backgroundColor === 'string' && ds.backgroundColor !== ds.lqBase) ds.lqFill = ds.backgroundColor;
      });
      legend.onHover = (e, item, leg) => paint(leg.chart, item.datasetIndex);
      legend.onLeave = (e, item, leg) => paint(leg.chart, null);
    }

    resize() {
      if (this.chart) this.chart.resize();
    }

    destroy() {
      if (this.chart) this.chart.destroy();
      this.chart = null;
    }

    /** PNG（2 倍の解像度で描き直してから取り出す） */
    toBlob() {
      return new Promise((resolve, reject) => {
        if (!this.chart) {
          reject(new Error('グラフがありません'));
          return;
        }
        const chart = this.chart;
        const ratio = chart.options.devicePixelRatio;
        chart.options.devicePixelRatio = Math.max(2, global.devicePixelRatio || 1);
        chart.resize();
        chart.update('none');
        chart.canvas.toBlob((blob) => {
          chart.options.devicePixelRatio = ratio;
          chart.resize();
          if (blob) resolve(blob);
          else reject(new Error('画像にできませんでした'));
        }, 'image/png');
      });
    }
  }

  LQ.ChartLibrary = ChartLibrary;
  LQ.ChartPalette = ChartPalette;
  LQ.ChartRenderer = ChartRenderer;
  LQ.ChartCanvas = ChartCanvas;
})(window);
