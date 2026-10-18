/* =========================================================================
 * LightQuery - lq-jobs.js
 * 実行履歴（基本設計 1-22）：読み込み・抽出・出力などの結果を、あとから確かめられるように残す（画面には依存しない）
 *   ・ブラウザ全体で新しい順に 100 件まで（ブラウザに保存。行のデータは残さず、件数・条件の要約・出力先・警告だけ）
 *   ・各記録に作業セットの名前を書き、作業セットで絞り込める
 *   ・状態は「完了・完了（警告あり）・失敗・中止」の 4 つ（アイコン＋文字＋色で表す。色だけで伝えない）
 *   ・抽出の記録には作業セットと条件の署名（ref）を残し、「この作業セットで抽出し直す」に使う
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Prefs = LQ.Prefs;

  const KEY = 'jobs.history';
  const LIMIT = 100;
  const STATUS = Object.freeze({
    done: { label: '完了', icon: 'circle-check', kind: 'ok' },
    warn: { label: '完了（警告あり）', icon: 'triangle-exclamation', kind: 'warn' },
    failed: { label: '失敗', icon: 'circle-xmark', kind: 'error' },
    cancelled: { label: '中止', icon: 'circle-stop', kind: 'muted' }
  });
  const KIND = Object.freeze({
    read: { label: '読み込み', icon: 'file-import' },
    run: { label: '抽出', icon: 'play' },
    export: { label: '出力', icon: 'file-export' },
    copy: { label: 'コピー', icon: 'copy' },
    sample: { label: 'サンプル', icon: 'flask' }
  });

  /**
   * 1 件の記録：
   * { id, kind, title, status, startedAt, endedAt（どちらもエポックミリ秒）, result（1 行の結果）,
   *   details:[{label, text}]（入力・条件・出力先など）, warnings:[string], workset }
   */
  class JobLog {
    /** @param {Function} [onChange] 記録が変わったら呼ぶ */
    constructor(onChange) {
      this.onChange = onChange || function () {};
      const saved = Prefs.get(KEY, null);
      this.items = Array.isArray(saved) ? saved.filter(JobLog.valid).slice(0, LIMIT) : [];
      this._seq = 0;
    }

    static get LIMIT() {
      return LIMIT;
    }

    static get STATUS() {
      return STATUS;
    }

    static get KIND() {
      return KIND;
    }

    static valid(e) {
      return !!e && typeof e === 'object' && typeof e.id === 'string' && !!STATUS[e.status] && typeof e.endedAt === 'number';
    }

    static statusOf(entry) {
      return STATUS[entry.status] || STATUS.done;
    }

    static kindOf(entry) {
      return KIND[entry.kind] || { label: entry.kind, icon: 'gear' };
    }

    /** 記録を足す（先頭へ。上限を超えた古いものから消す） */
    add(entry) {
      const now = Date.now();
      const e = {
        id: 'job-' + now.toString(36) + '-' + (this._seq++).toString(36),
        kind: entry.kind || 'read',
        title: entry.title || '',
        status: STATUS[entry.status] ? entry.status : 'done',
        startedAt: typeof entry.startedAt === 'number' ? entry.startedAt : now,
        endedAt: now,
        result: entry.result || '',
        details: (entry.details || []).filter((d) => d && d.text).map((d) => ({ label: String(d.label || ''), text: String(d.text) })),
        warnings: (entry.warnings || []).filter(Boolean).map(String).slice(0, 20),
        workset: entry.workset || '',
        /* 抽出し直すための手がかり（作業セットと条件の署名。行のデータは持たない） */
        ref: entry.ref && typeof entry.ref.worksetId === 'string'
          ? { worksetId: entry.ref.worksetId, conditions: String(entry.ref.conditions || '') } : null
      };
      this.items.unshift(e);
      if (this.items.length > LIMIT) this.items.length = LIMIT;
      this._save();
      return e;
    }

    latest() {
      return this.items[0] || null;
    }

    /** 作業セットで絞った一覧（workset が空ならすべて） */
    list(workset) {
      return workset ? this.items.filter((e) => e.workset === workset) : this.items.slice();
    }

    worksets() {
      return Array.from(new Set(this.items.map((e) => e.workset).filter(Boolean)));
    }

    /** すべて消す。元に戻すための一覧を返す */
    clear() {
      const before = this.items;
      this.items = [];
      this._save();
      return before;
    }

    restore(items) {
      this.items = (items || []).filter(JobLog.valid).slice(0, LIMIT);
      this._save();
    }

    _save() {
      Prefs.set(KEY, this.items);
      this.onChange();
    }
  }

  /** 「14:32」「10/17 09:05」（今日なら時刻だけ） */
  function formatWhen(ms, withSeconds) {
    const d = new Date(ms);
    const today = new Date();
    const pad = LQ.Util.pad2;
    const time = pad(d.getHours()) + ':' + pad(d.getMinutes()) + (withSeconds ? ':' + pad(d.getSeconds()) : '');
    const same = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
    return same ? time : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + time;
  }

  /**
   * ファイルをまとめて読んだ結果（finish() に渡す形）：一部だけ読めなければ「警告あり」、1 つも読めなければ「失敗」
   * @param {string} roleLabel 例：「① 元データ」
   * @param {File[]} files @param {number} okCount 読めた数 @param {string[]} failed 読めなかった理由
   */
  function readOutcome(roleLabel, files, okCount, failed) {
    const names = files.map((f) => f.name).join('、');
    if (!okCount) return { status: 'failed', result: roleLabel + 'を読み込めませんでした', details: [{ label: 'ファイル', text: names }], warnings: failed };
    return { status: failed.length ? 'warn' : 'done', result: roleLabel + '：' + files.length + ' ファイル中 ' + (files.length - failed.length) + ' ファイルを読み込みました',
      details: [{ label: 'ファイル', text: names }], warnings: failed };
  }

  LQ.JobLog = JobLog;
  LQ.JobLog.readOutcome = readOutcome;
  LQ.JobLog.formatWhen = formatWhen;
})(window);
