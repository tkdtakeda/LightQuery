/* =========================================================================
 * LightQuery - lq-ui-cond-row.js
 * 条件 1 行の編集欄：「[記号] ① 列 が [② 列／固定値] [比較方法] [削除]」
 *   ・範囲は相手を 2 つ（開始〜終了）並べる。どちらかが空欄ならその側は制限なし
 *   ・① の列が日付の列なら、比較方法を日付向けの呼び方（以降・以前・範囲・期間）で出す
 *   ・期間の固定値には候補（今月・直近30日など）を出し、読み取った期間を行の下に示す
 *   行は id ごとに使い回し、入力中のフォーカスを失わないようにする（QueryPanel が保持）。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Dom = LQ.Dom;
  const Util = LQ.Util;
  const UI = LQ.UI;
  const Flash = LQ.Flash;
  const h = Dom.h;

  const FIXED = '__fixed__';
  const NONE = '__none__';
  const DATE_SAMPLE = 200;
  const DATE_RATIO = 0.8;
  const PERIOD_LIST_ID = 'lqPeriodWords';

  /* ---------------------------------------------------------------------
   * DateColumns：列が日付の列か（空欄以外の値の 8 割以上が日付として読めるか）。データの版ごとに覚える
   * ------------------------------------------------------------------- */
  const dateCache = new WeakMap();

  const DateColumns = {
    isDate(ds, name) {
      if (!ds || !name) return false;
      let entry = dateCache.get(ds);
      if (!entry || entry.version !== ds.version) {
        entry = { version: ds.version, map: new Map() };
        dateCache.set(ds, entry);
      }
      if (entry.map.has(name)) return entry.map.get(name);
      const col = ds.findColumn(name);
      let seen = 0;
      let dates = 0;
      for (let r = 0; col >= 0 && r < ds.rowCount && seen < DATE_SAMPLE; r++) {
        const v = ds.cell(r, col);
        if (LQ.Normalizer.isBlank(v)) continue;
        seen++;
        if (Number.isNaN(LQ.ValueParser.parseNumber(v)) && !Number.isNaN(LQ.ValueParser.parseDate(v))) dates++;
      }
      const result = seen > 0 && dates / seen >= DATE_RATIO;
      entry.map.set(name, result);
      return result;
    }
  };

  function operatorOptions(isDate) {
    const Operators = LQ.Operators;
    return Operators.groups(isDate).map((g) => ({
      group: g.label,
      items: g.items.map((op) => {
        let label = op.phrase.indexOf(op.name) !== -1 ? op.phrase : op.phrase + '（' + op.name + '）';
        if (op.pair || op.rightPrep) label = op.name;
        return { value: op.id, label: isDate && op.date ? Operators.nameOf(op, true) : label };
      })
    }));
  }

  /** 期間の候補（画面に 1 つだけ置く datalist） */
  function ensurePeriodList() {
    if (document.getElementById(PERIOD_LIST_ID)) return;
    document.body.appendChild(h('datalist', { id: PERIOD_LIST_ID }, LQ.Period.WORDS.map((w) => h('option', { value: w }))));
  }

  class ConditionRow {
    /**
     * @param {object} ctx
     * @param {object} c 条件
     */
    constructor(ctx, c) {
      this.ctx = ctx;
      this.state = ctx.state;
      this.app = ctx.app;
      this.id = c.id;
      this._opKey = null;
      this.label = UI.badge('label', c.label);
      this.left = h('select', { class: 'lq-select lq-select--sm', title: '① 元データの列' });
      this.left.addEventListener('change', () => this._patch({ left: this.left.value }, this.left));
      this.right = this._columnSelect('col', '比べる相手：② 条件データの列、または固定値');
      this.right2 = this._columnSelect('col2', '範囲の終わり：② 条件データの列（「指定なし」なら制限なし）');
      this.value = this._valueInput('value');
      this.value2 = this._valueInput('value2');
      this.debounce = this.value.debounce;
      this.back = UI.iconButton('table-list', '② の列から選ぶ', () => {
        this.state.updateCondition(this.id, { right: { type: 'column' } });
        this.right.focus();
      }, 'lq-btn--sm');
      this.tilde = h('span', { class: 'lq-cond__ga', text: '〜' });
      this.rightBox = h('div', { class: 'lq-cond__right' });
      this.op = h('select', { class: 'lq-select lq-select--sm', title: '比較方法' });
      this.op.addEventListener('change', () => this._patch({ op: this.op.value }, this.op));
      this.del = UI.iconButton('trash-can', '条件 ' + c.label + ' を削除（元に戻せます）', () => this.app.profiles.removeCondition(this.id), 'lq-btn--sm');
      this.issue = h('div', { class: 'lq-cond__issue', hidden: true });
      this.hint = h('div', { class: 'lq-cond__meta', hidden: true });
      this.el = h('div', { class: 'lq-cond', dataset: { id: this.id } },
        [this.label, this.left, h('span', { class: 'lq-cond__ga', text: 'が' }), this.rightBox, this.op, this.del, this.issue, this.hint]);
    }

    _find() {
      return this.state.findCondition(this.id);
    }

    /** 変わったときだけ反映して合図を出す */
    _patch(patch, el) {
      const cur = this._find();
      if (!cur) return;
      const key = Object.keys(patch)[0];
      if (cur[key] === patch[key]) return;
      this.state.updateCondition(this.id, patch);
      Flash.el(el);
    }

    _columnSelect(key, title) {
      const select = h('select', { class: 'lq-select lq-select--sm', title: title });
      select.addEventListener('change', () => {
        const cur = this._find();
        if (!cur) return;
        if (select.value === FIXED) {
          this.state.updateCondition(this.id, { right: { type: 'value' } });
          this.value.focus();
          return;
        }
        const v = select.value === NONE ? '' : select.value;
        if (cur.right.type === 'column' && (cur.right[key] || '') === v) return;
        const right = { type: 'column' };
        right[key] = v;
        this.state.updateCondition(this.id, { right: right });
        Flash.el(select);
      });
      return select;
    }

    _valueInput(key) {
      const input = h('input', { class: 'lq-input lq-input--sm', type: 'text' });
      const commit = () => {
        const cur = this._find();
        if (!cur || (cur.right[key] || '') === input.value) return;
        const right = {};
        right[key] = input.value;
        this.state.updateCondition(this.id, { right: right });
      };
      input.debounce = Util.debounce(commit, 300);
      input.addEventListener('input', input.debounce);
      input.addEventListener('change', () => {
        input.debounce.cancel();
        commit();
        Flash.el(input);
      });
      return input;
    }

    /** 相手の欄を今の条件の形（列／固定値 × 1 つ／範囲）に組み替える */
    _layoutRight(c, pair) {
      const parts = c.right.type === 'value'
        ? (pair ? [this.value, this.tilde, this.value2, this.back] : [this.value, this.back])
        : (pair ? [this.right, this.tilde, this.right2] : [this.right]);
      const now = Array.prototype.slice.call(this.rightBox.children);
      if (now.length === parts.length && parts.every((el, i) => now[i] === el)) return;
      Dom.clear(this.rightBox);
      Dom.append(this.rightBox, parts);
    }

    _fillColumns(select, cond, current, pair, first) {
      const opts = cond ? cond.columns.map((col) => ({ value: col.name, label: col.name })) : [];
      if (current && (!cond || cond.findColumn(current) < 0)) opts.push({ value: current, label: current + '（見つかりません）' });
      if (pair) opts.unshift({ value: NONE, label: first ? '（開始の指定なし）' : '（終了の指定なし）' });
      if (first) opts.push({ group: '固定値', items: [{ value: FIXED, label: '✎ 固定値を入力…' }] });
      const placeholder = cond ? (pair ? (first ? '② 開始の列' : '② 終了の列') : '② の列を選択') : '② 未読み込み（固定値は可）';
      UI.fillSelect(select, opts, current || (pair ? NONE : ''), placeholder);
    }

    /**
     * 条件の内容を表示に反映する。
     * @param {object} c 条件
     * @param {object} v 検証結果
     * @param {boolean} colsChanged ① / ② の列が変わったか
     */
    update(c, v, colsChanged) {
      const s = this.state;
      const src = s.datasets.source;
      const cond = s.datasets.condition;
      const op = LQ.Operators.get(c.op);
      const pair = !!(op && op.pair);
      const period = !!(op && op.rightPrep === 'period');
      const isDate = DateColumns.isDate(src, c.left);
      if (colsChanged || this.left.value !== c.left) {
        const opts = src ? src.columns.map((col) => ({ value: col.name, label: col.name + (DateColumns.isDate(src, col.name) ? '（日付）' : '') })) : [];
        if (c.left && (!src || src.findColumn(c.left) < 0)) opts.push({ value: c.left, label: c.left + '（見つかりません）' });
        UI.fillSelect(this.left, opts, c.left, src ? '① の列を選択' : '① 未読み込み');
      }
      this.el.classList.toggle('is-pair', pair);
      this._layoutRight(c, pair);
      if (c.right.type === 'value') {
        if (document.activeElement !== this.value) this.value.value = c.right.value || '';
        if (document.activeElement !== this.value2) this.value2.value = c.right.value2 || '';
        this._placeholders(pair, period, isDate);
      } else {
        const key = [colsChanged, pair, c.right.col, c.right.col2].join('|');
        if (colsChanged || this._rightKey !== key) {
          this._rightKey = key;
          this._fillColumns(this.right, cond, c.right.col, pair, true);
          if (pair) this._fillColumns(this.right2, cond, c.right.col2, true, false);
        }
      }
      const opKey = isDate ? 'date' : 'plain';
      if (this._opKey !== opKey) {
        this._opKey = opKey;
        UI.fillSelect(this.op, operatorOptions(isDate), c.op);
        this.op.title = isDate ? '比較方法（① が日付の列のため、日付向けの呼び方で表示しています）' : '比較方法';
      }
      if (this.op.value !== c.op) this.op.value = c.op;
      this._renderIssue(c, v);
      this._renderHint(c, period);
    }

    _placeholders(pair, period, isDate) {
      if (period) {
        ensurePeriodList();
        this.value.setAttribute('list', PERIOD_LIST_ID);
        this.value.placeholder = '例：2024/05・今月・直近30日';
        this.value.title = '期間：年（2024）・年月（2024/05）・年度（2024年度）・日付、または今日を基準にした言葉（今日・今月・先月・今年度・直近30日 など）。候補から選べます';
        return;
      }
      this.value.removeAttribute('list');
      const example = isDate ? '2024/04/01' : '1000';
      this.value.placeholder = pair ? '開始（例：' + example + '）' : '固定値（例：' + example + '）';
      this.value.title = pair ? '範囲の開始（空欄なら制限なし・その値を含む）' : '比べる固定値（① の値と比べます）';
      this.value2.placeholder = pair ? '終了（例：' + (isDate ? '2024/04/30' : '5000') + '）' : '';
      this.value2.title = '範囲の終わり（空欄なら制限なし・その値を含む）';
    }

    _renderIssue(c, v) {
      const issues = v.issues.filter((i) => i.condId === c.id);
      const err = issues.find((i) => i.level === 'error');
      const warn = issues.find((i) => i.level === 'warn');
      this.el.classList.toggle('is-invalid', !!err);
      this.el.classList.toggle('is-unused', !err && !!warn && warn.code === 'unused');
      [this.left, this.right, this.right2, this.value, this.value2, this.op].forEach((el) => el.classList.remove('is-invalid'));
      if (err) {
        let target = this.right;
        if (err.field === 'left') target = this.left;
        else if (err.field === 'op') target = this.op;
        else if (c.right.type === 'value') target = this.value;
        target.classList.add('is-invalid');
      }
      const shown = err || warn;
      this.issue.hidden = !shown;
      Dom.clear(this.issue);
      if (shown) this.issue.appendChild(UI.status(err ? 'warn' : 'info', shown.message.replace(/^条件 [A-Z]：/, '')));
    }

    /** 期間の固定値は、読み取った期間（日付の範囲）を行の下に示す */
    _renderHint(c, period) {
      const p = period && c.right.type === 'value' ? LQ.Period.parse(c.right.value) : null;
      this.hint.hidden = !p;
      Dom.clear(this.hint);
      if (p) Dom.append(this.hint, [Dom.icon('calendar-days'), ' ' + LQ.Period.describe(p) + ' の日付が対象です']);
    }

    /** フォーカスを移す先（検証の不備の欄） */
    focusTarget(field) {
      const c = this._find();
      if (field === 'right') return c && c.right.type === 'value' ? this.value : this.right;
      if (field === 'op') return this.op;
      return this.left;
    }
  }

  LQ.ConditionRow = ConditionRow;
  LQ.DateColumns = DateColumns;
})(window);
