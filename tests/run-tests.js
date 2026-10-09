/* =========================================================================
 * LightQuery - tests/run-tests.js
 * 動作確認用のスクリプト（ツール本体ではない）。ブラウザで index.html を開き、画面の部品と処理を実際に動かして確かめる。
 *   実行：tests フォルダで  npm install  →  npm test
 *   ・確認ごとに新しいブラウザの環境（保存・記憶が空）で開くので、確認どうしは影響しない
 *   ・ページでエラーが起きた確認は失敗にする
 *   ・インターネット上のライブラリ（アイコン・Excel の読み書き・グラフの描画）は使わない範囲を確かめる
 *   ブラウザの指定（任意）：環境変数 LQ_BROWSER=msedge（Edge）／chrome、または LQ_BROWSER_PATH=実行ファイルの場所
 *   一部だけ：node run-tests.js 関数 年度   … 名前にその言葉を含む確認だけを動かす
 * ========================================================================= */
'use strict';

const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

const PAGE_URL = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
/* インターネット上のライブラリを読めないときのエラーは、確認の失敗に数えない */
const IGNORED_CONSOLE = /Failed to load resource|ERR_TUNNEL|ERR_INTERNET|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION/;

/* ---------------------------------------------------------------------
 * 小さな確認の道具
 * ------------------------------------------------------------------- */
class CheckError extends Error {}

function eq(actual, expected, what) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new CheckError(what + '：' + e + ' のはずが ' + a);
}

function ok(cond, what) {
  if (!cond) throw new CheckError(what);
}

/** 画面を開き、取扱説明書を閉じてから fn(page) を動かす */
async function withPage(browser, fn) {
  const context = await browser.newContext({ viewport: { width: 1500, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !IGNORED_CONSOLE.test(m.text())) errors.push(m.text());
  });
  try {
    await page.goto(PAGE_URL);
    await page.waitForFunction(() => window.LQ && LQ.app && LQ.app.worksets && LQ.app.worksets.ready !== undefined);
    await page.waitForTimeout(300);
    await page.evaluate(() => LQ.app.manual.close());
    await fn(page, context);
    if (errors.length) throw new CheckError('ページでエラー：' + errors.join(' / '));
  } finally {
    await context.close();
  }
}

/** ページの中で使う道具（CSV のファイルを作る） */
const PAGE_HELPERS = 'window.__csv = (text, name) => new File([text], name, { type: "text/csv" });';

/* ---------------------------------------------------------------------
 * 確認の一覧（名前・中身）。処理の順（読み込み → 前処理 → 抽出 → 結果 → 出力・保存）に並べる
 * ------------------------------------------------------------------- */
const CHECKS = [];
const check = (name, fn) => CHECKS.push({ name: name, fn: fn });

check('取扱説明書：3 分で使う・目次の検索・前へ次へ・サンプルで試す', async (browser) => {
  await withPage(browser, async (page) => {
    await page.evaluate(() => LQ.app.manual.open('quick'));
    const crumb = await page.textContent('.lq-manual__crumb');
    ok(crumb.indexOf('3 分で使う') >= 0, '最初の章が「3 分で使う」でない：' + crumb);
    await page.fill('.lq-manual__toc input', '年度');
    const hits = await page.$$eval('.lq-manual__toc a:not([hidden])', (as) => as.length);
    ok(hits > 0 && hits < 24, '「年度」で目次が絞れない（' + hits + ' 章）');
    await page.click('.lq-manual__pager .lq-btn:not([hidden]) >> nth=-1');
    ok((await page.textContent('.lq-manual__crumb')).indexOf('2 /') >= 0, '「次へ」で 2 章目に進まない');
    await page.evaluate(() => LQ.app.manual.show('quick'));
    await page.click('[data-manual-action="samples"]');
    eq(await page.evaluate(() => [LQ.app.popovers.isOpen('samples'), LQ.app.manual.isOpen()]), [true, false], 'サンプルで試す：一覧が開き説明書が閉じる');
  });
});

