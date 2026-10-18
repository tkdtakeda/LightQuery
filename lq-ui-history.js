/* =========================================================================
 * LightQuery - lq-ui-history.js
 * 実行履歴パネル（基本設計 1-22）：読み込み・抽出・出力の結果を新しい順に並べ、あとから確かめられるようにする。
 *   ・状態はアイコン＋文字＋色（完了・完了（警告あり）・失敗・中止）
 *   ・いちばん新しい記録は中身（入力・条件・出力先・警告）を開いておき、ほかは押して開く
 *   ・作業セットで絞れる。履歴を消すときは「元に戻す」で戻せる
 *   ・抽出の記録からは、その作業セットを開いて今の ① で抽出し直せる
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Dom = LQ.Dom;
  const UI = LQ.UI;
  const h = Dom.h;

  class HistoryPanel {
    constructor(ctx) {
      this.ctx = ctx;
      this.state = ctx.state;
      this.app = ctx.app;
      this.title = '実行履歴';
      this.icon = 'clock-rotate-left';
      this.size = 'md';
      this.scope = 'all';
      this.filter = h('div', { class: 'lq-jobs__filter' });
      this.list = h('ol', { class: 'lq-jobs' });
      this.el = h('div', { class: 'lq-jobs__panel' }, [
        h('p', { class: 'lq-field__hint', text: '読み込み・抽出・出力の結果を、このブラウザに新しい順で ' + LQ.JobLog.LIMIT + ' 件まで残します（行のデータは残しません）。' }),
        this.filter,
        this.list
      ]);
      ctx.bus.on('change', (e) => {
        if (e && (e.topic === 'jobs' || e.topic === 'worksets' || e.topic === 'busy') && this.state.panel === 'history') this.render();
      });
    }

    headerActions() {
      const jobs = this.app.jobs;
      return [UI.iconButton('trash-can', jobs.items.length ? '履歴をすべて消す（元に戻せます）' : '消す履歴がありません', () => this._clear(), 'lq-btn--sm')];
    }

    onShow() {
      this.render();
    }

    _worksetName() {
      const ws = this.app.worksets && this.app.worksets.active;
      return ws ? ws.name : '';
    }

    render() {
      const jobs = this.app.jobs;
      const ws = this._worksetName();
      if (!ws) this.scope = 'all';
      Dom.clear(this.filter);
      if (ws) {
        const seg = new LQ.Segmented([
          { value: 'all', label: 'すべて（' + jobs.items.length + '）' },
          { value: 'set', label: '「' + ws + '」（' + jobs.list(ws).length + '）', title: '開いている作業セットの記録だけ' }
        ], this.scope, (v) => {
          this.scope = v;
          this.render();
        }, 'lq-seg--block');
        this.filter.appendChild(seg.el);
      }
      const items = jobs.list(this.scope === 'set' ? ws : '');
      Dom.clear(this.list);
      if (!items.length) {
        this.list.appendChild(h('li', { class: 'lq-jobs__empty' }, [Dom.icon('clock-rotate-left'),
          h('span', { text: jobs.items.length ? 'この作業セットの記録はまだありません' : 'まだ記録はありません。読み込み・抽出・出力をすると、ここに結果が残ります' })]));
        return;
      }
      items.forEach((e, i) => this.list.appendChild(this._item(e, i === 0)));
    }

    _item(e, open) {
      const st = LQ.JobLog.statusOf(e);
      const kind = LQ.JobLog.kindOf(e);
      const secs = Math.max(0, e.endedAt - e.startedAt) / 1000;
      const head = h('summary', { class: 'lq-job__head' }, [
        h('span', { class: 'lq-job__status lq-job__status--' + st.kind }, [Dom.icon(st.icon), h('span', { text: st.label })]),
        h('span', { class: 'lq-job__kind' }, [Dom.icon(kind.icon), h('span', { text: kind.label })]),
        h('span', { class: 'lq-job__when lq-num', text: LQ.JobLog.formatWhen(e.endedAt, true) + (secs >= 0.1 ? '（' + LQ.Util.formatSeconds(secs * 1000) + '）' : '') }),
        h('span', { class: 'lq-job__result', text: e.result })
      ]);
      const rows = e.details.map((d) => h('div', { class: 'lq-job__row' }, [h('dt', { text: d.label }), h('dd', { text: d.text })]));
      if (e.workset) rows.push(h('div', { class: 'lq-job__row' }, [h('dt', { text: '作業セット' }), h('dd', { text: e.workset })]));
      const body = h('div', { class: 'lq-job__body' }, [
        rows.length ? h('dl', { class: 'lq-job__details' }, rows) : null,
        e.warnings.length ? h('ul', { class: 'lq-job__warnings' }, e.warnings.map((w) => h('li', {}, [Dom.icon('triangle-exclamation'), h('span', { text: w })]))) : null,
        e.kind === 'run' && e.ref ? this._rerun(e) : null
      ]);
      return h('li', { class: 'lq-job', dataset: { status: e.status } }, h('details', { open: open || null }, [head, body]));
    }

    /** 「この作業セットで抽出し直す」（押せないときは理由を添える。1-4） */
    _rerun(e) {
      const reason = this.app.rerunBlocker(e);
      return h('div', { class: 'lq-job__actions' }, [
        h('button', { class: 'lq-btn lq-btn--sm', type: 'button', disabled: !!reason,
          title: '作業セット「' + e.workset + '」を開き、今読み込んでいる ① で抽出し直します（条件が当時から変わっていれば先に知らせます）',
          onclick: () => this.app.rerunJob(e) }, [Dom.icon('arrows-rotate'), 'この作業セットで抽出し直す']),
        reason ? h('span', { class: 'lq-field__hint', text: reason }) : null
      ]);
    }

    _clear() {
      const jobs = this.app.jobs;
      if (!jobs.items.length) return;
      const before = jobs.clear();
      this.state.lastJob = null;
      this.render();
      this.app.toasts.show({ type: 'info', title: '実行履歴を消しました（' + before.length + ' 件）',
        actions: [{ label: '元に戻す', icon: 'rotate-left', onClick: () => {
          jobs.restore(before);
          this.render();
        } }] });
    }
  }

  LQ.HistoryPanel = HistoryPanel;
})(window);
