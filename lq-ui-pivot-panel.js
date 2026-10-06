/* =========================================================================
 * LightQuery - lq-ui-pivot-panel.js
 * ピボットの設定パネル：対象 → 項目の一覧 → 置き場所（行・列・値）→ 表示（総計・並べ替え）の順に並べる。
 *   ・項目を押すだけで、種類に合った場所に入る（数値 → 値の合計、文字・日付 → 行。行がすでにあれば 2 つ目は列）
 *   ・置いた項目（タグ）はドラッグで場所・順番を変えられる。タグの ▾ で、日付のまとめ方・集計のしかた・
 *     % の表示・置き場所を選べる。× で外す
 *   ・変更はすぐピボットタブに反映する（抽出はやり直さない）。設定はブラウザに記憶する
 *   （外からは以前の名前 LQ.AggregatePanel で使う）
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Dom = LQ.Dom;
  const UI = LQ.UI;
  const Util = LQ.Util;
  const Flash = LQ.Flash;
  const Settings = LQ.PivotSettings;
  const h = Dom.h;

  const SAMPLE = 200;
  const RATIO = 0.8;
  const TYPE_ICON = { number: 'hashtag', date: 'calendar-days', text: 'font', count: 'list-ol', condRow: 'list-check' };
  const TYPE_TITLE = { number: '数値の列', date: '日付の列', text: '文字の列', count: '行の数', condRow: '② 照合表の 1 行＝1 グループ' };
  const ZONES = [
    { id: 'rows', label: '行', icon: 'grip-lines', hint: '縦に並べる項目（地域・顧客など）' },
    { id: 'cols', label: '列', icon: 'grip-lines-vertical', hint: '横に並べる項目（月・カテゴリなど。' + Settings.LIMIT.colItems + ' 種類まで）' },
    { id: 'values', label: '値', icon: 'calculator', hint: '集計する数値（合計・平均・件数など）' }
  ];
  const ZONE_MAX = { rows: Settings.LIMIT.rows, cols: Settings.LIMIT.cols, values: Settings.LIMIT.values };
  const COUNT_KEY = '#count';
  const GROUPABLE_META = ['m:profile', 'm:priority'];
  const DRAG_TYPE = 'application/x-lq-pivot';

  /* ---------------------------------------------------------------------
   * FieldTypes：列の種類（数値・日付・文字）を先頭の値から決める
   * ------------------------------------------------------------------- */
  const typeCache = new WeakMap();
  const FieldTypes = {
    /** @returns {'number'|'date'|'text'} */
    of(state, key) {
      if (key.slice(0, 2) === 'm:') return key === 'm:priority' ? 'number' : 'text';
      const name = LQ.ResultView.nameOf(key);
      const ds = key.slice(0, 2) === 's:' ? state.datasets.source
        : (state.profiles.items.map((p) => p.condition).find((d) => d && d.findColumn(name) >= 0) || null);
      if (!ds) return 'text';
      let entry = typeCache.get(ds);
      if (!entry || entry.version !== ds.version) {
        entry = { version: ds.version, map: new Map() };
        typeCache.set(ds, entry);
      }
      if (!entry.map.has(name)) entry.map.set(name, FieldTypes._detect(ds, ds.findColumn(name)));
      return entry.map.get(name);
    },

    _detect(ds, col) {
      if (col < 0) return 'text';
      let seen = 0;
      let nums = 0;
      let dates = 0;
      for (let r = 0; r < ds.rowCount && seen < SAMPLE; r++) {
        const v = ds.cell(r, col);
        if (LQ.Normalizer.isBlank(v)) continue;
        seen++;
        if (!Number.isNaN(LQ.ValueParser.parseNumber(v))) nums++;
        else if (!Number.isNaN(LQ.ValueParser.parseDate(v))) dates++;
      }
      if (!seen) return 'text';
      if (nums / seen >= RATIO) return 'number';
      if (dates / seen >= RATIO) return 'date';
      return 'text';
    }
  };

  class PivotPanel {
    constructor(ctx) {
      this.ctx = ctx;
      this.state = ctx.state;
      this.app = ctx.app;
      this.title = 'ピボット';
      this.icon = 'table-cells';
      this.size = 'md';
      this.word = '';
      this._flash = null;
      this.body = h('div');
      this.el = h('div', {}, [this.body]);
      ['aggregate', 'output', 'datasets', 'profiles', 'result'].forEach((topic) => ctx.bus.on(topic, () => this.render()));
      this.render();
    }

    get settings() {
      return this.state.aggregate;
    }

    /** 設定を変える。flash：反映の合図を出すタグ（'rows:0' など）または要素 */
    _change(mutate, flash) {
      const next = Util.clone(this.settings);
      mutate(next);
      this._flash = flash || null;
      this.state.setAggregate(next);
    }

    _target() {
      const s = this.state;
      return Settings.effectiveTarget(s.aggregate, !!s.datasets.source, !!s.result);
    }

    /** 使える項目：出力列の一覧にあるキー（表示していない列も含む）。① の全行が対象なら ① の列だけ */
    _keys() {
      const onSource = this._target() === 'source';
      return this.state.output.columns.map((c) => c.key)
        .filter((k) => (onSource ? k.slice(0, 2) === 's:' : k.slice(0, 2) !== 'm:' || GROUPABLE_META.indexOf(k) !== -1));
    }

    /** 「② の行」を使えるか（抽出結果に ② の行がひも付く） */
    _condRowAvailable() {
      const s = this.state;
      return this._target() === 'result' && !!s.result && s.profiles.items.some((p) => p.enabled && p.condition);
    }

    _typeOf(key) {
      if (key === COUNT_KEY) return 'count';
      if (key === Settings.COND_ROW) return 'condRow';
      return FieldTypes.of(this.state, key);
    }

    render() {
      Dom.clear(this.body);
      if (!this.state.datasets.source || !this._keys().length) {
        this.body.appendChild(UI.note('info', '① 元データを読み込むと、ピボットに使う項目を選べます（② を使わずに ① だけでも作れます）。'));
        return;
      }
      Dom.append(this.body, [this._targetSection(), this._fieldSection(), this._zoneSection(), this._optionSection()]);
      this._afterRender();
    }

    _afterRender() {
      const f = this._flash;
      this._flash = null;
      if (!f) return;
      const el = typeof f === 'string' ? this.body.querySelector('[data-tag="' + f + '"]') : f;
      if (el) Flash.el(el);
    }

    /* ---------------- 対象 ---------------- */

    _targetSection() {
      const s = this.state;
      const src = s.datasets.source;
      const reset = h('button', { class: 'lq-btn lq-btn--xs', type: 'button', title: '行・列・値をすべて外す（元に戻せます）', onclick: () => {
        const snap = s.snapshot();
        s.setAggregate(Object.assign(Settings.create(), { target: s.aggregate.target }));
        this.ctx.toasts.show({ type: 'success', title: 'ピボットの項目をすべて外しました', message: '',
          actions: [{ label: '元に戻す', icon: 'rotate-left', onClick: () => this.app.restore(snap, 'ピボットの設定を元に戻しました') }] });
      } }, [Dom.icon('eraser'), 'すべて外す']);
      reset.disabled = !Settings.isConfigured(s.aggregate);
      if (!s.result) {
        return UI.section('対象', [
          h('div', { class: 'lq-aggtarget' }, [Dom.icon('table'), h('strong', { text: '① 元データの全行' + (src.filters && src.filters.length ? '（絞り込み後）' : '') }),
            h('span', { class: 'lq-num', text: Util.formatInt(src.rowCount) + ' 行' })]),
          h('p', { class: 'lq-field__hint', text: '抽出していないので、② を使わずに ① の全行で作ります。抽出すると、抽出結果も選べるようになります。' })
        ], [reset]);
      }
      const target = this._target();
      const seg = new LQ.Segmented(Settings.TARGETS.map((t) => ({ value: t.id, label: t.label, icon: t.icon, title: t.desc })), target,
        (v) => this._change((x) => {
          x.target = v;
        }, seg.el), 'lq-seg--block');
      return UI.section('対象', [seg.el], [reset]);
    }

    /* ---------------- 項目の一覧 ---------------- */

    _fieldSection() {
      const st = this.settings;
      const placed = new Map();
      ['rows', 'cols'].forEach((z) => st[z].forEach((f) => placed.set(f.key, z)));
      st.values.forEach((v) => placed.set(v.key || COUNT_KEY, placed.get(v.key || COUNT_KEY) || 'values'));
      const search = h('input', { class: 'lq-input lq-input--sm', type: 'search', placeholder: '項目の名前で探す', value: this.word });
      const list = h('div', { class: 'lq-pvfields' });
      const fill = () => {
        Dom.clear(list);
        const word = this.word;
        const items = [COUNT_KEY].concat(this._condRowAvailable() ? [Settings.COND_ROW] : [], this._keys());
        items.forEach((key) => {
          const name = key === COUNT_KEY ? '件数' : (key === Settings.COND_ROW ? '② の行' : LQ.ResultView.nameOf(key));
          if (word && !LQ.ColumnSearch.matches(name, '', word)) return;
          list.appendChild(this._fieldChip(key, name, placed.get(key)));
        });
        if (!list.childNodes.length) list.appendChild(h('span', { class: 'lq-field__hint', text: '「' + word + '」に当てはまる項目はありません' }));
      };
      search.addEventListener('input', () => {
        this.word = search.value.trim();
        fill();
      });
      fill();
      return UI.section('項目', [
        this._keys().length > 12 ? search : null,
        list,
        h('p', { class: 'lq-field__hint', text: '押すと表に入ります（数値 → 値の合計、文字・日付 → 行。2 つ目の文字・日付は列）。ドラッグで置き場所を選ぶこともできます。' })
      ]);
    }

    _fieldChip(key, name, zone) {
      const type = this._typeOf(key);
      const zoneLabel = zone ? ZONES.find((z) => z.id === zone).label : '';
      const chip = h('button', {
        class: 'lq-pvfield lq-pvfield--' + type + (zone ? ' is-placed' : ''), type: 'button', draggable: 'true',
        title: TYPE_TITLE[type] + '「' + name + '」' + (zone ? '：' + zoneLabel + 'に置いています' : '：押すと表に入ります（ドラッグで置き場所を選べます）'),
        onclick: () => this._autoPlace(key, type)
      }, [Dom.icon(TYPE_ICON[type], 'lq-pvfield__icon'), h('span', { class: 'lq-pvfield__name', text: name }),
        zone ? h('span', { class: 'lq-pvfield__zone', text: zoneLabel }) : null]);
      chip.addEventListener('dragstart', (e) => this._dragStart(e, { from: 'list', key: key }));
      return chip;
    }

    /** 押したときの置き場所：件数・数値 → 値、② の行 → 行の先頭、日付・文字 → 行（行があり列が空なら列） */
    _autoPlace(key, type) {
      const st = this.settings;
      if (type === 'count' || type === 'number') {
        const value = type === 'count' ? { key: null, fn: 'count', show: 'value' } : { key: key, fn: 'sum', show: 'value' };
        const at = st.values.findIndex((v) => v.key === value.key && v.fn === value.fn && v.show === 'value');
        if (at >= 0) return this._flashTag('values:' + at);
        if (this._full('values')) return;
        this._change((x) => x.values.push(value), 'values:' + st.values.length);
        return;
      }
      const inRows = st.rows.findIndex((f) => f.key === key);
      const inCols = st.cols.findIndex((f) => f.key === key);
      if (inRows >= 0) return this._flashTag('rows:' + inRows);
      if (inCols >= 0) return this._flashTag('cols:' + inCols);
      const field = { key: key, grain: type === 'date' ? 'month' : null };
      if (type === 'condRow') {
        if (this._full('rows')) return;
        this._change((x) => x.rows.unshift(field), 'rows:0');
        return;
      }
      const zone = st.rows.length && !st.cols.length ? 'cols' : (st.rows.length < ZONE_MAX.rows ? 'rows' : 'cols');
      if (this._full(zone)) return;
      this._change((x) => x[zone].push(field), zone + ':' + st[zone].length);
    }

    _flashTag(id) {
      const el = this.body.querySelector('[data-tag="' + id + '"]');
      if (el) {
        el.scrollIntoView({ block: 'nearest' });
        Flash.el(el);
      }
    }

    _full(zone) {
      if (this.settings[zone].length < ZONE_MAX[zone]) return false;
      const z = ZONES.find((x) => x.id === zone);
      this.ctx.toasts.show({ type: 'warn', title: '「' + z.label + '」に置けるのは ' + ZONE_MAX[zone] + ' つまでです', message: '使わない項目を × で外してください。' });
      return true;
    }

    /* ---------------- 置き場所（行・列・値） ---------------- */

    _zoneSection() {
      return UI.section('置き場所', ZONES.map((z) => this._zone(z)));
    }

    _zone(z) {
      const st = this.settings;
      const items = st[z.id];
      const tags = h('div', { class: 'lq-pvzone__tags' });
      items.forEach((item, i) => tags.appendChild(this._tag(z.id, item, i)));
      if (!items.length) tags.appendChild(h('span', { class: 'lq-pvzone__empty', text: z.id === 'values' ? '空なら件数を数えます' : 'ここにドラッグ、または上の項目を押す' }));
      const el = h('div', { class: 'lq-pvzone', dataset: { zone: z.id }, title: z.hint }, [
        h('div', { class: 'lq-pvzone__head' }, [Dom.icon(z.icon), h('strong', { text: z.label }),
          h('span', { class: 'lq-pvzone__hint', text: z.hint }), h('span', { class: 'lq-pvzone__count lq-num', text: items.length + ' / ' + ZONE_MAX[z.id] })]),
        tags
      ]);
      el.addEventListener('dragover', (e) => this._dragOver(e, el));
      el.addEventListener('dragleave', (e) => {
        if (!el.contains(e.relatedTarget)) el.classList.remove('is-over');
      });
      el.addEventListener('drop', (e) => this._drop(e, el, z.id));
      return el;
    }

    _tag(zone, item, index) {
      const isValue = zone === 'values';
      const key = isValue ? (item.key || COUNT_KEY) : item.key;
      const type = this._typeOf(key);
      const label = isValue ? Settings.valueLabel(item) : Settings.fieldLabel(item);
      const menuBtn = h('button', { class: 'lq-pvtag__menu', type: 'button', title: '設定（' + (isValue ? '集計のしかた・% の表示' : (type === 'date' ? '日付のまとめ方' : '並び')) + '・置き場所）',
        onclick: (e) => this._openMenu(e.currentTarget, zone, index) }, Dom.icon('caret-down'));
      const remove = UI.iconButton('xmark', 'この項目を外す', () => this._change((x) => x[zone].splice(index, 1)), 'lq-btn--xs');
      const tag = h('div', { class: 'lq-pvtag lq-pvtag--' + type, draggable: 'true', dataset: { tag: zone + ':' + index }, title: label + '（ドラッグで置き場所・順番を変えられます）' }, [
        Dom.icon(TYPE_ICON[type], 'lq-pvtag__icon'),
        h('span', { class: 'lq-pvtag__label', text: label, onclick: () => menuBtn.click() }),
        menuBtn, remove
      ]);
      tag.addEventListener('dragstart', (e) => this._dragStart(e, { from: zone, index: index }));
      return tag;
    }

    /* ---------------- タグの設定（▾） ---------------- */

    _openMenu(anchor, zone, index) {
      const pop = this.ctx.popovers;
      if (pop.isOpen('pvtag:' + zone + ':' + index)) {
        pop.close();
        return;
      }
      const st = this.settings;
      const item = st[zone][index];
      const isValue = zone === 'values';
      const type = this._typeOf(isValue ? (item.key || COUNT_KEY) : item.key);
      const groups = [];
      const choice = (icon, label, current, fn, opts) => UI.menuItem(pop, current ? 'circle-check' : icon, label, null, fn, opts || {});
      if (isValue) {
        groups.push(['集計のしかた', Settings.FUNCS.map((f) => choice('circle', f.label + (f.keyless ? '（行の数）' : ''), item.fn === f.id,
          () => this._change((x) => {
            const v = x.values[index];
            v.fn = f.id;
            if (f.keyless) v.key = null;
            else if (!v.key) return;
            if (!f.pct) v.show = 'value';
          }, 'values:' + index), { disabled: !f.keyless && !item.key, title: f.note || null }))]);
        const pctOk = Settings.funcOf(item.fn).pct;
        groups.push(['表示', Settings.SHOWS.map((sh) => choice('circle', sh.label, item.show === sh.id,
          () => this._change((x) => {
            x.values[index].show = sh.id;
          }, 'values:' + index), { disabled: sh.id !== 'value' && !pctOk, title: sh.id !== 'value' && !pctOk ? '% の表示は件数・合計で使えます' : null }))]);
      } else {
        if (type === 'date') {
          groups.push(['日付のまとめ方', [choice('circle', 'まとめない（値のまま）', !item.grain, () => this._setGrain(zone, index, null))]
            .concat(Settings.GRAINS.map((g) => choice('circle', g.label, item.grain === g.id, () => this._setGrain(zone, index, g.id))))]);
        }
        groups.push(['並び', [
          UI.menuItem(pop, 'arrow-up', '前へ（' + (zone === 'rows' ? '左' : '上') + 'の段へ）', null, () => this._moveWithin(zone, index, -1), { disabled: index === 0 }),
          UI.menuItem(pop, 'arrow-down', '後ろへ（' + (zone === 'rows' ? '右' : '下') + 'の段へ）', null, () => this._moveWithin(zone, index, 1), { disabled: index === st[zone].length - 1 })
        ]]);
      }
      const moves = ZONES.filter((z) => z.id !== zone && !(isValue && !item.key) && !(item.key === Settings.COND_ROW && z.id !== 'rows'))
        .map((z) => UI.menuItem(pop, z.icon, z.label + 'へ移す', null, () => this._move({ from: zone, index: index }, z.id, st[z.id].length)));
      if (moves.length) groups.push(['置き場所', moves]);
      const body = h('div', { class: 'lq-menu lq-pvmenu' });
      groups.forEach(([title, items], i) => {
        if (i) body.appendChild(h('div', { class: 'lq-menu__sep' }));
        body.appendChild(h('div', { class: 'lq-pvmenu__title', text: title }));
        items.forEach((el) => body.appendChild(el));
      });
      pop.open(anchor, body, { key: 'pvtag:' + zone + ':' + index, placement: 'bottom-start' });
    }

    _setGrain(zone, index, grain) {
      this._change((x) => {
        x[zone][index].grain = grain;
      }, zone + ':' + index);
    }

    _moveWithin(zone, index, delta) {
      this._change((x) => {
        const list = x[zone];
        const item = list.splice(index, 1)[0];
        list.splice(index + delta, 0, item);
      }, zone + ':' + (index + delta));
    }

    /**
     * 置いた項目・一覧の項目を、別の置き場所（または同じ場所の別の位置）へ動かす。
     * 値 → 行・列は集計する列を項目に、行・列 → 値は数値なら合計・それ以外は件数にする
     * @param {{from:string, index?:number, key?:string}} src
     * @param {string} zone 行き先
     * @param {number} at 行き先での位置
     */
    _move(src, zone, at) {
      const st = this.settings;
      let key;
      let carry = null;
      if (src.from === 'list') key = src.key;
      else {
        carry = st[src.from][src.index];
        if (!carry) return;
        key = src.from === 'values' ? carry.key || COUNT_KEY : carry.key;
      }
      const type = this._typeOf(key);
      if (zone !== 'values' && key === COUNT_KEY) {
        this.ctx.toasts.show({ type: 'info', title: '件数は「値」にだけ置けます', message: '' });
        return;
      }
      if (key === Settings.COND_ROW && zone !== 'rows') {
        this.ctx.toasts.show({ type: 'info', title: '「② の行」は「行」にだけ置けます', message: '' });
        return;
      }
      const sameZone = src.from === zone;
      const fromDim = src.from === 'rows' || src.from === 'cols';
      /* 行・列にすでにある項目を一覧や値から行・列へ置こうとしたときは、置いてある場所を示すだけにする */
      if (zone !== 'values' && !fromDim) {
        const where = ['rows', 'cols'].find((z) => st[z].some((f) => f.key === key));
        if (where) return this._flashTag(where + ':' + st[where].findIndex((f) => f.key === key));
      }
      if (!sameZone && st[zone].length >= ZONE_MAX[zone]) {
        this._full(zone);
        return;
      }
      let item;
      if (zone === 'values') {
        item = src.from === 'values' ? carry
          : (type === 'number' ? { key: key, fn: 'sum', show: 'value' } : { key: null, fn: 'count', show: 'value' });
      } else {
        item = fromDim ? carry : { key: key, grain: type === 'date' ? 'month' : null };
      }
      this._change((x) => {
        if (src.from !== 'list') {
          x[src.from].splice(src.index, 1);
          if (sameZone && src.index < at) at--;
        }
        if (zone !== 'values') {
          ['rows', 'cols'].forEach((z) => {
            const i = x[z].findIndex((f) => f.key === key);
            if (i >= 0) x[z].splice(i, 1);
          });
        }
        x[zone].splice(Math.max(0, Math.min(at, x[zone].length)), 0, item);
      }, zone + ':' + Math.max(0, Math.min(at, st[zone].length)));
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

    /** 落とした位置：タグの上なら、そのタグの前（タグの右半分なら後ろ）。何もないところなら最後 */
    _drop(e, el, zone) {
      el.classList.remove('is-over');
      const raw = e.dataTransfer.getData(DRAG_TYPE);
      if (!raw) return;
      e.preventDefault();
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch (err) {
        return;
      }
      const tag = e.target.closest('.lq-pvtag');
      let at = this.settings[zone].length;
      if (tag && tag.dataset.tag.indexOf(zone + ':') === 0) {
        const r = tag.getBoundingClientRect();
        at = Number(tag.dataset.tag.split(':')[1]) + (e.clientX > r.left + r.width / 2 ? 1 : 0);
      }
      if (payload.from === zone && (at === payload.index || at === payload.index + 1)) return;
      this._move(payload, zone, at);
    }

    /* ---------------- 表示（総計・並べ替え） ---------------- */

    _optionSection() {
      const st = this.settings;
      const right = UI.switchToggle('右端に総計の列', st.totals.right, (on) => this._change((x) => {
        x.totals.right = on;
      }, right.el));
      const bottom = UI.switchToggle('下端に総計の行', st.totals.bottom, (on) => this._change((x) => {
        x.totals.bottom = on;
      }, bottom.el));
      right.input.disabled = !st.cols.length;
      right.el.title = st.cols.length ? '' : '列に項目を置くと使えます';
      const values = Settings.valuesOf(st);
      const sortSel = h('select', { class: 'lq-select', title: '行の並び順' });
      const current = st.sort.by === 'value' ? 'value-' + st.sort.dir : 'label-' + st.sort.dir;
      UI.fillSelect(sortSel, [
        { value: 'label-asc', label: '項目の順（あいうえお・日付の古い順）' },
        { value: 'label-desc', label: '項目の逆順' },
        { value: 'value-desc', label: '値の大きい順' },
        { value: 'value-asc', label: '値の小さい順' }
      ], current);
      sortSel.addEventListener('change', () => {
        const [by, dir] = sortSel.value.split('-');
        this._change((x) => {
          x.sort.by = by;
          x.sort.dir = dir;
        }, sortSel);
      });
      const valueSel = h('select', { class: 'lq-select', title: '並べ替えに使う値（総計の値で並べます）' });
      UI.fillSelect(valueSel, values.map((v, i) => ({ value: String(i), label: Settings.valueLabel(v) + ' で' })), String(st.sort.value));
      valueSel.addEventListener('change', () => this._change((x) => {
        x.sort.value = Number(valueSel.value);
      }, valueSel));
      const showValueSel = st.sort.by === 'value' && values.length > 1;
      return UI.section('表示', [
        h('div', { class: 'lq-row' }, [right.el, bottom.el]),
        UI.field('行の並び順', h('div', { class: 'lq-stack' }, [sortSel, showValueSel ? valueSel : null])),
        h('p', { class: 'lq-field__hint', text: '表のセルをダブルクリックすると、そのセルに入った行（内訳）を表示します。' })
      ]);
    }
  }

  LQ.PivotFieldTypes = FieldTypes;
  LQ.PivotPanel = PivotPanel;
  LQ.AggregatePanel = PivotPanel;
})(window);
