/* =========================================================================
 * LightQuery - lq-ui-query-panel.js
 * 条件パネル：組み合わせ（すべて／いずれか／式）、条件の一覧（「① 列 が ② 列 を含む」の語順）、
 *   同名列の提案、除外リストのヒント、抽出のしかた（出力する行・複数一致）。
 *   条件の行は id ごとに使い回し、入力中のフォーカスを失わないようにする。
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
  const SUGGEST_LIMIT = 8;
  const MODE_OPTIONS = [
    { value: 'and', label: 'すべて満たす', icon: 'layer-group', title: 'すべての条件を満たす（AND）' },
    { value: 'or', label: 'いずれか満たす', icon: 'code-branch', title: 'いずれかの条件を満たす（OR）' },
    { value: 'expr', label: '式で指定', icon: 'code', title: '(A or B) and C のように式で指定する' }
  ];

  function operatorOptions() {
    return LQ.Operators.groups().map((g) => ({
      group: g.label,
      items: g.items.map((op) => ({ value: op.id, label: op.phrase.indexOf(op.name) !== -1 ? op.phrase : op.phrase + '（' + op.name + '）' }))
    }));
  }

  class QueryPanel {
    constructor(ctx) {
      this.ctx = ctx;
      this.state = ctx.state;
      this.app = ctx.app;
      this.title = '条件';
      this.icon = 'filter';
      this.size = 'lg';
      this.rows = new Map();
      this._colsKey = null;
      this.el = h('div');
      Dom.append(this.el, [this._buildLogic(), this._buildConditions(), this._buildExtraction()]);
      ctx.bus.on('query', (d) => this.update(d));
      ctx.bus.on('datasets', () => this.update({}));
      ctx.bus.on('focus-condition', (d) => this._focusCondition(d.id, d.field));
      ctx.bus.on('focus-issue', (issue) => this._focusIssue(issue));
      this.update({});
    }

    headerActions() {
      return [
        h('button', { class: 'lq-btn lq-btn--ghost lq-btn--sm', type: 'button', title: '条件・照合ルール・出力列・読み込み範囲を .json に保存', onclick: () => this.app.saveSettings() },
          [Dom.icon('floppy-disk'), '保存']),
        h('button', { class: 'lq-btn lq-btn--ghost lq-btn--sm', type: 'button', title: '保存した条件設定（.json）を読み込む', onclick: () => this.app.pickFile('settings') },
          [Dom.icon('folder-open'), '読込'])
      ];
    }

    /* ---------------- 組み立て ---------------- */

    _buildLogic() {
      this.modeSeg = new LQ.Segmented(MODE_OPTIONS, 'and', (v) => this.state.setLogicMode(v), 'lq-seg--block');
      this.exprInput = h('input', { class: 'lq-input lq-expr', type: 'text', placeholder: '例：(A or B) and C', spellcheck: 'false', autocomplete: 'off' });
      this._exprDebounced = Util.debounce(() => this._commitExpr(), 250);
      this.exprInput.addEventListener('input', this._exprDebounced);
      this.exprInput.addEventListener('change', () => {
        this._exprDebounced.cancel();
        this._commitExpr();
      });
      this.exprStatus = h('div');
      this.exprField = h('div', { class: 'lq-stack' }, [
        UI.field('式（and / or・かつ / または・括弧が使えます。and が先に結び付きます）', this.exprInput),
        this.exprStatus
      ]);
      this.reading = h('div', { class: 'lq-reading' });
      return UI.section('組み合わせ', [this.modeSeg.el, this.exprField, UI.field('読み下し', this.reading)]);
    }

    _buildConditions() {
      this.countBadge = h('span', { class: 'lq-badge lq-badge--count' });
      this.list = h('div', { class: 'lq-condlist' });
      this.emptyNote = UI.note('info', '条件がまだありません。「条件を追加」を押し、① の列・比べる相手（② の列または固定値）・比較方法を選びます。');
      this.addBtn = h('button', { class: 'lq-btn', type: 'button', onclick: () => this.app.addCondition() }, [Dom.icon('plus'), '条件を追加']);
      this.suggestBox = h('div');
      this.hintBox = h('div');
      return UI.section('条件', [this.emptyNote, this.list, h('div', { class: 'lq-row' }, [this.addBtn]), this.suggestBox, this.hintBox], [this.countBadge]);
    }

    _buildExtraction() {
      this.joinChoices = new Map();
      const joinList = h('div', { class: 'lq-choice-list', role: 'radiogroup' });
      LQ.QueryEngine.JOIN_KINDS.forEach((j) => {
        const radio = h('input', { type: 'radio', name: 'lq-join-kind' });
        const el = h('label', { class: 'lq-choice' }, [
          radio,
          h('span', { class: 'lq-choice__title' }, [j.label, h('span', { class: 'lq-choice__note', text: '（' + j.note + '）' })]),
          h('span', { class: 'lq-choice__desc', text: j.desc })
        ]);
        radio.addEventListener('change', () => {
          if (radio.checked && this.state.query.joinKind !== j.id) this.state.setJoinKind(j.id);
        });
        this.joinChoices.set(j.id, { el: el, radio: radio });
        joinList.appendChild(el);
      });
      this.matchSeg = new LQ.Segmented(LQ.QueryEngine.MATCH_MODES.map((m) => ({ value: m.id, label: m.label })), 'first', (v) => {
        this.state.setMatchMode(v);
        Flash.el(this.matchSeg.el);
      }, 'lq-seg--block');
      this.matchDesc = h('div', { class: 'lq-field__hint' });
      this.matchReason = h('div');
      return UI.section('抽出のしかた', [
        UI.field('出力する行', joinList),
        UI.field('① の 1 行が ② の複数の行に一致したとき', this.matchSeg.el),
        this.matchDesc,
        this.matchReason
      ]);
    }

    _buildRow(c) {
      const id = c.id;
      const find = () => this.state.findCondition(id);
      const row = { id: id };
      row.label = UI.badge('label', c.label);
      row.left = h('select', { class: 'lq-select lq-select--sm', title: '① 元データの列' });
      row.left.addEventListener('change', () => {
        const cur = find();
        if (!cur || row.left.value === cur.left) return;
        this.state.updateCondition(id, { left: row.left.value });
        Flash.el(row.left);
      });
      row.right = h('select', { class: 'lq-select lq-select--sm', title: '比べる相手：② 条件データの列、または固定値' });
      row.right.addEventListener('change', () => {
        const cur = find();
        if (!cur) return;
        if (row.right.value === FIXED) {
          this.state.updateCondition(id, { right: { type: 'value' } });
          row.value.focus();
          return;
        }
        if (cur.right.type === 'column' && cur.right.col === row.right.value) return;
        this.state.updateCondition(id, { right: { type: 'column', col: row.right.value } });
        Flash.el(row.right);
      });
      row.value = h('input', { class: 'lq-input lq-input--sm', type: 'text', placeholder: '固定値（例：1000）', title: '比べる固定値（① の値と比べます）' });
      const commitValue = () => {
        const cur = find();
        if (!cur || cur.right.value === row.value.value) return;
        this.state.updateCondition(id, { right: { value: row.value.value } });
      };
      row.debounce = Util.debounce(commitValue, 300);
      row.value.addEventListener('input', row.debounce);
      row.value.addEventListener('change', () => {
        row.debounce.cancel();
        commitValue();
        Flash.el(row.value);
      });
      row.back = UI.iconButton('table-list', '② の列から選ぶ', () => {
        this.state.updateCondition(id, { right: { type: 'column' } });
        row.right.focus();
      }, 'lq-btn--sm');
      row.rightBox = h('div', { class: 'lq-cond__right' });
      row.op = h('select', { class: 'lq-select lq-select--sm', title: '比較方法' });
      UI.fillSelect(row.op, operatorOptions(), c.op);
      row.op.addEventListener('change', () => {
        const cur = find();
        if (!cur || cur.op === row.op.value) return;
        this.state.updateCondition(id, { op: row.op.value });
        Flash.el(row.op);
      });
      row.del = UI.iconButton('trash-can', '条件 ' + c.label + ' を削除（元に戻せます）', () => this.app.removeCondition(id), 'lq-btn--sm');
      row.issue = h('div', { class: 'lq-cond__issue', hidden: true });
      row.el = h('div', { class: 'lq-cond', dataset: { id: id } }, [row.label, row.left, h('span', { class: 'lq-cond__ga', text: 'が' }), row.rightBox, row.op, row.del, row.issue]);
      return row;
    }

    _commitExpr() {
      if (this.exprInput.value === this.state.query.logic.expr) return;
      this.state.setExpr(this.exprInput.value);
    }

    /* ---------------- 更新 ---------------- */

    update(detail) {
      const d = detail || {};
      const s = this.state;
      const q = s.query;
      const v = this.app.validation();
      this.modeSeg.set(q.logic.mode);
      this.exprField.hidden = q.logic.mode !== 'expr';
      if (document.activeElement !== this.exprInput) this.exprInput.value = q.logic.expr;
      if ((d.exprChanged || d.logic) && q.logic.mode === 'expr') Flash.el(this.exprInput);
      this._renderExprStatus(v);
      this._renderReading(v);

      const src = s.datasets.source;
      const cond = s.datasets.condition;
      const colsKey = (src ? src.id + ':' + src.version : '') + '|' + (cond ? cond.id + ':' + cond.version : '');
      const colsChanged = colsKey !== this._colsKey;
      this._colsKey = colsKey;
      const ids = new Set(q.conditions.map((c) => c.id));
      this.rows.forEach((row, id) => {
        if (!ids.has(id)) {
          row.el.remove();
          this.rows.delete(id);
        }
      });
      q.conditions.forEach((c, i) => {
        let row = this.rows.get(c.id);
        const isNew = !row;
        if (isNew) {
          row = this._buildRow(c);
          this.rows.set(c.id, row);
        }
        if (this.list.children[i] !== row.el) this.list.insertBefore(row.el, this.list.children[i] || null);
        this._updateRow(row, c, v, colsChanged || isNew);
        if (isNew && d.added === c.id) Flash.el(row.el);
      });
      this.countBadge.textContent = q.conditions.length + ' 件';
      this.emptyNote.hidden = q.conditions.length > 0;
      this.addBtn.disabled = !s.canAddCondition();
      this.addBtn.title = s.canAddCondition() ? '条件を追加する（最大 ' + LQ.AppState.MAX_CONDITIONS + ' 件）' : '条件は最大 ' + LQ.AppState.MAX_CONDITIONS + ' 件です';
      this._renderSuggestions();
      this._renderHint(v);
      this._renderExtraction(v, d);
    }

    _updateRow(row, c, v, colsChanged) {
      const s = this.state;
      const src = s.datasets.source;
      const cond = s.datasets.condition;
      if (colsChanged || row.left.value !== c.left) {
        const opts = src ? src.columns.map((col) => ({ value: col.name, label: col.name })) : [];
        if (c.left && (!src || src.findColumn(c.left) < 0)) opts.push({ value: c.left, label: c.left + '（見つかりません）' });
        UI.fillSelect(row.left, opts, c.left, src ? '① の列を選択' : '① 未読み込み');
      }
      if (c.right.type === 'value') {
        if (row.rightBox.firstChild !== row.value) {
          Dom.clear(row.rightBox);
          Dom.append(row.rightBox, [row.value, row.back]);
        }
        if (document.activeElement !== row.value) row.value.value = c.right.value || '';
      } else {
        if (row.rightBox.firstChild !== row.right) {
          Dom.clear(row.rightBox);
          row.rightBox.appendChild(row.right);
        }
        if (colsChanged || row.right.value !== (c.right.col || '')) {
          const opts = cond ? cond.columns.map((col) => ({ value: col.name, label: col.name })) : [];
          if (c.right.col && (!cond || cond.findColumn(c.right.col) < 0)) opts.push({ value: c.right.col, label: c.right.col + '（見つかりません）' });
          opts.push({ group: '固定値', items: [{ value: FIXED, label: '✎ 固定値を入力…' }] });
          UI.fillSelect(row.right, opts, c.right.col, cond ? '② の列を選択' : '② 未読み込み（固定値は可）');
        }
      }
      if (row.op.value !== c.op) row.op.value = c.op;
      const issues = v.issues.filter((i) => i.condId === c.id);
      const err = issues.find((i) => i.level === 'error');
      const warn = issues.find((i) => i.level === 'warn');
      row.el.classList.toggle('is-invalid', !!err);
      row.el.classList.toggle('is-unused', !err && !!warn && warn.code === 'unused');
      [row.left, row.right, row.value, row.op].forEach((el) => el.classList.remove('is-invalid'));
      if (err) {
        let target = row.right;
        if (err.field === 'left') target = row.left;
        else if (err.field === 'op') target = row.op;
        else if (c.right.type === 'value') target = row.value;
        target.classList.add('is-invalid');
      }
      const shown = err || warn;
      row.issue.hidden = !shown;
      Dom.clear(row.issue);
      if (shown) row.issue.appendChild(UI.status(err ? 'warn' : 'info', shown.message.replace(/^条件 [A-Z]：/, '')));
    }

    _renderExprStatus(v) {
      Dom.clear(this.exprStatus);
      const q = this.state.query;
      this.exprInput.classList.remove('is-invalid');
      if (q.logic.mode !== 'expr') return;
      if (!q.conditions.length) {
        this.exprStatus.appendChild(UI.status('info', '先に条件を追加してください（追加すると式に自動で加わります）'));
        return;
      }
      if (v.exprError) {
        this.exprInput.classList.add('is-invalid');
        const pos = v.exprError.pos >= 0 ? '（' + (v.exprError.pos + 1) + ' 文字目）' : '';
        this.exprStatus.appendChild(UI.status('warn', v.exprError.message + pos));
      } else {
        this.exprStatus.appendChild(UI.status('ok', '正しい式です'));
      }
    }

    _renderReading(v) {
      Dom.clear(this.reading);
      if (!v.ast) {
        this.reading.appendChild(h('span', { class: 'lq-muted', text: this.state.query.conditions.length ? '（式を確認してください）' : '（条件がありません）' }));
        return;
      }
      LQ.Logic.toParts(v.ast).forEach((p) => {
        if (p.kind === 'label') this.reading.appendChild(UI.badge('label', p.text));
        else if (p.kind === 'op') this.reading.appendChild(h('span', { class: 'lq-reading__op', text: p.text }));
        else this.reading.appendChild(h('span', { class: 'lq-reading__paren', text: p.text }));
      });
    }

    /* ① と ② に同じ名前の列があり、まだ対応付けていなければ提案する */
    _renderSuggestions() {
      Dom.clear(this.suggestBox);
      const s = this.state;
      const src = s.datasets.source;
      const cond = s.datasets.condition;
      if (!src || !cond) return;
      const used = new Set(s.query.conditions.filter((c) => c.right.type === 'column').map((c) => c.left + '\u0000' + c.right.col));
      const names = src.columns.map((c) => c.name).filter((n) => cond.findColumn(n) >= 0 && !used.has(n + '\u0000' + n));
      if (!names.length) return;
      const room = LQ.AppState.MAX_CONDITIONS - s.query.conditions.length;
      const targets = names.slice(0, Math.max(0, room));
      this.suggestBox.appendChild(UI.note('tip',
        h('span', {}, ['① と ② に同じ名前の列があります：', h('strong', { text: names.slice(0, SUGGEST_LIMIT).join('・') + (names.length > SUGGEST_LIMIT ? ' ほか' : '') })]),
        h('button', { class: 'lq-btn lq-btn--sm', type: 'button', disabled: !targets.length, onclick: () => this.app.addSameNameConditions(targets) },
          [Dom.icon('wand-magic-sparkles'), '「完全一致」の条件として追加（' + targets.length + ' 件）'])));
    }

    /* 否定の条件だけで ② が複数行のとき、除外リストとしての使い方を案内する */
    _renderHint(v) {
      Dom.clear(this.hintBox);
      const s = this.state;
      const q = s.query;
      const cond = s.datasets.condition;
      if (!v.ok || !v.ast || q.joinKind === 'anti' || !cond || cond.rowCount < 2) return;
      const used = LQ.Logic.labelsIn(v.ast).map((label) => q.conditions.find((c) => c.label === label));
      const onlyNegative = used.length > 0 && used.every((c) => {
        const op = LQ.Operators.get(c.op);
        return op && op.negative && c.right.type === 'column';
      });
      if (!onlyNegative) return;
      this.hintBox.appendChild(UI.note('tip',
        h('span', {}, [h('strong', { text: '「含まない」などの否定の条件だけで、② に複数の行があります。' }),
          '② の行ごとに判定するため、他の行の語を含む行も一致します。「どの語も含まない行」を出すには、比較方法を「含む」にして、出力する行を「一致しなかった行」にします。']),
        h('button', { class: 'lq-btn lq-btn--sm', type: 'button', onclick: () => this.app.convertToExclusion() }, [Dom.icon('wand-magic-sparkles'), 'この設定に切り替える'])));
    }

    _renderExtraction(v, d) {
      const q = this.state.query;
      this.joinChoices.forEach((item, id) => {
        item.radio.checked = id === q.joinKind;
        item.el.classList.toggle('is-selected', id === q.joinKind);
      });
      if (d.joinKind) Flash.el(this.joinChoices.get(q.joinKind).el);
      this.matchSeg.set(q.matchMode);
      let reason = null;
      if (q.joinKind === 'anti') reason = '「一致しなかった行」を出力するときは使いません';
      else if (v.ast && !v.needsCondition) reason = '② の列を参照する条件がないため使いません（固定値の条件のみ）';
      this.matchSeg.setDisabled(!!reason);
      const mode = LQ.QueryEngine.MATCH_MODES.find((m) => m.id === q.matchMode);
      this.matchDesc.textContent = mode ? mode.desc : '';
      Dom.clear(this.matchReason);
      if (reason) this.matchReason.appendChild(UI.status('info', reason));
    }

    /* ---------------- フォーカス移動 ---------------- */

    _focusCondition(id, field) {
      const row = this.rows.get(id);
      if (!row) return;
      const c = this.state.findCondition(id);
      let el = row.left;
      if (field === 'right') el = c && c.right.type === 'value' ? row.value : row.right;
      else if (field === 'op') el = row.op;
      row.el.scrollIntoView({ block: 'nearest' });
      el.focus();
      Flash.el(row.el);
    }

    _focusIssue(issue) {
      if (!issue) return;
      if (issue.code === 'expr') {
        this.exprInput.focus();
        Flash.el(this.exprInput, 'warn');
        return;
      }
      if (issue.condId) this._focusCondition(issue.condId, issue.field);
    }
  }

  LQ.QueryPanel = QueryPanel;
})(window);
