/* =========================================================================
 * LightQuery - lq-ui-query-panel.js
 * 抽出条件の画面：条件 1 行の編集欄と抽出条件パネル
 * （下の区切りごとに独立した部品。読み込み順どおりに並べている）
 * ========================================================================= */

/* =========================================================================
 * ── 条件 1 行の編集欄 ──
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
      this.left = h('select', { class: 'lq-select lq-select--sm', title: '① 元データの列（入力して探せます）' });
      this.left.addEventListener('change', () => this._patch({ left: this.left.value }, this.left));
      this.right = this._columnSelect('col', '比べる相手：② 照合表の列、または固定値（入力して探せます）');
      this.right2 = this._columnSelect('col2', '範囲の終わり：② 照合表の列（「指定なし」なら制限なし。入力して探せます）');
      const letterOf = (role) => (v) => LQ.ColumnCombo.letterIn(this.state.datasets[role], v);
      this.leftBox = LQ.ColumnCombo.enhance(this.left, { letterOf: letterOf('source') }).el;
      this.rightCol = LQ.ColumnCombo.enhance(this.right, { letterOf: letterOf('condition') }).el;
      this.rightCol2 = LQ.ColumnCombo.enhance(this.right2, { letterOf: letterOf('condition') }).el;
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
        [this.label, this.leftBox, h('span', { class: 'lq-cond__ga', text: 'が' }), this.rightBox, this.op, this.del, this.issue, this.hint]);
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
        : (pair ? [this.rightCol, this.tilde, this.rightCol2] : [this.rightCol]);
      const now = Array.prototype.slice.call(this.rightBox.children);
      if (now.length === parts.length && parts.every((el, i) => now[i] === el)) return;
      Dom.clear(this.rightBox);
      Dom.append(this.rightBox, parts);
    }

    /**
     * 列の選択肢：表示中の列を先に並べ、出力しない（非表示の）列は下のグループにまとめる。
     * @param {LQ.Dataset|null} ds
     * @param {string} prefix 出力列のキーの頭（'s:' / 'c:'）
     * @param {Function} [labelOf] 列名 → 表示名
     */
    _columnOptions(ds, prefix, labelOf) {
      if (!ds) return [];
      const vis = this._visibility();
      const item = (col) => ({ value: col.name, label: labelOf ? labelOf(col.name) : col.name });
      const shown = [];
      const hidden = [];
      ds.columns.forEach((col) => {
        const v = vis.get(prefix + col.name);
        ((v === undefined ? prefix === 's:' : v) ? shown : hidden).push(item(col));
      });
      if (!hidden.length) return shown;
      return shown.concat([{ group: '非表示の列（出力しない列・' + hidden.length + ' 列）', items: hidden }]);
    }

    /** 出力列の表示状態（キー → 表示するか） */
    _visibility() {
      return new Map(this.state.output.columns.map((c) => [c.key, c.visible]));
    }

    /** 選択肢の並びが変わったかを判定するための表示状態の目印 */
    _visibilityKey(prefix) {
      return this.state.output.columns.filter((c) => c.key.slice(0, 2) === prefix && !c.visible).map((c) => c.key).join('\u0000');
    }

    _fillColumns(select, cond, current, pair, first) {
      const opts = this._columnOptions(cond, 'c:');
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
      const leftKey = [c.left, this._visibilityKey('s:')].join('|');
      if (colsChanged || this.left.value !== c.left || this._leftKey !== leftKey) {
        this._leftKey = leftKey;
        const opts = this._columnOptions(src, 's:', (name) => name + (DateColumns.isDate(src, name) ? '（日付）' : ''));
        if (c.left && (!src || src.findColumn(c.left) < 0)) opts.push({ value: c.left, label: c.left + '（見つかりません）' });
        UI.fillSelect(this.left, opts, c.left, src ? '① の列を選択' : '① 未読み込み');
      }
      this.el.classList.toggle('is-pair', pair);
      this._layoutRight(c, pair);
      /* 比べる相手の色：② の列は ② の色（青緑）、固定値は色を付けない */
      this.rightBox.classList.toggle('is-col', c.right.type !== 'value');
      this.rightBox.classList.toggle('is-value', c.right.type === 'value');
      if (c.right.type === 'value') {
        if (document.activeElement !== this.value) this.value.value = c.right.value || '';
        if (document.activeElement !== this.value2) this.value2.value = c.right.value2 || '';
        this._placeholders(pair, period, isDate);
      } else {
        const key = [colsChanged, pair, c.right.col, c.right.col2, this._visibilityKey('c:')].join('|');
        if (colsChanged || this._rightKey !== key) {
          this._rightKey = key;
          this._fillColumns(this.right, cond, c.right.col, pair, true);
          if (pair) this._fillColumns(this.right2, cond, c.right.col2, true, false);
        }
      }
      const opKey = isDate ? 'date' : 'plain';
      if (this._opKey !== opKey) {
        this._opKey = opKey;
        UI.fillSelect(this.op, LQ.Operators.menu(isDate), c.op);
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
      /* 列の欄は入力で探す欄（ColumnCombo）に見せ替えているため、印はその入力欄に付ける */
      const shown = (el) => (el._lqCombo ? el._lqCombo.input : el);
      [this.left, this.right, this.right2, this.value, this.value2, this.op].forEach((el) => shown(el).classList.remove('is-invalid'));
      if (err) {
        let target = this.right;
        if (err.field === 'left') target = this.left;
        else if (err.field === 'op') target = this.op;
        else if (c.right.type === 'value') target = this.value;
        shown(target).classList.add('is-invalid');
      }
      const notice = err || warn;
      this.issue.hidden = !notice;
      Dom.clear(this.issue);
      if (notice) this.issue.appendChild(UI.status(err ? 'warn' : 'info', notice.message.replace(/^条件 [A-Z]：/, '')));
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
  /** 期間の候補の datalist を用意して、その id を返す（絞り込みの画面でも使う） */
  DateColumns.periodList = () => {
    ensurePeriodList();
    return PERIOD_LIST_ID;
  };
  LQ.DateColumns = DateColumns;
})(window);

