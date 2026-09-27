/* =========================================================================
 * LightQuery - lq-samples.js
 * 動作確認用のサンプルデータ（7 パターン）。値は乱数の種を固定して毎回同じものを生成する。
 *   build() は ① / ② の grid・読み込み設定・条件・出力列の初期値を返す。
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

  const SAMPLES = [
    {
      id: 'idlist',
      icon: 'id-card',
      title: '顧客 ID のリストで抽出',
      desc: '② の顧客 ID と完全一致する受注を抽出します。全角・小文字・前後の空白が混じった ID も照合ルールで一致します。',
      tags: ['完全一致', '照合ルール'],
      build() {
        const rand = createRandom(101);
        const customers = makeCustomers(300, 4, rand);
        const orders = makeOrders(2000, customers, rand);
        const cond = [['顧客ID', 'メモ'],
          ['Ｃ００１２', '全角で入力'], ['c0045', '小文字で入力'], [' C0078 ', '前後に空白'], ['C0101', ''],
          ['C0133', ''], ['C0150', '重点顧客'], ['C0177', ''], ['C0202', ''], ['C0230', '新規'], ['C0256', ''],
          ['C0288', ''], ['C9999', '該当なし（受注なし）']];
        return {
          source: { name: 'サンプル_受注データ.xlsx', grid: orders },
          condition: { name: 'サンプル_抽出対象顧客.csv', grid: cond },
          query: { conditions: [C('顧客ID', 'eq', col('顧客ID'))], logic: { mode: 'and', expr: '' } },
          output: ORDER_HEADER.map((h) => 's:' + h).concat(['c:メモ'])
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
        const rand = createRandom(202);
        const customers = makeCustomers(300, 4, rand);
        const orders = makeOrders(2000, customers, rand);
        const cond = [['地域', '下限金額', '担当者'], ['東京', '50,000', '佐藤'], ['大阪', '30000', '鈴木'], ['名古屋', '20000', '高橋'], ['福岡', '', '田中']];
        return {
          source: { name: 'サンプル_受注データ.xlsx', grid: orders },
          condition: { name: 'サンプル_地域別基準.csv', grid: cond },
          query: {
            conditions: [C('地域', 'eq', col('地域')), C('金額', 'gte', col('下限金額'))],
            logic: { mode: 'and', expr: '' }
          },
          output: ['s:受注番号', 's:受注日', 's:顧客名', 's:地域', 's:商品名', 's:金額', 'c:担当者', 'c:下限金額', 'm:condRow']
        };
      }
    },
    {
      id: 'exclude',
      icon: 'filter',
      title: 'キーワードを含み、除外語を含まない',
      desc: 'A：商品名がキーワードを含む かつ B：商品名が除外語を含まない かつ C：備考が除外語を含まない。② の行ごとに判定します。',
      tags: ['含む', '含まない'],
      build() {
        const rand = createRandom(303);
        const customers = makeCustomers(300, 4, rand);
        const orders = makeOrders(2000, customers, rand);
        const cond = [['キーワード', '除外語', '用途'], ['USB', '中古', '周辺機器'], ['ペン', '試作', '筆記具'], ['コーヒー', '', '飲料']];
        return {
          source: { name: 'サンプル_受注データ.xlsx', grid: orders },
          condition: { name: 'サンプル_キーワード.csv', grid: cond },
          query: {
            conditions: [C('商品名', 'contains', col('キーワード')), C('商品名', 'notContains', col('除外語')), C('備考', 'notContains', col('除外語'))],
            logic: { mode: 'and', expr: '' }
          },
          output: ['s:受注番号', 's:受注日', 's:商品名', 's:備考', 's:金額', 'c:キーワード', 'c:用途']
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
        const rand = createRandom(404);
        const customers = makeCustomers(300, 4, rand);
        const orders = makeOrders(2000, customers, rand);
        const cond = [['キーワード', '開始日'], ['USB', '2025/06/01'], ['ケーブル', '2025/09/01'], ['コーヒー', '']];
        return {
          source: { name: 'サンプル_受注データ.xlsx', grid: orders },
          condition: { name: 'サンプル_キャンペーン.csv', grid: cond },
          query: {
            conditions: [C('商品名', 'contains', col('キーワード')), C('備考', 'contains', col('キーワード')),
              C('受注日', 'gte', col('開始日')), C('数量', 'gte', fixed('5'))],
            logic: { mode: 'expr', expr: '(A or B) and C and D' },
            matchMode: 'all'
          },
          output: ['s:受注番号', 's:受注日', 's:商品名', 's:備考', 's:数量', 'c:キーワード', 'c:開始日', 'm:count']
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
          condition: { name: 'サンプル_コード一覧.txt', grid: [['A-1'], ['B-2'], ['D-4']], settings: { hasHeader: false, headerRow: 1, startRow: 1, startCol: 1, endRow: null } },
          query: { conditions: [C('商品コード', 'startsWith', col('列A'))], logic: { mode: 'and', expr: '' } },
          output: ['m:srcRow', 's:商品コード', 's:商品名', 's:カテゴリ', 's:売上数', 's:売上金額']
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
        const rand = createRandom(606);
        const customers = makeCustomers(300, 4, rand);
        const orders = makeOrders(2000, customers, rand);
        return {
          source: { name: 'サンプル_受注データ.xlsx', grid: orders },
          condition: { name: 'サンプル_NGワード.csv', grid: [['NGワード'], ['試作'], ['テスト'], ['中古']] },
          query: {
            conditions: [C('商品名', 'contains', col('NGワード')), C('備考', 'contains', col('NGワード'))],
            logic: { mode: 'or', expr: '' },
            joinKind: 'anti'
          },
          output: ['s:受注番号', 's:受注日', 's:顧客名', 's:商品名', 's:備考', 's:金額']
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
        const orders = makeOrders(100000, customers, rand, columns);
        const picked = new Set();
        while (picked.size < 1000) picked.add(rand.pick(customers).id);
        const cond = [['顧客ID']].concat(Array.from(picked).map((id) => [id]));
        return {
          source: { name: 'サンプル_受注10万行.csv', grid: orders },
          condition: { name: 'サンプル_顧客1000件.csv', grid: cond },
          query: { conditions: [C('顧客ID', 'eq', col('顧客ID')), C('金額', 'gte', fixed('10,000'))], logic: { mode: 'and', expr: '' } },
          output: columns.map((h) => 's:' + h)
        };
      }
    }
  ];

  const Samples = {
    list() {
      return SAMPLES.map((s) => ({ id: s.id, icon: s.icon, title: s.title, desc: s.desc, tags: s.tags.slice() }));
    },

    get(id) {
      return SAMPLES.find((s) => s.id === id) || null;
    },

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
