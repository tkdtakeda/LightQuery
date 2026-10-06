/* =========================================================================
 * LightQuery - lq-ui-prep.js
 * 前処理の画面部品（処理の順：縦に結合 → 縦持ち → 列の追加 → 絞り込み → 重複の削除）
 *   SourceFilesSection … ① の読み込みパネル「ファイル」の下：縦に結合したファイルの一覧・追加・外す
 *   UnpivotSection     … 読み込みパネルの区画「縦持ちにする」（読み込み範囲の下）
 *   DedupSection       … 読み込みパネルの区画「重複の削除」（絞り込みの下）
 *   PrepFlowBar        … メインの ① / ② タブと抽出結果の上：処理の流れ（各段の行数）。除いた行数を押すと内訳
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Dom = LQ.Dom;
  const Util = LQ.Util;
  const UI = LQ.UI;
  const Flash = LQ.Flash;
  const h = Dom.h;
  const fmt = Util.formatInt;

  const KIND_ICON = { excel: 'file-excel', csv: 'file-csv', paste: 'paste', sample: 'flask', stored: 'floppy-disk' };
  const ROLE_MARK = { source: '①', condition: '②' };

  /** 段で除いた行を、メインの表の上に重ねて表示する */
  function openRemoved(ctx, ds, stage, anchor) {
    const info = stage === 'dedup' ? ds.dedupInfo : ds.filterInfo;
    if (!info || !info.removed.length) return;
    const mark = ROLE_MARK[ds.role];
    const isDedup = stage === 'dedup';
    const entry = {
      by: [],
      table: LQ.PrepFlow.removedTable(ds, stage),
      title: mark + ' の' + (isDedup ? '重複の削除' : '絞り込み') + 'で除いた行',
      fileTag: mark + (isDedup ? '_重複で除いた行' : '_絞り込みで除いた行')
    };
    const scope = isDedup
      ? LQ.Dedup.describe(ds.dedup) + 'の 2 行目以降です。「残した行」はそのとき残した最初の行の行番号です。'
      : '列ごとの絞り込み ' + ds.filters.length + ' 件のどれかを満たさなかった行です。';
    const back = anchor && anchor.isConnected ? () => anchor.focus() : null;
    ctx.app.main.drillView().open(entry, null, scope, back, { label: mark + ' の前処理', text: LQ.PrepFlow.text(ds) });
  }

  /* ---------------------------------------------------------------------
   * SourceFilesSection：① の縦に結合したファイル（1 つ目が読み込み範囲の基準）
   * ------------------------------------------------------------------- */
  class SourceFilesSection {
    constructor(ctx) {
      this.ctx = ctx;
      this.app = ctx.app;
      this.list = h('div', { class: 'lq-filelist' });
      this.add = h('button', {
        class: 'lq-btn lq-btn--sm lq-btn--block', type: 'button',
        title: 'ファイルを選び、今の ① の下に行を足します（縦に結合。列は名前でそろえ、「元ファイル」列でどのファイルの行か分かります）。ファイルを画面にドラッグしても足せます',
        onclick: () => this.app.pickFile('sourceAppend')
      }, [Dom.icon('layer-group'), 'ファイルを下に足す（縦に結合）']);
      this.el = h('div', { class: 'lq-stack' }, [this.list, this.add]);
    }

    render(ds) {
      Dom.clear(this.list);
      this.list.hidden = ds.fileCount < 2;
      this.add.disabled = ds.fileCount >= LQ.SourceUnion.MAX_FILES;
      if (ds.fileCount < 2) return;
      const u = ds.union;
      const head = h('div', { class: 'lq-filelist__head' }, [Dom.icon('layer-group'),
        h('span', { text: '縦に結合：' + ds.fileCount + ' ファイル・' + fmt(ds.baseRowCount) + ' 行' })]);
      head.title = '上から順に行を並べます。列は名前でそろえ、片方にしかない列は空欄にします。どのファイルの行かは「' + u.fileColumn + '」列で分かります。';
      this.list.appendChild(head);
      u.files.forEach((f, i) => this.list.appendChild(this._row(f, i)));
    }

    _row(f, i) {
      const warn = LQ.SourceUnion.needsAttention(f);
      const remove = i === 0
        ? () => this.app.prep.removePrimary()
        : () => this.app.prep.removeMember(i - 1);
      return h('div', { class: 'lq-filelist__row' + (warn ? ' is-warn' : ''), title: f.label + '：' + LQ.SourceUnion.describeFile(f) }, [
        h('span', { class: 'lq-filelist__no lq-num', text: String(i + 1) }),
        Dom.icon(warn ? 'triangle-exclamation' : (KIND_ICON[f.kind] || 'file'), 'lq-filelist__icon'),
        h('span', { class: 'lq-filelist__name', text: f.label }),
        i === 0 ? h('span', { class: 'lq-tag', text: '基準', title: '読み込み範囲・シートはこのファイルで設定し、ほかのファイルにも当てはめます' }) : null,
        h('span', { class: 'lq-filelist__rows lq-num', text: fmt(f.rows) + ' 行' }),
        UI.iconButton('xmark', 'このファイルを外す（元に戻せます）', remove, 'lq-btn--xs')
      ]);
    }
  }

  /* ---------------------------------------------------------------------
   * UnpivotSection：縦持ちにする（横に並んだ列を「項目」「値」の行に）
   *   使う／使わない・行にする列（おすすめを最初から選ぶ）・2 つの列の名前・空欄の扱い・行数の変化
   * ------------------------------------------------------------------- */
  class UnpivotSection {
    constructor(ctx, role) {
      this.ctx = ctx;
      this.state = ctx.state;
      this.app = ctx.app;
      this.role = role;
      this.ds = null;
      this.toggle = UI.switchToggle('横に並んだ列（4月・5月… など）を行にする', false, (on) => this._setOn(on));
      this.chips = h('div', { class: 'lq-colchips lq-colchips--toggle lq-dedup__cols' });
      this.chips.addEventListener('click', (e) => {
        const chip = e.target.closest('[data-col]');
        if (chip) this._toggleCol(chip.dataset.col);
      });
      this.nameInput = h('input', { class: 'lq-input', type: 'text', title: '行にした列の名前を入れる列（例：月）。Enter で反映' });
      this.valueInput = h('input', { class: 'lq-input', type: 'text', title: 'その列の値を入れる列（例：売上）。Enter で反映' });
      [this.nameInput, this.valueInput].forEach((input) => input.addEventListener('change', () => this._rename()));
      this.blank = UI.switchToggle('空欄の値も行にする', false, (on) => this._update({ keepBlank: on }));
      this.status = h('div', { class: 'lq-dedup__status' });
      this.body = h('div', { class: 'lq-stack' }, [
        UI.field('行にする列（押して選ぶ。月・日付・数の見出しの列は最初から選んでいます）', this.chips),
        h('div', { class: 'lq-rangegrid' }, [UI.field('列の名前を入れる列', this.nameInput), UI.field('値を入れる列', this.valueInput)]),
        this.blank.el,
        this.status
      ]);
      this.el = UI.section('縦持ちにする（横に並んだ列を行に）', [this.toggle.el, this.body,
        h('p', { class: 'lq-field__hint', text: '例：顧客・4月・5月・6月 の表 → 顧客・月・売上 の表。月ごとの集計・グラフ・照合がしやすくなります。' })]);
      this.el.title = 'Power Query の「列のピボット解除」と同じです。選んだ列 1 つにつき 1 行を作り、選ばなかった列（顧客名など）はそのまま残します。読み込みのすぐあとに当てはめるので、列の追加・絞り込み・重複の削除は縦持ちにした表に掛かります。列の名前で記憶し、次に同じ列のある表を読み込んだときも掛け直します。';
      LQ.FormNav.attach(this.body);
    }

    render(ds) {
      this.ds = ds;
      const def = ds.unpivot;
      this.toggle.input.checked = !!def;
      this.body.hidden = !def;
      if (!def) return;
      if (document.activeElement !== this.nameInput) this.nameInput.value = def.name;
      if (document.activeElement !== this.valueInput) this.valueInput.value = def.value;
      this.blank.input.checked = !!def.keepBlank;
      Dom.clear(this.chips);
      const on = new Set(def.cols);
      const frag = document.createDocumentFragment();
      (ds.preUnpivotColumns || []).filter((c) => !c.fileCol).forEach((c) => {
        const sel = on.has(c.name);
        frag.appendChild(h('button', {
          class: 'lq-colchip' + (sel ? ' is-on' : ' is-off'), type: 'button', dataset: { col: c.name }, 'aria-pressed': sel ? 'true' : 'false',
          title: c.letter + ' 列：' + c.name + (sel ? '（行にする・押すと列のまま）' : '（列のまま・押すと行にする）')
        }, [Dom.icon(sel ? 'square-check' : 'square'), h('span', { class: 'lq-colchip__letter', text: c.letter }), h('span', { class: 'lq-colchip__name', text: c.name })]));
      });
      this.chips.appendChild(frag);
      Dom.clear(this.status);
      const info = ds.unpivotInfo;
      if (!info || !info.ok) {
        this.status.appendChild(UI.status('warn', info && info.message ? info.message : '行にする列を選んでください'));
        return;
      }
      this.status.appendChild(UI.status('ok', info.cols.length + ' 列を行にして、' + fmt(info.base) + ' 行 → ' + fmt(info.kept) + ' 行にしました'));
      if (info.message) this.status.appendChild(UI.status('warn', info.message));
    }

    _setOn(on) {
      const ds = this.ds;
      if (!ds) return;
      this.app.prep.setUnpivot(this.role, on ? {
        cols: LQ.Unpivot.suggest(ds.preUnpivotColumns || []), name: LQ.Unpivot.DEFAULT_NAME, value: LQ.Unpivot.DEFAULT_VALUE, keepBlank: false
      } : null);
      Flash.el(this.toggle.el);
    }

    _update(patch, quiet) {
      const ds = this.ds;
      if (!ds || !ds.unpivot) return;
      this.app.prep.setUnpivot(this.role, Object.assign({}, ds.unpivot, patch), quiet);
    }

    _toggleCol(name) {
      const ds = this.ds;
      if (!ds || !ds.unpivot) return;
      const cols = ds.unpivot.cols.slice();
      const at = cols.indexOf(name);
      if (at >= 0) cols.splice(at, 1);
      else cols.push(name);
      const order = new Map((ds.preUnpivotColumns || []).map((c, i) => [c.name, i]));
      cols.sort((a, b) => order.get(a) - order.get(b));
      this._update({ cols: cols }, true);
      const again = this.chips.querySelector('[data-col="' + CSS.escape(name) + '"]');
      if (again) {
        again.focus();
        Flash.el(again);
      }
    }

    _rename() {
      const name = this.nameInput.value.trim() || LQ.Unpivot.DEFAULT_NAME;
      const value = this.valueInput.value.trim() || LQ.Unpivot.DEFAULT_VALUE;
      const def = this.ds && this.ds.unpivot;
      if (!def || (def.name === name && def.value === value)) return;
      this._update({ name: name, value: value }, true);
      Flash.input(this.nameInput);
      Flash.input(this.valueInput);
    }
  }

  /* ---------------------------------------------------------------------
   * DedupSection：重複の削除（使う／使わない・比べる列・除いた行数）
   * ------------------------------------------------------------------- */
  class DedupSection {
    constructor(ctx, role) {
      this.ctx = ctx;
      this.state = ctx.state;
      this.app = ctx.app;
      this.role = role;
      this.ds = null;
      this.toggle = UI.switchToggle('重複している行を除く（最初の 1 行だけ残す）', false, (on) => this._setOn(on));
      this.scope = new LQ.Segmented([
        { value: 'all', label: 'すべての列', icon: 'table-columns', title: 'すべての列の値が同じ行を重複とみなします（「元ファイル」列と追加した列は比べません）' },
        { value: 'cols', label: '列を選ぶ', icon: 'key', title: '選んだ列（顧客 ID など）の値が同じ行を重複とみなします' }
      ], 'all', (v) => this._setScope(v), 'lq-seg--block');
      this.chips = h('div', { class: 'lq-colchips lq-colchips--toggle lq-dedup__cols' });
      this.chips.addEventListener('click', (e) => {
        const chip = e.target.closest('[data-col]');
        if (chip) this._toggleCol(chip.dataset.col);
      });
      this.status = h('div', { class: 'lq-dedup__status' });
      this.body = h('div', { class: 'lq-stack' }, [UI.field('比べる列', this.scope.el), this.chips, this.status]);
      this.el = UI.section('重複の削除（絞り込みのあとに行を減らす）', [this.toggle.el, this.body,
        h('p', { class: 'lq-field__hint', text: '値は前後の空白・全角半角・大文字小文字をそろえて比べます（絞り込みと同じ）。' })]);
      this.el.title = 'Excel の「重複の削除」と同じく、比べる列の値がすべて同じ行は最初の 1 行だけを残します。縦に結合した表で同じ行が複数のファイルにあるときや、② のキーの重複を除くときに使います。列の名前で記憶し、次に同じ列のある表を読み込んだときも掛け直します。';
    }

    render(ds) {
      /* 別の表（② の抽出条件の切り替え・ファイルの入れ替え）になったら「列を選ぶ」の途中の状態は持ち越さない */
      if (this._dsId !== ds.id) {
        this._dsId = ds.id;
        this._picking = false;
      }
      this.ds = ds;
      const def = ds.dedup;
      this.toggle.input.checked = !!def;
      this.body.hidden = !def;
      if (!def) return;
      if (def.cols.length) this._picking = true;
      this.scope.set(this._picking ? 'cols' : 'all');
      this._renderChips(ds, def);
      this._renderStatus(ds);
    }

    _renderChips(ds, def) {
      Dom.clear(this.chips);
      const picking = def.cols.length > 0 || this._picking;
      this.chips.hidden = !picking;
      if (!picking) return;
      const on = new Set(def.cols);
      const frag = document.createDocumentFragment();
      LQ.Dedup.candidates(ds).forEach((c) => {
        const sel = on.has(c.name);
        frag.appendChild(h('button', {
          class: 'lq-colchip' + (sel ? ' is-on' : ' is-off'), type: 'button', dataset: { col: c.name }, 'aria-pressed': sel ? 'true' : 'false',
          title: c.letter + ' 列：' + c.name + (sel ? '（比べる・押すと比べない）' : '（比べない・押すと比べる）')
        }, [Dom.icon(sel ? 'square-check' : 'square'), h('span', { class: 'lq-colchip__letter', text: c.letter }), h('span', { class: 'lq-colchip__name', text: c.name })]));
      });
      this.chips.appendChild(frag);
    }

    _renderStatus(ds) {
      Dom.clear(this.status);
      const info = ds.dedupInfo;
      if (!info) return;
      if (!info.ok) {
        this.status.appendChild(UI.status('warn', info.message));
        return;
      }
      if (this._picking && !ds.dedup.cols.length) this.status.appendChild(UI.status('info', '列を選ぶまでは、すべての列で比べます'));
      const removed = info.removed.length;
      const line = removed
        ? UI.status('ok', fmt(info.base) + ' 行のうち重複 ' + fmt(removed) + ' 行を除き、' + fmt(info.kept) + ' 行を使います')
        : UI.status('info', '重複している行はありません（' + fmt(info.base) + ' 行）');
      this.status.appendChild(line);
      if (info.message) this.status.appendChild(UI.status('warn', info.message));
      if (removed) {
        const btn = h('button', { class: 'lq-btn lq-btn--xs', type: 'button', title: '除いた行と、そのとき残した行の行番号を表で見ます（コピー・Excel 出力もできます）' },
          [Dom.icon('magnifying-glass'), '除いた行を見る']);
        btn.addEventListener('click', () => openRemoved(this.ctx, ds, 'dedup', btn));
        this.status.appendChild(btn);
      }
    }

    _setOn(on) {
      this._picking = false;
      this.app.prep.setDedup(this.role, on ? { cols: [] } : null);
      Flash.el(this.toggle.el);
    }

    _setScope(v) {
      const ds = this.ds;
      if (!ds || !ds.dedup) return;
      if (v === 'all') {
        this._picking = false;
        this.app.prep.setDedup(this.role, { cols: [] });
        return;
      }
      /* 列を選ぶ：まだ何も選んでいないので、選ぶまでは「すべての列」のまま比べる */
      this._picking = true;
      this._renderChips(ds, ds.dedup);
      Flash.el(this.chips);
    }

    _toggleCol(name) {
      const ds = this.ds;
      if (!ds || !ds.dedup) return;
      const cols = ds.dedup.cols.slice();
      const at = cols.indexOf(name);
      if (at >= 0) cols.splice(at, 1);
      else cols.push(name);
      /* 列の並びは表の順にそろえる（設定の文章を読みやすく） */
      const order = new Map(ds.columns.map((c) => [c.name, c.index]));
      cols.sort((a, b) => order.get(a) - order.get(b));
      this._picking = true;
      this.app.prep.setDedup(this.role, { cols: cols });
      const again = this.chips.querySelector('[data-col="' + CSS.escape(name) + '"]');
      if (again) {
        again.focus();
        Flash.el(again);
      }
    }
  }

  /* ---------------------------------------------------------------------
   * PrepFlowBar：処理の流れ（読み込み → 絞り込み → 重複の削除 → 使う行）。前処理を使っているときだけ出す
   * ------------------------------------------------------------------- */
  const PrepFlowBar = {
    /**
     * @param {object} ctx
     * @param {LQ.Dataset} ds
     * @param {{tail?:{icon:string, label:string, rows:number, title?:string}}} [opts] 最後に足す段（抽出結果の「該当」など）
     * @returns {Element|null}
     */
    render(ctx, ds, opts) {
      if (!LQ.PrepFlow.active(ds)) return null;
      const o = opts || {};
      const mark = ROLE_MARK[ds.role];
      const items = [h('span', { class: 'lq-filterbar__label' }, [UI.badge(ds.role === 'source' ? 'src' : 'cond', mark), '処理の流れ'])];
      LQ.PrepFlow.steps(ds).forEach((st, i) => {
        if (i > 0) items.push(Dom.icon('arrow-right', 'lq-flow__arrow'));
        items.push(PrepFlowBar._step(ctx, ds, st, i === 0));
      });
      items.push(Dom.icon('arrow-right', 'lq-flow__arrow'));
      items.push(h('span', { class: 'lq-flow__step lq-flow__step--use', title: '抽出・ピボット・グラフ・出力に使う行' },
        [Dom.icon('circle-check'), h('span', { text: '使う行' }), h('span', { class: 'lq-num lq-flow__rows', text: fmt(ds.rowCount) + ' 行' })]));
      if (o.tail) {
        items.push(Dom.icon('arrow-right', 'lq-flow__arrow'));
        items.push(h('span', { class: 'lq-flow__step lq-flow__step--use', title: o.tail.title || '' },
          [Dom.icon(o.tail.icon), h('span', { text: o.tail.label }), h('span', { class: 'lq-num lq-flow__rows', text: fmt(o.tail.rows) + ' 行' })]));
      }
      if (ds.role === 'source' || ds.role === 'condition') {
        items.push(h('button', { class: 'lq-btn lq-btn--xs lq-flow__edit', type: 'button', title: '読み込みの設定（縦に結合・列の追加・絞り込み・重複の削除）を開く',
          onclick: () => ctx.state.openPanel(ds.role) }, [Dom.icon('sliders'), '設定']));
      }
      return h('div', { class: 'lq-filterbar lq-flow', role: 'group', 'aria-label': '処理の流れ' }, items);
    },

    _step(ctx, ds, st, first) {
      const children = [Dom.icon(st.ok === false ? 'triangle-exclamation' : st.icon), h('span', { text: st.label })];
      if (first || st.reshape) {
        children.push(h('span', { class: 'lq-num lq-flow__rows', text: fmt(st.rows) + ' 行' }));
        return h('span', { class: 'lq-flow__step', title: st.title }, children);
      }
      const removed = st.removed || 0;
      if (!removed) {
        children.push(h('span', { class: 'lq-num lq-flow__rows', text: '−0' }));
        return h('span', { class: 'lq-flow__step', title: st.title + '。除いた行はありません' }, children);
      }
      children.push(h('span', { class: 'lq-num lq-flow__rows lq-flow__removed', text: '−' + fmt(removed) }));
      const btn = h('button', { class: 'lq-flow__step lq-flow__step--btn', type: 'button', title: st.title + '。押すと除いた ' + fmt(removed) + ' 行を表で見られます' }, children);
      btn.addEventListener('click', () => openRemoved(ctx, ds, st.id, btn));
      return btn;
    }
  };

  LQ.SourceFilesSection = SourceFilesSection;
  LQ.UnpivotSection = UnpivotSection;
  LQ.DedupSection = DedupSection;
  LQ.PrepFlowBar = PrepFlowBar;
})(window);
