/* =========================================================================
 * LightQuery - lq-formula-funcs.js
 * 計算の式で使える関数（Excel と同じ名前・同じ引数の順）。分類ごとに Formula.Funcs.register() で登録する。
 *   新しい関数は、このファイルに register() を 1 つ足すだけで、式・関数の一覧・書き方の表示に出る。
 *   値の読み方（数・文字・真偽・日付）は Formula.V にそろえる。計算できないときは V.fault() を投げる（その行は空欄）。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const F = LQ.Formula;
  const V = F.V;
  const reg = (def) => F.Funcs.register(def);
  const DAY = V.DAY_MS;

  /* ---------------------------------------------------------------------
   * 条件
   * ------------------------------------------------------------------- */
  reg({ name: 'IF', cat: 'cond', args: [2, 3], lazy: true, syntax: 'IF(条件, 真のとき, [偽のとき])',
    desc: '条件が TRUE なら 2 つ目、FALSE なら 3 つ目（省略すると FALSE）を返します。', example: 'IF([金額]>=10000, "大口", "通常")',
    fn: (a) => (V.bool(a[0]()) ? a[1]() : (a[2] ? a[2]() : false)) });
  reg({ name: 'IFS', cat: 'cond', args: [2, 254], lazy: true, syntax: 'IFS(条件1, 値1, [条件2, 値2], …)',
    desc: '最初に TRUE になった条件の値を返します。どれも満たさないときは計算できない値（空欄）です。', example: 'IFS([点数]>=80, "A", [点数]>=60, "B", TRUE, "C")',
    fn: (a) => {
      if (a.length % 2) throw V.fault('IFS は条件と値を組で書きます');
      for (let i = 0; i < a.length; i += 2) if (V.bool(a[i]())) return a[i + 1]();
      throw V.fault('どの条件も満たしません');
    } });
  reg({ name: 'IFERROR', cat: 'cond', args: [2, 2], lazy: true, syntax: 'IFERROR(値, 計算できないときの値)',
    desc: '計算できない（数として読めない・0 で割る・日付でない など）ときに、代わりの値を返します。', example: 'IFERROR([金額]÷[数量], 0)',
    fn: (a) => {
      try {
        return a[0]();
      } catch (err) {
        if (F.faultCode(err)) return a[1]();
        throw err;
      }
    } });
  reg({ name: 'SWITCH', cat: 'cond', args: [3, 254], lazy: true, syntax: 'SWITCH(値, 候補1, 結果1, [候補2, 結果2], …, [既定の結果])',
    desc: '値と同じ候補の結果を返します。どれとも違うときは既定の結果（省略すると計算できない値）です。', example: 'SWITCH([地域], "東京", "関東", "大阪", "関西", "その他")',
    fn: (a) => {
      const v = a[0]();
      const rest = a.length - 1;
      for (let i = 1; i + 1 < a.length; i += 2) if (V.compare(v, a[i]()) === 0) return a[i + 1]();
      if (rest % 2) return a[a.length - 1]();
      throw V.fault('どの候補とも一致しません');
    } });
  reg({ name: 'AND', cat: 'cond', args: [1, 255], lazy: true, syntax: 'AND(条件1, [条件2], …)',
    desc: 'すべての条件が TRUE のとき TRUE です。', example: 'AND([金額]>=10000, [地域]="東京")',
    fn: (a) => a.every((x) => V.bool(x())) });
  reg({ name: 'OR', cat: 'cond', args: [1, 255], lazy: true, syntax: 'OR(条件1, [条件2], …)',
    desc: 'どれか 1 つの条件が TRUE なら TRUE です。', example: 'OR([地域]="東京", [地域]="大阪")',
    fn: (a) => a.some((x) => V.bool(x())) });
  reg({ name: 'NOT', cat: 'cond', args: [1, 1], syntax: 'NOT(条件)',
    desc: 'TRUE と FALSE を入れ替えます。', example: 'NOT(ISBLANK([備考]))',
    fn: (x) => !V.bool(x) });
  reg({ name: 'ISBLANK', cat: 'cond', args: [1, 1], syntax: 'ISBLANK(値)',
    desc: '空欄（空白だけを含む）なら TRUE です。', example: 'IF(ISBLANK([担当者]), "未割当", [担当者])',
    fn: (x) => V.isBlank(x) });
  reg({ name: 'ISNUMBER', cat: 'cond', args: [1, 1], syntax: 'ISNUMBER(値)',
    desc: '数として読める（カンマ・円・% も可）なら TRUE です。SEARCH と組み合わせると「含む」の判定にもなります。', example: 'ISNUMBER(SEARCH("USB", [商品名]))',
    fn: (x) => {
      if (typeof x === 'number') return true;
      if (typeof x !== 'string' || V.isBlank(x)) return false;
      return !Number.isNaN(LQ.ValueParser.parseNumber(x));
    } });

  /* ---------------------------------------------------------------------
   * 文字
   * ------------------------------------------------------------------- */
  /* 文字数は見た目の 1 文字ずつ数える（絵文字・サロゲートペアを 2 文字と数えない） */
  const chars = (s) => Array.from(V.text(s));
  const count = (v, name) => {
    const n = V.int(v);
    if (n < 0) throw V.fault(name + ' の文字数は 0 以上にします');
    return n;
  };

  reg({ name: 'LEFT', cat: 'text', args: [1, 2], syntax: 'LEFT(文字, [文字数])',
    desc: '先頭から指定した文字数を取り出します（省略すると 1 文字）。', example: 'LEFT([商品コード], 1)',
    fn: (s, n) => chars(s).slice(0, n === undefined ? 1 : count(n, 'LEFT')).join('') });
  reg({ name: 'RIGHT', cat: 'text', args: [1, 2], syntax: 'RIGHT(文字, [文字数])',
    desc: '末尾から指定した文字数を取り出します（省略すると 1 文字）。', example: 'RIGHT([電話番号], 4)',
    fn: (s, n) => {
      const c = chars(s);
      const k = n === undefined ? 1 : count(n, 'RIGHT');
      return k === 0 ? '' : c.slice(Math.max(0, c.length - k)).join('');
    } });
  reg({ name: 'MID', cat: 'text', args: [3, 3], syntax: 'MID(文字, 開始位置, 文字数)',
    desc: '開始位置（1 文字目が 1）から指定した文字数を取り出します。', example: 'MID([受注番号], 4, 6)',
    fn: (s, start, n) => {
      const st = V.int(start);
      if (st < 1) throw V.fault('MID の開始位置は 1 以上にします');
      return chars(s).slice(st - 1, st - 1 + count(n, 'MID')).join('');
    } });
  reg({ name: 'LEN', cat: 'text', args: [1, 1], syntax: 'LEN(文字)',
    desc: '文字数を返します（全角も半角も 1 文字）。', example: 'LEN([顧客ID])',
    fn: (s) => chars(s).length });
  reg({ name: 'TRIM', cat: 'text', args: [1, 1], syntax: 'TRIM(文字)',
    desc: '前後の空白を除き、間の連続した空白を 1 つにします（全角の空白も対象）。', example: 'TRIM([顧客名])',
    fn: (s) => V.text(s).replace(/[\s　]+/g, ' ').trim() });
  reg({ name: 'UPPER', cat: 'text', args: [1, 1], syntax: 'UPPER(文字)',
    desc: '英字を大文字にします。', example: 'UPPER([商品コード])',
    fn: (s) => V.text(s).toUpperCase() });
  reg({ name: 'LOWER', cat: 'text', args: [1, 1], syntax: 'LOWER(文字)',
    desc: '英字を小文字にします。', example: 'LOWER([メール])',
    fn: (s) => V.text(s).toLowerCase() });
  reg({ name: 'ASC', cat: 'text', args: [1, 1], syntax: 'ASC(文字)',
    desc: '全角の英数字・記号・カタカナを半角にします。', example: 'ASC([顧客ID])',
    fn: (s) => toHalf(V.text(s)) });
  reg({ name: 'JIS', cat: 'text', args: [1, 1], syntax: 'JIS(文字)',
    desc: '半角の英数字・記号・カタカナを全角にします。', example: 'JIS([カナ])',
    fn: (s) => toFull(V.text(s)) });
  reg({ name: 'SUBSTITUTE', cat: 'text', args: [3, 4], syntax: 'SUBSTITUTE(文字, 検索文字, 置換文字, [何番目])',
    desc: '検索文字を置換文字に置き換えます（何番目を省略するとすべて）。大文字小文字は区別します。', example: 'SUBSTITUTE([電話番号], "-", "")',
    fn: (s, from, to, nth) => {
      const t = V.text(s);
      const f = V.text(from);
      const r = V.text(to);
      if (!f) return t;
      if (nth === undefined) return t.split(f).join(r);
      const k = V.int(nth);
      if (k < 1) throw V.fault('SUBSTITUTE の何番目は 1 以上にします');
      let at = -1;
      for (let i = 0; i < k; i++) {
        at = t.indexOf(f, at + 1);
        if (at < 0) return t;
      }
      return t.slice(0, at) + r + t.slice(at + f.length);
    } });
  reg({ name: 'REPLACE', cat: 'text', args: [4, 4], syntax: 'REPLACE(文字, 開始位置, 文字数, 置換文字)',
    desc: '開始位置から指定した文字数を、置換文字に置き換えます。', example: 'REPLACE([電話番号], 1, 3, "***")',
    fn: (s, start, n, to) => {
      const c = chars(s);
      const st = V.int(start);
      if (st < 1) throw V.fault('REPLACE の開始位置は 1 以上にします');
      return c.slice(0, st - 1).join('') + V.text(to) + c.slice(st - 1 + count(n, 'REPLACE')).join('');
    } });
  reg({ name: 'FIND', cat: 'text', args: [2, 3], syntax: 'FIND(検索文字, 文字, [開始位置])',
    desc: '検索文字が何文字目にあるかを返します（大文字小文字を区別）。見つからないときは計算できない値です。', example: 'FIND("-", [商品コード])',
    fn: (find, s, start) => position(find, s, start, false) });
  reg({ name: 'SEARCH', cat: 'text', args: [2, 3], syntax: 'SEARCH(検索文字, 文字, [開始位置])',
    desc: 'FIND と同じですが、大文字小文字を区別せず、「*」（任意の文字列）・「?」（任意の 1 文字）も使えます。', example: 'SEARCH("usb", [商品名])',
    fn: (find, s, start) => position(find, s, start, true) });
  reg({ name: 'TEXTBEFORE', cat: 'text', args: [2, 3], syntax: 'TEXTBEFORE(文字, 区切り, [何番目])',
    desc: '区切りより前の部分を返します（何番目に負の数を指定すると後ろから数えます）。区切りがないときは計算できない値です。', example: 'TEXTBEFORE([住所], "都")',
    fn: (s, d, nth) => splitAt(s, d, nth, true) });
  reg({ name: 'TEXTAFTER', cat: 'text', args: [2, 3], syntax: 'TEXTAFTER(文字, 区切り, [何番目])',
    desc: '区切りより後ろの部分を返します（何番目に負の数を指定すると後ろから数えます）。', example: 'TEXTAFTER([メール], "@")',
    fn: (s, d, nth) => splitAt(s, d, nth, false) });
  reg({ name: 'CONCAT', cat: 'text', args: [1, 255], syntax: 'CONCAT(文字1, [文字2], …)',
    desc: '文字をつなぎます（& と同じ）。', example: 'CONCAT([姓], " ", [名])',
    fn: (...a) => a.map((x) => V.text(x)).join('') });
  reg({ name: 'TEXTJOIN', cat: 'text', args: [3, 255], syntax: 'TEXTJOIN(区切り, 空欄を無視, 文字1, …)',
    desc: '区切りを入れて文字をつなぎます。空欄を無視を TRUE にすると、空欄は区切りごと飛ばします。', example: 'TEXTJOIN("・", TRUE, [地域], [担当者], [備考])',
    fn: (d, skip, ...a) => {
      const ignore = V.bool(skip);
      return a.map((x) => V.text(x)).filter((x) => !ignore || x !== '').join(V.text(d));
    } });
  reg({ name: 'REPT', cat: 'text', args: [2, 2], syntax: 'REPT(文字, 回数)',
    desc: '文字を指定した回数くり返します。', example: 'REPT("★", [評価])',
    fn: (s, n) => {
      const k = count(n, 'REPT');
      if (k > 1000) throw V.fault('REPT の回数は 1,000 までです');
      return V.text(s).repeat(k);
    } });
  reg({ name: 'VALUE', cat: 'text', args: [1, 1], syntax: 'VALUE(文字)',
    desc: '文字を数にします（カンマ・円・%・全角の数字も読めます）。', example: 'VALUE([金額（文字）])',
    fn: (s) => (V.isBlank(s) ? 0 : V.num(s)) });
  reg({ name: 'TEXT', cat: 'text', args: [2, 2], syntax: 'TEXT(値, 表示形式)',
    desc: '数や日付を表示形式の文字にします。数：#,##0・0.0・0%・000（ゼロ埋め）、日付：yyyy/mm/dd・yyyy年m月・aaa（曜日）・ggge年（和暦）など。', example: 'TEXT([受注日], "yyyy年m月")',
    fn: (v, fmt) => formatText(v, V.text(fmt)) });

  /* ---------------------------------------------------------------------
   * 数値
   * ------------------------------------------------------------------- */
  /** Excel と同じく、0 から遠ざかる向きに丸める（ROUND）。小数の誤差を抑えるため桁を指数で動かす */
  function roundTo(x, n, fn) {
    const digits = Math.trunc(n || 0);
    const sign = x < 0 ? -1 : 1;
    const shifted = Number(Math.abs(x) + 'e' + digits);
    const v = fn(Number(shifted.toPrecision(15)));
    return sign * Number(v + 'e' + (-digits));
  }
  /** 基準値の倍数に丸める（CEILING・FLOOR。Excel の CEILING.MATH・FLOOR.MATH と同じく負の数も同じ向き） */
  function toMultiple(x, sig, up) {
    const s = sig === undefined ? 1 : Math.abs(V.num(sig));
    if (s === 0) return 0;
    const q = Number((V.num(x) / s).toPrecision(15));
    return (up ? Math.ceil(q) : Math.floor(q)) * s;
  }
  const nums = (a) => a.filter((x) => !V.isBlank(x)).map((x) => V.num(x));

  reg({ name: 'ROUND', cat: 'num', args: [1, 2], syntax: 'ROUND(数, [桁数])',
    desc: '四捨五入します。桁数 0 で整数、1 で小数第 1 位まで、-1 で十の位まで（省略すると 0）。', example: 'ROUND([金額]×1.1, 0)',
    fn: (x, n) => roundTo(V.num(x), n === undefined ? 0 : V.num(n), (v) => Math.round(v)) });
  reg({ name: 'ROUNDUP', cat: 'num', args: [1, 2], syntax: 'ROUNDUP(数, [桁数])',
    desc: '切り上げます（0 から遠ざかる向き）。', example: 'ROUNDUP([重さ], 0)',
    fn: (x, n) => roundTo(V.num(x), n === undefined ? 0 : V.num(n), (v) => Math.ceil(v)) });
  reg({ name: 'ROUNDDOWN', cat: 'num', args: [1, 2], syntax: 'ROUNDDOWN(数, [桁数])',
    desc: '切り捨てます（0 に近づく向き）。', example: 'ROUNDDOWN([金額]×0.08, 0)',
    fn: (x, n) => roundTo(V.num(x), n === undefined ? 0 : V.num(n), (v) => Math.floor(v)) });
  reg({ name: 'INT', cat: 'num', args: [1, 1], syntax: 'INT(数)',
    desc: '小数を切り捨てて整数にします（負の数は小さい方へ：-1.5 → -2）。', example: 'INT([時間]÷60)',
    fn: (x) => Math.floor(V.num(x)) });
  reg({ name: 'ABS', cat: 'num', args: [1, 1], syntax: 'ABS(数)',
    desc: '絶対値（符号を外した値）を返します。', example: 'ABS([差額])',
    fn: (x) => Math.abs(V.num(x)) });
  reg({ name: 'MOD', cat: 'num', args: [2, 2], syntax: 'MOD(数, 割る数)',
    desc: '割り算の余りを返します（符号は割る数と同じ。Excel と同じ）。', example: 'MOD([番号], 2)',
    fn: (x, d) => {
      const n = V.num(x);
      const m = V.num(d);
      if (m === 0) throw F.DIV_ZERO;
      return Number((n - m * Math.floor(n / m)).toPrecision(15));
    } });
  reg({ name: 'CEILING', cat: 'num', args: [1, 2], syntax: 'CEILING(数, [基準値])',
    desc: '基準値の倍数に切り上げます（省略すると 1）。', example: 'CEILING([金額], 100)',
    fn: (x, s) => toMultiple(x, s, true) });
  reg({ name: 'FLOOR', cat: 'num', args: [1, 2], syntax: 'FLOOR(数, [基準値])',
    desc: '基準値の倍数に切り捨てます（省略すると 1）。', example: 'FLOOR([年齢], 10)',
    fn: (x, s) => toMultiple(x, s, false) });
  reg({ name: 'MIN', cat: 'num', args: [1, 255], syntax: 'MIN(数1, [数2], …)',
    desc: '最も小さい値を返します（空欄は除く）。', example: 'MIN([見積], [上限])',
    fn: (...a) => {
      const list = nums(a);
      return list.length ? Math.min.apply(null, list) : 0;
    } });
  reg({ name: 'MAX', cat: 'num', args: [1, 255], syntax: 'MAX(数1, [数2], …)',
    desc: '最も大きい値を返します（空欄は除く）。', example: 'MAX([金額]-[値引], 0)',
    fn: (...a) => {
      const list = nums(a);
      return list.length ? Math.max.apply(null, list) : 0;
    } });
  reg({ name: 'SUM', cat: 'num', args: [1, 255], syntax: 'SUM(数1, [数2], …)',
    desc: '合計します（同じ行の列どうし。空欄は 0）。', example: 'SUM([4月], [5月], [6月])',
    fn: (...a) => Number(nums(a).reduce((s, x) => s + x, 0).toPrecision(15)) });
  reg({ name: 'AVERAGE', cat: 'num', args: [1, 255], syntax: 'AVERAGE(数1, [数2], …)',
    desc: '平均します（同じ行の列どうし。空欄は数えない）。', example: 'AVERAGE([国語], [数学], [英語])',
    fn: (...a) => {
      const list = nums(a);
      if (!list.length) throw F.DIV_ZERO;
      return list.reduce((s, x) => s + x, 0) / list.length;
    } });
  reg({ name: 'SQRT', cat: 'num', args: [1, 1], syntax: 'SQRT(数)',
    desc: '平方根を返します。', example: 'SQRT([面積])',
    fn: (x) => {
      const n = V.num(x);
      if (n < 0) throw V.fault('負の数の平方根は計算できません');
      return Math.sqrt(n);
    } });
  reg({ name: 'POWER', cat: 'num', args: [2, 2], syntax: 'POWER(数, 指数)',
    desc: 'べき乗を返します（^ と同じ）。', example: 'POWER(1.02, [年数])',
    fn: (x, e) => {
      const v = Math.pow(V.num(x), V.num(e));
      if (!isFinite(v)) throw V.fault('べき乗を計算できません');
      return v;
    } });

  /* ---------------------------------------------------------------------
   * 日付（日付はタイムゾーンの影響を受けないよう UTC で扱う）
   * ------------------------------------------------------------------- */
  const parts = (v) => {
    const d = new Date(V.dateMs(v));
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), w: d.getUTCDay() };
  };
  const dayStart = (ms) => Math.floor(ms / DAY) * DAY;
  /** 月を足した日付（月末を超えるときはその月の末日。Excel の EDATE と同じ） */
  function addMonths(ms, n) {
    const d = new Date(ms);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + n;
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return Date.UTC(y, m, Math.min(d.getUTCDate(), last));
  }

  reg({ name: 'TODAY', cat: 'date', args: [0, 0], syntax: 'TODAY()',
    desc: '今日の日付を返します（開いた日によって変わります）。', example: 'TODAY()-[受注日]',
    fn: () => {
      const now = new Date();
      return V.date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    } });
  reg({ name: 'DATE', cat: 'date', args: [3, 3], syntax: 'DATE(年, 月, 日)',
    desc: '年・月・日から日付を作ります（月 13 は翌年 1 月、日 0 は前月末になります）。', example: 'DATE([年], [月], 1)',
    fn: (y, m, d) => V.date(Date.UTC(V.int(y), V.int(m) - 1, V.int(d))) });
  reg({ name: 'DATEVALUE', cat: 'date', args: [1, 1], syntax: 'DATEVALUE(文字)',
    desc: '日付の文字（2025/4/1・2025年4月1日・令和7年4月1日 など）を日付にします。', example: 'DATEVALUE([申込日])',
    fn: (s) => V.date(V.dateMs(s)) });
  reg({ name: 'YEAR', cat: 'date', args: [1, 1], syntax: 'YEAR(日付)',
    desc: '年を返します。', example: 'YEAR([受注日])',
    fn: (v) => parts(v).y });
  reg({ name: 'MONTH', cat: 'date', args: [1, 1], syntax: 'MONTH(日付)',
    desc: '月（1〜12）を返します。年度は IF(MONTH([日付])>=4, YEAR([日付]), YEAR([日付])-1) で求められます。', example: 'MONTH([受注日])',
    fn: (v) => parts(v).m });
  reg({ name: 'DAY', cat: 'date', args: [1, 1], syntax: 'DAY(日付)',
    desc: '日（1〜31）を返します。', example: 'DAY([受注日])',
    fn: (v) => parts(v).d });
  reg({ name: 'WEEKDAY', cat: 'date', args: [1, 2], syntax: 'WEEKDAY(日付, [種類])',
    desc: '曜日を数で返します。種類 1（省略時）：日曜 1〜土曜 7／2：月曜 1〜日曜 7／3：月曜 0〜日曜 6。曜日の文字は TEXT([日付], "aaa")。', example: 'WEEKDAY([受注日], 2)',
    fn: (v, type) => {
      const w = parts(v).w;
      const t = type === undefined ? 1 : V.int(type);
      if (t === 1) return w + 1;
      if (t === 2) return w === 0 ? 7 : w;
      if (t === 3) return w === 0 ? 6 : w - 1;
      throw V.fault('WEEKDAY の種類は 1・2・3 です');
    } });
  reg({ name: 'EDATE', cat: 'date', args: [2, 2], syntax: 'EDATE(日付, 月数)',
    desc: '月数だけ後（負の数で前）の同じ日を返します（その月にない日は月末）。', example: 'EDATE([契約日], 12)',
    fn: (v, n) => V.date(addMonths(dayStart(V.dateMs(v)), V.int(n))) });
  reg({ name: 'EOMONTH', cat: 'date', args: [2, 2], syntax: 'EOMONTH(日付, 月数)',
    desc: '月数だけ後（0 でその月）の月末の日付を返します。', example: 'EOMONTH([受注日], 1)',
    fn: (v, n) => {
      const d = new Date(V.dateMs(v));
      return V.date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + V.int(n) + 1, 0));
    } });
  reg({ name: 'DATEDIF', cat: 'date', args: [3, 3], syntax: 'DATEDIF(開始日, 終了日, 単位)',
    desc: '2 つの日付の間の期間。単位 "Y"：満年数／"M"：満月数／"D"：日数／"YM"：1 年未満の月数／"MD"：1 か月未満の日数／"YD"：1 年未満の日数。', example: 'DATEDIF([生年月日], TODAY(), "Y")',
    fn: (a, b, unit) => dateDif(V.dateMs(a), V.dateMs(b), V.text(unit).normalize('NFKC').trim().toUpperCase()) });
  reg({ name: 'DAYS', cat: 'date', args: [2, 2], syntax: 'DAYS(終了日, 開始日)',
    desc: '終了日 − 開始日 の日数を返します（[終了日]-[開始日] と同じ）。', example: 'DAYS([納品日], [受注日])',
    fn: (end, start) => Math.round((dayStart(V.dateMs(end)) - dayStart(V.dateMs(start))) / DAY) });
  reg({ name: 'NETWORKDAYS', cat: 'date', args: [2, 2], syntax: 'NETWORKDAYS(開始日, 終了日)',
    desc: '開始日から終了日までの平日（月〜金）の日数を、両端を含めて返します（祝日は数に入ります）。', example: 'NETWORKDAYS([受注日], [納品日])',
    fn: (a, b) => {
      let s = dayStart(V.dateMs(a));
      let e = dayStart(V.dateMs(b));
      const sign = s > e ? -1 : 1;
      if (sign < 0) [s, e] = [e, s];
      const days = Math.round((e - s) / DAY) + 1;
      const weeks = Math.floor(days / 7);
      let n = weeks * 5;
      const startW = new Date(s).getUTCDay();
      for (let i = 0; i < days % 7; i++) {
        const w = (startW + i) % 7;
        if (w !== 0 && w !== 6) n++;
      }
      return sign * n;
    } });

  function dateDif(a, b, unit) {
    if (b < a) throw V.fault('DATEDIF は開始日を終了日以前にします');
    const s = new Date(a);
    const e = new Date(b);
    const sy = s.getUTCFullYear();
    const sm = s.getUTCMonth();
    const sd = s.getUTCDate();
    const ey = e.getUTCFullYear();
    const em = e.getUTCMonth();
    const ed = e.getUTCDate();
    let months = (ey - sy) * 12 + (em - sm);
    if (ed < sd) months--;
    switch (unit) {
      case 'Y': return Math.floor(months / 12);
      case 'M': return months;
      case 'D': return Math.round((dayStart(b) - dayStart(a)) / DAY);
      case 'YM': return months % 12;
      case 'MD': {
        /* 前の月の同じ日（ない日は月末）から数える（Excel は月末をまたぐと負の数になることがあるため、ここでは負にしない） */
        if (ed >= sd) return ed - sd;
        const prevLast = new Date(Date.UTC(ey, em, 0)).getUTCDate();
        return Math.round((Date.UTC(ey, em, ed) - Date.UTC(ey, em - 1, Math.min(sd, prevLast))) / DAY);
      }
      case 'YD': {
        let anchor = Date.UTC(ey, sm, sd);
        if (anchor > dayStart(b)) anchor = Date.UTC(ey - 1, sm, sd);
        return Math.round((dayStart(b) - anchor) / DAY);
      }
      default: throw V.fault('DATEDIF の単位は "Y"・"M"・"D"・"YM"・"MD"・"YD" です');
    }
  }

  /* ---------------------------------------------------------------------
   * 文字の補助：位置・区切り・全角半角
   * ------------------------------------------------------------------- */
  function position(find, s, start, loose) {
    const text = chars(s);
    const st = start === undefined ? 1 : V.int(start);
    if (st < 1 || st > text.length + 1) throw V.fault('開始位置が文字の範囲外です');
    const hay = text.slice(st - 1).join('');
    const needle = V.text(find);
    let at;
    if (loose) {
      const re = new RegExp(needle.split('').map((c) => (c === '*' ? '.*?' : c === '?' ? '.' : c.replace(/[.+^${}()|[\]\\]/g, '\\$&'))).join(''), 'i');
      const m = re.exec(hay);
      at = m ? Array.from(hay.slice(0, m.index)).length : -1;
    } else {
      const idx = hay.indexOf(needle);
      at = idx < 0 ? -1 : Array.from(hay.slice(0, idx)).length;
    }
    if (at < 0) throw V.fault('「' + needle + '」が見つかりません');
    return st + at;
  }

  function splitAt(s, d, nth, before) {
    const text = V.text(s);
    const delim = V.text(d);
    if (!delim) return before ? '' : text;
    const k = nth === undefined ? 1 : V.int(nth);
    if (k === 0) throw V.fault('何番目に 0 は使えません');
    const pieces = text.split(delim);
    const found = pieces.length - 1;
    if (Math.abs(k) > found) throw V.fault('区切り「' + delim + '」が' + (found ? ' ' + Math.abs(k) + ' 個ありません' : 'ありません'));
    const cut = k > 0 ? k : found + k + 1;
    return before ? pieces.slice(0, cut).join(delim) : pieces.slice(cut).join(delim);
  }

  const HALF_KANA = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝｧｨｩｪｫｯｬｭｮｰ｡｢｣､･';
  const FULL_KANA = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンァィゥェォッャュョー。「」、・';
  const DAKU_FROM = 'カキクケコサシスセソタチツテトハヒフヘホウ';
  const DAKU_TO = 'ガギグゲゴザジズゼゾダヂヅデドバビブベボヴ';
  const HANDAKU_FROM = 'ハヒフヘホ';
  const HANDAKU_TO = 'パピプペポ';

  /** 全角 → 半角（英数字・記号・空白・カタカナ） */
  function toHalf(s) {
    let out = '';
    for (const ch of s) {
      const c = ch.charCodeAt(0);
      if (c >= 0xFF01 && c <= 0xFF5E) out += String.fromCharCode(c - 0xFEE0);
      else if (ch === '　') out += ' ';
      else {
        let k = FULL_KANA.indexOf(ch);
        if (k >= 0) out += HALF_KANA[k];
        else if ((k = DAKU_TO.indexOf(ch)) >= 0) out += HALF_KANA[FULL_KANA.indexOf(DAKU_FROM[k])] + 'ﾞ';
        else if ((k = HANDAKU_TO.indexOf(ch)) >= 0) out += HALF_KANA[FULL_KANA.indexOf(HANDAKU_FROM[k])] + 'ﾟ';
        else out += ch;
      }
    }
    return out;
  }

  /** 半角 → 全角（英数字・記号・空白・カタカナ。濁点・半濁点は前の文字とまとめる） */
  function toFull(s) {
    const list = Array.from(s);
    let out = '';
    for (let i = 0; i < list.length; i++) {
      const ch = list[i];
      const c = ch.charCodeAt(0);
      if (c >= 0x21 && c <= 0x7E) out += String.fromCharCode(c + 0xFEE0);
      else if (ch === ' ') out += '　';
      else {
        const k = HALF_KANA.indexOf(ch);
        if (k < 0) {
          out += ch === 'ﾞ' ? '゛' : ch === 'ﾟ' ? '゜' : ch;
          continue;
        }
        const base = FULL_KANA[k];
        const next = list[i + 1];
        if (next === 'ﾞ' && DAKU_FROM.indexOf(base) >= 0) {
          out += DAKU_TO[DAKU_FROM.indexOf(base)];
          i++;
        } else if (next === 'ﾟ' && HANDAKU_FROM.indexOf(base) >= 0) {
          out += HANDAKU_TO[HANDAKU_FROM.indexOf(base)];
          i++;
        } else out += base;
      }
    }
    return out;
  }

  /* ---------------------------------------------------------------------
   * TEXT の表示形式（よく使う形に絞る）
   *   日付：yyyy・yy・m・mm・d・dd・aaa（月）・aaaa（月曜日）・ddd（Mon）・dddd（Monday）・ggge（令和7）・ge（R7）・h・hh・mm（時の後は分）・ss
   *   数：0・#・,（3 桁区切り）・.（小数）・%。前後の文字（円・個 など）はそのまま出す
   * ------------------------------------------------------------------- */
  const WEEK_JA = ['日', '月', '火', '水', '木', '金', '土'];
  const WEEK_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const ERAS = [
    { start: Date.UTC(2019, 4, 1), name: '令和', short: 'R', base: 2018 },
    { start: Date.UTC(1989, 0, 8), name: '平成', short: 'H', base: 1988 },
    { start: Date.UTC(1926, 11, 25), name: '昭和', short: 'S', base: 1925 },
    { start: Date.UTC(1912, 6, 30), name: '大正', short: 'T', base: 1911 },
    { start: -Infinity, name: '明治', short: 'M', base: 1867 }
  ];
  const DATE_TOKEN = /yyyy|yy|ggge|ge|e|mmmm|mm|m|dddd|ddd|dd|d|aaaa|aaa|hh|h|ss|s|"[^"]*"|./g;

  function formatText(v, fmt) {
    if (/[ymdahsge]/i.test(fmt.replace(/"[^"]*"/g, '')) && (V.isDateLike(v) || v instanceof V.DateVal || !/[0#]/.test(fmt))) {
      return formatDate(V.dateMs(v), fmt);
    }
    return formatNumber(V.num(v), fmt);
  }

  function formatDate(ms, fmt) {
    const d = new Date(ms);
    const y = d.getUTCFullYear();
    const mo = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const w = d.getUTCDay();
    const era = ERAS.find((e) => ms >= e.start);
    const pad = LQ.Util.pad2;
    const tokens = fmt.match(DATE_TOKEN) || [];
    let afterHour = false;
    return tokens.map((tk) => {
      const low = tk.toLowerCase();
      switch (low) {
        case 'yyyy': return String(y);
        case 'yy': return pad(y % 100);
        case 'ggge': return era.name + (y - era.base === 1 ? '元' : String(y - era.base));
        case 'ge': return era.short + (y - era.base);
        case 'e': return String(y - era.base);
        case 'mm': return afterHour ? pad(d.getUTCMinutes()) : pad(mo);
        case 'm': return afterHour ? String(d.getUTCMinutes()) : String(mo);
        case 'mmmm': return String(mo) + '月';
        case 'dd': return pad(day);
        case 'd': return String(day);
        case 'ddd': return WEEK_EN[w].slice(0, 3);
        case 'dddd': return WEEK_EN[w];
        case 'aaa': return WEEK_JA[w];
        case 'aaaa': return WEEK_JA[w] + '曜日';
        case 'hh': afterHour = true; return pad(d.getUTCHours());
        case 'h': afterHour = true; return String(d.getUTCHours());
        case 'ss': return pad(d.getUTCSeconds());
        case 's': return String(d.getUTCSeconds());
        default: return tk.charAt(0) === '"' ? tk.slice(1, -1) : tk;
      }
    }).join('');
  }

  function formatNumber(n, fmt) {
    const m = /^([^0#,.%]*)([0#,.]+)(%?)(.*)$/.exec(fmt);
    if (!m) throw V.fault('表示形式「' + fmt + '」は使えません（例：#,##0・0.0・0%・yyyy/mm/dd）');
    const [, prefix, body, pct, suffix] = m;
    const [intPart, decPart = ''] = body.split('.');
    const decimals = (decPart.match(/[0#]/g) || []).length;
    const minDec = (decPart.match(/0/g) || []).length;
    const minInt = (intPart.match(/0/g) || []).length;
    const group = intPart.indexOf(',') >= 0;
    let value = pct ? n * 100 : n;
    value = Number(Math.round(Number(Math.abs(value) + 'e' + decimals)) + 'e' + (-decimals)) * Math.sign(value || 1);
    const neg = value < 0;
    let [i, f = ''] = Math.abs(value).toFixed(decimals).split('.');
    while (f.length > minDec && f.charAt(f.length - 1) === '0') f = f.slice(0, -1);
    if (i === '0' && minInt === 0) i = '';
    i = i.padStart(minInt, '0');
    if (group) i = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + prefix + i + (f ? '.' + f : '') + pct + suffix;
  }
})(window);
