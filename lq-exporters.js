/* =========================================================================
 * LightQuery - lq-exporters.js
 * 出力：Excel（.xlsx）・CSV（UTF-8 BOM 付き / Shift_JIS / UTF-8 BOM なし）・UTF-16 テキスト・クリップボード
 *   文字化け対策として形式ごとに文字コードと BOM を明示し、Shift_JIS に変換できない文字は数えて報告する。
 *   Excel は複数のシート（まとめ＋抽出条件ごと）に分けて出力できる。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Util = LQ.Util;

  const FORMATS = [
    { id: 'xlsx', label: 'Excel ブック（.xlsx）', ext: 'xlsx', icon: 'file-excel', recommended: true, needsLibrary: true,
      note: '文字化けせず、先頭の 0 や長い数字もそのまま残ります。抽出条件ごとのシートに分けることもでき、「抽出条件」シートに抽出の内容を記録します。' },
    { id: 'csv-utf8-bom', label: 'CSV（UTF-8・BOM 付き）', ext: 'csv', icon: 'file-csv', protectable: true,
      note: 'Excel 2016 以降でダブルクリックして開いても文字化けしません。' },
    { id: 'csv-sjis', label: 'CSV（Shift_JIS）', ext: 'csv', icon: 'file-csv', protectable: true,
      note: '古い Excel や社内システム向け。Shift_JIS にない文字（絵文字・一部の漢字）は「?」になります。' },
    { id: 'csv-utf8', label: 'CSV（UTF-8・BOM なし）', ext: 'csv', icon: 'file-csv', protectable: true,
      note: '他のシステム・ツールへ取り込む場合向け。Excel で直接開くと文字化けします。' },
    { id: 'tsv-utf16', label: 'テキスト（UTF-16・タブ区切り）', ext: 'txt', icon: 'file-lines', protectable: true,
      note: 'Excel の「Unicode テキスト」形式。古い Excel でも文字化けしにくい形式です。' }
  ];

  /* ---------------------------------------------------------------------
   * Cp932Encoder：Shift_JIS（Windows-31J）への変換表を実行時に作る
   *   ブラウザの Shift_JIS 解読器から逆引き表を作り、Windows と同じ優先順位で重複を解決する。
   * ------------------------------------------------------------------- */
  const Cp932Encoder = {
    _table: null,

    _build() {
      const map = new Map();
      const decoder = new TextDecoder('shift_jis');
      const leads = [];
      for (let b = 0x81; b <= 0x9f; b++) leads.push(b);
      for (let b = 0xe0; b <= 0xec; b++) leads.push(b);
      for (let b = 0xfa; b <= 0xfc; b++) leads.push(b);
      for (let b = 0xed; b <= 0xee; b++) leads.push(b);
      const pair = new Uint8Array(2);
      leads.forEach((lead) => {
        for (let trail = 0x40; trail <= 0xfc; trail++) {
          if (trail === 0x7f) continue;
          pair[0] = lead;
          pair[1] = trail;
          const ch = decoder.decode(pair);
          if (ch.length !== 1 || ch === '�') continue;
          const code = ch.charCodeAt(0);
          if (!map.has(code)) map.set(code, (lead << 8) | trail);
        }
      });
      for (let b = 0xa1; b <= 0xdf; b++) map.set(0xff61 + (b - 0xa1), b);
      /* Unicode 変換表の違いで起きる「～」「－」などの文字化け対策 */
      const compat = [[0x301c, 0x8160], [0x2016, 0x8161], [0x2212, 0x817c], [0x2014, 0x815c],
        [0x00a2, 0x8191], [0x00a3, 0x8192], [0x00ac, 0x81ca], [0x00a5, 0x5c], [0x203e, 0x7e]];
      compat.forEach((pairCode) => {
        if (!map.has(pairCode[0])) map.set(pairCode[0], pairCode[1]);
      });
      this._table = map;
    },

    /** @returns {{bytes:Uint8Array, unmappable:number, samples:string[]}} */
    encode(text) {
      if (!this._table) this._build();
      const out = new Uint8Array(text.length * 2);
      let n = 0;
      let unmappable = 0;
      const samples = new Set();
      for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code < 0x80) {
          out[n++] = code;
          continue;
        }
        const v = this._table.get(code);
        if (v === undefined) {
          if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
            if (samples.size < 10) samples.add(text.substr(i, 2));
            i++;
          } else if (samples.size < 10) {
            samples.add(text[i]);
          }
          out[n++] = 0x3f;
          unmappable++;
          continue;
        }
        if (v > 0xff) {
          out[n++] = v >> 8;
          out[n++] = v & 0xff;
        } else {
          out[n++] = v;
        }
      }
      return { bytes: out.slice(0, n), unmappable: unmappable, samples: Array.from(samples) };
    }
  };

  /* ---------------------------------------------------------------------
   * 区切りテキストの組み立て
   * ------------------------------------------------------------------- */
  const RE_NEEDS_QUOTE = /["\r\n]|^\s|\s$/;
  const RE_PROTECT = [/^[+-]?0\d+(?:\.\d+)?$/, /^\d{12,}$/, /^\d{1,2}[\/\-]\d{1,2}$/];

  function escapeField(value, delimiter) {
    if (value === '') return '';
    if (RE_NEEDS_QUOTE.test(value) || value.indexOf(delimiter) !== -1) return '"' + value.replace(/"/g, '""') + '"';
    return value;
  }

  /** Excel で開いたときの自動変換（先頭の 0 落ち・指数表示・日付化）を防ぐ ="..." 形式 */
  function protectForExcel(value) {
    for (let i = 0; i < RE_PROTECT.length; i++) {
      if (RE_PROTECT[i].test(value)) return '="' + value + '"';
    }
    return value;
  }

  function buildDelimited(table, delimiter, protect) {
    const lines = [table.header.map((v) => escapeField(v, delimiter)).join(delimiter)];
    table.forEachRow((row) => {
      const fields = new Array(row.length);
      for (let c = 0; c < row.length; c++) {
        const v = protect ? protectForExcel(row[c]) : row[c];
        fields[c] = escapeField(v, delimiter);
      }
      lines.push(fields.join(delimiter));
    });
    return lines.join('\r\n') + '\r\n';
  }

  function utf16leWithBom(text) {
    const bytes = new Uint8Array(2 + text.length * 2);
    bytes[0] = 0xff;
    bytes[1] = 0xfe;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      bytes[2 + i * 2] = code & 0xff;
      bytes[3 + i * 2] = code >> 8;
    }
    return bytes;
  }

  /* ---------------------------------------------------------------------
   * Excel ブックの組み立て（値の型を推定：数値・日付・文字列）
   * ------------------------------------------------------------------- */
  /* 整数部 11 桁まで（12 桁以上は Excel が指数表示にするため文字列のまま出力） */
  const RE_SAFE_NUMBER = /^-?(?:0|[1-9]\d{0,10})(?:\.\d{1,10})?$/;
  const RE_STRICT_DATE = /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?: (\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
  const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

  function toExcelCell(value) {
    if (value === '') return undefined;
    if (RE_SAFE_NUMBER.test(value)) return { t: 'n', v: Number(value) };
    const m = RE_STRICT_DATE.exec(value);
    if (m) {
      const time = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
      const check = new Date(time);
      if (check.getUTCMonth() === Number(m[2]) - 1 && Number(m[1]) >= 1900) {
        return { t: 'n', v: (time - EXCEL_EPOCH) / 86400000, z: m[4] ? 'yyyy/mm/dd hh:mm:ss' : 'yyyy/mm/dd' };
      }
    }
    return { t: 's', v: value };
  }

  function displayWidth(text) {
    let w = 0;
    for (let i = 0; i < text.length && w < 80; i++) w += text.charCodeAt(i) > 0xff ? 2 : 1;
    return w;
  }

  /* シート名：31 文字まで・: \ / ? * [ ] は使えない・前後の ' は不可・大文字小文字を区別せず重複不可 */
  const SHEET_NAME_MAX = 31;

  function uniqueSheetName(name, used) {
    let base = String(name || '').replace(/[:\\/?*[\]]/g, '_').replace(/^'+|'+$/g, '').trim();
    if (!base || base.toLowerCase() === 'history') base = 'シート' + (used.size + 1);
    base = base.slice(0, SHEET_NAME_MAX);
    let candidate = base;
    let k = 2;
    while (used.has(candidate.toLowerCase())) {
      const suffix = ' (' + k + ')';
      candidate = base.slice(0, SHEET_NAME_MAX - suffix.length) + suffix;
      k++;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  }

  function tableToSheet(XLSX, table) {
    const data = [table.header.map((h) => ({ t: 's', v: h }))];
    const widths = table.header.map((h) => displayWidth(h));
    table.forEachRow((row, i) => {
      const cells = new Array(row.length);
      for (let c = 0; c < row.length; c++) {
        cells[c] = toExcelCell(row[c]);
        if (i < 300) widths[c] = Math.max(widths[c], displayWidth(row[c]));
      }
      data.push(cells);
    });
    const lastCol = Math.max(0, table.header.length - 1);
    const ref = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, data.length - 1), c: lastCol } });
    const ws = { '!data': data, '!ref': ref };
    ws['!cols'] = widths.map((w) => ({ wch: Math.min(60, Math.max(6, w + 2)) }));
    if (table.header.length) ws['!autofilter'] = { ref: ref };
    return ws;
  }

  /**
   * @param {Array<{name:string, table:object}>} sheets データのシート（先頭から順に作る）
   * @param {Array} metaLines 根拠シートの行
   */
  async function buildXlsx(sheets, metaLines) {
    const XLSX = await LQ.ExcelLibrary.ensure();
    const wb = XLSX.utils.book_new();
    const used = new Set();
    sheets.forEach((s) => XLSX.utils.book_append_sheet(wb, tableToSheet(XLSX, s.table), uniqueSheetName(s.name, used)));
    const info = XLSX.utils.aoa_to_sheet(metaLines);
    info['!cols'] = [{ wch: 18 }, { wch: 90 }];
    XLSX.utils.book_append_sheet(wb, info, uniqueSheetName('抽出条件', used));
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true });
    return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  /* ---------------------------------------------------------------------
   * 公開 API
   * ------------------------------------------------------------------- */
  const Exporters = {
    formats: FORMATS,
    Cp932Encoder: Cp932Encoder,

    get(id) {
      return FORMATS.find((f) => f.id === id) || null;
    },

    /** 形式が使えるか（使えなければ理由） */
    availability(id) {
      const format = Exporters.get(id);
      if (!format) return { ok: false, reason: '不明な形式です' };
      if (format.needsLibrary && LQ.ExcelLibrary.failed) return { ok: false, reason: LQ.ExcelLibrary.failureReason };
      return { ok: true, reason: null };
    },

    /**
     * ファイルを作る。
     * @param {string} formatId
     * @param {{header:string[], forEachRow:Function, rowCount:number}} table 出力する表（CSV はこの表だけ）
     * @param {{metaLines:Array, protect:boolean, sheets?:Array<{name:string, table:object}>}} options
     *        sheets を渡すと Excel はそのシート構成で作る（まとめ＋抽出条件ごと など）
     * @returns {Promise<{blob:Blob, warnings:string[]}>}
     */
    async build(formatId, table, options) {
      const opts = options || {};
      const warnings = [];
      let blob;
      switch (formatId) {
        case 'xlsx':
          blob = await buildXlsx(opts.sheets && opts.sheets.length ? opts.sheets : [{ name: '抽出結果', table: table }], opts.metaLines || [['項目', '内容']]);
          break;
        case 'csv-utf8-bom':
          blob = new Blob(['﻿' + buildDelimited(table, ',', opts.protect)], { type: 'text/csv;charset=utf-8' });
          break;
        case 'csv-utf8':
          blob = new Blob([buildDelimited(table, ',', opts.protect)], { type: 'text/csv;charset=utf-8' });
          break;
        case 'csv-sjis': {
          const encoded = Cp932Encoder.encode(buildDelimited(table, ',', opts.protect));
          if (encoded.unmappable) {
            warnings.push('Shift_JIS にない文字 ' + Util.formatInt(encoded.unmappable) + ' 文字を「?」に置き換えました（例：' +
              encoded.samples.join(' ') + '）。Excel 形式か UTF-8 形式なら置き換えずに出力できます。');
          }
          blob = new Blob([encoded.bytes], { type: 'text/csv;charset=shift_jis' });
          break;
        }
        case 'tsv-utf16':
          blob = new Blob([utf16leWithBom(buildDelimited(table, '\t', opts.protect))], { type: 'text/plain;charset=utf-16le' });
          break;
        default:
          throw new Error('不明な出力形式です');
      }
      return { blob: blob, warnings: warnings };
    },

    /** クリップボード用（Excel に貼り付けられるタブ区切り） */
    toClipboardText(table) {
      return buildDelimited(table, '\t', false);
    },

    download(blob, fileName) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.className = 'lq-offscreen';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    },

    async copyText(text) {
      try {
        if (navigator.clipboard && global.isSecureContext) {
          await navigator.clipboard.writeText(text);
          return true;
        }
      } catch (e) {
        /* 下の方法で再試行する */
      }
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.className = 'lq-offscreen';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (e) {
        ok = false;
      }
      ta.remove();
      return ok;
    }
  };

  LQ.Exporters = Exporters;
})(window);
