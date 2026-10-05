/* =========================================================================
 * LightQuery - lq-chart-data.js
 * グラフのデータ：抽出結果（または ① の全行）・ピボットの結果から、描画ライブラリに依存しない「描く内容」を作る。
 *   ・項目ごとに集計する種類（棒・折れ線・ドーナツ）は、ピボットと同じ計算（LQ.Pivot.compute）を使う
 *   ・行の値をそのまま描く種類（ヒストグラム・箱ひげ・散布図）は、行ごとに値を読む
 *   ・どの種類も、棒や点を押したときの内訳（そこに入った行）を返せる
 *   描く内容 = {kind:'category'|'hist'|'box'|'scatter', ..., notes:[], pick(d, i) → 内訳}
 *
 * （下の区切りごとに独立した部品）
 *   SeriesTable … ピボットの結果 → 項目 × 系列の表（上位 N 件・その他・入れ替え）
 *   RowReader   … 行の値の読み取り（数値・日付・グループ）
 *   ChartData   … 種類ごとの組み立て
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Util = LQ.Util;
  const Stats = LQ.ChartStats;
  const Normalizer = LQ.Normalizer;
  const ValueParser = LQ.ValueParser;
  const collator = new Intl.Collator('ja', { numeric: true });
  const fmt = Util.formatInt;

  /* 系列の上限：棒・折れ線は 8 色、点や面が重なるもの（散布図・重ねたヒストグラム）は 3 色。超える分は「その他」 */
  const MAX_SERIES = 8;
  const MAX_OVERLAP = 3;
  /* 上位 N 件の自動：項目がこれより多ければ上位 10 件にする */
  const AUTO_TOP_OVER = 15;
  const AUTO_TOP = 10;
  const DONUT_TOP = 7;
  const MAX_GROUPS = 30;
  const MAX_POINTS = 20000;
  const AUTO_POINTS_MAX = 300;
  const OTHER = 'その他';
  const BLANK = '（空欄）';
  const TIME_GRAINS = ['year', 'fy', 'quarter', 'month', 'day', 'weekday'];

  /* ---------------------------------------------------------------------
   * SeriesTable：ピボットの結果 → {cats:[{label, cells}], series:[{name, cells}], value(ci, si)}
   *   cells：その項目・系列に入るピボットのセル（行・列の元の番号）。「その他」は複数のセルをまとめる
   * ------------------------------------------------------------------- */
  const SeriesTable = {
    /**
     * @param {LQ.PivotModel} model
     * @param {number} vi 描く値の番号
     * @param {{swap?:boolean, top?:*, sort?:'keep'|'value'|'label', timeLike?:boolean, maxSeries?:number, single?:boolean}} o
     */
    from(model, vi, o) {
      const v = model.values[vi];
      const additive = (v.fn === 'count' || v.fn === 'sum') && (v.show === 'value' || v.show === 'pctTotal');
      const join = (labels) => labels.join(' / ');
      let cats = model.rows.map((r) => ({ label: model.rowHeaders.length ? join(r.labels) : '全体', idx: [r.i] }));
      let sers = model.cols.map((c) => ({ name: model.colHeaders.length ? join(c.labels) : v.label, idx: [c.i] }));
      let catTitle = model.rowHeaders.join(' / ');
      let serTitle = model.colHeaders.join(' / ');
      if (o.swap && model.colHeaders.length) {
        const t = cats;
        cats = sers.map((s) => ({ label: s.name, idx: s.idx }));
        sers = t.map((c) => ({ name: c.label, idx: c.idx }));
        const tt = catTitle;
        catTitle = serTitle;
        serTitle = tt;
      }
      const swapped = !!(o.swap && model.colHeaders.length);
      const cell = (ci, si) => (swapped ? { r: sers[si].idx, c: cats[ci].idx } : { r: cats[ci].idx, c: sers[si].idx });
      const raw = (ci, si) => {
        const at = cell(ci, si);
        let sum = null;
        at.r.forEach((r) => at.c.forEach((c) => {
          const x = model.get(r, c, vi).value;
          if (x !== null) sum = (sum || 0) + x;
        }));
        return sum;
      };
      let matrix = cats.map((c, ci) => sers.map((s, si) => raw(ci, si)));
      const notes = [];
      const total = (row) => row.reduce((a, x) => a + Math.abs(x || 0), 0);
      /* 項目の並び（日付などの順序のあるものは並べ替えない） */
      if (o.sort === 'value' && !o.timeLike) {
        const order = cats.map((c, ci) => ci).sort((a, b) => total(matrix[b]) - total(matrix[a]) || a - b);
        cats = order.map((ci) => cats[ci]);
        matrix = order.map((ci) => matrix[ci]);
      } else if (o.sort === 'label' && !o.timeLike) {
        const order = cats.map((c, ci) => ci).sort((a, b) => collator.compare(cats[a].label, cats[b].label));
        cats = order.map((ci) => cats[ci]);
        matrix = order.map((ci) => matrix[ci]);
      }
      /* 上位 N 件（順序のある項目では行わない） */
      const n = o.top === 'auto' ? (cats.length > AUTO_TOP_OVER ? AUTO_TOP : 0) : Number(o.top) || 0;
      if (n && cats.length > n && !o.timeLike) {
        const rank = cats.map((c, ci) => ci).sort((a, b) => total(matrix[b]) - total(matrix[a]) || a - b);
        const keep = new Set(rank.slice(0, n));
        const rest = rank.slice(n);
        const keptIdx = cats.map((c, ci) => ci).filter((ci) => keep.has(ci));
        const nextCats = keptIdx.map((ci) => cats[ci]);
        const nextMatrix = keptIdx.map((ci) => matrix[ci]);
        if (additive) {
          nextCats.push({ label: OTHER + '（' + rest.length + ' 件）', idx: [].concat.apply([], rest.map((ci) => cats[ci].idx)), other: true });
          nextMatrix.push(sers.map((s, si) => rest.reduce((a, ci) => a + (matrix[ci][si] || 0), 0)));
          notes.push('値の大きい上位 ' + n + ' 件を表示し、残り ' + rest.length + ' 件は「' + OTHER + '」にまとめました');
        } else {
          notes.push('値の大きい上位 ' + n + ' 件を表示しています（ほか ' + rest.length + ' 件は、' + v.label + ' を足し合わせられないため省きました）');
        }
        cats = nextCats;
        matrix = nextMatrix;
      }
      /* 系列の上限 */
      const maxS = o.single ? 1 : (o.maxSeries || MAX_SERIES);
      if (sers.length > maxS) {
        const sTotal = (si) => matrix.reduce((a, row) => a + Math.abs(row[si] || 0), 0);
        const rank = sers.map((s, si) => si).sort((a, b) => sTotal(b) - sTotal(a) || a - b);
        const keepN = o.single ? 1 : maxS - (additive ? 1 : 0);
        const kept = rank.slice(0, keepN).sort((a, b) => a - b);
        const rest = rank.slice(keepN);
        const nextSers = kept.map((si) => sers[si]);
        const nextMatrix = matrix.map((row) => kept.map((si) => row[si]));
        if (o.single && additive) {
          nextSers[0] = { name: v.label, idx: [].concat.apply([], sers.map((s) => s.idx)) };
          matrix.forEach((row, ci) => {
            nextMatrix[ci][0] = row.reduce((a, x) => a + (x || 0), 0);
          });
        } else if (additive) {
          nextSers.push({ name: OTHER + '（' + rest.length + ' 件）', idx: [].concat.apply([], rest.map((si) => sers[si].idx)), other: true });
          matrix.forEach((row, ci) => nextMatrix[ci].push(rest.reduce((a, si) => a + (row[si] || 0), 0)));
          notes.push((serTitle || '系列') + 'は値の大きい ' + keepN + ' 件を色分けし、残り ' + rest.length + ' 件は「' + OTHER + '」にまとめました');
        } else {
          notes.push((serTitle || '系列') + 'は値の大きい ' + keepN + ' 件だけを描いています（ほか ' + rest.length + ' 件は省きました）');
        }
        sers = nextSers;
        matrix = nextMatrix;
      }
      return {
        cats: cats, series: sers, matrix: matrix, catTitle: catTitle, serTitle: serTitle, value: v, notes: notes,
        /** 内訳：押した棒・点に入った行 */
        entry(ci, si) {
          const cat = cats[ci];
          const ser = sers[si];
          if (!cat || !ser) return null;
          const list = [];
          const rs = swapped ? ser.idx : cat.idx;
          const cs = swapped ? cat.idx : ser.idx;
          rs.forEach((r) => cs.forEach((c) => model.members(r, c).forEach((m) => list.push(m))));
          const by = [];
          if (catTitle) by.push({ name: catTitle, value: cat.label });
          if (serTitle && sers.length > 0) by.push({ name: serTitle, value: ser.name });
          return Object.assign({ by: by }, model.memberKind === 'src' ? { src: list } : { keys: list });
        },
        /** ピボットの表のセル（表とグラフの対応づけ。「その他」は null） */
        cellAt(ci, si) {
          const cat = cats[ci];
          const ser = sers[si];
          if (!cat || !ser || cat.other || ser.other) return null;
          return swapped ? { r: ser.idx[0], c: cat.idx[0] } : { r: cat.idx[0], c: ser.idx[0] };
        }
      };
    }
  };

  /* ---------------------------------------------------------------------
   * RowReader：表示中の行から値を読む（数値・日付・グループの名前）
   * ------------------------------------------------------------------- */
  class RowReader {
    constructor(view) {
      this.view = view;
      this.norm = new Normalizer(view.rules);
      this.missing = [];
    }

    def(key) {
      const d = this.view.resolve(key);
      if (d && d.available) return d;
      this.missing.push(LQ.ResultView.nameOf(key));
      return null;
    }

    raw(def, k) {
      return this.view.rawValue(def, k);
    }

    number(def, k) {
      return ValueParser.parseNumber(this.raw(def, k));
    }

    /** 数値（日付の列なら日付をミリ秒で） */
    numeric(def, k, isDate) {
      const raw = this.raw(def, k);
      return isDate ? ValueParser.parseDate(raw) : ValueParser.parseNumber(raw);
    }

    /** グループ：{key, label, sort} */
    group(def, grain, k) {
      const raw = this.raw(def, k);
      if (grain) {
        const b = LQ.DateGrain.bucket(raw, grain);
        return { key: b.label, label: b.label, sort: b.sort };
      }
      if (Normalizer.isBlank(raw)) return { key: '', label: BLANK, sort: Infinity };
      return { key: this.norm.text(raw), label: String(raw), sort: String(raw) };
    }

    /** 表示中の行を順に回す（k は結果の行番号） */
    each(fn) {
      const v = this.view;
      for (let i = 0; i < v.length; i++) fn(v.rowAt(i));
    }
  }

  /** グループの並び：日付は並び順の値、文字は五十音（数は数の順）。空欄は最後 */
  function compareGroups(a, b) {
    if (a.sort === b.sort) return 0;
    if (typeof a.sort === 'number' && typeof b.sort === 'number') return a.sort - b.sort;
    if (typeof a.sort === 'number') return a.sort === Infinity ? 1 : -1;
    if (typeof b.sort === 'number') return b.sort === Infinity ? -1 : 1;
    return collator.compare(a.sort, b.sort);
  }

  /**
   * グループごとに集めた行を、多い順に limit 件まで色分けし、残りを「その他」（灰色）にまとめる（並びはグループの順）
   * @param {Map} map key → {label, sort, rows:[]}
   */
  function capGroups(map, limit, title, notes) {
    let list = Array.from(map.values());
    if (list.length > limit) {
      list.sort((a, b) => b.rows.length - a.rows.length);
      const rest = list.slice(limit);
      list = list.slice(0, limit);
      const other = { label: OTHER + '（' + rest.length + ' 件）', sort: Infinity, other: true, rows: [] };
      rest.forEach((g) => g.rows.forEach((x) => other.rows.push(x)));
      notes.push(title + 'は行の多い ' + limit + ' 件を色分けし、残り ' + rest.length + ' 件は「' + OTHER + '」（灰色）にまとめました（重なる点や面は 3 色までが見分けやすいため）');
      list.sort(compareGroups);
      list.push(other);
      return list;
    }
    return list.sort(compareGroups);
  }

  function skippedNote(name, count) {
    return count ? name + '：数値として読めない値・空欄の ' + fmt(count) + ' 行を除きました' : null;
  }

  /* ---------------------------------------------------------------------
   * ChartData
   * ------------------------------------------------------------------- */
  const ChartData = {
    MAX_POINTS: MAX_POINTS,

    /**
     * グラフタブのグラフ 1 枚を組み立てる。
     * @param {LQ.ResultView} view
     * @param {object} chart ChartSettings
     * @param {Function} kindOf key → 'number' | 'date' | 'text'
     * @returns {object} 描く内容（描けないときは {error, message}）
     */
    build(view, chart, kindOf) {
      const type = LQ.ChartTypes.get(chart.type);
      const fit = LQ.ChartTypes.fit(type, chart.slots);
      if (!fit.ok) return { error: 'fit', message: fit.reason, slot: fit.slot };
      if (type.family === 'agg') return ChartData._agg(view, chart, type, kindOf);
      if (type.id === 'hist') return ChartData._hist(view, chart);
      if (type.id === 'box') return ChartData._box(view, chart);
      return ChartData._scatter(view, chart, kindOf);
    },

    /** 項目ごとに集計する種類：ピボットと同じ計算をしてから描く形にする */
    _agg(view, chart, type, kindOf) {
      const x = chart.slots.x[0];
      const color = type.slots.some((s) => s.id === 'color') ? chart.slots.color[0] : null;
      const value = LQ.ChartSettings.valueItem(chart);
      const settings = LQ.PivotSettings.clean({
        target: chart.target,
        rows: [{ key: x.key, grain: x.grain }],
        cols: color ? [{ key: color.key, grain: color.grain }] : [],
        values: [{ key: value.key, fn: value.fn || 'sum', show: 'value' }],
        totals: { right: false, bottom: false },
        sort: { by: 'label', dir: 'asc', value: 0 }
      });
      const model = LQ.Pivot.compute(view, settings);
      if (model.error) return { error: 'pivot', message: model.message.replace('表にできません', 'グラフにできません').replace('「行」に置いてください（行には上限がありません）', '「' + type.slots[0].label + '」に置いてください') };
      const timeLike = TIME_GRAINS.indexOf(x.grain) >= 0 || kindOf(x.key) === 'date';
      const sort = chart.opts.sort === 'auto' ? (timeLike ? 'keep' : (type.mode === 'line' ? 'label' : 'value')) : chart.opts.sort;
      const spec = ChartData.fromModel(model, 0, {
        mode: type.mode, orient: type.orient, arrange: chart.opts.arrange, area: chart.opts.area, swap: false,
        top: type.mode === 'line' ? 0 : chart.opts.top, sort: sort, timeLike: timeLike, showValues: chart.opts.labels
      });
      spec.missing = model.missing;
      spec.notes = model.notes.concat(spec.notes);
      return spec;
    },

    /**
     * ピボットの結果 → 項目 × 系列の描く内容
     * @param {LQ.PivotModel} model
     * @param {number} vi 描く値
     * @param {{mode:string, orient:string, arrange:string, area?:boolean, swap?:boolean, top:*, sort:string, timeLike:boolean, showValues:boolean}} o
     */
    fromModel(model, vi, o) {
      const v = model.values[vi] || model.values[0];
      const index = model.values.indexOf(v);
      /* ドーナツは色が 8 色までなので、項目が多ければ上位 7 件＋その他にする */
      const donut = o.mode === 'donut';
      const catCount = o.swap && model.colHeaders.length ? model.cols.length : model.rows.length;
      let top = o.top;
      if (donut && (top === 'auto' || !top || top > DONUT_TOP)) top = catCount > DONUT_TOP + 1 ? DONUT_TOP : 0;
      const table = SeriesTable.from(model, index, { swap: o.swap, top: top, sort: donut && o.sort === 'keep' ? 'value' : o.sort,
        timeLike: donut ? false : o.timeLike, single: donut });
      const arrange = o.mode === 'donut' ? 'group' : LQ.ChartAdvisor.arrangeFor(o.arrange, table.series.length);
      const pct = v.show !== 'value' || arrange === 'pct';
      const dateValue = !pct && (v.fn === 'min' || v.fn === 'max') && model.rows.some((r) => model.cols.some((c) => model.get(r.i, c.i, index).date));
      const notes = table.notes.slice();
      if (dateValue) notes.push(v.label + 'は日付のため、棒の長さは日付の新しさを表します');
      return {
        kind: 'category',
        mode: o.mode,
        orient: o.orient,
        arrange: arrange,
        area: !!o.area,
        labels: table.cats.map((c) => c.label),
        others: table.cats.map((c) => !!c.other),
        series: table.series.map((s, si) => ({ name: s.name, other: !!s.other, values: table.matrix.map((row) => row[si]) })),
        catTitle: table.catTitle,
        serTitle: table.serTitle,
        valueLabel: v.label,
        valuePct: v.show !== 'value',
        valueDate: !!dateValue,
        valueDigits: v.fn === 'avg' || v.fn === 'stdev' ? 2 : 6,
        timeLike: o.timeLike,
        showValues: o.showValues !== false,
        rowCount: model.rowCount,
        notes: notes,
        missing: [],
        pick: (d, i) => table.entry(i, d),
        cellAt: (d, i) => table.cellAt(i, d)
      };
    },

    /** ヒストグラム：区間ごとの件数（色分けは 3 つまで重ねる） */
    _hist(view, chart) {
      const rd = new RowReader(view);
      const xi = chart.slots.x[0];
      const ci = chart.slots.color[0] || null;
      const xd = rd.def(xi.key);
      const cd = ci ? rd.def(ci.key) : null;
      if (!xd) return ChartData._missing(rd);
      const notes = [];
      const groups = new Map();
      const all = [];
      let skipped = 0;
      rd.each((k) => {
        const val = rd.number(xd, k);
        if (Number.isNaN(val)) {
          skipped++;
          return;
        }
        const g = cd ? rd.group(cd, ci.grain, k) : { key: '', label: '全体', sort: 0 };
        if (!groups.has(g.key)) groups.set(g.key, { label: g.label, sort: g.sort, rows: [] });
        groups.get(g.key).rows.push({ v: val, k: k });
        all.push(val);
      });
      if (!all.length) return { error: 'empty', message: '「' + LQ.ResultView.nameOf(xi.key) + '」に数値がありません（' + fmt(skipped) + ' 行はすべて数値として読めないか空欄です）。' };
      const list = capGroups(groups, cd ? MAX_OVERLAP : 1, LQ.ResultView.nameOf(cd ? ci.key : xi.key), notes);
      const sorted = Stats.sorted(all);
      const b = Stats.bins(sorted, chart.opts.bins);
      const series = list.map((g) => {
        const counts = new Array(b.count).fill(0);
        const members = [];
        for (let i = 0; i < b.count; i++) members.push([]);
        g.rows.forEach((x) => {
          const at = Stats.binOf(x.v, b);
          counts[at]++;
          members[at].push(x.k);
        });
        return { name: g.label, other: !!g.other, values: counts, members: members };
      });
      const sum = Stats.summary(sorted);
      const name = LQ.ResultView.nameOf(xi.key);
      const sk = skippedNote(name, skipped);
      if (sk) notes.push(sk);
      const edge = (i) => b.lo + i * b.width;
      const labels = [];
      for (let i = 0; i < b.count; i++) labels.push(Stats.shortNumber(edge(i)) + '–' + Stats.shortNumber(edge(i + 1)));
      return {
        kind: 'hist',
        labels: labels,
        ranges: labels.map((l, i) => Stats.fullNumber(edge(i)) + ' 以上 ' + Stats.fullNumber(edge(i + 1)) + (i === b.count - 1 ? ' 以下' : ' 未満')),
        bins: b,
        series: series,
        overlay: series.length > 1,
        lines: chart.opts.lines ? [{ value: sum.mean, label: '平均 ' + Stats.roundedNumber(sum.mean), role: 'mean' },
          { value: sum.median, label: '中央値 ' + Stats.roundedNumber(sum.median), role: 'median' }] : [],
        summary: sum,
        valueLabel: name,
        serTitle: cd ? LQ.ResultView.nameOf(ci.key) : '',
        rowCount: all.length,
        notes: notes,
        missing: rd.missing,
        pick: (d, i) => {
          const s = series[d];
          if (!s) return null;
          const by = [{ name: name, value: labels[i] }];
          if (cd) by.push({ name: LQ.ResultView.nameOf(ci.key), value: s.name });
          return { by: by, keys: s.members[i].slice() };
        }
      };
    },

    /** 箱ひげ・バイオリン：グループごとの値 */
    _box(view, chart) {
      const rd = new RowReader(view);
      const yi = chart.slots.y[0];
      const xi = chart.slots.x[0] || null;
      const yd = rd.def(yi.key);
      const xd = xi ? rd.def(xi.key) : null;
      if (!yd) return ChartData._missing(rd);
      const notes = [];
      const groups = new Map();
      let skipped = 0;
      let total = 0;
      rd.each((k) => {
        const val = rd.number(yd, k);
        if (Number.isNaN(val)) {
          skipped++;
          return;
        }
        const g = xd ? rd.group(xd, xi.grain, k) : { key: '', label: '全体', sort: 0 };
        if (!groups.has(g.key)) groups.set(g.key, { label: g.label, sort: g.sort, rows: [] });
        groups.get(g.key).rows.push({ v: val, k: k });
        total++;
      });
      const name = LQ.ResultView.nameOf(yi.key);
      if (!total) return { error: 'empty', message: '「' + name + '」に数値がありません（' + fmt(skipped) + ' 行はすべて数値として読めないか空欄です）。' };
      let list = Array.from(groups.values()).sort(compareGroups);
      if (list.length > MAX_GROUPS) {
        list = list.sort((a, b) => b.rows.length - a.rows.length).slice(0, MAX_GROUPS).sort(compareGroups);
        notes.push('グループが ' + fmt(groups.size) + ' 件あるため、行の多い ' + MAX_GROUPS + ' 件を描いています');
      }
      const out = list.map((g) => {
        const values = g.rows.map((x) => x.v);
        return { name: g.label, values: values, members: g.rows.map((x) => x.k), stats: Stats.summary(Stats.sorted(values)) };
      });
      if (chart.opts.groupSort === 'median') out.sort((a, b) => b.stats.median - a.stats.median);
      const few = out.filter((g) => g.stats.n < 5).length;
      if (few) notes.push('5 件未満のグループが ' + few + ' 件あります（形は参考程度に見てください）');
      const sk = skippedNote(name, skipped);
      if (sk) notes.push(sk);
      const points = chart.opts.points === 'on' || (chart.opts.points === 'auto' && total <= AUTO_POINTS_MAX);
      return {
        kind: 'box',
        shape: chart.opts.shape,
        points: points,
        groups: out,
        labels: out.map((g) => g.name),
        valueLabel: name,
        catTitle: xd ? LQ.ResultView.nameOf(xi.key) : '',
        rowCount: total,
        notes: notes,
        missing: rd.missing,
        pick: (d, i) => {
          const g = out[i];
          if (!g) return null;
          return { by: xd ? [{ name: LQ.ResultView.nameOf(xi.key), value: g.name }] : [], keys: g.members.slice() };
        }
      };
    },

    /** 散布図：1 行＝1 点（多いときは描く点だけを間引く。統計は全点） */
    _scatter(view, chart, kindOf) {
      const rd = new RowReader(view);
      const xi = chart.slots.x[0];
      const yi = chart.slots.y[0];
      const ci = chart.slots.color[0] || null;
      const xd = rd.def(xi.key);
      const yd = rd.def(yi.key);
      const cd = ci ? rd.def(ci.key) : null;
      if (!xd || !yd) return ChartData._missing(rd);
      const xDate = kindOf(xi.key) === 'date';
      const logx = chart.opts.logx && !xDate;
      const logy = chart.opts.logy;
      const notes = [];
      const groups = new Map();
      const xs = [];
      const ys = [];
      let skipped = 0;
      let nonPositive = 0;
      rd.each((k) => {
        const x = rd.numeric(xd, k, xDate);
        const y = rd.number(yd, k);
        if (Number.isNaN(x) || Number.isNaN(y)) {
          skipped++;
          return;
        }
        if ((logx && x <= 0) || (logy && y <= 0)) {
          nonPositive++;
          return;
        }
        const g = cd ? rd.group(cd, ci.grain, k) : { key: '', label: '全体', sort: 0 };
        if (!groups.has(g.key)) groups.set(g.key, { label: g.label, sort: g.sort, rows: [] });
        groups.get(g.key).rows.push({ x: x, y: y, k: k });
        xs.push(x);
        ys.push(y);
      });
      if (!xs.length) return { error: 'empty', message: '2 つの列の両方に数値がある行がありません（' + fmt(skipped) + ' 行は数値として読めないか空欄です）。' };
      const list = capGroups(groups, cd ? MAX_OVERLAP : 1, cd ? LQ.ResultView.nameOf(ci.key) : '', notes);
      const ratio = Math.min(1, MAX_POINTS / xs.length);
      if (ratio < 1) notes.push('点が ' + fmt(xs.length) + ' 個あるため、描く点を約 ' + fmt(MAX_POINTS) + ' 個に間引いています（相関係数・回帰直線は全点で計算）');
      const series = list.map((g) => ({ name: g.label, other: !!g.other, points: Stats.thin(g.rows, Math.max(1, Math.round(g.rows.length * ratio))) }));
      const reg = Stats.regression(logx ? xs.map(Math.log10) : xs, logy ? ys.map(Math.log10) : ys);
      const sk = skippedNote(LQ.ResultView.nameOf(xi.key) + '・' + LQ.ResultView.nameOf(yi.key), skipped);
      if (sk) notes.push(sk);
      if (nonPositive) notes.push('対数の軸では 0 以下の値を描けないため、' + fmt(nonPositive) + ' 行を除きました');
      return {
        kind: 'scatter',
        series: series,
        xDate: xDate,
        logx: logx,
        logy: logy,
        xLabel: ChartData._itemName(xi),
        yLabel: ChartData._itemName(yi),
        serTitle: cd ? LQ.ResultView.nameOf(ci.key) : '',
        trend: chart.opts.trend && reg && !xDate ? reg : null,
        regression: reg,
        rowCount: xs.length,
        notes: notes,
        missing: rd.missing,
        pick: (d, i) => {
          const s = series[d];
          const p = s && s.points[i];
          if (!p) return null;
          return { by: [{ name: ChartData._itemName(xi), value: xDate ? ValueParser.formatDate(p.x) : Stats.fullNumber(p.x) },
            { name: ChartData._itemName(yi), value: Stats.fullNumber(p.y) }], keys: [p.k] };
        }
      };
    },

    _itemName(item) {
      return LQ.ResultView.nameOf(item.key);
    },

    _missing(rd) {
      return { error: 'missing', message: '次の列が今の対象にないため描けません：' + rd.missing.join('、') + '。対象を切り替えるか、置き場所の列を入れ替えてください。' };
    }
  };

  LQ.SeriesTable = SeriesTable;
  LQ.ChartData = ChartData;
})(window);
