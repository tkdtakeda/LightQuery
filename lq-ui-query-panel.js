/* =========================================================================
 * LightQuery - lq-ui-query-panel.js
 * 抽出条件パネル：上に抽出条件の一覧（ProfileListView）、下に選択中の抽出条件の編集
 *   （名前・② 条件データ・照合ルール（全体／個別）・組み合わせ・条件の一覧・抽出のしかた）。
 *   条件は「① 列 が ② 列 を含む」の語順で並べ、同名列の提案・除外リストのヒントを出す。
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
      this.title = '抽出条件';
      this.icon = 'filter';
      this.size = 'lg';
      this.rows = new Map();
      this._colsKey = null;
      this._profileId = null;
      this.list = new LQ.ProfileListView(ctx);
      this.el = h('div');
      Dom.append(this.el, [this.list.el, this._buildHead(), this._buildLogic(), this._buildConditions(), this._buildExtraction()]);
      ctx.bus.on('query', (d) => this.update(d));
      ['datasets', 'profiles', 'store', 'rules'].forEach((topic) => ctx.bus.on(topic, () => this.update({})));
      ctx.bus.on('focus-condition', (d) => this._focusCondition(d.id, d.field));
      ctx.bus.on('focus-issue', (issue) => this._focusIssue(issue));
      ctx.bus.on('focus-profile-name', () => this._focusName());
      this.update({});
    }

    headerActions() {
      return [
        h('button', { class: 'lq-btn lq-btn--ghost lq-btn--sm', type: 'button', title: '抽出条件を .json に書き出す（1 件・一括）',
          onclick: (e) => this.app.profileDialogs.openJsonExport(e.currentTarget) }, [Dom.icon('file-export'), '書き出し']),
        h('button', { class: 'lq-btn lq-btn--ghost lq-btn--sm', type: 'button', title: '書き出した抽出条件（.json）を読み込む（ドラッグ＆ドロップも可）',
          onclick: () => this.app.pickFile('settings') }, [Dom.icon('folder-open'), '読込'])
      ];
    }

    /* ---------------- 組み立て ---------------- */

    _buildHead() {
      this.rankBadge = h('span', { class: 'lq-badge lq-badge--rank', title: '優先順位（上の一覧で変更できます）' });
      this.nameInput = h('input', {
        class: 'lq-input lq-profname', type: 'text', maxlength: String(LQ.Profile.NAME_MAX), placeholder: '例：重点顧客', spellcheck: 'false',
        title: '抽出条件の名前（Enter で確定）。出力の「抽出条件」列やシート名に使います'
      });
      this.nameInput.addEventListener('change', () => this._commitName());
      this.condCard = h('div', { class: 'lq-condcard' });
      this.ruleLine = h('div', { class: 'lq-ruleline' });
      this.ruleField = UI.field('照合ルール（空白・全角半角などのそろえ方）', this.ruleLine);
      this.headTitle = h('span', { class: 'lq-edit__title' });
      this.head = h('section', { class: 'lq-section lq-edit' }, [
        h('h3', { class: 'lq-section__title' }, [Dom.icon('pen-to-square'), this.headTitle]),
        h('div', { class: 'lq-stack' }, [
          UI.field('名前', h('div', { class: 'lq-profname__row' }, [this.rankBadge, this.nameInput])),
          UI.field('② 条件データ（この抽出条件で使う表）', this.condCard),
          this.ruleField
        ])
      ]);
      return this.head;
    }

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
      this.condList = h('div', { class: 'lq-condlist' });
      this.emptyNote = UI.note('info', '条件がまだありません。「条件を追加」を押し、① の列・比べる相手（② の列または固定値）・比較方法を選びます。');
      this.addBtn = h('button', { class: 'lq-btn', type: 'button', onclick: () => this.app.profiles.addCondition() }, [Dom.icon('plus'), '条件を追加']);
      this.suggestBox = h('div');
      this.hintBox = h('div');
      return UI.section('条件', [this.emptyNote, this.condList, h('div', { class: 'lq-row' }, [this.addBtn]), this.suggestBox, this.hintBox], [this.countBadge]);
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
      this.extraction = UI.collapsible('抽出のしかた', [
        UI.field('出力する行', joinList),
        UI.field('① の 1 行が ② の複数の行に一致したとき', this.matchSeg.el),
        this.matchDesc,
        this.matchReason
      ], { open: LQ.Prefs.get('extractionOpen', false), onToggle: (open) => LQ.Prefs.set('extractionOpen', open) });
      return this.extraction.el;
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
      row.del = UI.iconButton('trash-can', '条件 ' + c.label + ' を削除（元に戻せます）', () => this.app.profiles.removeCondition(id), 'lq-btn--sm');
      row.issue = h('div', { class: 'lq-cond__issue', hidden: true });
      row.el = h('div', { class: 'lq-cond', dataset: { id: id } }, [row.label, row.left, h('span', { class: 'lq-cond__ga', text: 'が' }), row.rightBox, row.op, row.del, row.issue]);
      return row;
    }

    _commitExpr() {
      if (this.exprInput.value === this.state.query.logic.expr) return;
      this.state.setExpr(this.exprInput.value);
    }

    _commitName() {
      const p = this.state.activeProfile;
      if (LQ.Profile.cleanName(this.nameInput.value) === p.name) {
        this.nameInput.value = p.name;
        return;
      }
      const r = this.state.renameProfile(p.id, this.nameInput.value);
      if (!r) return;
      this.nameInput.value = r.name;
      if (r.empty) {
        Flash.input(this.nameInput, 'warn', '空欄のため元の名前');
      } else if (r.adjusted) {
        Flash.input(this.nameInput, 'warn', '同じ名前があるため変更');
        this.ctx.toasts.show({ type: 'info', title: '同じ名前があるため「' + r.name + '」にしました' });
      } else {
        Flash.input(this.nameInput);
      }
    }

    /* ---------------- 更新 ---------------- */

    update(detail) {
      const d = detail || {};
      const s = this.state;
      const p = s.activeProfile;
      const q = p.query;
      const switched = p.id !== this._profileId;
      this._profileId = p.id;
      const v = this.app.validation();
      this._renderHead(p, switched);
      this.modeSeg.set(q.logic.mode);
      this.exprField.hidden = q.logic.mode !== 'expr';
      if (switched || document.activeElement !== this.exprInput) this.exprInput.value = q.logic.expr;
      if ((d.exprChanged || d.logic) && q.logic.mode === 'expr') Flash.el(this.exprInput);
      this._renderExprStatus(v);
      this._renderReading(v);

      const src = s.datasets.source;
      const cond = s.datasets.condition;
      const colsKey = p.id + '|' + (src ? src.id + ':' + src.version : '') + '|' + (cond ? cond.id + ':' + cond.version : '');
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
        if (this.condList.children[i] !== row.el) this.condList.insertBefore(row.el, this.condList.children[i] || null);
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
      if (switched && this._shownOnce) Flash.el(this.head);
      this._shownOnce = true;
    }

    _renderHead(p, switched) {
      const s = this.state;
      const multi = s.profiles.length > 1;
      this.headTitle.textContent = multi ? '選択中の抽出条件を編集' : '抽出条件を編集';
      this.rankBadge.textContent = s.profiles.rank(p.id) + ' 位';
      this.rankBadge.hidden = !multi;
      if (switched || document.activeElement !== this.nameInput) this.nameInput.value = p.name;
      this._renderCondCard(p);
      this._renderRuleLine(p);
    }

    /** 照合ルールの行：全体の設定か個別の設定かと、その内容（抽出条件が 1 つで個別の設定もなければ出さない） */
    _renderRuleLine(p) {
      const s = this.state;
      const show = s.profiles.length > 1 || !!p.rules;
      this.ruleField.hidden = !show;
      if (!show) return;
      const text = new LQ.Normalizer(s.rulesFor(p)).describe();
      const key = [p.id, !!p.rules, text].join('|');
      if (key === this._ruleKey) return;
      const changed = this._ruleKey !== undefined && this._ruleKey.split('|')[0] === p.id;
      this._ruleKey = key;
      Dom.clear(this.ruleLine);
      Dom.append(this.ruleLine, [
        p.rules
          ? h('span', { class: 'lq-tag lq-tag--own', title: 'この抽出条件だけの照合ルールで比べます' }, [Dom.icon('filter'), '個別の設定'])
          : h('span', { class: 'lq-tag', title: '全体の照合ルールで比べます' }, [Dom.icon('globe'), '全体の設定']),
        h('span', { class: 'lq-ruleline__text', text: text, title: text }),
        h('button', { class: 'lq-btn lq-btn--xs', type: 'button', title: '照合ルールのパネルを開く（全体の設定／この抽出条件だけの設定を選べます）',
          onclick: () => this.state.openPanel('rules') }, [Dom.icon('spell-check'), '変更'])
      ]);
      if (changed) Flash.el(this.ruleLine);
    }

    /** ② 条件データのカード：読み込み済みなら表の要約と操作、未読み込みなら読み込みの案内 */
    _renderCondCard(p) {
      const card = this.condCard;
      const ds = p.condition;
      const st = this.app.store.statusOf(p.id);
      const ref = p.conditionRef;
      const key = [p.id, ds ? ds.id + ':' + ds.version : '', ref ? ref.fileName + ':' + ref.sheetName : '', st ? st.stored + ':' + st.reason : '',
        LQ.QueryOps.fixedOnly(p.query), p.isSample].join('|');
      if (key === this._cardKey) return;
      this._cardKey = key;
      Dom.clear(card);
      card.className = 'lq-condcard' + (ds ? '' : ' is-empty');
      card.onclick = null;
      card.onkeydown = null;
      card.removeAttribute('role');
      card.removeAttribute('tabindex');
      if (ds) {
        const src = ds.source;
        const meta = [Util.formatInt(ds.rowCount) + ' 行 × ' + ds.colCount + ' 列'];
        const sheet = src.hasSheets ? src.sheetName : (src.storedRef ? src.storedRef.sheetName : '');
        if (sheet) meta.push('シート「' + sheet + '」');
        if (src.storedRef) meta.push('保存データ（元：' + (src.storedRef.kindLabel || '不明') + '）');
        const names = ds.columnNames();
        Dom.append(card, [
          Dom.icon(src.kind === 'stored' ? 'floppy-disk' : 'table-list', 'lq-condcard__icon'),
          h('div', { class: 'lq-condcard__body' }, [
            h('div', { class: 'lq-condcard__name', text: ds.name, title: ds.name }),
            h('div', { class: 'lq-condcard__meta', text: meta.join('・') }),
            h('div', { class: 'lq-condcard__cols', text: '列：' + names.slice(0, 6).join('・') + (names.length > 6 ? ' ほか ' + (names.length - 6) + ' 列' : ''), title: names.join('、') }),
            this._storeNote(p)
          ]),
          h('div', { class: 'lq-condcard__actions' }, [
            h('button', { class: 'lq-btn lq-btn--xs', type: 'button', title: '別のファイル・シートに差し替える（元に戻せます）', onclick: () => this.app.pickFile('condition') },
              [Dom.icon('file-import'), '差し替え']),
            h('button', { class: 'lq-btn lq-btn--xs', type: 'button', title: 'ヘッダー行・データ開始行などの読み込み設定を開く', onclick: () => this.state.openPanel('condition') },
              [Dom.icon('sliders'), '読み込み設定']),
            h('button', { class: 'lq-btn lq-btn--xs lq-btn--danger', type: 'button', title: 'この抽出条件から ② を外す（元に戻せます）', onclick: () => this.app.clearDataset('condition') },
              [Dom.icon('xmark'), '外す'])
          ])
        ]);
        return;
      }
      const open = () => this.app.pickFile('condition');
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.onclick = open;
      card.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      };
      const lines = [h('div', { class: 'lq-condcard__name', text: '② 条件データを読み込む' }),
        h('div', { class: 'lq-condcard__meta', text: 'クリックして選択／ドラッグ＆ドロップ／Ctrl+V（複数のファイル・シートは、表ごとに抽出条件にできます）' })];
      if (ref && ref.fileName) {
        lines.push(h('div', { class: 'lq-condcard__ref' }, [Dom.icon('clock-rotate-left'),
          h('span', { text: '前回：' + ref.fileName + (ref.sheetName ? '（シート「' + ref.sheetName + '」）' : '') + '。同じファイルを選ぶと、読み込み範囲も前回どおりにします' })]));
        const note = this._storeNote(p);
        if (note) lines.push(note);
      } else if (LQ.QueryOps.fixedOnly(p.query)) {
        lines.push(h('div', { class: 'lq-condcard__ref' }, [Dom.icon('circle-info'), h('span', { text: '条件がすべて固定値のため、② は不要です' })]));
      }
      Dom.append(card, [Dom.icon('file-arrow-up', 'lq-condcard__icon'), h('div', { class: 'lq-condcard__body' }, lines)]);
    }

    /** ② をブラウザに保存しているか（しなかったなら理由） */
    _storeNote(p) {
      if (p.isSample) return h('div', { class: 'lq-condcard__store' }, [Dom.icon('flask'), h('span', { text: 'サンプルのため保存しません（複製すると自分の抽出条件として保存）' })]);
      const st = this.app.store.statusOf(p.id);
      if (!st) return null;
      if (st.stored) return h('div', { class: 'lq-condcard__store is-ok' }, [Dom.icon('floppy-disk'), h('span', { text: 'ブラウザに保存済み（次回もそのまま使えます）' })]);
      return h('div', { class: 'lq-condcard__store is-warn' }, [Dom.icon('triangle-exclamation'), h('span', { text: LQ.ProfileStore.reasonText(st.reason) })]);
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
        h('button', { class: 'lq-btn lq-btn--sm', type: 'button', disabled: !targets.length, onclick: () => this.app.profiles.addSameNameConditions(targets) },
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
        h('button', { class: 'lq-btn lq-btn--sm', type: 'button', onclick: () => this.app.profiles.convertToExclusion() }, [Dom.icon('wand-magic-sparkles'), 'この設定に切り替える'])));
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
      const join = LQ.QueryEngine.JOIN_KINDS.find((j) => j.id === q.joinKind);
      this.extraction.summary.textContent = (join ? join.label : '') + (reason ? '' : '・' + (mode ? mode.label : ''));
      if (d.joinKind || d.matchMode) Flash.el(this.extraction.summary);
    }

    /* ---------------- フォーカス移動 ---------------- */

    _focusName() {
      this.head.scrollIntoView({ block: 'nearest' });
      this.nameInput.focus();
      this.nameInput.select();
      Flash.el(this.head);
    }

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
      if (issue.code === 'joinKind' || issue.code === 'matchMode') this.extraction.el.open = true;
      if (issue.condId) this._focusCondition(issue.condId, issue.field);
    }
  }

  LQ.QueryPanel = QueryPanel;
})(window);