check('サンプル：すべて読み込んで抽出でき、サンプルデータのみクリアで消える', async (browser) => {
  await withPage(browser, async (page) => {
    const r = await page.evaluate(async () => {
      const ids = LQ.Samples.list().map((s) => s.id).filter((id) => id !== 'perf');
      for (const id of ids) {
        await LQ.app.profiles.loadSample(id);
        if (LQ.app.validationAll().ok) await LQ.app.run();
      }
      LQ.app.profiles.clearSamples();
      return { count: ids.length + 1, left: LQ.app.state.hasSample() };
    });
    ok(r.count >= 26, 'サンプルの数が少ない：' + r.count);
    eq(r.left, false, 'クリア後にサンプルが残っていない');
  });
});

check('前処理：縦に結合（列名でそろえる・見出しの位置の自動判定）・重複の削除・処理の流れ', async (browser) => {
  await withPage(browser, async (page) => {
    const r = await page.evaluate(async () => {
      const SF = LQ.SourceFile;
      const a = SF.fromGrid([['ID', '名前', '金額'], ['1', 'a', '10'], ['2', 'b', '20'], ['3', 'A', '30']], 'jan.csv', 'paste');
      const c = SF.fromGrid([['タイトル'], [], ['名前', 'ID', '地域'], ['b', '2', '東'], ['c', '4', '西']], 'feb.csv', 'paste');
      const ds = new LQ.Dataset('source', a, { members: [c] });
      const out = { cols: ds.columnNames(), rows: ds.rowCount, how: ds.union.files.map((f) => f.how) };
      ds.setDedup({ cols: ['名前'] });
      out.dedup = [ds.rowCount, ds.dedupInfo.removed.length];
      out.flow = LQ.PrepFlow.text(ds);
      return out;
    });
    eq(r.cols, ['ID', '名前', '金額', '地域', '元ファイル'], '列を名前でそろえ、元ファイル列を付ける');
    eq(r.rows, 5, '2 ファイルの合計行数');
    eq(r.how, ['primary', 'auto'], '見出しの位置が違うファイルは自動判定');
    eq(r.dedup, [3, 2], '名前の重複（大文字小文字をそろえる）を除く');
    ok(r.flow.indexOf('重複の削除 −2') >= 0, '処理の流れに重複の削除の行数：' + r.flow);
  });
});

check('前処理：ファイルをまとめて読み込む・下に足す・外す', async (browser) => {
  await withPage(browser, async (page) => {
    await page.evaluate(PAGE_HELPERS);
    const r = await page.evaluate(async () => {
      const A = LQ.app;
      const S = A.state;
      await A.prep.loadSourceFiles([__csv('ID,金額\n1,10\n2,20\n', 'a.csv'), __csv('金額,ID\n30,3\n', 'b.csv')], 'replace');
      const two = S.datasets.source.fileCount;
      await A.prep.loadSourceFiles([__csv('ID,金額\n4,40\n', 'c.csv')], 'append');
      const three = [S.datasets.source.fileCount, S.datasets.source.rowCount];
      A.prep.removeMember(0);
      return { two: two, three: three, removed: [S.datasets.source.fileCount, S.datasets.source.rowCount] };
    });
    eq(r.two, 2, '複数選ぶと縦に結合');
    eq(r.three, [3, 4], '下に足す');
    eq(r.removed, [2, 3], 'ファイルを外す');
  });
});

check('前処理：縦持ち（列のおすすめ・名前・空欄を除く・絞り込み・次回の掛け直し）', async (browser) => {
  await withPage(browser, async (page) => {
    await page.evaluate(PAGE_HELPERS);
    const r = await page.evaluate(async () => {
      const A = LQ.app;
      const S = A.state;
      await A.loadFile('source', __csv('顧客,地域,4月,5月,6月\nA社,東京,100,200,\nB社,大阪,300,,400\n', 'wide.csv'));
      const sug = LQ.Unpivot.suggest(S.datasets.source.preUnpivotColumns);
      A.prep.setUnpivot('source', { cols: sug, name: '月', value: '売上', keepBlank: false });
      const ds = S.datasets.source;
      const cols = ds.columnNames();
      const rows = ds.rowCount;
      S.setFilters('source', [{ id: 'f', col: '月', mode: 'values', values: ['4月'] }]);
      const filtered = ds.rowCount;
      await A.loadFile('source', __csv('顧客,地域,4月,5月,6月\nC社,福岡,1,2,3\n', 'wide2.csv'));
      return { sug: sug, cols: cols, rows: rows, filtered: filtered, again: [S.datasets.source.columnNames(), S.datasets.source.unpivotInfo.kept] };
    });
    eq(r.sug, ['4月', '5月', '6月'], '月の見出しの列をおすすめする');
    eq(r.cols, ['顧客', '地域', '月', '売上'], '列の名前');
    eq(r.rows, 4, '空欄の値は行にしない');
    eq(r.filtered, 2, '縦持ちにした列で絞り込める');
    eq(r.again, [['顧客', '地域', '月', '売上'], 3], '同じ列の表に縦持ちを掛け直す');
  });
});

