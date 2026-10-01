/* =========================================================================
 * LightQuery - lq-ui-aggregate.js
 * 集計の画面：集計タブと集計パネル
 * （下の区切りごとに独立した部品。読み込み順どおりに並べている）
 * ========================================================================= */

/* =========================================================================
 * ── 集計タブ ──
 * 集計タブ：抽出結果（表示中の絞り込みを反映）を集計した表を、メイン領域の表・注意帯・ページ送りに描く。
 *   計算結果は「結果・絞り込み・照合ルール・集計の設定・抽出条件の名前」が同じあいだ使い回す。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Dom = LQ.Dom;
  const Util = LQ.Util;
  const UI = LQ.UI;
  const h = Dom.h;
  const fmt = Util.formatInt;

  class AggregateTab {
    /** @param {LQ.MainView} main 表・注意帯・ページ送りを持つメイン領域 */
    constructor(main) {
      this.main = main;
      this.state = main.state;
      this._key = null;
      this._computed = null;
      this._pending = false;
      this._error = null;
      this._token = null;
    }

    /** 今の集計結果（集計できない状態なら null）。出力にも使う */
    computed() {
      const s = this.state;
      const view = this.main.resultView();
      if (!view || !LQ.AggregateSettings.isActive(s.aggregate)) return null;
      const names = view.parts.map((p, i) => view.partName(i));
      const key = JSON.stringify([view.result.id, view.filter, s.rules, s.aggregate, names]);
      if (key !== this._key) {
        this._key = key;
        this._error = null;
        if (this._token) this._token.cancel();
        this._token = null;
        if (s.aggregate.mode === 'condRows') this._startByCondition(view, s.aggregate, key);
        else {
          this._pending = false;
          this._computed = LQ.Aggregator.compute(view, s.aggregate);
        }
      }
      return this._pending ? null : this._computed;
    }

    /** ② の行ごとの集計は照合し直すため、画面を止めずに計算し、終わったら描き直す */
    _startByCondition(view, settings, key) {
      const token = new LQ.CancelToken();
      this._token = token;
      this._pending = true;
      this._computed = null;
      const done = () => {
        if (token.cancelled || key !== this._key) return false;
        this._pending = false;
        this._token = null;
        this.main.ctx.bus.emit('change', { topic: 'aggregate-ready' });
        return true;
      };
      LQ.Aggregator.computeByCondition(view, settings, this.main.ctx.engine, token).then((c) => {
        if (c && !token.cancelled && key === this._key) this._computed = c;
        done();
      }).catch((err) => {
        if (key === this._key) this._error = err.message;
        done();
      });
    }

    get pending() {
      return this._pending;
    }

    /** タブの件数表示 */
    tabCount() {
      const s = this.state;
      if (!s.result) return '未実行';
      if (!LQ.AggregateSettings.isActive(s.aggregate)) return '未設定';
      const c = this.computed();
      if (this._pending) return '集計中…';
      return c ? fmt(c.groupCount) + ' グループ' : '';
    }

    render() {
      const s = this.state;
      const main = this.main;
      main.tools.appendChild(h('button', { class: 'lq-btn lq-btn--sm', type: 'button', title: 'グループにする列・集計する値・順位を設定する',
        onclick: () => s.togglePanel('aggregate') }, [Dom.icon('calculator'), '集計の設定']));
      if (!s.result) {
        main.grid.showEmpty(main._emptyMessage('calculator', 'まだ抽出していません', '抽出すると、その結果をグループごとに集計できます（件数・合計・平均・標準偏差・最小・最大・順位）。右上のボタンから進めてください。'));
        return;
      }
      if (!LQ.AggregateSettings.isActive(s.aggregate)) {
        main.grid.showEmpty(main._emptyMessage('calculator', '集計する値がありません', '「集計の設定」で、件数か集計する値を選んでください。',
          h('button', { class: 'lq-btn', type: 'button', onclick: () => s.openPanel('aggregate') }, [Dom.icon('calculator'), '集計を設定する'])));
        return;
      }
      const view = main.resultView();
      const c = this.computed();
      if (this._pending || !c) {
        main.grid.showEmpty(main._emptyMessage(this._pending ? 'spinner' : 'triangle-exclamation', this._pending ? '② の行ごとに集計しています…' : '集計できませんでした',
          this._pending ? '抽出条件ごとに ① と ② をすべての組み合わせで照合し直しています。終わると表が表示されます。' : (this._error || '設定を見直してください。')));
        return;
      }
      this._renderSummary(view, c);
      main._renderFilterBar(view);
      if (s.isStale()) {
        main.info.appendChild(UI.note('warn', h('span', {}, [h('strong', { text: '条件または照合ルールが変更されています。' }),
          '集計は変更前の抽出結果から計算しています。右上のボタンで再抽出すると反映されます。'])));
      }
      if (c.missing.length) main.info.appendChild(UI.note('warn', '次の列は今の抽出結果にないため、集計から外しました：' + c.missing.join('、') + '。'));
      if (c.notes.length) main.info.appendChild(UI.note('info', h('div', {}, c.notes.map((n) => h('div', { text: n })))));
      if (!c.rows.length) {
        main.grid.showEmpty(main._emptyMessage('calculator', '集計する行がありません', '表示中の抽出結果が 0 行です。絞り込みを「すべて」にするか、条件を見直してください。'));
        return;
      }
      const paging = main._paging('aggregate', c.rows.length);
      const rows = c.rows.slice(paging.start, paging.start + s.view.pageSize);
      main.grid.render({
        mode: 'data',
        role: 'aggregate',
        scrollKey: 'aggregate:' + paging.page + ':' + this._key,
        columns: c.header.map((name) => ({ key: name, label: name, letter: '' })),
        rows: rows.map((cells, i) => ({ head: { text: fmt(paging.start + i + 1) }, cells: cells })),
        numeric: c.numeric
      });
      main.gridwrap.classList.toggle('is-stale', s.isStale());
      main._renderPager('aggregate', c.rows.length, paging);
    }

    _renderSummary(view, c) {
      const s = this.state;
      const scope = view.filter === null ? '抽出結果すべて' : (view.filter < 0 ? '該当なしの行' : '「' + view.partName(view.filter) + '」の行');
      this.main.info.appendChild(h('div', { class: 'lq-summary' }, [
        h('span', { class: 'lq-summary__main' }, [Dom.icon('calculator'), fmt(c.groupCount) + ' グループ']),
        h('span', { class: 'lq-summary__item lq-num', text: '対象：' + scope + ' ' + fmt(c.rowCount) + ' 行' }),
        h('span', { class: 'lq-summary__item', text: LQ.Aggregator.describe(s.aggregate) })
      ]));
    }
  }

  LQ.AggregateTab = AggregateTab;
})(window);

