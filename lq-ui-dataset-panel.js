/* =========================================================================
 * LightQuery - lq-ui-dataset-panel.js
 * ① 元データ / ② 条件データの読み込みパネル：
 *   ファイル（選択・シート・文字コード・区切り文字と判定の根拠）、読み込み範囲（ヘッダー・開始行・開始列・終了行）、
 *   読み込み結果（行数・列数・列名）。入力欄は作り直さず値だけ更新し、フォーカスを保つ。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Dom = LQ.Dom;
  const Util = LQ.Util;
  const UI = LQ.UI;
  const Flash = LQ.Flash;
  const h = Dom.h;

  const KIND_ICON = { excel: 'file-excel', csv: 'file-csv', paste: 'paste', sample: 'flask' };
  const COLUMN_CHIP_LIMIT = 60;
  const FIELD_LABEL = { hasHeader: 'ヘッダー', headerRow: 'ヘッダー行', startRow: 'データ開始行', startCol: '開始列', endRow: '終了行' };

  class DatasetPanel {
    constructor(ctx, role) {
      this.ctx = ctx;
      this.state = ctx.state;
      this.app = ctx.app;
      this.role = role;
      this.isSource = role === 'source';
      this.title = this.isSource ? '① 元データ' : '② 条件データ';
      this.icon = this.isSource ? 'table' : 'list-check';
      this.size = 'md';
      this.el = h('div');
      this.f = {};
      this._builtKey = undefined;
      ctx.bus.on('datasets', () => this.refresh());
      ctx.bus.on('change', (e) => {
        if (e.topic === 'library') this.refresh(true);
      });
      this.refresh();
    }

    onShow() {
      this.refresh();
    }

    refresh(force) {
      const ds = this.state.datasets[this.role];
      const key = ds ? ds.id + ':' + ds.source.kind : null;
      if (force || key !== this._builtKey) {
        this._build(ds);
        this._builtKey = key;
      }
      if (ds) this._update(ds);
    }

    /* ---------------- 組み立て ---------------- */

    _build(ds) {
      Dom.clear(this.el);
      this.f = {};
      if (!ds) {
        this.el.appendChild(this._emptySection());
        return;
      }
      this.el.appendChild(this._fileSection(ds));
      this.el.appendChild(this._rangeSection());
      this.el.appendChild(this._resultSection());
    }

    _emptySection() {
      const pick = () => this.app.pickFile(this.role);
      const drop = h('div', {
        class: 'lq-drop lq-drop--compact' + (this.isSource ? '' : ' lq-drop--cond'), role: 'button', tabindex: '0', onclick: pick,
        onkeydown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            pick();
          }
        }
      }, [
        Dom.icon('file-arrow-up', 'lq-drop__icon'),
        h('div', { class: 'lq-drop__title', text: 'ファイルを選択' }),
        h('div', { class: 'lq-drop__sub', text: 'Excel（.xlsx .xlsm .xls .xlsb .ods）・CSV・TSV・TXT' }),
        h('div', { class: 'lq-drop__sub', text: 'ドラッグ＆ドロップ、または Excel でコピーした範囲を Ctrl+V でも読み込めます' })
      ]);
      const notes = [];
      const lib = LQ.ExcelLibrary;
      if (lib.failed) notes.push(UI.note('warn', lib.failureReason));
      notes.push(UI.note('info', this.isSource
        ? '抽出される側のデータです。読み込むとヘッダー行・データ開始行・開始列を自動で判定し、このパネルで調整できます。'
        : '② の 1 行が 1 セットの条件になります（例：地域＝東京 かつ 金額≧50,000）。空欄のセルは、その条件を判定しません。'));
      return UI.section('ファイル', [drop].concat(notes));
    }

    _fileSection(ds) {
      const src = ds.source;
      this.f.name = h('div', { class: 'lq-filecard__name' });
      this.f.meta = h('div', { class: 'lq-filecard__meta' });
      const card = h('div', { class: 'lq-filecard' + (this.isSource ? '' : ' lq-filecard--cond') }, [
        Dom.icon(KIND_ICON[src.kind] || 'file', 'lq-filecard__icon'),
        h('div', { class: 'lq-filecard__body' }, [this.f.name, this.f.meta]),
        h('div', { class: 'lq-filecard__actions' }, [
          h('button', { class: 'lq-btn lq-btn--xs', type: 'button', title: '別のファイルに置き換える（元に戻せます）', onclick: () => this.app.pickFile(this.role) },
            [Dom.icon('file-import'), '別のファイル']),
          h('button', { class: 'lq-btn lq-btn--xs lq-btn--danger', type: 'button', title: 'このデータを閉じる（元に戻せます）', onclick: () => this.app.clearDataset(this.role) },
            [Dom.icon('xmark'), '閉じる'])
        ])
      ]);
      const children = [card];
      if (src.hasSheets) {
        this.f.sheet = h('select', { class: 'lq-select' });
        this.f.sheet.addEventListener('change', () => {
          const cur = this.state.datasets[this.role];
          if (!cur || this.f.sheet.value === cur.source.sheetName) return;
          this.app.changeSourceChoice(this.role, 'sheet', this.f.sheet.value);
          Flash.input(this.f.sheet);
        });
        children.push(UI.field('シート', this.f.sheet, 'シートを切り替えると、読み込み範囲を自動で判定し直します'));
      }
      if (src.hasEncoding) {
        this.f.encoding = h('select', { class: 'lq-select' });
        this.f.encodingReason = h('div', { class: 'lq-reason' });
        this.f.encoding.addEventListener('change', () => this._changeChoice('encoding', this.f.encoding));
        children.push(UI.field('文字コード', this.f.encoding));
        children.push(this.f.encodingReason);
      }
      if (src.hasDelimiter) {
        this.f.delimiter = h('select', { class: 'lq-select' });
        this.f.delimiterReason = h('div', { class: 'lq-reason' });
        this.f.delimiter.addEventListener('change', () => this._changeChoice('delimiter', this.f.delimiter));
        children.push(UI.field('区切り文字', this.f.delimiter));
        children.push(this.f.delimiterReason);
      }
      return UI.section('ファイル', children);
    }

    _rangeSection() {
      this.f.hasHeader = new LQ.Segmented([
        { value: true, label: 'ヘッダーあり', icon: 'heading' },
        { value: false, label: 'ヘッダーなし', icon: 'ban' }
      ], true, (v) => this._toggleHeader(v), 'lq-seg--block');
      this.f.headerRow = this._numberInput('headerRow', '例：1');
      this.f.startRow = this._numberInput('startRow', '例：2');
      this.f.startCol = h('input', { class: 'lq-input', type: 'text', placeholder: '例：A', title: '列記号（B）または列番号（2）' });
      this.f.startCol.addEventListener('change', () => this._changeStartCol());
      this.f.endRow = this._numberInput('endRow', '最後まで');
      this.f.autoReason = h('div', { class: 'lq-reason' });
      const reset = h('button', { class: 'lq-btn lq-btn--xs', type: 'button', title: '読み込み範囲を自動判定の結果に戻す', onclick: () => this.app.resetReadSettings(this.role) },
        [Dom.icon('wand-magic-sparkles'), '自動判定に戻す']);
      return UI.section('読み込み範囲', [
        UI.field('ヘッダー（列名の行）', this.f.hasHeader.el),
        h('div', { class: 'lq-rangegrid' }, [
          UI.field(FIELD_LABEL.headerRow, this.f.headerRow, 'ヘッダーなしのときは使いません'),
          UI.field(FIELD_LABEL.startRow, this.f.startRow, 'データが始まる行'),
          UI.field(FIELD_LABEL.startCol, this.f.startCol, '列記号（B）または番号（2）'),
          UI.field(FIELD_LABEL.endRow, this.f.endRow, '空欄＝最後の行まで（合計行を除くときに指定）')
        ]),
        this.f.autoReason,
        UI.note('tip', '右の表（読み込み範囲）の行番号や列記号をクリックしても指定できます。Enter で次の欄へ進みます。')
      ], [reset]);
    }

    _resultSection() {
      this.f.status = h('div');
      this.f.detail = h('div', { class: 'lq-reason' });
      this.f.columns = h('div', { class: 'lq-colchips' });
      return UI.section('読み込み結果', [this.f.status, this.f.detail, this.f.columns]);
    }

    _numberInput(key, placeholder) {
      const input = h('input', { class: 'lq-input lq-num', type: 'text', inputmode: 'numeric', placeholder: placeholder });
      input.addEventListener('change', () => {
        const ds = this.state.datasets[this.role];
        if (!ds) return;
        const n = Util.parseRowRef(input.value);
        const cur = ds.settings[key];
        if (key === 'endRow' && n === null) {
          input.classList.remove('is-invalid');
          if (cur !== null) this._apply({ endRow: null }, input);
          return;
        }
        if (n === null || Number.isNaN(n)) {
          this._invalid(input, FIELD_LABEL[key] + 'は 1 以上の整数で入力してください');
          return;
        }
        input.classList.remove('is-invalid');
        if (n === cur) {
          input.value = String(cur);
          return;
        }
        const patch = {};
        patch[key] = n;
        this._apply(patch, input);
      });
      return input;
    }

    /* ---------------- 変更の適用 ---------------- */

    /** ヘッダーの有無を切り替える（読み込む範囲は同じまま：ヘッダー行⇔先頭のデータ行） */
    _toggleHeader(hasHeader) {
      const ds = this.state.datasets[this.role];
      if (!ds || ds.settings.hasHeader === hasHeader) return;
      const set = ds.settings;
      const patch = hasHeader
        ? { hasHeader: true, headerRow: set.startRow, startRow: set.startRow + 1 }
        : { hasHeader: false, startRow: set.headerRow };
      this._apply(patch, this.f.hasHeader.el);
    }

    _changeChoice(kind, select) {
      const ds = this.state.datasets[this.role];
      if (!ds) return;
      const current = kind === 'encoding' ? ds.source.encodingChoice : ds.source.delimiterChoice;
      if (select.value === current) return;
      this.app.changeSourceChoice(this.role, kind, select.value);
      Flash.input(select);
    }

    _changeStartCol() {
      const ds = this.state.datasets[this.role];
      if (!ds) return;
      const input = this.f.startCol;
      const n = Util.parseColumnRef(input.value);
      if (Number.isNaN(n)) {
        this._invalid(input, '開始列は列記号（A〜）または 1 以上の番号で入力してください');
        return;
      }
      input.classList.remove('is-invalid');
      if (n === ds.settings.startCol) {
        input.value = Util.colLetter(n - 1);
        return;
      }
      this._apply({ startCol: n }, input);
    }

    _invalid(input, message) {
      input.classList.add('is-invalid');
      Flash.el(input, 'warn');
      this.ctx.toasts.show({ type: 'warn', title: message });
    }

    _apply(patch, sourceEl) {
      const result = this.app.updateReadSettings(this.role, patch);
      if (!result) {
        this.refresh(true);
        return;
      }
      if (sourceEl && sourceEl.tagName) Flash.input(sourceEl);
      else if (sourceEl) Flash.el(sourceEl);
      const ds = this.state.datasets[this.role];
      const extra = result.adjusted.filter((key) => !(key in patch));
      extra.forEach((key) => {
        const el = key === 'hasHeader' ? this.f.hasHeader.el : this.f[key];
        if (el && el.tagName === 'INPUT') Flash.input(el, 'warn', '自動調整');
      });
      if (extra.length && ds) {
        const texts = extra.map((key) => FIELD_LABEL[key] + 'を' + this._settingText(ds.settings, key) + 'に');
        this.ctx.toasts.show({ type: 'info', title: texts.join('・') + '合わせました', message: 'ヘッダー行・データ開始行・終了行の前後関係が崩れないよう自動で調整しました。' });
      }
    }

    _settingText(set, key) {
      if (key === 'startCol') return Util.colLetter(set.startCol - 1) + ' 列';
      if (key === 'endRow') return set.endRow ? set.endRow + ' 行目' : '最後まで';
      if (key === 'hasHeader') return set.hasHeader ? 'あり' : 'なし';
      return set[key] + ' 行目';
    }

    /* ---------------- 表示の更新 ---------------- */

    _update(ds) {
      const src = ds.source;
      const set = ds.settings;
      this.f.name.textContent = ds.name;
      this.f.name.title = ds.name;
      Dom.clear(this.f.meta);
      Dom.append(this.f.meta, [
        h('span', { text: src.kindLabel }),
        src.size ? h('span', { class: 'lq-num', text: Util.formatBytes(src.size) }) : null,
        h('span', { class: 'lq-num', text: Util.formatInt(ds.rowCount) + ' 行 × ' + ds.colCount + ' 列' }),
        ds.isSample ? h('span', { class: 'lq-tag lq-tag--sample', text: 'サンプル' }) : null
      ]);
      if (this.f.sheet) {
        UI.fillSelect(this.f.sheet, src.sheetNames.map((n) => ({ value: n, label: n })), src.sheetName);
      }
      if (this.f.encoding) {
        const detected = src.encodingChoice === 'auto' && src.encoding ? LQ.EncodingDetector.label(src.encoding.value) : '';
        UI.fillSelect(this.f.encoding, [{ value: 'auto', label: '自動' + (detected ? '（判定：' + detected + '）' : '') }]
          .concat(LQ.EncodingDetector.list.map((e) => ({ value: e.value, label: e.label }))), src.encodingChoice);
        this._reason(this.f.encodingReason, src.encoding, '文字化けしている場合は、文字コードを切り替えてください（表示がすぐ変わります）。');
      }
      if (this.f.delimiter) {
        const detected = src.delimiterChoice === 'auto' && src.delimiter ? LQ.CsvParser.delimiterLabel(src.delimiter.value) : '';
        UI.fillSelect(this.f.delimiter, [{ value: 'auto', label: '自動' + (detected ? '（判定：' + detected + '）' : '') }]
          .concat(LQ.CsvParser.delimiters.map((d) => ({ value: d.value, label: d.label }))), src.delimiterChoice);
        this._reason(this.f.delimiterReason, src.delimiter, '列が正しく分かれていない場合は、区切り文字を切り替えてください。');
      }
      this.f.hasHeader.set(set.hasHeader);
      this.f.headerRow.disabled = !set.hasHeader;
      this.f.headerRow.value = String(set.headerRow);
      this.f.startRow.value = String(set.startRow);
      this.f.startCol.value = Util.colLetter(set.startCol - 1);
      this.f.endRow.value = set.endRow ? String(set.endRow) : '';
      ['headerRow', 'startRow', 'startCol', 'endRow'].forEach((key) => this.f[key].classList.remove('is-invalid'));
      const isAuto = JSON.stringify(LQ.Dataset.normalizeSettings(ds.auto.settings)) === JSON.stringify(set);
      Dom.clear(this.f.autoReason);
      Dom.append(this.f.autoReason, [Dom.icon('wand-magic-sparkles'),
        h('span', { text: (isAuto ? '自動判定のまま：' : '自動判定の結果（現在は変更済み）：') + ds.auto.reasons.join('／') })]);
      this._updateResult(ds);
    }

    _reason(el, info, fallback) {
      Dom.clear(el);
      if (!info) return;
      const uncertain = info.certain === false;
      Dom.append(el, [Dom.icon(uncertain ? 'triangle-exclamation' : 'circle-info'),
        h('span', { text: (info.auto ? '判定の根拠：' + info.reason : '手動で指定しています') + '。' + fallback })]);
      el.classList.toggle('lq-status--warn', uncertain);
    }

    _updateResult(ds) {
      Dom.clear(this.f.status);
      this.f.status.appendChild(ds.rowCount
        ? UI.status('ok', Util.formatInt(ds.rowCount) + ' 行 × ' + ds.colCount + ' 列を読み込みます')
        : UI.status('warn', 'データ行がありません。ヘッダー行・データ開始行を確認してください'));
      Dom.clear(this.f.detail);
      Dom.append(this.f.detail, [Dom.icon('crop-simple'), h('span', {
        text: '範囲 ' + ds.stats.rangeText + (ds.stats.skippedEmpty ? '・空行 ' + Util.formatInt(ds.stats.skippedEmpty) + ' 行を除外' : '') +
          '・元の表は ' + Util.formatInt(ds.rawRowCount) + ' 行'
      })]);
      Dom.clear(this.f.columns);
      ds.columns.slice(0, COLUMN_CHIP_LIMIT).forEach((c) => {
        this.f.columns.appendChild(h('span', { class: 'lq-colchip', title: c.letter + ' 列：' + c.name }, [
          h('span', { class: 'lq-colchip__letter', text: c.letter }), h('span', { class: 'lq-colchip__name', text: c.name })
        ]));
      });
      if (ds.columns.length > COLUMN_CHIP_LIMIT) {
        this.f.columns.appendChild(h('span', { class: 'lq-colchip', text: '＋' + (ds.columns.length - COLUMN_CHIP_LIMIT) + ' 列' }));
      }
    }
  }

  LQ.DatasetPanel = DatasetPanel;
})(window);