check('計算の関数：82 通りの式と、誤った式の知らせ', async (browser) => {
  const cases = [
    ['[金額]*1.1', '11000'], ['ROUND([金額]×1.08, 0)', '10800'], ['[金額]>=10000', 'TRUE'], ['IF([金額]>=10000,"大口","通常")', '大口'],
    ['IF([空]="", "空", "x")', '空'], ['IFS([点]>=80,"A",[点]>=60,"B",TRUE,"C")', 'B'], ['IFERROR([金額]/0, -1)', '-1'],
    ['SWITCH([地域],"東京","関東","大阪","関西","他")', '関東'], ['AND([点]>50, [地域]="東京")', 'TRUE'], ['OR(FALSE, 1)', 'TRUE'], ['NOT(ISBLANK([空]))', 'FALSE'],
    ['ISNUMBER(SEARCH("usb", [商品]))', 'TRUE'], ['ISNUMBER("1,200円")', 'TRUE'],
    ['LEFT([コード], 2)', 'AB'], ['RIGHT([コード])', '9'], ['MID([コード],4,3)', '123'], ['LEN([全角])', '5'], ['TRIM("  a 　 b ")', 'a b'],
    ['UPPER("abc")&LOWER("XY")', 'ABCxy'], ['ASC([全角])', 'ABC12'], ['ASC("ガッコウ")', 'ｶﾞｯｺｳ'], ['JIS("ｶﾞｯｺｳ ab")', 'ガッコウ　ａｂ'],
    ['SUBSTITUTE("03-1234-5678","-","")', '0312345678'], ['SUBSTITUTE("a-b-c","-","+",2)', 'a-b+c'], ['REPLACE("09012345678",1,3,"***")', '***12345678'],
    ['FIND("-", [コード])', '3'], ['IFERROR(FIND("z",[コード]),"なし")', 'なし'], ['SEARCH("b*1",[コード])', '2'],
    ['TEXTBEFORE("東京都新宿区","都")', '東京'], ['TEXTAFTER("a@b.com","@")', 'b.com'], ['TEXTAFTER("a/b/c","/",-1)', 'c'],
    ['CONCAT([地域]," ",[点])', '東京 70'], ['TEXTJOIN("・",TRUE,[地域],[空],"x")', '東京・x'], ['REPT("★",3)', '★★★'], ['VALUE("1,234円")+1', '1235'],
    ['TEXT([金額],"#,##0円")', '10,000円'], ['TEXT(0.256,"0.0%")', '25.6%'], ['TEXT(7,"000")', '007'], ['TEXT(1234.5,"#,##0.00")', '1,234.50'],
    ['TEXT([日付],"yyyy年m月d日(aaa)")', '2025年4月5日(土)'], ['TEXT([日付],"ggge年")', '令和7年'], ['TEXT([日付],"yyyy/mm")', '2025/04'],
    ['ABS(-3)+INT(-1.5)', '1'], ['MOD(-7,3)', '2'], ['CEILING(1234,100)', '1300'], ['FLOOR(37,10)', '30'], ['MIN([点],50)', '50'], ['MAX([点],[空])', '70'],
    ['SUM([点],[金額],[空])', '10070'], ['AVERAGE([点],90)', '80'], ['SQRT(16)', '4'], ['POWER(2,10)', '1024'], ['2^3^2', '64'], ['-2^2', '4'],
    ['[日付]+30', '2025/05/05'], ['[終了]-[日付]', '26'], ['DATE(2025,13,1)', '2026/01/01'], ['DATE(2025,3,0)', '2025/02/28'], ['YEAR([日付])&"/"&MONTH([日付])&"/"&DAY([日付])', '2025/4/5'],
    ['WEEKDAY([日付])', '7'], ['WEEKDAY([日付],2)', '6'], ['EDATE("2025/01/31",1)', '2025/02/28'], ['EOMONTH([日付],0)', '2025/04/30'],
    ['DATEDIF("1990/05/20","2025/04/05","Y")', '34'], ['DATEDIF("2025/01/31","2025/03/01","M")', '1'], ['DATEDIF("2025/01/31","2025/03/01","MD")', '1'], ['DATEDIF("2024/05/20","2025/04/05","YD")', '320'],
    ['DAYS([終了],[日付])', '26'], ['NETWORKDAYS("2025/04/01","2025/04/30")', '22'], ['DATEVALUE("令和7年4月5日")', '2025/04/05'],
    ['[日付]>="2025/04/01"', 'TRUE'], ['[日付]<DATE(2025,4,1)', 'FALSE'], ['IF(MONTH([日付])>=4,YEAR([日付]),YEAR([日付])-1)', '2025'],
    ['"a""b"', 'a"b'], ['[金額]≧10000', 'TRUE'], ['[地域]≠"大阪"', 'TRUE'], ['[地域]="とうきょう"', 'FALSE'], ['"ABC"="abc"', 'TRUE'],
    ['[文字]*2', '#nan'], ['[金額]/[空]', '#div0'], ['DATEVALUE("x")', '#value'], ['YEAR([空])', '#value']
  ];
  const bad = ['LEFT(', 'FOO(1)', 'LEFT()', 'IF(1)', 'TODAY(1)', '[無い列]+1', '1 +', '"abc'];
  await withPage(browser, async (page) => {
    const r = await page.evaluate(([list, wrong]) => {
      const row = { 金額: '10,000', 点: '70', 空: '', 地域: '東京', 商品: 'USBケーブル', コード: 'AB-123-9', 全角: 'ＡＢＣ１２', 日付: '2025/04/05', 終了: '2025-05-01', 文字: 'abc' };
      const names = Object.keys(row);
      const fails = [];
      list.forEach(([expr, want]) => {
        let got;
        try {
          got = LQ.Formula.toText(LQ.Formula.compile(expr, (n) => names.indexOf(n)).evaluate((i) => row[names[i]]));
        } catch (e) {
          const code = LQ.Formula.faultCode(e);
          got = code ? '#' + code : 'ERR ' + e.message;
        }
        if (got !== want) fails.push(expr + ' → ' + got + '（正しくは ' + want + '）');
      });
      const silent = wrong.filter((expr) => {
        try {
          LQ.Formula.compile(expr, (n) => names.indexOf(n));
          return true;
        } catch (e) {
          return !e.message;
        }
      });
      return { fails: fails, silent: silent, funcs: LQ.Formula.Funcs.names().length };
    }, [cases, bad]);
    eq(r.fails, [], '式の計算結果');
    eq(r.silent, [], '誤った式は知らせる');
    ok(r.funcs >= 55, '関数の数：' + r.funcs);
  });
});

