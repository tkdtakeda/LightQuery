/* =========================================================================
 * LightQuery - lq-ui-chart-tab.js
 * グラフタブ：行のデータ（抽出結果または ① の全行）からグラフを描く。
 *   ・1 枚：選んでいるグラフを大きく描く。上の操作バーで種類を変え、右端で画像に保存・コピーする
 *   ・一覧：グラフが複数あるとき、すべてを並べて見比べる（ダッシュボード）。カードの「1 枚で表示」で大きく描く
 *   ・棒・点を押すと内訳、散布図・バブル図はドラッグで範囲を囲むと、そこに入った行を内訳に出す
 *   描く内容はグラフごとに、対象・結果・絞り込み・照合ルール・設定が同じあいだ使い回す
 *   （共通の部品は lq-ui-chart.js、設定パネルは lq-ui-chart-panel.js）
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
  const typeButton = LQ.chartTypeButton;
  const kindOf = LQ.chartKindOf;

  const VIEWS = [
    { value: 'single', label: '1 枚', icon: 'square', title: '選んでいるグラフを大きく表示する' },
    { value: 'grid', label: '一覧', icon: 'table-cells-large', title: 'すべてのグラフを並べて見比べる' }
  ];

  class ChartTab {
    /** @param {LQ.MainView} main */
    constructor(main) {
      this.main = main;
      this.ctx = main.ctx;
      this.state = main.state;
      this.actions = new LQ.ChartActions(main.ctx);
      this.frame = new LQ.ChartFrame(main.ctx);
      this._cache = new Map();
      this._cards = new Map();
      this.gridEl = h('div', { class: 'lq-chgrid' });
    }

    chart() {
      return Settings.active(this.state.charts);
    }

    target(chart) {
      const s = this.state;
      return LQ.PivotSettings.effectiveTarget({ target: chart ? chart.target : 'result' }, !!s.datasets.source, !!s.result);
    }

    view(chart) {
      const t = this.target(chart);
      return t ? this.main.targetView(t) : null;
    }

    /** グラフの描く内容（描けなければ {error}。未設定・対象がなければ null）。グラフごとに使い回す */
    specOf(chart) {
      const s = this.state;
      const view = this.view(chart);
      if (!view || !Settings.isConfigured(chart)) return null;
      const names = view.parts.map((p, i) => view.partName(i));
      const key = JSON.stringify([view.result.id, view.filter, s.rules, chart.target, chart.type, chart.slots, chart.opts, names]);
      const hit = this._cache.get(chart.id);
      if (hit && hit.key === key) return hit.spec;
      let spec;
      try {
        spec = LQ.ChartData.build(view, chart, kindOf(s));
      } catch (err) {
        spec = { error: 'exception', message: '描けませんでした：' + err.message };
      }
      this._cache.set(chart.id, { key: key, spec: spec });
      return spec;
    }

    /** 選んでいるグラフの描く内容 */
    computed() {
      const chart = this.chart();
      return chart ? this.specOf(chart) : null;
    }

    /** 一覧で表示するか（グラフが 2 枚以上あるときだけ） */
    get gridMode() {
      const all = this.state.charts;
      return all.view === 'grid' && all.items.length > 1;
    }

    tabCount() {
      const s = this.state;
      if (!s.datasets.source) return '未読み込み';
      const chart = this.chart();
      if (!Settings.isConfigured(chart)) return '未設定';
      const spec = this.computed();
      if (spec && spec.error && !this.gridMode) return '要設定';
      const n = s.charts.items.length;
      return n > 1 ? n + ' 枚' : Types.get(chart.type).label;
    }

    _setupButton(label) {
      const s = this.state;
      return s.panel === 'chart' ? null : h('button', { class: 'lq-btn lq-btn--primary', type: 'button', onclick: () => s.openPanel('chart') }, [Dom.icon('chart-column'), label]);
    }

    render() {
      const s = this.state;
      const main = this.main;
      if (s.charts.items.length > 1 && s.datasets.source) {
        main.tools.appendChild(new LQ.Segmented(VIEWS, this.gridMode ? 'grid' : 'single', (v) => this.actions.setView(v)).el);
      }
      main.tools.appendChild(h('button', { class: 'lq-btn lq-btn--sm', type: 'button', title: 'グラフの種類・項目・表示を設定する',
        onclick: () => s.togglePanel('chart') }, [Dom.icon('sliders'), 'グラフの設定']));
      this._prune();
      if (!s.datasets.source) {
        this.frame.clear();
        main.grid.showEmpty(main._emptyMessage('chart-column', '① 元データを読み込むとグラフを作れます',
          '② を使わずに ① だけでも作れます。抽出したあとは、その抽出結果でも作れます。比較（棒・パレート図）・推移（折れ線）・構成（ドーナツ）・' +
          '分布（ヒストグラム・箱ひげ・バイオリン・累積分布）・関係（散布図・バブル図）を描けます。'));
        return;
      }
      if (this.gridMode) {
        this._renderGrid();
        return;
      }
      this._renderSingle();
    }

    /** 削除したグラフのカードと記憶を片付ける */
    _prune() {
      const ids = new Set(this.state.charts.items.map((c) => c.id));
      this._cards.forEach((card, id) => {
        if (ids.has(id)) return;
        card.frame.clear();
        this._cards.delete(id);
      });
      this._cache.forEach((v, id) => {
        if (!ids.has(id)) this._cache.delete(id);
      });
    }

    /* ---------------- 1 枚 ---------------- */

    _renderSingle() {
      const s = this.state;
      const main = this.main;
      const chart = this.chart();
      this._renderChips();
      if (!chart) {
        this.frame.clear();
        main.grid.showEmpty(main._emptyMessage('chart-column', chart ? 'まだ項目を置いていません' : 'まだグラフがありません',
          '「グラフの設定」で列を押すと、列の組み合わせに合うグラフを選んですぐ描きます（数値 1 つ → ヒストグラム、数値 2 つ → 散布図、数値 3 つ → バブル図、' +
          '文字＋数値 → 横棒、日付＋数値 → 折れ線）。種類を先に選んでから列を入れることもできます。', this._setupButton('グラフを設定する')));
        return;
      }
      const view = this.view(chart);
      const spec = this.computed();
      this._renderSummary(chart, view, spec);
      if (this.target(chart) === 'result') {
        main._renderFilterBar(view);
        if (s.isStale()) {
          main.info.appendChild(UI.note('warn', h('span', {}, [h('strong', { text: '条件または照合ルールが変更されています。' }),
            'グラフは変更前の抽出結果から描いています。右上のボタンで再抽出すると反映されます。'])));
        }
      }
      /* 描けないときも操作バー（種類）は残し、別の種類にすぐ戻せるようにする。理由は描画領域の中に出す */
      if (!spec || spec.error) {
        this.frame.setTools(this._typeButtons(chart));
        main.grid.showNode(this.frame.el);
        main.gridwrap.classList.add('is-chart');
        const text = !spec ? 'まだ項目を置いていません。「グラフの設定」で列を押すか、上で種類を選んでから列を入れてください。'
          : (spec.error === 'fit' ? 'あと少しで描けます：' : '描けませんでした：') + spec.message;
        this.frame.message(text, this._setupButton('グラフの設定を開く'));
        return;
      }
      if (spec.missing && spec.missing.length) main.info.appendChild(UI.note('warn', '次の項目は今の対象にないため外しました：' + spec.missing.join('、') + '。'));
      if (spec.notes.length) main.info.appendChild(UI.note('info', h('div', {}, spec.notes.map((n) => h('div', { text: n })))));
      this.frame.setTools(this._typeButtons(chart));
      main.grid.showNode(this.frame.el);
      main.gridwrap.classList.add('is-chart');
      main.gridwrap.classList.toggle('is-stale', this.target(chart) === 'result' && s.isStale());
      this._draw(this.frame, chart, view, spec);
    }

    /** 描画領域にグラフ 1 枚を描く（内訳・範囲選択つき） */
    _draw(frame, chart, view, spec) {
      const s = this.state;
      const main = this.main;
      const scope = main.scopeText(view);
      const meta = { label: 'グラフの設定', text: Settings.describe(chart) };
      const open = (entry) => main.drillView().open(entry, view, scope, null, meta);
      frame.fileBase = (s.datasets.source ? Util.baseName(s.datasets.source.name) + '_' : '') + Settings.title(chart);
      frame.draw(JSON.stringify([this._cache.get(chart.id).key, Settings.title(chart), scope]),
        () => Object.assign({}, spec, { title: Settings.title(chart), subtitle: this._subtitle(spec, scope) }), {
          pick: (d, i) => {
            const entry = spec.pick(d, i);
            if (entry) open(entry);
          },
          select: (entry) => {
            if (!entry.keys.length) {
              this.ctx.toasts.show({ type: 'info', title: '囲んだ範囲に入る行はありません', message: '点のある範囲をドラッグで囲んでください。' });
              return;
            }
            open(entry);
          }
        });
    }

    _subtitle(spec, scope) {
      let text = '対象：' + scope + '・' + fmt(spec.rowCount) + ' 行';
      if (spec.kind === 'scatter' && spec.regression && !spec.bubble) {
        const r = spec.regression;
        text += '／相関係数 r = ' + r.r.toFixed(3) + '（' + LQ.ChartStats.correlationWord(r.r) + '）・R² = ' + r.r2.toFixed(3);
      }
      if (spec.kind === 'scatter' && spec.bubble) text += '／円の面積＝' + spec.sizeLabel;
      if (spec.kind === 'hist') text += '／区間の幅 ' + LQ.ChartStats.fullNumber(spec.bins.width) + '・' + spec.bins.count + ' 区間';
      return text;
    }

    /** 操作バーの種類のボタン：目的ごとに区切って並べる */
    _typeButtons(chart) {
      const kinds = Settings.placed(chart).map((p) => (p.item.key ? kindOf(this.state)(p.item.key) : 'count'));
      const rec = Advisor.recommendFor(chart, kindOf(this.state));
      const groups = Types.GROUPS.map((g) => h('div', { class: 'lq-chtypes__group', title: g.label + '：' + g.desc },
        Types.inGroup(g.id).map((t) => {
          const fit = Types.fitKinds(t, kinds);
          return typeButton(t, { active: chart.type === t.id, unfit: fit.ok ? '' : fit.reason, rec: !chart.typeLocked && rec === t.id && chart.type !== t.id,
            onClick: () => this.actions.setType(t.id), compact: true });
        })));
      return [h('div', { class: 'lq-chtypes', role: 'toolbar', 'aria-label': 'グラフの種類' }, groups)];
    }

    /** グラフが複数あれば、切り替えのボタンを並べる */
    _renderChips() {
      const all = this.state.charts;
      if (all.items.length < 2) return;
      const chips = all.items.map((c) => h('button', {
        class: 'lq-fchip' + (c.id === all.activeId ? ' is-active' : ''), type: 'button', title: Settings.describe(c),
        'aria-pressed': c.id === all.activeId ? 'true' : 'false', dataset: { focusKey: 'chart:' + c.id }, onclick: () => this.actions.select(c.id)
      }, [Dom.icon(Types.get(c.type).icon, Types.get(c.type).iconClass || ''), h('span', { class: 'lq-fchip__label', text: Settings.title(c) })]));
      this.main.info.appendChild(h('div', { class: 'lq-filterbar', role: 'toolbar', 'aria-label': '表示するグラフ' },
        [h('span', { class: 'lq-filterbar__label' }, [Dom.icon('images'), '表示するグラフ'])].concat(chips)));
    }

    _renderSummary(chart, view, spec) {
      const t = Types.get(chart.type);
      const items = [h('span', { class: 'lq-summary__main' }, [Dom.icon(t.icon, t.iconClass || ''), Settings.title(chart)]),
        h('span', { class: 'lq-summary__item', text: Settings.describe(chart) })];
      if (spec && !spec.error) {
        items.push(h('span', { class: 'lq-summary__item lq-num', text: '対象：' + this.main.scopeText(view) + ' ' + fmt(spec.rowCount) + ' 行' }));
        items.push(h('span', { class: 'lq-summary__item lq-summary__hint' }, [Dom.icon('hand-pointer'),
          spec.brush ? '点を押すと内訳・ドラッグで範囲を囲むとその中の行を表示' : '棒・点を押すと内訳を表示']));
      }
      this.main.info.appendChild(h('div', { class: 'lq-summary' }, items));
    }

    /* ---------------- 一覧（ダッシュボード） ---------------- */

    _renderGrid() {
      const s = this.state;
      const main = this.main;
      const all = s.charts;
      const anyResult = all.items.some((c) => this.target(c) === 'result');
      main.info.appendChild(h('div', { class: 'lq-summary' }, [
        h('span', { class: 'lq-summary__main' }, [Dom.icon('table-cells-large'), 'グラフ ' + all.items.length + ' 枚を一覧で表示']),
        h('span', { class: 'lq-summary__item lq-summary__hint' }, [Dom.icon('up-right-and-down-left-from-center'), '「1 枚で表示」で大きく表示・種類を変更'])
      ]));
      if (anyResult && s.isStale()) {
        main.info.appendChild(UI.note('warn', '条件または照合ルールが変更されています。抽出結果を使うグラフは変更前の結果から描いています。'));
      }
      const cards = all.items.map((c) => this._card(c));
      if (cards.length !== this.gridEl.children.length || cards.some((card, i) => this.gridEl.children[i] !== card.el)) {
        Dom.clear(this.gridEl);
        cards.forEach((card) => this.gridEl.appendChild(card.el));
      }
      main.grid.showNode(this.gridEl);
      all.items.forEach((c) => this._drawCard(c));
    }

    _card(chart) {
      let card = this._cards.get(chart.id);
      if (!card) {
        const frame = new LQ.ChartFrame(this.ctx);
        frame.el.classList.add('lq-chart--card');
        card = { frame: frame, el: h('section', { class: 'lq-chcard' }, [frame.el]) };
        this._cards.set(chart.id, card);
      }
      card.el.classList.toggle('is-active', chart.id === this.state.charts.activeId);
      return card;
    }

    _drawCard(chart) {
      const card = this._cards.get(chart.id);
      const t = Types.get(chart.type);
      const enlarge = h('button', { class: 'lq-btn lq-btn--sm lq-btn--ghost', type: 'button', title: 'このグラフを大きく表示する（種類・項目も変えられます）',
        onclick: () => {
          this.actions.select(chart.id);
          this.actions.setView('single');
        } }, [Dom.icon('up-right-and-down-left-from-center'), '1 枚で表示']);
      card.frame.setTools([h('span', { class: 'lq-chcard__type' }, [Dom.icon(t.icon, t.iconClass || ''), t.label]), enlarge]);
      const view = this.view(chart);
      const spec = this.specOf(chart);
      if (!spec) {
        card.frame.message('「' + Settings.title(chart) + '」はまだ項目を置いていません。「1 枚で表示」から設定します。');
        return;
      }
      if (spec.error) {
        card.frame.message('「' + Settings.title(chart) + '」：' + spec.message);
        return;
      }
      this._draw(card.frame, chart, view, spec);
    }

    /* ---------------- 主要動作 ---------------- */

    /** 主要動作の「画像で保存」（1 枚の表示のとき） */
    save() {
      this.frame.save();
    }
  }

  LQ.ChartTab = ChartTab;
})(window);
