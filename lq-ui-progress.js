/* =========================================================================
 * LightQuery - lq-ui-progress.js
 * 処理の状態の見せ方（基本設計 1-14・1-18〜1-21）。状態（state.busy）は LQ.Progress の snapshot。
 *   ProgressBand … 表の上の帯（詳細）。画面を覆わず、処理中も表の閲覧・並べ替えはできる。
 *                  工程の並び（済み・いま・これから）・割合・経過時間・最終更新の時刻・停止の可能性を出す。
 *   JobStatus    … 上部バーの要約。処理中は「処理名・工程・割合・経過」、更新がなければ時刻つきの事実、
 *                  中止を受け付けたら「中止処理中」。終わったあとは直前の処理の結果を残し、押すと実行履歴を開く。
 *   中止は主要動作（上部バー右のボタン）の 1 か所だけに置く。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Dom = LQ.Dom;
  const Util = LQ.Util;
  const h = Dom.h;

  /* 経過時間を描き直す間隔と、「更新がない」と知らせるまでの時間 */
  const TICK_MS = 250;
  const STALL_MS = 5000;
  const KIND_LABEL = { read: '読み込み中', run: '抽出中', export: '出力中' };
  const STEP_ICON = { done: 'circle-check', active: 'circle-dot', todo: 'circle' };

  /* ---------------------------------------------------------------------
   * 共通の判定（帯と上部バーで同じ言葉・同じ基準にする）
   * ------------------------------------------------------------------- */
  const Look = {
    /** ミリ秒 → 「12 秒」「1 分 05 秒」 */
    clock(ms) {
      const sec = Math.floor(ms / 1000);
      if (sec < 60) return sec + ' 秒';
      return Math.floor(sec / 60) + ' 分 ' + Util.pad2(sec % 60) + ' 秒';
    },

    /** performance.now() の時刻 → 画面に出す時計の時刻（14:32:18） */
    wall(perfTime) {
      const d = new Date(Date.now() - (performance.now() - perfTime));
      return Util.pad2(d.getHours()) + ':' + Util.pad2(d.getMinutes()) + ':' + Util.pad2(d.getSeconds());
    },

    /**
     * 今の様子：cancelling（中止処理中）/ waiting（割合を測れない工程を処理中）/ stalled（更新がない）/ running
     * 割合を測れない工程は、更新がなくても止まっているとは言えないため「待機」として区別する（1-21）
     */
    phase(busy, now) {
      if (busy.cancelling) return 'cancelling';
      const step = busy.step;
      if (step && !step.determinate) return 'waiting';
      if (step && now - busy.advancedAt >= STALL_MS && busy.stepRatio < 1) return 'stalled';
      return 'running';
    },

    title(busy) {
      return KIND_LABEL[busy.kind] || busy.title;
    },

    /** 「工程 2 / 3：照合」（工程が 1 つなら工程名だけ） */
    stepText(busy) {
      const step = busy.step;
      if (!step) return '';
      if (busy.steps.length < 2) return step.label;
      return '工程 ' + (busy.steps.findIndex((x) => x.id === step.id) + 1) + ' / ' + busy.steps.length + '：' + step.label;
    }
  };

  /* ---------------------------------------------------------------------
   * ProgressBand：表の上に出す処理の詳細
   * ------------------------------------------------------------------- */
  class ProgressBand {
    /**
     * @param {object} ctx
     * @param {HTMLElement} host メイン領域
     * @param {HTMLElement} before この要素の前に置く（表の入れ物）
     */
    constructor(ctx, host, before) {
      this.ctx = ctx;
      this.state = ctx.state;
      this._timer = 0;
      this._busy = null;
      this.icon = Dom.icon('spinner', 'fa-spin');
      this.title = h('strong', { class: 'lq-busyband__title' });
      this.stepText = h('span', { class: 'lq-busyband__step' });
      this.bar = h('div', { class: 'lq-busyband__bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' });
      this.figures = h('span', { class: 'lq-busyband__figures lq-num' });
      this.steps = h('ol', { class: 'lq-busyband__steps' });
      this.detail = h('span', { class: 'lq-busyband__detail' });
      this.message = h('div', { class: 'lq-busyband__message' });
      this.note = h('span', { class: 'lq-busyband__note', text: '表示中の表は見る・並べ替える・コピーできます（設定の変更は完了まで止めています）' });
      this.el = h('section', { class: 'lq-busyband', hidden: true, role: 'status', 'aria-live': 'polite', 'aria-label': '処理の状態' }, [
        h('div', { class: 'lq-busyband__head' }, [h('span', { class: 'lq-busyband__icon' }, this.icon), this.title, this.stepText, this.bar, this.figures]),
        h('div', { class: 'lq-busyband__sub' }, [this.steps, this.detail]),
        this.message,
        this.note
      ]);
      host.insertBefore(this.el, before);
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
      if (first) this._show();
      this.title.textContent = Look.title(busy);
      this.detail.textContent = busy.item ? 'ファイル ' + (busy.item.index + 1) + ' / ' + busy.item.count + '：' + busy.detail : busy.detail;
      this.detail.title = this.detail.textContent;
      this._renderBar(busy);
      this._renderSteps(busy);
      this._tick();
    }

    _show() {
      Dom.clear(this.bar);
      this.el.hidden = false;
      global.clearInterval(this._timer);
      this._timer = global.setInterval(() => this._tick(), TICK_MS);
    }

    _hide() {
      if (this.el.hidden) return;
      this.el.hidden = true;
      this._busy = null;
      this._stepsKey = null;
      global.clearInterval(this._timer);
      this._timer = 0;
    }

    /** 工程ごとの区切りを持つ 1 本のバー（幅は工程の重み）。済んだ工程は塗り、今の工程は割合か動く縞 */
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
        const ratio = s.state === 'done' ? 1 : (s.state === 'active' && s.determinate ? busy.stepRatio : 0);
        seg.firstChild.style.width = Math.round(ratio * 1000) / 10 + '%';
      });
      this.bar.setAttribute('aria-valuenow', String(Math.floor(busy.ratio * 100)));
    }

    /** 工程の並び（✓ 済み・● いま・○ これから）。工程が 1 つだけなら並びは出さない */
    _renderSteps(busy) {
      this.steps.hidden = busy.steps.length < 2;
      const key = busy.steps.map((s) => s.id + ':' + s.state).join('|');
      if (key === this._stepsKey) return;
      this._stepsKey = key;
      Dom.clear(this.steps);
      busy.steps.forEach((s) => {
        this.steps.appendChild(h('li', { class: 'lq-busy__step is-' + s.state }, [
          Dom.icon(s.state === 'active' ? 'spinner' : STEP_ICON[s.state], s.state === 'active' ? 'fa-spin' : ''), h('span', { text: s.label })
        ]));
      });
    }

    /** 経過時間・最終更新・止まっている可能性を描き直す（タイマーで定期的に呼ぶ） */
    _tick() {
      const busy = this._busy;
      if (!busy) return;
      const now = performance.now();
      const phase = Look.phase(busy, now);
      this.el.dataset.phase = phase;
      this.icon.className = 'fa-solid ' + (phase === 'stalled' ? 'fa-triangle-exclamation' : phase === 'cancelling' ? 'fa-circle-stop' : 'fa-spinner fa-spin');
      this.stepText.textContent = Look.stepText(busy);
      const pct = busy.step && !busy.step.determinate ? '' : Math.floor(busy.ratio * 100) + '%・';
      this.figures.textContent = pct + '経過 ' + Look.clock(now - busy.startedAt) + '・最終更新 ' + Look.wall(busy.advancedAt);
      Dom.clear(this.message);
      this.message.hidden = false;
      if (phase === 'cancelling') {
        this.message.textContent = '中止処理中です。区切りのよいところで止めます（表示中の結果は前回のままです）';
      } else if (phase === 'stalled') {
        Dom.append(this.message, [h('strong', { text: Look.wall(busy.advancedAt) + ' から進捗が更新されていません。' }),
          busy.cancellable ? '停止している可能性があります。待っても進まないときは、右上の「中止する」で止めてください。'
            : '停止している可能性があります。ネットワーク上のファイルや大きなファイルでは時間がかかることがあります。'
        ]);
      } else if (phase === 'waiting') {
        this.message.textContent = '「' + busy.step.label + '」は進み具合を測れない工程です（動く縞で表示）。処理は続いています（この工程 ' + Look.clock(now - busy.stepStartedAt) + '）';
      } else if (busy.note) {
        this.message.textContent = busy.note;
      } else {
        this.message.hidden = true;
      }
    }
  }

  /* ---------------------------------------------------------------------
   * JobStatus：上部バーの要約（処理中の状態／直前の処理の結果）
   * ------------------------------------------------------------------- */
  class JobStatus {
    /** @param {object} ctx  @param {Function} onOpenHistory 直前の処理を押したとき */
    constructor(ctx, onOpenHistory) {
      this.ctx = ctx;
      this.state = ctx.state;
      this._timer = 0;
      this.icon = Dom.icon('spinner');
      this.text = h('span', { class: 'lq-jobstatus__text' });
      this.meter = h('span', { class: 'lq-progress' }, h('span', { class: 'lq-progress__fill' }));
      this.el = h('button', { class: 'lq-jobstatus', type: 'button', hidden: true, onclick: () => onOpenHistory() }, [this.icon, this.text, this.meter]);
      ctx.bus.on('change', (e) => {
        if (!e || e.topic === 'busy' || e.topic === 'jobs' || e.topic === 'start') this.render();
      });
    }

    render() {
      const busy = this.state.busy;
      if (busy && busy.steps) {
        if (!this._timer) this._timer = global.setInterval(() => this._tickBusy(), TICK_MS);
        this._tickBusy();
        return;
      }
      global.clearInterval(this._timer);
      this._timer = 0;
      const job = this.state.lastJob;
      if (!job) {
        this.el.hidden = true;
        return;
      }
      const st = LQ.JobLog.statusOf(job);
      const kind = LQ.JobLog.kindOf(job);
      this.el.hidden = false;
      this.el.disabled = false;
      this.el.dataset.kind = st.kind;
      this.meter.hidden = true;
      this.icon.className = 'fa-solid fa-' + st.icon;
      this.text.textContent = kind.label + ' ' + st.label + ' ' + LQ.JobLog.formatWhen(job.endedAt) + '・' + job.result;
      this.el.title = this.text.textContent + '（押すと実行履歴を開きます）';
    }

    _tickBusy() {
      const busy = this.state.busy;
      if (!busy || !busy.steps) {
        this.render();
        return;
      }
      const now = performance.now();
      const phase = Look.phase(busy, now);
      this.el.hidden = false;
      this.el.disabled = true;
      this.el.dataset.kind = phase === 'stalled' ? 'warn' : 'busy';
      this.icon.className = 'fa-solid ' + (phase === 'stalled' ? 'fa-triangle-exclamation' : phase === 'cancelling' ? 'fa-circle-stop' : 'fa-spinner fa-spin');
      const step = Look.stepText(busy);
      let tail;
      if (phase === 'cancelling') tail = '中止処理中…';
      else if (phase === 'stalled') tail = Look.wall(busy.advancedAt) + ' から更新なし';
      else tail = (phase === 'waiting' ? '' : Math.floor(busy.ratio * 100) + '%・') + '経過 ' + Look.clock(now - busy.startedAt);
      this.text.textContent = Look.title(busy) + (step ? ' ' + step : '') + '　' + tail;
      this.el.title = this.text.textContent;
      this.meter.hidden = phase === 'waiting' || phase === 'cancelling';
      this.meter.firstChild.style.width = Math.round(busy.ratio * 100) + '%';
    }
  }

  LQ.ProgressBand = ProgressBand;
  LQ.JobStatus = JobStatus;
  LQ.ProgressLook = Look;
})(window);
