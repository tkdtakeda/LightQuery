/* =========================================================================
 * LightQuery - lq-app-compare.js
 * 前回との比較の操作：抽出のたびに結果を覚える（直前の抽出結果。作業セットごとにブラウザにも保存し、次に開いたときも使える）／
 *   基準の表（直前の結果・ファイル）と行を見分ける列を決める／解除
 *   比べた結果は今の抽出結果から作り直す（再抽出・列の変更でも基準とキーはそのまま）。変わったら 'compare' を知らせる。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Util = LQ.Util;
  const Async = LQ.Async;
  const fmt = Util.formatInt;

  const TABLE_STEP = { id: 'table', label: '表の準備', weight: 1 };

  class CompareActions {
    constructor(app) {
      this.app = app;
      this.state = app.state;
      this.toasts = app.toasts;
      /** 抽出のたびに覚える結果：latest＝今の結果／previous＝その 1 つ前（「直前の抽出結果」） */
      this.latest = null;
      this.previous = null;
      /** 比べている基準と行を見分ける列（null なら比べていない） */
      this.base = null;
      this.key = null;
      /** 基準がサンプルのものか（「サンプルデータのみクリア」で一緒に外す） */
      this.fromSample = false;
      this._memo = null;
    }

    get active() {
      return !!this.base;
    }

    /**
     * 抽出が終わったときに呼ぶ：今の結果を覚え、それまでの結果を「直前の抽出結果」にする。
     * 今の結果は開いている作業セットに保存する（サンプル表示中は覚えない：自分の「直前」がサンプルにならないように）
     */
    remember() {
      if (this.state.hasSample()) return;
      const view = this.app.main.resultView();
      if (!view || view.result.allRows) return;
      const defs = view.resolveColumns(this.state.output.columns).filter((d) => d.available);
      if (!defs.length) return;
      const d = new Date();
      const when = (d.getMonth() + 1) + '/' + d.getDate() + ' ' + Util.pad2(d.getHours()) + ':' + Util.pad2(d.getMinutes());
      const table = LQ.CompareTable.fromView(view, defs, '抽出結果（' + when + '）');
      this.previous = this.latest;
      this.latest = table;
      if (this.app.worksets) this.app.worksets.saveResult(table);
      this._changed();
    }

    /** 作業セットを開いたとき：そのセットで最後に抽出した結果を、次の抽出の「直前の抽出結果」にする */
    useSaved(table) {
      this.latest = table && Array.isArray(table.rows) ? table : null;
      this.previous = null;
      this._changed();
    }

    /** 「直前の抽出結果」を表で見る（コピー・Excel 出力もできる） */
    showPrevious(anchor) {
      const t = this.previous;
      if (!t) return;
      const table = LQ.ReviewParts.drillTable(t.header, t.rows.length, (i) => t.rows[i]);
      const back = anchor && anchor.isConnected ? () => anchor.focus() : null;
      this.app.main.drillView().open({ by: [], table: table, title: '直前の抽出結果', fileTag: '直前の抽出結果' }, null,
        t.name + '・' + fmt(t.rows.length) + ' 行 × ' + t.header.length + ' 列。前回と比べるときの基準にできます。', back,
        { label: '直前の抽出結果', text: t.name });
    }

    /** 今の抽出結果の表（すべての行・今の出力列） */
    currentTable() {
      const view = this.app.main.resultView();
      if (!view || view.result.allRows) return null;
      const defs = view.resolveColumns(this.state.output.columns).filter((d) => d.available);
      return defs.length ? LQ.CompareTable.fromView(view, defs, '今の抽出結果') : null;
    }

    /**
     * 基準とキーを決めて比べる（元に戻せる）
     * @param {object} base 基準の表
     * @param {string|null} key
     */
    start(base, key) {
      const before = { base: this.base, key: this.key };
      this.base = base;
      this.key = key || null;
      this.fromSample = false;
      this._changed();
      const res = this.result();
      this.toasts.show(res && res.ok
        ? { type: 'success', title: '前回の結果と比べました', message: '基準：' + base.name + '（' + fmt(base.rows.length) + ' 行）。' + LQ.Compare.summary(res) + '。',
          actions: before.base ? [{ label: '元に戻す', icon: 'rotate-left', onClick: () => this._restore(before) }] : [] }
        : { type: 'warn', title: '比べられませんでした', message: res ? res.message : '抽出結果がありません。' });
    }

    /**
     * サンプルの基準を使う（サンプルの「先月の抽出結果」など。基準はファイルと同じ扱い）
     * @param {{name:string, grid:string[][], key:string}} spec grid の 1 行目は見出し
     */
    useSample(spec) {
      this.base = { name: spec.name, kind: 'file', header: spec.grid[0].slice(), rows: spec.grid.slice(1), at: new Date() };
      this.key = spec.key || null;
      this.fromSample = true;
      this._changed();
    }

    /** サンプルの基準を使っていれば外す（サンプルを切り替えた・消したとき） */
    leaveSample() {
      if (!this.fromSample) return;
      this.base = null;
      this.key = null;
      this.fromSample = false;
      this._changed();
    }

    /** 比べるのをやめる（元に戻せる） */
    stop() {
      if (!this.base) return;
      const before = { base: this.base, key: this.key };
      this.base = null;
      this.key = null;
      this.fromSample = false;
      this._changed();
      this.toasts.show({ type: 'success', title: '前回との比較を外しました', message: '',
        actions: [{ label: '元に戻す', icon: 'rotate-left', onClick: () => this._restore(before) }] });
    }

    /** 今の抽出結果と基準を比べた結果（同じ結果・列・基準なら作り直さない）。比べていない・結果がないときは null */
    result() {
      if (!this.base) return null;
      const view = this.app.main.resultView();
      if (!view || view.result.allRows) return null;
      const sig = view.result.id + '|' + JSON.stringify(this.state.output.columns) + '|' + this.key;
      if (this._memo && this._memo.sig === sig && this._memo.base === this.base) return this._memo.res;
      const cur = this.currentTable();
      const res = cur ? LQ.Compare.run(this.base, cur, this.key) : { ok: false, message: '表示する列がありません' };
      res.cur = cur;
      this._memo = { sig: sig, base: this.base, res: res };
      return res;
    }

    /**
     * 基準にするファイルを読み込む（Excel は最初のシート。LightQuery の出力ならデータのシート）
     * @param {File} file
     * @returns {Promise<object|null>} 基準の表
     */
    async loadFile(file) {
      const app = this.app;
      if (app._blockedByBusy()) return null;
      const progress = app.startProgress({ kind: 'read', label: '読み込み中…', title: '比べるファイルを読み込んでいます',
        detail: file.name + '（' + Util.formatBytes(file.size) + '）', steps: LQ.SourceFile.loadSteps(file.name).concat([TABLE_STEP]) });
      await Async.paint();
      try {
        const source = await LQ.SourceFile.fromFile(file, progress);
        progress.begin(TABLE_STEP.id, false);
        await Async.paint();
        const table = LQ.CompareTable.fromDataset(new LQ.Dataset('compare', source));
        if (!table.rows.length) throw new Error('データ行がありません');
        return table;
      } catch (err) {
        this.toasts.show({ type: 'error', title: '比べるファイルを読み込めませんでした', message: file.name + '：' + app._friendlyError(err) });
        return null;
      } finally {
        progress.close();
      }
    }

    /** 出力の記録に書く行（比べていなければ null） */
    metaLine() {
      const res = this.result();
      if (!res || !res.ok) return null;
      return ['前回との違い', LQ.Compare.summary(res) + '（基準：' + this.base.name + '・行を見分ける列：' + (this.key || 'なし（行全体）') + '）'];
    }

    _restore(before) {
      this.base = before.base;
      this.key = before.key;
      this._changed();
    }

    _changed() {
      this._memo = null;
      this.app.bus.emit('change', { topic: 'compare' });
    }
  }

  LQ.CompareActions = CompareActions;
})(window);
