/* =========================================================================
 * LightQuery - lq-ui-result-filter.js
 * 抽出結果の見出しの一覧と、元の表に掛かっている絞り込みの表示
 *   ResultColumnMenu   … 見出しを押すと開く一覧：出力する・並べ替え・絞り込み（① / ② の見出しと同じ値の一覧・条件で絞る）。
 *                        絞り込みは結果だけでなく元の表（① / ②）に掛け、OK で抽出し直す（LQ.ResultFilter）
 *   ResultFilterBar    … 抽出結果の上に、元の表に掛かっている絞り込みのタグ（押すと一覧・× で外して抽出し直す）
 *   ResultFilterActions… 絞り込みを元の表に掛け、抽出し直し、元に戻せるように知らせる
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Dom = LQ.Dom;
  const UI = LQ.UI;
  const h = Dom.h;
  const fmt = LQ.Util.formatInt;
  const RF = LQ.ResultFilter;

  function isDateCol(ds, name) {
    return LQ.DateColumns ? LQ.DateColumns.isDate(ds, name) : false;
  }

  function prefixOf(role) {
    return role === 'source' ? 's:' : 'c:';
  }

  /* ---------------------------------------------------------------------
   * ResultFilterActions：元の表に掛けて抽出し直す（並べ替えは引き継ぐ）
   * ------------------------------------------------------------------- */
  class ResultFilterActions {
    constructor(ctx) {
      this.ctx = ctx;
      this.state = ctx.state;
    }

    /**
     * @param {'source'|'condition'} role
     * @param {Array<{target:object, filters:Array}>} changes
     * @param {string} title 知らせの見出し
     * @param {string} key 結果の列のキー（反映後に見出しを光らせる）
     */
    async apply(role, changes, title, key) {
      const app = this.ctx.app;
      if (!changes.length || app._blockedByBusy()) return;
      const before = changes.map((c) => ({ target: c.target, filters: (c.target.ds.filters || []).slice() }));
      await this._run(role, changes, key);
      const s = this.state;
      const where = role === 'source' ? '① 元データ' : (changes.length > 1 ? '② 照合表 ' + changes.length + ' 件（' + changes.map((c) => c.target.label).join('・') + '）' : changes[0].target.label);
      const src = s.datasets.source;
      this.ctx.toasts.show({
        type: s.result ? 'success' : 'warn', title: title,
        message: where + 'にも同じ絞り込みを掛け、' + (s.result ? '抽出し直しました。' : '結果を消しました。右上のボタンで抽出してください。') +
          (role === 'source' && src ? '（① 使う行 ' + fmt(src.rowCount) + ' 行）' : ''),
        actions: [{ label: '元に戻す', icon: 'rotate-left', onClick: () => this._undo(role, before, key) }]
      });
    }

    async _undo(role, before, key) {
      if (this.ctx.app._blockedByBusy()) return;
      await this._run(role, before, key);
      this.ctx.toasts.show({ type: 'success', title: '絞り込みを元に戻しました', message: this.state.result ? '抽出し直しました。' : '' });
    }

    async _run(role, changes, key) {
      const s = this.state;
      const sort = s.view.sort;
      s.setFiltersOf(role, changes.map((c) => ({ profileId: c.target.profileId, filters: c.filters })));
      await this.ctx.app.run();
      if (s.result && sort) s.setSort(sort);
      if (s.result && key) this._flash(key);
    }

    /** 反映した列の見出しを光らせる（描き直しのあと） */
    _flash(key) {
      global.requestAnimationFrame(() => global.requestAnimationFrame(() => {
        const th = document.querySelector('th[data-key="' + (global.CSS && CSS.escape ? CSS.escape(key) : key) + '"]');
        if (th) LQ.Flash.el(th);
      }));
    }
  }

  /* ---------------------------------------------------------------------
   * ResultColumnMenu：抽出結果の見出しの一覧
   *   値の一覧・条件で絞る は ① / ② の見出しの一覧（ColumnMenu）と同じ部品を使い、
   *   値は表示中の結果から数え、確定すると元の表に掛けて抽出し直す
   * ------------------------------------------------------------------- */
  class ResultColumnMenu extends LQ.ColumnMenu {
    open(anchor, key) {
      const pop = this.ctx.popovers;
      if (pop.isOpen('rescol:' + key)) {
        pop.close();
        return;
      }
      const view = this.ctx.app.main.resultView();
      if (!view) return;
      this.key = key;
      this.view = view;
      this.okBtn = null;
      const name = LQ.ResultView.nameOf(key);
      const targets = RF.supports(key) ? RF.targets(this.state, view, key) : [];
      const body = [this._visibilitySwitchFor(key), this._sorts(key)];
      let foot = null;
      if (targets.length) {
        foot = this._initFilter(targets, name, body);
      } else {
        body.push(h('p', { class: 'lq-field__hint', text: RF.supports(key)
          ? '表示中の結果にこの列の値がないため、ここでは絞り込めません。'
          : 'この列は元の表にない列のため絞り込めません。抽出条件ごとに見るときは、表の上の「表示する行」を使います。' }));
      }
      const el = h('div', { class: 'lq-popover__body lq-filter' }, body);
      if (targets.length) {
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.isComposing && e.target.tagName !== 'SELECT' && e.target.tagName !== 'SUMMARY' && !e.target.closest('.lq-colmenu__sorts')) {
            e.preventDefault();
            if (!this.okBtn.disabled) this._apply();
          }
        });
      }
      pop.open(anchor, [
        h('div', { class: 'lq-popover__head' }, [Dom.icon(targets.length ? 'filter' : 'table-columns'), h('span', { class: 'lq-colmenu__title', text: name }),
          UI.iconButton('xmark', '閉じる（Esc）', () => pop.close(), 'lq-btn--sm')]),
        el, foot
      ], { key: 'rescol:' + key, size: targets.length ? 'lg' : undefined, placement: 'bottom-start' });
      if (!targets.length) return;
      this._syncMode();
      const search = el.querySelector('input[type="search"]');
      if (search && this.f.mode === 'values') search.focus();
    }

    /** 値の一覧・条件で絞る・見込み・OK を用意し、本体に足す。フッターを返す */
    _initFilter(targets, name, body) {
      const first = targets[0];
      const current = (first.ds.filters || []).find((x) => x.col === name) || null;
      this.targets = targets;
      this.role = first.role;
      this.ds = first.ds;
      this.date = isDateCol(first.ds, name);
      this.current = current && current.mode === 'op' ? current : null;
      this.values = RF.distinct(this.view, this.key);
      const all = this.values.list.map((v) => v.value);
      this.f = { id: LQ.Util.uid('flt'), col: name, mode: 'values', op: this.current ? this.current.op : (this.date ? 'between' : 'eq'),
        value: this.current ? this.current.value : '', value2: this.current ? this.current.value2 : '', values: all.slice() };
      this.estimate = h('div', { class: 'lq-filter__estimate' });
      this.problem = h('div');
      this.okBtn = h('button', { class: 'lq-btn lq-btn--primary', type: 'button', title: '元の表に絞り込みを掛けて抽出し直す（Enter）', onclick: () => this._apply() },
        [Dom.icon('check'), 'OK']);
      const filtered = targets.filter((t) => (t.ds.filters || []).some((x) => x.col === name));
      const clearBtn = h('button', { class: 'lq-btn', type: 'button', disabled: !filtered.length,
        title: filtered.length ? 'この列の絞り込みを元の表から外して抽出し直す（元に戻せます）' : 'この列は絞り込んでいません',
        onclick: () => this._remove() }, [Dom.icon('filter-circle-xmark'), '絞り込みを外す']);
      this.valuesBox = this._valuesBody();
      this.opDetails = this._opBody();
      const where = this.role === 'source' ? '① 元データ' : (targets.length > 1 ? '② 照合表 ' + targets.length + ' 件（' + targets.map((t) => t.label).join('・') + '）' : targets[0].label);
      body.push(this.valuesBox, this.opDetails,
        h('p', { class: 'lq-field__hint lq-colmenu__where' }, [Dom.icon('link'), 'OK で ' + where + ' にも同じ絞り込みを掛け、抽出し直します（結果と元データは常に同じ絞り込み）。']),
        this.estimate, this.problem);
      return h('div', { class: 'lq-popover__foot' }, [clearBtn, h('span', { class: 'lq-topbar__spacer' }), this.okBtn]);
    }

    /** 「出力する」スイッチ（すぐ反映して閉じる） */
    _visibilitySwitchFor(key) {
      const s = this.state;
      const col = s.output.columns.find((c) => c.key === key);
      const sw = UI.switchToggle('この列を出力する', col ? col.visible : true, (checked) => {
        s.setColumnVisible(key, checked);
        this.ctx.popovers.close();
      });
      sw.el.classList.add('lq-colmenu__visible');
      return sw.el;
    }

    /** 並べ替え（昇順・降順・解除） */
    _sorts(key) {
      const s = this.state;
      const pop = this.ctx.popovers;
      const sort = s.view.sort && s.view.sort.key === key ? s.view.sort.dir : null;
      const item = (dir, icon, label, title) => h('button', {
        class: 'lq-colmenu__sort' + (sort === dir ? ' is-active' : ''), type: 'button', title: title, 'aria-pressed': sort === dir ? 'true' : 'false',
        onclick: () => {
          s.setSort(dir ? { key: key, dir: dir } : null);
          pop.close();
        }
      }, [Dom.icon(icon), label]);
      return h('div', { class: 'lq-colmenu__sorts lq-colmenu__sorts--row', role: 'group', 'aria-label': '並べ替え' }, [
        item('asc', 'arrow-up-short-wide', '昇順', '昇順に並べ替え（小さい順・古い順・あいうえお順）' + (sort === 'asc' ? '（今の並び）' : '')),
        item('desc', 'arrow-down-wide-short', '降順', '降順に並べ替え（大きい順・新しい順）' + (sort === 'desc' ? '（今の並び）' : '')),
        sort ? item(null, 'xmark', '解除', '並べ替えを解除（元の順）') : null
      ]);
    }

    _removed() {
      return this.f.mode === 'values' ? RF.unchecked(this.values.list.map((v) => v.value), this.f.values) : [];
    }

    /** 値の一覧ですべて選んでいるとき（絞り込みを変えない） */
    _allChosen() {
      return this.f.mode === 'values' && !this._removed().length;
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
      if (this._allChosen()) {
        this.estimate.appendChild(UI.status('ok', 'すべての値を選んでいます（この列の絞り込みは変えません）'));
        return;
      }
      const removed = this._removed();
      const kept = RF.estimate(this.view, this.key, this.f, removed);
      let text = '表示中の結果 ' + fmt(this.view.length) + ' 行 → 約 ' + fmt(kept) + ' 行';
      if (this.role === 'source') {
        const next = RF.mergeInto(this.ds, this.f, removed);
        if (next) text += '・① 使う行 ' + fmt(this.ds.rowCount) + ' 行 → ' + fmt(this.ds.countWith(next)) + ' 行';
      }
      this.estimate.appendChild(UI.status(kept ? 'ok' : 'warn', text + '（目安。抽出し直して確定）'));
    }

    _apply() {
      if (this._problem()) return;
      const removed = this._removed();
      const changes = this.targets.map((t) => ({ target: t, filters: RF.mergeInto(t.ds, this.f, removed) })).filter((c) => c.filters);
      this.ctx.popovers.close();
      if (!changes.length) return;
      this.ctx.app.resultFilter.apply(this.role, changes, '「' + this.f.col + '」で絞り込みました', this.key);
    }

    _remove() {
      const changes = this.targets.map((t) => ({ target: t, filters: RF.removeFrom(t.ds, this.f.col) })).filter((c) => c.filters);
      this.ctx.popovers.close();
      if (!changes.length) return;
      this.ctx.app.resultFilter.apply(this.role, changes, '「' + this.f.col + '」の絞り込みを外しました', this.key);
    }
  }

  /* ---------------------------------------------------------------------
   * ResultFilterBar：抽出結果の上のタグ（元の表に掛かっている絞り込み）
   * ------------------------------------------------------------------- */
  const ResultFilterBar = {
    /**
     * @param {object} ctx
     * @param {LQ.ResultView} view
     * @returns {Element|null}
     */
    render(ctx, view) {
      if (view.result.allRows) return null;
      const groups = ResultFilterBar._groups(ctx.state, view);
      if (!groups.length) return null;
      const tags = groups.map((g) => {
        const key = prefixOf(g.role) + g.filter.col;
        const text = (g.role === 'source' ? '① ' : '② ') + LQ.RowFilter.describe(g.filter, isDateCol(g.targets[0].ds, g.filter.col));
        const title = g.targets.map((t) => t.label).join('・') + '：' + (g.ok ? text : g.message);
        return h('span', { class: 'lq-ftag' + (g.ok ? '' : ' is-off'), title: title }, [
          h('button', { class: 'lq-ftag__body', type: 'button', title: '「' + g.filter.col + '」の絞り込みを直す（' + title + '）',
            onclick: (e) => ctx.app.resultColumnMenu.open(e.currentTarget, key) }, [Dom.icon(g.ok ? 'filter' : 'triangle-exclamation'), text]),
          h('button', { class: 'lq-ftag__x', type: 'button', title: 'この絞り込みを外して抽出し直す', 'aria-label': 'この絞り込みを外して抽出し直す', onclick: () => {
            const changes = g.targets.map((t) => ({ target: t, filters: RF.removeFrom(t.ds, g.filter.col) })).filter((c) => c.filters);
            ctx.app.resultFilter.apply(g.role, changes, '「' + g.filter.col + '」の絞り込みを外しました', key);
          } }, Dom.icon('xmark'))
        ]);
      });
      return h('div', { class: 'lq-filterbar lq-filterbar--rows', title: '抽出の前に元の表に掛けている絞り込みです。結果の見出しを押しても同じ絞り込みを直せます。' }, [
        h('span', { class: 'lq-filterbar__label' }, [Dom.icon('filter'), '元データの絞り込み']), tags
      ].flat());
    },

    /** ① は 1 件ずつ、② は同じ列・同じ内容の絞り込みを 1 つのタグにまとめる */
    _groups(state, view) {
      const groups = [];
      const add = (role, target) => {
        const info = target.ds.filterInfo || { items: [] };
        (target.ds.filters || []).forEach((f) => {
          const item = info.items.find((x) => x.id === f.id) || { ok: true };
          const sig = role + '|' + f.col + '|' + LQ.RowFilter.describe(f, false);
          const same = groups.find((g) => g.sig === sig);
          if (same) {
            same.targets.push(target);
            return;
          }
          groups.push({ sig: sig, role: role, filter: f, targets: [target], ok: item.ok, message: item.message });
        });
      };
      const src = state.datasets.source;
      if (src) add('source', { role: 'source', profileId: null, ds: src, label: '① 元データ' });
      const seen = new Set();
      view.parts.forEach((part) => {
        const p = state.profiles.find(part.id);
        if (!p || !p.condition || p.condition !== part.condition || seen.has(p.condition)) return;
        seen.add(p.condition);
        add('condition', { role: 'condition', profileId: p.id, ds: p.condition, label: '② ' + part.priority + ' 位「' + p.name + '」' });
      });
      return groups;
    },

    /** 結果の見出しに漏斗を出す列のキー */
    filteredKeys(state, view) {
      const keys = new Set();
      ResultFilterBar._groups(state, view).forEach((g) => keys.add(prefixOf(g.role) + g.filter.col));
      return keys;
    }
  };

  LQ.ResultFilterActions = ResultFilterActions;
  LQ.ResultColumnMenu = ResultColumnMenu;
  LQ.ResultFilterBar = ResultFilterBar;
})(window);
