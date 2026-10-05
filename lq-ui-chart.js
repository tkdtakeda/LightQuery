/* =========================================================================
 * LightQuery - lq-ui-chart.js
 * グラフの表示の共通部品：一覧の操作・描画領域と、ピボットタブの「表｜グラフ｜並べて」のグラフ（グラフタブは lq-ui-chart-tab.js）。
 *   どちらも同じ描画領域（ChartFrame）を使い、上の操作バーで種類を変え、右端で画像に保存・コピーする。
 *   棒・点を押すと、そこに入った行（内訳）を重ねて表示する（ピボットのセルのダブルクリックと同じ）。
 *   （計算は lq-chart-data.js、描画は lq-chart-render.js、設定パネルは lq-ui-chart-panel.js）
 *
 * （下の区切りごとに独立した部品）
 *   ChartActions … グラフの一覧の操作（追加・複製・削除・名前・選択・変更）
 *   ChartFrame   … 描画領域と操作バー（ライブラリの読み込み・画像の保存とコピー）
 *   PivotChart   … ピボットタブのグラフ（ピボットの結果を描く・表との対応づけ）
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Dom = LQ.Dom;
  const Util = LQ.Util;
  const UI = LQ.UI;
  const h = Dom.h;
  const fmt = Util.formatInt;
  const Types = LQ.ChartTypes;
  const Settings = LQ.ChartSettings;
  const Advisor = LQ.ChartAdvisor;

  /** 列の種類（数値・日付・文字） */
  function kindOf(state) {
    return (key) => (key ? LQ.PivotFieldTypes.of(state, key) : 'count');
  }

  /* ---------------------------------------------------------------------
   * ChartActions：グラフの一覧を変える操作（状態は state.setCharts だけで変える）
   * ------------------------------------------------------------------- */
  class ChartActions {
    constructor(ctx) {
      this.ctx = ctx;
      this.state = ctx.state;
      this.toasts = ctx.toasts;
    }

    get all() {
      return this.state.charts;
    }

    active() {
      return Settings.active(this.all);
    }

    /** 一覧を変える。mutate は複製した一覧を書き換える */
    change(mutate, detail) {
      const next = Util.clone(this.all);
      mutate(next);
      this.state.setCharts(next, detail);
    }

    /** 選択中のグラフを変える（なければ作る） */
    update(mutate, detail) {
      this.ensure();
      this.change((all) => {
        const c = Settings.active(all);
        mutate(c);
        const at = all.items.indexOf(c);
        all.items[at] = Settings.clean(c);
      }, detail);
    }

    /** グラフが 1 枚もなければ空のグラフを作る */
    ensure() {
      if (this.active()) return this.active();
      return this.add(null, true);
    }

    add(init, quiet) {
      if (this.all.items.length >= Settings.MAX) {
        this.toasts.show({ type: 'warn', title: 'グラフは ' + Settings.MAX + ' 枚までです', message: '使わないグラフを削除してください。' });
        return null;
      }
      const s = this.state;
      const chart = Settings.create(Object.assign({ name: Settings.defaultName(this.all), target: s.result ? 'result' : 'source' }, init || {}));
      this.change((all) => {
        all.items.push(chart);
        all.activeId = chart.id;
      }, { added: chart.id, quiet: !!quiet });
      return chart;
    }

    duplicate(id) {
      const src = this.all.items.find((c) => c.id === id);
      if (!src || this.all.items.length >= Settings.MAX) return;
      const copy = Settings.clean(Object.assign(Util.clone(src), { id: Util.uid('chart'), name: (src.name || Settings.autoTitle(src)).slice(0, Settings.NAME_MAX - 3) + 'のコピー' }));
      this.change((all) => {
        all.items.splice(all.items.findIndex((c) => c.id === id) + 1, 0, copy);
        all.activeId = copy.id;
      }, { added: copy.id });
    }

    remove(id) {
      const s = this.state;
      const at = this.all.items.findIndex((c) => c.id === id);
      if (at < 0) return;
      const snap = s.snapshot();
      const name = Settings.title(this.all.items[at]);
      this.change((all) => {
        all.items.splice(at, 1);
        if (all.activeId === id) all.activeId = all.items[Math.min(at, all.items.length - 1)] ? all.items[Math.min(at, all.items.length - 1)].id : null;
      });
      this.toasts.show({ type: 'success', title: 'グラフ「' + name + '」を削除しました', message: '',
        actions: [{ label: '元に戻す', icon: 'rotate-left', onClick: () => this.ctx.app.restore(snap, 'グラフを元に戻しました') }] });
    }

    select(id) {
      if (this.all.activeId === id) return;
      this.change((all) => {
        all.activeId = id;
      }, { selected: id });
    }

    rename(id, name) {
      this.change((all) => {
        const c = all.items.find((x) => x.id === id);
        if (c) c.name = String(name || '').trim().slice(0, Settings.NAME_MAX);
      }, { renamed: id });
    }

    /** 種類を選ぶ（置いた列は合う置き場所へ移す。入らない列は外して知らせる） */
    setType(typeId) {
      const chart = this.ensure();
      if (chart.type === typeId && chart.typeLocked) return;
      const moved = Advisor.retype(chart, typeId, kindOf(this.state));
      moved.chart.typeLocked = true;
      this.update((c) => Object.assign(c, moved.chart), { type: typeId });
      const label = Types.get(typeId).label;
      const notes = [];
      if (moved.restored.length) notes.push('一時的に外していた ' + moved.restored.join('、') + ' を元の置き場所に戻しました');
      if (moved.dropped.length) notes.push(moved.dropped.join('、') + ' は' + label + 'に置けないため一時的に外しました（種類を戻すと元に戻ります）');
      if (notes.length) this.toasts.show({ type: 'info', title: label + 'にしました', message: notes.join('。') + '。', duration: 6000 });
    }

    /** グラフタブの表示：'single'＝1 枚ずつ／'grid'＝一覧で並べる */
    setView(view) {
      if (this.all.view === view) return;
      this.change((all) => {
        all.view = view;
      }, { view: view });
    }

    /** 一時的に外している項目を捨てる */
    clearParked() {
      this.update((c) => {
        c.memo.parked = [];
      });
    }

    /** ピボットタブの設定を変える */
    setPivot(patch) {
      this.change((all) => {
        all.pivot = Settings.cleanPivot(Object.assign(all.pivot, patch));
      }, { pivot: true });
    }
  }

  /* ---------------------------------------------------------------------
   * ChartFrame：操作バー＋描画領域。同じ内容なら描き直さない
   * ------------------------------------------------------------------- */
  class ChartFrame {
    constructor(ctx) {
      this.ctx = ctx;
      this.toasts = ctx.toasts;
      this.canvas = new LQ.ChartCanvas();
      this.left = h('div', { class: 'lq-chart__tools' });
      this.status = h('div', { class: 'lq-chart__status', hidden: true });
      const png = h('button', { class: 'lq-btn lq-btn--sm', type: 'button', title: 'グラフを PNG 画像で保存します',
        onclick: () => this.save() }, [Dom.icon('image'), '画像で保存']);
      const copy = h('button', { class: 'lq-btn lq-btn--sm', type: 'button', title: 'グラフを画像としてコピーします（Excel・PowerPoint に Ctrl+V で貼り付けられます）',
        onclick: () => this.copy() }, [Dom.icon('copy'), 'コピー']);
      this.exports = h('div', { class: 'lq-chart__exports' }, [png, copy]);
      this.bar = h('div', { class: 'lq-chart__bar' }, [this.left, h('span', { class: 'lq-topbar__spacer' }), this.exports]);
      this.el = h('div', { class: 'lq-chart' }, [this.bar, h('div', { class: 'lq-chart__body' }, [this.canvas.el, this.status])]);
      this._key = null;
      this.fileBase = 'LightQuery_グラフ';
    }

    setTools(nodes) {
      Dom.clear(this.left);
      Dom.append(this.left, nodes);
    }

    /** ライブラリを読み込んでいなければ読み込み、終わったら描き直しを頼む（false を返す） */
    ready() {
      const lib = LQ.ChartLibrary;
      if (lib.ready) return true;
      if (lib.state === 'failed') {
        this._show('error', lib.failureReason, h('button', { class: 'lq-btn lq-btn--sm', type: 'button', onclick: () => this._load() }, [Dom.icon('rotate-right'), 'もう一度読み込む']));
        return false;
      }
      this._load();
      return false;
    }

    _load() {
      this._show('loading', 'グラフ用ライブラリを読み込んでいます…');
      LQ.ChartLibrary.ensure().catch(() => {}).then(() => this.ctx.bus.emit('change', { topic: 'chart-library' }));
    }

    /** 描かずに知らせだけを出す（一覧のカードで、未設定・描けないとき） */
    message(text, action) {
      this._show('info', text, action);
    }

    _show(kind, text, action) {
      this.canvas.destroy();
      this._key = null;
      Dom.clear(this.status);
      this.status.hidden = false;
      this.status.className = 'lq-chart__status lq-chart__status--' + kind;
      const icon = { loading: 'spinner', info: 'circle-info' }[kind] || 'triangle-exclamation';
      Dom.append(this.status, [Dom.icon(icon, kind === 'loading' ? 'fa-spin' : ''), h('span', { text: text }), action || null]);
      this.exports.hidden = true;
    }

    /**
     * 描く（key が前回と同じなら描き直さない）
     * @param {string} key 内容の識別子
     * @param {Function} make () → 描く内容
     * @param {{pick?:Function, hover?:Function}} handlers
     */
    draw(key, make, handlers) {
      if (!this.ready()) return;
      if (key === this._key && this.canvas.chart) return;
      this.status.hidden = true;
      this.exports.hidden = false;
      this._key = key;
      this.canvas.draw(make(), handlers);
      this.el.classList.remove('is-drawn');
      void this.el.offsetWidth;
      this.el.classList.add('is-drawn');
    }

    clear() {
      this.canvas.destroy();
      this._key = null;
    }

    async save() {
      try {
        const blob = await this.canvas.toBlob();
        const name = Util.sanitizeFileName(this.fileBase + '_' + Util.timestamp()) + '.png';
        LQ.Exporters.download(blob, name);
        this.toasts.show({ type: 'success', title: 'グラフを画像で保存しました', message: name + '（' + Util.formatBytes(blob.size) + '）' });
      } catch (err) {
        this.toasts.show({ type: 'error', title: '保存できませんでした', message: err.message });
      }
    }

    async copy() {
      try {
        const blob = await this.canvas.toBlob();
        if (!navigator.clipboard || !global.ClipboardItem) throw new Error('clipboard');
        await navigator.clipboard.write([new global.ClipboardItem({ 'image/png': blob })]);
        this.toasts.show({ type: 'success', title: 'グラフを画像としてコピーしました', message: 'Excel・PowerPoint・メールに Ctrl+V で貼り付けられます。' });
      } catch (err) {
        this.toasts.show({ type: 'error', title: 'コピーできませんでした', message: 'ブラウザが画像のコピーを許可していません。「画像で保存」を使ってください。' });
      }
    }
  }

  /** 種類のボタン（アイコン＋短い名前。合わない種類は薄くして理由を添える） */
  function typeButton(type, opts) {
    const o = opts || {};
    return h('button', {
      class: 'lq-chtype' + (o.compact ? ' lq-chtype--compact' : '') + (o.active ? ' is-active' : '') + (o.unfit ? ' is-unfit' : '') + (o.rec ? ' is-rec' : ''), type: 'button',
      title: type.label + '：' + type.desc + (o.unfit ? '\n' + o.unfit : '') + (o.rec ? '\n（今の項目におすすめ）' : ''),
      'aria-pressed': o.active ? 'true' : 'false', onclick: o.onClick
    }, [Dom.icon(type.icon, type.iconClass || ''), h('span', { class: 'lq-chtype__label', text: o.label || type.label }), o.rec ? h('span', { class: 'lq-chtype__rec', text: 'おすすめ' }) : null]);
  }

  /* ---------------------------------------------------------------------
   * PivotChart：ピボットタブのグラフ（ピボットの結果をそのまま描く。総計は描かない）
   * ------------------------------------------------------------------- */
  const PIVOT_TYPES = ['hbar', 'bar', 'pareto', 'line', 'donut'];
  const ARRANGE = [
    { value: 'group', label: '並べる', icon: 'chart-column', title: '系列を横に並べて比べる' },
    { value: 'stack', label: '積み上げ', icon: 'layer-group', title: '系列を積み上げて合計も見る' },
    { value: 'pct', label: '100%', icon: 'percent', title: '項目ごとの構成比（合計を 100% にそろえる）' }
  ];

  class PivotChart {
    /** @param {LQ.PivotTab} tab */
    constructor(tab) {
      this.tab = tab;
      this.main = tab.main;
      this.ctx = tab.main.ctx;
      this.state = tab.state;
      this.actions = new ChartActions(this.ctx);
      this.frame = new ChartFrame(this.ctx);
      this.linked = null;
    }

    get opts() {
      return this.state.charts.pivot;
    }

    /** 実際に描く種類と、おすすめの理由 */
    resolve(model) {
      const o = this.opts;
      const vi = Math.min(o.value, model.values.length - 1);
      const rec = Advisor.recommendPivot(this.state.aggregate, model, vi, o.swap);
      return { type: o.type === 'auto' ? rec.type : o.type, rec: rec, vi: vi };
    }

    /** 項目（横軸）が日付・曜日なら、並べ替えや上位 N 件をしない */
    _timeLike() {
      const first = Advisor.pivotAxis(this.state.aggregate, this.opts.swap);
      return !!first && ['year', 'fy', 'quarter', 'month', 'day', 'weekday'].indexOf(first.grain) >= 0;
    }

    spec(model) {
      const o = this.opts;
      const r = this.resolve(model);
      const t = Types.get(r.type);
      const pareto = t.mode === 'pareto';
      const timeLike = !pareto && this._timeLike();
      return LQ.ChartData.fromModel(model, r.vi, { mode: t.mode, orient: t.orient, arrange: o.arrange, area: false, swap: o.swap,
        top: t.mode === 'line' ? 0 : o.top, sort: pareto ? 'value' : 'keep', timeLike: timeLike, showValues: true });
    }

    /** 操作バー：種類（おすすめ＋4 種類）・並べ方・行と列の入れ替え・値・上位 N 件・グラフタブで編集 */
    _tools(model, spec) {
      const o = this.opts;
      const r = this.resolve(model);
      const types = h('div', { class: 'lq-chtypes__group' }, [
        h('button', { class: 'lq-chtype' + (o.type === 'auto' ? ' is-active' : ''), type: 'button', 'aria-pressed': o.type === 'auto' ? 'true' : 'false',
          title: 'おすすめ：' + r.rec.why, onclick: () => this.actions.setPivot({ type: 'auto' }) },
        [Dom.icon('wand-magic-sparkles'), h('span', { class: 'lq-chtype__label', text: 'おすすめ（' + Types.get(r.rec.type).label + '）' })])
      ].concat(PIVOT_TYPES.map((id) => typeButton(Types.get(id), { active: o.type === id, onClick: () => this.actions.setPivot({ type: id }) }))));
      const tools = [h('div', { class: 'lq-chtypes', role: 'toolbar', 'aria-label': 'グラフの種類' }, types)];
      if (spec.series.length > 1 && spec.mode !== 'donut' && spec.mode !== 'pareto') {
        const current = spec.mode === 'line' ? null : (o.arrange === 'auto' ? spec.arrange : o.arrange);
        if (current) tools.push(new LQ.Segmented(ARRANGE, current, (v) => this.actions.setPivot({ arrange: v })).el);
      }
      if (model.colHeaders.length) {
        tools.push(h('button', { class: 'lq-btn lq-btn--sm' + (o.swap ? ' is-on' : ''), type: 'button', 'aria-pressed': o.swap ? 'true' : 'false',
          title: '項目（行）と系列（列）を入れ替える', onclick: () => this.actions.setPivot({ swap: !o.swap }) }, [Dom.icon('right-left'), '行と列を入れ替え']));
      }
      if (model.values.length > 1) {
        const sel = h('select', { class: 'lq-select lq-select--sm', title: '描く値' });
        UI.fillSelect(sel, model.values.map((v, i) => ({ value: String(i), label: v.label })), String(r.vi));
        sel.addEventListener('change', () => this.actions.setPivot({ value: Number(sel.value) }));
        tools.push(sel);
      }
      if (spec.mode !== 'line' && !spec.timeLike) tools.push(PivotChart.topSelect(o.top, (v) => this.actions.setPivot({ top: v })));
      tools.push(h('button', { class: 'lq-btn lq-btn--sm lq-btn--ghost', type: 'button', title: 'この形でグラフタブに新しいグラフを作り、細かく設定する',
        onclick: () => this.toChartTab(model) }, [Dom.icon('up-right-from-square'), 'グラフタブで編集']));
      return tools;
    }

    static topSelect(value, onChange) {
      const sel = h('select', { class: 'lq-select lq-select--sm', title: '項目が多いときに描く件数（残りは「その他」）' });
      UI.fillSelect(sel, [{ value: 'auto', label: '上位：自動' }, { value: '0', label: 'すべての項目' }, { value: '5', label: '上位 5 件' },
        { value: '10', label: '上位 10 件' }, { value: '20', label: '上位 20 件' }, { value: '30', label: '上位 30 件' }], String(value));
      sel.addEventListener('change', () => onChange(sel.value === 'auto' ? 'auto' : Number(sel.value)));
      return sel;
    }

    /**
     * 描画領域に描く（ピボットタブから呼ぶ）
     * @param {LQ.PivotModel} model
     * @param {LQ.ResultView} view
     * @param {HTMLElement|null} table 並べて表示するときの表（棒にポイントすると、対応するセルを強調する）
     */
    draw(model, view, table) {
      const spec = this.spec(model);
      this.frame.setTools(this._tools(model, spec));
      const s = this.state;
      this.frame.fileBase = (s.datasets.source ? Util.baseName(s.datasets.source.name) + '_' : '') + 'ピボット_' + spec.valueLabel;
      const scope = this.main.scopeText(view);
      const key = JSON.stringify([this.tab._key, this.opts]);
      this.table = table;
      this.frame.draw(key, () => Object.assign({}, spec, { title: spec.valueLabel + (spec.catTitle ? '：' + spec.catTitle + (spec.serTitle ? ' × ' + spec.serTitle : '') : ''),
        subtitle: '対象：' + scope + '・' + fmt(model.rowCount) + ' 行' }), {
        pick: (d, i) => {
          const entry = spec.pick(d, i);
          if (entry) this.main.drillView().open(entry, view, scope, null, { label: 'ピボットの設定', text: LQ.Aggregator.describe(s.aggregate) });
        },
        hover: (d, i) => this._link(d === null ? null : spec.cellAt(d, i))
      });
      for (const note of spec.notes) this.main.info.appendChild(UI.note('info', note));
      return this.frame.el;
    }

    /** 並べて表示しているとき、ポイントした棒に対応する表のセルを強調する */
    _link(cell) {
      const table = this.table;
      if (this.linked) this.linked.forEach((td) => td.classList.remove('is-linked'));
      this.linked = null;
      if (!table || !cell) return;
      this.linked = Array.from(table.querySelectorAll('td[data-r="' + cell.r + '"][data-c="' + cell.c + '"]'));
      this.linked.forEach((td) => td.classList.add('is-linked'));
      if (this.linked[0]) this.linked[0].scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    /** ピボットの形をグラフタブの新しいグラフにする（行・列の 1 つ目と、描いている値を使う） */
    toChartTab(model) {
      const s = this.state;
      const agg = s.aggregate;
      const r = this.resolve(model);
      const v = model.values[r.vi];
      const o = this.opts;
      const rows = agg.rows.filter((f) => f.key !== LQ.PivotSettings.COND_ROW);
      if (!rows.length) {
        this.ctx.toasts.show({ type: 'warn', title: 'グラフタブでは「② の行」を使えません', message: '行に ① の列を置いてから、もう一度押してください。' });
        return;
      }
      const x = o.swap && agg.cols.length ? agg.cols[0] : rows[0];
      const color = o.swap && agg.cols.length ? rows[0] : agg.cols[0];
      const fn = Settings.FNS.indexOf(v.fn) >= 0 ? v.fn : 'avg';
      const created = this.actions.add({ name: '', target: agg.target, type: r.type, typeLocked: true,
        slots: { x: [x], y: [{ key: v.key, grain: null, fn: fn }], color: color ? [color] : [] },
        opts: { arrange: o.arrange, top: o.top } });
      if (!created) return;
      s.setTab('chart');
      s.openPanel('chart');
      const notes = [];
      if (rows.length > 1 || agg.cols.length > 1) notes.push('グラフタブでは、行と列の 1 つ目の項目を使います');
      if (v.show !== 'value') notes.push('% の表示は「100%」の並べ方で表せます');
      if (v.fn === 'stdev') notes.push('標準偏差は平均にしました（ばらつきは「箱ひげ・バイオリン」で見られます）');
      this.ctx.toasts.show({ type: 'success', title: 'グラフタブに新しいグラフを作りました', message: notes.join('。') });
    }
  }

  LQ.ChartActions = ChartActions;
  LQ.ChartFrame = ChartFrame;
  LQ.PivotChart = PivotChart;
  LQ.chartTypeButton = typeButton;
  LQ.chartKindOf = kindOf;
})(window);
