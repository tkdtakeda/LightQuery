/* =========================================================================
 * LightQuery - lq-ui-progress.js
 * 進み具合のカード：処理中（読み込み・抽出・出力）にメイン領域の中央へ重ねて表示する。
 *   見るもの：全体の割合（あと少しか、まだまだか）、段階の並び（いまどこか）、経過時間と
 *   「進みがない」合図（止まっていないか）。割合を測れない段階は動く縞で示し、その旨を添える。
 *   状態（state.busy）は LQ.Progress の snapshot。短い処理でちらつかないよう、表示は少し遅らせて出す（CSS）。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Dom = LQ.Dom;
  const Util = LQ.Util;
  const h = Dom.h;

  /* 経過時間を描き直す間隔と、「進みがない」と知らせるまでの時間 */
  const TICK_MS = 250;
  const STALL_MS = 5000;
  const KIND_ICON = { read: 'file-import', run: 'play', export: 'file-export' };
  const STEP_ICON = { done: 'circle-check', active: 'circle-dot', todo: 'circle' };

  class ProgressCard {
    /**
     * @param {object} ctx
     * @param {HTMLElement} host 重ねる領域（メイン領域）
     */
    constructor(ctx, host) {
      this.ctx = ctx;
      this.state = ctx.state;
      this.app = ctx.app;
      this._timer = 0;
      this._busy = null;
      this.icon = Dom.icon('spinner');
      this.title = h('h2', { class: 'lq-busy__title' });
      this.elapsed = h('span', { class: 'lq-busy__elapsed lq-num', title: '処理を始めてからの時間' });
      this.detail = h('div', { class: 'lq-busy__detail' });
      this.percent = h('div', { class: 'lq-busy__percent lq-num' });
      this.bar = h('div', { class: 'lq-busy__bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' });
      this.steps = h('ol', { class: 'lq-busy__steps' });
      this.now = h('div', { class: 'lq-busy__now' });
      this.hint = h('p', { class: 'lq-busy__hint' });
      this.cancelBtn = h('button', { class: 'lq-btn lq-btn--sm', type: 'button', onclick: () => this.app.cancel() }, [Dom.icon('stop'), '中止する']);
      this.card = h('div', { class: 'lq-busy__card', role: 'status', 'aria-live': 'polite' }, [
        h('div', { class: 'lq-busy__head' }, [h('span', { class: 'lq-busy__icon' }, this.icon), this.title, this.elapsed]),
        this.detail,
        h('div', { class: 'lq-busy__meter' }, [this.bar, this.percent]),
        this.steps,
        this.now,
        this.hint,
        h('div', { class: 'lq-busy__foot' }, this.cancelBtn)
      ]);
      this.el = h('div', { class: 'lq-busy', hidden: true }, this.card);
      host.appendChild(this.el);
      ctx.bus.on('busy', () => this.render());
    }

    render() {
      const busy = this.state.busy;
      if (!busy || !busy.steps) {
        this._hide();
        return;
      }
      const first = !this._busy || this._busy.startedAt !== busy.startedAt;
      this._busy = busy;
      if (first) this._show(busy);
      this.title.textContent = busy.title;
      this.detail.textContent = busy.item ? 'ファイル ' + (busy.item.index + 1) + ' / ' + busy.item.count + '：' + busy.detail : busy.detail;
      this.detail.title = this.detail.textContent;
      this.cancelBtn.hidden = !busy.cancellable;
      this._renderBar(busy);
      this._renderSteps(busy, first);
      this._tick();
    }

    _show(busy) {
      Dom.clear(this.bar);
      this.icon.className = 'fa-solid fa-' + (KIND_ICON[busy.kind] || 'spinner');
      this.el.hidden = false;
      this.el.classList.remove('is-in');
      void this.el.offsetWidth;
      this.el.classList.add('is-in');
      global.clearInterval(this._timer);
      this._timer = global.setInterval(() => this._tick(), TICK_MS);
    }

    _hide() {
      if (this.el.hidden) return;
      this.el.hidden = true;
      this._busy = null;
      global.clearInterval(this._timer);
      this._timer = 0;
    }

    /** 段階ごとの区切りを持つ 1 本のバー（幅は段階の重み）。済んだ段階は塗り、今の段階は割合か動く縞 */
    _renderBar(busy) {
      const total = busy.steps.reduce((sum, s) => sum + s.weight, 0) || 1;
      if (this.bar.children.length !== busy.steps.length) {
        Dom.clear(this.bar);
        busy.steps.forEach(() => this.bar.appendChild(h('span', { class: 'lq-busy__seg' }, h('span', { class: 'lq-busy__fill' }))));
      }
      busy.steps.forEach((s, i) => {
        const seg = this.bar.children[i];
        seg.style.flexGrow = String(s.weight / total);
        seg.className = 'lq-busy__seg is-' + s.state + (s.state === 'active' && !s.determinate ? ' is-indeterminate' : '');
        seg.title = s.label;
        const fill = seg.firstChild;
        const ratio = s.state === 'done' ? 1 : (s.state === 'active' && s.determinate ? busy.stepRatio : 0);
        fill.style.width = Math.round(ratio * 1000) / 10 + '%';
      });
      const pct = Math.floor(busy.ratio * 100);
      this.percent.textContent = pct + '%';
      this.bar.setAttribute('aria-valuenow', String(pct));
    }

    /** 段階の並び（済み・いま・これから）。段階が 1 つだけなら並びは出さない */
    _renderSteps(busy, first) {
      this.steps.hidden = busy.steps.length < 2;
      const key = busy.steps.map((s) => s.id + ':' + s.state).join('|');
      if (!first && key === this._stepsKey) return;
      this._stepsKey = key;
      Dom.clear(this.steps);
      busy.steps.forEach((s) => {
        this.steps.appendChild(h('li', { class: 'lq-busy__step is-' + s.state }, [
          Dom.icon(s.state === 'active' ? 'spinner' : STEP_ICON[s.state], s.state === 'active' ? 'fa-spin' : ''), h('span', { text: s.label })
        ]));
      });
    }

    /** 経過時間・今の段階の様子・止まっている疑いを描き直す（タイマーで定期的に呼ぶ） */
    _tick() {
      const busy = this._busy;
      if (!busy) return;
      const now = performance.now();
      this.elapsed.textContent = '経過 ' + clock(now - busy.startedAt);
      const step = busy.step;
      Dom.clear(this.now);
      this.hint.hidden = true;
      this.now.classList.remove('is-stalled');
      if (!step) return;
      const stepTime = clock(now - busy.stepStartedAt);
      if (!step.determinate) {
        Dom.append(this.now, [h('strong', { text: step.label + '中…' }), h('span', { class: 'lq-num', text: 'この段階 ' + stepTime })]);
        this.hint.hidden = false;
        this.hint.textContent = 'この段階は進み具合を測れません（動く縞で表示）。大きなファイルでは画面と秒数が止まって見えることがありますが、処理は続いています。';
        return;
      }
      const stalled = now - busy.advancedAt >= STALL_MS && busy.stepRatio < 1;
      /* 段階が 1 つだけなら、段階の名前より補足（例：照合中 1,200 / 5,000 行）を見出しにする */
      const single = busy.steps.length < 2;
      Dom.append(this.now, [
        h('strong', { text: single && busy.note ? busy.note : step.label + (single ? '' : '（' + Util.formatPercent(busy.stepRatio || 0, 0) + '）') }),
        busy.note && !single ? h('span', { class: 'lq-num', text: busy.note }) : null,
        stalled ? h('span', { class: 'lq-busy__stall' }, [Dom.icon('triangle-exclamation'), Math.floor((now - busy.advancedAt) / 1000) + ' 秒間 進みがありません']) : null
      ]);
      this.now.classList.toggle('is-stalled', stalled);
      if (stalled) {
        this.hint.hidden = false;
        this.hint.textContent = busy.cancellable
          ? 'ネットワーク上のファイルや大きなデータでは時間がかかることがあります。待っても進まないときは「中止する」で止めてください。'
          : 'ネットワーク上のファイルや大きなデータでは時間がかかることがあります。待っても進まないときは、ファイルをパソコンに保存してから読み込み直してください。';
      }
    }
  }

  /** ミリ秒 → 「12 秒」「1 分 05 秒」 */
  function clock(ms) {
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return sec + ' 秒';
    return Math.floor(sec / 60) + ' 分 ' + Util.pad2(sec % 60) + ' 秒';
  }

  LQ.ProgressCard = ProgressCard;
})(window);
