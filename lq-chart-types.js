/* =========================================================================
 * LightQuery - lq-chart-types.js
 * グラフの種類と設定：目的（比較・推移・構成・分布・関係）ごとの種類の登録簿、置き場所（スロット）、
 *   設定の形と整え方、列から合う種類を選ぶおすすめ、ピボットの形から選ぶおすすめ
 *   ・種類を増やすときは ChartTypes.register() を呼ぶだけで、一覧・置き場所・おすすめの判定に出る
 *   ・計算は lq-chart-data.js、描画は lq-chart-render.js、画面は lq-ui-chart*.js
 *
 * （下の区切りごとに独立した部品）
 *   ChartTypes    … 目的と種類の登録簿・置き場所の定義・使えるかの判定
 *   ChartSettings … グラフ 1 枚の設定（作成・整え方・題名・言い表し）と、グラフの一覧の設定
 *   ChartAdvisor  … 列の組み合わせ／ピボットの形から合う種類を選ぶ・列を置き場所へ入れる
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Util = LQ.Util;

  /* ---------------------------------------------------------------------
   * ChartTypes
   *   種類 = {id, group, label, icon, iconClass?, family:'agg'|'rows', desc, slots:[Slot], options:[string]}
   *   Slot = {id:'x'|'y'|'color', label, accepts:['number'|'date'|'text'|'count'], required, value?, hint}
   *     value：値の置き場所（数値は合計など集計のしかたを選べる。件数も置ける）
   *   family：agg＝項目ごとに集計して描く（ピボットと同じ計算）／rows＝行の値をそのまま描く
   * ------------------------------------------------------------------- */
  const GROUPS = [
    { id: 'compare', label: '比較', icon: 'scale-balanced', desc: '項目ごとの大小を比べる' },
    { id: 'trend', label: '推移', icon: 'arrow-trend-up', desc: '時間とともにどう変わったかを見る' },
    { id: 'share', label: '構成', icon: 'chart-pie', desc: '全体に占める割合を見る' },
    { id: 'dist', label: '分布', icon: 'chart-area', desc: '値のばらつき・かたより・外れ値を見る' },
    { id: 'relation', label: '関係', icon: 'braille', desc: '2 つの数値の関係（相関）を見る' }
  ];

  const KIND_LABEL = { number: '数値', date: '日付', text: '文字', count: '件数' };
  const CAT = ['text', 'date'];
  const VALUE = ['number', 'count'];
  const COLOR_HINT = '系列を分ける項目（地域など）。色で区別します';

  const TYPES = [];

  const ChartTypes = {
    GROUPS: GROUPS,
    KIND_LABEL: KIND_LABEL,

    /** 種類を加える（同じ id は置き換える） */
    register(spec) {
      const at = TYPES.findIndex((t) => t.id === spec.id);
      if (at >= 0) TYPES.splice(at, 1, spec);
      else TYPES.push(spec);
    },

    list() {
      return TYPES.slice();
    },

    get(id) {
      return TYPES.find((t) => t.id === id) || null;
    },

    inGroup(groupId) {
      return TYPES.filter((t) => t.group === groupId);
    },

    groupOf(id) {
      const t = ChartTypes.get(id);
      return t ? GROUPS.find((g) => g.id === t.group) : null;
    },

    slot(type, slotId) {
      const t = typeof type === 'string' ? ChartTypes.get(type) : type;
      return t ? t.slots.find((s) => s.id === slotId) || null : null;
    },

    /** 置き場所に入る列の種類の言い表し（「文字・日付」など） */
    acceptsText(slot) {
      return slot.accepts.map((k) => KIND_LABEL[k]).join('・');
    },

    /**
     * 今の置き方で描けるか。
     * @param {object} type 種類
     * @param {object} slots 設定の slots
     * @returns {{ok:boolean, reason:string, slot:string|null}}
     */
    fit(type, slots) {
      for (let i = 0; i < type.slots.length; i++) {
        const s = type.slots[i];
        if (s.required && !(slots[s.id] && slots[s.id].length)) {
          return { ok: false, slot: s.id, reason: '「' + s.label + '」に' + ChartTypes.acceptsText(s) + 'の列を入れてください' };
        }
      }
      return { ok: true, slot: null, reason: '' };
    },

    /**
     * 列の組み合わせ（種類の一覧）で描けるか。足りないときは何が足りないかを返す（種類の一覧で薄く表示する理由）
     * @param {object} type
     * @param {string[]} kinds 置いている列の種類（number / date / text / count）
     */
    fitKinds(type, kinds) {
      const pool = kinds.slice();
      const need = [];
      type.slots.forEach((s) => {
        const at = pool.findIndex((k) => s.accepts.indexOf(k) >= 0);
        if (at >= 0) pool.splice(at, 1);
        else if (s.required) need.push(s);
      });
      if (!need.length) return { ok: true, reason: '' };
      return { ok: false, reason: need.map((s) => ChartTypes.acceptsText(s) + 'の列').join('と') + 'があと 1 つ必要です' };
    }
  };

  /* ---- 登録（目的の順・よく使う順） ---- */
  ChartTypes.register({
    id: 'hbar', group: 'compare', label: '横棒', icon: 'chart-bar', family: 'agg', mode: 'bar', orient: 'h',
    desc: '項目ごとの値を棒の長さで比べます。項目の名前が長いとき・項目が多いときに読みやすい形です。',
    slots: [
      { id: 'x', label: '項目（縦に並べる）', accepts: CAT, required: true, hint: '比べる項目（地域・商品など）' },
      { id: 'y', label: '値', accepts: VALUE, value: true, hint: '棒の長さ。空なら件数' },
      { id: 'color', label: '色分け', accepts: CAT, hint: COLOR_HINT }
    ],
    options: ['arrange', 'sort', 'top', 'labels']
  });
  ChartTypes.register({
    id: 'bar', group: 'compare', label: '縦棒', icon: 'chart-column', family: 'agg', mode: 'bar', orient: 'v',
    desc: '項目ごとの値を棒の高さで比べます。項目が少なく、名前が短いとき（曜日・四半期など）に向きます。',
    slots: [
      { id: 'x', label: '横軸（項目）', accepts: CAT, required: true, hint: '比べる項目（曜日・カテゴリなど）' },
      { id: 'y', label: '値', accepts: VALUE, value: true, hint: '棒の高さ。空なら件数' },
      { id: 'color', label: '色分け', accepts: CAT, hint: COLOR_HINT }
    ],
    options: ['arrange', 'sort', 'top', 'labels']
  });
  ChartTypes.register({
    id: 'line', group: 'trend', label: '折れ線', icon: 'chart-line', family: 'agg', mode: 'line', orient: 'v',
    desc: '日付ごとの値を線で結び、増減の流れを見ます。日付は月・四半期などにまとめられます。',
    slots: [
      { id: 'x', label: '横軸（日付・順序）', accepts: CAT, required: true, hint: '時間の流れ（受注日など）' },
      { id: 'y', label: '値', accepts: VALUE, value: true, hint: '線の高さ。空なら件数' },
      { id: 'color', label: '線を分ける', accepts: CAT, hint: '1 本ずつの線にする項目（地域など）' }
    ],
    options: ['area', 'arrange', 'labels']
  });
  ChartTypes.register({
    id: 'donut', group: 'share', label: 'ドーナツ', icon: 'chart-pie', family: 'agg', mode: 'donut', orient: 'v',
    desc: '全体に占める割合を見ます。項目が 6 つ程度までのときに向きます（多いときは横棒が読みやすい形です）。',
    slots: [
      { id: 'x', label: '項目', accepts: CAT, required: true, hint: '割合を見る項目（カテゴリなど）' },
      { id: 'y', label: '値', accepts: VALUE, value: true, hint: '大きさ。空なら件数' }
    ],
    options: ['top', 'labels']
  });
  ChartTypes.register({
    id: 'hist', group: 'dist', label: 'ヒストグラム', icon: 'chart-simple', family: 'rows',
    desc: '数値を区間に分けて件数を数え、ばらつきの形（山の位置・幅・かたより）を見ます。',
    slots: [
      { id: 'x', label: '数値', accepts: ['number'], required: true, hint: '分布を見る数値（金額など）' },
      { id: 'color', label: '重ねて比べる', accepts: CAT, hint: 'グループごとに半透明で重ねる項目（3 つまで。残りは「その他」）' }
    ],
    options: ['bins', 'lines']
  });
  ChartTypes.register({
    id: 'box', group: 'dist', label: '箱ひげ・バイオリン', icon: 'sliders', iconClass: 'lq-chicon--rot', family: 'rows',
    desc: 'グループごとのばらつきを並べて比べます。箱＝中央の半分、線＝中央値、ひげ＝外れ値を除く範囲、バイオリン＝分布の形です。',
    slots: [
      { id: 'y', label: '数値', accepts: ['number'], required: true, hint: 'ばらつきを見る数値（金額など）' },
      { id: 'x', label: 'グループ', accepts: CAT, hint: '並べて比べる項目（カテゴリなど）。空なら全体' }
    ],
    options: ['shape', 'points', 'groupSort']
  });
  ChartTypes.register({
    id: 'scatter', group: 'relation', label: '散布図', icon: 'braille', family: 'rows',
    desc: '1 行＝1 点で、2 つの数値の関係を見ます。回帰直線と相関係数で、関係の強さが分かります。',
    slots: [
      { id: 'x', label: '横軸（数値）', accepts: ['number', 'date'], required: true, hint: '原因側の数値（数量など）' },
      { id: 'y', label: '縦軸（数値）', accepts: ['number'], required: true, hint: '結果側の数値（金額など）' },
      { id: 'color', label: '色分け', accepts: ['text'], hint: '点を色で分ける項目（3 つまで。残りは「その他」）' }
    ],
    options: ['trend', 'log']
  });

  /* ---------------------------------------------------------------------
   * ChartSettings
   *   グラフ 1 枚：{id, name, target:'result'|'source', type, typeLocked, slots:{x:[], y:[], color:[]}, opts}
   *     置いた項目：{key:string|null, grain:string|null, fn:string|null}（件数は key:null・fn:'count'）
   *   一覧：{items:[グラフ], activeId, pivot:{view, type, arrange, swap, value, top}}
   *     pivot はピボットタブのグラフ（ピボットの結果を描く）の設定
   * ------------------------------------------------------------------- */
  const MAX_CHARTS = 30;
  const NAME_MAX = 40;
  const SLOT_IDS = ['x', 'y', 'color'];
  const FNS = ['count', 'sum', 'avg', 'min', 'max'];
  const TOPS = ['auto', 0, 5, 10, 20, 30];
  const PIVOT_VIEWS = ['table', 'chart', 'split'];
  const PIVOT_TYPES = ['auto', 'hbar', 'bar', 'line', 'donut'];
  const ARRANGES = ['auto', 'group', 'stack', 'pct'];
  const SHAPES = ['box', 'violin', 'both'];
  const isKey = (k) => typeof k === 'string' && /^[scm]:/.test(k);
  const pick = (value, list, fallback) => (list.indexOf(value) >= 0 ? value : fallback);

  function defaultOpts() {
    return { arrange: 'auto', sort: 'auto', top: 'auto', labels: true, area: false, bins: 0, lines: true,
      shape: 'both', points: 'auto', groupSort: 'label', trend: true, logx: false, logy: false };
  }

  function cleanItem(raw, slotId) {
    if (!raw || typeof raw !== 'object') return null;
    const fn = FNS.indexOf(raw.fn) >= 0 ? raw.fn : null;
    if (fn === 'count') return slotId === 'y' ? { key: null, grain: null, fn: 'count' } : null;
    if (!isKey(raw.key)) return null;
    const grain = LQ.PivotSettings.GRAINS.some((g) => g.id === raw.grain) ? raw.grain : null;
    return { key: raw.key, grain: grain, fn: fn };
  }

  function cleanOpts(raw) {
    const o = defaultOpts();
    const r = raw && typeof raw === 'object' ? raw : {};
    o.arrange = pick(r.arrange, ARRANGES, o.arrange);
    o.sort = pick(r.sort, ['auto', 'value', 'label'], o.sort);
    o.top = pick(r.top, TOPS, o.top);
    o.labels = r.labels !== false;
    o.area = !!r.area;
    o.bins = Util.clamp(parseInt(r.bins, 10) || 0, 0, LQ.ChartStats.BINS_MAX);
    o.lines = r.lines !== false;
    o.shape = pick(r.shape, SHAPES, o.shape);
    o.points = pick(r.points, ['auto', 'on', 'off'], o.points);
    o.groupSort = pick(r.groupSort, ['label', 'median'], o.groupSort);
    o.trend = r.trend !== false;
    o.logx = !!r.logx;
    o.logy = !!r.logy;
    return o;
  }

  const ChartSettings = {
    MAX: MAX_CHARTS,
    NAME_MAX: NAME_MAX,
    SLOT_IDS: SLOT_IDS,
    FNS: FNS,
    TOPS: TOPS,
    PIVOT_VIEWS: PIVOT_VIEWS,
    PIVOT_TYPES: PIVOT_TYPES,

    create(init) {
      const i = init || {};
      return ChartSettings.clean({ id: i.id || Util.uid('chart'), name: i.name || '', target: i.target || 'result',
        type: i.type || 'hbar', typeLocked: !!i.typeLocked, slots: i.slots || {}, opts: i.opts || {} });
    },

    clean(raw) {
      const r = raw && typeof raw === 'object' ? raw : {};
      const type = ChartTypes.get(r.type) ? r.type : 'hbar';
      const t = ChartTypes.get(type);
      const slots = {};
      SLOT_IDS.forEach((id) => {
        const def = t.slots.find((s) => s.id === id);
        const list = Array.isArray(r.slots && r.slots[id]) ? r.slots[id] : [];
        slots[id] = def ? list.map((x) => cleanItem(x, id)).filter(Boolean).slice(0, 1) : [];
      });
      return {
        id: typeof r.id === 'string' && r.id ? r.id : Util.uid('chart'),
        name: typeof r.name === 'string' ? r.name.slice(0, NAME_MAX) : '',
        target: r.target === 'source' ? 'source' : 'result',
        type: type,
        typeLocked: !!r.typeLocked,
        slots: slots,
        opts: cleanOpts(r.opts)
      };
    },

    createPivot() {
      return { view: 'table', type: 'auto', arrange: 'auto', swap: false, value: 0, top: 'auto' };
    },

    cleanPivot(raw) {
      const r = raw && typeof raw === 'object' ? raw : {};
      return {
        view: pick(r.view, PIVOT_VIEWS, 'table'),
        type: pick(r.type, PIVOT_TYPES, 'auto'),
        arrange: pick(r.arrange, ARRANGES, 'auto'),
        swap: !!r.swap,
        value: Math.max(0, parseInt(r.value, 10) || 0),
        top: pick(r.top, TOPS, 'auto')
      };
    },

    /** グラフの一覧の設定を整える（壊れた値は捨てて初期値で補う） */
    cleanAll(raw) {
      const r = raw && typeof raw === 'object' ? raw : {};
      const seen = new Set();
      const items = (Array.isArray(r.items) ? r.items : []).map(ChartSettings.clean)
        .filter((c) => !seen.has(c.id) && seen.add(c.id)).slice(0, MAX_CHARTS);
      const activeId = items.some((c) => c.id === r.activeId) ? r.activeId : (items[0] ? items[0].id : null);
      return { items: items, activeId: activeId, pivot: ChartSettings.cleanPivot(r.pivot) };
    },

    active(all) {
      return all.items.find((c) => c.id === all.activeId) || null;
    },

    /** 置いている項目（置き場所の順） */
    placed(chart) {
      const out = [];
      SLOT_IDS.forEach((id) => chart.slots[id].forEach((item) => out.push({ slot: id, item: item })));
      return out;
    },

    isConfigured(chart) {
      return !!chart && SLOT_IDS.some((id) => chart.slots[id].length > 0);
    },

    /** 置いた項目の表示名（「受注日（月）」「金額の合計」「件数」） */
    itemLabel(item, slotId, type) {
      if (item.fn === 'count' && !item.key) return '件数';
      const name = LQ.ResultView.nameOf(item.key);
      const grain = item.grain ? '（' + LQ.PivotSettings.grainLabel(item.grain) + '）' : '';
      const slot = ChartTypes.slot(type, slotId);
      if (slot && slot.value && item.fn) return name + 'の' + LQ.PivotSettings.funcOf(item.fn).label;
      return name + grain;
    },

    /** 値の置き場所の項目（空なら件数） */
    valueItem(chart) {
      return chart.slots.y[0] || { key: null, grain: null, fn: 'count' };
    },

    /** 自動の題名（名前を付けていないときに使う） */
    autoTitle(chart) {
      const t = ChartTypes.get(chart.type);
      const lab = (id) => (chart.slots[id][0] ? ChartSettings.itemLabel(chart.slots[id][0], id, t) : '');
      if (!ChartSettings.isConfigured(chart)) return '新しいグラフ';
      if (t.family === 'agg') {
        const by = [lab('x'), lab('color')].filter(Boolean).map((s) => s + '別');
        return ChartSettings.itemLabel(ChartSettings.valueItem(chart), 'y', t) + (by.length ? '（' + by.join('・') + '）' : '');
      }
      if (t.id === 'hist') return (lab('x') || '数値') + 'の分布' + (lab('color') ? '（' + lab('color') + '別）' : '');
      if (t.id === 'box') return (lab('y') || '数値') + 'のばらつき' + (lab('x') ? '（' + lab('x') + '別）' : '');
      if (t.id === 'scatter') return (lab('x') || 'X') + ' と ' + (lab('y') || 'Y') + ' の関係' + (lab('color') ? '（' + lab('color') + '別）' : '');
      return t.label;
    },

    title(chart) {
      return chart.name || ChartSettings.autoTitle(chart);
    },

    /** 設定の文章表現（要約・印の説明用） */
    describe(chart) {
      const t = ChartTypes.get(chart.type);
      const parts = [t.label];
      t.slots.forEach((s) => {
        const item = chart.slots[s.id][0];
        if (item) parts.push(s.label.replace(/（.*）/, '') + '：' + ChartSettings.itemLabel(item, s.id, t));
      });
      return parts.join('／');
    },

    /** 新しいグラフの名前の候補（「グラフ 1」…） */
    defaultName(all) {
      let n = all.items.length + 1;
      const names = new Set(all.items.map((c) => c.name));
      while (names.has('グラフ ' + n)) n++;
      return 'グラフ ' + n;
    }
  };

  /* ---------------------------------------------------------------------
   * ChartAdvisor
   * ------------------------------------------------------------------- */
  const TIME_GRAINS = ['year', 'fy', 'quarter', 'month', 'day'];

  /** 値の置き場所に入れる項目（数値は合計、件数は件数） */
  function valueOf(key, kind, type) {
    const slot = ChartTypes.slot(type, 'y');
    if (kind === 'count') return { key: null, grain: null, fn: 'count' };
    return { key: key, grain: null, fn: slot && slot.value ? 'sum' : null };
  }

  function itemFor(slot, key, kind, type) {
    if (slot.value) return valueOf(key, kind, type);
    return { key: key, grain: kind === 'date' ? 'month' : null, fn: null };
  }

  const ChartAdvisor = {
    /**
     * 列の並び（押した順）から合う種類を選ぶ。
     * @param {Array<{kind:string}>} fields
     * @returns {string|null}
     */
    recommend(fields) {
      const kinds = fields.map((f) => f.kind);
      const n = (k) => kinds.filter((x) => x === k).length;
      const nums = n('number');
      if (nums >= 2) return 'scatter';
      if (n('date') > 0 && (nums === 1 || n('count') || kinds[0] === 'date')) return 'line';
      if (nums === 1 && !n('text') && !n('date')) return 'hist';
      if (n('text') || n('date')) return 'hbar';
      if (n('count')) return 'hbar';
      return null;
    },

    /**
     * 置いている項目を別の種類に置き直す（押した順を保つ。入らない項目は捨てて返す）
     * @param {object} chart
     * @param {string} typeId
     * @param {Function} kindOf key → 種類
     * @returns {{chart:object, dropped:string[]}}
     */
    retype(chart, typeId, kindOf) {
      const fields = ChartSettings.placed(chart).map((p) => ({ key: p.item.key, kind: p.item.key ? kindOf(p.item.key) : 'count', item: p.item, from: p.slot }));
      const next = Util.clone(chart);
      next.type = typeId;
      next.slots = { x: [], y: [], color: [] };
      const type = ChartTypes.get(typeId);
      const dropped = [];
      /* 同じ置き場所（x・y・color）に入るものはそのまま、それ以外は空いている合う場所へ */
      const rest = [];
      fields.forEach((f) => {
        const slot = type.slots.find((s) => s.id === f.from);
        if (slot && slot.accepts.indexOf(f.kind) >= 0 && !next.slots[slot.id].length) next.slots[slot.id].push(ChartAdvisor._carry(slot, f, type));
        else rest.push(f);
      });
      const left = [];
      rest.forEach((f) => {
        const slot = type.slots.find((s) => s.accepts.indexOf(f.kind) >= 0 && !next.slots[s.id].length);
        if (slot) next.slots[slot.id].push(ChartAdvisor._carry(slot, f, type));
        else left.push(f);
      });
      /* 必須の置き場所が空なら、任意の置き場所（色分けなど）から合う項目を移し、空いた所に残りを入れる */
      type.slots.filter((s) => s.required && !next.slots[s.id].length).forEach((need) => {
        const donor = type.slots.find((s) => !s.required && next.slots[s.id].length &&
          need.accepts.indexOf(next.slots[s.id][0].key ? kindOf(next.slots[s.id][0].key) : 'count') >= 0);
        if (!donor) return;
        const item = next.slots[donor.id][0];
        const kind = item.key ? kindOf(item.key) : 'count';
        next.slots[need.id] = [ChartAdvisor._carry(need, { key: item.key, kind: kind, item: item }, type)];
        next.slots[donor.id] = [];
        const at = left.findIndex((f) => donor.accepts.indexOf(f.kind) >= 0);
        if (at >= 0) next.slots[donor.id] = [ChartAdvisor._carry(donor, left.splice(at, 1)[0], type)];
      });
      left.forEach((f) => dropped.push(f.key ? LQ.ResultView.nameOf(f.key) : '件数'));
      return { chart: ChartSettings.clean(next), dropped: dropped };
    },

    /** 置き場所を移るときの項目（値の置き場所なら集計のしかたを付け、そうでなければ外す） */
    _carry(slot, f, type) {
      if (slot.value) return f.item.fn ? Object.assign({}, f.item, { grain: null }) : valueOf(f.key, f.kind, type);
      return { key: f.key, grain: f.kind === 'date' ? (f.item.grain || 'month') : null, fn: null };
    },

    /**
     * 列を押したときの置き方。種類を自分で選んでいなければ、置いた列の組み合わせに合う種類へ切り替える。
     * @returns {{chart:object, slot:string|null, retyped:boolean, full:boolean, dropped:string[]}}
     */
    place(chart, key, kind, kindOf) {
      const placed = ChartSettings.placed(chart);
      const exists = placed.find((p) => (key ? p.item.key === key : p.item.fn === 'count' && !p.item.key));
      if (exists) return { chart: chart, slot: exists.slot, retyped: false, full: false, exists: true, dropped: [] };
      if (!chart.typeLocked) {
        const fields = placed.map((p) => ({ kind: p.item.key ? kindOf(p.item.key) : 'count' })).concat([{ kind: kind }]);
        const best = ChartAdvisor.recommend(fields);
        if (best && best !== chart.type) {
          const moved = ChartAdvisor.retype(chart, best, kindOf);
          const r = ChartAdvisor._put(moved.chart, key, kind);
          if (r.slot) return Object.assign(r, { retyped: true, dropped: moved.dropped });
        }
      }
      return Object.assign(ChartAdvisor._put(chart, key, kind), { retyped: false, dropped: [] });
    },

    /** 合う空いた置き場所へ入れる。値の置き場所は 1 つなので、数値・件数は入れ替える */
    _put(chart, key, kind) {
      const type = ChartTypes.get(chart.type);
      const next = Util.clone(chart);
      let slot = type.slots.find((s) => s.accepts.indexOf(kind) >= 0 && !next.slots[s.id].length);
      if (!slot && (kind === 'number' || kind === 'count')) slot = type.slots.find((s) => s.value && s.accepts.indexOf(kind) >= 0);
      if (!slot) return { chart: chart, slot: null, full: true };
      next.slots[slot.id] = [itemFor(slot, key, kind, type)];
      return { chart: ChartSettings.clean(next), slot: slot.id, full: false };
    },

    /** 今の置き方に合う種類（種類の一覧の「おすすめ」） */
    recommendFor(chart, kindOf) {
      const fields = ChartSettings.placed(chart).map((p) => ({ kind: p.item.key ? kindOf(p.item.key) : 'count' }));
      return fields.length ? ChartAdvisor.recommend(fields) : null;
    },

    /**
     * ピボットの形から種類を選ぶ（ピボットタブのグラフの「おすすめ」）。
     * @param {object} pivot ピボットの設定（rows・cols・values）
     * @param {LQ.PivotModel} model
     * @param {number} vi 描く値の番号
     * @param {boolean} swap 行と列を入れ替えて描くか（列の項目が横軸になる）
     * @returns {{type:string, why:string}}
     */
    recommendPivot(pivot, model, vi, swap) {
      const first = ChartAdvisor.pivotAxis(pivot, swap);
      const v = model.values[vi] || model.values[0];
      if (first && TIME_GRAINS.indexOf(first.grain) >= 0) return { type: 'line', why: '行が日付（' + LQ.PivotSettings.grainLabel(first.grain) + '）なので、流れが分かる折れ線' };
      if (first && first.grain === 'weekday') return { type: 'bar', why: '行が曜日なので、順序を保つ縦棒' };
      if (v && v.show === 'pctTotal' && !model.colHeaders.length && model.rows.length <= 6) return { type: 'donut', why: '総計に対する % で項目が少ないので、割合が分かるドーナツ' };
      return { type: 'hbar', why: '項目ごとの大小を比べやすく、名前の長い項目も読める横棒' };
    },

    /** ピボットのグラフで項目（横軸）になる項目：ふつうは行の 1 つ目、入れ替えたときは列の 1 つ目 */
    pivotAxis(pivot, swap) {
      return (swap && pivot.cols.length ? pivot.cols[0] : pivot.rows[0]) || null;
    },

    /** 並べ方の自動：系列が 4 つまでなら並べる、それより多ければ積み上げ */
    arrangeFor(arrange, seriesCount) {
      if (arrange !== 'auto') return arrange;
      return seriesCount > 4 ? 'stack' : 'group';
    }
  };

  LQ.ChartTypes = ChartTypes;
  LQ.ChartSettings = ChartSettings;
  LQ.ChartAdvisor = ChartAdvisor;
})(window);
