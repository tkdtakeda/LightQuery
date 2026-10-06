/* =========================================================================
 * LightQuery - lq-app-prep.js
 * 前処理の操作：① のファイルを縦に結合する（まとめて読み込む・追加する・外す）／重複の削除の設定
 *   読み込みの進み具合・通知・取り消しは、ほかの読み込みと同じ形で出す。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Util = LQ.Util;
  const Async = LQ.Async;
  const fmt = Util.formatInt;

  const ROLE_LABEL = { source: '① 元データ', condition: '② 照合表' };
  const MAX_FILES = LQ.SourceUnion.MAX_FILES;
  const TABLE_STEP = { id: 'table', label: '表の準備', weight: 1 };

  class PrepActions {
    constructor(app) {
      this.app = app;
      this.state = app.state;
      this.toasts = app.toasts;
    }

    /**
     * ① のファイルを読み込む。複数なら 1 つ目に 2 つ目以降を縦に結合する。
     * @param {File[]} files
     * @param {'replace'|'append'} mode replace：① を置き換える／append：読み込み済みの ① の下に足す
     */
    async loadSourceFiles(files, mode) {
      const app = this.app;
      const list = Array.from(files || []).filter((f) => Util.extName(f.name) !== 'json');
      const cur = this.state.datasets.source;
      const append = mode === 'append' && !!cur;
      if (!list.length || app._blockedByBusy()) return;
      if (!append && list.length === 1) {
        app.loadFile('source', list[0]);
        return;
      }
      const room = MAX_FILES - (append ? cur.fileCount : 0);
      if (room <= 0) {
        this.toasts.show({ type: 'warn', title: '縦に結合できるのは ' + MAX_FILES + ' ファイルまでです', message: '不要なファイルを外してから追加してください。' });
        return;
      }
      const picked = list.slice(0, room);
      const sources = await this._readAll(picked, append ? cur.source : null);
      if (list.length > picked.length) {
        this.toasts.show({ type: 'warn', title: '縦に結合できるのは ' + MAX_FILES + ' ファイルまでです', message: (list.length - picked.length) + ' ファイルは読み込んでいません。' });
      }
      if (!sources.length) return;
      if (append) {
        this._setMembers(cur, cur.members.concat(sources), sources.length + ' ファイルを ① に縦に結合しました');
        return;
      }
      const primary = sources[0];
      sources.slice(1).forEach((src) => this._matchSheet(src, primary));
      app._putDataset('source', new LQ.Dataset('source', primary, { members: sources.slice(1) }));
    }

    /** ① の 2 つ目以降のファイルを外す（index：members の位置。元に戻せる） */
    removeMember(index) {
      const cur = this.state.datasets.source;
      if (!cur || !cur.members[index] || this.app._blockedByBusy()) return;
      const name = cur.members[index].name;
      this._setMembers(cur, cur.members.filter((_, i) => i !== index), '「' + name + '」を ① から外しました');
    }

    /** ① の 1 つ目のファイルを外し、2 つ目を 1 つ目にする（読み込み範囲は今の設定を引き継ぐ。元に戻せる） */
    removePrimary() {
      const cur = this.state.datasets.source;
      if (!cur || !cur.members.length || this.app._blockedByBusy()) return;
      const s = this.state;
      const snap = s.snapshot();
      const next = new LQ.Dataset('source', cur.members[0], {
        settings: Util.clone(cur.settings), members: cur.members.slice(1), filters: cur.filters, dedup: cur.dedup, unpivot: cur.unpivot
      });
      s.setDataset('source', next);
      this._announce(snap, '「' + cur.name + '」を ① から外しました', next);
    }

    /**
     * 縦持ちを設定する（null で外す。元に戻せる）
     * @param {'source'|'condition'} role
     * @param {{cols:string[], name:string, value:string, keepBlank:boolean}|null} def
     * @param {boolean} [quiet] 列を 1 つずつ選んでいるときは通知を出さない（表の見出しと処理の流れで分かる）
     */
    setUnpivot(role, def, quiet) {
      const s = this.state;
      const ds = s.datasets[role];
      if (!ds || this.app._blockedByBusy()) return;
      const before = ds.unpivot ? Util.clone(ds.unpivot) : null;
      s.setUnpivot(role, def);
      if (quiet) return;
      const info = s.datasets[role].unpivotInfo;
      const undo = [{ label: '元に戻す', icon: 'rotate-left', onClick: () => s.setUnpivot(role, before) }];
      this.toasts.show(def
        ? { type: info && info.ok ? 'success' : 'warn', title: '縦持ちにしました',
          message: info && info.ok ? LQ.Unpivot.describe(def) + 'しました。' + fmt(info.base) + ' 行 → ' + fmt(info.kept) + ' 行です。' : (info ? info.message : ''),
          actions: undo }
        : { type: 'success', title: '縦持ちを外しました', message: '元の列の並びに戻しました。', actions: before ? undo : [] });
    }

    /**
     * 重複の削除を設定する（null で外す。元に戻せる）
     * @param {'source'|'condition'} role
     * @param {{cols:string[]}|null} def
     */
    setDedup(role, def) {
      const s = this.state;
      const ds = s.datasets[role];
      if (!ds || this.app._blockedByBusy()) return;
      const before = ds.dedup ? Util.clone(ds.dedup) : null;
      s.setDedup(role, def);
      const info = ds.dedupInfo;
      this.toasts.show(def
        ? { type: 'success', title: '重複の削除を掛けました', message: LQ.Dedup.describe(def) + 'は最初の行だけを残します。' +
            fmt(info.removed.length) + ' 行を除き、' + fmt(ds.rowCount) + ' 行を使います。',
          actions: [{ label: '元に戻す', icon: 'rotate-left', onClick: () => s.setDedup(role, before) }] }
        : { type: 'success', title: '重複の削除を外しました', message: 'すべての行（' + fmt(ds.rowCount) + ' 行）を使います。',
          actions: before ? [{ label: '元に戻す', icon: 'rotate-left', onClick: () => s.setDedup(role, before) }] : [] });
    }

    /* ---------------- 内部 ---------------- */

    /** ファイルを順に読み込む（進み具合はファイルごと。読めなかったファイルは知らせて飛ばす） */
    async _readAll(files, primary) {
      const app = this.app;
      const progress = app.startProgress({ kind: 'read', label: '読み込み中…', title: ROLE_LABEL.source + 'を読み込んでいます' });
      const out = [];
      const failed = [];
      try {
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          try {
            if (files.length > 1) progress.item(i, files.length, f.name);
            progress.plan(LQ.SourceFile.loadSteps(f.name).concat([TABLE_STEP]));
            progress.setDetail(f.name + '（' + Util.formatBytes(f.size) + '）');
            await Async.paint();
            const src = await LQ.SourceFile.fromFile(f, progress);
            progress.begin(TABLE_STEP.id, false);
            if (primary) this._matchSheet(src, primary);
            out.push(src);
          } catch (err) {
            failed.push(f.name + '：' + app._friendlyError(err));
          }
        }
      } finally {
        progress.close();
      }
      failed.forEach((msg) => this.toasts.show({ type: 'error', title: ROLE_LABEL.source + 'を読み込めませんでした', message: msg }));
      return out;
    }

    /** Excel のブックは、1 つ目のファイルと同じ名前のシートがあればそのシートを読む */
    _matchSheet(src, primary) {
      if (!src.hasSheets || !primary.hasSheets) return;
      if (src.sheetNames.indexOf(primary.sheetName) !== -1 && src.sheetName !== primary.sheetName) src.setSheet(primary.sheetName);
    }

    _setMembers(cur, members, title) {
      const s = this.state;
      const snap = s.snapshot();
      const next = cur.withMembers(members);
      s.setDataset('source', next);
      this._announce(snap, title, next);
    }

    /** 結合の結果を知らせる（列名が合わないファイルがあれば注意として出す） */
    _announce(snap, title, ds) {
      const files = ds.union ? ds.union.files : [];
      const odd = files.filter((f) => LQ.SourceUnion.needsAttention(f));
      const lines = [ds.fileCount + ' ファイル・' + fmt(ds.baseRowCount) + ' 行 × ' + ds.colCount + ' 列（「' + (ds.union ? ds.union.fileColumn : LQ.SourceUnion.FILE_COLUMN) + '」列でどのファイルの行か分かります）'];
      if (ds.fileCount === 1) lines[0] = fmt(ds.baseRowCount) + ' 行 × ' + ds.colCount + ' 列';
      odd.forEach((f) => lines.push('「' + f.label + '」：' + LQ.SourceUnion.describeFile(f)));
      this.toasts.show({
        type: odd.length ? 'warn' : 'success',
        title: title,
        message: lines.join('。') + '。',
        actions: [{ label: '元に戻す', icon: 'rotate-left', onClick: () => this.app.restore(snap, '元に戻しました') }]
      });
      this.app.bus.emit('dataset-loaded', { role: 'source' });
    }
  }

  LQ.PrepActions = PrepActions;
})(window);
