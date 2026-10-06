/* =========================================================================
 * LightQuery - lq-samples.js
 * 動作確認用のサンプルデータ。値は乱数の種を固定して毎回同じものを生成する。
 *   build() は ① の grid と、抽出条件（名前・② の grid・条件・個別の照合ルール）の一覧、振り分けの設定、出力列の初期値を返す。
 *   ピボット（aggregate）・グラフ（charts）の設定と、最初に開くタブ（tab）も返せる。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const pad2 = LQ.Util.pad2;

  function createRandom(seed) {
    let s = seed >>> 0;
    const next = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
      next: next,
      int: (min, max) => min + Math.floor(next() * (max - min + 1)),
      pick: (list) => list[Math.floor(next() * list.length)]
    };
  }

  const REGIONS = ['東京', '大阪', '名古屋', '福岡', '札幌', '仙台'];
  const SURNAMES = ['青木', '石川', '上田', '遠藤', '大野', '加藤', '木村', '小林', '斎藤', '佐々木', '清水', '高田', '田村', '中島', '西村', '橋本', '藤田', '前田', '松本', '山口'];
  const SUFFIXES = ['商事', '工業', '物産', '電機', '食品', 'サービス', '製作所', '興業'];
  const PRODUCTS = [
    { code: 'A-101', name: 'ボールペン 黒', cat: '文具', price: 120 },
    { code: 'A-102', name: 'ボールペン 赤', cat: '文具', price: 120 },
    { code: 'A-110', name: 'ノート A4 5冊', cat: '文具', price: 680 },
    { code: 'A-120', name: '試作ペン（新色）', cat: '文具', price: 150 },
    { code: 'A-130', name: '付箋 75mm', cat: '文具', price: 240 },
    { code: 'B-201', name: 'USB ケーブル 1m', cat: '家電', price: 980 },
    { code: 'B-202', name: 'USB 充電器 20W', cat: '家電', price: 1980 },
    { code: 'B-210', name: 'モバイルバッテリー', cat: '家電', price: 3480 },
    { code: 'B-220', name: '電気ケトル', cat: '家電', price: 4980 },
    { code: 'B-230', name: '中古 ノートPC', cat: '家電', price: 38000 },
    { code: 'C-301', name: '緑茶 500ml 24本', cat: '食品', price: 2880 },
    { code: 'C-310', name: 'コーヒー豆 1kg', cat: '食品', price: 2600 },
    { code: 'C-320', name: 'ドリップコーヒー 50袋', cat: '食品', price: 1650 },
    { code: 'D-401', name: 'ハンドソープ 詰替', cat: '日用品', price: 380 },
    { code: 'D-410', name: 'ティッシュ 5箱', cat: '日用品', price: 420 },
    { code: 'D-420', name: 'USB 加湿器', cat: '日用品', price: 2480 }
  ];
  const NOTES = ['', '', '', '', '', '至急', '要見積', '中古品含む', '試作', 'テスト発注', 'USB-C 対応', '再発注', 'ケーブル同梱'];
  const ORDER_HEADER = ['受注番号', '受注日', '顧客ID', '顧客名', '地域', '商品コード', '商品名', 'カテゴリ', '数量', '単価', '金額', '備考'];

  function makeCustomers(count, digits, rand) {
    const list = [];
    for (let i = 1; i <= count; i++) {
      list.push({
        id: 'C' + String(i).padStart(digits, '0'),
        name: rand.pick(SURNAMES) + rand.pick(SUFFIXES),
        region: rand.pick(REGIONS)
      });
    }
    return list;
  }

  function dateText(dayOffset) {
    const d = new Date(Date.UTC(2025, 3, 1) + dayOffset * 86400000);
    return d.getUTCFullYear() + '/' + pad2(d.getUTCMonth() + 1) + '/' + pad2(d.getUTCDate());
  }

  /** 受注データ（① 用）。columns を指定すると列を絞る */
  function makeOrders(count, customers, rand, columns) {
    const header = columns || ORDER_HEADER;
    const pickIdx = header.map((h) => ORDER_HEADER.indexOf(h));
    const grid = [header.slice()];
    for (let i = 0; i < count; i++) {
      const cust = rand.pick(customers);
      const prod = rand.pick(PRODUCTS);
      const qty = rand.int(1, 20);
      const full = [
        'OD-' + (250001 + i), dateText(rand.int(0, 364)), cust.id, cust.name, cust.region,
        prod.code, prod.name, prod.cat, String(qty), String(prod.price), String(qty * prod.price), rand.pick(NOTES)
      ];
      grid.push(pickIdx.map((k) => full[k]));
    }
    return grid;
  }

  function withNumber(n) {
    return Number(n).toLocaleString('ja-JP');
  }

  const C = (left, op, right) => ({ left: left, op: op, right: right });
  const col = (name) => ({ type: 'column', col: name, value: '' });
  const fixed = (value) => ({ type: 'value', col: '', value: value });
  const cols = (from, to) => ({ type: 'column', col: from, value: '', col2: to, value2: '' });
  const fixedRange = (from, to) => ({ type: 'value', col: '', value: from, col2: '', value2: to });
  const Q = (conditions, extra) => Object.assign({ conditions: conditions, logic: { mode: 'and', expr: '' } }, extra || {});
  const orders = (seed) => {
    const rand = createRandom(seed);
    return makeOrders(2000, makeCustomers(300, 4, rand), rand);
  };
  const ORDERS_NAME = 'サンプル_受注データ.xlsx';

  /**
   * 月ごとの受注ファイル（縦に結合のサンプル用）。
   *   4 月：見出しが 1 行目／5 月：上に表題と空行があり見出しが 3 行目、4 月の終わりの 12 行を再送（重複）／
   *   6 月：列の並びが違い「担当者」列が増えた、5 月の終わりの 8 行を再送（重複）
   */
  function monthlyOrders() {
    const rand = createRandom(2025);
    const customers = makeCustomers(120, 4, rand);
    const staff = ['佐藤', '鈴木', '高橋', '田中'];
    const base = ['受注番号', '受注日', '顧客ID', '顧客名', '地域', '商品名', '数量', '金額'];
    let no = 250001;
    const month = (m, count) => {
      const rows = [];
      for (let i = 0; i < count; i++) {
        const cust = rand.pick(customers);
        const prod = rand.pick(PRODUCTS);
        const qty = rand.int(1, 20);
        rows.push({ 受注番号: 'OD-' + (no++), 受注日: '2025/' + pad2(m) + '/' + pad2(rand.int(1, 28)), 顧客ID: cust.id, 顧客名: cust.name, 地域: cust.region,
          商品名: prod.name, 数量: String(qty), 金額: String(qty * prod.price), 担当者: rand.pick(staff) });
      }
      return rows;
    };
    const apr = month(4, 300);
    const may = apr.slice(-12).concat(month(5, 320));
    const jun = may.slice(-8).concat(month(6, 340));
    const juneCols = ['受注日', '受注番号', '地域', '顧客ID', '顧客名', '商品名', '金額', '数量', '担当者'];
    const toGrid = (header, rows) => [header.slice()].concat(rows.map((r) => header.map((h) => r[h])));
    return {
      apr: toGrid(base, apr),
      may: [['2025年5月 受注一覧'], []].concat(toGrid(base, may)),
      jun: toGrid(juneCols, jun),
      columns: base.concat(['担当者'])
    };
  }

  const SAMPLES = [
    {
      id: 'idlist',
      icon: 'id-card',
      title: '顧客 ID のリストで抽出',
      desc: '② の顧客 ID と完全一致する受注を抽出します。全角・小文字・前後の空白が混じった ID も照合ルールで一致します。',
      tags: ['完全一致', '照合ルール'],
      build() {
        const cond = [['顧客ID', 'メモ'],
          ['Ｃ００１２', '全角で入力'], ['c0045', '小文字で入力'], [' C0078 ', '前後に空白'], ['C0101', ''],
          ['C0133', ''], ['C0150', '重点顧客'], ['C0177', ''], ['C0202', ''], ['C0230', '新規'], ['C0256', ''],
          ['C0288', ''], ['C9999', '該当なし（受注なし）']];
        return {
          source: { name: ORDERS_NAME, grid: orders(101) },
          profiles: [{ name: '抽出対象の顧客', condition: { name: 'サンプル_抽出対象顧客.csv', grid: cond }, query: Q([C('顧客ID', 'eq', col('顧客ID'))]) }],
          output: ['m:profile'].concat(ORDER_HEADER.map((h) => 's:' + h), ['c:メモ'])
        };
      }
    },
    {
      id: 'threshold',
      icon: 'scale-balanced',
      title: '地域ごとの下限金額（② の列も出力）',
      desc: '② の 1 行を「地域」と「下限金額」の組として判定します。担当者など ② の列も出力します。福岡は下限金額が空欄のため金額を判定しません。',
      tags: ['1 行＝1 セット', '以上', '空欄は判定しない'],
      build() {
        const cond = [['地域', '下限金額', '担当者'], ['東京', '50,000', '佐藤'], ['大阪', '30000', '鈴木'], ['名古屋', '20000', '高橋'], ['福岡', '', '田中']];
        return {
          source: { name: ORDERS_NAME, grid: orders(202) },
          profiles: [{
            name: '地域別の下限金額',
            condition: { name: 'サンプル_地域別基準.csv', grid: cond },
            query: Q([C('地域', 'eq', col('地域')), C('金額', 'gte', col('下限金額'))])
          }],
          output: ['m:profile', 's:受注番号', 's:受注日', 's:顧客名', 's:地域', 's:商品名', 's:金額', 'c:担当者', 'c:下限金額', 'm:condRow']
        };
      }
    },
    {
      id: 'exclude',
      icon: 'magnifying-glass',
      title: 'キーワードを含み、除外語を含まない',
      desc: 'A：商品名がキーワードを含む かつ B：商品名が除外語を含まない かつ C：備考が除外語を含まない。② の行ごとに判定します。',
      tags: ['含む', '含まない'],
      build() {
        const cond = [['キーワード', '除外語', '用途'], ['USB', '中古', '周辺機器'], ['ペン', '試作', '筆記具'], ['コーヒー', '', '飲料']];
        return {
          source: { name: ORDERS_NAME, grid: orders(303) },
          profiles: [{
            name: 'キーワード（除外語あり）',
            condition: { name: 'サンプル_キーワード.csv', grid: cond },
            query: Q([C('商品名', 'contains', col('キーワード')), C('商品名', 'notContains', col('除外語')), C('備考', 'notContains', col('除外語'))])
          }],
          output: ['m:profile', 's:受注番号', 's:受注日', 's:商品名', 's:備考', 's:金額', 'c:キーワード', 'c:用途']
        };
      }
    },
    {
      id: 'logic',
      icon: 'code-branch',
      title: '(A or B) and C の組み合わせ＋固定値',
      desc: '商品名または備考にキーワードを含み（A or B）、受注日が開始日以降（C）、数量が固定値 5 以上（D）。一致したすべての組み合わせを出力します。',
      tags: ['式で指定', '固定値', 'すべての組み合わせ'],
      build() {
        const cond = [['キーワード', '開始日'], ['USB', '2025/06/01'], ['ケーブル', '2025/09/01'], ['コーヒー', '']];
        return {
          source: { name: ORDERS_NAME, grid: orders(404) },
          profiles: [{
            name: 'キャンペーン',
            condition: { name: 'サンプル_キャンペーン.csv', grid: cond },
            query: Q([C('商品名', 'contains', col('キーワード')), C('備考', 'contains', col('キーワード')),
              C('受注日', 'gte', col('開始日')), C('数量', 'gte', fixed('5'))], { logic: { mode: 'expr', expr: '(A or B) and C and D' }, matchMode: 'all' })
          }],
          output: ['m:profile', 's:受注番号', 's:受注日', 's:商品名', 's:備考', 's:数量', 'c:キーワード', 'c:開始日', 'm:count']
        };
      }
    },
    {
      id: 'report',
      icon: 'file-invoice',
      title: 'タイトル行付きの帳票＋ヘッダーなしのリスト',
      desc: '① はタイトル行・空の A 列・末尾の合計行がある帳票（ヘッダー 4 行目・開始列 B・終了行を指定）。② はヘッダーのない商品コードの頭文字リストで、前方一致で照合します。',
      tags: ['ヘッダー行', '開始列', '終了行', '前方一致'],
      build() {
        const rand = createRandom(505);
        const grid = [['', '2025年度 商品別売上一覧'], ['', '出力日：2026/04/05　単位：円'], [],
          ['', '商品コード', '商品名', 'カテゴリ', '売上数', '売上金額']];
        let totalQty = 0;
        let totalAmount = 0;
        for (let round = 0; round < 3; round++) {
          PRODUCTS.forEach((p) => {
            const qty = rand.int(5, 400);
            totalQty += qty;
            totalAmount += qty * p.price;
            grid.push(['', p.code + '-' + (round + 1), p.name, p.cat, withNumber(qty), withNumber(qty * p.price)]);
          });
        }
        grid.push(['', '合計', '', '', withNumber(totalQty), withNumber(totalAmount)]);
        const endRow = grid.length - 1;
        return {
          source: { name: 'サンプル_売上帳票.xlsx', grid: grid, settings: { hasHeader: true, headerRow: 4, startRow: 5, startCol: 2, endRow: endRow } },
          profiles: [{
            name: 'コードの頭文字',
            condition: { name: 'サンプル_コード一覧.txt', grid: [['A-1'], ['B-2'], ['D-4']], settings: { hasHeader: false, headerRow: 1, startRow: 1, startCol: 1, endRow: null } },
            query: Q([C('商品コード', 'startsWith', col('列A'))])
          }],
          output: ['m:profile', 'm:srcRow', 's:商品コード', 's:商品名', 's:カテゴリ', 's:売上数', 's:売上金額']
        };
      }
    },
    {
      id: 'ngword',
      icon: 'ban',
      title: 'NG ワードを含む行を除外',
      desc: '② の NG ワードを商品名・備考のいずれかに含む行を除き、残りを出力します（出力する行＝一致しなかった行）。',
      tags: ['一致しなかった行', 'いずれか満たす'],
      build() {
        return {
          source: { name: ORDERS_NAME, grid: orders(606) },
          profiles: [{
            name: 'NG ワード除外',
            condition: { name: 'サンプル_NGワード.csv', grid: [['NGワード'], ['試作'], ['テスト'], ['中古']] },
            query: Q([C('商品名', 'contains', col('NGワード')), C('備考', 'contains', col('NGワード'))], { logic: { mode: 'or', expr: '' }, joinKind: 'anti' })
          }],
          output: ['m:profile', 's:受注番号', 's:受注日', 's:顧客名', 's:商品名', 's:備考', 's:金額']
        };
      }
    },
    {
      id: 'priority',
      icon: 'arrow-down-1-9',
      title: '列の違う 3 つの抽出条件を優先順位で振り分け',
      desc: '列の構成が違う 3 つの ②（顧客 ID／地域と下限金額／NG ワード）を使い、1 位「重点顧客」→ 2 位「地域キャンペーン」→ 3 位「NG ワード要確認」の順に振り分けます。どれにも該当しない行は「該当なし」として出力します。',
      tags: ['複数の抽出条件', '優先順位', '振り分け', '該当なし'],
      build() {
        const vip = [['顧客ID', 'ランク'], ['C0012', 'A'], ['C0045', 'A'], ['C0078', 'A'], ['C0101', 'B'], ['C0133', 'B'],
          ['C0150', 'A'], ['C0177', 'B'], ['C0202', 'B'], ['C0230', 'A'], ['C0256', 'B']];
        const region = [['地域', '下限金額', '担当者'], ['東京', '30000', '佐藤'], ['大阪', '20000', '鈴木']];
        const ng = [['NGワード', '理由'], ['試作', '未発売'], ['中古', '品質確認'], ['テスト', 'テスト発注']];
        return {
          source: { name: ORDERS_NAME, grid: orders(808) },
          profiles: [
            { name: '重点顧客', condition: { name: 'サンプル_重点顧客.xlsx', grid: vip }, query: Q([C('顧客ID', 'eq', col('顧客ID'))]) },
            { name: '地域キャンペーン', condition: { name: 'サンプル_地域キャンペーン.csv', grid: region },
              query: Q([C('地域', 'eq', col('地域')), C('金額', 'gte', col('下限金額'))]) },
            { name: 'NG ワード要確認', condition: { name: 'サンプル_NGワード.csv', grid: ng },
              query: Q([C('商品名', 'contains', col('NGワード')), C('備考', 'contains', col('NGワード'))], { logic: { mode: 'or', expr: '' } }) }
          ],
          combine: { mode: 'assign', includeUnmatched: true },
          output: ['m:profile', 's:受注番号', 's:受注日', 's:顧客ID', 's:地域', 's:商品名', 's:金額', 's:備考', 'c:ランク', 'c:担当者', 'c:理由']
        };
      }
    },
    {
      id: 'independent',
      icon: 'clone',
      title: '抽出条件ごとに独立して抽出（シート分け出力）',
      desc: '同じ受注が複数の抽出条件に該当しても、それぞれの結果に入れます。「大口受注」は ② を使わない固定値だけの抽出条件です。Excel 出力では「まとめ」と抽出条件ごとのシートに分けられます。',
      tags: ['それぞれに出力', '重複あり', '固定値', 'シート分け'],
      build() {
        const usb = [['キーワード', '分類'], ['USB', '周辺機器'], ['ケーブル', '周辺機器']];
        const area = [['地域', '重点理由'], ['福岡', '新店舗'], ['札幌', '販促強化']];
        return {
          source: { name: ORDERS_NAME, grid: orders(909) },
          profiles: [
            { name: 'USB 関連商品', condition: { name: 'サンプル_キーワード.csv', grid: usb }, query: Q([C('商品名', 'contains', col('キーワード'))]) },
            { name: '大口受注', condition: null, query: Q([C('数量', 'gte', fixed('15'))]) },
            { name: '重点地域', condition: { name: 'サンプル_重点地域.csv', grid: area }, query: Q([C('地域', 'eq', col('地域'))]) }
          ],
          combine: { mode: 'independent', includeUnmatched: false },
          output: ['m:profile', 's:受注番号', 's:受注日', 's:地域', 's:商品名', 's:数量', 's:金額', 'c:分類', 'c:重点理由']
        };
      }
    },
    {
      id: 'rules',
      icon: 'spell-check',
      title: '抽出条件ごとに照合ルールを変える',
      desc: '同じ ② の会員番号を、1 位「ゆるく照合」は全体の設定（初期値：00123＝123、ABC-01＝abc-01＝ＡＢＣ－０１）で、2 位「厳密に照合」は個別の設定（空白・全角半角・大小文字を区別し、数値も文字で比較）で照合します。それぞれに出力するので違いを並べて確かめられます。',
      tags: ['照合ルール', '抽出条件ごとの設定', 'それぞれに出力'],
      build() {
        const members = [['会員番号', '氏名', '区分', '入会日'],
          ['00123', '青木 花子', '一般', '2024/04/01'], ['123', '石川 太郎', '一般', '2024/05/12'], ['0123', '上田 次郎', 'ゴールド', '2024/06/03'],
          ['00456', '遠藤 三郎', '一般', '2024/07/21'], ['456', '大野 桜', 'ゴールド', '2024/08/08'],
          ['ABC-01', '加藤 翼', '法人', '2024/09/15'], ['abc-01', '木村 蓮', '法人', '2024/10/02'], ['ＡＢＣ－０１', '小林 陽菜', '法人', '2024/11/11'],
          ['XYZ-9', '斎藤 湊', '法人', '2024/12/24'], ['xyz-9', '佐々木 結衣', '法人', '2025/01/06'],
          ['0789', '清水 大和', '一般', '2025/02/14'], ['789', '高田 美咲', 'ゴールド', '2025/03/03'], [' 789 ', '田村 悠真', '一般', '2025/03/30'],
          ['DEF-2', '中島 杏', '一般', '2025/04/18'], ['01000', '西村 陸', '一般', '2025/05/05']];
        const target = [['対象会員番号', 'メモ'], ['00123', 'ゼロ埋め 5 桁'], ['00456', 'ゼロ埋め 5 桁'], ['ABC-01', '英字は大文字・半角'], ['789', 'ゼロ埋めなし']];
        const cond = () => ({ name: 'サンプル_対象会員番号.csv', grid: target });
        const query = () => Q([C('会員番号', 'eq', col('対象会員番号'))]);
        return {
          source: { name: 'サンプル_会員データ.xlsx', grid: members },
          profiles: [
            { name: 'ゆるく照合', condition: cond(), query: query() },
            { name: '厳密に照合', condition: cond(), query: query(), rules: { space: 'keep', width: false, caseless: false, numeric: false, date: false } }
          ],
          combine: { mode: 'independent', includeUnmatched: false },
          output: ['m:profile', 's:会員番号', 's:氏名', 's:区分', 'c:対象会員番号', 'c:メモ']
        };
      }
    },
    {
      id: 'wildcard',
      icon: 'asterisk',
      title: '「*」のワイルドカードで取引先を抽出',
      desc: '② の顧客名に「青木*」（前方一致）・「*電機」（後方一致）・「*物*」（含む）・「石*所」（途中）・「＊食品」（全角）のような「*」があると、完全一致でもワイルドカードとして当てはめます。「*」のない行はふつうの完全一致です。',
      tags: ['完全一致', 'ワイルドカード', '照合ルール'],
      build() {
        const cond = [['顧客名', '担当', 'メモ'],
          ['青木*', '東日本チーム', '前方一致：青木で始まる'], ['*電機', '家電チーム', '後方一致：電機で終わる'],
          ['*物*', '商社チーム', '含む：物を含む'], ['石*所', '製造チーム', '途中：石で始まり所で終わる'],
          ['＊食品', '食品チーム', '全角の＊も使える'], ['山口商事', '西日本チーム', '* なし：ふつうの完全一致']];
        return {
          source: { name: ORDERS_NAME, grid: orders(1010) },
          profiles: [{ name: '担当チームの取引先', condition: { name: 'サンプル_取引先パターン.csv', grid: cond }, query: Q([C('顧客名', 'eq', col('顧客名'))]) }],
          output: ['s:受注番号', 's:受注日', 's:顧客名', 'c:顧客名', 'c:担当', 'c:メモ', 's:商品名', 's:金額']
        };
      }
    },
    {
      id: 'dates',
      icon: 'calendar-days',
      title: '日付の範囲・期間で抽出',
      desc: '受注日で「上期（2025/04/01〜2025/09/30）」を範囲で、「2025年12月」を期間で抽出します。「キャンペーン期間」は ② の地域ごとの開始日〜終了日で判定し、空欄の側は制限なし（大阪は 11/1 以降、福岡は 6/30 まで）です。',
      tags: ['範囲（から〜まで）', '期間（年月）', '② の開始日・終了日', 'それぞれに出力'],
      build() {
        const campaign = [['地域', '開始日', '終了日', 'キャンペーン'],
          ['東京', '2025/05/01', '2025/05/31', '初夏セール'], ['大阪', '2025/11/01', '', '秋冬フェア（終了日なし）'], ['福岡', '', '2025/06/30', '開業記念（開始日なし）']];
        return {
          source: { name: ORDERS_NAME, grid: orders(1111) },
          profiles: [
            { name: '上期（4〜9月）', condition: null, query: Q([C('受注日', 'between', fixedRange('2025/04/01', '2025/09/30'))]) },
            { name: '2025年12月', condition: null, query: Q([C('受注日', 'period', fixed('2025/12'))]) },
            { name: 'キャンペーン期間', condition: { name: 'サンプル_キャンペーン期間.csv', grid: campaign },
              query: Q([C('地域', 'eq', col('地域')), C('受注日', 'between', cols('開始日', '終了日'))]) }
          ],
          combine: { mode: 'independent', includeUnmatched: false },
          output: ['m:profile', 's:受注番号', 's:受注日', 's:地域', 's:商品名', 's:金額', 'c:キャンペーン', 'c:開始日', 'c:終了日']
        };
      }
    },
    {
      id: 'aggregate',
      icon: 'calculator',
      title: '抽出結果を地域ごとに集計（ピボット：件数・合計・平均・標準偏差）',
      desc: '上期（2025/04/01〜2025/09/30）の受注を抽出し、ピボットで地域ごとの件数・金額の合計・平均・標準偏差、最初と最後の受注日を求め、合計金額の大きい順に並べます。左の「ピボット」で項目を押したり、ドラッグしたりして変えられます。',
      tags: ['ピボット', 'グループごと', '並べ替え', '範囲'],
      build() {
        return {
          source: { name: ORDERS_NAME, grid: orders(1212) },
          profiles: [{ name: '上期の受注', condition: null, query: Q([C('受注日', 'between', fixedRange('2025/04/01', '2025/09/30'))]) }],
          output: ORDER_HEADER.map((h) => 's:' + h),
          aggregate: {
            rows: [{ key: 's:地域' }],
            values: [{ fn: 'count' }, { key: 's:金額', fn: 'sum' }, { key: 's:金額', fn: 'avg' }, { key: 's:金額', fn: 'stdev' },
              { key: 's:受注日', fn: 'min' }, { key: 's:受注日', fn: 'max' }],
            sort: { by: 'value', dir: 'desc', value: 1 }
          },
          tab: 'aggregate'
        };
      }
    },
    {
      id: 'condagg',
      icon: 'list-check',
      title: '② の顧客ごとに件数・金額を出す（ピボットの「② の行」）',
      desc: '② の重点顧客リストの 1 行ごとに、受注の件数・金額の合計・平均をピボットに出し、合計金額の大きい順に並べます。受注が 0 件の顧客（C9999）も 0 件として表に出ます。行に「② の行」を置くだけで、列を選ぶ必要はありません。',
      tags: ['ピボット', '② の行', '0 件の行も出す', '並べ替え'],
      build() {
        const cond = [['顧客ID', '担当', '重点理由'],
          ['C0012', '佐藤', '大口'], ['C0045', '鈴木', '新規'], ['C0078', '佐藤', '休眠復活'], ['C0101', '高橋', '大口'],
          ['C0150', '鈴木', '重点'], ['C0202', '高橋', '新規'], ['C9999', '佐藤', '取引予定（受注なし）']];
        return {
          source: { name: ORDERS_NAME, grid: orders(1313) },
          profiles: [{ name: '重点顧客', condition: { name: 'サンプル_重点顧客.csv', grid: cond }, query: Q([C('顧客ID', 'eq', col('顧客ID'))]) }],
          output: ['s:受注番号', 's:受注日', 's:顧客ID', 's:顧客名', 's:金額', 'c:担当'],
          aggregate: {
            rows: [{ key: 'x:condRow' }],
            values: [{ fn: 'count' }, { key: 's:金額', fn: 'sum' }, { key: 's:金額', fn: 'avg' }],
            sort: { by: 'value', dir: 'desc', value: 1 }
          },
          tab: 'aggregate'
        };
      }
    },
    {
      id: 'pivot',
      icon: 'table-cells',
      title: 'ピボット：地域 × 月の売上（② を使わずに ① だけで作る）',
      desc: '① 元データの全行で、行に「地域」、列に「受注日（月）」、値に「金額の合計」を置いたピボットです。日付は月ごとにまとまります。タグの ▾ で「曜日」「四半期」などに変えたり、値を「総計に対する %」にしたりできます。セルをダブルクリックすると内訳が出ます。',
      tags: ['ピボット', '行 × 列', '日付のまとめ方', '① だけ'],
      build() {
        return {
          source: { name: ORDERS_NAME, grid: orders(1515) },
          profiles: [],
          output: ORDER_HEADER.map((h) => 's:' + h),
          aggregate: {
            target: 'source',
            rows: [{ key: 's:地域' }],
            cols: [{ key: 's:受注日', grain: 'month' }],
            values: [{ key: 's:金額', fn: 'sum' }],
            sort: { by: 'value', dir: 'desc', value: 0 }
          },
          tab: 'aggregate'
        };
      }
    },
    {
      id: 'chart-trend',
      icon: 'chart-line',
      title: 'グラフ：月ごとの売上の推移・商品ごとの売上・パレート図（3 枚）',
      desc: '① 元データの全行から、受注日（月）× 地域の金額の合計を折れ線に、商品ごとの金額の合計を横棒（上位 10 件＋その他）に、顧客ごとの金額をパレート図（上位 30 件＋その他。累積 80% までを A）にします。グラフタブ上の「表示するグラフ」で切り替え、右上の「一覧」で並べて見られます。',
      tags: ['グラフ', '折れ線', '横棒', 'パレート図'],
      build() {
        return {
          source: { name: ORDERS_NAME, grid: orders(1616) },
          profiles: [],
          output: ORDER_HEADER.map((h) => 's:' + h),
          charts: {
            items: [
              { id: 'smp-chart-trend', name: '月ごとの売上（地域別）', target: 'source', type: 'line', typeLocked: true,
                slots: { x: [{ key: 's:受注日', grain: 'month' }], y: [{ key: 's:金額', fn: 'sum' }], color: [{ key: 's:地域' }] } },
              { id: 'smp-chart-top', name: '商品ごとの売上（上位 10 件）', target: 'source', type: 'hbar', typeLocked: true,
                slots: { x: [{ key: 's:商品名' }], y: [{ key: 's:金額', fn: 'sum' }] }, opts: { top: 10 } },
              { id: 'smp-chart-pareto', name: '顧客ごとの売上（パレート図）', target: 'source', type: 'pareto', typeLocked: true,
                slots: { x: [{ key: 's:顧客名' }], y: [{ key: 's:金額', fn: 'sum' }] } }
            ],
            activeId: 'smp-chart-trend'
          },
          tab: 'chart'
        };
      }
    },
    {
      id: 'chart-dist',
      icon: 'chart-simple',
      title: 'グラフ：金額の分布を 3 つの見方で（ヒストグラム・箱ひげ／バイオリン・累積分布を一覧で）',
      desc: '金額をきりのよい幅の区間に分けて件数を数え、平均と中央値の線を引きます。2 枚目はカテゴリごとの金額を、バイオリン（分布の形）の中に箱ひげ（中央値・四分位・外れ値）を描いて比べます。3 枚目は地域ごとの累積分布で、線が右にあるほど金額が大きい側に寄っています。3 枚を「一覧」で並べて開きます。棒や箱を押すと、そこに入った受注が出ます。',
      tags: ['グラフ', 'ヒストグラム', '箱ひげ', '累積分布', '一覧'],
      build() {
        return {
          source: { name: ORDERS_NAME, grid: orders(1717) },
          profiles: [],
          output: ORDER_HEADER.map((h) => 's:' + h),
          charts: {
            items: [
              { id: 'smp-chart-hist', name: '', target: 'source', type: 'hist', typeLocked: true, slots: { x: [{ key: 's:金額' }] }, opts: { lines: true } },
              { id: 'smp-chart-box', name: '', target: 'source', type: 'box', typeLocked: true,
                slots: { y: [{ key: 's:金額' }], x: [{ key: 's:カテゴリ' }] }, opts: { shape: 'both', groupSort: 'median' } },
              { id: 'smp-chart-ecdf', name: '', target: 'source', type: 'ecdf', typeLocked: true,
                slots: { x: [{ key: 's:金額' }], color: [{ key: 's:地域' }] }, opts: { lines: true } }
            ],
            activeId: 'smp-chart-hist',
            view: 'grid'
          },
          tab: 'chart'
        };
      }
    },
    {
      id: 'chart-scatter',
      icon: 'braille',
      title: 'グラフ：数量と金額の関係（散布図・回帰直線・相関係数／バブル図・範囲選択）',
      desc: '1 受注＝1 点で、横軸に数量、縦軸に金額を置き、カテゴリで色分けします（4 つ目以降は「その他」）。回帰直線を引き、相関係数 r と R² を題名の下に出します。2 枚目のバブル図は、単価を円の大きさにします。点を押すとその受注、グラフの中をドラッグして範囲を囲むと、その中の受注が出ます（外れ値の確認に便利です）。',
      tags: ['グラフ', '散布図', 'バブル図', '範囲選択'],
      build() {
        return {
          source: { name: ORDERS_NAME, grid: orders(1818) },
          profiles: [],
          output: ORDER_HEADER.map((h) => 's:' + h),
          charts: {
            items: [
              { id: 'smp-chart-scatter', name: '', target: 'source', type: 'scatter', typeLocked: true,
                slots: { x: [{ key: 's:数量' }], y: [{ key: 's:金額' }], color: [{ key: 's:カテゴリ' }] }, opts: { trend: true } },
              { id: 'smp-chart-bubble', name: '', target: 'source', type: 'bubble', typeLocked: true,
                slots: { x: [{ key: 's:数量' }], y: [{ key: 's:金額' }], size: [{ key: 's:単価' }], color: [{ key: 's:カテゴリ' }] }, opts: { logy: true } }
            ],
            activeId: 'smp-chart-scatter'
          },
          tab: 'chart'
        };
      }
    },
    {
      id: 'chart-pivot',
      icon: 'table-columns',
      title: 'グラフ：ピボットを表とグラフで並べて見る（地域 × カテゴリ）',
      desc: 'ピボット（行：地域、列：カテゴリ、値：金額の合計）を、左に表・右にグラフで並べます。グラフは表の形から「おすすめ」を選び、系列が 4 つまでなので並べた棒にします。棒にポイントすると表の対応するセルが光ります。上の「積み上げ」「100%」「行と列を入れ替え」で見方を変えられます。',
      tags: ['グラフ', 'ピボット', '並べて表示', '積み上げ'],
      build() {
        return {
          source: { name: ORDERS_NAME, grid: orders(1919) },
          profiles: [],
          output: ORDER_HEADER.map((h) => 's:' + h),
          aggregate: {
            target: 'source',
            rows: [{ key: 's:地域' }],
            cols: [{ key: 's:カテゴリ' }],
            values: [{ key: 's:金額', fn: 'sum' }],
            sort: { by: 'value', dir: 'desc', value: 0 }
          },
          charts: { items: [], activeId: null, pivot: { view: 'split', type: 'auto', arrange: 'auto' } },
          tab: 'aggregate'
        };
      }
    },
    {
      id: 'derive',
      icon: 'right-left',
      title: '列の追加：読み替え（マスタ）と計算',
      desc: '① に「大分類」（カテゴリを対応表で読み替え：文具 ⇒ 事務用品 など、対応表にない値は「その他」）と「税込金額」（ROUND([金額]×1.1, 0)）、「1 個あたり税込」（[税込金額]÷[数量]）の列を加え、大分類ごとに集計します。① の読み込みパネルの「列を追加」で中身を確かめられます。',
      tags: ['読み替え', '計算', 'マスタ', '集計'],
      build() {
        return {
          source: { name: ORDERS_NAME, grid: orders(1414) },
          profiles: [{ name: '税込 1 万円以上', condition: null, query: Q([C('税込金額', 'gte', fixed('10000'))]) }],
          derived: {
            source: [
              { id: 'smp-map', kind: 'map', name: '大分類', from: 'カテゴリ', rows: [['文具', '事務用品'], ['家電', '電化製品'], ['食品', '飲食']], unmatched: 'value', value: 'その他' },
              { id: 'smp-tax', kind: 'calc', name: '税込金額', expr: 'ROUND([金額]×1.1, 0)' },
              { id: 'smp-unit', kind: 'calc', name: '1 個あたり税込', expr: 'ROUND([税込金額]÷[数量], 1)' }
            ],
            condition: []
          },
          output: ['s:受注番号', 's:受注日', 's:カテゴリ', 's:大分類', 's:数量', 's:金額', 's:税込金額', 's:1 個あたり税込'],
          aggregate: { rows: [{ key: 's:大分類' }], values: [{ fn: 'count' }, { key: 's:税込金額', fn: 'sum' }, { key: 's:税込金額', fn: 'avg' }], sort: { by: 'value', dir: 'desc', value: 1 } }
        };
      }
    },
    {
      id: 'criteria',
      icon: 'greater-than-equal',
      title: '② の値に >= や <> を書いて比べる（Excel の COUNTIF と同じ書き方）',
      desc: '比較方法は「完全一致」のまま、② の値に「>=30000」「<>食品」「<2025/07/01」のように比較演算子を書いて判定します。1 行目は家電で金額 30,000 以上、2 行目は食品以外で 2025/07/01 より前、3 行目は数量 = 20（ちょうど 20 個）の受注です。',
      tags: ['完全一致', '比較演算子', '>=', '<>'],
      build() {
        const cond = [['カテゴリ', '金額', '受注日', '数量', 'メモ'],
          ['家電', '>=30000', '', '', '家電の大口'], ['<>食品', '', '<2025/07/01', '', '食品以外の上期前半'], ['', '', '', '=20', 'ちょうど 20 個']];
        const eq = (name) => C(name, 'eq', col(name));
        return {
          source: { name: ORDERS_NAME, grid: orders(1515) },
          profiles: [{ name: '比較演算子で判定', condition: { name: 'サンプル_比較演算子.csv', grid: cond }, query: Q([eq('カテゴリ'), eq('金額'), eq('受注日'), eq('数量')], { matchMode: 'first' }) }],
          output: ['s:受注番号', 's:受注日', 's:カテゴリ', 's:数量', 's:金額', 'c:メモ']
        };
      }
    },
    {
      id: 'union',
      icon: 'layer-group',
      title: '前処理：毎月のファイルを縦に結合して重複を除く',
      desc: '4 月・5 月・6 月の受注ファイルを 1 つの表にまとめます。5 月は見出しが 3 行目（上に表題）、6 月は列の並びが違い「担当者」列が増えていますが、列は名前でそろえ、見出しの位置は自動で判定します。月をまたいで再送された受注（20 行）は「受注番号」での重複の削除で除きます。メインの ① タブの「処理の流れ」で各段の行数を、除いた行数を押すとその行を確かめられます。ピボットは元ファイルごとの件数と金額です。',
      tags: ['縦に結合', '重複の削除', '処理の流れ', '① だけ'],
      build() {
        const m = monthlyOrders();
        return {
          source: {
            name: 'サンプル_受注_2025年4月.csv', grid: m.apr,
            members: [{ name: 'サンプル_受注_2025年5月.csv', grid: m.may }, { name: 'サンプル_受注_2025年6月.csv', grid: m.jun }],
            dedup: { cols: ['受注番号'] }
          },
          profiles: [],
          output: m.columns.map((h) => 's:' + h).concat(['s:元ファイル']),
          aggregate: {
            target: 'source',
            rows: [{ key: 's:元ファイル' }],
            values: [{ fn: 'count' }, { key: 's:金額', fn: 'sum' }],
            sort: { by: 'label', dir: 'asc' }
          },
          tab: 'source'
        };
      }
    },
    {
      id: 'perf',
      icon: 'gauge-high',
      title: '10 万行で速度を確認',
      desc: '① 100,000 行 × ② 1,000 行。完全一致の索引で候補を絞り込み、進捗を表示しながら抽出します。',
      tags: ['10 万行', '進捗表示'],
      build() {
        const rand = createRandom(707);
        const customers = makeCustomers(20000, 5, rand);
        const columns = ['受注番号', '受注日', '顧客ID', '地域', '商品名', '数量', '金額'];
        const grid = makeOrders(100000, customers, rand, columns);
        const picked = new Set();
        while (picked.size < 1000) picked.add(rand.pick(customers).id);
        const cond = [['顧客ID']].concat(Array.from(picked).map((id) => [id]));
        return {
          source: { name: 'サンプル_受注10万行.csv', grid: grid },
          profiles: [{
            name: '顧客 1,000 件',
            condition: { name: 'サンプル_顧客1000件.csv', grid: cond },
            query: Q([C('顧客ID', 'eq', col('顧客ID')), C('金額', 'gte', fixed('10,000'))])
          }],
          output: ['m:profile'].concat(columns.map((h) => 's:' + h))
        };
      }
    }
  ];

  /* サンプルの一覧の見出し（目的ごと）。ここにない id は「その他」に入る */
  const GROUPS = [
    { label: '基本の抽出', icon: 'play', ids: ['idlist', 'threshold', 'exclude', 'logic', 'report', 'ngword'] },
    { label: '比べ方の書き方（ワイルドカード・比較演算子・日付）', icon: 'equals', ids: ['wildcard', 'criteria', 'dates'] },
    { label: '複数の抽出条件', icon: 'arrow-down-1-9', ids: ['priority', 'independent', 'rules'] },
    { label: 'ピボット', icon: 'table-cells', ids: ['aggregate', 'condagg', 'pivot'] },
    { label: 'グラフ', icon: 'chart-column', ids: ['chart-trend', 'chart-dist', 'chart-scatter', 'chart-pivot'] },
    { label: '前処理（縦に結合・列の追加・重複の削除）', icon: 'layer-group', ids: ['union', 'derive'] },
    { label: 'その他（速度の確認）', icon: 'ellipsis', ids: ['perf'] }
  ];

  const Samples = {
    /** 目的ごとの見出しと、その中のサンプル（list() と同じ形） */
    groups() {
      const all = Samples.list();
      const used = new Set();
      const out = GROUPS.map((g) => {
        const items = g.ids.map((id) => all.find((s) => s.id === id)).filter(Boolean);
        items.forEach((s) => used.add(s.id));
        return { label: g.label, icon: g.icon, items: items };
      });
      const rest = all.filter((s) => !used.has(s.id));
      if (rest.length) out[out.length - 1].items = out[out.length - 1].items.concat(rest);
      return out.filter((g) => g.items.length);
    },

    list() {
      return SAMPLES.map((s) => ({ id: s.id, icon: s.icon, title: s.title, desc: s.desc, tags: s.tags.slice() }));
    },

    get(id) {
      return SAMPLES.find((s) => s.id === id) || null;
    },

    /** @returns {{id, title, source:{name,grid,settings?,members?:Array<{name,grid}>,dedup?}, profiles:Array<{name, condition:{name,grid,settings?}|null, query, rules?}>, combine?, output:string[]}} */
    build(id) {
      const sample = Samples.get(id);
      if (!sample) throw new Error('サンプルが見つかりません');
      const built = sample.build();
      built.id = sample.id;
      built.title = sample.title;
      return built;
    }
  };

  LQ.Samples = Samples;
})(window);
