/* =========================================================================
 * LightQuery - lq-period.js
 * 期間の解釈：「2024」「2024/05」「2024年5月」「2024年度」「2024/05/10」のような年・年月・日と、
 *   今日を基準にした「今日・昨日・今週・先週・今月・先月・今年・昨年・今年度・前年度・直近 N 日・今後 N 日」を
 *   [start, end)（UTC 基準のミリ秒。end は含まない）に読み替える。年度は 4 月始まり、週は月曜始まり。
 *   日付の比較値は ValueParser.parseDate と同じ「UTC の 0 時」を 1 日の始まりとする。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const DAY = 86400000;
  const FY_START_MONTH = 4;

  const RE_YEAR = /^(\d{4})年?$/;
  const RE_FISCAL = /^(\d{4})年度$/;
  const RE_MONTH = /^(\d{4})(?:[\/\-.]|年)(\d{1,2})月?$/;
  const RE_LAST_DAYS = /^(?:直近|過去)(\d{1,4})日(?:間)?$/;
  const RE_NEXT_DAYS = /^(?:今後|この先)(\d{1,4})日(?:間)?$/;

  /** 今日を基準にした言葉（画面の候補にも使う） */
  const WORDS = ['今日', '昨日', '明日', '今週', '先週', '来週', '今月', '先月', '来月', '今年', '昨年', '来年', '今年度', '前年度', '来年度', '直近7日', '直近30日', '今後7日'];

  function todayUtc(now) {
    const d = now || new Date();
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function range(start, end, label) {
    return { start: start, end: end, label: label };
  }

  function monthRange(y, m, label) {
    return range(Date.UTC(y, m - 1, 1), Date.UTC(y, m, 1), label);
  }

  function fiscalRange(fy, label) {
    return range(Date.UTC(fy, FY_START_MONTH - 1, 1), Date.UTC(fy + 1, FY_START_MONTH - 1, 1), label);
  }

  function fmt(ms) {
    return LQ.ValueParser.formatDate(ms);
  }

  /** 今日を基準にした言葉 → 期間（言葉でなければ null） */
  function relative(s, today) {
    const t = new Date(today);
    const y = t.getUTCFullYear();
    const m = t.getUTCMonth() + 1;
    const monday = today - ((t.getUTCDay() + 6) % 7) * DAY;
    const fy = m >= FY_START_MONTH ? y : y - 1;
    switch (s) {
      case '今日': case '本日': return range(today, today + DAY, '今日');
      case '昨日': return range(today - DAY, today, '昨日');
      case '明日': return range(today + DAY, today + 2 * DAY, '明日');
      case '今週': return range(monday, monday + 7 * DAY, '今週（月曜〜日曜）');
      case '先週': return range(monday - 7 * DAY, monday, '先週（月曜〜日曜）');
      case '来週': return range(monday + 7 * DAY, monday + 14 * DAY, '来週（月曜〜日曜）');
      case '今月': return monthRange(y, m, '今月');
      case '先月': return monthRange(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1, '先月');
      case '来月': return monthRange(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, '来月');
      case '今年': return range(Date.UTC(y, 0, 1), Date.UTC(y + 1, 0, 1), '今年');
      case '昨年': case '去年': return range(Date.UTC(y - 1, 0, 1), Date.UTC(y, 0, 1), '昨年');
      case '来年': return range(Date.UTC(y + 1, 0, 1), Date.UTC(y + 2, 0, 1), '来年');
      case '今年度': return fiscalRange(fy, '今年度（' + fy + '年度）');
      case '前年度': case '昨年度': return fiscalRange(fy - 1, '前年度（' + (fy - 1) + '年度）');
      case '来年度': return fiscalRange(fy + 1, '来年度（' + (fy + 1) + '年度）');
      default: break;
    }
    let r = RE_LAST_DAYS.exec(s);
    if (r && Number(r[1]) > 0) return range(today - (Number(r[1]) - 1) * DAY, today + DAY, '直近 ' + Number(r[1]) + ' 日（今日を含む）');
    r = RE_NEXT_DAYS.exec(s);
    if (r && Number(r[1]) > 0) return range(today, today + Number(r[1]) * DAY, '今後 ' + Number(r[1]) + ' 日（今日を含む）');
    return null;
  }

  const Period = {
    WORDS: WORDS,
    DAY: DAY,

    /**
     * 期間として読む（読めなければ null）。
     * @param {*} raw
     * @param {Date} [now] 今日の基準（省略時は現在）
     * @returns {{start:number, end:number, label:string}|null}
     */
    parse(raw, now) {
      if (raw === null || raw === undefined) return null;
      const s = String(raw).normalize('NFKC').replace(/\s+/g, '');
      if (!s) return null;
      const rel = relative(s, todayUtc(now));
      if (rel) return rel;
      let r = RE_FISCAL.exec(s);
      if (r) return fiscalRange(Number(r[1]), r[1] + '年度（4月〜翌3月）');
      r = RE_YEAR.exec(s);
      if (r) return range(Date.UTC(Number(r[1]), 0, 1), Date.UTC(Number(r[1]) + 1, 0, 1), r[1] + '年');
      r = RE_MONTH.exec(s);
      if (r) {
        const mo = Number(r[2]);
        if (mo < 1 || mo > 12) return null;
        return monthRange(Number(r[1]), mo, r[1] + '年' + mo + '月');
      }
      const d = LQ.ValueParser.parseDate(s);
      if (Number.isNaN(d)) return null;
      const day = Math.floor(d / DAY) * DAY;
      return range(day, day + DAY, fmt(day));
    },

    /** 期間の説明（根拠表示用）：「今月（2025/06/01〜2025/06/30）」 */
    describe(p) {
      if (!p) return '';
      const range = fmt(p.start) + '〜' + fmt(p.end - DAY);
      if (p.start + DAY === p.end) return p.label === fmt(p.start) ? p.label : p.label + '（' + fmt(p.start) + '）';
      return p.label + '（' + range + '）';
    },

    /** 今日の日付の文字（計算結果の再利用のキーに使う） */
    todayKey(now) {
      return String(todayUtc(now));
    }
  };

  LQ.Period = Period;
})(window);
