/* =========================================================================
 * LightQuery - lq-pivot.js
 * ピボット：抽出結果（表示中の絞り込みを反映）または ① 元データの全行を、行 × 列 × 値 で集計する。
 *   ・行・列：列の値ごとにまとめる。日付の列は 年・年度（4 月始まり）・四半期・月・日・曜日 でまとめられる
 *   ・値：件数・合計・平均・最小・最大・標準偏差（標本 = Excel の STDEV.S）。表示は そのまま／総計・行・列に対する %
 *   ・特別な行「② の行」：② の 1 行＝1 グループ（一致が 0 件の行も出す）。以前の「② の行ごと」の集計
 *   ・結果は「行の項目 × 列の項目 × 値」の形（PivotModel）で持ち、表・出力・内訳・（次の段階の）グラフに使う
 *   設定は state.aggregate に持ち、以前の集計の設定（groupBy・measures・rank など）は読み込み時に置き換える。
 *
 * （下の区切りごとに独立した部品）
 *   PivotSettings … 設定の形・置き換え・言い表し
 *   DateGrain     … 日付のまとめ方
 *   PivotBuilder  … 行・列・値の集計（内訳用に、セルに入った行も記録する）
 *   Pivot         … 抽出結果／② の行ごとの計算と、出力用の表
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Util = LQ.Util;
  const ValueParser = LQ.ValueParser;
  const Normalizer = LQ.Normalizer;
  const collator = new Intl.Collator('ja', { numeric: true });

  /* ---------------------------------------------------------------------
   * PivotSettings
   *   {target:'result'|'source', rows:[{key, grain}], cols:[{key, grain}], values:[{key, fn, show}],
   *    totals:{right:boolean, bottom:boolean}, sort:{by:'label'|'value', dir:'asc'|'desc', value:number}}
   *   key は列のキー（s: / c: / m:）。件数（fn:'count'）は key なし。「② の行」は key = COND_ROW
   * ------------------------------------------------------------------- */
  const COND_ROW = 'x:condRow';
  const FUNCS = [
    { id: 'count', label: '件数', keyless: true, pct: true },
    { id: 'sum', label: '合計', pct: true },
    { id: 'avg', label: '平均' },
    { id: 'min', label: '最小', note: '数値がなく日付だけの列は、最も古い日付' },
    { id: 'max', label: '最大', note: '数値がなく日付だけの列は、最も新しい日付' },
    { id: 'stdev', label: '標準偏差', note: '標本標準偏差（Excel の STDEV.S）。値が 2 つ未満は空欄' }
  ];
  const SHOWS = [
    { id: 'value', label: 'そのまま', short: '' },
    { id: 'pctTotal', label: '総計に対する %', short: '総計比' },
    { id: 'pctRow', label: '行の中での %', short: '行比' },
    { id: 'pctCol', label: '列の中での %', short: '列比' }
  ];
  const GRAINS = [
    { id: 'year', label: '年' },
    { id: 'fy', label: '年度（4 月始まり）' },
    { id: 'quarter', label: '四半期' },
    { id: 'month', label: '月' },
    { id: 'day', label: '日' },
    { id: 'weekday', label: '曜日' }
  ];
  const LIMIT = { rows: 5, cols: 2, values: 12, colItems: 50 };
  const BLANK_LABEL = '（空欄）';
  const isKey = (k) => typeof k === 'string' && /^[scm]:/.test(k);

  function cleanField(f) {
    if (!f || typeof f !== 'object') return null;
    if (f.key !== COND_ROW && !isKey(f.key)) return null;
    return { key: f.key, grain: GRAINS.some((g) => g.id === f.grain) ? f.grain : null };
  }

  function cleanValue(v) {
    if (!v || typeof v !== 'object') return null;
    const fn = FUNCS.find((f) => f.id === v.fn);
    if (!fn || (!fn.keyless && !isKey(v.key))) return null;
    const show = SHOWS.some((s) => s.id === v.show) && fn.pct ? v.show : 'value';
    return { key: fn.keyless ? null : v.key, fn: fn.id, show: show };
  }

  const PivotSettings = {
    FUNCS: FUNCS,
    SHOWS: SHOWS,
    GRAINS: GRAINS,
    LIMIT: LIMIT,
    COND_ROW: COND_ROW,

    /** 対象の選択肢（抽出結果がないときは、選択にかかわらず ① の全行） */
    TARGETS: [
      { id: 'result', label: '抽出結果', icon: 'filter', desc: '抽出結果のうち、表示中の行（抽出条件での絞り込みを反映）を集計します。' },
      { id: 'source', label: '① 元データの全行', icon: 'table', desc: '② を使わず、① の全行（① の絞り込み・列の追加を反映）を集計します。' }
    ],

    create() {
      return { target: 'result', rows: [], cols: [], values: [], totals: { right: true, bottom: true }, sort: { by: 'label', dir: 'asc', value: 0 } };
    },

    /** 不正な値を捨てて初期値で補う。以前の集計の設定は置き換える */
    clean(raw) {
      if (!raw || typeof raw !== 'object') return PivotSettings.create();
      if (!Array.isArray(raw.rows) && !Array.isArray(raw.values)) return PivotSettings._migrate(raw);
      const out = PivotSettings.create();
      if (raw.target === 'source') out.target = 'source';
      const uniq = (list, max) => {
        const seen = new Set();
        return list.filter((f) => f && !seen.has(f.key) && seen.add(f.key)).slice(0, max);
      };
      out.rows = uniq((raw.rows || []).map(cleanField), LIMIT.rows);
      const used = new Set(out.rows.map((f) => f.key));
      out.cols = uniq((raw.cols || []).map(cleanField).filter((f) => f && f.key !== COND_ROW && !used.has(f.key)), LIMIT.cols);
      out.values = (raw.values || []).map(cleanValue).filter(Boolean)
        .filter((v, i, a) => a.findIndex((x) => x.fn === v.fn && x.key === v.key && x.show === v.show) === i).slice(0, LIMIT.values);
      if (raw.totals && typeof raw.totals === 'object') out.totals = { right: raw.totals.right !== false, bottom: raw.totals.bottom !== false };
      const s = raw.sort && typeof raw.sort === 'object' ? raw.sort : {};
      out.sort = { by: s.by === 'value' ? 'value' : 'label', dir: s.dir === 'desc' ? 'desc' : 'asc', value: Math.max(0, Math.min(out.values.length - 1, Number(s.value) || 0)) };
      return out;
    },

    /** 以前の集計の設定 → ピボット（グループの列 → 行、件数・集計する値 → 値、順位 → 値の大きい順の並べ替え） */
    _migrate(old) {
      const out = PivotSettings.create();
      if (old.target === 'source') out.target = 'source';
      out.rows = old.mode === 'condRows' ? [{ key: COND_ROW, grain: null }]
        : (Array.isArray(old.groupBy) ? old.groupBy : []).filter(isKey).slice(0, LIMIT.rows).map((k) => ({ key: k, grain: null }));
      if (old.count !== false) out.values.push({ key: null, fn: 'count', show: 'value' });
      (Array.isArray(old.measures) ? old.measures : []).forEach((m) => {
        const v = cleanValue({ key: m && m.key, fn: m && m.fn, show: 'value' });
        if (v) out.values.push(v);
      });
      if (old.rank && typeof old.rank.target === 'string') {
        const idx = out.values.findIndex((v) => (v.fn === 'count' ? 'count' : v.fn + '|' + v.key) === old.rank.target);
        if (idx >= 0) out.sort = { by: 'value', dir: old.rank.dir === 'asc' ? 'asc' : 'desc', value: idx };
      }
      return PivotSettings.clean(out);
    },

    /** 実際の対象（'result'／'source'。① がなければ null） */
    effectiveTarget(settings, hasSource, hasResult) {
      if (!hasSource) return null;
      return !hasResult || settings.target === 'source' ? 'source' : 'result';
    },

    /** 何か置いたか（行・列・値のどれか） */
    isConfigured(settings) {
      return !!settings && (settings.rows.length > 0 || settings.cols.length > 0 || settings.values.length > 0);
    },

    isActive(settings) {
      return PivotSettings.isConfigured(settings);
    },

    usesCondRow(settings) {
      return settings.rows.some((f) => f.key === COND_ROW);
    },

    /** 値を置いていないときは件数を数える */
    valuesOf(settings) {
      return settings.values.length ? settings.values : [{ key: null, fn: 'count', show: 'value' }];
    },

    funcOf(id) {
      return FUNCS.find((f) => f.id === id) || FUNCS[0];
    },

    grainLabel(id) {
      const g = GRAINS.find((x) => x.id === id);
      return g ? g.label.replace(/（.*）/, '') : '';
    },

    fieldLabel(f) {
      if (f.key === COND_ROW) return '② の行';
      return LQ.ResultView.nameOf(f.key) + (f.grain ? '（' + PivotSettings.grainLabel(f.grain) + '）' : '');
    },

    valueLabel(v) {
      const fn = PivotSettings.funcOf(v.fn);
      const base = fn.keyless ? fn.label : fn.label + '（' + LQ.ResultView.nameOf(v.key) + '）';
      const show = SHOWS.find((s) => s.id === v.show);
      return base + (show && show.short ? '［' + show.short + '］' : '');
    },

    /** 設定の文章表現（要約・出力の記録用） */
    describe(settings) {
      const parts = [];
      if (settings.rows.length) parts.push('行：' + settings.rows.map(PivotSettings.fieldLabel).join(' × '));
      if (settings.cols.length) parts.push('列：' + settings.cols.map(PivotSettings.fieldLabel).join(' × '));
      parts.push('値：' + PivotSettings.valuesOf(settings).map(PivotSettings.valueLabel).join('・'));
      return parts.join('／');
    }
  };

  /* ---------------------------------------------------------------------
   * DateGrain：日付 → まとめた項目（表示名と並び順）。日付でない値は「（日付以外）」
   * ------------------------------------------------------------------- */
  const WEEKDAYS = ['月曜', '火曜', '水曜', '木曜', '金曜', '土曜', '日曜'];
  const DateGrain = {
    /** @returns {{label:string, sort:*}} */
    bucket(raw, grain) {
      if (Normalizer.isBlank(raw)) return { label: BLANK_LABEL, sort: Infinity };
      const ms = ValueParser.parseDate(raw);
      if (Number.isNaN(ms)) return { label: '（日付以外）', sort: Number.MAX_VALUE };
      const d = new Date(ms);
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth() + 1;
      const pad = Util.pad2;
      switch (grain) {
        case 'year': return { label: y + '年', sort: y };
        case 'fy': {
          const fy = m >= 4 ? y : y - 1;
          return { label: fy + '年度', sort: fy };
        }
        case 'quarter': {
          const q = Math.floor((m - 1) / 3) + 1;
          return { label: y + '年 Q' + q, sort: y * 10 + q };
        }
        case 'month': return { label: y + '/' + pad(m), sort: y * 100 + m };
        case 'weekday': {
          const i = (d.getUTCDay() + 6) % 7;
          return { label: WEEKDAYS[i], sort: i };
        }
        default: return { label: y + '/' + pad(m) + '/' + pad(d.getUTCDate()), sort: y * 10000 + m * 100 + d.getUTCDate() };
      }
    }
  };

  /* ---------------------------------------------------------------------
   * 値の計算（平均・分散は Welford 法で桁落ちを抑える）
   * ------------------------------------------------------------------- */
  function newAcc() {
    return { rows: 0, n: 0, mean: 0, m2: 0, sum: 0, min: Infinity, max: -Infinity, dmin: Infinity, dmax: -Infinity, dn: 0 };
  }

  /** @returns {string} 'num' / 'date' / 'blank' / 'invalid' */
  function addValue(acc, raw) {
    acc.rows++;
    if (Normalizer.isBlank(raw)) return 'blank';
    const n = ValueParser.parseNumber(raw);
    if (!Number.isNaN(n)) {
      acc.n++;
      acc.sum += n;
      const delta = n - acc.mean;
      acc.mean += delta / acc.n;
      acc.m2 += delta * (n - acc.mean);
      if (n < acc.min) acc.min = n;
      if (n > acc.max) acc.max = n;
      return 'num';
    }
    const d = ValueParser.parseDate(raw);
    if (!Number.isNaN(d)) {
      acc.dn++;
      if (d < acc.dmin) acc.dmin = d;
      if (d > acc.dmax) acc.dmax = d;
      return 'date';
    }
    return 'invalid';
  }

  /** 2 つの途中結果をまとめる（総計の計算用。Chan らの方法で分散もまとめる） */
  function mergeAcc(a, b) {
    const out = newAcc();
    out.rows = a.rows + b.rows;
    out.n = a.n + b.n;
    out.sum = a.sum + b.sum;
    if (out.n) {
      const delta = b.mean - a.mean;
      out.mean = a.mean + delta * (b.n / out.n);
      out.m2 = a.m2 + b.m2 + delta * delta * (a.n * b.n / out.n);
    }
    out.min = Math.min(a.min, b.min);
    out.max = Math.max(a.max, b.max);
    out.dn = a.dn + b.dn;
    out.dmin = Math.min(a.dmin, b.dmin);
    out.dmax = Math.max(a.dmax, b.dmax);
    return out;
  }

  /** @returns {{value:number|null, date:boolean}} */
  function finish(acc, fn) {
    if (!acc) return { value: fn === 'count' || fn === 'sum' ? 0 : null, date: false };
    if (fn === 'count') return { value: acc.rows, date: false };
    if (fn === 'sum') return { value: acc.n ? acc.sum : (acc.dn ? null : 0), date: false };
    if (fn === 'avg') return { value: acc.n ? acc.mean : null, date: false };
    if (fn === 'stdev') return { value: acc.n >= 2 ? Math.sqrt(acc.m2 / (acc.n - 1)) : null, date: false };
    if (acc.n) return { value: fn === 'min' ? acc.min : acc.max, date: false };
    if (acc.dn) return { value: fn === 'min' ? acc.dmin : acc.dmax, date: true };
    return { value: null, date: false };
  }

  /** 出力用の文字（合計・最小・最大は 15 桁、平均・標準偏差は小数 4 桁まで） */
  function rawText(value, fn) {
    const rounded = fn === 'avg' || fn === 'stdev' ? Math.round(value * 10000) / 10000 : Number(value.toPrecision(15));
    return String(Object.is(rounded, -0) ? 0 : rounded);
  }

  /* ---------------------------------------------------------------------
   * PivotBuilder：行・列の項目と、セルごとの値の途中結果・入った行を集める
   * ------------------------------------------------------------------- */
  class PivotBuilder {
    /** @param {number} valueCount 値の数 */
    constructor(valueCount) {
      this.vc = valueCount;
      this.rowMap = new Map();
      this.colMap = new Map();
      this.rows = [];
      this.cols = [];
      this.cells = new Map();
      this.colLimit = Infinity;
      this.overflow = false;
    }

    _item(map, list, labels, sorts) {
      const key = labels.join('\u0001');
      let idx = map.get(key);
      if (idx === undefined) {
        idx = list.length;
        map.set(key, idx);
        list.push({ labels: labels, sorts: sorts });
      }
      return idx;
    }

    row(labels, sorts) {
      return this._item(this.rowMap, this.rows, labels, sorts);
    }

    /** 列の項目（上限を超えたら -1 を返し、overflow を立てる） */
    col(labels, sorts) {
      if (this.cols.length >= this.colLimit && !this.colMap.has(labels.join('\u0001'))) {
        this.overflow = true;
        return -1;
      }
      return this._item(this.colMap, this.cols, labels, sorts);
    }

    /** @returns {string[]} 値ごとの値の種類（'num' など。件数は 'count'） */
    add(r, c, raws, member, fns) {
      const key = r + '|' + c;
      let cell = this.cells.get(key);
      if (!cell) {
        cell = { accs: [], members: [] };
        for (let v = 0; v < this.vc; v++) cell.accs.push(newAcc());
        this.cells.set(key, cell);
      }
      cell.members.push(member);
      const kinds = new Array(this.vc);
      for (let v = 0; v < this.vc; v++) kinds[v] = fns[v] === 'count' ? (cell.accs[v].rows++, 'count') : addValue(cell.accs[v], raws[v]);
      return kinds;
    }
  }

  /** 項目の並び：日付・曜日は並び順の値、文字は五十音（数字は数の順）。空欄は最後 */
  function compareItems(a, b) {
    for (let i = 0; i < a.sorts.length; i++) {
      const x = a.sorts[i];
      const y = b.sorts[i];
      if (x === y) continue;
      if (typeof x === 'number' && typeof y === 'number') return x - y;
      if (typeof x === 'number') return x === Infinity ? 1 : -1;
      if (typeof y === 'number') return y === Infinity ? -1 : 1;
      const d = collator.compare(x, y);
      if (d) return d;
    }
    return 0;
  }

  /* ---------------------------------------------------------------------
   * PivotModel：計算結果（行の項目 × 列の項目 × 値）。r / c が -1 のときは総計
   * ------------------------------------------------------------------- */
  class PivotModel {
    constructor(b, info) {
      Object.assign(this, info);
      const v = info.values;
      this._b = b;
      this.rows = b.rows.map((it, i) => Object.assign({ i: i }, it));
      this.cols = b.cols.map((it, i) => Object.assign({ i: i }, it));
      this._rowTot = new Map();
      this._colTot = new Map();
      this._grand = null;
      b.cells.forEach((cell, key) => {
        const sep = key.indexOf('|');
        const r = Number(key.slice(0, sep));
        const c = Number(key.slice(sep + 1));
        this._rowTot.set(r, this._rowTot.has(r) ? this._rowTot.get(r).map((a, j) => mergeAcc(a, cell.accs[j])) : cell.accs);
        this._colTot.set(c, this._colTot.has(c) ? this._colTot.get(c).map((a, j) => mergeAcc(a, cell.accs[j])) : cell.accs);
        this._grand = this._grand ? this._grand.map((a, j) => mergeAcc(a, cell.accs[j])) : cell.accs;
      });
      this.cols.sort(compareItems);
      this.rows.sort(compareItems);
      const sort = info.sort;
      if (sort.by === 'value' && v[sort.value]) {
        const vi = sort.value;
        const val = (row) => this._raw(row.i, -1, vi).value;
        this.rows.sort((a, b2) => {
          const x = val(a);
          const y = val(b2);
          if (x === y) return compareItems(a, b2);
          if (x === null) return 1;
          if (y === null) return -1;
          return sort.dir === 'desc' ? y - x : x - y;
        });
      } else if (sort.dir === 'desc') {
        this.rows.reverse();
      }
    }

    get groupCount() {
      return this.rows.length;
    }

    _accs(r, c) {
      if (r >= 0 && c >= 0) {
        const cell = this._b.cells.get(r + '|' + c);
        return cell ? cell.accs : null;
      }
      if (r >= 0) return this._rowTot.get(r) || null;
      if (c >= 0) return this._colTot.get(c) || null;
      return this._grand;
    }

    /** そのままの値（% の表示にする前） */
    _raw(r, c, vi) {
      const accs = this._accs(r, c);
      return finish(accs && accs[vi], this.values[vi].fn);
    }

    /**
     * 表示する値。r・c は行・列の元の番号（rows[i].i）。-1 は総計
     * @returns {{value:number|null, text:string, date:boolean, pct:boolean}} text は出力用（桁区切りなし）
     */
    get(r, c, vi) {
      const v = this.values[vi];
      const base = this._raw(r, c, vi);
      if (v.show !== 'value' && base.value !== null) {
        let den = null;
        if (v.show === 'pctTotal') den = this._raw(-1, -1, vi).value;
        else if (v.show === 'pctRow') den = this._raw(r, -1, vi).value;
        else den = this._raw(-1, c, vi).value;
        const pct = den ? base.value / den : null;
        return { value: pct, text: pct === null ? '' : (Math.round(pct * 1000) / 10) + '%', date: false, pct: true };
      }
      if (base.value === null) return { value: null, text: '', date: false, pct: false };
      return { value: base.value, text: base.date ? ValueParser.formatDate(base.value) : rawText(base.value, v.fn), date: base.date, pct: false };
    }

    /** セルに入った行（総計なら、その行・列のすべて） */
    members(r, c) {
      const out = [];
      this._b.cells.forEach((cell, key) => {
        const sep = key.indexOf('|');
        if ((r < 0 || Number(key.slice(0, sep)) === r) && (c < 0 || Number(key.slice(sep + 1)) === c)) cell.members.forEach((m) => out.push(m));
      });
      return out;
    }

    /** 内訳の見出し（どの行・列のセルか） */
    drillBy(r, c) {
      const by = [];
      const row = r >= 0 ? this._b.rows[r] : null;
      const col = c >= 0 ? this._b.cols[c] : null;
      if (row) this.rowHeaders.forEach((name, i) => by.push({ name: name, value: row.labels[i] }));
      if (col) this.colHeaders.forEach((name, i) => by.push({ name: name, value: col.labels[i] }));
      return by;
    }

    /** 内訳（DrillView の entry の形） */
    drill(r, c) {
      const list = this.members(r, c);
      return Object.assign({ by: this.drillBy(r, c) }, this.memberKind === 'src' ? { src: list } : { keys: list });
    }

    /** 列の総計（右端）を出すか */
    get showRightTotal() {
      return this.totals.right && this.colHeaders.length > 0;
    }

    /** 行の総計（下端）を出すか */
    get showBottomTotal() {
      return this.totals.bottom && this.rowHeaders.length > 0;
    }

    /** 見出しの段：列の項目ごとの段＋値が複数なら値の名前の段 */
    get valueHeader() {
      return this.values.length > 1 || this.colHeaders.length === 0;
    }
  }

  /* ---------------------------------------------------------------------
   * Pivot：計算
   * ------------------------------------------------------------------- */
  const Pivot = {
    /**
     * 抽出結果（または ① の全行）の見せ方から計算する（「② の行」を使わないとき）。
     * @param {LQ.ResultView} view
     * @param {object} settings
     * @returns {PivotModel|{error:string}}
     */
    compute(view, settings) {
      const norm = new Normalizer(view.rules);
      const missing = [];
      const usable = (key) => {
        const def = view.resolve(key);
        if (def && def.available) return def;
        missing.push(LQ.ResultView.nameOf(key));
        return null;
      };
      const dims = (list) => list.map((f) => ({ f: f, def: usable(f.key) })).filter((d) => d.def);
      const rowDims = dims(settings.rows);
      const colDims = dims(settings.cols);
      const values = PivotSettings.valuesOf(settings).map((v) => ({ v: v, def: v.key ? usable(v.key) : null }))
        .filter((x) => !x.v.key || x.def);
      const fns = values.map((x) => x.v.fn);
      const b = new PivotBuilder(values.length);
      b.colLimit = LIMIT.colItems;
      const skipped = values.map(() => ({ blank: 0, invalid: 0 }));
      const bucket = (d, k) => {
        const raw = view.rawValue(d.def, k);
        if (d.f.grain) return DateGrain.bucket(raw, d.f.grain);
        if (Normalizer.isBlank(raw)) return { label: BLANK_LABEL, sort: Infinity, key: '' };
        return { label: String(raw), sort: String(raw), key: norm.text(raw) };
      };
      const n = view.length;
      for (let i = 0; i < n; i++) {
        const k = view.rowAt(i);
        const rb = rowDims.map((d) => bucket(d, k));
        const cb = colDims.map((d) => bucket(d, k));
        const r = b.row(rb.map((x) => (x.key !== undefined ? x.key : x.label)), rb.map((x) => x.sort));
        const c = b.col(cb.map((x) => (x.key !== undefined ? x.key : x.label)), cb.map((x) => x.sort));
        if (c < 0) break;
        b.rows[r].shown = b.rows[r].shown || rb.map((x) => x.label);
        b.cols[c].shown = b.cols[c].shown || cb.map((x) => x.label);
        const kinds = b.add(r, c, values.map((x) => (x.def ? view.rawValue(x.def, k) : null)), k, fns);
        Pivot._skip(kinds, values, skipped);
      }
      if (b.overflow) return Pivot._overflow(colDims.map((d) => PivotSettings.fieldLabel(d.f)));
      Pivot._useShown(b);
      return new PivotModel(b, {
        settings: settings,
        rowHeaders: rowDims.map((d) => PivotSettings.fieldLabel(d.f)),
        colHeaders: colDims.map((d) => PivotSettings.fieldLabel(d.f)),
        values: values.map((x) => Object.assign({ label: PivotSettings.valueLabel(x.v) }, x.v)),
        totals: settings.totals,
        sort: settings.sort,
        rowCount: n,
        missing: missing,
        notes: Pivot._notes(values, skipped),
        memberKind: 'keys'
      });
    },

    /**
     * 「② の行」を行に置いたとき：② の 1 行＝1 グループ（一致が 0 件の行も出す）。
     * 抽出の「複数一致」の設定に関係なく、① の行が一致したすべての ② の行に数えるため、
     * 抽出条件ごとに「すべての組み合わせ」で照合し直し、その抽出条件の結果に入った ① の行だけを数える。
     * 「② の行」以外の行・列・値には ① の列だけを使う。
     * @returns {Promise<PivotModel|{error:string}|null>} 中止したら null
     */
    async computeByCondition(view, settings, engine, token) {
      const source = view.source;
      const nameOf = LQ.ResultView.nameOf;
      const multi = view.parts.length > 1;
      const scope = view.filter === null ? view.parts.map((p, i) => i) : (view.filter < 0 ? [] : [view.filter]);
      const missing = [];
      const notes = [];
      const srcField = (key) => {
        if (key.slice(0, 2) !== 's:') {
          missing.push(nameOf(key) + '（「② の行」と一緒に使えるのは ① の列だけです）');
          return -1;
        }
        const idx = source.findColumn(nameOf(key));
        if (idx < 0) missing.push(nameOf(key));
        return idx;
      };
      const otherRows = settings.rows.filter((f) => f.key !== PivotSettings.COND_ROW).map((f) => ({ f: f, idx: srcField(f.key) })).filter((d) => d.idx >= 0);
      const colDims = settings.cols.map((f) => ({ f: f, idx: srcField(f.key) })).filter((d) => d.idx >= 0);
      const values = PivotSettings.valuesOf(settings).map((v) => ({ v: v, idx: v.key ? srcField(v.key) : -2 })).filter((x) => x.idx !== -1);
      const fns = values.map((x) => x.v.fn);
      const linked = scope.filter((i) => {
        const part = view.parts[i];
        const ok = !!part.condition && part.needsCondition && part.joinKind !== 'anti' && !!part.query;
        if (!ok) notes.push('「' + view.partName(i) + '」は ② の行がひも付かないため集計していません（固定値だけの条件、または「一致しなかった行」）');
        return ok;
      });
      const condNames = [];
      linked.forEach((i) => view.parts[i].condition.columns.forEach((c) => {
        if (condNames.indexOf(c.name) === -1) condNames.push(c.name);
      }));
      const condHeaders = (multi ? ['抽出条件'] : []).concat(condNames);
      const b = new PivotBuilder(values.length);
      b.colLimit = LIMIT.colItems;
      const skipped = values.map(() => ({ blank: 0, invalid: 0 }));
      const norm = new Normalizer(view.rules);
      const bucket = (d, x) => {
        const raw = source.cell(x, d.idx);
        if (d.f.grain) return DateGrain.bucket(raw, d.f.grain);
        if (Normalizer.isBlank(raw)) return { label: BLANK_LABEL, sort: Infinity, key: '' };
        return { label: String(raw), sort: String(raw), key: norm.text(raw) };
      };
      let pairs = 0;
      for (let n = 0; n < linked.length; n++) {
        const i = linked[n];
        const part = view.parts[i];
        const cond = part.condition;
        const query = Object.assign({}, part.query, { joinKind: 'inner', matchMode: 'all' });
        const res = await engine.run({ source: source, condition: cond, query: query, rules: part.rules }, { token: token });
        if (res.cancelled) return null;
        if (res.stats.truncated) notes.push('「' + view.partName(i) + '」：組み合わせが多すぎるため、途中までで集計しました');
        const mark = new Uint8Array(source.rowCount);
        const prof = view.result.prof;
        const rsrc = view.result.src;
        for (let k = 0; k < view.result.length; k++) if (prof[k] === i) mark[rsrc[k]] = 1;
        const colIdx = condNames.map((name) => cond.findColumn(name));
        const condLabels = (r) => (multi ? [view.partName(i)] : []).concat(colIdx.map((c) => (c >= 0 ? String(cond.cell(r, c)) : '')));
        /* ② の行は、② の並び（抽出条件の優先順位 → 行の順）を並び順にする */
        const condSorts = (r) => condHeaders.map((h2, t) => (t === 0 ? n * 1e9 + r : ''));
        if (!otherRows.length) {
          for (let r = 0; r < cond.rowCount; r++) {
            const labels = condLabels(r);
            const ri = b.row([i + ':' + r], condSorts(r));
            b.rows[ri].shown = labels;
          }
        }
        for (let j = 0; j < res.length; j++) {
          const x = res.src[j];
          const r = res.cond[j];
          if (!mark[x] || r < 0) continue;
          const ob = otherRows.map((d) => bucket(d, x));
          const cb = colDims.map((d) => bucket(d, x));
          const ri = b.row([i + ':' + r].concat(ob.map((y) => (y.key !== undefined ? y.key : y.label))), condSorts(r).concat(ob.map((y) => y.sort)));
          const ci = b.col(cb.map((y) => (y.key !== undefined ? y.key : y.label)), cb.map((y) => y.sort));
          if (ci < 0) return Pivot._overflow(colDims.map((d) => PivotSettings.fieldLabel(d.f)));
          b.rows[ri].shown = b.rows[ri].shown || condLabels(r).concat(ob.map((y) => y.label));
          b.cols[ci].shown = b.cols[ci].shown || cb.map((y) => y.label);
          pairs++;
          Pivot._skip(b.add(ri, ci, values.map((v) => (v.idx >= 0 ? source.cell(x, v.idx) : null)), x, fns), values, skipped);
        }
      }
      if (!b.cols.length) b.col([], []);
      Pivot._useShown(b);
      return new PivotModel(b, {
        settings: settings,
        rowHeaders: condHeaders.concat(otherRows.map((d) => PivotSettings.fieldLabel(d.f))),
        colHeaders: colDims.map((d) => PivotSettings.fieldLabel(d.f)),
        values: values.map((x) => Object.assign({ label: PivotSettings.valueLabel(x.v) }, x.v)),
        totals: settings.totals,
        sort: settings.sort,
        rowCount: pairs,
        missing: missing,
        notes: notes.concat(Pivot._notes(values, skipped)),
        memberKind: 'src',
        byCondition: true
      });
    },

    /** 集計のキー（全角半角などをそろえた値）ではなく、最初に見た値を表示名にする */
    _useShown(b) {
      b.rows.forEach((it) => {
        it.labels = it.shown || it.labels;
      });
      b.cols.forEach((it) => {
        it.labels = it.shown || it.labels;
      });
    },

    _overflow(colLabels) {
      return { error: 'colLimit', message: '列に置いた「' + colLabels.join(' × ') + '」の種類が ' + LIMIT.colItems + ' を超えるため、表にできません。種類の多い項目は「行」に置いてください（行には上限がありません）。' };
    },

    _skip(kinds, values, skipped) {
      for (let j = 0; j < kinds.length; j++) {
        const kind = kinds[j];
        if (kind === 'blank') skipped[j].blank++;
        else if (kind === 'invalid' || (kind === 'date' && values[j].v.fn !== 'min' && values[j].v.fn !== 'max')) skipped[j].invalid++;
      }
    },

    _notes(values, skipped) {
      const notes = [];
      values.forEach((x, j) => {
        const sk = skipped[j];
        if (x.v.fn === 'count' || (!sk.blank && !sk.invalid)) return;
        const parts = [];
        if (sk.invalid) parts.push('数値として読めない値 ' + Util.formatInt(sk.invalid) + ' 件');
        if (sk.blank) parts.push('空欄 ' + Util.formatInt(sk.blank) + ' 件');
        notes.push(PivotSettings.valueLabel(x.v) + '：' + parts.join('・') + 'を除いて計算しました');
      });
      return notes;
    },

    /**
     * 出力用の表（見たままの 2 次元。列の見出しは「列の項目 / 値の名前」を 1 段にまとめる）
     * @param {PivotModel} m
     */
    toTable(m) {
      const cols = m.cols;
      const header = m.rowHeaders.length ? m.rowHeaders.slice() : [''];
      const colName = (col) => col.labels.join(' / ');
      const multiV = m.values.length > 1;
      cols.forEach((col) => m.values.forEach((v) => header.push(m.colHeaders.length ? colName(col) + (multiV ? ' ' + v.label : '') : v.label)));
      if (m.showRightTotal) m.values.forEach((v) => header.push('総計' + (multiV ? ' ' + v.label : '')));
      const rows = [];
      const line = (r, labels) => {
        const row = labels.slice();
        cols.forEach((col) => m.values.forEach((v, vi) => row.push(m.get(r, col.i, vi).text)));
        if (m.showRightTotal) m.values.forEach((v, vi) => row.push(m.get(r, -1, vi).text));
        rows.push(row);
      };
      m.rows.forEach((row) => line(row.i, m.rowHeaders.length ? row.labels : ['']));
      if (m.showBottomTotal) line(-1, ['総計'].concat(m.rowHeaders.slice(1).map(() => '')));
      return {
        header: header,
        defs: header.map((name) => ({ name: name })),
        rowCount: rows.length,
        forEachRow(fn) {
          rows.forEach((row, i) => fn(row, i));
        }
      };
    },

    describe(settings) {
      return PivotSettings.describe(settings);
    }
  };

  LQ.PivotSettings = PivotSettings;
  LQ.DateGrain = DateGrain;
  LQ.PivotModel = PivotModel;
  LQ.Pivot = Pivot;
  /* 以前の名前（状態・保存・出力から使う） */
  LQ.AggregateSettings = PivotSettings;
  LQ.Aggregator = Pivot;
})(window);
