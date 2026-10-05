/* =========================================================================
 * LightQuery - lq-chart-stats.js
 * グラフ用の計算（画面に依存しない）：並べ替え済みの数値の要約・四分位・区間（ヒストグラム）・回帰・
 *   きりのよい数・軸の数値の短い書き方（万・億）・点の間引き
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;

  /* 区間の数の範囲（自動のときも手動のときもこの範囲に収める） */
  const BINS_MIN = 3;
  const BINS_MAX = 60;
  const NICE_STEPS = [1, 2, 2.5, 5, 10];

  const ChartStats = {
    BINS_MIN: BINS_MIN,
    BINS_MAX: BINS_MAX,

    /** 小さい順に並べた新しい配列 */
    sorted(values) {
      return Float64Array.from(values).sort();
    },

    /** 並べ替え済みの配列の分位点（Excel の QUARTILE.INC・PERCENTILE.INC と同じ線形補間） */
    quantile(sorted, p) {
      const n = sorted.length;
      if (!n) return NaN;
      const pos = (n - 1) * p;
      const lo = Math.floor(pos);
      const hi = Math.ceil(pos);
      return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
    },

    /**
     * 要約（件数・平均・標準偏差・最小・四分位・中央値・最大）
     * @param {Float64Array} sorted 並べ替え済み
     */
    summary(sorted) {
      const n = sorted.length;
      if (!n) return { n: 0, mean: NaN, sd: NaN, min: NaN, q1: NaN, median: NaN, q3: NaN, max: NaN };
      let mean = 0;
      let m2 = 0;
      for (let i = 0; i < n; i++) {
        const d = sorted[i] - mean;
        mean += d / (i + 1);
        m2 += d * (sorted[i] - mean);
      }
      return {
        n: n,
        mean: mean,
        sd: n > 1 ? Math.sqrt(m2 / (n - 1)) : NaN,
        min: sorted[0],
        q1: ChartStats.quantile(sorted, 0.25),
        median: ChartStats.quantile(sorted, 0.5),
        q3: ChartStats.quantile(sorted, 0.75),
        max: sorted[n - 1]
      };
    },

    /** 1・2・2.5・5 × 10 のべき乗のうち、raw 以上で最も近い数（区間の幅・目盛り用） */
    niceStep(raw) {
      if (!(raw > 0) || !isFinite(raw)) return 1;
      const pow = Math.pow(10, Math.floor(Math.log10(raw)));
      const f = raw / pow;
      const step = NICE_STEPS.find((s) => s >= f - 1e-9) || 10;
      return step * pow;
    },

    /**
     * 区間の数の目安：Freedman–Diaconis（四分位範囲から幅を決める。外れ値に強い）。
     * 四分位範囲が 0 のときは Sturges の式
     */
    autoBinCount(sorted) {
      const n = sorted.length;
      if (n < 2) return 1;
      const range = sorted[n - 1] - sorted[0];
      if (!(range > 0)) return 1;
      const iqr = ChartStats.quantile(sorted, 0.75) - ChartStats.quantile(sorted, 0.25);
      const count = iqr > 0 ? range / (2 * iqr * Math.pow(n, -1 / 3)) : Math.log2(n) + 1;
      return Math.round(Math.min(BINS_MAX, Math.max(BINS_MIN, count)));
    },

    /**
     * 区間を作る。幅はきりのよい数、境目は幅の倍数にそろえる。
     * @param {Float64Array} sorted すべての系列をまとめた値（並べ替え済み）
     * @param {number} target 区間の数（0 なら自動）
     * @returns {{lo:number, width:number, count:number, auto:number}}
     */
    bins(sorted, target) {
      const n = sorted.length;
      const auto = ChartStats.autoBinCount(sorted);
      if (!n) return { lo: 0, width: 1, count: 0, auto: auto };
      const min = sorted[0];
      const max = sorted[n - 1];
      if (!(max > min)) {
        const width = ChartStats.niceStep(Math.abs(min) / 10 || 1);
        return { lo: min - width / 2, width: width, count: 1, auto: 1 };
      }
      const want = Math.min(BINS_MAX, Math.max(BINS_MIN, target || auto));
      const width = ChartStats.niceStep((max - min) / want);
      const lo = Math.floor(min / width) * width;
      const count = Math.max(1, Math.ceil((max - lo) / width + 1e-9));
      return { lo: lo, width: width, count: count, auto: auto };
    },

    /** 値が入る区間の番号（最後の区間は右端の値も含める） */
    binOf(value, b) {
      const i = Math.floor((value - b.lo) / b.width + 1e-9);
      return Math.max(0, Math.min(b.count - 1, i));
    },

    /**
     * 最小二乗法の回帰直線と相関係数（x・y は同じ長さ）
     * @returns {{n:number, slope:number, intercept:number, r:number, r2:number}|null} 計算できなければ null
     */
    regression(xs, ys) {
      const n = xs.length;
      if (n < 3) return null;
      let mx = 0;
      let my = 0;
      for (let i = 0; i < n; i++) {
        mx += xs[i];
        my += ys[i];
      }
      mx /= n;
      my /= n;
      let sxx = 0;
      let syy = 0;
      let sxy = 0;
      for (let i = 0; i < n; i++) {
        const dx = xs[i] - mx;
        const dy = ys[i] - my;
        sxx += dx * dx;
        syy += dy * dy;
        sxy += dx * dy;
      }
      if (!(sxx > 0) || !(syy > 0)) return null;
      const r = sxy / Math.sqrt(sxx * syy);
      const slope = sxy / sxx;
      return { n: n, slope: slope, intercept: my - slope * mx, r: r, r2: r * r };
    },

    /** 相関の強さを言葉にする（|r| の目安） */
    correlationWord(r) {
      const a = Math.abs(r);
      const dir = r > 0 ? '正の' : '負の';
      if (a >= 0.7) return '強い' + dir + '相関';
      if (a >= 0.4) return dir + '相関';
      if (a >= 0.2) return '弱い' + dir + '相関';
      return 'ほとんど相関なし';
    },

    /**
     * 点を間引く（描く点を max 個までにする。並びは保ったまま等間隔に選ぶ。統計の値は間引く前の全点で計算する）
     * @returns {Array} 間引いた配列（max 以下ならそのまま）
     */
    thin(list, max) {
      if (list.length <= max) return list;
      const out = new Array(max);
      const step = list.length / max;
      for (let i = 0; i < max; i++) out[i] = list[Math.floor(i * step)];
      return out;
    },

    /** 軸の目盛りの短い書き方（12,000 → 1.2万、350,000,000 → 3.5億） */
    shortNumber(v) {
      if (v === null || v === undefined || !isFinite(v)) return '';
      const a = Math.abs(v);
      const trim = (x) => String(Number(x.toPrecision(3)));
      if (a >= 1e12) return trim(v / 1e12) + '兆';
      if (a >= 1e8) return trim(v / 1e8) + '億';
      if (a >= 1e4) return trim(v / 1e4) + '万';
      return Number(v.toPrecision(6)).toLocaleString('ja-JP');
    },

    /** 平均などの書き方（大きい数は整数、小さい数は有効数字 4 桁） */
    roundedNumber(v) {
      if (v === null || v === undefined || !isFinite(v)) return '';
      return Math.abs(v) >= 100 ? Math.round(v).toLocaleString('ja-JP') : Number(v.toPrecision(4)).toLocaleString('ja-JP', { maximumFractionDigits: 6 });
    },

    /** 画面に出す正確な値（桁区切り。小数は digits 桁まで） */
    fullNumber(v, digits) {
      if (v === null || v === undefined || !isFinite(v)) return '';
      return v.toLocaleString('ja-JP', { maximumFractionDigits: digits === undefined ? 4 : digits });
    }
  };

  LQ.ChartStats = ChartStats;
})(window);
