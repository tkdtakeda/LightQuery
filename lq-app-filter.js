/* =========================================================================
 * LightQuery - lq-app-filter.js
 * 操作：照合しないで「絞り込みだけ」（作業セットごとの切替）
 * ========================================================================= */

/* =========================================================================
 * ── 絞り込みだけの操作 ──
 *   照合するかどうかは作業セットの設定（state.combine.filterOnly）。絞り込みだけのときは、
 *   ① の前処理（縦に結合・縦持ち・列の追加・絞り込み・重複の削除）の後の行をそのまま抽出結果にする。
 *   ・結果は ① や絞り込みが変わるたびに、その場で作り直す（処理が軽いため「未反映」を作らない）
 *   ・切り替えは「元に戻す」付きの通知で受ける。抽出条件と ② は消さずに残す
 *   ・主要動作（出力する／絞り込みを見直す）と、判定の根拠の簡易表示の中身を作る
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Util = LQ.Util;
  const fmt = Util.formatInt;

  class FilterOnlyActions {
    constructor(app) {
      this.app = app;
      this.state = app.state;
      this.toasts = app.toasts;
      this._building = false;
      app.bus.on('change', () => this._sync());
    }

    get active() {
      return this.state.filterOnly;
    }

    /** 絞り込みだけで、① があり、結果がない（または ① が変わった）ときは作り直す */
    _sync() {
      const s = this.state;
      if (this._building || !s.filterOnly || !s.datasets.source || s.busy || !this.app.main) return;
      if (s.result && s.result.filterOnly && !s.isStale()) return;
      this.build();
    }

    /** 今の ① から結果を作る（並べ替えは引き継ぐ）。① がなければ何もしない */
    build() {
      const s = this.state;
      const src = s.datasets.source;
      if (!src) return;
      this._building = true;
      try {
        const sort = s.view.sort;
        s.setResult(LQ.BatchRunner.filterOnly(src, Util.clone(s.rules)));
        if (sort) s.setSort(sort);
        /* 前回との比較：同じ ① の絞り込み直しは「今の結果」を上書きし、① が替わったときだけ「直前の結果」に送る */
        this.app.compare.remember({ replaceKey: src.id });
      } finally {
        this._building = false;
      }
    }

    /**
     * 照合する／しないを切り替える（元に戻せる）
     * @param {boolean} on true：絞り込みだけ
     */
    set(on, quiet) {
      const s = this.state;
      if (!!on === s.filterOnly || this.app._blockedByBusy()) return;
      s.setCombine({ filterOnly: !!on });
      if (on && (s.view.tab === 'condition' || s.view.tab === 'source')) s.setTab('result');
      if (quiet) return;
      this.toasts.show({
        type: 'success',
        title: on ? '絞り込みだけに切り替えました' : '照合して抽出に戻しました',
        message: on
          ? '② 照合表と抽出条件は使わずに残しています。① の見出しで絞り込んだ行が、そのまま抽出結果になります。'
          : '残していた抽出条件と ② 照合表を使います。右上のボタンで抽出してください。',
        actions: [{ label: '元に戻す', icon: 'rotate-left', onClick: () => this.set(!on, true) }]
      });
    }

    /** ① の前処理を何か掛けているか（掛けていなければ全行） */
    _narrowed(src) {
      return LQ.PrepFlow.active(src);
    }

    /** 主要動作（① の読み込み後）。結果は _sync で常にあるが、作る前の一瞬は計算中とする */
    cta() {
      const s = this.state;
      const src = s.datasets.source;
      const res = s.result;
      if (!res || !res.filterOnly) return { id: 'busy', label: '準備中…', icon: 'spinner', spin: true, disabled: true, status: { kind: 'info', text: '絞り込みの結果を作っています' } };
      const view = this.app.main.resultView();
      if (!view.length) {
        return { id: 'reviewFilters', label: '① の絞り込みを見直す', icon: 'filter',
          status: { kind: 'warn', text: '絞り込み後が 0 行のため出力できません' } };
      }
      if (!this.app._hasOutputColumn()) {
        return { id: 'chooseColumns', label: '出力する列を選ぶ', icon: 'table-columns', status: { kind: 'warn', text: '出力できる列が 0 列のため出力できません（左の「出力列」で選びます）' } };
      }
      const scope = this._narrowed(src)
        ? '① ' + fmt(LQ.PrepFlow.steps(src)[0].rows) + ' 行 → ' + fmt(src.rowCount) + ' 行'
        : '全行（絞り込みなし）';
      /* ピボットタブでは、照合するときと同じくピボットの表を出力する（出力の処理もピボットを出す） */
      const agg = s.view.tab === 'aggregate' ? this.app.main.aggregate.computed() : null;
      if (agg) {
        return { id: 'export', label: 'ピボット（' + fmt(agg.groupCount) + ' 行）を出力する', icon: 'file-export',
          status: { kind: 'ok', text: '絞り込み後の ' + fmt(agg.rowCount) + ' 行のピボットを Excel・CSV・コピーで出力できます' } };
      }
      return { id: 'export', label: fmt(view.length) + ' 行を出力する', icon: 'file-export',
        status: { kind: 'ok', text: '絞り込みだけ（照合なし）：' + scope } };
    }

    /**
     * 判定の根拠（簡易）：この行が残った理由＝掛けている前処理（絞り込みはすべて満たした・重複の削除で残った）
     * @param {number} i 表示中の行の番号
     */
    explain(i) {
      const s = this.state;
      const view = this.app.main.resultView();
      const src = s.datasets.source;
      if (!view || !src) return null;
      const pair = view.pairAt(i);
      const items = [];
      (src.filters || []).forEach((f) => {
        const info = src.filterInfo && src.filterInfo.items ? src.filterInfo.items.find((x) => x.id === f.id) : null;
        const ok = !info || info.ok !== false;
        const col = src.findColumn(f.col);
        items.push({ kind: 'filter', ok: ok, col: f.col, text: LQ.RowFilter.describe(f, LQ.DateColumns ? LQ.DateColumns.isDate(src, f.col) : false),
          value: ok && col >= 0 ? String(src.cell(pair.src, col)) : '', note: ok ? '' : (info.message || '掛けられていません') });
      });
      if (src.dedupInfo) items.push({ kind: 'dedup', ok: true, text: '重複の削除：同じ値の行のうち最初の 1 行として残りました' });
      return {
        filterOnly: true,
        index: i,
        pair: pair,
        sourceRowNumber: src.rowNumber(pair.src),
        prep: LQ.PrepFlow.active(src) ? LQ.PrepFlow.text(src) : '',
        items: items,
        multi: false,
        unmatched: false,
        stale: false,
        cards: []
      };
    }
  }

  LQ.FilterOnlyActions = FilterOnlyActions;
})(window);