/* =========================================================================
 * ── 抽出条件パネル ──
 * 抽出条件パネル：上に抽出条件の一覧（ProfileListView）、下に選択中の抽出条件の編集。
 *   編集は Power Query の「マージ」と同じ順に並べる：名前・② 照合表 → 条件の一覧（どの列を比べるか）→ 組み合わせ（条件が 2 件以上のとき）
 *   → 出力する行（結合の種類）→ 照合ルール（全体／個別）→ 詳細（① の 1 行が ② の複数の行に一致したとき。畳んでおく）。
 *   条件は「① 列 が ② 列 を含む」の語順で並べ、同名列の提案・除外リストのヒントを出す。
 *   条件の行（ConditionRow）は id ごとに使い回し、入力中のフォーカスを失わないようにする。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Dom = LQ.Dom;
  const Util = LQ.Util;
  const UI = LQ.UI;
  const Flash = LQ.Flash;
  const h = Dom.h;

  const SUGGEST_LIMIT = 8;
  const MODE_OPTIONS = [
    { value: 'and', label: 'すべて満たす', icon: 'layer-group', title: 'すべての条件を満たす（AND）' },
    { value: 'or', label: 'いずれか満たす', icon: 'code-branch', title: 'いずれかの条件を満たす（OR）' },
    { value: 'expr', label: '式で指定', icon: 'code', title: '(A or B) and C のように式で指定する' }
  ];

  class QueryPanel {
    constructor(ctx) {
      this.ctx = ctx;
      this.state = ctx.state;
      this.app = ctx.app;
      this.title = '抽出条件';
      this.icon = 'code-compare';
      this.size = 'lg';
      this.rows = new Map();
      this._colsKey = null;
      this._profileId = null;
      this.list = new LQ.ProfileListView(ctx);
      this.el = h('div');
      Dom.append(this.el, [this.list.el, this._buildHead(), this._buildConditions(), this._buildLogic(), this._buildJoin(), this._buildRules(), this._buildMatch()]);
      ctx.bus.on('query', (d) => this.update(d));
      ['datasets', 'profiles', 'store', 'rules', 'output'].forEach((topic) => ctx.bus.on(topic, () => this.update({})));
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
          onclick: () => this.app.pickFile('settings') }, [Dom.icon('folder-open'), '読み込み'])
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
      this.headTitle = h('span', { class: 'lq-edit__title' });
      this.head = h('section', { class: 'lq-section lq-edit' }, [
        h('h3', { class: 'lq-section__title' }, [Dom.icon('pen-to-square'), this.headTitle]),
        h('div', { class: 'lq-stack' }, [
          UI.field('名前', h('div', { class: 'lq-profname__row' }, [this.rankBadge, this.nameInput])),
          UI.field('② 照合表（この抽出条件で使う表）', this.condCard)
        ])
      ]);
      return this.head;
    }

    /** 照合ルールの行（抽出条件が 1 つで個別の設定もなければ出さない） */
    _buildRules() {
      this.ruleLine = h('div', { class: 'lq-ruleline' });
      this.ruleField = h('section', { class: 'lq-section' }, [UI.field('照合ルール（空白・全角半角などのそろえ方）', this.ruleLine)]);
      return this.ruleField;
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
      this.logicSection = UI.section('組み合わせ（条件が 2 件以上のとき）', [this.modeSeg.el, this.exprField, UI.field('読み下し', this.reading)]);
      return this.logicSection;
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

    /**
     * 出力する行のベン図（左の円＝①、右の円＝②。塗った部分が出力される ① の行）。
     *   inner：重なり / anti：① のうち重ならない部分 / left：① 全体
     */
    static venn(kind) {
      const id = 'lq-venn-' + kind;
      const c1 = '<circle cx="46" cy="32" r="24"/>';
      const c2 = '<circle cx="74" cy="32" r="24"/>';
      let fill;
      if (kind === 'inner') {
        fill = '<clipPath id="' + id + '">' + c1 + '</clipPath><g clip-path="url(#' + id + ')"><circle class="lq-venn__fill" cx="74" cy="32" r="24"/></g>';
      } else if (kind === 'anti') {
        fill = '<mask id="' + id + '"><rect width="120" height="64" fill="white"/><circle cx="74" cy="32" r="24" fill="black"/></mask>' +
          '<circle class="lq-venn__fill" cx="46" cy="32" r="24" mask="url(#' + id + ')"/>';
      } else {
        fill = '<circle class="lq-venn__fill" cx="46" cy="32" r="24"/>';
      }
      return '<svg class="lq-venn" viewBox="0 0 120 64" aria-hidden="true">' + fill +
        '<g class="lq-venn__src">' + c1 + '</g><g class="lq-venn__cond">' + c2 + '</g>' +
        '<text class="lq-venn__label lq-venn__label--src" x="32" y="36">①</text><text class="lq-venn__label lq-venn__label--cond" x="88" y="36">②</text></svg>';
    }

    /**
     * 出力する行（一致した行／一致しなかった行／すべての行）。Power Query のマージと同じく、比べる列を決めたあとに選ぶ（横並び）。
     *   説明は選んでいるものだけを下に出し、ほかは見出しの title で示す
     */
    _buildJoin() {
      this.joinChoices = new Map();
      const joinList = h('div', { class: 'lq-choice-list lq-choice-list--row', role: 'radiogroup' });
      LQ.QueryEngine.JOIN_KINDS.forEach((j) => {
        const radio = h('input', { type: 'radio', name: 'lq-join-kind' });
        const el = h('label', { class: 'lq-choice lq-choice--compact', title: j.label + '（' + j.note + '）：' + j.desc }, [
          radio,
          h('span', { class: 'lq-choice__figure', html: QueryPanel.venn(j.id) }),
          h('span', { class: 'lq-choice__title' }, [j.label]),
          h('span', { class: 'lq-choice__note', text: j.note })
        ]);
        radio.addEventListener('change', () => {
          if (radio.checked && this.state.query.joinKind !== j.id) this.state.setJoinKind(j.id);
        });
        this.joinChoices.set(j.id, { el: el, radio: radio });
        joinList.appendChild(el);
      });
      this.joinDesc = h('div', { class: 'lq-field__hint' });
      return UI.section('出力する行（結合の種類。塗った部分の ① の行を出します）', [joinList, this.joinDesc]);
    }

    /** ① の 1 行が ② の複数の行に一致したとき（使う頻度が低いため畳んでおく） */
    _buildMatch() {
      this.matchSeg = new LQ.Segmented(LQ.QueryEngine.MATCH_MODES.map((m) => ({ value: m.id, label: m.label })), 'first', (v) => {
        this.state.setMatchMode(v);
        Flash.el(this.matchSeg.el);
      }, 'lq-seg--block');
      this.matchDesc = h('div', { class: 'lq-field__hint' });
      this.matchReason = h('div');
      this.extraction = UI.collapsible('詳細：② の複数の行に一致したとき', [
        UI.field('① の 1 行が ② の複数の行に一致したとき', this.matchSeg.el),
        this.matchDesc,
        this.matchReason
      ], { open: LQ.Prefs.get('extractionOpen', false), onToggle: (open) => LQ.Prefs.set('extractionOpen', open) });
      return this.extraction.el;
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
      this.logicSection.hidden = q.conditions.length < 2 && q.logic.mode !== 'expr';
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
          row = new LQ.ConditionRow(this.ctx, c);
          this.rows.set(c.id, row);
        }
        if (this.condList.children[i] !== row.el) this.condList.insertBefore(row.el, this.condList.children[i] || null);
        row.update(c, v, colsChanged || isNew);
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
          ? h('span', { class: 'lq-tag lq-tag--own', title: 'この抽出条件だけの照合ルールで比べます' }, [Dom.icon('code-compare'), '個別の設定'])
          : h('span', { class: 'lq-tag', title: '全体の照合ルールで比べます' }, [Dom.icon('globe'), '全体の設定']),
        h('span', { class: 'lq-ruleline__text', text: text, title: text }),
        h('button', { class: 'lq-btn lq-btn--xs', type: 'button', title: '照合ルールのパネルを開く（全体の設定／この抽出条件だけの設定を選べます）',
          onclick: () => this.state.openPanel('rules') }, [Dom.icon('spell-check'), '変更'])
      ]);
      if (changed) Flash.el(this.ruleLine);
    }

    /** ② 照合表のカード：読み込み済みなら表の要約と操作、未読み込みなら読み込みの案内 */
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
              [Dom.icon('sliders'), '読み込みの設定']),
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
      const lines = [h('div', { class: 'lq-condcard__name', text: '② 照合表を読み込む' }),
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
      const join = LQ.QueryEngine.JOIN_KINDS.find((j) => j.id === q.joinKind);
      this.joinDesc.textContent = join ? join.desc : '';
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
      this.extraction.summary.textContent = reason ? '使いません' : (mode ? mode.label : '');
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
      const el = row.focusTarget(field);
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
      if (issue.code === 'joinKind') {
        const item = this.joinChoices.get(this.state.query.joinKind);
        if (item) {
          item.el.scrollIntoView({ block: 'nearest' });
          Flash.el(item.el, 'warn');
        }
      }
      if (issue.code === 'matchMode') this.extraction.el.open = true;
      if (issue.condId) this._focusCondition(issue.condId, issue.field);
    }
  }

  LQ.QueryPanel = QueryPanel;
})(window);