check('照合ルール：表記ゆれ（かな・法人格・記号）と正規表現（抽出・絞り込み・書き方の誤り）', async (browser) => {
  await withPage(browser, async (page) => {
    await page.evaluate(PAGE_HELPERS);
    const r = await page.evaluate(async () => {
      const N = new LQ.Normalizer({ kana: true, corp: true, symbol: true });
      const names = ['株式会社やまだ商事', '(株)ヤマダ商事', '㈱ヤマダ商事', 'ヤマダ商事株式会社'].map((v) => N.text(v));
      const A = LQ.app;
      const S = A.state;
      await A.loadFile('source', __csv('コード,会社\nA-101,株式会社山田商事\nA-1002,(株)鈴木\nB-201,佐藤物産\n', 'x.csv'));
      A.profiles.addCondition({ left: 'コード', op: 'regex', right: { type: 'value', value: '^a-\\d{3}$' } });
      await A.run();
      const hits = S.result.length;
      S.setFilters('source', [{ id: 'f', col: 'コード', mode: 'op', op: 'notRegex', value: '^B' }]);
      const bad = LQ.RowFilter.compile({ col: 'コード', mode: 'op', op: 'regex', value: '([' }, S.datasets.source).message;
      return { names: Array.from(new Set(names)), hits: hits, filtered: S.datasets.source.rowCount, bad: !!bad };
    });
    eq(r.names, ['ヤマダ商事'], '法人格・かなの違いをそろえる');
    eq(r.hits, 1, '正規表現（大文字小文字は照合ルールどおり）');
    eq(r.filtered, 2, '絞り込みでも正規表現が使える');
    eq(r.bad, true, '正規表現の書き方の誤りを知らせる');
  });
});

