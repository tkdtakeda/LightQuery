/* =========================================================================
 * LightQuery - lq-ui-dialogs.js
 * 小窓（ポップオーバー）：その他の操作メニュー、サンプル選択、読み込み先の選択、読み込み範囲の指定（行・列）
 *   出力・根拠は lq-ui-result-dialogs.js、抽出条件まわりは lq-ui-profile-dialogs.js
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Dom = LQ.Dom;
  const Util = LQ.Util;
  const UI = LQ.UI;
  const h = Dom.h;

  const ROLE_LABEL = { source: '① 元データ', condition: '② 条件データ' };

  class Dialogs {
    constructor(ctx) {
      this.ctx = ctx;
      this.state = ctx.state;
      this.app = ctx.app;
      this.pop = ctx.popovers;
    }

    _item(icon, label, sub, onClick, opts) {
      return UI.menuItem(this.pop, icon, label, sub, onClick, opts);
    }

    _head(icon, title) {
      return h('div', { class: 'lq-popover__head' }, [Dom.icon(icon), h('span', { text: title }), UI.iconButton('xmark', '閉じる（Esc）', () => this.pop.close(), 'lq-btn--sm')]);
    }

    /* ---------------- その他の操作（⋮） ---------------- */

    openAppMenu(anchor) {
      if (this.pop.isOpen('menu')) {
        this.pop.close();
        return;
      }
      const s = this.state;
      const hasSample = s.hasSample();
      const own = s.userProfiles().filter((p) => !p.isBlank()).length;
      const hasAny = !!(s.datasets.source || own || s.profiles.items.some((p) => !p.isBlank()));
      const menu = h('div', { class: 'lq-menu' }, [
        this._item('flask', 'サンプルデータを読み込む…', LQ.Samples.list().length + ' 種類のパターンで動作を確認', () => this.openSamples(anchor, 'bottom-end')),
        this._item('file-export', '抽出条件を書き出す（.json）…', '1 件だけ・すべてを選べます（② のデータも含められます）', () => this.app.profileDialogs.openJsonExport(anchor)),
        this._item('folder-open', '抽出条件を読み込む（.json）…', '書き出した .json を追加・置き換え（ドラッグ＆ドロップも可）', () => this.app.pickFile('settings')),
        h('div', { class: 'lq-menu__sep' }),
        this._item('broom', 'サンプルデータのみクリア', hasSample ? 'サンプルの ①・② と抽出条件だけを消去（元に戻せます）' : 'サンプルデータは読み込まれていません',
          () => this.app.profiles.clearSamples(), { disabled: !hasSample }),
        this._item('trash-can', 'すべてクリア', hasAny ? '①・抽出条件（ブラウザの保存分も）・結果を消去（元に戻せます）' : 'クリアするものがありません',
          () => this.app.clearAll(anchor), { danger: true, disabled: !hasAny }),
        h('div', { class: 'lq-menu__sep' }),
        this._item('book-open', '使い方（取扱説明書）', null, () => this.app.manual.open())
      ]);
      this.pop.open(anchor, menu, { key: 'menu' });
    }

    /* ---------------- サンプル ---------------- */

    openSamples(anchor, placement) {
      if (this.pop.isOpen('samples')) {
        this.pop.close();
        return;
      }
      const s = this.state;
      const hasSample = s.hasSample();
      const list = h('div', { class: 'lq-samples' }, LQ.Samples.list().map((sm) => h('button', {
        class: 'lq-sample', type: 'button',
        onclick: () => {
          this.pop.close();
          this.app.profiles.loadSample(sm.id);
        }
      }, [
        h('span', { class: 'lq-sample__icon' }, Dom.icon(sm.icon)),
        h('span', { class: 'lq-sample__title', text: sm.title }),
        h('span', { class: 'lq-sample__desc', text: sm.desc }),
        h('span', { class: 'lq-sample__tags' }, sm.tags.map((t) => h('span', { class: 'lq-tag', text: t })))
      ])));
      const clearBtn = h('button', { class: 'lq-btn lq-btn--sm', type: 'button', disabled: !hasSample,
        onclick: () => {
          this.pop.close();
          this.app.profiles.clearSamples();
        } }, [Dom.icon('broom'), 'サンプルデータのみクリア']);
      this.pop.open(anchor, [
        this._head('flask', 'サンプルデータで試す'),
        h('div', { class: 'lq-popover__body' }, [
          h('p', { class: 'lq-field__hint', text: '選ぶと ① と抽出条件がサンプルに切り替わります。自分の抽出条件は退避され、「サンプルデータのみクリア」で元に戻ります（通知の「元に戻す」でも戻せます）。' }),
          h('div', { class: 'lq-stack' }, [list])
        ]),
        h('div', { class: 'lq-popover__foot' }, [clearBtn, h('span', { class: 'lq-field__hint', text: hasSample ? '自分で読み込んだデータと抽出条件は消えません' : 'サンプルは読み込まれていません' })])
      ], { key: 'samples', size: 'xl', placement: placement || 'bottom-end' });
    }

    /* ---------------- 読み込み先の選択（貼り付け・ファイルの貼り付け） ---------------- */

    openRoleChooser(label, onChoose) {
      let keyHandler = null;
      const choose = (role) => {
        this.pop.close();
        onChoose(role);
      };
      const s = this.state;
      const target = s.profiles.length > 1 ? '（抽出条件「' + s.activeProfile.name + '」）' : '';
      const btn = (role) => h('button', { class: 'lq-btn lq-btn--block' + (role === 'source' ? ' lq-btn--primary' : ''), type: 'button', onclick: () => choose(role) },
        [UI.badge(role === 'source' ? 'src' : 'cond', role === 'source' ? '①' : '②'), (role === 'source' ? '元データ' : '条件データ' + target) + 'として読み込む',
          h('span', { class: 'lq-kbd', text: role === 'source' ? '1' : '2' })]);
      this.pop.open(null, [
        this._head('paste', '読み込む先を選んでください'),
        h('div', { class: 'lq-popover__body' }, [h('div', { class: 'lq-stack' }, [
          h('p', { text: label + ' を読み込みます。' }),
          btn('source'),
          btn('condition'),
          h('p', { class: 'lq-field__hint', text: '① または ② の読み込みパネルを開いた状態で貼り付けると、この確認は出ません。② は選択中の抽出条件に読み込みます。' })
        ])])
      ], {
        key: 'role',
        onClose: () => document.removeEventListener('keydown', keyHandler, true)
      });
      keyHandler = (e) => {
        if (e.key === '1') {
          e.preventDefault();
          choose('source');
        } else if (e.key === '2') {
          e.preventDefault();
          choose('condition');
        }
      };
      document.addEventListener('keydown', keyHandler, true);
    }

    /* ---------------- 読み込み範囲の指定（元のシート表示から） ---------------- */

    openRawRowMenu(anchor, role, rawIndex) {
      const ds = this.state.datasets[role];
      if (!ds) return;
      const rowNo = rawIndex + 1;
      const set = ds.settings;
      const apply = (patch, message) => {
        if (!this.app.updateReadSettings(role, patch)) return;
        this.ctx.toasts.show({ type: 'success', title: message, message: ROLE_LABEL[role] + '：' + Util.formatInt(ds.rowCount) + ' 行 × ' + ds.colCount + ' 列（範囲 ' + ds.stats.rangeText + '）' });
      };
      const belowHeader = !set.hasHeader || rowNo > set.headerRow;
      const menu = h('div', { class: 'lq-menu' }, [
        this._item('heading', 'この行をヘッダー行にする', 'データはこの次の行（' + (rowNo + 1) + ' 行目）から', () => apply({ hasHeader: true, headerRow: rowNo, startRow: rowNo + 1 }, 'ヘッダー行を ' + rowNo + ' 行目にしました')),
        this._item('arrow-right-to-bracket', 'この行からデータを開始', belowHeader ? 'データ開始行を ' + rowNo + ' 行目に' : 'ヘッダー行（' + set.headerRow + ' 行目）より下の行を選んでください',
          () => apply({ startRow: rowNo }, 'データ開始行を ' + rowNo + ' 行目にしました'), { disabled: !belowHeader }),
        this._item('arrow-right-from-bracket', 'この行でデータを終了', rowNo >= set.startRow ? '合計行などを除くときに使います' : 'データ開始行（' + set.startRow + ' 行目）以降の行を選んでください',
          () => apply({ endRow: rowNo }, '終了行を ' + rowNo + ' 行目にしました'), { disabled: rowNo < set.startRow }),
        set.endRow ? this._item('arrows-up-down', '終了行の指定を外す', '最後の行まで読み込みます', () => apply({ endRow: null }, '終了行の指定を外しました')) : null,
        h('div', { class: 'lq-menu__sep' }),
        set.hasHeader
          ? this._item('ban', 'ヘッダーなしにする', 'ヘッダー行（' + set.headerRow + ' 行目）もデータとして読み込み、列名は「列A」「列B」…になります',
            () => apply({ hasHeader: false, startRow: set.headerRow }, 'ヘッダーなしにしました'))
          : this._item('heading', 'ヘッダーありにする', 'この行をヘッダー行にします', () => apply({ hasHeader: true, headerRow: rowNo, startRow: rowNo + 1 }, 'ヘッダー行を ' + rowNo + ' 行目にしました'))
      ]);
      this.pop.open(anchor, [h('div', { class: 'lq-popover__head' }, [Dom.icon('crop-simple'), rowNo + ' 行目'])].concat(menu), { key: 'rawrow', placement: 'bottom-start' });
    }

    openRawColMenu(anchor, role, colIndex) {
      const ds = this.state.datasets[role];
      if (!ds) return;
      const letter = Util.colLetter(colIndex);
      const apply = (startCol, message) => {
        if (!this.app.updateReadSettings(role, { startCol: startCol })) return;
        this.ctx.toasts.show({ type: 'success', title: message, message: ROLE_LABEL[role] + '：' + ds.colCount + ' 列（範囲 ' + ds.stats.rangeText + '）' });
      };
      const menu = h('div', { class: 'lq-menu' }, [
        this._item('arrow-right-to-bracket', letter + ' 列から読み込む', '左側の列は読み込みません', () => apply(colIndex + 1, '開始列を ' + letter + ' 列にしました'),
          { disabled: ds.settings.startCol === colIndex + 1 }),
        ds.settings.startCol > 1 ? this._item('arrow-left', 'A 列から読み込む', '開始列の指定を外します', () => apply(1, '開始列を A 列にしました')) : null
      ]);
      this.pop.open(anchor, [h('div', { class: 'lq-popover__head' }, [Dom.icon('crop-simple'), letter + ' 列'])].concat(menu), { key: 'rawcol', placement: 'bottom-start' });
    }
  }

  LQ.Dialogs = Dialogs;
})(window);
