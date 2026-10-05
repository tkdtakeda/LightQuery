/* =========================================================================
 * LightQuery - lq-ui-combo.js
 * 列を入力で探して選ぶ欄（サジェスト）。列の多い表で、選択欄を目で追わずに済むようにする。
 *
 * ── 列の探し方 ──
 *   ColumnSearch：全角半角・大文字小文字・カタカナひらがなをそろえて照らし合わせ、
 *   完全一致 → 列記号 → 前方一致 → 一部一致 → 入力した文字を順に含む（例：「売金」→「売上金額」）の順に並べる。
 *
 * ── 入力で選ぶ欄 ──
 *   ColumnCombo.enhance(select)：今ある <select> を「入力できる欄＋候補の一覧」に見せ替える。
 *   値・選択肢・change イベントはもとの <select> がそのまま持つため、呼び出し側は
 *   select.value / UI.fillSelect / 'change' を今までどおり使える（見た目だけを差し替える）。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Dom = LQ.Dom;
  const Util = LQ.Util;
  const h = Dom.h;

  /* ---------------------------------------------------------------------
   * ColumnSearch：列名の照らし合わせと並べ替え
   * ------------------------------------------------------------------- */
  const KATAKANA = /[ァ-ヶ]/g;
  const KANA_SHIFT = 0x60;
  /* 並び順の段（小さいほど上） */
  const TIER = { exact: 0, letter: 1, prefix: 2, part: 3, fuzzy: 4 };

  /** 1 文字ずつそろえ、そろえた後の各文字が元の何文字目かを記録する（強調表示の位置合わせ用） */
  function normalizeMap(text) {
    let out = '';
    const map = [];
    const chars = Array.from(String(text || ''));
    let pos = 0;
    chars.forEach((ch) => {
      const n = ch.normalize('NFKC').toLowerCase().replace(KATAKANA, (k) => String.fromCharCode(k.charCodeAt(0) - KANA_SHIFT));
      for (let i = 0; i < n.length; i++) map.push(pos);
      out += n;
      pos += ch.length;
    });
    map.push(pos);
    return { text: out, map: map };
  }

  const ColumnSearch = {
    normalize(text) {
      return normalizeMap(text).text;
    },

    /** 一部一致か列記号の完全一致か（列タグの絞り込み・表の強調に使う。文字を順に含むだけの列は含めない） */
    matches(name, letter, word) {
      const w = ColumnSearch.normalize(String(word || '').trim());
      if (!w) return true;
      return ColumnSearch.normalize(name).indexOf(w) !== -1 || (!!letter && ColumnSearch.normalize(letter) === w);
    },

    /**
     * 1 つの候補の当てはまり具合。当てはまらなければ null。
     * @param {string} label 表示名
     * @param {string} letter 列記号（なければ ''）
     * @param {string} word 入力（空白で区切ると、すべての語を含むもの）
     * @returns {{tier:number, rank:number, ranges:number[][]}|null} ranges：label の中の強調する範囲 [開始, 終了)
     */
    score(label, letter, word) {
      const q = ColumnSearch.normalize(word).trim();
      if (!q) return { tier: TIER.part, rank: 0, ranges: [] };
      const nm = normalizeMap(label);
      const t = nm.text;
      const span = (from, to) => [nm.map[from], nm.map[to]];
      const tokens = q.split(/\s+/);
      if (tokens.length > 1) {
        const ranges = [];
        for (let i = 0; i < tokens.length; i++) {
          const at = t.indexOf(tokens[i]);
          if (at < 0) return null;
          ranges.push(span(at, at + tokens[i].length));
        }
        return { tier: TIER.part, rank: 0, ranges: ranges };
      }
      if (t === q) return { tier: TIER.exact, rank: 0, ranges: [span(0, t.length)] };
      if (letter && ColumnSearch.normalize(letter) === q) return { tier: TIER.letter, rank: 0, ranges: [] };
      const at = t.indexOf(q);
      if (at === 0) return { tier: TIER.prefix, rank: t.length, ranges: [span(0, q.length)] };
      if (at > 0) return { tier: TIER.part, rank: at, ranges: [span(at, at + q.length)] };
      /* 入力した文字を順に含む：まとまって含むほど上 */
      const ranges = [];
      let from = 0;
      let first = -1;
      let last = -1;
      for (const ch of q) {
        const k = t.indexOf(ch, from);
        if (k < 0) return null;
        if (first < 0) first = k;
        last = k;
        ranges.push(span(k, k + ch.length));
        from = k + ch.length;
      }
      return { tier: TIER.fuzzy, rank: last - first, ranges: ranges };
    },

    /**
     * 候補を当てはまる順に並べる（同じ段の中は元の並び）。
     * @param {{label:string, letter:string}[]} items
     * @param {string} word
     * @returns {{item:object, ranges:number[][]}[]}
     */
    rank(items, word) {
      const hits = [];
      items.forEach((item, i) => {
        const s = ColumnSearch.score(item.label, item.letter, word);
        if (s) hits.push({ item: item, ranges: s.ranges, tier: s.tier, rank: s.rank, i: i });
      });
      hits.sort((a, b) => a.tier - b.tier || a.rank - b.rank || a.i - b.i);
      return hits;
    }
  };

  /* ---------------------------------------------------------------------
   * ColumnCombo：入力して列を選ぶ欄
   * ------------------------------------------------------------------- */
  const MAX_ITEMS = 300;
  const LIST_GAP = 2;
  const LIST_MARGIN = 8;
  const VALUE_DESC = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');

  class ColumnCombo {
    /**
     * 今ある <select> を入力で選べる欄にする。戻り値の el を、select の代わりに画面へ置く。
     * @param {HTMLSelectElement} select
     * @param {{letterOf?:Function}} [options] letterOf：値 → 列記号（候補の左に出し、列記号でも探せる）
     * @returns {ColumnCombo}
     */
    static enhance(select, options) {
      return select._lqCombo || new ColumnCombo(select, options || {});
    }

    /** 表の列名 → 列記号（見つからなければ ''） */
    static letterIn(ds, name) {
      if (!ds || !name) return '';
      const idx = ds.findColumn(name);
      return idx < 0 ? '' : (ds.columns[idx].letter || '');
    }

    constructor(select, options) {
      this.select = select;
      this.letterOf = options.letterOf || null;
      this._open = false;
      this._dirty = false;
      this._hits = [];
      this._active = -1;
      this._reposition = null;
      const small = select.classList.contains('lq-select--sm');
      this.input = h('input', {
        class: 'lq-input lq-combo__input' + (small ? ' lq-input--sm' : ''), type: 'text', autocomplete: 'off', spellcheck: 'false',
        role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false'
      });
      this.list = h('div', { class: 'lq-combo__list', role: 'listbox' });
      this.list.addEventListener('mousedown', (e) => e.preventDefault());
      this.list.addEventListener('click', (e) => {
        const row = e.target.closest('[data-idx]');
        if (row) this._commit(Number(row.dataset.idx));
      });
      select.hidden = true;
      select.tabIndex = -1;
      this.el = h('span', { class: 'lq-combo' + (small ? ' lq-combo--sm' : '') }, [this.input, Dom.icon('chevron-down', 'lq-combo__caret')]);
      if (select.parentNode) select.parentNode.replaceChild(this.el, select);
      this.el.appendChild(select);
      this._bindSelect();
      this._bindInput();
      this.sync();
    }

    /** もとの select への値の設定・フォーカスを、見た目の欄にも伝える */
    _bindSelect() {
      const select = this.select;
      const self = this;
      select._lqCombo = this;
      Object.defineProperty(select, 'value', {
        configurable: true,
        get() {
          return VALUE_DESC.get.call(this);
        },
        set(v) {
          VALUE_DESC.set.call(this, v);
          self.sync();
        }
      });
      select.focus = () => this.input.focus();
    }

    _bindInput() {
      const input = this.input;
      input.addEventListener('focus', () => {
        this.sync();
        this._openList('');
      });
      input.addEventListener('mousedown', () => {
        if (document.activeElement === input && !this._open) this._openList('');
      });
      input.addEventListener('input', () => {
        this._dirty = true;
        this._openList(input.value);
      });
      input.addEventListener('blur', () => {
        this._close();
        this._revert();
      });
      input.addEventListener('keydown', (e) => this._onKey(e));
    }

    _onKey(e) {
      if (e.isComposing || e.keyCode === 229) return;
      switch (e.key) {
        case 'ArrowDown':
        case 'ArrowUp':
          e.preventDefault();
          if (!this._open) this._openList(this._dirty ? this.input.value : '');
          else this._move(e.key === 'ArrowDown' ? 1 : -1);
          break;
        case 'PageDown':
        case 'PageUp':
          if (!this._open) return;
          e.preventDefault();
          this._move(e.key === 'PageDown' ? 10 : -10);
          break;
        case 'Enter':
          /* 確定したあとの「次の欄へ」は入力補助（FormNav）に任せる */
          if (this._open && this._active >= 0) this._commit(this._active);
          else this._revert();
          this._close();
          break;
        case 'Tab':
          if (this._open && this._dirty && this._active >= 0) this._commit(this._active);
          break;
        case 'Escape':
          if (!this._open && !this._dirty) return;
          e.preventDefault();
          e.stopPropagation();
          this._close();
          this._revert();
          this.input.select();
          break;
        default:
          break;
      }
    }

    /** もとの select の状態（値・選択肢・使えるか）を欄に映す。入力の途中は文字を書き換えない */
    sync() {
      const select = this.select;
      this.input.disabled = select.disabled;
      this.input.title = select.title || '';
      const placeholder = select.options.length && select.options[0].value === '' ? select.options[0].text : '';
      this.input.placeholder = placeholder;
      if (!(this._dirty && document.activeElement === this.input)) {
        const opt = select.selectedIndex >= 0 ? select.options[select.selectedIndex] : null;
        this.input.value = opt && opt.value !== '' ? opt.text : '';
        this._dirty = false;
      }
      if (this._open) this._openList(this._dirty ? this.input.value : '');
    }

    /** 候補（空の値の選択肢＝案内文は除く） */
    _items() {
      const out = [];
      Array.prototype.forEach.call(this.select.options, (opt, i) => {
        if (opt.value === '') return;
        const group = opt.parentNode && opt.parentNode.tagName === 'OPTGROUP' ? opt.parentNode.label : '';
        out.push({ index: i, value: opt.value, label: opt.text, disabled: opt.disabled, group: group, letter: this.letterOf ? this.letterOf(opt.value) || '' : '' });
      });
      return out;
    }

    _openList(word) {
      const items = this._items();
      const q = String(word || '').trim();
      this._hits = q ? ColumnSearch.rank(items, q) : items.map((item) => ({ item: item, ranges: [] }));
      const current = this.select.value;
      this._active = q ? this._hits.findIndex((hit) => !hit.item.disabled) : this._hits.findIndex((hit) => hit.item.value === current);
      this._render(q, items.length);
      if (!this._open) {
        this._open = true;
        this.input.setAttribute('aria-expanded', 'true');
        document.body.appendChild(this.list);
        this._reposition = () => this._place();
        global.addEventListener('scroll', this._reposition, true);
        global.addEventListener('resize', this._reposition);
      }
      this._place();
      this._scrollToActive();
    }

    _close() {
      if (!this._open) return;
      this._open = false;
      this.input.setAttribute('aria-expanded', 'false');
      this.list.remove();
      global.removeEventListener('scroll', this._reposition, true);
      global.removeEventListener('resize', this._reposition);
    }

    _revert() {
      this._dirty = false;
      this.sync();
    }

    _render(q, total) {
      Dom.clear(this.list);
      const frag = document.createDocumentFragment();
      let group = null;
      const shown = this._hits.slice(0, MAX_ITEMS);
      shown.forEach((hit, i) => {
        const it = hit.item;
        if (!q && it.group !== group) {
          group = it.group;
          if (group) frag.appendChild(h('div', { class: 'lq-combo__group', text: group }));
        }
        frag.appendChild(h('div', {
          class: 'lq-combo__item' + (i === this._active ? ' is-active' : '') + (it.value === this.select.value ? ' is-current' : '') + (it.disabled ? ' is-disabled' : ''),
          role: 'option', dataset: { idx: String(i) }, 'aria-selected': i === this._active ? 'true' : 'false'
        }, [
          h('span', { class: 'lq-combo__letter', text: it.letter }),
          h('span', { class: 'lq-combo__label' }, highlight(it.label, hit.ranges)),
          q && it.group ? h('span', { class: 'lq-combo__tag', text: it.group }) : null,
          it.value === this.select.value ? Dom.icon('check', 'lq-combo__check') : null
        ]));
      });
      if (!shown.length) frag.appendChild(h('div', { class: 'lq-combo__empty' }, [Dom.icon('magnifying-glass'), '「' + q + '」に当てはまる列はありません']));
      this.list.appendChild(frag);
      const more = this._hits.length - shown.length;
      const count = q ? '「' + q + '」に当てはまる ' + Util.formatInt(this._hits.length) + ' 件（全 ' + Util.formatInt(total) + ' 件）' : '全 ' + Util.formatInt(total) + ' 件・入力して絞り込めます';
      this.list.appendChild(h('div', { class: 'lq-combo__foot' }, [count, more > 0 ? '（ほか ' + Util.formatInt(more) + ' 件は入力して絞り込んでください）' : '']));
    }

    /** 使える候補へ step 個ぶん移る（使えない候補は飛ばす） */
    _move(step) {
      const n = Math.min(this._hits.length, MAX_ITEMS);
      if (!n) return;
      const dir = step > 0 ? 1 : -1;
      let i = this._active < 0 ? (dir > 0 ? -1 : n) : this._active;
      i = Math.max(0, Math.min(n - 1, i + step));
      while (i >= 0 && i < n && this._hits[i].item.disabled) i += dir;
      if (i < 0 || i >= n) return;
      this._setActive(i);
    }

    _setActive(i) {
      const old = this.list.querySelector('.lq-combo__item.is-active');
      if (old) {
        old.classList.remove('is-active');
        old.setAttribute('aria-selected', 'false');
      }
      this._active = i;
      const row = this.list.querySelector('[data-idx="' + i + '"]');
      if (row) {
        row.classList.add('is-active');
        row.setAttribute('aria-selected', 'true');
      }
      this._scrollToActive();
    }

    _scrollToActive() {
      const row = this.list.querySelector('.lq-combo__item.is-active');
      if (row) row.scrollIntoView({ block: 'nearest' });
    }

    /** 候補を確定する：もとの select の値を変え、変わったときだけ change を送る */
    _commit(i) {
      const hit = this._hits[i];
      if (!hit || hit.item.disabled) return;
      const select = this.select;
      const changed = select.value !== hit.item.value;
      this._close();
      this._dirty = false;
      select.value = hit.item.value;
      if (changed) select.dispatchEvent(new Event('change', { bubbles: true }));
      this.sync();
      LQ.Flash.el(this.input);
    }

    /* 実行時に決まる座標だけは style で与える（見た目の値ではないため） */
    _place() {
      const r = this.input.getBoundingClientRect();
      const list = this.list;
      list.style.minWidth = Math.round(r.width) + 'px';
      list.style.left = '0px';
      list.style.top = '0px';
      const w = list.offsetWidth;
      const hgt = list.offsetHeight;
      const vw = global.innerWidth;
      const vh = global.innerHeight;
      let top = r.bottom + LIST_GAP;
      if (top + hgt > vh - LIST_MARGIN && r.top - LIST_GAP - hgt > LIST_MARGIN) top = r.top - LIST_GAP - hgt;
      const left = Math.max(LIST_MARGIN, Math.min(r.left, vw - w - LIST_MARGIN));
      list.style.left = Math.round(left) + 'px';
      list.style.top = Math.round(Math.max(LIST_MARGIN, top)) + 'px';
    }
  }

  /** 文字列のうち ranges の範囲を <mark> で囲んだ部品 */
  function highlight(text, ranges) {
    if (!ranges || !ranges.length) return [text];
    const sorted = ranges.slice().sort((a, b) => a[0] - b[0]);
    const out = [];
    let pos = 0;
    sorted.forEach((rg) => {
      const from = Math.max(rg[0], pos);
      if (rg[1] <= from) return;
      if (from > pos) out.push(text.slice(pos, from));
      out.push(h('mark', { class: 'lq-combo__mark', text: text.slice(from, rg[1]) }));
      pos = rg[1];
    });
    if (pos < text.length) out.push(text.slice(pos));
    return out;
  }

  LQ.ColumnSearch = ColumnSearch;
  LQ.ColumnCombo = ColumnCombo;
})(window);
