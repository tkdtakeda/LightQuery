/* =========================================================================
 * LightQuery - lq-ui-chart-panel.js
 * グラフの設定パネル：グラフ（一覧・名前）→ 対象 → 種類（目的ごと）→ 項目 → 置き場所 → 表示 の順に並べる。
 *   ・列を押すだけで描ける：種類を自分で選んでいなければ、列の組み合わせに合う種類を選んで置く
 *     （数値 1 つ → ヒストグラム、数値 2 つ → 散布図、文字＋数値 → 横棒、日付＋数値 → 折れ線）
 *   ・種類を先に選ぶと、空いている置き場所に入れる列の種類を示す。今の列で描けない種類は薄くして理由を添える
 *   ・置いた項目（タグ）はドラッグで置き場所を移せる（入っていた項目は元の場所へ入れ替わる）。▾ で集計のしかた・日付のまとめ方
 *   ・種類を切り替えて置けなくなった項目は「一時的に外している項目」として預かり、種類を戻すと元の置き場所へ戻す。
 *     集計のしかた（平均など）もグラフごとに覚え、値の置き場所に戻ったときに使う
 *   ・変更はすぐグラフタブに反映し、ブラウザ（作業セット）に記憶する
 *   見た目はピボットの設定パネル（lq-pvfield・lq-pvzone・lq-pvtag）と同じ部品を使う
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Dom = LQ.Dom;
  const UI = LQ.UI;
  const Util = LQ.Util;
  const Flash = LQ.Flash;
  const Types = LQ.ChartTypes;
  const Settings = LQ.ChartSettings;
  const Advisor = LQ.ChartAdvisor;
  const h = Dom.h;

  const TYPE_ICON = { number: 'hashtag', date: 'calendar-days', text: 'font', count: 'list-ol' };
  const TYPE_TITLE = { number: '数値の列', date: '日付の列', text: '文字の列', count: '行の数' };
  const SLOT_ICON = { x: 'arrows-left-right', y: 'arrows-up-down', size: 'circle', color: 'palette' };
  const COUNT_KEY = '#count';
  const GROUPABLE_META = ['m:profile'];
  const DRAG_TYPE = 'application/x-lq-chart';
  const SEARCH_OVER = 12;

  class ChartPanel {
    constructor(ctx) {
      this.ctx = ctx;
      this.state = ctx.state;
      this.app = ctx.app;
      this.actions = new LQ.ChartActions(ctx);
      this.title = 'グラフ';
      this.icon = 'chart-column';
      this.size = 'md';
      this.word = '';
      this._flash = null;
      this.body = h('div');
      this.el = h('div', {}, [this.body]);
      ['charts', 'output', 'datasets', 'profiles', 'result'].forEach((topic) => ctx.bus.on(topic, () => this.render()));
      this.render();
    }

    headerActions() {
      return [h('button', { class: 'lq-btn lq-btn--ghost lq-btn--sm', type: 'button', title: 'グラフタブでグラフを見る',
        onclick: () => this.state.setTab('chart') }, [Dom.icon('chart-column'), 'グラフを表示'])];
    }

    /** 選択中のグラフ（まだなければ、表示用の空のグラフ。最初の操作で一覧に加える） */
    get chart() {
      return this.actions.active() || this._draft || (this._draft = Settings.create({ name: '', target: 'result' }));
    }

    _kindOf(key) {
      if (!key || key === COUNT_KEY) return 'count';
      return LQ.PivotFieldTypes.of(this.state, key);
    }

    _target() {
      const s = this.state;
      return LQ.PivotSettings.effectiveTarget({ target: this.chart.target }, !!s.datasets.source, !!s.result);
    }

    /** 使える項目：出力列の一覧にあるキー。① の全行が対象なら ① の列だけ */
    _keys() {
      const onSource = this._target() === 'source';
      return this.state.output.columns.map((c) => c.key)
        .filter((k) => (onSource ? k.slice(0, 2) === 's:' : k.slice(0, 2) !== 'm:' || GROUPABLE_META.indexOf(k) !== -1));
    }

    /** 選択中のグラフを変える。flash：反映の合図を出す要素の data-flash-key */
    _update(mutate, flash) {
      this._flash = flash || null;
      this.actions.update(mutate);
    }

    render() {
      Dom.clear(this.body);
      if (!this.state.datasets.source || !this._keys().length) {
        this.body.appendChild(UI.note('info', '① 元データを読み込むと、グラフに使う項目を選べます（② を使わずに ① だけでも作れます）。'));
        return;
      }
      Dom.append(this.body, [this._listSection(), this._targetSection(), this._typeSection(), this._fieldSection(), this._slotSection(), this._optionSection()]);
      this._afterRender();
    }

    _afterRender() {
      const key = this._flash;
      this._flash = null;
      if (!key) return;
      const el = this.body.querySelector('[data-flash-key="' + CSS.escape(key) + '"]');
      if (el) {
        el.scrollIntoView({ block: 'nearest' });
        Flash.el(el);
      }
    }

    /* ---------------- グラフの一覧・名前 ---------------- */

    _listSection() {
      const all = this.state.charts;
      const chart = this.chart;
      const chips = all.items.map((c) => h('button', {
        class: 'lq-fchip lq-chlist__chip' + (c.id === all.activeId ? ' is-active' : ''), type: 'button', title: Settings.describe(c),
        dataset: { flashKey: 'chart:' + c.id }, onclick: () => this.actions.select(c.id)
      }, [Dom.icon(Types.get(c.type).icon, Types.get(c.type).iconClass || ''), h('span', { class: 'lq-fchip__label', text: Settings.title(c) })]));
      const add = h('button', { class: 'lq-btn lq-btn--xs', type: 'button', title: '新しいグラフを加える（今のグラフは残ります）',
        onclick: () => {
          const c = this.actions.add();
          if (c) this._flash = 'chart:' + c.id;
        } }, [Dom.icon('plus'), '追加']);
      const name = h('input', { class: 'lq-input lq-input--sm', type: 'text', value: chart.name, placeholder: Settings.autoTitle(chart) + '（自動の題名）',
        maxlength: String(Settings.NAME_MAX), title: 'グラフの題名（空欄なら置いた項目から自動で付けます）。Enter で反映', dataset: { flashKey: 'name' } });
      name.addEventListener('change', () => {
        if (name.value.trim() === chart.name) return;
        this.actions.ensure();
        this._flash = 'name';
        this.actions.rename(this.actions.active().id, name.value);
      });
      const exists = !!this.actions.active();
      const dup = UI.iconButton('clone', 'このグラフを複製する', () => this.actions.duplicate(chart.id), 'lq-btn--sm');
      const del = UI.iconButton('trash-can', 'このグラフを削除する（元に戻せます）', () => this.actions.remove(chart.id), 'lq-btn--sm');
      dup.disabled = !exists;
      del.disabled = !exists;
      return UI.section('グラフ', [
        all.items.length > 1 ? h('div', { class: 'lq-chlist' }, chips) : null,
        h('div', { class: 'lq-row lq-chname' }, [UI.field('題名', name, null, 'lq-chname__field'), dup, del])
      ], [add]);
    }

    /* ---------------- 対象 ---------------- */

    _targetSection() {
      const s = this.state;
      const src = s.datasets.source;
      if (!s.result) {
        return UI.section('対象', [h('div', { class: 'lq-aggtarget' }, [Dom.icon('table'), h('strong', { text: '① 元データの全行' + (src.filters && src.filters.length ? '（絞り込み後）' : '') }),
          h('span', { class: 'lq-num', text: Util.formatInt(src.rowCount) + ' 行' })])]);
      }
      const seg = new LQ.Segmented(LQ.PivotSettings.TARGETS.map((t) => ({ value: t.id, label: t.label, icon: t.icon, title: t.desc })), this._target(),
        (v) => this._update((c) => {
          c.target = v;
        }, 'target'), 'lq-seg--block');
      seg.el.dataset.flashKey = 'target';
      return UI.section('対象', [seg.el]);
    }

    /* ---------------- 種類（目的ごと） ---------------- */

    _typeSection() {
      const chart = this.chart;
      const kinds = Settings.placed(chart).map((p) => this._kindOf(p.item.key));
      const rec = Advisor.recommendFor(chart, (k) => this._kindOf(k));
      const rows = Types.GROUPS.map((g) => h('div', { class: 'lq-chgallery__row' }, [
        h('div', { class: 'lq-chgallery__purpose', title: g.desc }, [Dom.icon(g.icon), h('strong', { text: g.label }), h('span', { text: g.desc })]),
        h('div', { class: 'lq-chgallery__types' }, Types.inGroup(g.id).map((t) => {
          const fit = Types.fitKinds(t, kinds);
          const btn = LQ.chartTypeButton(t, { active: chart.type === t.id, unfit: kinds.length && !fit.ok ? fit.reason : '', rec: rec === t.id && chart.type !== t.id,
            onClick: () => {
              this._flash = 'type:' + t.id;
              this.actions.setType(t.id);
            } });
          btn.dataset.flashKey = 'type:' + t.id;
          return btn;
        }))
      ]));
      const t = Types.get(chart.type);
      return UI.section('種類', [h('div', { class: 'lq-chgallery' }, rows), h('p', { class: 'lq-field__hint', text: t.label + '：' + t.desc })],
        [chart.typeLocked ? null : h('span', { class: 'lq-tag lq-tag--rec', title: '列を押すと、列の組み合わせに合う種類を自動で選びます。種類を押すと、その種類に固定します' }, [Dom.icon('wand-magic-sparkles'), '自動で選ぶ'])]);
    }

    /* ---------------- 項目の一覧 ---------------- */

    _fieldSection() {
      const placed = new Map();
      Settings.placed(this.chart).forEach((p) => placed.set(p.item.key || COUNT_KEY, p.slot));
      const search = h('input', { class: 'lq-input lq-input--sm', type: 'search', placeholder: '項目の名前で探す', value: this.word });
      const list = h('div', { class: 'lq-pvfields' });
      const type = Types.get(this.chart.type);
      const takesCount = type.slots.some((s) => s.accepts.indexOf('count') >= 0);
      const fill = () => {
        Dom.clear(list);
        const items = (takesCount ? [COUNT_KEY] : []).concat(this._keys());
        items.forEach((key) => {
          const name = key === COUNT_KEY ? '件数' : LQ.ResultView.nameOf(key);
          if (this.word && !LQ.ColumnSearch.matches(name, '', this.word)) return;
          list.appendChild(this._fieldChip(key, name, placed.get(key)));
        });
        if (!list.childNodes.length) list.appendChild(h('span', { class: 'lq-field__hint', text: '「' + this.word + '」に当てはまる項目はありません' }));
      };
      search.addEventListener('input', () => {
        this.word = search.value.trim();
        fill();
      });
      fill();
      return UI.section('項目', [
        this._keys().length > SEARCH_OVER ? search : null,
        list,
        h('p', { class: 'lq-field__hint', text: '押すと合う置き場所に入ります。ドラッグで置き場所を選ぶこともできます。' })
      ]);
    }

    _fieldChip(key, name, slotId) {
      const kind = this._kindOf(key);
      const slot = slotId ? Types.slot(this.chart.type, slotId) : null;
      const chip = h('button', {
        class: 'lq-pvfield lq-pvfield--' + kind + (slotId ? ' is-placed' : ''), type: 'button', draggable: 'true',
        title: TYPE_TITLE[kind] + '「' + name + '」' + (slot ? '：' + slot.label + 'に置いています' : '：押すと合う置き場所に入ります'),
        onclick: () => this._place(key === COUNT_KEY ? null : key, kind)
      }, [Dom.icon(TYPE_ICON[kind], 'lq-pvfield__icon'), h('span', { class: 'lq-pvfield__name', text: name }),
        slot ? h('span', { class: 'lq-pvfield__zone', text: slot.label.replace(/（.*）/, '') }) : null]);
      chip.addEventListener('dragstart', (e) => this._dragStart(e, { from: 'list', key: key === COUNT_KEY ? null : key }));
      return chip;
    }

    /** 押したときの置き方（種類を選んでいなければ、合う種類へ切り替える） */
    _place(key, kind) {
      const chart = this.actions.ensure();
      const r = Advisor.place(chart, key, kind, (k) => this._kindOf(k));
      if (r.exists) {
        this._flashNow('slot:' + r.slot);
        return;
      }
      if (r.full) {
        const accepts = Types.get(chart.type).slots.filter((s) => s.accepts.indexOf(kind) >= 0);
        this.ctx.toasts.show({ type: 'info', title: accepts.length ? '置き場所が埋まっています' : Types.get(chart.type).label + 'には' + LQ.ChartTypes.KIND_LABEL[kind] + 'の列を置けません',
          message: accepts.length ? '置いている項目を × で外すか、ドラッグで入れ替えてください。' : '「種類」で合う種類を選ぶと置けます（薄い種類は、足りない列を添えています）。' });
        return;
      }
      /* 種類が変わったときは、変わった種類のボタンを光らせて知らせる（通知は外した項目があるときだけ） */
      this._update((c) => Object.assign(c, r.chart), r.retyped ? 'type:' + r.chart.type : 'slot:' + r.slot);
      if (r.retyped) {
        /* グラフタブは次の描画で作り直すので、描き終わってから光らせる */
        global.requestAnimationFrame(() => global.requestAnimationFrame(() => {
          const tb = this.ctx.app.main && this.ctx.app.main.chart.frame.left.querySelector('.lq-chtype.is-active');
          if (tb) Flash.el(tb);
        }));
        if (r.dropped.length) {
          this.ctx.toasts.show({ type: 'info', title: '列の組み合わせに合わせて「' + Types.get(r.chart.type).label + '」にしました',
            message: '置けない項目（' + r.dropped.join('、') + '）は外しました。別の種類にするときは「種類」で選んでください。', duration: 5000 });
        }
      }
    }

    _flashNow(key) {
      const el = this.body.querySelector('[data-flash-key="' + CSS.escape(key) + '"]');
      if (el) {
        el.scrollIntoView({ block: 'nearest' });
        Flash.el(el);
      }
    }

    /* ---------------- 置き場所 ---------------- */

    _slotSection() {
      const type = Types.get(this.chart.type);
      return UI.section('置き場所', type.slots.map((s) => this._slot(type, s)).concat([this._parked()]));
    }

    /** 種類を切り替えて置けなくなった項目（種類を戻すと元の置き場所へ戻る） */
    _parked() {
      const parked = this.chart.memo ? this.chart.memo.parked : [];
      if (!parked.length) return null;
      const names = parked.map((it) => (it.key ? LQ.ResultView.nameOf(it.key) + (it.grain ? '（' + LQ.PivotSettings.grainLabel(it.grain) + '）' : '') : '件数'));
      return h('div', { class: 'lq-chparked', dataset: { flashKey: 'parked' } }, [
        Dom.icon('box-archive'),
        h('span', { class: 'lq-chparked__text' }, [h('strong', { text: '一時的に外している項目：' }), names.join('、'),
          h('span', { class: 'lq-field__hint', text: '（この種類には置けません。前の種類に戻すと元の置き場所に戻ります）' })]),
        h('button', { class: 'lq-btn lq-btn--xs', type: 'button', title: '預かっている項目を捨てる（種類を戻しても戻りません）', onclick: () => this.actions.clearParked() },
          [Dom.icon('xmark'), '捨てる'])
      ]);
    }

    _slot(type, slot) {
      const items = this.chart.slots[slot.id];
      const tags = h('div', { class: 'lq-pvzone__tags' });
      items.forEach((item) => tags.appendChild(this._tag(type, slot, item)));
      if (!items.length) {
        tags.appendChild(h('span', { class: 'lq-pvzone__empty', text: slot.value ? '空なら件数を数えます' : (slot.required ? ChartTypes_accepts(slot) + 'の列を入れてください' : 'なくても描けます（' + ChartTypes_accepts(slot) + '）') }));
      }
      const fit = Types.fit(type, this.chart.slots);
      const el = h('div', { class: 'lq-pvzone' + (slot.required && !items.length && fit.slot === slot.id ? ' is-needed' : ''), dataset: { zone: slot.id, flashKey: 'slot:' + slot.id }, title: slot.hint }, [
        h('div', { class: 'lq-pvzone__head' }, [Dom.icon(SLOT_ICON[slot.id]), h('strong', { text: slot.label }),
          h('span', { class: 'lq-pvzone__hint', text: slot.hint }), slot.required ? h('span', { class: 'lq-pvzone__count', text: '必須' }) : null]),
        tags
      ]);
      el.addEventListener('dragover', (e) => this._dragOver(e, el));
      el.addEventListener('dragleave', (e) => {
        if (!el.contains(e.relatedTarget)) el.classList.remove('is-over');
      });
      el.addEventListener('drop', (e) => this._drop(e, el, slot.id));
      return el;
    }

    _tag(type, slot, item) {
      const kind = this._kindOf(item.key);
      const label = Settings.itemLabel(item, slot.id, type);
      const hasMenu = slot.value ? !!item.key : kind === 'date';
      const menuBtn = hasMenu ? h('button', { class: 'lq-pvtag__menu', type: 'button', title: slot.value ? '集計のしかた' : '日付のまとめ方',
        onclick: (e) => this._openMenu(e.currentTarget, slot, item) }, Dom.icon('caret-down')) : null;
      const remove = UI.iconButton('xmark', 'この項目を外す', () => this._update((c) => {
        c.slots[slot.id] = [];
        if (!Settings.isConfigured(c)) {
          c.typeLocked = false;
          c.memo.parked = [];
        }
      }), 'lq-btn--xs');
      const tag = h('div', { class: 'lq-pvtag lq-pvtag--' + kind, draggable: 'true', title: label + '（ドラッグで置き場所を移せます）' }, [
        Dom.icon(TYPE_ICON[kind], 'lq-pvtag__icon'),
        h('span', { class: 'lq-pvtag__label', text: label, onclick: () => menuBtn && menuBtn.click() }),
        menuBtn, remove
      ]);
      tag.addEventListener('dragstart', (e) => this._dragStart(e, { from: slot.id, key: item.key }));
      return tag;
    }

    _openMenu(anchor, slot, item) {
      const pop = this.ctx.popovers;
      const key = 'chtag:' + slot.id;
      if (pop.isOpen(key)) {
        pop.close();
        return;
      }
      const choice = (label, current, fn, opts) => UI.menuItem(pop, current ? 'circle-check' : 'circle', label, null, fn, opts || {});
      const body = h('div', { class: 'lq-menu lq-pvmenu' });
      const set = (patch) => this._update((c) => Object.assign(c.slots[slot.id][0], patch), 'slot:' + slot.id);
      if (slot.value) {
        body.appendChild(h('div', { class: 'lq-pvmenu__title', text: '集計のしかた' }));
        Settings.FNS.filter((f) => f !== 'count').forEach((id) => {
          const f = LQ.PivotSettings.funcOf(id);
          body.appendChild(choice(f.label, item.fn === id, () => set({ fn: id }), { title: f.note || null }));
        });
      } else {
        body.appendChild(h('div', { class: 'lq-pvmenu__title', text: '日付のまとめ方' }));
        body.appendChild(choice('まとめない（値のまま）', !item.grain, () => set({ grain: null })));
        LQ.PivotSettings.GRAINS.forEach((g) => body.appendChild(choice(g.label, item.grain === g.id, () => set({ grain: g.id }))));
      }
      pop.open(anchor, body, { key: key, placement: 'bottom-start' });
    }

    /* ---------------- ドラッグ＆ドロップ ---------------- */

    _dragStart(e, payload) {
      e.stopPropagation();
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(payload));
      e.dataTransfer.setData('text/plain', '');
      this.body.classList.add('is-dragging');
      const end = () => {
        this.body.classList.remove('is-dragging');
        this.body.querySelectorAll('.is-over').forEach((el) => el.classList.remove('is-over'));
        e.target.removeEventListener('dragend', end);
      };
      e.target.addEventListener('dragend', end);
    }

    _dragOver(e, el) {
      if (!Array.from(e.dataTransfer.types || []).includes(DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      el.classList.add('is-over');
    }

    /** 落とした置き場所へ入れる。別の置き場所から移したときは、入っていた項目を元の置き場所へ入れ替える（合わなければ外す） */
    _drop(e, el, slotId) {
      el.classList.remove('is-over');
      const raw = e.dataTransfer.getData(DRAG_TYPE);
      if (!raw) return;
      e.preventDefault();
      let p;
      try {
        p = JSON.parse(raw);
      } catch (err) {
        return;
      }
      if (p.from === slotId) return;
      const chart = this.actions.ensure();
      const type = Types.get(chart.type);
      const slot = Types.slot(type, slotId);
      const kind = this._kindOf(p.key);
      if (slot.accepts.indexOf(kind) < 0) {
        this.ctx.toasts.show({ type: 'info', title: '「' + slot.label + '」には' + ChartTypes_accepts(slot) + 'の列を置けます', message: '' });
        return;
      }
      const memoFn = chart.memo ? chart.memo.valueFn : 'sum';
      const make = (s, key, k, old) => {
        if (s.value) return k === 'count' ? { key: null, grain: null, fn: 'count' } : { key: key, grain: null, fn: old && old.fn && old.fn !== 'count' && old.key ? old.fn : memoFn };
        return { key: key, grain: k === 'date' ? (old && old.grain) || 'month' : null, fn: null };
      };
      this._update((c) => {
        const from = p.from !== 'list' ? c.slots[p.from][0] : null;
        const displaced = c.slots[slotId][0] || null;
        c.slots[slotId] = [make(slot, p.key, kind, from)];
        if (p.from !== 'list') {
          const back = Types.slot(type, p.from);
          const dk = displaced ? this._kindOf(displaced.key) : null;
          c.slots[p.from] = displaced && back.accepts.indexOf(dk) >= 0 ? [make(back, displaced.key, dk, displaced)] : [];
        } else {
          Settings.SLOT_IDS.forEach((id) => {
            if (id !== slotId && c.slots[id][0] && (p.key ? c.slots[id][0].key === p.key : c.slots[id][0].fn === 'count' && !c.slots[id][0].key)) c.slots[id] = [];
          });
        }
      }, 'slot:' + slotId);
    }

    /* ---------------- 表示（種類ごとの設定） ---------------- */

    _optionSection() {
      const chart = this.chart;
      const type = Types.get(chart.type);
      const o = chart.opts;
      const set = (patch, key) => this._update((c) => Object.assign(c.opts, patch), key);
      const out = [];
      const has = (name) => type.options.indexOf(name) >= 0;
      const colored = !!chart.slots.color && chart.slots.color.length > 0;
      if (has('area')) {
        const sw = UI.switchToggle('面で塗る（量の大きさを強調）', o.area, (on) => set({ area: on }, 'opt:area'));
        sw.el.dataset.flashKey = 'opt:area';
        out.push(sw.el);
      }
      if (has('arrange') && colored && (type.mode !== 'line' || o.area)) {
        const items = type.mode === 'line'
          ? [{ value: 'group', label: '重ねる', title: '線ごとに面を重ねる' }, { value: 'stack', label: '積み上げ', title: '面を積み上げて合計も見る' }]
          : [{ value: 'auto', label: '自動', title: '系列が 4 つまでなら並べる、それより多ければ積み上げ' }, { value: 'group', label: '並べる', title: '系列を横に並べて比べる' },
            { value: 'stack', label: '積み上げ', title: '系列を積み上げて合計も見る' }, { value: 'pct', label: '100%', title: '項目ごとの構成比（合計を 100% にそろえる）' }];
        const current = type.mode === 'line' ? (o.arrange === 'stack' ? 'stack' : 'group') : o.arrange;
        const seg = new LQ.Segmented(items, current, (v) => set({ arrange: v }, 'opt:arrange'), 'lq-seg--block');
        seg.el.dataset.flashKey = 'opt:arrange';
        out.push(UI.field('並べ方', seg.el));
      }
      if (has('sort')) {
        const sel = h('select', { class: 'lq-select', dataset: { flashKey: 'opt:sort' } });
        UI.fillSelect(sel, [{ value: 'auto', label: '自動（値の大きい順。日付は日付の順）' }, { value: 'value', label: '値の大きい順' }, { value: 'label', label: '項目の順（あいうえお）' }], o.sort);
        sel.addEventListener('change', () => set({ sort: sel.value }, 'opt:sort'));
        out.push(UI.field('項目の並び', sel));
      }
      if (has('top')) {
        const sel = LQ.PivotChart.topSelect(o.top, (v) => set({ top: v }, 'opt:top'));
        sel.dataset.flashKey = 'opt:top';
        const hint = type.mode === 'pareto' ? '自動では 31 件以上のとき上位 30 件＋その他にします（その他は右端）'
          : '項目が多いと読み取れないため、自動では 16 件以上のとき上位 10 件＋その他にします' + (type.mode === 'donut' ? '（ドーナツは 8 色までのため上位 7 件＋その他）' : '');
        out.push(UI.field('項目の数', sel, hint));
      }
      if (has('labels')) {
        const sw = UI.switchToggle(type.mode === 'donut' ? '凡例に割合を表示' : '棒の先に値を表示（項目が少ないとき）', o.labels, (on) => set({ labels: on }, 'opt:labels'));
        sw.el.dataset.flashKey = 'opt:labels';
        if (type.mode !== 'donut') out.push(sw.el);
      }
      if (has('bins')) out.push(this._binsField(o, set));
      if (has('lines')) {
        const sw = UI.switchToggle(type.id === 'ecdf' ? '50%（中央値）の横線' : '平均（実線）・中央値（破線）の線', o.lines, (on) => set({ lines: on }, 'opt:lines'));
        sw.el.dataset.flashKey = 'opt:lines';
        out.push(sw.el);
      }
      if (has('shape')) {
        const seg = new LQ.Segmented([{ value: 'box', label: '箱ひげ', title: '中央値・四分位・外れ値を箱とひげで表す' },
          { value: 'violin', label: 'バイオリン', title: '分布の形（どこに値が多いか）を幅で表す' },
          { value: 'both', label: '両方', title: 'バイオリンの中に箱ひげを描く' }], o.shape, (v) => set({ shape: v }, 'opt:shape'), 'lq-seg--block');
        seg.el.dataset.flashKey = 'opt:shape';
        out.push(UI.field('形', seg.el));
      }
      if (has('points')) {
        const seg = new LQ.Segmented([{ value: 'auto', label: '自動', title: '全体が 300 行までなら点も描く' }, { value: 'on', label: '描く' }, { value: 'off', label: '描かない' }],
          o.points, (v) => set({ points: v }, 'opt:points'), 'lq-seg--block');
        seg.el.dataset.flashKey = 'opt:points';
        out.push(UI.field('1 行ずつの点', seg.el));
      }
      if (has('groupSort')) {
        const sel = h('select', { class: 'lq-select', dataset: { flashKey: 'opt:groupSort' } });
        UI.fillSelect(sel, [{ value: 'label', label: '項目の順（日付は日付の順）' }, { value: 'median', label: '中央値の大きい順' }], o.groupSort);
        sel.addEventListener('change', () => set({ groupSort: sel.value }, 'opt:groupSort'));
        out.push(UI.field('グループの並び', sel));
      }
      if (has('trend')) {
        const sw = UI.switchToggle('回帰直線を引く（相関係数は題名の下に表示）', o.trend, (on) => set({ trend: on }, 'opt:trend'));
        sw.el.dataset.flashKey = 'opt:trend';
        out.push(sw.el);
      }
      if (has('log')) {
        const lx = UI.switchToggle('横軸を対数に', o.logx, (on) => set({ logx: on }, 'opt:logx'));
        const ly = UI.switchToggle('縦軸を対数に', o.logy, (on) => set({ logy: on }, 'opt:logy'));
        lx.el.dataset.flashKey = 'opt:logx';
        ly.el.dataset.flashKey = 'opt:logy';
        out.push(h('div', { class: 'lq-row' }, [lx.el, ly.el]));
        out.push(h('p', { class: 'lq-field__hint', text: '値の桁が大きく違う（10 と 10,000 が混じる）ときに使います。0 以下の値は描けません。' }));
      }
      if (type.id === 'pareto') out.push(h('p', { class: 'lq-field__hint', text: '棒は全体に対する %、線は累積の % です（目盛りは 1 本）。累積 80% までの項目を A、95% までを B、残りを C として色分けします。' }));
      out.push(h('p', { class: 'lq-field__hint' }, [Dom.icon('hand-pointer'), type.id === 'scatter' || type.id === 'bubble'
        ? ' 点を押すとその行、グラフの中をドラッグして範囲を囲むと、その中の行（内訳）を表示します。'
        : ' グラフの棒・点を押すと、そこに入った行（内訳）を表示します。']));
      return UI.section('表示', out);
    }

    /** 区間の数：0 は自動（Freedman–Diaconis）。動かしている間は数だけを変え、離したら描き直す */
    _binsField(o, set) {
      const range = h('input', { class: 'lq-range', type: 'range', min: '0', max: String(LQ.ChartStats.BINS_MAX), step: '1', value: String(o.bins),
        dataset: { flashKey: 'opt:bins' }, title: '左端は自動' });
      const label = h('span', { class: 'lq-num lq-chbins__value' });
      const text = (v) => (Number(v) ? v + ' 区間（目安）' : '自動');
      label.textContent = text(o.bins);
      range.addEventListener('input', () => {
        label.textContent = text(range.value);
      });
      range.addEventListener('change', () => set({ bins: Number(range.value) }, 'opt:bins'));
      return UI.field('区間の数', h('div', { class: 'lq-row lq-chbins' }, [range, label]),
        '自動は値の散らばり（四分位範囲）と件数から決めます。幅はきりのよい数（1・2・2.5・5 の倍数）にそろえます');
    }
  }

  function ChartTypes_accepts(slot) {
    return Types.acceptsText(slot);
  }

  LQ.ChartPanel = ChartPanel;
})(window);
