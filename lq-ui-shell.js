/* =========================================================================
 * LightQuery - lq-ui-shell.js
 * 画面の外枠：上部バー（読み込み状況・次の一歩・主要動作）、左のアイコン列、設定パネルの入れ物、
 *   画面全体へのドラッグ＆ドロップ、Ctrl+V の貼り付け、キーボード操作
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Dom = LQ.Dom;
  const Util = LQ.Util;
  const h = Dom.h;

  const STATUS_ICON = { ok: 'circle-check', warn: 'triangle-exclamation', error: 'circle-exclamation', info: 'circle-info' };

  /* ---------------------------------------------------------------------
   * TopBar
   * ------------------------------------------------------------------- */
  class TopBar {
    constructor(ctx, root) {
      this.ctx = ctx;
      this.state = ctx.state;
      this.app = ctx.app;
      this.root = root;
      this._ctaId = null;
      this.chips = h('div', { class: 'lq-topbar__chips' });
      this.statusIcon = Dom.icon('circle-info');
      this.statusText = h('span', { class: 'lq-topbar__status-text' });
      this.progressFill = h('div', { class: 'lq-progress__fill' });
      this.progress = h('div', { class: 'lq-progress', hidden: true }, this.progressFill);
      this.status = h('div', { class: 'lq-topbar__status lq-status' }, [this.statusIcon, this.statusText, this.progress]);
      this.ctaIcon = Dom.icon('file-import');
      this.ctaLabel = h('span');
      this.cta = h('button', { class: 'lq-btn lq-btn--primary lq-cta', type: 'button', onclick: () => this.app.runCta(this.cta) }, [this.ctaIcon, this.ctaLabel]);
      this.helpBtn = h('button', { class: 'lq-btn lq-btn--ghost', type: 'button', title: '使い方（取扱説明書）を表示／非表示', onclick: () => this.app.manual.toggle() },
        [Dom.icon('circle-question'), '使い方']);
      this.menuBtn = h('button', { class: 'lq-btn lq-btn--ghost lq-btn--icon', type: 'button', title: 'その他の操作（サンプル・保存・クリア）', 'aria-label': 'その他の操作',
        onclick: () => this.app.dialogs.openAppMenu(this.menuBtn) }, Dom.icon('ellipsis-vertical'));
      Dom.append(root, [
        h('div', { class: 'lq-brand' }, [
          h('span', { class: 'lq-brand__mark' }, Dom.icon('magnifying-glass')),
          h('div', {}, [h('div', { class: 'lq-brand__name', text: 'LightQuery' }), h('div', { class: 'lq-brand__sub', text: '簡易クエリ' })])
        ]),
        this.chips,
        h('div', { class: 'lq-topbar__spacer' }),
        this.status,
        this.cta,
        h('div', { class: 'lq-topbar__tools' }, [this.helpBtn, this.menuBtn])
      ]);
      ctx.bus.on('change', () => this.render());
      this.render();
    }

    render() {
      this._renderChips();
      const c = this.app.cta();
      this.cta.disabled = !!c.disabled;
      this.cta.classList.toggle('lq-btn--primary', c.variant !== 'stop');
      this.cta.classList.toggle('is-stop', c.variant === 'stop');
      this.ctaIcon.className = 'fa-solid fa-' + c.icon + (c.spin ? ' fa-spin' : '');
      this.ctaLabel.textContent = c.label;
      this.cta.title = c.status ? c.status.text : '';
      if (this._ctaId !== null && this._ctaId !== c.id && c.id !== 'busy' && c.id !== 'cancel') LQ.Flash.el(this.cta);
      if (this._ctaId !== c.id && (c.id === 'run' || c.id === 'export')) {
        this.cta.classList.remove('is-attn');
        void this.cta.offsetWidth;
        this.cta.classList.add('is-attn');
      }
      this._ctaId = c.id;
      const st = c.status || { kind: 'info', text: '' };
      this.status.className = 'lq-topbar__status lq-status lq-status--' + st.kind;
      this.statusIcon.className = 'fa-solid fa-' + (STATUS_ICON[st.kind] || STATUS_ICON.info);
      this.statusText.textContent = st.text;
      this.status.title = st.text;
      this.progress.hidden = c.progress === undefined;
      if (c.progress !== undefined) this.progressFill.style.width = Math.round(c.progress * 100) + '%';
    }

    _renderChips() {
      Dom.clear(this.chips);
      const s = this.state;
      const multi = s.profiles.length > 1;
      ['source', 'condition'].forEach((role) => {
        const ds = s.datasets[role];
        const isSrc = role === 'source';
        const badge = LQ.UI.badge(isSrc ? 'src' : 'cond', isSrc ? '①' : '②');
        const owner = !isSrc && multi ? h('span', { class: 'lq-chip__owner', text: s.activeProfile.name }) : null;
        const ownerText = !isSrc && multi ? '（抽出条件「' + s.activeProfile.name + '」）' : '';
        if (!ds) {
          this.chips.appendChild(h('button', {
            class: 'lq-chip lq-chip--empty', type: 'button', title: (isSrc ? '① 元データ' : '② 条件データ' + ownerText) + 'を読み込む',
            onclick: () => s.openPanel(role)
          }, [badge, h('span', { class: 'lq-chip__name', text: isSrc ? '元データ 未読み込み' : '条件データ 未読み込み' }), owner]));
          return;
        }
        this.chips.appendChild(h('button', {
          class: 'lq-chip ' + (isSrc ? 'lq-chip--src' : 'lq-chip--cond'), type: 'button',
          title: ds.name + '（' + ds.source.kindLabel + '・' + Util.formatInt(ds.rowCount) + ' 行 × ' + ds.colCount + ' 列）' + ownerText + '— クリックで読み込み設定を開く',
          onclick: () => s.togglePanel(role)
        }, [
          badge,
          owner,
          h('span', { class: 'lq-chip__name', text: ds.name }),
          owner ? null : h('span', { class: 'lq-chip__meta', text: Util.formatInt(ds.rowCount) + ' 行 × ' + ds.colCount + ' 列' }),
          ds.isSample ? h('span', { class: 'lq-tag lq-tag--sample', text: 'サンプル' }) : null,
          ds.filterInfo ? h('span', { class: 'lq-tag lq-tag--filter', title: '絞り込み中：' + Util.formatInt(ds.baseRowCount) + ' 行中 ' + Util.formatInt(ds.rowCount) + ' 行' },
            [Dom.icon('filter'), '絞り込み中']) : null
        ]));
      });
    }
  }

  /* ---------------------------------------------------------------------
   * Rail：機能ごとの設定パネルを開くアイコン（アイコン＋短いラベル＋状態の印）
   * ------------------------------------------------------------------- */
  const RAIL_ITEMS = [
    { id: 'source', icon: 'table', label: '①元データ', title: '① 元データ：読み込み・ヘッダー・範囲の設定' },
    { id: 'condition', icon: 'list-check', label: '②条件データ', title: '② 条件データ（選択中の抽出条件）：読み込み・ヘッダー・範囲の設定', role: 'condition' },
    { id: 'query', icon: 'filter', label: '抽出条件', title: '抽出条件：一覧（名前・優先順位）と、① と ② の対応・比較方法・組み合わせ・出力する行' },
    { id: 'rules', icon: 'spell-check', label: '照合ルール', title: '照合ルール：空白・全角半角・大文字小文字・数値・日付（全体の設定／抽出条件ごとの設定）' },
    { id: 'output', icon: 'table-columns', label: '出力列', title: '出力列：表示・出力する列の選択と並べ替え' },
    { id: 'aggregate', icon: 'calculator', label: '集計', title: '集計：グループにする列・件数・合計・平均・標準偏差・最小・最大・順位' }
  ];

  class Rail {
    constructor(ctx, root) {
      this.ctx = ctx;
      this.state = ctx.state;
      this.app = ctx.app;
      this.items = new Map();
      const group = h('div', { class: 'lq-rail__group' });
      RAIL_ITEMS.forEach((item) => {
        const mark = h('span', { class: 'lq-rail__mark', hidden: true });
        const btn = h('button', {
          class: 'lq-rail__item', type: 'button', title: item.title, 'aria-label': item.title,
          dataset: item.role ? { role: item.role } : null,
          onclick: () => this.state.togglePanel(item.id)
        }, [Dom.icon(item.icon), h('span', { class: 'lq-rail__label', text: item.label }), mark]);
        this.items.set(item.id, { btn: btn, mark: mark });
        group.appendChild(btn);
      });
      const sampleBtn = h('button', {
        class: 'lq-rail__item', type: 'button', title: 'サンプルデータで動作を確認する',
        onclick: () => this.app.dialogs.openSamples(sampleBtn, 'right-end')
      }, [Dom.icon('flask'), h('span', { class: 'lq-rail__label', text: 'サンプル' })]);
      Dom.append(root, [group, h('div', { class: 'lq-rail__spacer' }), h('div', { class: 'lq-rail__divider' }), sampleBtn]);
      ctx.bus.on('change', () => this.render());
      this.render();
    }

    render() {
      const s = this.state;
      this.items.forEach((item, id) => item.btn.classList.toggle('is-active', s.panel === id));
      this._mark('source', s.datasets.source ? { kind: 'ok', icon: 'check', title: '読み込み済み' } : null);
      this._mark('condition', s.datasets.condition ? { kind: 'ok', icon: 'check', title: '読み込み済み（選択中の抽出条件）' } : null);
      this._mark('query', this._queryMark());
      const own = s.profiles.items.filter((p) => !!p.rules).length;
      this._mark('rules', own ? { kind: 'count', text: String(own), title: '個別の照合ルールがある抽出条件 ' + own + ' 件' } : null);
      /* 抽出結果があれば、結果の「列 N / M」と同じ数え方（出力できる列だけ）にする */
      const counts = s.columnCounts();
      const view = this.app.main ? this.app.main.resultView() : null;
      const visible = view ? view.resolveColumns(s.output.columns).filter((d) => d.available).length
        : counts['s:'].visible + counts['c:'].visible + counts['m:'].visible;
      this._mark('output', s.output.columns.length ? { kind: 'count', text: String(visible), title: '表示する列 ' + visible + ' 列' } : null);
      const agg = s.aggregate;
      const values = (agg.count ? 1 : 0) + agg.measures.length;
      this._mark('aggregate', agg.groupBy.length || agg.measures.length
        ? { kind: 'count', text: String(values), title: '集計：' + LQ.Aggregator.describe(agg) } : null);
    }

    /** 抽出条件の印：要設定の件数（警告）／整っていれば有効な件数（複数のとき）かチェック */
    _queryMark() {
      const s = this.state;
      const multi = s.profiles.length > 1;
      const started = multi || s.query.conditions.length > 0;
      if (!s.datasets.source || !started) return multi ? { kind: 'count', text: String(s.profiles.length), title: '抽出条件 ' + s.profiles.length + ' 件' } : null;
      const all = this.app.validationAll();
      if (!all.ok && all.errorCount) return { kind: 'warn', text: String(all.errorCount), title: '要設定 ' + all.errorCount + ' 件' };
      if (!all.ok) return { kind: 'warn', icon: 'exclamation', title: '有効な抽出条件がありません' };
      return multi
        ? { kind: 'ok', text: String(all.enabledCount), title: '有効な抽出条件 ' + all.enabledCount + ' 件（整っています）' }
        : { kind: 'ok', icon: 'check', title: '条件は整っています' };
    }

    _mark(id, spec) {
      const item = this.items.get(id);
      if (!spec) {
        item.mark.hidden = true;
        return;
      }
      item.mark.hidden = false;
      item.mark.className = 'lq-rail__mark lq-rail__mark--' + spec.kind;
      item.mark.title = spec.title;
      Dom.clear(item.mark);
      if (spec.icon) item.mark.appendChild(Dom.icon(spec.icon));
      else item.mark.textContent = spec.text;
    }
  }

  /* ---------------------------------------------------------------------
   * PanelHost：開いている設定パネルを 1 つだけ表示（他の画面操作は妨げない）
   *   右端のつまみをドラッグすると幅を変えられる（パネルごとにブラウザへ記憶。ダブルクリックで初期の幅に戻す）
   * ------------------------------------------------------------------- */
  const PANEL_MAX_RATIO = 0.6;
  class PanelHost {
    constructor(ctx, root, panels) {
      this.ctx = ctx;
      this.state = ctx.state;
      this.root = root;
      this.panels = panels;
      this._shown = null;
      this.icon = Dom.icon('table', 'lq-panel__icon');
      this.title = h('h2', { class: 'lq-panel__title' });
      this.actions = h('div', { class: 'lq-panel__actions' });
      this.head = h('div', { class: 'lq-panel__head' }, [this.icon, this.title, this.actions]);
      this.body = h('div', { class: 'lq-panel__body' });
      this.grip = h('div', { class: 'lq-panel__grip', title: 'ドラッグで幅を変更（ダブルクリックで初期の幅に戻す）', 'aria-hidden': 'true' });
      Dom.append(root, [this.head, this.body, this.grip]);
      this._bindResize();
      LQ.FormNav.attach(this.body);
      ctx.bus.on('panel', () => this.render());
      ctx.bus.on('profiles', () => this.render());
      this.render();
    }

    render() {
      const id = this.state.panel;
      if (!id) {
        this.root.hidden = true;
        this._shown = null;
        return;
      }
      const panel = this.panels[id];
      const changed = this._shown !== id;
      this.root.hidden = false;
      this.root.dataset.size = panel.size || 'md';
      this._applyWidth(id);
      this.head.dataset.role = panel.role || '';
      this.icon.className = 'fa-solid fa-' + panel.icon + ' lq-panel__icon';
      this.title.textContent = panel.title;
      Dom.clear(this.actions);
      Dom.append(this.actions, panel.headerActions ? panel.headerActions() : []);
      this.actions.appendChild(LQ.UI.iconButton('xmark', 'パネルを閉じる（Esc）', () => this.state.closePanel()));
      if (changed) {
        Dom.clear(this.body);
        this.body.appendChild(panel.el);
        this.body.scrollTop = 0;
        this.root.style.animation = 'none';
        void this.root.offsetWidth;
        this.root.style.animation = '';
        this._shown = id;
        if (panel.onShow) panel.onShow();
      }
    }

    _widthKey(id) {
      return 'panelWidth:' + id;
    }

    /** 記憶した幅を当てる（画面が狭くなっていれば収まる幅にする。記憶がなければ CSS の初期の幅） */
    _applyWidth(id) {
      const w = LQ.Prefs.get(this._widthKey(id), null);
      this.root.style.width = w ? this._clamp(w) + 'px' : '';
    }

    _clamp(w) {
      const min = parseFloat(getComputedStyle(this.root).getPropertyValue('--w-panel-min')) || 0;
      return Math.round(Util.clamp(w, min, Math.max(min, global.innerWidth * PANEL_MAX_RATIO)));
    }

    _bindResize() {
      this.grip.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const id = this.state.panel;
        const startX = e.clientX;
        const startW = this.root.getBoundingClientRect().width;
        this.grip.setPointerCapture(e.pointerId);
        this.root.classList.add('is-resizing');
        const move = (ev) => {
          this.root.style.width = this._clamp(startW + ev.clientX - startX) + 'px';
        };
        const up = () => {
          this.grip.removeEventListener('pointermove', move);
          this.grip.removeEventListener('pointerup', up);
          this.grip.removeEventListener('pointercancel', up);
          this.root.classList.remove('is-resizing');
          if (id) LQ.Prefs.set(this._widthKey(id), Math.round(this.root.getBoundingClientRect().width));
        };
        this.grip.addEventListener('pointermove', move);
        this.grip.addEventListener('pointerup', up);
        this.grip.addEventListener('pointercancel', up);
      });
      this.grip.addEventListener('dblclick', () => {
        const id = this.state.panel;
        if (!id) return;
        LQ.Prefs.set(this._widthKey(id), null);
        this._applyWidth(id);
        LQ.Flash.el(this.root);
      });
    }
  }

  /* ---------------------------------------------------------------------
   * DropOverlay：ファイルをドラッグすると ① / ② の受け皿を大きく表示する
   * ------------------------------------------------------------------- */
  function hasFiles(e) {
    return !!(e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') !== -1);
  }

  class DropOverlay {
    constructor(ctx, root) {
      this.ctx = ctx;
      this.app = ctx.app;
      this.root = root;
      this.el = null;
      this.depth = 0;
      global.addEventListener('dragenter', (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        this.depth++;
        this.show();
      });
      global.addEventListener('dragover', (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        this._highlight(e.target);
      });
      global.addEventListener('dragleave', (e) => {
        if (!hasFiles(e)) return;
        this.depth = Math.max(0, this.depth - 1);
        if (this.depth === 0) this.hide();
      });
      global.addEventListener('drop', (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        const zone = e.target.closest ? e.target.closest('[data-drop-role]') : null;
        this.depth = 0;
        this.hide();
        const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
        if (!files.length) return;
        const json = files.find((f) => Util.extName(f.name) === 'json');
        if (json) this.app.profiles.importJsonFile(json);
        else if (zone && zone.dataset.dropRole === 'source') this.app.loadFile('source', files[0]);
        else if (zone) this.app.loadTables(files, 'active');
      });
    }

    show() {
      if (this.el) return;
      const s = this.ctx.state;
      const owner = s.profiles.length > 1 ? '抽出条件「' + s.activeProfile.name + '」へ。' : '';
      const zone = (role, icon, title, sub) => h('div', {
        class: 'lq-dropoverlay__zone' + (role === 'condition' ? ' lq-dropoverlay__zone--cond' : ''),
        dataset: { dropRole: role }
      }, [Dom.icon(icon), h('div', { class: 'lq-dropoverlay__title', text: title }), h('div', { class: 'lq-dropoverlay__sub', text: sub })]);
      this.el = h('div', { class: 'lq-dropoverlay' }, [
        zone('source', 'table', '① 元データとして読み込む', '抽出される側のデータ（Excel・CSV）'),
        zone('condition', 'list-check', '② 条件データとして読み込む', owner + '複数のファイル・シートは、表ごとに抽出条件にできます（抽出条件の .json はどちらでも可）')
      ]);
      this.root.appendChild(this.el);
    }

    hide() {
      if (!this.el) return;
      this.el.remove();
      this.el = null;
    }

    _highlight(target) {
      if (!this.el) return;
      const zone = target.closest ? target.closest('[data-drop-role]') : null;
      Dom.qsa('.lq-dropoverlay__zone', this.el).forEach((z) => z.classList.toggle('is-over', z === zone));
    }
  }

  /* ---------------------------------------------------------------------
   * Shell：外枠の組み立てと、画面全体のキーボード・貼り付け操作
   * ------------------------------------------------------------------- */
  class Shell {
    constructor(ctx, panels) {
      this.ctx = ctx;
      this.state = ctx.state;
      this.app = ctx.app;
      this.topbar = new TopBar(ctx, Dom.qs('#lqTopbar'));
      this.rail = new Rail(ctx, Dom.qs('#lqRail'));
      this.host = new PanelHost(ctx, Dom.qs('#lqPanelHost'), panels);
      this.drop = new DropOverlay(ctx, Dom.qs('#lqOverlay'));
      document.addEventListener('keydown', (e) => this._onKey(e));
      document.addEventListener('paste', (e) => {
        if (Dom.isEditable(e.target) || this.app.manual.isOpen() || (this.app.derivedEditor && this.app.derivedEditor.isOpen())) return;
        const data = e.clipboardData;
        if (!data) return;
        e.preventDefault();
        this.app.handlePaste(data.getData('text/plain'), data.files);
      });
    }

    _onKey(e) {
      if (e.key === 'Escape') {
        if (this.ctx.popovers.close()) return;
        if (this.app.manual.isOpen()) {
          this.app.manual.close();
          return;
        }
        if (this.state.panel && !e.defaultPrevented) this.state.closePanel();
        return;
      }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) {
        e.preventDefault();
        const c = this.app.cta();
        if (c.id === 'run' || c.id === 'export') this.app.runCta(this.topbar.cta);
      }
    }
  }

  LQ.Shell = Shell;
})(window);
