/* =========================================================================
 * LightQuery - lq-ui-rules-panel.js
 * 照合ルールパネル（空白・全角半角・大文字小文字・表記ゆれ（かな・法人格・記号）・数値・日付のそろえ方・ワイルドカード）
 *   編集する対象は「全体の設定」（個別の設定がない抽出条件すべてに使う）か、
 *   「この抽出条件だけ」（選択中の抽出条件の個別の設定）のどちらか。
 *   対象の切替は、抽出条件が複数あるか個別の設定があるときだけ表示する（1 件だけなら全体の設定だけを扱う）。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Dom = LQ.Dom;
  const UI = LQ.UI;
  const Flash = LQ.Flash;
  const h = Dom.h;

  const RULES = [
    { key: 'space', type: 'select', label: '空白',
      options: [{ value: 'trim', label: '前後の空白を無視' }, { value: 'all', label: 'すべての空白を無視' }, { value: 'keep', label: '空白も区別する' }],
      example: '例：「 東京 」＝「東京」。「すべて無視」なら「山田 太郎」＝「山田太郎」' },
    { key: 'width', type: 'switch', label: '全角・半角を区別しない', example: '例：ＡＢＣ＝ABC、１２３＝123、ｱｲｳ＝アイウ、（）＝()' },
    { key: 'caseless', type: 'switch', label: '大文字・小文字を区別しない', example: '例：abc＝ABC、Ｃ００１＝c001' },
    { key: 'numeric', type: 'switch', label: '数値として読める値は数値で比較', example: '例：1,000＝1000、00123＝123、▲500＝-500、12%＝0.12。以上・未満は数の大きさで比べます' },
    { key: 'date', type: 'switch', label: '日付として読める値は日付で比較', example: '例：2024/1/5＝2024-01-05＝2024年1月5日＝令和6年1月5日' },
    { key: 'wildcard', type: 'switch', label: '完全一致で ② の「*」をワイルドカードにする',
      example: '例：山田*＝山田で始まる、*商事＝商事で終わる、*東京*＝東京を含む、*＝空欄以外すべて。「一致しない」は当てはまらない行。全角の＊も同じ。① の * は文字のまま' },
    { key: 'compare', type: 'switch', label: '完全一致で ② の値の >= などを比較演算子にする（Excel の COUNTIF と同じ書き方）',
      example: '例：>=0.1＝0.1 以上、<2011/01/01＝その日より前、<>アヒル＝アヒル以外、<>山田*＝山田で始まらない、=＝空欄、<>＝空欄以外。全角（＞＝ など）や ≧ ≦ ≠ も同じ。「一致しない」は当てはまらない行' },
    { key: 'kana', type: 'switch', label: 'ひらがな・カタカナを区別しない', group: '表記ゆれ（初期値はオフ）',
      example: '例：やまだ＝ヤマダ、りんご＝リンゴ。全角・半角も区別しない設定なら ｶﾞｯｺｳ＝がっこう も同じ' },
    { key: 'corp', type: 'switch', label: '法人格の書き方を無視する',
      example: '例：株式会社山田商事＝(株)山田商事＝㈱山田商事＝山田商事株式会社＝山田商事。有限会社・合同会社・一般社団法人なども同じ' },
    { key: 'symbol', type: 'switch', label: 'ハイフン・中黒などの記号を無視する',
      example: '例：03-1234-5678＝0312345678、A-101＝A101、ジョン・スミス＝ジョンスミス。長音「ー」と空白は対象外（空白は「空白」の設定）' }
  ];

  const SCOPES = [
    { value: 'global', label: '全体の設定', icon: 'globe', title: '個別の設定がない抽出条件すべてに使う照合ルールで比べます' },
    { value: 'own', label: 'この抽出条件だけ', icon: 'code-compare', title: '選択中の抽出条件だけ、別の照合ルールで比べます' }
  ];

  class RulesPanel {
    constructor(ctx) {
      this.ctx = ctx;
      this.state = ctx.state;
      this.app = ctx.app;
      this.title = '照合ルール';
      this.icon = 'spell-check';
      this.size = 'md';
      this.controls = new Map();
      this.scope = this._buildScope();
      this.editing = h('div', { class: 'lq-rulescope__editing' });
      /* 見出しで区切って、使う頻度の低いまとまり（表記ゆれ）を見分けやすくする */
      this.cards = h('div', { class: 'lq-rules' }, RULES.flatMap((rule) => [rule.group ? h('div', { class: 'lq-rule__group', text: rule.group }) : null, this._card(rule)]).filter(Boolean));
      const reset = h('button', { class: 'lq-btn lq-btn--xs', type: 'button', title: '編集中の照合ルールを初期設定に戻す', onclick: () => this._reset() },
        [Dom.icon('rotate-left'), '初期設定に戻す']);
      this.el = h('div', {}, [
        this.scope.el,
        UI.section('値をそろえてから比べます', [
          this.editing,
          this.cards,
          UI.note('info', '変更すると、表示中の結果は「未反映」になります。右上のボタンで再抽出すると反映されます。設定はこのパソコンのブラウザに記憶されます。')
        ], [reset]),
        this._fiscalSection()
      ]);
      ['rules', 'profiles'].forEach((topic) => ctx.bus.on(topic, () => this.sync()));
      this.sync();
    }

    /**
     * 年度の始まり（抽出条件ごとには変えられない、すべてに共通の設定。照合ルールの対象の切替とは別の区画にする）
     */
    _fiscalSection() {
      this.fiscal = h('select', { class: 'lq-select', title: '年度が何月から始まるか（初期値 4 月）' });
      UI.fillSelect(this.fiscal, Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: (i + 1) + ' 月から' + (i === 0 ? '（暦年と同じ）' : (i === 3 ? '（初期値）' : '')) })),
        String(LQ.Fiscal.start()));
      this.fiscalSpan = h('div', { class: 'lq-rule__example' });
      this.fiscal.addEventListener('change', () => {
        this.state.setFiscalStart(Number(this.fiscal.value));
        this._syncFiscal();
        Flash.input(this.fiscal);
        this.ctx.toasts.show({ type: 'success', title: '年度の始まりを ' + this.fiscal.value + ' 月にしました',
          message: '年度は' + LQ.Fiscal.span() + 'です。期間の条件は再抽出で、ピボット・グラフはすぐに反映します。' });
      });
      this._syncFiscal();
      const card = h('div', { class: 'lq-rule' }, [UI.field('年度の始まり', this.fiscal), this.fiscalSpan]);
      return UI.section('年度（すべての抽出条件・ピボット・グラフに共通）', [card]);
    }

    _syncFiscal() {
      this.fiscal.value = String(LQ.Fiscal.start());
      this.fiscalSpan.textContent = '年度＝' + LQ.Fiscal.span() + '。期間の条件（今年度・2024年度）、ピボット・グラフの日付のまとめ方（年度・四半期）、月の名前（4月・10月 など）の項目の並び順に使います。';
    }

    /** 編集する対象：選択中の抽出条件に個別の設定があればそれ、なければ全体の設定 */
    _target() {
      const p = this.state.activeProfile;
      return p && p.rules ? { profile: p, rules: p.rules } : { profile: null, rules: this.state.rules };
    }

    /** 対象の切替を出すか（抽出条件が複数、または個別の設定がある） */
    _scoped() {
      const s = this.state;
      return s.profiles.length > 1 || s.profiles.items.some((p) => !!p.rules);
    }

    /* ---------------- 組み立て ---------------- */

    _buildScope() {
      const who = h('div', { class: 'lq-rulescope__who' });
      const seg = new LQ.Segmented(SCOPES, 'global', (v) => {
        this.app.profiles.setRulesScope(this.state.activeId, v);
        Flash.el(seg.el);
      }, 'lq-seg--block');
      const hint = h('div', { class: 'lq-field__hint' });
      const others = h('div', { class: 'lq-rulescope__others' });
      const el = UI.section('使う照合ルール', [who, seg.el, hint, others]);
      el.classList.add('lq-rulescope');
      return { el: el, who: who, seg: seg, hint: hint, others: others };
    }

    _card(rule) {
      let control;
      const value = this._target().rules[rule.key];
      if (rule.type === 'select') {
        const select = h('select', { class: 'lq-select' });
        UI.fillSelect(select, rule.options, value);
        select.addEventListener('change', () => this._set(rule.key, select.value));
        this.controls.set(rule.key, { get: () => select.value, set: (v) => { select.value = v; } });
        control = UI.field(rule.label, select);
      } else {
        const sw = UI.switchToggle(rule.label, !!value, (checked) => this._set(rule.key, checked));
        this.controls.set(rule.key, { get: () => sw.input.checked, set: (v) => { sw.input.checked = !!v; } });
        control = sw.el;
      }
      const card = h('div', { class: 'lq-rule', dataset: { rule: rule.key } }, [control, h('div', { class: 'lq-rule__example', text: rule.example })]);
      this.controls.get(rule.key).card = card;
      return card;
    }

    /* ---------------- 操作 ---------------- */

    _apply(target, patch) {
      if (target.profile) this.state.updateProfileRules(target.profile.id, patch);
      else this.state.setRules(patch);
    }

    _set(key, value) {
      const t = this._target();
      if (t.rules[key] === value) return;
      const patch = {};
      patch[key] = value;
      this._apply(t, patch);
      const c = this.controls.get(key);
      Flash.el(c.card);
      Flash.applied(c.card.querySelector('.lq-field') || c.card);
    }

    _reset() {
      const t = this._target();
      const defaults = LQ.Normalizer.DEFAULT_RULES;
      const whose = t.profile ? '「' + t.profile.name + '」の照合ルール' : '照合ルール（全体の設定）';
      const changed = Object.keys(defaults).filter((key) => t.rules[key] !== defaults[key]);
      if (!changed.length) {
        this.ctx.toasts.show({ type: 'info', title: whose + 'はすでに初期値です' });
        return;
      }
      this._apply(t, Object.assign({}, defaults));
      changed.forEach((key) => Flash.el(this.controls.get(key).card));
      this.ctx.toasts.show({ type: 'success', title: whose + 'を初期値に戻しました' });
    }

    /* ---------------- 更新 ---------------- */

    sync() {
      const t = this._target();
      this.controls.forEach((c, key) => {
        if (c.get() !== t.rules[key]) c.set(t.rules[key]);
      });
      const scoped = this._scoped();
      this.scope.el.hidden = !scoped;
      this.editing.hidden = !scoped;
      this.cards.classList.toggle('is-own', !!t.profile);
      if (scoped) this._renderScope(t);
    }

    _renderScope(t) {
      const s = this.state;
      const p = s.activeProfile;
      const sc = this.scope;
      const inherit = s.profiles.items.filter((q) => !q.rules).length;
      Dom.clear(sc.who);
      Dom.append(sc.who, [
        h('span', { class: 'lq-rulescope__label', text: '選択中の抽出条件' }),
        UI.rank(s.profiles.rank(p.id)),
        h('strong', { class: 'lq-rulescope__name', text: p.name, title: p.name })
      ]);
      sc.seg.set(p.rules ? 'own' : 'global');
      sc.hint.textContent = p.rules
        ? 'この抽出条件だけの設定で比べます。全体の設定を変えても影響しません。「全体の設定」に戻すと、この設定は消えます（元に戻せます）。'
        : '全体の設定で比べます（個別の設定がない ' + inherit + ' 件に共通）。この抽出条件だけ変えたいときは「この抽出条件だけ」を選びます。';
      this._renderOthers(p);
      Dom.clear(this.editing);
      Dom.append(this.editing, t.profile
        ? [Dom.icon('code-compare'), h('span', { text: '編集中：「' + t.profile.name + '」だけの設定' })]
        : [Dom.icon('globe'), h('span', { text: '編集中：全体の設定（' + inherit + ' 件の抽出条件に使います）' })]);
      this.editing.classList.toggle('is-own', !!t.profile);
    }

    /** ほかに個別の設定がある抽出条件（押すとその抽出条件を選択する） */
    _renderOthers(active) {
      const s = this.state;
      const box = this.scope.others;
      Dom.clear(box);
      const own = s.profiles.items.filter((q) => q.rules && q.id !== active.id);
      box.hidden = !own.length;
      if (!own.length) return;
      box.appendChild(h('span', { class: 'lq-rulescope__label', text: 'ほかに個別の設定がある抽出条件' }));
      own.forEach((q) => box.appendChild(h('button', {
        class: 'lq-btn lq-btn--xs', type: 'button', title: '「' + q.name + '」を選択して、その照合ルールを表示します',
        onclick: () => this.state.setActive(q.id)
      }, [h('span', { class: 'lq-rulescope__rank', text: s.profiles.rank(q.id) + ' 位' }), q.name])));
    }
  }

  LQ.RulesPanel = RulesPanel;
})(window);
