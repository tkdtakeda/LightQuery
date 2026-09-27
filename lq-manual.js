/* =========================================================================
 * LightQuery - lq-manual.js
 * 取扱説明書（モーダル）。「使い方」ボタンで表示／非表示を切り替え、起動時に表示するかを選べる。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Dom = LQ.Dom;
  const h = Dom.h;
  const I = (name) => Dom.iconHtml(name);

  const SECTIONS = [
    { id: 'start', icon: 'flag-checkered', title: 'はじめに', html: `
      <p>LightQuery は、<strong>① 元データ</strong>の各行を <strong>② 条件データ</strong>の各行と照らし合わせ、条件に一致した行を取り出す簡易クエリです。Excel の VLOOKUP や Power Query の「結合」に近い動きをします。</p>
      <ol>
        <li><strong>① 元データ</strong>を読み込む（抽出される側）</li>
        <li><strong>② 条件データ</strong>を読み込む（条件の一覧。1 行＝1 セットの条件）</li>
        <li>左の「条件」で、① のどの列を ② のどの列と、どの比較方法で比べるかを決める</li>
        <li>画面右上の青いボタン（例：「12,345 行から抽出する」）を押す</li>
        <li>結果を確認し、同じボタン（「1,234 行を出力する」）で Excel・CSV に出力する</li>
      </ol>
      <div class="lq-note lq-note--tip">${I('lightbulb')}<div class="lq-note__body">次にすることは、いつも<strong>画面右上のボタン</strong>が示します。迷ったらそこを見てください。まずは左下の「サンプル」で動きを確かめるのがおすすめです。</div></div>
      <h3>画面の見方</h3>
      <table>
        <tr><th>上部バー</th><td>読み込んだ ①・② のファイル名と行数、次にすることの説明、主要ボタン、使い方、その他の操作（${I('ellipsis-vertical')}）</td></tr>
        <tr><th>左のアイコン</th><td>設定パネルを開きます（① 元データ・② 条件データ・条件・照合ルール・出力列）。もう一度押すと閉じます。パネルを開いたままでも表を操作できます。</td></tr>
        <tr><th>メイン</th><td>タブで「抽出結果」「① 元データ」「② 条件データ」を切り替えて表示します。</td></tr>
      </table>` },
    { id: 'load', icon: 'file-import', title: 'データの読み込み', html: `
      <p>次のどの方法でも読み込めます。</p>
      <ul>
        <li>ファイルを選択（Excel：.xlsx .xlsm .xls .xlsb .ods／テキスト：.csv .tsv .txt）</li>
        <li>ファイルを画面にドラッグ＆ドロップ（① と ② の受け皿が大きく表示されます）</li>
        <li>Excel でセル範囲をコピーして、画面上で <span class="lq-kbd">Ctrl</span>+<span class="lq-kbd">V</span>（読み込み先を選びます。① / ② のパネルを開いていればそちらに入ります）</li>
      </ul>
      <h3>文字コード（CSV）</h3>
      <p>BOM の有無、UTF-8・Shift_JIS・EUC-JP として矛盾なく読めるかを調べて自動で判定し、<strong>判定の根拠</strong>をパネルに表示します。文字化けしている場合は、パネルの「文字コード」を切り替えるとすぐに表示が変わります。</p>
      <h3>読み込み範囲（ヘッダー行・データ開始行・開始列・終了行）</h3>
      <p>タイトル行や空の列がある帳票でも読み込めるよう、ヘッダー行と開始列を自動で判定します。変えたいときは ① / ② のパネルで指定します。</p>
      <table>
        <tr><th>ヘッダー</th><td>列名が書かれた行の有無。「なし」のときの列名は「列A」「列B」…になります。</td></tr>
        <tr><th>ヘッダー行</th><td>列名が書かれた行の番号（Excel の行番号）。</td></tr>
        <tr><th>データ開始行</th><td>データが始まる行。ヘッダー行より下にします（上にすると自動で調整します）。</td></tr>
        <tr><th>開始列</th><td>データが始まる列。「B」または「2」のように入力します。</td></tr>
        <tr><th>終了行</th><td>ここまでを読み込みます。末尾の合計行を除くときに使います。空欄は最後まで。</td></tr>
      </table>
      <p>パネルを開くと、メインの表が元のシートのままの「読み込み範囲」表示になります。<strong>行番号をクリック</strong>するとヘッダー行・開始行・終了行を、<strong>列記号をクリック</strong>すると開始列を指定できます。完全に空の行は自動で除きます。</p>` },
    { id: 'condition', icon: 'filter', title: '条件の作り方', html: `
      <p>左の「条件」パネルで「条件を追加」を押し、1 件ずつ作ります。各条件には A・B・C… の記号が付きます。</p>
      <p>条件は <code>［① の列］ が ［比べる相手］ ［比較方法］</code> の語順で読みます。例：<code>金額 が 下限金額 以上</code></p>
      <h3>比べる相手</h3>
      <ul>
        <li><strong>② の列</strong>：② の各行の値と比べます。</li>
        <li><strong>固定値</strong>：一覧の最後の「✎ 固定値を入力…」を選ぶと、値を直接入力できます（例：数量 が 5 以上）。② がなくても使えます。</li>
      </ul>
      <h3>比較方法</h3>
      <table>
        <tr><th>完全一致</th><td>同じ値（照合ルールに従って空白・全角半角などをそろえてから比べます）</td></tr>
        <tr><th>一致しない</th><td>同じ値ではない</td></tr>
        <tr><th>含む／含まない</th><td>① の値の中に ② の値（語）が含まれる／含まれない</td></tr>
        <tr><th>前方一致／後方一致</th><td>① の値が ② の値で始まる／終わる</td></tr>
        <tr><th>以上／超え／以下／未満</th><td>数値・日付の大小で比べます（例：金額 ≧ 下限金額）。文字どうしは文字の順で比べます。</td></tr>
      </table>
      <h3>② は「1 行＝1 セットの条件」</h3>
      <p>② の行ごとに、すべての条件をまとめて判定し、<strong>いずれかの行</strong>を満たした ① の行が一致になります。</p>
      <table>
        <tr><th>② の例</th><td>東京・50,000・佐藤 ／ 大阪・30,000・鈴木</td></tr>
        <tr><th>条件</th><td>A：地域 が 地域 と完全一致、B：金額 が 下限金額 以上（すべて満たす）</td></tr>
        <tr><th>結果</th><td>東京で 50,000 以上、または大阪で 30,000 以上の行。担当者など ② の列も一緒に出力できます。</td></tr>
      </table>
      <div class="lq-note lq-note--info">${I('circle-info')}<div class="lq-note__body"><strong>② の空欄のセルは、その条件を判定しません。</strong>例えば下限金額が空欄の行は、地域だけで判定します。全部の条件が空欄の行は無視します。</div></div>` },
    { id: 'logic', icon: 'code-branch', title: '組み合わせ（and / or・式）', html: `
      <table>
        <tr><th>すべて満たす</th><td>全条件を満たす（A and B and C）</td></tr>
        <tr><th>いずれか満たす</th><td>どれか 1 つを満たす（A or B or C）</td></tr>
        <tr><th>式で指定</th><td>例：<code>(A or B) and C</code>。入力中に正しさを確かめ、「(A または B) かつ C」と読み下します。</td></tr>
      </table>
      <ul>
        <li>使える語：<code>and</code> <code>or</code> <code>かつ</code> <code>または</code> <code>&amp;</code> <code>|</code> と括弧（全角でも可）</li>
        <li><code>and</code> は <code>or</code> より先に結び付きます（A or B and C は A or (B and C)）。迷ったら括弧を付けてください。</li>
        <li>条件を追加すると式の末尾に「and ＋記号」が加わり、削除すると式から自動で取り除かれます。</li>
        <li>式に入っていない条件は使われません（パネルで薄く表示し、理由を出します）。</li>
      </ul>` },
    { id: 'extract', icon: 'layer-group', title: '抽出のしかた', html: `
      <h3>出力する行</h3>
      <table>
        <tr><th>一致した行（内部結合）</th><td>② のいずれかの行を満たす ① の行。通常はこれを使います。</td></tr>
        <tr><th>一致しなかった行（左反結合）</th><td>② のどの行も満たさない ① の行。<strong>除外リスト</strong>として使うときに選びます。</td></tr>
        <tr><th>すべての行（左外部結合）</th><td>① の全行を出力し、一致した ② の行があればその列を付けます。</td></tr>
      </table>
      <h3>① の 1 行が ② の複数の行に一致したとき</h3>
      <ul>
        <li><strong>最初の 1 行のみ</strong>（初期値）：① の 1 行につき 1 行。② の列は最初に一致した行の値です。</li>
        <li><strong>すべての組み合わせ</strong>：一致した ② の行ごとに 1 行ずつ出力します（① の行が重複します）。</li>
      </ul>
      <div class="lq-note lq-note--tip">${I('lightbulb')}<div class="lq-note__body"><strong>「含まない」だけで NG ワードの一覧を使うと、意図どおりになりません。</strong>② の行ごとに判定するため、「試作品」は「テストを含まない」行に一致してしまいます。「どの語も含まない行」を出すには、比較方法を「含む」にし、出力する行を「一致しなかった行」にします（条件パネルに切り替えボタンが出ます）。「キーワードを含み、かつ除外語を含まない」のように他の条件と組にする使い方は、そのままで意図どおりに動きます。</div></div>` },
    { id: 'rules', icon: 'spell-check', title: '照合ルール', html: `
      <p>比べる前に値をそろえます。左の「照合ルール」で切り替えられ、設定はこのパソコンのブラウザに記憶されます。</p>
      <table>
        <tr><th>空白</th><td>前後の空白を無視（初期値）／すべての空白を無視／区別する</td></tr>
        <tr><th>全角・半角</th><td>区別しない（初期値）：ＡＢＣ＝ABC、１２３＝123、ｱ＝ア</td></tr>
        <tr><th>大文字・小文字</th><td>区別しない（初期値）：abc＝ABC</td></tr>
        <tr><th>数値</th><td>数値として比較（初期値）：1,000＝1000、00123＝123、▲500＝-500。16 桁以上の数字は ID とみなし文字で比べます。</td></tr>
        <tr><th>日付</th><td>日付として比較（初期値）：2024/1/5＝2024-01-05＝2024年1月5日＝令和6年1月5日</td></tr>
      </table>
      <p>先頭の 0 を区別したい ID（00123 と 123 を別物にしたい）ときは、「数値として比較」を切ってください。</p>` },
    { id: 'result', icon: 'table', title: '結果を見る', html: `
      <ul>
        <li>要約に「一致した行数・割合・出力行数・組み合わせ・処理時間」を表示します。「根拠を見る」で条件と処理の内容を確認できます。</li>
        <li>結果の<strong>行番号をクリック</strong>すると、その行が各条件を満たしたかどうか（値つき）を表示します。</li>
        <li>見出しを<strong>クリック</strong>すると並べ替え（昇順 → 降順 → 解除）、<strong>ドラッグ</strong>すると列を移動します。</li>
        <li>条件や照合ルールを変えると、結果に「未反映」と表示されます。右上の「再抽出する」で反映します。</li>
        <li>表示件数（初期値 100 行／ページ）は下のページ送りで変更できます（最大 5,000 行）。</li>
      </ul>
      <h3>出力する列</h3>
      <p>左の「出力列」で、① の列・② の列・根拠（① 行番号・② 行番号・② 一致数）を選び、つまみのドラッグ（または Alt+↑／↓）で並べ替えます。表示と出力は同じ列・同じ順序になります。</p>` },
    { id: 'export', icon: 'file-export', title: '出力する', html: `
      <p>抽出後、右上の「○○ 行を出力する」から形式を選びます。文字化けしやすい環境に合わせて選べるよう、複数の形式を用意しています。</p>
      <table>
        <tr><th>Excel（.xlsx）</th><td>おすすめ。文字化けせず、先頭の 0 や長い数字も残ります。「抽出条件」シートに出どころと条件を記録します。</td></tr>
        <tr><th>CSV UTF-8（BOM 付き）</th><td>Excel 2016 以降でダブルクリックしても文字化けしません。</td></tr>
        <tr><th>CSV Shift_JIS</th><td>古い Excel や社内システム向け。変換できない文字（絵文字など）は「?」にし、件数をお知らせします。</td></tr>
        <tr><th>CSV UTF-8（BOM なし）</th><td>他のシステム・ツールへの取り込み向け。</td></tr>
        <tr><th>テキスト UTF-16</th><td>Excel の「Unicode テキスト」形式（タブ区切り）。</td></tr>
        <tr><th>コピー</th><td>タブ区切りでクリップボードへ。Excel にそのまま貼り付けられます。</td></tr>
      </table>
      <p>CSV で「Excel で開いたときの自動変換を防ぐ」を選ぶと、00123 や 12 桁以上の数字、1/2 のような値を <code>="…"</code> 形式で出力し、Excel での 0 落ち・指数表示・日付化を防ぎます。</p>` },
    { id: 'save', icon: 'floppy-disk', title: '条件設定の保存', html: `
      <p>条件パネル上部の「保存」または ${I('ellipsis-vertical')} メニューから、条件・組み合わせ・抽出のしかた・照合ルール・出力列・読み込み範囲を <code>.json</code> に保存できます（データそのものは含みません）。</p>
      <p>「読込」または .json ファイルを画面にドロップすると適用します。列は<strong>名前</strong>で対応付けるため、列の位置が変わった新しいファイルにもそのまま使えます。見つからない列はパネルに表示します。</p>` },
    { id: 'sample', icon: 'flask', title: 'サンプルデータ', html: `
      <p>左下の「サンプル」から 7 種類のパターンを読み込めます（顧客 ID リスト、地域別の下限金額、含む／含まない、(A or B) and C、帳票形式、NG ワード除外、10 万行の速度確認）。</p>
      <p>サンプルだけを消すときは、サンプルの一覧の下または ${I('ellipsis-vertical')} メニューの「サンプルデータのみクリア」を使います。自分で読み込んだデータは残ります。消去やクリアのあとは、通知の「元に戻す」で戻せます。</p>` },
    { id: 'keys', icon: 'keyboard', title: 'キーボード操作', html: `
      <table>
        <tr><th><span class="lq-kbd">Ctrl</span>+<span class="lq-kbd">Enter</span></th><td>抽出する／出力する（右上のボタンと同じ）</td></tr>
        <tr><th><span class="lq-kbd">Ctrl</span>+<span class="lq-kbd">V</span></th><td>Excel でコピーした範囲を読み込む（入力欄の外で）</td></tr>
        <tr><th><span class="lq-kbd">Enter</span>／<span class="lq-kbd">Shift</span>+<span class="lq-kbd">Enter</span></th><td>入力を確定して次／前の欄へ（入力欄を選ぶと中身が全選択されます）</td></tr>
        <tr><th><span class="lq-kbd">Esc</span></th><td>小窓 → 説明書 → パネルの順に閉じる</td></tr>
        <tr><th><span class="lq-kbd">Alt</span>+<span class="lq-kbd">↑</span>／<span class="lq-kbd">↓</span></th><td>出力列の一覧で、選んだ列を上下に移動</td></tr>
      </table>` },
    { id: 'faq', icon: 'circle-question', title: '困ったとき', html: `
      <table>
        <tr><th>文字化けする</th><td>① / ② のパネルで文字コードを切り替えてください。出力時は Excel 形式か UTF-8（BOM 付き）がおすすめです。</td></tr>
        <tr><th>一致するはずなのに一致しない</th><td>結果の行番号や「根拠を見る」で値を確かめ、照合ルール（空白・全角半角・大小文字・数値）を見直してください。</td></tr>
        <tr><th>「比較できない」と出る</th><td>以上・未満などで、数値と文字（例：「未定」）を比べています。不一致として扱い、件数をお知らせします。</td></tr>
        <tr><th>Excel が読めない</th><td>Excel の読み書きにはインターネット上のライブラリ（SheetJS）を使います。接続できない場合は CSV で保存し直して読み込んでください。パスワード付きのファイルは読めません。</td></tr>
        <tr><th>処理が遅い</th><td>「完全一致」「含む」「前方一致」「後方一致」を「すべて満たす」の条件に含めると、② の候補を絞り込んで速くなります。処理中は右上の「中止する」で止められます。</td></tr>
      </table>` }
  ];

  class ManualModal {
    constructor(ctx) {
      this.ctx = ctx;
      this.el = null;
      this._returnFocus = null;
    }

    shouldAutoOpen() {
      return LQ.Prefs.get('manualAutoOpen', true);
    }

    isOpen() {
      return !!this.el;
    }

    toggle() {
      if (this.isOpen()) this.close();
      else this.open();
    }

    open(sectionId) {
      if (this.el) return;
      this.ctx.popovers.close();
      this._returnFocus = document.activeElement;
      const links = new Map();
      const content = h('div', { class: 'lq-manual__content' });
      SECTIONS.forEach((sec) => {
        content.appendChild(h('section', { id: 'lq-manual-' + sec.id, dataset: { section: sec.id } }, [
          h('h2', { html: Dom.iconHtml(sec.icon) + LQ.Util.escapeHtml(sec.title) }),
          h('div', { html: sec.html })
        ]));
      });
      const toc = h('nav', { class: 'lq-manual__toc', 'aria-label': '目次' }, SECTIONS.map((sec) => {
        const a = h('a', {
          href: '#lq-manual-' + sec.id,
          onclick: (e) => {
            e.preventDefault();
            this._scrollTo(content, sec.id);
          }
        }, [Dom.icon(sec.icon), sec.title]);
        links.set(sec.id, a);
        return a;
      }));
      content.addEventListener('scroll', () => this._spy(content, links));
      const auto = h('input', { type: 'checkbox', checked: this.shouldAutoOpen() });
      auto.addEventListener('change', () => LQ.Prefs.set('manualAutoOpen', auto.checked));
      const closeBtn = h('button', { class: 'lq-btn lq-btn--primary', type: 'button', onclick: () => this.close() }, [Dom.icon('check'), '閉じて使い始める']);
      const modal = h('div', { class: 'lq-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': '使い方' }, [
        h('div', { class: 'lq-modal__head' }, [Dom.icon('book-open', 'lq-panel__icon'), h('h2', { class: 'lq-modal__title', text: '使い方（取扱説明書）' }),
          LQ.UI.iconButton('xmark', '閉じる（Esc）', () => this.close())]),
        h('div', { class: 'lq-modal__body' }, [toc, content]),
        h('div', { class: 'lq-modal__foot' }, [
          h('label', { class: 'lq-switch' }, [auto, h('span', { class: 'lq-switch__track' }), h('span', { text: '起動時にこの説明を表示する' })]),
          h('span', { class: 'lq-muted', text: '右上の「使い方」でいつでも表示／非表示を切り替えられます' }),
          h('span', { class: 'lq-topbar__spacer' }),
          closeBtn
        ])
      ]);
      this.el = h('div', {
        class: 'lq-modal-backdrop',
        onmousedown: (e) => {
          if (e.target === this.el) this.close();
        }
      }, modal);
      Dom.qs('#lqOverlay').appendChild(this.el);
      this._spy(content, links);
      if (sectionId) this._scrollTo(content, sectionId);
      closeBtn.focus();
    }

    close() {
      if (!this.el) return;
      this.el.remove();
      this.el = null;
      if (this._returnFocus && this._returnFocus.focus) this._returnFocus.focus();
    }

    _scrollTo(content, id) {
      const target = content.querySelector('[data-section="' + id + '"]');
      if (target) content.scrollTop = target.offsetTop - content.offsetTop;
    }

    _spy(content, links) {
      let current = null;
      Dom.qsa('section[data-section]', content).forEach((sec) => {
        if (sec.offsetTop - content.offsetTop <= content.scrollTop + 24) current = sec.dataset.section;
      });
      if (!current) current = SECTIONS[0].id;
      links.forEach((a, id) => a.classList.toggle('is-active', id === current));
    }
  }

  LQ.ManualModal = ManualModal;
})(window);
