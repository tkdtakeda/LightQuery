/* =========================================================================
 * LightQuery - lq-ui-main.js
 * メイン領域：タブ（抽出結果 / ① / ②）、要約と注意帯、抽出条件ごとの絞り込み、表、ページ送り、
 *   空の状態（はじめに・次の一歩）。② のタブは選択中の抽出条件の ② を表示する。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Dom = LQ.Dom;
  const Util = LQ.Util;
  const UI = LQ.UI;
  const h = Dom.h;

  const RAW_COL_LIMIT = 200;
  const NUMERIC_RATIO = 0.8;
  const ROLE_TEXT = {
    source: { title: '① 元データ', icon: 'table', badge: ['src', '①'], label: '元データ', sub: '抽出される側のデータ（Excel・CSV）' },
    condition: { title: '② 条件データ', icon: 'list-check', badge: ['cond', '②'], label: '条件データ', sub: '条件の一覧（1 行＝1 セットの条件）' }
  };

  class MainView {
    constructor(ctx) {
      this.ctx = ctx;
      this.state = ctx.state;
      this.app = ctx.app;
      this.root = Dom.qs('#lqMain');
      this._rv = null;
      this._rvKey = null;
      this._scheduled = false;
      this._busyKind = null;
      this.tabs = h('div', { class: 'lq-tabs', role: 'tablist' });
      this.tools = h('div', { class: 'lq-tabbar__tools' });
      this.info = h('div', { class: 'lq-infobar' });
      this.gridwrap = h('div', { class: 'lq-gridwrap' });
      this.pager = h('div', { class: 'lq-pager' });
      Dom.append(this.root, [h('div', { class: 'lq-tabbar' }, [this.tabs, this.tools]), this.info, this.gridwrap, this.pager]);
      this.grid = new LQ.GridView(ctx, this.gridwrap, {
        onSort: (key) => this._cycleSort(key),
        onMove: (key, target, after) => this.state.moveColumn(key, target, after),
        onRowHead: (head, anchor) => this._onRowHead(head, anchor),
        onColHead: (col, anchor) => this.app.dialogs.openRawColMenu(anchor, this.state.view.tab, col)
      });
      LQ.FormNav.attach(this.pager);
      ctx.bus.on('change', (e) => this._schedule(e));
      this.render();
    }

    /* 進捗の更新だけでは表を描き直さない */
    _schedule(e) {
      if (e && e.topic === 'busy') {
        const kind = this.state.busy ? this.state.busy.kind : null;
        if (kind === this._busyKind) return;
        this._busyKind = kind;
      }
      if (this._scheduled) return;
      this._scheduled = true;
      global.requestAnimationFrame(() => {
        this._scheduled = false;
        this.render();
      });
    }

    /** 現在の結果の見せ方（絞り込み・並べ替え・ルールを反映）。抽出条件の名前は今の名前を表示する */
    resultView() {
      const s = this.state;
      if (!s.result) {
        this._rv = null;
        return null;
      }
      if (!this._rv || this._rv.result !== s.result) {
        this._rv = new LQ.ResultView(s.result, s.datasets.source, s.rules, (id) => {
          const p = s.profiles.find(id);
          return p ? p.name : null;
        });
        this._rvKey = null;
      }
      const filter = this._filterIndex(this._rv);
      const key = JSON.stringify([s.view.sort, s.rules, filter]);
      if (key !== this._rvKey) {
        this._rv.setRules(s.rules);
        this._rv.setFilter(filter);
        if (!this._rv.setSort(s.view.sort)) s.view.sort = null;
        this._rvKey = JSON.stringify([s.view.sort, s.rules, filter]);
      }
      return this._rv;
    }

    /** 絞り込みの指定（抽出条件の id）→ 結果の中の番号。結果にないものは解除する */
    _filterIndex(view) {
      const s = this.state;
      const f = s.view.filter;
      if (!f) return null;
      let idx = null;
      if (f === LQ.AppState.UNMATCHED_FILTER) idx = view.counts().unmatched ? -1 : null;
      else {
        const i = view.parts.findIndex((p) => p.id === f);
        idx = i >= 0 && view.multi ? i : null;
      }
      if (idx === null) s.view.filter = null;
      return idx;
    }

    render() {
      const tab = this.state.view.tab;
      this._renderTabs();
      Dom.clear(this.info);
      Dom.clear(this.tools);
      Dom.clear(this.pager);
      this.gridwrap.classList.remove('is-stale');
      if (tab === 'result') this._renderResult();
      else this._renderDataset(tab);
    }

    _renderTabs() {
      const s = this.state;
      const res = s.result;
      const specs = [
        { id: 'result', icon: 'filter', label: '抽出結果', count: res ? Util.formatInt(res.length) + ' 行' : '未実行', stale: s.isStale() },
        { id: 'source', role: 'source' },
        { id: 'condition', role: 'condition' }
      ];
      Dom.clear(this.tabs);
      specs.forEach((t) => {
        let lead;
        let label = t.label;
        let count = t.count;
        let sub = null;
        if (t.role) {
          const r = ROLE_TEXT[t.role];
          const ds = s.datasets[t.role];
          lead = UI.badge(r.badge[0], r.badge[1]);
          label = r.label;
          count = ds ? Util.formatInt(ds.rowCount) + ' 行' : '未読み込み';
          if (t.role === 'condition' && s.profiles.length > 1) sub = s.activeProfile.name;
        } else {
          lead = Dom.icon(t.icon);
        }
        this.tabs.appendChild(h('button', {
          class: 'lq-tab' + (s.view.tab === t.id ? ' is-active' : ''), type: 'button', role: 'tab', dataset: { tab: t.id },
          'aria-selected': s.view.tab === t.id ? 'true' : 'false',
          title: sub ? '選択中の抽出条件「' + sub + '」の ② を表示' : null,
          onclick: () => s.setTab(t.id)
        }, [lead, h('span', { text: label }), sub ? h('span', { class: 'lq-tab__sub', text: sub }) : null, h('span', { class: 'lq-tab__count', text: count }),
          t.stale ? h('span', { class: 'lq-tab__stale', title: '条件が変更され、結果に未反映です' }, [Dom.icon('triangle-exclamation'), ' 未反映']) : null]));
      });
    }

    /* ---------------- 抽出結果 ---------------- */

    _renderResult() {
      const s = this.state;
      if (!s.datasets.source) {
        this._renderWelcome();
        return;
      }
      if (!s.result) {
        this._renderSteps();
        return;
      }
      const view = this.resultView();
      const all = view.resolveColumns(s.output.columns);
      const defs = all.filter((d) => d.available);
      const unavailable = all.filter((d) => !d.available && !d.silent);
      this._renderResultTools(defs);
      this._renderSummary(view, defs);
      this._renderFilterBar(view);
      if (s.isStale()) {
        this.info.appendChild(UI.note('warn', h('span', {}, [h('strong', { text: '条件または照合ルールが変更されています。' }),
          '表示中の結果は変更前のものです。右上のボタンで再抽出すると反映されます。'])));
      }
      if (view.result.stats.truncated) {
        this.info.appendChild(UI.note('warn', '組み合わせが 1,000,000 行に達したため、途中で打ち切りました。条件を絞るか「最初の 1 行のみ」にしてください。'));
      }
      if (unavailable.length) {
        this.info.appendChild(UI.note('info', '表示を選んでいる列のうち ' + unavailable.length + ' 列（' +
          unavailable.map((d) => d.name).join('、') + '）は出力できません：' + unavailable[0].reason + '。'));
      }
      if (!defs.length) {
        this.grid.showEmpty(this._emptyMessage('table-columns', '表示する列がありません', '左の「出力列」で表示する列を選んでください。',
          h('button', { class: 'lq-btn', type: 'button', onclick: () => s.openPanel('output') }, [Dom.icon('table-columns'), '出力列を選ぶ'])));
        return;
      }
      if (!view.length && view.filter !== null) {
        const assign = view.result.stats.mode === 'assign';
        this.grid.showEmpty(this._emptyMessage('filter', 'この抽出条件の行はありません', view.filter < 0
          ? 'どの抽出条件にも該当しなかった行はありません。'
          : '「' + view.partName(view.filter) + '」の行はありません。' + (assign ? '条件に一致する行がないか、一致した行がすべて優先順位が上の抽出条件に入っています。' : '条件に一致する行がありません。'),
        h('button', { class: 'lq-btn', type: 'button', onclick: () => s.setFilter(null) }, [Dom.icon('list'), 'すべての行を表示'])));
        return;
      }
      const paging = this._paging('result', view.length);
      const rows = view.page(paging.start, s.view.pageSize, defs);
      const sort = s.view.sort;
      this.grid.render({
        mode: 'result',
        scrollKey: 'result:' + paging.page + ':' + view.result.id + ':' + JSON.stringify(sort),
        columns: defs.map((d) => ({ key: d.key, label: d.name, kind: d.kind, sortDir: sort && sort.key === d.key ? sort.dir : null })),
        rows: rows.map((r) => ({ head: { text: Util.formatInt(r.index + 1), index: r.index, action: 'explain', title: 'この行の判定根拠を表示' }, cells: r.cells })),
        numeric: this._numericColumns(rows, defs.length)
      });
      this.gridwrap.classList.toggle('is-stale', s.isStale());
      this._renderPager('result', view.length, paging);
    }

    _renderResultTools(defs) {
      const s = this.state;
      if (s.view.sort) {
        const name = LQ.ResultView.nameOf(s.view.sort.key);
        this.tools.appendChild(h('span', { class: 'lq-tag' }, [
          Dom.icon(s.view.sort.dir === 'desc' ? 'arrow-down-wide-short' : 'arrow-up-short-wide'),
          '並び順：' + name + '（' + (s.view.sort.dir === 'desc' ? '降順' : '昇順') + '）'
        ]));
        this.tools.appendChild(h('button', { class: 'lq-btn lq-btn--xs', type: 'button', title: '並べ替えを解除して元の順に戻す', onclick: () => s.setSort(null) },
          [Dom.icon('xmark'), '解除']));
      }
      const counts = s.columnCounts();
      const total = counts['s:'].total + counts['c:'].total + counts['m:'].total;
      this.tools.appendChild(h('button', { class: 'lq-btn lq-btn--sm', type: 'button', title: '表示・出力する列を選ぶ／並べ替える', onclick: () => s.togglePanel('output') },
        [Dom.icon('table-columns'), '列 ' + defs.length + ' / ' + total]));
    }

    _renderSummary(view, defs) {
      const res = view.result;
      const st = res.stats;
      const fmt = Util.formatInt;
      const detailsBtn = h('button', { class: 'lq-btn lq-btn--sm', type: 'button', title: '抽出条件・照合ルール・処理の内容を確認する',
        onclick: (e) => this.app.resultDialogs.openResultDetails(e.currentTarget) }, [Dom.icon('magnifying-glass'), '根拠を見る']);
      const time = h('span', { class: 'lq-summary__item lq-num' }, [Dom.icon('clock-rotate-left'), Util.formatSeconds(st.elapsedMs)]);
      const shown = h('span', { class: 'lq-summary__item lq-num', text: '表示 ' + fmt(view.length) + ' 行 × ' + defs.length + ' 列' });
      let items;
      if (!view.multi) {
        const part = res.parts[0];
        const ps = part.stats;
        const join = LQ.QueryEngine.JOIN_KINDS.find((j) => j.id === ps.joinKind);
        const match = LQ.QueryEngine.MATCH_MODES.find((m) => m.id === ps.matchMode);
        const none = st.outputRows === 0;
        const anti = ps.joinKind === 'anti';
        items = [
          h('span', { class: 'lq-summary__main' + (none ? ' is-none' : '') }, [Dom.icon(none ? 'triangle-exclamation' : 'circle-check'),
            anti ? fmt(ps.outputRows) + ' 行が一致しませんでした' : fmt(ps.matchedSources) + ' 行が一致']),
          h('span', { class: 'lq-summary__item lq-num', text: '① ' + fmt(st.sourceRows) + ' 行中 ' +
            Util.formatPercent((anti ? ps.outputRows : ps.matchedSources) / Math.max(1, st.sourceRows)) }),
          shown,
          h('span', { class: 'lq-summary__item', title: '条件の組み合わせ' }, [Dom.icon('code-branch'), h('span', { class: 'lq-summary__expr', text: part.snapshot.exprJa })]),
          h('span', { class: 'lq-summary__item', text: join.label + (ps.needsCondition && !anti ? '・' + match.label : '') }),
          time, detailsBtn
        ];
      } else {
        const mode = LQ.BatchRunner.COMBINE_MODES.find((m) => m.id === st.mode);
        const none = st.matchedSources === 0;
        items = [
          h('span', { class: 'lq-summary__main' + (none ? ' is-none' : '') }, [Dom.icon(none ? 'triangle-exclamation' : 'circle-check'), fmt(st.matchedSources) + ' 行が該当']),
          h('span', { class: 'lq-summary__item lq-num', text: '① ' + fmt(st.sourceRows) + ' 行中 ' + Util.formatPercent(st.matchedSources / Math.max(1, st.sourceRows)) }),
          h('span', { class: 'lq-summary__item', title: mode.desc }, [Dom.icon(mode.icon), '抽出条件 ' + res.parts.length + ' 件・' + mode.short]),
          shown, time, detailsBtn
        ];
      }
      this.info.appendChild(h('div', { class: 'lq-summary' }, items));
    }

    /** 抽出条件ごとの絞り込み（件数付き）。抽出条件が複数か「該当なし」があるときだけ出す */
    _renderFilterBar(view) {
      if (!view.multi) return;
      const s = this.state;
      const counts = view.counts();
      const assign = view.result.stats.mode === 'assign';
      const fmt = Util.formatInt;
      const chip = (value, label, count, title, rank) => {
        const active = view.filter === value;
        return h('button', {
          class: 'lq-fchip' + (active ? ' is-active' : '') + (value === -1 ? ' lq-fchip--none' : ''), type: 'button', title: title,
          'aria-pressed': active ? 'true' : 'false',
          onclick: () => s.setFilter(value === null ? null : (value < 0 ? LQ.AppState.UNMATCHED_FILTER : view.parts[value].id))
        }, [rank ? h('span', { class: 'lq-fchip__rank', text: rank }) : null, h('span', { class: 'lq-fchip__label', text: label }),
          h('span', { class: 'lq-fchip__count lq-num', text: fmt(count) })]);
      };
      const items = [chip(null, 'すべて', counts.total, '全 ' + fmt(counts.total) + ' 行を表示')];
      view.parts.forEach((part, i) => {
        const shadow = part.hits - part.assigned;
        const title = '「' + view.partName(i) + '」の行だけを表示' +
          (assign && shadow > 0 ? '（該当 ' + fmt(part.hits) + ' 行のうち ' + fmt(shadow) + ' 行は、優先順位が上の抽出条件に振り分けました）' : '');
        items.push(chip(i, view.partName(i), counts.per[i], title, String(part.priority)));
      });
      if (counts.unmatched || view.result.stats.includeUnmatched) items.push(chip(-1, '該当なし', counts.unmatched, 'どの抽出条件にも該当しなかった行だけを表示'));
      this.info.appendChild(h('div', { class: 'lq-filterbar', role: 'toolbar', 'aria-label': '抽出条件で絞り込み' },
        [h('span', { class: 'lq-filterbar__label' }, [Dom.icon('filter'), '表示する行'])].concat(items)));
    }

    _renderWelcome() {
      const card = (role) => {
        const r = ROLE_TEXT[role];
        const open = () => this.app.pickFile(role);
        return h('div', {
          class: 'lq-drop' + (role === 'condition' ? ' lq-drop--cond' : ''), role: 'button', tabindex: '0', title: r.title + 'のファイルを選択',
          onclick: open,
          onkeydown: (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              open();
            }
          }
        }, [Dom.icon(r.icon, 'lq-drop__icon'), h('div', { class: 'lq-drop__title', text: r.title }), h('div', { class: 'lq-drop__sub', text: r.sub }),
          h('div', { class: 'lq-drop__sub', text: 'クリックして選択／ここへドラッグ＆ドロップ／Ctrl+V で貼り付け' })]);
      };
      /* ② が抽出条件に読み込み済み（前回の保存から復元した場合など）なら、その状態を示して抽出条件パネルへ案内する */
      const condCard = () => {
        const s = this.state;
        const loaded = s.profiles.items.filter((p) => p.condition).length;
        if (!loaded) return card('condition');
        const open = () => s.openPanel('query');
        return h('div', {
          class: 'lq-drop lq-drop--cond lq-drop--done', role: 'button', tabindex: '0', title: '抽出条件パネルを開いて確認・変更する',
          onclick: open,
          onkeydown: (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              open();
            }
          }
        }, [Dom.icon('circle-check', 'lq-drop__icon'), h('div', { class: 'lq-drop__title', text: '② 条件データ（読み込み済み）' }),
          h('div', { class: 'lq-drop__sub', text: '抽出条件 ' + s.profiles.length + ' 件のうち ' + loaded + ' 件分を読み込み済みです' }),
          h('div', { class: 'lq-drop__sub', text: 'クリックで抽出条件を確認・変更。あとは ① 元データを読み込めば抽出できます' })]);
      };
      const sampleBtn = h('button', { class: 'lq-btn', type: 'button', onclick: () => this.app.dialogs.openSamples(sampleBtn, 'bottom-start') }, [Dom.icon('flask'), 'サンプルで試す']);
      this.grid.showEmpty(h('div', { class: 'lq-empty' }, [
        h('div', { class: 'lq-empty__title', text: '① と ② を読み込み、条件に一致する行を取り出します' }),
        h('p', { class: 'lq-empty__lead', text: '① 元データの各行を、② 条件データの各行（1 行＝1 セットの条件）と照らし合わせ、一致した行を表示・出力します。② は抽出条件ごとに持てるので、列の構成が違う表を複数使い、名前と優先順位で振り分けることもできます。Excel（.xlsx / .xls）と CSV に対応しています。' }),
        h('div', { class: 'lq-empty__cards' }, [card('source'), condCard()]),
        h('div', { class: 'lq-empty__links' }, [sampleBtn,
          h('button', { class: 'lq-btn lq-btn--ghost', type: 'button', onclick: () => this.app.manual.open() }, [Dom.icon('book-open'), '使い方を見る'])])
      ]));
    }

    _renderSteps() {
      const s = this.state;
      const steps = s.profiles.length > 1 ? this._multiSteps() : this._singleSteps();
      const list = h('ol', { class: 'lq-steps' });
      steps.forEach((step, i) => {
        if (i > 0) list.appendChild(h('li', { class: 'lq-step__arrow', 'aria-hidden': 'true' }, Dom.icon('chevron-right')));
        list.appendChild(h('li', { class: 'lq-step is-' + step.state }, [
          h('div', { class: 'lq-step__head' }, [Dom.icon(step.state === 'done' ? 'circle-check' : step.icon), step.title,
            step.state === 'done' ? h('span', { class: 'lq-status lq-status--ok', text: '済' }) : null]),
          h('div', { class: 'lq-step__text', text: step.text })
        ]));
      });
      this.grid.showEmpty(h('div', { class: 'lq-empty' }, [
        h('div', { class: 'lq-empty__title', text: 'あと少しで抽出できます' }),
        list,
        h('p', { class: 'lq-empty__lead', text: '次にすることは、画面右上の青いボタンに表示されています。抽出条件は左の「抽出条件」から確認・変更できます。' })
      ]));
    }

    _runStep(ready) {
      const s = this.state;
      return { icon: 'play', title: '抽出', state: ready ? 'current' : 'todo',
        text: s.busy && s.busy.kind === 'run' ? '抽出中です（右上で中止できます）' : '右上の「' + this.app.cta().label + '」' };
    }

    /** 抽出条件が 1 つのとき（① → ② → 条件 → 抽出） */
    _singleSteps() {
      const s = this.state;
      const v = this.app.validation();
      const src = s.datasets.source;
      const cond = s.datasets.condition;
      const hasConds = s.query.conditions.length > 0;
      const condNeeded = !hasConds || v.needsCondition || !v.ok;
      return [
        { icon: 'table', title: '① 元データ', state: 'done', text: src.name + '（' + Util.formatInt(src.rowCount) + ' 行）' },
        { icon: 'list-check', title: '② 条件データ', state: cond ? 'done' : (condNeeded ? 'current' : 'done'),
          text: cond ? cond.name + '（' + Util.formatInt(cond.rowCount) + ' 行）' : (condNeeded ? '読み込んでください（固定値だけの条件なら不要）' : '固定値だけの条件のため不要') },
        { icon: 'filter', title: '条件', state: hasConds && v.ok ? 'done' : ((cond || !condNeeded) ? 'current' : 'todo'),
          text: hasConds ? (v.ok ? LQ.Logic.toJapanese(v.ast) : v.errors[0].message) : '① と ② の列の対応を決めます' },
        this._runStep(hasConds && v.ok)
      ];
    }

    /** 抽出条件が複数のとき（① → 各 ② → 各抽出条件の条件 → 抽出） */
    _multiSteps() {
      const s = this.state;
      const src = s.datasets.source;
      const all = this.app.validationAll();
      const enabled = s.profiles.enabled();
      const need = enabled.filter((p) => !LQ.QueryOps.fixedOnly(p.query));
      const loaded = need.filter((p) => !!p.condition).length;
      const mode = LQ.BatchRunner.COMBINE_MODES.find((m) => m.id === s.combine.mode);
      const first = all.first;
      return [
        { icon: 'table', title: '① 元データ', state: 'done', text: src.name + '（' + Util.formatInt(src.rowCount) + ' 行）' },
        { icon: 'list-check', title: '② 条件データ', state: loaded === need.length ? 'done' : 'current',
          text: need.length ? '読み込み済み ' + loaded + ' / ' + need.length + ' 件（抽出条件ごと）' : '固定値だけの抽出条件のため不要' },
        { icon: 'filter', title: '抽出条件', state: all.ok ? 'done' : 'current',
          text: all.ok ? '有効 ' + enabled.length + ' 件・' + mode.short : (first ? '「' + first.profile.name + '」：' + first.issue.message : 'すべて無効です') },
        this._runStep(all.ok)
      ];
    }

    _emptyMessage(icon, title, lead, action) {
      return h('div', { class: 'lq-empty' }, [Dom.icon(icon, 'lq-drop__icon lq-muted'), h('div', { class: 'lq-empty__title', text: title }),
        h('p', { class: 'lq-empty__lead', text: lead }), action || null]);
    }

    /* ---------------- ① / ② のデータ表示 ---------------- */

    _renderDataset(role) {
      const s = this.state;
      const ds = s.datasets[role];
      const r = ROLE_TEXT[role];
      if (!ds) {
        const who = role === 'condition' && s.profiles.length > 1 ? '「' + s.activeProfile.name + '」の ' : '';
        const drop = h('div', { class: 'lq-drop' + (role === 'condition' ? ' lq-drop--cond' : ''), role: 'button', tabindex: '0', onclick: () => this.app.pickFile(role) },
          [Dom.icon(r.icon, 'lq-drop__icon'), h('div', { class: 'lq-drop__title', text: who + r.title + 'を読み込む' }), h('div', { class: 'lq-drop__sub', text: r.sub }),
            h('div', { class: 'lq-drop__sub', text: 'クリックして選択／ドラッグ＆ドロップ／Ctrl+V で貼り付け' })]);
        this.grid.showEmpty(h('div', { class: 'lq-empty' }, [h('div', { class: 'lq-empty__cards lq-empty__cards--single' }, drop)]));
        return;
      }
      const raw = s.view.raw[role];
      const seg = new LQ.Segmented([
        { value: false, label: 'データ', icon: 'table', title: '読み込んだ列と行を表示' },
        { value: true, label: '読み込み範囲', icon: 'crop-simple', title: '元のシートのまま表示し、ヘッダー行・開始行・開始列・終了行を確認' }
      ], raw, (value) => s.setRaw(role, value));
      this.tools.appendChild(seg.el);
      this.tools.appendChild(h('button', { class: 'lq-btn lq-btn--sm', type: 'button', onclick: () => s.togglePanel(role) }, [Dom.icon('sliders'), '読み込み設定']));
      this._renderDatasetSummary(ds, raw);
      const total = raw ? ds.rawRowCount : ds.rowCount;
      const paging = this._paging(role, total);
      if (raw) this.grid.render(this._rawModel(ds, paging));
      else this.grid.render(this._dataModel(ds, paging));
      this._renderPager(role, total, paging);
    }

    _renderDatasetSummary(ds, raw) {
      const src = ds.source;
      const set = ds.settings;
      const stored = src.storedRef;
      const kind = stored
        ? '保存データ（元：' + (stored.kindLabel || '不明') + (stored.sheetName ? '・シート「' + stored.sheetName + '」' : '') + '）'
        : src.kindLabel + (src.hasSheets ? '・シート「' + src.sheetName + '」' : '') + (src.encoding ? '・' + LQ.EncodingDetector.label(src.encoding.value) : '');
      const items = [
        h('span', { class: 'lq-summary__main' }, [Dom.icon('circle-check'), ds.name]),
        h('span', { class: 'lq-summary__item', text: kind }),
        h('span', { class: 'lq-summary__item lq-num', text: Util.formatInt(ds.rowCount) + ' 行 × ' + ds.colCount + ' 列' }),
        h('span', { class: 'lq-summary__item', text: (set.hasHeader ? 'ヘッダー ' + set.headerRow + ' 行目' : 'ヘッダーなし') + '・範囲 ' + ds.stats.rangeText }),
        ds.stats.skippedEmpty ? h('span', { class: 'lq-summary__item lq-num', text: '空行 ' + Util.formatInt(ds.stats.skippedEmpty) + ' 行を除外' }) : null
      ];
      this.info.appendChild(h('div', { class: 'lq-summary' }, items));
      if (raw) {
        this.info.appendChild(UI.note('tip', '元のシートのまま表示しています。行番号をクリックするとヘッダー行・データ開始行・終了行を、列記号をクリックすると開始列を指定できます。'));
      }
      if (!ds.rowCount) this.info.appendChild(UI.note('warn', 'データ行がありません。「読み込み範囲」でヘッダー行・データ開始行を確認してください。'));
    }

    _dataModel(ds, paging) {
      const end = Math.min(ds.rowCount, paging.start + this.state.view.pageSize);
      const rows = [];
      for (let r = paging.start; r < end; r++) {
        const cells = new Array(ds.colCount);
        for (let c = 0; c < ds.colCount; c++) cells[c] = ds.cell(r, c);
        rows.push({ head: { text: String(ds.rowNumber(r)) }, cells: cells });
      }
      return {
        mode: 'data',
        role: ds.role,
        scrollKey: 'data:' + ds.id + ':' + ds.version + ':' + paging.page,
        columns: ds.columns.map((c) => ({ key: 'd:' + c.index, label: c.name, letter: c.letter })),
        rows: rows,
        numeric: this._numericColumns(rows, ds.colCount)
      };
    }

    _rawModel(ds, paging) {
      const set = ds.settings;
      const end = Math.min(ds.rawRowCount, paging.start + this.state.view.pageSize);
      let maxCol = set.startCol;
      for (let r = paging.start; r < end; r++) maxCol = Math.max(maxCol, ds.grid[r].length);
      maxCol = Math.min(maxCol, RAW_COL_LIMIT);
      const columns = [];
      for (let c = 0; c < maxCol; c++) {
        columns.push({ key: 'r:' + c, label: Util.colLetter(c), colIndex: c, isStart: c === set.startCol - 1, out: c < set.startCol - 1 });
      }
      const rows = [];
      for (let r = paging.start; r < end; r++) {
        const rowNo = r + 1;
        const state = ds.rowState(r);
        const classes = [];
        let tag = null;
        let tagKind = 'header';
        if (state === 'header') {
          classes.push('is-header');
          tag = 'ヘッダー';
        } else if (state === 'before' || state === 'after') {
          classes.push('is-out');
          tag = '範囲外';
          tagKind = 'out';
        }
        if (rowNo === set.startRow) {
          classes.push('is-start');
          tag = '開始';
          tagKind = 'start';
        }
        if (set.endRow && rowNo === set.endRow) {
          classes.push('is-end');
          tag = '終了';
          tagKind = 'end';
        }
        const src = ds.grid[r];
        const cells = new Array(maxCol);
        for (let c = 0; c < maxCol; c++) cells[c] = src[c] === undefined ? '' : src[c];
        rows.push({ head: { text: String(rowNo), tag: tag, tagKind: tagKind, action: 'raw-row', rawIndex: r }, cells: cells, rowClass: classes.join(' ') });
      }
      return {
        mode: 'raw',
        role: ds.role,
        scrollKey: 'raw:' + ds.id + ':' + paging.page,
        columns: columns,
        rows: rows,
        numeric: new Set()
      };
    }

    /* ---------------- 共通 ---------------- */

    _numericColumns(rows, count) {
      const out = new Set();
      for (let c = 0; c < count; c++) {
        let filled = 0;
        let numeric = 0;
        for (let i = 0; i < rows.length; i++) {
          const v = rows[i].cells[c];
          if (v === '' || v === undefined) continue;
          filled++;
          if (!Number.isNaN(LQ.ValueParser.parseNumber(v))) numeric++;
        }
        if (filled && numeric / filled >= NUMERIC_RATIO) out.add(c);
      }
      return out;
    }

    _paging(tab, total) {
      const size = this.state.view.pageSize;
      const pages = Math.max(1, Math.ceil(total / size));
      const page = Util.clamp(this.state.view.pages[tab] || 0, 0, pages - 1);
      this.state.view.pages[tab] = page;
      return { page: page, pages: pages, start: page * size };
    }

    _renderPager(tab, total, paging) {
      const s = this.state;
      const size = s.view.pageSize;
      const go = (p) => s.setPage(tab, Util.clamp(p, 0, paging.pages - 1));
      const nav = (icon, title, target, disabled) => h('button', {
        class: 'lq-btn lq-btn--ghost lq-btn--icon lq-btn--sm', type: 'button', title: title, disabled: disabled, onclick: () => go(target)
      }, Dom.icon(icon));
      const pageInput = h('input', { class: 'lq-input lq-num', type: 'text', inputmode: 'numeric', value: String(paging.page + 1), title: 'ページ番号（Enter で移動）' });
      pageInput.addEventListener('change', () => {
        const n = Util.parseRowRef(pageInput.value);
        if (n === null || Number.isNaN(n)) {
          pageInput.value = String(paging.page + 1);
          LQ.Flash.el(pageInput, 'warn');
          return;
        }
        if (n - 1 !== paging.page) go(n - 1);
      });
      const sizeInput = h('input', { class: 'lq-input lq-num', type: 'text', inputmode: 'numeric', value: String(size), title: '1 ページに表示する行数（Enter で反映）' });
      sizeInput.addEventListener('change', () => this._applyPageSize(sizeInput));
      const end = Math.min(total, paging.start + size);
      Dom.append(this.pager, [
        h('div', { class: 'lq-pager__group' }, [
          nav('angles-left', '最初のページ', 0, paging.page === 0),
          nav('chevron-left', '前のページ', paging.page - 1, paging.page === 0),
          pageInput,
          h('span', { class: 'lq-num', text: '/ ' + Util.formatInt(paging.pages) + ' ページ' }),
          nav('chevron-right', '次のページ', paging.page + 1, paging.page >= paging.pages - 1),
          nav('angles-right', '最後のページ', paging.pages - 1, paging.page >= paging.pages - 1)
        ]),
        h('span', { class: 'lq-pager__sep' }),
        h('div', { class: 'lq-pager__group' }, [h('span', { text: '表示件数' }), sizeInput, h('span', { text: '行／ページ' })]),
        h('span', { class: 'lq-pager__range', text: total ? Util.formatInt(paging.start + 1) + '–' + Util.formatInt(end) + ' 行目 ／ 全 ' + Util.formatInt(total) + ' 行' : '0 行' })
      ]);
      if (this._flashSize) {
        this._flashSize = false;
        LQ.Flash.el(sizeInput);
      }
    }

    _applyPageSize(input) {
      const s = this.state;
      const n = Util.parseRowRef(input.value);
      if (n === null || Number.isNaN(n)) {
        input.value = String(s.view.pageSize);
        LQ.Flash.el(input, 'warn');
        this.ctx.toasts.show({ type: 'warn', title: '表示件数は 1 以上の整数で入力してください' });
        return;
      }
      if (n === s.view.pageSize) return;
      const applied = s.setPageSize(n);
      this._flashSize = true;
      if (applied !== n) {
        this.ctx.toasts.show({ type: 'warn', title: '1 ページの上限は ' + Util.formatInt(LQ.AppState.PAGE_SIZE_MAX) + ' 行です', message: Util.formatInt(applied) + ' 行にしました。全件は「出力」で確認できます。' });
      }
    }

    _cycleSort(key) {
      const cur = this.state.view.sort;
      let next = { key: key, dir: 'asc' };
      if (cur && cur.key === key) next = cur.dir === 'asc' ? { key: key, dir: 'desc' } : null;
      this.state.setSort(next);
    }

    _onRowHead(head, anchor) {
      if (head.action === 'explain') this.app.resultDialogs.openRowDetail(anchor, head.index);
      else if (head.action === 'raw-row') this.app.dialogs.openRawRowMenu(anchor, this.state.view.tab, head.rawIndex);
    }
  }

  LQ.MainView = MainView;
})(window);