check('抽出：一致しなかった ② の行', async (browser) => {
  await withPage(browser, async (page) => {
    const r = await page.evaluate(async () => {
      await LQ.app.profiles.loadSample('idlist');
      await LQ.app.run();
      const part = LQ.app.state.result.parts[0];
      return { miss: part.condUnmatched.length, id: part.condition.cell(part.condUnmatched[0], 0) };
    });
    eq(r, { miss: 1, id: 'C9999' }, '受注のない顧客 ID だけが残る');
  });
});

check('抽出結果の絞り込み：見出しの一覧で外した値を元の表（① / ②）にも掛けて抽出し直す・タグで外す', async (browser) => {
  await withPage(browser, async (page) => {
    await page.evaluate(async () => {
      await LQ.app.profiles.loadSample('idlist');
      await LQ.app.run();
    });
    const before = await page.evaluate(() => LQ.app.state.result.length);
    /* ① の列：見出しの一覧で 1 つ目の値を外して OK */
    await page.click('th[data-key="s:地域"]');
    const dropped = await page.evaluate(() => {
      const label = document.querySelector('.lq-popover .lq-filter__values .lq-filter__value');
      const box = label.querySelector('input');
      box.click();
      return label.querySelector('.lq-filter__label').textContent;
    });
    await page.click('.lq-popover .lq-popover__foot .lq-btn--primary');
    await page.waitForFunction(() => LQ.app.state.result && !LQ.app.state.busy);
    await page.waitForSelector('th[data-key="s:地域"] .lq-th__filtered', { timeout: 3000 }).catch(() => null);
    const r1 = await page.evaluate((v) => {
      const S = LQ.app.state;
      const view = LQ.app.main.resultView();
      const def = view.resolve('s:地域');
      let left = 0;
      for (let i = 0; i < view.length; i++) if (view.value(def, i) === v) left++;
      const f = S.datasets.source.filters[0];
      return { rows: view.length, left: left, filter: { col: f.col, exclude: !!f.exclude, values: f.values },
        tag: !!document.querySelector('.lq-filterbar .lq-ftag'), mark: !!document.querySelector('th[data-key="s:地域"] .lq-th__filtered') };
    }, dropped);
    ok(r1.rows < before, '外した値の行が結果から消える（' + before + ' → ' + r1.rows + ' 行）');
    eq(r1.left, 0, '外した値の行は残らない');
    eq(r1.filter, { col: '地域', exclude: true, values: [dropped] }, '① には「外した値を除く」絞り込みが掛かる');
    ok(r1.tag && r1.mark, '結果の上に絞り込みのタグ、見出しに漏斗が出る');
    /* ① の見出しの一覧では、外した値だけ選ばれていない */
    const unchecked = await page.evaluate((v) => {
      LQ.app.columnMenu.open(document.body, 'source', '地域');
      const labels = Array.from(document.querySelectorAll('.lq-popover .lq-filter__values .lq-filter__value'));
      const off = labels.filter((l) => !l.querySelector('input').checked).map((l) => l.querySelector('.lq-filter__label').textContent);
      LQ.app.popovers.close();
      return off;
    }, dropped);
    eq(unchecked, [dropped], '① の一覧では外した値だけが未選択');
    /* ② の列：外した値は ② の絞り込みになる */
    const memo = await page.evaluate(() => {
      const view = LQ.app.main.resultView();
      return LQ.ResultFilter.distinct(view, 'c:メモ').list.map((v) => v.value);
    });
    await page.click('th[data-key="c:メモ"]');
    await page.evaluate(() => document.querySelector('.lq-popover .lq-filter__values .lq-filter__value input').click());
    await page.click('.lq-popover .lq-popover__foot .lq-btn--primary');
    await page.waitForFunction(() => LQ.app.state.result && !LQ.app.state.busy && document.querySelectorAll('.lq-filterbar .lq-ftag').length === 2, null, { timeout: 3000 }).catch(() => null);
    const r2 = await page.evaluate(() => {
      const c = LQ.app.state.datasets.condition;
      return { filters: c.filters.map((f) => ({ col: f.col, exclude: !!f.exclude, n: f.values.length })), tags: document.querySelectorAll('.lq-filterbar .lq-ftag').length };
    });
    eq(r2, { filters: [{ col: 'メモ', exclude: true, n: 1 }], tags: 2 }, '② にも絞り込みが掛かり、タグが 2 つになる');
    ok(memo.length > 1, '② の列の値の一覧が出る');
    /* タグの × で外すと元の行数に戻る */
    for (let i = 0; i < 2; i++) {
      await page.click('.lq-filterbar .lq-ftag__x');
      await page.waitForFunction((n) => LQ.app.state.result && !LQ.app.state.busy && document.querySelectorAll('.lq-filterbar .lq-ftag').length === n, 1 - i);
    }
    eq(await page.evaluate(() => [LQ.app.state.datasets.source.filters.length, LQ.app.state.datasets.condition.filters.length]), [0, 0], '① / ② の絞り込みが外れる');
    eq(await page.evaluate(() => LQ.app.state.result.length), before, 'タグの × で外すと元の行数に戻る');
  });
});