/* =========================================================================
 * ── 集計パネル ──
 * 集計パネル：グループにする列（順序つき）・集計する値（件数＋列ごとの合計・平均・標準偏差・最小・最大）・順位の基準。
 *   変更はすぐ設定に反映し、集計タブの表を描き直す（抽出はやり直さない）。設定はブラウザに記憶する。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Dom = LQ.Dom;
  const UI = LQ.UI;
  const Flash = LQ.Flash;
  const Settings = LQ.AggregateSettings;
  const h = Dom.h;

  const GROUPABLE_META = ['m:profile', 'm:priority'];
  const MEASURABLE_META = ['m:count'];
  const NUMERIC_SAMPLE = 200;
  const NUMERIC_RATIO = 0.8;
  const KIND_LABEL = { 's:': '① 元データ', 'c:': '② 条件データ', 'm:': '根拠' };

  function iconButton(icon, title, onClick, disabled) {
    const btn = UI.iconButton(icon, title, onClick, 'lq-btn--sm');
    btn.disabled = !!disabled;
    return btn;
  }

  class AggregatePanel {
    constructor(ctx) {
      this.ctx = ctx;
      this.state = ctx.state;
      this.app = ctx.app;
      this.title = '集計';
      this.icon = 'calculator';
      this.size = 'md';
      this.body = h('div');
      this.el = h('div', {}, [this.body]);
      ['aggregate', 'output', 'datasets', 'profiles'].forEach((topic) => ctx.bus.on(topic, () => this.render()));
      this.render();
    }

    headerActions() {
      return [h('button', { class: 'lq-btn lq-btn--ghost lq-btn--sm', type: 'button', title: '集計タブで結果を見る',
        onclick: () => this.state.setTab('aggregate') }, [Dom.icon('table'), '集計を表示'])];
    }

    get settings() {
      return this.state.aggregate;
    }

    /** 設定を変えて反映の合図を出す */
    _change(mutate, flashEl) {
      const next = LQ.Util.clone(this.settings);
      mutate(next);
      this.state.setAggregate(next);
      if (flashEl) Flash.el(flashEl);
    }

    /** 列の候補：出力列の一覧にあるキー（表示していない列も含む） */
    _keys(meta) {
      return this.state.output.columns.map((c) => c.key).filter((k) => k.slice(0, 2) !== 'm:' || meta.indexOf(k) !== -1);
    }

    _options(keys) {
      const groups = ['s:', 'c:', 'm:'].map((prefix) => ({
        group: KIND_LABEL[prefix],
        items: keys.filter((k) => k.slice(0, 2) === prefix).map((k) => ({ value: k, label: LQ.ResultView.nameOf(k) }))
      }));
      return groups.filter((g) => g.items.length);
    }

    /** ① の列のうち、値の 8 割以上が数値の列（集計する値の初期候補） */
    _numericKeys() {
      const src = this.state.datasets.source;
      if (!src) return [];
      return src.columns.filter((col, c) => {
        let seen = 0;
        let nums = 0;
        for (let r = 0; r < src.rowCount && seen < NUMERIC_SAMPLE; r++) {
          const v = src.cell(r, c);
          if (LQ.Normalizer.isBlank(v)) continue;
          seen++;
          if (!Number.isNaN(LQ.ValueParser.parseNumber(v))) nums++;
        }
        return seen > 0 && nums / seen >= NUMERIC_RATIO;
      }).map((col) => 's:' + col.name);
    }

    render() {
      Dom.clear(this.body);
      const keys = this._keys(GROUPABLE_META);
      if (!keys.length) {
        this.body.appendChild(UI.note('info', '① を読み込むと、集計に使う列を選べます。'));
        return;
      }
      const byCond = this.settings.mode === 'condRows';
      Dom.append(this.body, [this._modeSection(), byCond ? this._condRowsNote() : this._groupSection(keys), this._measureSection(), this._rankSection(), this._footNotes()]);
    }

    /* ---------------- 集計のしかた（② の行ごと／列を選ぶ） ---------------- */

    _modeSection() {
      const st = this.settings;
      const modes = Settings.MODES;
      const desc = h('p', { class: 'lq-field__hint', text: (modes.find((m) => m.id === st.mode) || modes[1]).desc });
      const seg = new LQ.Segmented(modes.map((m) => ({ value: m.id, label: m.label, icon: m.icon, title: m.desc })), st.mode,
        (v) => this._change((x) => {
          x.mode = v;
        }, seg.el), 'lq-seg--block');
      return UI.section('集計のしかた', [seg.el, desc]);
    }

    _condRowsNote() {
      const s = this.state;
      const linked = s.profiles.enabled().filter((p) => !!p.condition);
      return UI.section('グループ', [
        UI.note(linked.length ? 'info' : 'warn', linked.length
          ? '② 条件データの 1 行が 1 グループです（' + linked.map((p) => '「' + p.name + '」' + LQ.Util.formatInt(p.condition.rowCount) + ' 行').join('・') +
            '）。① の行が ② の複数の行に一致したときは、一致したすべての行に数えます。'
          : '② 条件データを使う抽出条件がありません。② を読み込むか「列を選んで集計」を使ってください。')
      ]);
    }

    /* ---------------- グループにする列 ---------------- */

    _groupSection(keys) {
      const st = this.settings;
      const list = h('ol', { class: 'lq-agglist' });
      st.groupBy.forEach((key, i) => {
        const move = (d) => this._change((s) => {
          const [k] = s.groupBy.splice(i, 1);
          s.groupBy.splice(i + d, 0, k);
        }, list);
        list.appendChild(h('li', { class: 'lq-agglist__item' }, [
          h('span', { class: 'lq-badge lq-badge--rank', text: String(i + 1) }),
          UI.sourceBadge(key.slice(0, 2)),
          h('span', { class: 'lq-agglist__name', text: LQ.ResultView.nameOf(key) + (keys.indexOf(key) < 0 ? '（今は読み込まれていません）' : '') }),
          iconButton('arrow-up', '上（大きなまとまり）へ', () => move(-1), i === 0),
          iconButton('arrow-down', '下（細かいまとまり）へ', () => move(1), i === st.groupBy.length - 1),
          UI.iconButton('xmark', 'この列でのグループ分けをやめる', () => this._change((s) => s.groupBy.splice(i, 1), list), 'lq-btn--sm')
        ]));
      });
      const rest = keys.filter((k) => st.groupBy.indexOf(k) === -1);
      const full = st.groupBy.length >= Settings.MAX_GROUPS;
      const add = h('select', { class: 'lq-select', disabled: full || !rest.length,
        title: full ? 'グループにする列は最大 ' + Settings.MAX_GROUPS + ' 列です' : 'グループにする列を追加します' });
      UI.fillSelect(add, this._options(rest), '', full ? '最大 ' + Settings.MAX_GROUPS + ' 列まで選べます' : '＋ グループにする列を追加…');
      add.addEventListener('change', () => {
        if (add.value) this._change((s) => s.groupBy.push(add.value), list);
      });
      return UI.section('グループにする列（上から順に分けます）', [
        st.groupBy.length ? list : h('p', { class: 'lq-field__hint', text: '選ばないと、全体を 1 行に集計します。' }),
        add
      ]);
    }

    /* ---------------- 集計する値 ---------------- */

    _measureSection() {
      const st = this.settings;
      const all = this._keys(MEASURABLE_META);
      const keys = st.mode === 'condRows' ? all.filter((k) => k.slice(0, 2) === 's:') : all;
      const box = h('div', { class: 'lq-aggmeasures' });
      const count = UI.switchToggle('件数（グループの行数）', st.count, (checked) => this._change((s) => {
        s.count = checked;
      }, box));
      box.appendChild(count.el);
      st.measures.forEach((m, i) => {
        const col = h('select', { class: 'lq-select lq-select--sm', title: '集計する列' });
        UI.fillSelect(col, this._options(keys.indexOf(m.key) < 0 ? keys.concat([m.key]) : keys), m.key);
        col.addEventListener('change', () => this._setMeasure(i, { key: col.value }, box));
        const fn = h('select', { class: 'lq-select lq-select--sm', title: '集計のしかた' });
        UI.fillSelect(fn, Settings.FUNCS.map((f) => ({ value: f.id, label: f.label })), m.fn);
        fn.addEventListener('change', () => this._setMeasure(i, { fn: fn.value }, box));
        box.appendChild(h('div', { class: 'lq-aggmeasure' }, [col, h('span', { class: 'lq-cond__ga', text: 'の' }), fn,
          UI.iconButton('xmark', 'この値の集計をやめる', () => this._change((s) => s.measures.splice(i, 1), box), 'lq-btn--sm')]));
      });
      const full = st.measures.length >= Settings.MAX_MEASURES;
      const addBtn = h('button', { class: 'lq-btn lq-btn--sm', type: 'button', disabled: full,
        title: full ? '集計する値は最大 ' + Settings.MAX_MEASURES + ' 個です' : '集計する列と集計のしかたを追加します',
        onclick: () => this._addMeasure(keys, box) }, [Dom.icon('plus'), '値を追加']);
      const funcs = Settings.FUNCS.filter((f) => f.note).map((f) => f.label + '：' + f.note).join('。');
      return UI.section('集計する値', [box, addBtn,
        h('p', { class: 'lq-field__hint', text: '数値として読めない値と空欄は除いて計算し、除いた件数を集計タブに表示します。' + funcs + '。' })]);
    }

    _setMeasure(i, patch, flashEl) {
      const next = Object.assign({}, this.settings.measures[i], patch);
      const dup = this.settings.measures.some((m, j) => j !== i && Settings.measureId(m) === Settings.measureId(next));
      if (dup) {
        this.ctx.toasts.show({ type: 'info', title: '同じ集計がすでにあります', message: Settings.measureLabel(next) + ' は追加済みです。' });
        this.render();
        return;
      }
      this._change((s) => {
        const oldId = Settings.measureId(s.measures[i]);
        s.measures[i] = next;
        if (s.rank && s.rank.target === oldId) s.rank.target = Settings.measureId(next);
      }, flashEl);
    }

    /** 数値の列を優先し、まだ合計していない列を「合計」で加える */
    _addMeasure(keys, flashEl) {
      const used = new Set(this.settings.measures.map(Settings.measureId));
      const prefer = this._numericKeys().filter((k) => keys.indexOf(k) !== -1).concat(keys);
      const key = prefer.find((k) => !used.has('sum|' + k)) || keys[0];
      const fn = used.has('sum|' + key) ? Settings.FUNCS.find((f) => !used.has(f.id + '|' + key)).id : 'sum';
      this._change((s) => s.measures.push({ key: key, fn: fn }), flashEl);
    }

    /* ---------------- 順位 ---------------- */

    _rankSection() {
      const st = this.settings;
      const targets = Settings.targets(st);
      const box = h('div', { class: 'lq-aggrank' });
      const select = h('select', { class: 'lq-select', disabled: !targets.length, title: targets.length ? '順位を付ける基準' : '件数か集計する値を選ぶと、順位を付けられます' });
      UI.fillSelect(select, [{ value: '', label: '順位を付けない' }].concat(targets.map((t) => ({ value: t.id, label: t.label + ' で順位を付ける' }))), st.rank ? st.rank.target : '');
      select.addEventListener('change', () => this._change((s) => {
        s.rank = select.value ? { target: select.value, dir: s.rank ? s.rank.dir : 'desc' } : null;
      }, box));
      const dir = new LQ.Segmented([
        { value: 'desc', label: '大きい順（最大が 1 位）', icon: 'arrow-down-wide-short' },
        { value: 'asc', label: '小さい順（最小が 1 位）', icon: 'arrow-up-short-wide' }
      ], st.rank ? st.rank.dir : 'desc', (v) => this._change((s) => {
        if (s.rank) s.rank.dir = v;
      }, box), 'lq-seg--block');
      dir.el.hidden = !st.rank;
      Dom.append(box, [select, dir.el]);
      return UI.section('順位', [box, h('p', { class: 'lq-field__hint', text: '同じ値は同じ順位にし、次の順位を飛ばします（Excel の RANK.EQ と同じ）。順位を付けると集計タブは順位の順に並びます。' })]);
    }

    _footNotes() {
      const reset = h('button', { class: 'lq-btn lq-btn--xs', type: 'button', title: '集計の設定を初期状態（件数のみ）に戻す（元に戻せます）', onclick: () => {
        const snap = this.state.snapshot();
        this.state.setAggregate(Settings.create());
        this.ctx.toasts.show({ type: 'success', title: '集計の設定を初期状態に戻しました', message: '件数だけを集計する状態です。',
          actions: [{ label: '元に戻す', icon: 'rotate-left', onClick: () => this.app.restore(snap, '集計の設定を元に戻しました') }] });
      } }, [Dom.icon('rotate-left'), '初期状態に戻す']);
      return UI.section('集計の対象', [
        UI.note('info', '抽出結果のうち、表示中の行（抽出条件での絞り込みを反映）を集計します。抽出をやり直さなくても、設定を変えるとすぐ集計タブに反映します。'),
        UI.note('tip', 'Excel に出力するときは「集計」シートを付けられます。集計タブを表示中に CSV・コピーで出力すると、集計の表を出力します。')
      ], [reset]);
    }
  }

  LQ.AggregatePanel = AggregatePanel;
})(window);
