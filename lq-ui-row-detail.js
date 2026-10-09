/* =========================================================================
 * LightQuery - lq-ui-row-detail.js
 * 判定の根拠パネル（画面の右）：抽出結果の行をダブルクリック（Enter・行番号のクリック）すると開き、
 *   抽出条件ごとに「該当した／しなかった」と、その理由（条件ごとの ✓ ✗ と比べた値・組み合わせの式の色分け）を並べる。
 *   一致する ② の行がないときは、満たす条件が最も多い ② の行（惜しかった行）と比べた結果を出す。
 *   開いたまま表の ↑↓（またはパネルの ∧ ∨）で前後の行に移り、Esc・× で閉じる。
 *   行は結果の中の位置（並べ替え・表示する行の切替に左右されない）で覚え、結果が変わったら閉じる。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Dom = LQ.Dom;
  const UI = LQ.UI;
  const h = Dom.h;
  const fmt = LQ.Util.formatInt;

  const ITEM_STATE = {
    true: { icon: 'circle-check', text: '満たす' },
    false: { icon: 'circle-xmark', text: '満たさない' },
    ignored: { icon: 'minus', text: '判定しない（② が空欄）' },
    incomparable: { icon: 'triangle-exclamation', text: '比較できない（数値と文字など）' },
    none: { icon: 'minus', text: 'ひも付く ② の行なし' }
  };

  const CARD_STATUS = {
    assigned: { icon: 'circle-check', tone: 'ok', text: 'この行の抽出条件' },
    shadow: { icon: 'circle-check', tone: 'sub', text: '該当（優先順位が上の抽出条件に振り分け）' },
    also: { icon: 'circle-check', tone: 'sub', text: '該当（別の行としても出力）' },
    miss: { icon: 'circle-xmark', tone: 'ng', text: '該当しない' }
  };

  const VERDICT = { 1: ['is-true', '満たす'], 0: ['is-false', '満たさない'], '-1': ['is-ignored', '判定しない'] };

  /* 最初からすべて開く抽出条件の数の上限（これより多いときは、この行の抽出条件と該当なしの行だけ開く） */
  const OPEN_ALL_MAX = 3;
  const SKIP_TOPICS = { busy: true, library: true, progress: true };

  class RowDetail {
    /**
     * @param {object} ctx
     * @param {Element} host 右のパネルの置き場所
     */
    constructor(ctx, host) {
      this.ctx = ctx;
      this.state = ctx.state;
      this.host = host;
      this.k = null;
      this.result = null;
      this._scheduled = false;
      this.body = h('div', { class: 'lq-detail__body' });
      this.title = h('span', { class: 'lq-detail__title', text: '判定の根拠' });
      this.prevBtn = UI.iconButton('chevron-up', '前の行（↑）', () => this.move(-1), 'lq-btn--sm');
      this.nextBtn = UI.iconButton('chevron-down', '次の行（↓）', () => this.move(1), 'lq-btn--sm');
      Dom.append(this.host, [
        h('div', { class: 'lq-detail__head' }, [Dom.icon('circle-info', 'lq-detail__icon'), this.title, h('span', { class: 'lq-topbar__spacer' }),
          this.prevBtn, this.nextBtn, UI.iconButton('xmark', '閉じる（Esc）', () => this.close(), 'lq-btn--sm')]),
        this.body,
        h('div', { class: 'lq-detail__foot', text: '表の ↑↓ で前後の行・Esc で閉じる' })
      ]);
      ctx.bus.on('change', (e) => this._onChange(e));
    }

    isOpen() {
      return this.k !== null;
    }

    /** 表示中の i 行目を開く */
    open(i) {
      const view = this._view();
      if (!view || i < 0 || i >= view.length) return;
      this.k = view.rowAt(i);
      this.result = this.state.result;
      this.host.hidden = false;
      this._render(i);
      this._markRow(i, false);
    }

    close() {
      if (!this.isOpen()) return false;
      this.k = null;
      this.result = null;
      this.host.hidden = true;
      Dom.clear(this.body);
      this._markRow(-1, false);
      return true;
    }

    /** 表示中の位置（見つからなければ -1） */
    displayIndex() {
      const view = this._view();
      if (!view || this.k === null) return -1;
      for (let i = 0; i < view.length; i++) if (view.rowAt(i) === this.k) return i;
      return -1;
    }

    /** 前後の行へ（ページをまたぐときはページを送る） */
    move(delta) {
      const view = this._view();
      const i = this.displayIndex();
      if (!view || i < 0) return;
      const next = Math.max(0, Math.min(view.length - 1, i + delta));
      if (next === i) return;
      this.k = view.rowAt(next);
      const s = this.state;
      const page = Math.floor(next / s.view.pageSize);
      if (page !== s.view.pages.result) {
        s.setPage('result', page);
        global.requestAnimationFrame(() => global.requestAnimationFrame(() => this._markRow(next, true)));
      } else {
        this._markRow(next, true);
      }
      this._render(next);
    }

    _view() {
      return this.state.result ? this.ctx.app.main.resultView() : null;
    }

    _onChange(e) {
      if (!this.isOpen() || (e && SKIP_TOPICS[e.topic])) return;
      if (this.state.result !== this.result) {
        this.close();
        return;
      }
      if (this._scheduled) return;
      this._scheduled = true;
      global.requestAnimationFrame(() => {
        this._scheduled = false;
        if (!this.isOpen()) return;
        const i = this.displayIndex();
        if (i < 0) this.close();
        else this._render(i);
      });
    }

    /** 表の今の行に印を付ける（focus：その行にフォーカスを移す） */
    _markRow(i, focus) {
      const main = this.ctx.app.main;
      const root = main.gridwrap;
      root.querySelectorAll('tr.is-current').forEach((tr) => tr.classList.remove('is-current'));
      if (i < 0) return;
      const ri = i - main.resultPageStart();
      const tr = main.grid.rowElement(ri);
      if (!tr) return;
      tr.classList.add('is-current');
      if (focus) {
        tr.focus({ preventScroll: true });
        tr.scrollIntoView({ block: 'nearest' });
      }
    }

    /* ---------------- 描画 ---------------- */

    _render(i) {
      const info = this.ctx.app.explainRow(i);
      if (!info) {
        this.close();
        return;
      }
      const view = this._view();
      this.prevBtn.disabled = i <= 0;
      this.nextBtn.disabled = i >= view.length - 1;
      this.title.textContent = '結果 ' + fmt(i + 1) + ' 行目の判定の根拠';
      const notes = [];
      if (info.stale) notes.push(UI.note('warn', 'この結果の後に条件が変更されています。以下は現在の条件での判定です。'));
      const assigned = info.cards.find((c) => c.status === 'assigned');
      const headline = info.unmatched
        ? h('div', { class: 'lq-detail__verdict is-ng' }, [Dom.icon('circle-xmark'), h('strong', { text: 'どの抽出条件にも該当しません' }),
          h('span', { class: 'lq-sub', text: '（「該当なし」として出力）' })])
        : h('div', { class: 'lq-detail__verdict is-ok' }, [Dom.icon('circle-check'),
          info.multi ? h('span', {}, [UI.rank(String(assigned.priority)), ' ', h('strong', { text: assigned.name }), ' に該当']) : h('strong', { text: '条件に該当' })]);
      const where = h('div', { class: 'lq-sub lq-num', text: '① ' + fmt(info.sourceRowNumber) + ' 行目' +
        (info.multi ? '・抽出条件 ' + info.cards.length + ' 件を優先順位の順に表示' : '') });
      const openAll = info.unmatched || info.cards.length <= OPEN_ALL_MAX;
      const cards = info.cards.map((c) => this._card(c, info, openAll || c.status === 'assigned'));
      Dom.clear(this.body);
      Dom.append(this.body, [headline, where].concat(notes, cards));
      LQ.Flash.el(headline);
    }

    _card(c, info, open) {
      const st = CARD_STATUS[c.status];
      const e = c.explanation;
      const head = h('summary', { class: 'lq-detail__summary' }, [
        info.multi ? UI.rank(String(c.priority)) : null,
        h('span', { class: 'lq-detail__name', text: info.multi ? c.name : '抽出条件' }),
        h('span', { class: 'lq-detail__status is-' + st.tone }, [Dom.icon(st.icon), st.text])
      ]);
      const body = [];
      if (c.missing) body.push(UI.note('warn', 'この抽出条件は一覧から削除されています。'));
      else if (!e) body.push(UI.note('warn', '条件が正しくないため判定できません（抽出条件の設定を確かめてください）。'));
      else {
        body.push(h('p', { class: 'lq-detail__reason', text: this._reason(c, e) }));
        body.push(this._expression(e));
        body.push(this._items(e));
      }
      return h('details', { class: 'lq-detail__card is-' + c.status, open: open }, [head, h('div', { class: 'lq-stack' }, body)]);
    }

    /** なぜそうなったか（1 文） */
    _reason(c, e) {
      const row = c.condRowNumber ? '② ' + fmt(c.condRowNumber) + ' 行目' : '';
      if (!e.needsCondition) return e.value === 1 ? '条件を満たします。' : '条件を満たしません。';
      if (e.r < 0) return '② に行がないため一致しません。';
      const near = e.items.some((it) => it.state === 'true')
        ? 'いちばん近い（満たす条件が最も多い）' + row + 'と比べた結果です。'
        : 'どの行とも満たす条件がないため、' + row + 'と比べた例を表示しています。';
      const others = e.matches > 1 ? '（ほかに ' + fmt(e.matches - 1) + ' 行とも一致）' : '';
      if (c.joinKind === 'anti') {
        return e.matches ? row + 'と一致したため出力しません（一致しなかった行を出力する設定）。' + others
          : '② のどの行とも一致しないため出力します（一致しなかった行を出力する設定）。' + near;
      }
      if (e.matches) return row + 'と一致しました。' + others;
      return '② のどの行とも一致しません' + (c.joinKind === 'left' ? '（すべての行を出力する設定のため出力）' : '') + '。' + near;
    }

    /** 組み合わせの式を、条件ごとの判定で色分けして並べる（→ 式全体の結果） */
    _expression(e) {
      const byLabel = new Map(e.items.map((it) => [it.label, it.state]));
      const parts = LQ.Logic.toParts(e.ast).map((p) => {
        if (p.kind === 'label') {
          const state = byLabel.get(p.text) || 'none';
          const mark = state === 'true' ? '✓' : (state === 'ignored' ? '−' : '✗');
          return h('span', { class: 'lq-xpr__label is-' + state, title: ITEM_STATE[state].text }, p.text + mark);
        }
        return h('span', { class: p.kind === 'op' ? 'lq-xpr__op' : 'lq-xpr__paren', text: p.text });
      });
      const v = VERDICT[String(e.value)] || VERDICT['0'];
      return h('div', { class: 'lq-xpr', title: '組み合わせ：' + e.exprJa }, parts.concat([
        h('span', { class: 'lq-xpr__arrow' }, Dom.icon('arrow-right')),
        h('span', { class: 'lq-xpr__result ' + v[0], text: v[1] })
      ]));
    }

    /** 条件ごとの判定。結果を決めた条件（満たす行は ✓、満たさない行は ✗）を強調し、ほかは控えめにする */
    _items(e) {
      const key = e.value === 1 ? (s) => s === 'true' : (s) => s === 'false' || s === 'incomparable' || s === 'none';
      return h('ul', { class: 'lq-explain' }, e.items.map((it) => {
        const stInfo = ITEM_STATE[it.state] || ITEM_STATE.none;
        return h('li', { class: 'lq-explain__item lq-explain__item--' + it.state + (key(it.state) ? ' is-key' : ' is-dim') }, [
          UI.badge('label', it.label),
          h('span', { class: 'lq-explain__state' }, [Dom.icon(stInfo.icon), stInfo.text]),
          h('span', { class: 'lq-explain__text' }, [
            it.leftName + '「', h('span', { class: 'lq-explain__value', text: it.leftValue }), '」が ',
            it.rightName + '「', h('span', { class: 'lq-explain__value', text: it.rightValue }), '」' + it.phrase
          ])
        ]);
      }));
    }
  }

  LQ.RowDetail = RowDetail;
})(window);