check('貼り付け：読み込むたびに、値が Excel の表示どおり（丸めた値）だと知らせる', async (browser) => {
  await withPage(browser, async (page) => {
    const n = await page.evaluate(async () => {
      const count = () => Array.from(document.querySelectorAll('.lq-toast')).filter((t) => t.textContent.indexOf('Excel の表示どおり') !== -1).length;
      LQ.app.loadText('source', '品目\t率\nA\t0\nB\t1');
      const first = count();
      LQ.app.loadText('source', '品目\t率\nA\t0\nB\t1');
      return [first, count()];
    });
    eq(n, [1, 2], '貼り付けるたびに通知が出る');
  });
});

check('ピボット：重複を除いた件数（総計も重複を除く）と年度の始まり', async (browser) => {
  await withPage(browser, async (page) => {
    const r = await page.evaluate(async () => {
      const A = LQ.app;
      const S = A.state;
      await A.profiles.loadSample('pivot');
      S.setAggregate({ target: 'source', rows: [{ key: 's:地域' }], cols: [], values: [{ key: 's:備考', fn: 'distinct' }] });
      S.setTab('aggregate');
      const c = A.main.aggregate.computed();
      const grand = c.get(-1, -1, 0).value;
      const sum = c.rows.reduce((t, row) => t + c.get(row.i, -1, 0).value, 0);
      await A.profiles.loadSample('unpivot');
      S.setTab('aggregate');
      const months = () => A.main.aggregate.computed().rows.map((row) => row.labels[0]);
      const fy4 = months();
      S.setFiscalStart(1);
      const fy1 = months();
      S.setFiscalStart(4);
      const p = LQ.Period.parse('2024年度');
      return { grand: grand, sum: sum, fy4: [fy4[0], fy4[11]], fy1: [fy1[0], fy1[11]], fyStart: new Date(p.start).toISOString().slice(0, 10) };
    });
    ok(r.grand < r.sum, '総計は各行の和ではなく重複を除いた数（総計 ' + r.grand + '・和 ' + r.sum + '）');
    eq(r.fy4, ['4月', '3月'], '4 月始まり：月の名前は 4月〜3月');
    eq(r.fy1, ['1月', '12月'], '1 月始まり：月の名前は 1月〜12月');
    eq(r.fyStart, '2024-04-01', '2024年度は 4 月 1 日から');
  });
});

