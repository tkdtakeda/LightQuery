/* =========================================================================
 * LightQuery - lq-aggregate.js
 * 集計（グループバイ）：抽出結果（表示中の絞り込みを反映）をグループに分け、件数・合計・平均・
 *   標準偏差（標本 = Excel の STDEV.S）・最小・最大と、グループの順位（RANK.EQ と同じ同順位）を求める。
 *   設定は列のキー（s: / c: / m:）で持ち、ブラウザに記憶する（AggregateSettings）。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const ValueParser = LQ.ValueParser;
  const Normalizer = LQ.Normalizer;
  const collator = new Intl.Collator('ja', { numeric: true });

  const FUNCS = [
    { id: 'sum', label: '合計' },
    { id: 'avg', label: '平均' },
    { id: 'stdev', label: '標準偏差', note: '標本標準偏差（Excel の STDEV.S）。値が 2 つ未満のグループは空欄' },
    { id: 'min', label: '最小', note: '数値がなく日付だけの列は、最も古い日付' },
    { id: 'max', label: '最大', note: '数値がなく日付だけの列は、最も新しい日付' }
  ];
  const FUNC_IDS = FUNCS.map((f) => f.id);
  const MAX_GROUPS = 5;
  const MAX_MEASURES = 12;
  const BLANK_LABEL = '（空欄）';
  const COUNT_ID = 'count';

  /* ---------------------------------------------------------------------
   * AggregateSettings：集計の設定（不正な値は捨てて初期値で補う）
   *   {groupBy:[key], count:boolean, measures:[{key, fn}], rank:{target, dir}|null}
   *   rank.target は 'count' または measureId（fn + '|' + key）
   * ------------------------------------------------------------------- */
  const AggregateSettings = {
    FUNCS: FUNCS,
    MAX_GROUPS: MAX_GROUPS,
    MAX_MEASURES: MAX_MEASURES,
    COUNT_ID: COUNT_ID,

    create() {
      return { groupBy: [], count: true, measures: [], rank: null };
    },

    clean(raw) {
      const out = AggregateSettings.create();
      if (!raw || typeof raw !== 'object') return out;
      const isKey = (k) => typeof k === 'string' && /^[scm]:/.test(k);
      if (Array.isArray(raw.groupBy)) out.groupBy = raw.groupBy.filter(isKey).filter((k, i, a) => a.indexOf(k) === i).slice(0, MAX_GROUPS);
      if (typeof raw.count === 'boolean') out.count = raw.count;
      if (Array.isArray(raw.measures)) {
        out.measures = raw.measures.filter((m) => m && isKey(m.key) && FUNC_IDS.indexOf(m.fn) !== -1)
          .map((m) => ({ key: m.key, fn: m.fn }))
          .filter((m, i, a) => a.findIndex((x) => AggregateSettings.measureId(x) === AggregateSettings.measureId(m)) === i)
          .slice(0, MAX_MEASURES);
      }
      if (raw.rank && typeof raw.rank === 'object' && typeof raw.rank.target === 'string') {
        out.rank = { target: raw.rank.target, dir: raw.rank.dir === 'asc' ? 'asc' : 'desc' };
      }
      if (out.rank && !AggregateSettings.targets(out).some((t) => t.id === out.rank.target)) out.rank = null;
      return out;
    },

    measureId(m) {
      return m.fn + '|' + m.key;
    },

    funcLabel(fn) {
      const f = FUNCS.find((x) => x.id === fn);
      return f ? f.label : fn;
    },

    /** 集計列の見出し：「合計（金額）」 */
    measureLabel(m) {
      return AggregateSettings.funcLabel(m.fn) + '（' + LQ.ResultView.nameOf(m.key) + '）';
    },

    /** 順位の基準にできるもの（件数と集計する値） */
    targets(settings) {
      const list = settings.count ? [{ id: COUNT_ID, label: '件数' }] : [];
      return list.concat(settings.measures.map((m) => ({ id: AggregateSettings.measureId(m), label: AggregateSettings.measureLabel(m) })));
    },

    /** 何か集計する設定か（件数・集計する値のどちらかがある） */
    isActive(settings) {
      return !!settings && (settings.count || settings.measures.length > 0);
    }
  };

  /* ---------------------------------------------------------------------
   * 計算
   * ------------------------------------------------------------------- */
  function newAcc() {
    return { n: 0, mean: 0, m2: 0, sum: 0, min: Infinity, max: -Infinity, dmin: Infinity, dmax: -Infinity, dn: 0 };
  }

  /** 値を 1 つ加える（平均・分散は Welford 法で桁落ちを抑える）。@returns {string} 'num' / 'date' / 'blank' / 'invalid' */
  function addValue(acc, raw) {
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

  /** 結果の数値（計算できなければ null）と、表示・出力用の文字 */
  function finish(acc, fn) {
    let v = null;
    let date = false;
    if (fn === 'sum') v = acc.n ? acc.sum : (acc.dn ? null : 0);
    else if (fn === 'avg') v = acc.n ? acc.mean : null;
    else if (fn === 'stdev') v = acc.n >= 2 ? Math.sqrt(acc.m2 / (acc.n - 1)) : null;
    else if (fn === 'min' || fn === 'max') {
      if (acc.n) v = fn === 'min' ? acc.min : acc.max;
      else if (acc.dn) {
        v = fn === 'min' ? acc.dmin : acc.dmax;
        date = true;
      }
    }
    return { value: v, text: v === null ? '' : (date ? ValueParser.formatDate(v) : formatNumber(v, fn)) };
  }

  /** 合計・最小・最大は 15 桁、平均・標準偏差は小数 4 桁までに丸めて表示する */
  function formatNumber(v, fn) {
    const rounded = fn === 'avg' || fn === 'stdev' ? Math.round(v * 10000) / 10000 : Number(v.toPrecision(15));
    return String(Object.is(rounded, -0) ? 0 : rounded);
  }

  /** 順位（RANK.EQ と同じ：同じ値は同順位、次の順位は飛ぶ）。値がないグループは null */
  function ranks(values, dir) {
    const idx = values.map((v, i) => i).filter((i) => values[i] !== null);
    idx.sort((a, b) => (dir === 'asc' ? values[a] - values[b] : values[b] - values[a]));
    const out = new Array(values.length).fill(null);
    idx.forEach((i, pos) => {
      out[i] = pos > 0 && values[idx[pos - 1]] === values[i] ? out[idx[pos - 1]] : pos + 1;
    });
    return out;
  }

  const Aggregator = {
    /**
     * @param {LQ.ResultView} view 抽出結果の見せ方（絞り込みを反映）
     * @param {object} settings AggregateSettings
     * @returns {{header:string[], rows:Array<Array<string>>, numeric:Set<number>, groupCount:number, rowCount:number,
     *           missing:string[], notes:string[]}}
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
      const groupDefs = settings.groupBy.map(usable).filter(Boolean);
      const measures = settings.measures.map((m) => ({ m: m, def: usable(m.key) })).filter((x) => x.def);
      const groups = new Map();
      const skipped = measures.map(() => ({ blank: 0, invalid: 0 }));
      const n = view.length;
      for (let i = 0; i < n; i++) {
        const k = view.rowAt(i);
        const raws = groupDefs.map((d) => view.rawValue(d, k));
        const key = raws.map((v) => norm.text(v)).join('\u0001');
        let g = groups.get(key);
        if (!g) {
          g = { labels: raws.map((v) => (Normalizer.isBlank(v) ? BLANK_LABEL : String(v))), count: 0, accs: measures.map(newAcc) };
          groups.set(key, g);
        }
        g.count++;
        for (let j = 0; j < measures.length; j++) {
          const kind = addValue(g.accs[j], view.rawValue(measures[j].def, k));
          if (kind === 'blank') skipped[j].blank++;
          else if (kind === 'invalid' || (kind === 'date' && measures[j].m.fn !== 'min' && measures[j].m.fn !== 'max')) skipped[j].invalid++;
        }
      }
      const list = Array.from(groups.values()).map((g) => ({
        labels: g.labels,
        count: g.count,
        results: g.accs.map((acc, j) => finish(acc, measures[j].m.fn))
      }));
      const header = groupDefs.map((d) => d.name);
      if (settings.count) header.push('件数');
      measures.forEach((x) => header.push(AggregateSettings.measureLabel(x.m)));
      let rankOf = null;
      if (settings.rank) {
        const t = settings.rank.target;
        const j = measures.findIndex((x) => AggregateSettings.measureId(x.m) === t);
        const values = t === COUNT_ID && settings.count ? list.map((g) => g.count) : (j >= 0 ? list.map((g) => g.results[j].value) : null);
        if (values) {
          rankOf = ranks(values, settings.rank.dir);
          header.push('順位');
        }
      }
      const order = list.map((g, i) => i);
      order.sort((a, b) => {
        if (rankOf) {
          const ra = rankOf[a] === null ? Infinity : rankOf[a];
          const rb = rankOf[b] === null ? Infinity : rankOf[b];
          if (ra !== rb) return ra - rb;
        }
        for (let c = 0; c < groupDefs.length; c++) {
          const la = list[a].labels[c];
          const lb = list[b].labels[c];
          if (la === lb) continue;
          if (la === BLANK_LABEL || lb === BLANK_LABEL) return la === BLANK_LABEL ? 1 : -1;
          const diff = collator.compare(la, lb);
          if (diff) return diff;
        }
        return a - b;
      });
      const rows = order.map((i) => {
        const g = list[i];
        const row = g.labels.slice();
        if (settings.count) row.push(String(g.count));
        g.results.forEach((r) => row.push(r.text));
        if (rankOf) row.push(rankOf[i] === null ? '' : String(rankOf[i]));
        return row;
      });
      const numeric = new Set();
      for (let c = groupDefs.length; c < header.length; c++) numeric.add(c);
      const notes = [];
      measures.forEach((x, j) => {
        const sk = skipped[j];
        if (!sk.blank && !sk.invalid) return;
        const parts = [];
        if (sk.invalid) parts.push('数値として読めない値 ' + LQ.Util.formatInt(sk.invalid) + ' 件');
        if (sk.blank) parts.push('空欄 ' + LQ.Util.formatInt(sk.blank) + ' 件');
        notes.push(AggregateSettings.measureLabel(x.m) + '：' + parts.join('・') + 'を除いて計算しました');
      });
      return { header: header, rows: rows, numeric: numeric, groupCount: list.length, rowCount: n, missing: missing, notes: notes };
    },

    /** 出力用の表（Exporters の table と同じ形） */
    toTable(computed) {
      return {
        header: computed.header,
        defs: computed.header.map((name) => ({ name: name })),
        rowCount: computed.rows.length,
        forEachRow(fn) {
          computed.rows.forEach((row, i) => fn(row, i));
        }
      };
    },

    /** 設定の文章表現（根拠・出力の記録用） */
    describe(settings) {
      const name = LQ.ResultView.nameOf;
      const by = settings.groupBy.length ? settings.groupBy.map(name).join(' × ') + ' ごと' : '全体（グループなし）';
      const values = (settings.count ? ['件数'] : []).concat(settings.measures.map(AggregateSettings.measureLabel));
      const rank = settings.rank ? '・順位：' + (AggregateSettings.targets(settings).find((t) => t.id === settings.rank.target) || { label: '' }).label +
        '（' + (settings.rank.dir === 'asc' ? '小さい順' : '大きい順') + '）' : '';
      return by + '：' + values.join('・') + rank;
    }
  };

  LQ.AggregateSettings = AggregateSettings;
  LQ.Aggregator = Aggregator;
})(window);
