/* =========================================================================
 * LightQuery - lq-ui-filter.js
 * 絞り込みの画面：① / ② の行を、抽出の前に列ごとの条件で減らす（すべてを満たす行だけ残す）
 *   ColumnMenu   … 列の見出し（または読み込みパネル）を押すと開く一覧。Excel のオートフィルターと同じ形で、
 *                  「出力する」スイッチ・値の一覧（最初から表示）・たたんだ「条件で絞る」・残る行数の見込み・OK
 *   ResultColumnMenu … 抽出結果の見出しの一覧（並べ替え・出力する）
 *   FilterBar    … プレビューの上に、掛けている絞り込みのタグ（× で外す）と「すべて外す」・残っている行数を出す
 *   FilterSection… 読み込みパネルの区画（一覧と「列を選んで絞り込む」）
 *   絞り込みは ① と、② の抽出条件ごとに列の名前で記憶し、次に読み込んだ表に掛け直す（LoadMemory）。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Dom = LQ.Dom;
  const UI = LQ.UI;
  const Flash = LQ.Flash;
  const h = Dom.h;
  const fmt = LQ.Util.formatInt;

  const VALUE_LIMIT = 1000;
  const VALUES_DEFAULT_MAX = 50;
  const BLANK = '';
  const BLANK_LABEL = '（空欄）';

  function isDateCol(ds, name) {
    return LQ.DateColumns ? LQ.DateColumns.isDate(ds, name) : false;
  }

  /** 絞り込みの文章（日付の列なら日付向けの呼び方） */
  function describe(ds, f) {
    return LQ.RowFilter.describe(f, isDateCol(ds, f.col));
  }

  /* ---------------------------------------------------------------------
   * ColumnMenu：① / ② の見出しを押すと開く一覧（Excel のオートフィルターと同じ形）
   *   上：「出力する」スイッチ（すぐ反映）
   *   中：値の一覧（検索・すべて選択・件数つき。最初から見せる）／たたんだ「条件で絞る」（開くと条件が優先）
   *   下：残る行数の見込み・「絞り込みを外す」・「OK」（Enter でも確定）
   * ------------------------------------------------------------------- */
  class ColumnMenu {
    constructor(ctx) {
      this.ctx = ctx;
      this.state = ctx.state;
    }

    /**
     * @param {Element} anchor
     * @param {'source'|'condition'} role
     * @param {string} colName
     */
    open(anchor, role, colName) {
      const ds = this.state.datasets[role];
      if (!ds) return;
      const pop = this.ctx.popovers;
      if (pop.isOpen('colmenu:' + role + ':' + colName)) {
        pop.close();
        return;
      }
      const current = (ds.filters || []).find((f) => f.col === colName) || null;
      const values = this._distinct(ds, colName);
      const date = isDateCol(ds, colName);
      const all = values.list.map((v) => v.value);
      const f = current ? LQ.Util.clone(current) : { id: LQ.Util.uid('flt'), col: colName, mode: 'values', op: date ? 'between' : 'eq', value: '', value2: '', values: all.slice() };
      if (f.mode !== 'values' && !f.values) f.values = all.slice();
      this.ds = ds;
      this.role = role;
      this.f = f;
      this.current = current;
      this.others = (ds.filters || []).filter((x) => x.col !== colName);
      this.values = values;
      this.date = date;
      this.estimate = h('div', { class: 'lq-filter__estimate' });
      this.problem = h('div');
      this.okBtn = h('button', { class: 'lq-btn lq-btn--primary', type: 'button', onclick: () => this._apply() }, [Dom.icon('check'), 'OK']);
      const clearBtn = h('button', { class: 'lq-btn', type: 'button', disabled: !current, title: current ? 'この列の絞り込みを外す（元に戻せます）' : 'この列は絞り込んでいません',
        onclick: () => this._remove() }, [Dom.icon('filter-circle-xmark'), '絞り込みを外す']);
      this.valuesBox = this._valuesBody();
      this.opDetails = this._opBody();
      const el = h('div', { class: 'lq-popover__body lq-filter' }, [this._visibilitySwitch(role, colName), this.valuesBox, this.opDetails, this.estimate, this.problem]);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing && e.target.tagName !== 'SELECT' && e.target.tagName !== 'SUMMARY') {
          e.preventDefault();
          if (!this.okBtn.disabled) this._apply();
        }
      });
      pop.open(anchor, [
        h('div', { class: 'lq-popover__head' }, [Dom.icon('filter'), h('span', { class: 'lq-colmenu__title', text: colName }),
          UI.iconButton('xmark', '閉じる（Esc）', () => pop.close(), 'lq-btn--sm')]),
        el,
        h('div', { class: 'lq-popover__foot' }, [clearBtn, h('span', { class: 'lq-topbar__spacer' }), this.okBtn])
      ], { key: 'colmenu:' + role + ':' + colName, size: 'lg', placement: 'bottom-start' });
      this._syncMode();
      const search = el.querySelector('input[type="search"]');
      if (search && f.mode === 'values') search.focus();
    }

    /** 「出力する」スイッチ（出力列パネル・列タグと同じ設定。すぐ反映） */
    _visibilitySwitch(role, colName) {
      const key = (role === 'source' ? 's:' : 'c:') + colName;
      const col = this.state.output.columns.find((c) => c.key === key);
      const on = col ? col.visible : role === 'source';
      const sw = UI.switchToggle('この列を出力する（表示する）', on, (checked) => this.state.setColumnVisible(key, checked));
      sw.el.classList.add('lq-colmenu__visible');
      return sw.el;
    }

    /** 絞り込み前の列の値（種類と件数。多い順） */
    _distinct(ds, colName) {
      const c = ds.findColumn(colName);
      const counts = new Map();
      for (let r = 0; r < ds.baseRowCount; r++) {
        const raw = ds.baseCell(r, c);
        const v = LQ.Normalizer.isBlank(raw) ? BLANK : String(raw);
        counts.set(v, (counts.get(v) || 0) + 1);
      }
      const list = Array.from(counts.entries()).map(([value, count]) => ({ value: value, count: count }))
        .sort((a, b) => b.count - a.count || (a.value === BLANK ? 1 : b.value === BLANK ? -1 : a.value.localeCompare(b.value, 'ja', { numeric: true })));
      return { list: list.slice(0, VALUE_LIMIT), total: list.length };
    }

    /** 値の一覧と条件のどちらで絞るか（条件を開いているあいだは条件が優先） */
    _syncMode() {
      this.f.mode = this.opDetails.open ? 'op' : 'values';
      this.valuesBox.classList.toggle('is-inactive', this.f.mode === 'op');
      this._update();
    }

    /* ---------------- 値の一覧 ---------------- */

    _valuesBody() {
      const f = this.f;
      const chosen = new Set(f.values);
      const search = h('input', { class: 'lq-input lq-input--sm', type: 'search', placeholder: '値で検索' });
      const allBox = h('input', { type: 'checkbox' });
      const allLabel = h('label', { class: 'lq-filter__value lq-filter__all' }, [allBox, h('span', { class: 'lq-filter__label', text: '（すべて選択）' }), h('span')]);
      const list = h('div', { class: 'lq-filter__values' });
      const shown = () => {
        const word = search.value.trim().toLowerCase();
        return this.values.list.filter((v) => !word || (v.value === BLANK ? BLANK_LABEL : v.value).toLowerCase().indexOf(word) !== -1);
      };
      const syncAll = () => {
        const items = shown();
        const on = items.filter((v) => chosen.has(v.value)).length;
        allBox.checked = items.length > 0 && on === items.length;
        allBox.indeterminate = on > 0 && on < items.length;
      };
      const commit = () => {
        f.values = this.values.list.map((v) => v.value).filter((v) => chosen.has(v));
        if (this.opDetails && this.opDetails.open) this.opDetails.open = false;
        syncAll();
        this._syncMode();
      };
      const render = () => {
        Dom.clear(list);
        const frag = document.createDocumentFragment();
        shown().forEach((v) => {
          const label = v.value === BLANK ? BLANK_LABEL : v.value;
          const box = h('input', { type: 'checkbox', checked: chosen.has(v.value) });
          box.addEventListener('change', () => {
            if (box.checked) chosen.add(v.value);
            else chosen.delete(v.value);
            commit();
          });
          frag.appendChild(h('label', { class: 'lq-filter__value' }, [box, h('span', { class: 'lq-filter__label', text: label, title: label }),
            h('span', { class: 'lq-filter__count lq-num', text: fmt(v.count) })]));
        });
        list.appendChild(frag);
        syncAll();
      };
      allBox.addEventListener('change', () => {
        shown().forEach((v) => {
          if (allBox.checked) chosen.add(v.value);
          else chosen.delete(v.value);
        });
        render();
        commit();
      });
      search.addEventListener('input', render);
      render();
      return h('div', { class: 'lq-colmenu__values' }, [
        search, allLabel, list,
        this.values.total > VALUE_LIMIT
          ? h('p', { class: 'lq-field__hint', text: '値が ' + fmt(this.values.total) + ' 種類あるため、多い順に ' + fmt(VALUE_LIMIT) + ' 種類を表示しています。下の「条件で絞る」も使えます。' }) : null,
        h('p', { class: 'lq-field__hint lq-colmenu__inactive-note', text: '「条件で絞る」を開いているあいだは、条件で絞り込みます（値の一覧は使いません）。' })
      ]);
    }

    /* ---------------- 条件で絞る（たたんで置く） ---------------- */

    _opBody() {
      const f = this.f;
      const op = h('select', { class: 'lq-select', title: '比較方法' });
      UI.fillSelect(op, LQ.Operators.menu(this.date), f.op);
      const v1 = h('input', { class: 'lq-input', type: 'text', value: f.value || '' });
      const v2 = h('input', { class: 'lq-input', type: 'text', value: f.value2 || '' });
      const tilde = h('span', { class: 'lq-cond__ga', text: '〜' });
      const hint = h('p', { class: 'lq-field__hint' });
      const layout = () => {
        const def = LQ.Operators.get(f.op);
        const pair = !!(def && def.pair);
        const period = !!(def && def.rightPrep === 'period');
        v2.hidden = !pair;
        tilde.hidden = !pair;
        if (period) v1.setAttribute('list', LQ.DateColumns.periodList());
        else v1.removeAttribute('list');
        const ex = this.date ? ['2024/04/01', '2024/04/30'] : ['1000', '5000'];
        v1.placeholder = period ? '例：2024/05・今月・直近30日' : (pair ? '開始（例：' + ex[0] + '）' : '値（例：' + (this.date ? ex[0] : '東京・1000・山田*') + '）');
        v2.placeholder = '終了（例：' + ex[1] + '）';
        hint.textContent = pair ? '開始・終了のどちらかが空欄なら、その側は制限なし（両端を含む）。'
          : (period ? '年（2024）・年月（2024/05）・年度（2024年度）・今日・今月・先月・今年度・直近 N 日 などが使えます。'
            : '文字・数値・日付と比べます。前後の空白・全角半角・大文字小文字はそろえて比べ、完全一致では「山田*」のように * が使えます。');
      };
      op.addEventListener('change', () => {
        f.op = op.value;
        layout();
        this._update();
      });
      [[v1, 'value'], [v2, 'value2']].forEach(([input, key]) => {
        input.addEventListener('input', () => {
          f[key] = input.value;
          this._updateSoon();
        });
      });
      layout();
      const details = h('details', { class: 'lq-colmenu__op', open: !!(this.current && this.current.mode === 'op') }, [
        h('summary', {}, [Dom.icon('sliders'), '条件で絞る（含む・以上・範囲・期間 など）']),
        h('div', { class: 'lq-stack' }, [UI.field('比較方法', op), UI.field('値', h('div', { class: 'lq-row' }, [v1, tilde, v2])), hint])
      ]);
      details.addEventListener('toggle', () => {
        this._syncMode();
        if (details.open) v1.focus();
      });
      return details;
    }

    /* ---------------- 見込みと確定 ---------------- */

    _updateSoon() {
      clearTimeout(this._timer);
      this._timer = setTimeout(() => this._update(), 200);
    }

    /** 値の一覧ですべて選んでいるとき（絞り込まないのと同じ） */
    _allChosen() {
      return this.f.mode === 'values' && this.values.total <= VALUE_LIMIT && this.f.values.length === this.values.list.length;
    }

    /** 確定できない理由（なければ null） */
    _problem() {
      if (this.f.mode === 'values') return this.f.values.length ? null : '残す値を 1 つ以上選んでください';
      return LQ.RowFilter.compile(this.f, this.ds).message || null;
    }

    _update() {
      if (!this.okBtn) return;
      const problem = this._problem();
      this.okBtn.disabled = !!problem;
      Dom.clear(this.problem);
      Dom.clear(this.estimate);
      if (problem) {
        this.problem.appendChild(UI.status('warn', problem));
        return;
      }
      const base = this.ds.baseRowCount;
      const kept = this.ds.countWith(this._allChosen() ? this.others : this.others.concat([this.f]));
      this.estimate.appendChild(UI.status(kept ? 'ok' : 'warn', fmt(base) + ' 行 → ' + fmt(kept) + ' 行になります' +
        (this.others.length ? '（ほかの列の絞り込み ' + this.others.length + ' 件も含む）' : '') + (this._allChosen() ? '・この列では絞り込みません' : '')));
    }

    _apply() {
      if (this._problem()) return;
      const f = this.f;
      const before = (this.ds.filters || []).slice();
      if (this._allChosen()) {
        this.ctx.popovers.close();
        if (this.current) {
          this.state.setFilters(this.role, this.others);
          this._notify(before, '「' + f.col + '」の絞り込みを外しました');
        }
        return;
      }
      if (f.mode === 'values') {
        f.values = f.values.slice();
        f.known = this.values.list.map((v) => v.value);
      }
      this.state.setFilters(this.role, this.others.concat([f]));
      this.ctx.popovers.close();
      this._notify(before, '「' + f.col + '」で絞り込みました');
    }

    _remove() {
      const before = (this.ds.filters || []).slice();
      this.state.setFilters(this.role, this.others);
      this.ctx.popovers.close();
      this._notify(before, '「' + this.f.col + '」の絞り込みを外しました');
    }

    _notify(before, title) {
      const ds = this.state.datasets[this.role];
      const role = this.role;
      this.ctx.toasts.show({
        type: 'success', title: title,
        message: ds.filterInfo ? fmt(ds.baseRowCount) + ' 行中 ' + fmt(ds.rowCount) + ' 行を使います。' : 'すべての行（' + fmt(ds.rowCount) + ' 行）を使います。',
        actions: [{ label: '元に戻す', icon: 'rotate-left', onClick: () => this.state.setFilters(role, before) }]
      });
    }
  }

  /* ---------------------------------------------------------------------
   * ResultColumnMenu：抽出結果の見出しを押すと開く一覧（並べ替え・出力する）
   * ------------------------------------------------------------------- */
  class ResultColumnMenu {
    constructor(ctx) {
      this.ctx = ctx;
      this.state = ctx.state;
    }

    open(anchor, key) {
      const pop = this.ctx.popovers;
      if (pop.isOpen('rescol:' + key)) {
        pop.close();
        return;
      }
      const s = this.state;
      const sort = s.view.sort && s.view.sort.key === key ? s.view.sort.dir : null;
      const item = (dir, icon, label) => h('button', {
        class: 'lq-colmenu__sort' + (sort === dir ? ' is-active' : ''), type: 'button', 'aria-pressed': sort === dir ? 'true' : 'false',
        onclick: () => {
          s.setSort(dir ? { key: key, dir: dir } : null);
          pop.close();
        }
      }, [Dom.icon(icon), label, sort === dir ? h('span', { class: 'lq-colmenu__current', text: '（今の並び）' }) : null]);
      const col = s.output.columns.find((c) => c.key === key);
      const sw = UI.switchToggle('この列を出力する（表示する）', col ? col.visible : true, (checked) => {
        s.setColumnVisible(key, checked);
        pop.close();
      });
      sw.el.classList.add('lq-colmenu__visible');
      pop.open(anchor, [
        h('div', { class: 'lq-popover__head' }, [Dom.icon('table-columns'), h('span', { class: 'lq-colmenu__title', text: LQ.ResultView.nameOf(key) }),
          UI.iconButton('xmark', '閉じる（Esc）', () => pop.close(), 'lq-btn--sm')]),
        h('div', { class: 'lq-popover__body lq-filter' }, [
          sw.el,
          h('div', { class: 'lq-colmenu__sorts' }, [item('asc', 'arrow-up-short-wide', '昇順に並べ替え（小さい順・古い順・あいうえお順）'),
            item('desc', 'arrow-down-wide-short', '降順に並べ替え（大きい順・新しい順）'),
            sort ? item(null, 'xmark', '並べ替えを解除（元の順）') : null]),
          h('p', { class: 'lq-field__hint', text: '見出しをドラッグすると列の順番を変えられます。' })
        ])
      ], { key: 'rescol:' + key, placement: 'bottom-start' });
    }
  }

  /* ---------------------------------------------------------------------
   * FilterBar：プレビューの上のタグ
   * ------------------------------------------------------------------- */
  const FilterBar = {
    /**
     * @param {object} ctx
     * @param {LQ.Dataset} ds
     * @param {'source'|'condition'} role
     * @returns {Element|null}
     */
    render(ctx, ds, role) {
      const filters = ds.filters || [];
      if (!filters.length) return null;
      const s = ctx.state;
      const info = ds.filterInfo || { items: [] };
      const tags = filters.map((f) => {
        const item = info.items.find((x) => x.id === f.id) || { ok: true };
        return h('span', { class: 'lq-ftag' + (item.ok ? '' : ' is-off'), title: item.ok ? describe(ds, f) : item.message }, [
          h('button', { class: 'lq-ftag__body', type: 'button', title: '「' + f.col + '」の絞り込みを直す',
            onclick: (e) => ctx.app.columnMenu.open(e.currentTarget, role, f.col) }, [Dom.icon(item.ok ? 'filter' : 'triangle-exclamation'), describe(ds, f)]),
          h('button', { class: 'lq-ftag__x', type: 'button', title: 'この絞り込みを外す', 'aria-label': 'この絞り込みを外す', onclick: () => {
            const before = filters.slice();
            s.setFilters(role, filters.filter((x) => x.id !== f.id));
            ctx.toasts.show({ type: 'success', title: '「' + f.col + '」の絞り込みを外しました', message: '',
              actions: [{ label: '元に戻す', icon: 'rotate-left', onClick: () => s.setFilters(role, before) }] });
          } }, Dom.icon('xmark'))
        ]);
      });
      const clear = h('button', { class: 'lq-btn lq-btn--xs', type: 'button', title: '絞り込みをすべて外す（元に戻せます）', onclick: () => {
        const before = filters.slice();
        s.setFilters(role, []);
        ctx.toasts.show({ type: 'success', title: '絞り込みをすべて外しました', message: 'すべての行（' + fmt(s.datasets[role].rowCount) + ' 行）を使います。',
          actions: [{ label: '元に戻す', icon: 'rotate-left', onClick: () => s.setFilters(role, before) }] });
      } }, [Dom.icon('filter-circle-xmark'), 'すべて外す']);
      return h('div', { class: 'lq-filterbar lq-filterbar--rows' }, [
        h('span', { class: 'lq-filterbar__label' }, [Dom.icon('filter'),
          '絞り込み中：' + fmt(ds.baseRowCount) + ' 行中 ' + fmt(ds.rowCount) + ' 行（すべてを満たす行）']),
        tags, clear
      ].flat());
    }
  };

  /* ---------------------------------------------------------------------
   * FilterSection：読み込みパネルの区画
   * ------------------------------------------------------------------- */
  class FilterSection {
    constructor(ctx, role) {
      this.ctx = ctx;
      this.state = ctx.state;
      this.role = role;
      this.list = h('div', { class: 'lq-stack' });
      this.picker = h('select', { class: 'lq-select', title: '絞り込む列を選ぶと、条件の小窓が開きます' });
      this.picker.addEventListener('change', () => {
        const name = this.picker.value;
        this.picker.value = '';
        if (name) ctx.app.columnMenu.open(this.picker, this.role, name);
      });
      this.el = UI.section('絞り込み（抽出・集計の前に行を減らす）', [this.list, this.picker,
        h('p', { class: 'lq-field__hint', text: '右の表の見出しを押しても絞り込めます。すべてを満たす行だけを使います。' })]);
      this.el.title = '右の表の見出し（読み込み範囲の表示ではヘッダー行の列名）を押しても、同じ一覧で絞り込めます。すべてを満たす行だけを、抽出・集計・出力に使います。列の名前で記憶し、次に同じ列のある表を読み込んだときも掛け直します。';
    }

    render(ds) {
      Dom.clear(this.list);
      const bar = FilterBar.render(this.ctx, ds, this.role);
      if (bar) this.list.appendChild(bar);
      UI.fillSelect(this.picker, ds.columns.map((c) => ({ value: c.name, label: c.name + ((ds.filters || []).some((f) => f.col === c.name) ? '（絞り込み中）' : '') })),
        '', '＋ 列を選んで絞り込む…');
    }
  }

  LQ.ColumnMenu = ColumnMenu;
  LQ.ResultColumnMenu = ResultColumnMenu;
  LQ.FilterBar = FilterBar;
  LQ.FilterSection = FilterSection;
})(window);
