/* =========================================================================
 * LightQuery - lq-ui-formula.js
 * 計算の式を書く手助け（列の追加の「計算」のモーダルで使う部品）
 *   FormulaPalette … 関数の一覧（分類：条件・文字・数値・日付／名前・説明で探す）。押すと「関数名(」を式に入れる
 *   FormulaHint    … カーソルのある関数の書き方（今の引数を強調）・説明・例。関数の外では書き方の要点を出す
 *   関数は Formula.Funcs の登録簿から作るので、関数を足しても画面の変更は要らない。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Dom = LQ.Dom;
  const h = Dom.h;
  const Funcs = LQ.Formula.Funcs;

  const PREF_CAT = 'formulaCategory';
  const DEFAULT_HINT = '列名は [ ] で囲み、文字は " " で囲みます。+ − × ÷ ^ と括弧で計算し、& で文字をつなぎ、= <> > < >= <= で比べます（TRUE / FALSE）。日付の列に数を足すと日付、日付どうしを引くと日数です。関数は右の一覧から入れられます。';

  /** 説明の最初の文（一覧に出す短い説明） */
  function firstSentence(text) {
    const i = text.indexOf('。');
    return i >= 0 ? text.slice(0, i + 1) : text;
  }

  /** 書き方の引数（「IF(条件, 真のとき, [偽のとき])」→ ['条件', '真のとき', '[偽のとき]']） */
  function argsOf(syntax) {
    const open = syntax.indexOf('(');
    const inner = syntax.slice(open + 1, syntax.lastIndexOf(')'));
    return inner ? inner.split(', ') : [];
  }

  /* ---------------------------------------------------------------------
   * FormulaPalette：関数の一覧
   * ------------------------------------------------------------------- */
  class FormulaPalette {
    /**
     * @param {function(string, number):void} onInsert 式に入れる（文字と、入れたあとカーソルを戻す文字数）
     */
    constructor(onInsert) {
      this.onInsert = onInsert;
      this.cat = LQ.Prefs.get(PREF_CAT, 'cond');
      if (!Funcs.CATEGORIES.some((c) => c.id === this.cat)) this.cat = 'cond';
      this.seg = new LQ.Segmented(Funcs.CATEGORIES.map((c) => ({ value: c.id, label: c.label, icon: c.icon, title: c.label + 'の関数' })), this.cat, (v) => {
        this.cat = v;
        LQ.Prefs.set(PREF_CAT, v);
        this.find.value = '';
        this.render();
      }, 'lq-seg--block');
      this.find = h('input', { class: 'lq-input lq-input--sm', type: 'search', placeholder: '関数を探す（名前・説明）', title: '関数の名前か説明の一部で、すべての分類から探します' });
      this.find.addEventListener('input', () => this.render());
      this.list = h('div', { class: 'lq-fxlist', role: 'list' });
      this.el = h('div', { class: 'lq-fxpalette' }, [this.seg.el, this.find, this.list]);
      this.render();
    }

    render() {
      Dom.clear(this.list);
      const word = this.find.value.trim().normalize('NFKC').toUpperCase();
      this.seg.el.classList.toggle('is-dim', !!word);
      const defs = word
        ? Funcs.CATEGORIES.flatMap((c) => Funcs.byCategory(c.id)).filter((d) => d.name.indexOf(word) >= 0 || d.desc.normalize('NFKC').toUpperCase().indexOf(word) >= 0)
        : Funcs.byCategory(this.cat);
      if (!defs.length) {
        this.list.appendChild(h('p', { class: 'lq-field__hint', text: '当てはまる関数はありません' }));
        return;
      }
      defs.forEach((d) => this.list.appendChild(h('button', {
        class: 'lq-fxitem', type: 'button', role: 'listitem',
        title: d.syntax + '\n' + d.desc + (d.example ? '\n例：' + d.example : '') + '\n（押すと式に入ります）',
        onclick: () => this.onInsert(d.args[1] === 0 ? d.name + '()' : d.name + '(', 0)
      }, [h('span', { class: 'lq-fxitem__name', text: d.name }), h('span', { class: 'lq-fxitem__desc', text: firstSentence(d.desc) })])));
    }
  }

  /* ---------------------------------------------------------------------
   * FormulaHint：カーソルのある関数の書き方
   * ------------------------------------------------------------------- */
  class FormulaHint {
    constructor() {
      this.el = h('div', { class: 'lq-fxhint', 'aria-live': 'polite' });
      this._key = null;
      this.update('', 0);
    }

    /** 式と、カーソルの位置から表示を変える（同じ表示なら作り直さない） */
    update(expr, pos) {
      const at = LQ.Formula.callAt(expr, pos);
      const def = at ? Funcs.get(at.name) : null;
      const key = def ? def.name + ':' + at.arg : '';
      if (key === this._key) return;
      this._key = key;
      Dom.clear(this.el);
      this.el.classList.toggle('is-fn', !!def);
      if (!def) {
        this.el.appendChild(h('span', { class: 'lq-fxhint__text' }, [Dom.icon('circle-info'), DEFAULT_HINT]));
        return;
      }
      const args = argsOf(def.syntax);
      const cur = Math.min(at.arg, args.length - 1);
      const sig = [h('strong', { text: def.name }), '('];
      args.forEach((a, i) => {
        if (i) sig.push(', ');
        sig.push(i === cur ? h('mark', { class: 'lq-fxhint__arg', text: a }) : a);
      });
      sig.push(')');
      Dom.append(this.el, [
        h('div', { class: 'lq-fxhint__sig' }, sig),
        h('div', { class: 'lq-fxhint__text', text: def.desc }),
        def.example ? h('div', { class: 'lq-fxhint__example' }, ['例：', h('code', { text: def.example })]) : null
      ]);
    }
  }

  LQ.FormulaPalette = FormulaPalette;
  LQ.FormulaHint = FormulaHint;
})(window);