check('前回との違い：直前の抽出結果との比較・保存して開き直しても使える・表で見る', async (browser) => {
  const context = await browser.newContext({ viewport: { width: 1500, height: 900 } });
  try {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(PAGE_URL);
    await page.waitForTimeout(800);
    await page.evaluate(PAGE_HELPERS);
    await page.evaluate(async () => {
      const A = LQ.app;
      A.manual.close();
      await A.loadFile('source', __csv('受注番号,顧客ID,金額\nA1,C1,100\nA2,C2,200\nA4,C1,400\n', 'apr.csv'));
      A.profiles.addCondition({ left: '金額', op: 'gte', right: { type: 'value', value: '0' } });
      await A.run();
      await A.worksets.flush();
    });
    await page.waitForTimeout(500);
    await page.reload();
    await page.waitForTimeout(1200);
    await page.evaluate(PAGE_HELPERS);
    const r = await page.evaluate(async () => {
      const A = LQ.app;
      A.manual.close();
      const saved = !!A.compare.latest;
      await A.loadFile('source', __csv('受注番号,顧客ID,金額\nA1,C1,100\nA2,C2,250\nA5,C2,500\n', 'may.csv'));
      await A.run();
      const prev = A.compare.previous;
      A.compare.start(prev, LQ.Compare.suggestKey(prev, A.compare.currentTable()));
      const res = A.compare.result();
      A.compare.showPrevious(null);
      return { saved: saved, key: A.compare.key, counts: [res.added.length, res.removed.length, res.changed.length, res.same],
        drill: A.main.drillView().isOpen() };
    });
    eq(r.saved, true, '開き直しても直前の抽出結果が残る');
    eq(r.key, '受注番号', '行を見分ける列のおすすめ');
    eq(r.counts, [1, 1, 1, 1], '増えた・消えた・変わった・同じ');
    eq(r.drill, true, '直前の抽出結果を表で見る');
    if (errors.length) throw new CheckError('ページでエラー：' + errors.join(' / '));
  } finally {
    await context.close();
  }
});

check('記憶：重複の削除の掛け直し・作業セットへの保存（②）', async (browser) => {
  await withPage(browser, async (page) => {
    await page.evaluate(PAGE_HELPERS);
    const r = await page.evaluate(async () => {
      const A = LQ.app;
      const S = A.state;
      await A.loadFile('source', __csv('ID,名前\n1,a\n1,a\n2,b\n', 'x.csv'));
      A.prep.setDedup('source', { cols: [] });
      await A.loadFile('source', __csv('ID,名前\n5,a\n5,a\n6,b\n7,b\n', 'y.csv'));
      const again = [S.datasets.source.rowCount, !!S.datasets.source.dedup];
      A.loadText('condition', 'ID\n1\n1\n2');
      A.prep.setDedup('condition', { cols: ['ID'] });
      const cap = LQ.WorksetCodec.capture(S, null);
      return { again: again, saved: cap.content.profiles[0].dedup };
    });
    eq(r.again, [3, true], '同じ列の表に重複の削除を掛け直す');
    eq(r.saved, { cols: ['ID'] }, '② の重複の削除を作業セットに保存');
  });
});

check('速さ：10 万行 × ② 1,000 行の抽出が 3 秒以内', async (browser) => {
  await withPage(browser, async (page) => {
    const r = await page.evaluate(async () => {
      await LQ.app.profiles.loadSample('perf');
      const t = performance.now();
      await LQ.app.run();
      return { ms: performance.now() - t, rows: LQ.app.state.result.stats.sourceRows };
    });
    eq(r.rows, 100000, '① の行数');
    ok(r.ms < 3000, '抽出に ' + Math.round(r.ms) + ' ミリ秒かかった');
  });
});

/* ---------------------------------------------------------------------
 * 実行
 * ------------------------------------------------------------------- */
async function launch() {
  const opts = {};
  if (process.env.LQ_BROWSER_PATH) opts.executablePath = process.env.LQ_BROWSER_PATH;
  else if (process.env.LQ_BROWSER) opts.channel = process.env.LQ_BROWSER;
  return chromium.launch(opts);
}

(async () => {
  const words = process.argv.slice(2);
  const list = CHECKS.filter((c) => !words.length || words.some((w) => c.name.indexOf(w) >= 0));
  const browser = await launch();
  let failed = 0;
  const started = Date.now();
  for (const c of list) {
    const t = Date.now();
    try {
      await c.fn(browser);
      console.log('  ✔ ' + c.name + '（' + (Date.now() - t) + ' ms）');
    } catch (err) {
      failed++;
      console.log('  ✘ ' + c.name);
      console.log('      ' + (err instanceof CheckError ? err.message : (err && err.stack) || err));
    }
  }
  await browser.close();
  console.log('\n' + (list.length - failed) + ' / ' + list.length + ' 件が通りました（' + ((Date.now() - started) / 1000).toFixed(1) + ' 秒）');
  process.exit(failed ? 1 : 0);
})();
