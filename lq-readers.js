/* =========================================================================
 * LightQuery - lq-readers.js
 * 読み込み：文字コード判定・CSV 解析・Excel（SheetJS）・貼り付け
 * 読み込んだ結果はすべて「文字列の二次元配列（grid）」にそろえる。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;

  /* ---------------------------------------------------------------------
   * ExcelLibrary：SheetJS を必要になった時点で CDN から読み込む
   * ------------------------------------------------------------------- */
  const XLSX_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';

  const ExcelLibrary = {
    state: global.XLSX ? 'ready' : 'idle',
    _promise: null,
    _listeners: new Set(),

    get failed() {
      return this.state === 'failed';
    },

    get failureReason() {
      return 'Excel 用ライブラリ（SheetJS）を読み込めませんでした。インターネット接続を確認してください。CSV と貼り付けは使えます。';
    },

    subscribe(fn) {
      this._listeners.add(fn);
      return () => this._listeners.delete(fn);
    },

    _setState(state) {
      this.state = state;
      this._listeners.forEach((fn) => fn(state));
    },

    ensure() {
      if (global.XLSX) {
        if (this.state !== 'ready') this._setState('ready');
        return Promise.resolve(global.XLSX);
      }
      if (this._promise) return this._promise;
      this._setState('loading');
      this._promise = new Promise((resolve, reject) => {
        const fail = () => {
          this._promise = null;
          this._setState('failed');
          reject(new Error(this.failureReason));
        };
        const script = document.createElement('script');
        script.src = XLSX_URL;
        script.async = true;
        script.onload = () => {
          if (global.XLSX) {
            this._setState('ready');
            resolve(global.XLSX);
          } else {
            fail();
          }
        };
        script.onerror = fail;
        document.head.appendChild(script);
      });
      return this._promise;
    }
  };

  /* ---------------------------------------------------------------------
   * EncodingDetector：BOM → UTF-8 → Shift_JIS → EUC-JP の順に「正しく読めるか」で判定
   * ------------------------------------------------------------------- */
  const ENCODINGS = [
    { value: 'utf-8', label: 'UTF-8' },
    { value: 'shift_jis', label: 'Shift_JIS' },
    { value: 'euc-jp', label: 'EUC-JP' },
    { value: 'utf-16le', label: 'UTF-16LE' },
    { value: 'utf-16be', label: 'UTF-16BE' }
  ];
  const SAMPLE_BYTES = 4 * 1024 * 1024;

  function canDecode(bytes, encoding) {
    try {
      new TextDecoder(encoding, { fatal: true }).decode(bytes);
      return true;
    } catch (e) {
      return false;
    }
  }

  function isAscii(bytes) {
    for (let i = 0; i < bytes.length; i++) if (bytes[i] > 0x7f) return false;
    return true;
  }

  /** 判定用に先頭部分を改行位置で切り出す（多バイト文字の途中で切らない） */
  function sampleForDetect(bytes) {
    if (bytes.length <= SAMPLE_BYTES) return bytes;
    let end = SAMPLE_BYTES;
    while (end > 0 && bytes[end - 1] !== 0x0a) end--;
    return end > 0 ? bytes.subarray(0, end) : bytes.subarray(0, SAMPLE_BYTES);
  }

  const EncodingDetector = {
    list: ENCODINGS,

    label(value) {
      const found = ENCODINGS.find((e) => e.value === value);
      return found ? found.label : value;
    },

    detect(bytes) {
      if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        return { encoding: 'utf-8', reason: '先頭に BOM（UTF-8 の目印）があるため', certain: true };
      }
      if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
        return { encoding: 'utf-16le', reason: '先頭に BOM（UTF-16LE の目印）があるため', certain: true };
      }
      if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
        return { encoding: 'utf-16be', reason: '先頭に BOM（UTF-16BE の目印）があるため', certain: true };
      }
      const sample = sampleForDetect(bytes);
      if (isAscii(sample)) {
        return { encoding: 'utf-8', reason: '半角英数字のみのため（どの文字コードでも同じ内容）', certain: true };
      }
      if (canDecode(sample, 'utf-8')) {
        return { encoding: 'utf-8', reason: 'UTF-8 として矛盾なく読めるため', certain: true };
      }
      const sjis = canDecode(sample, 'shift_jis');
      const euc = canDecode(sample, 'euc-jp');
      if (sjis && !euc) return { encoding: 'shift_jis', reason: 'UTF-8 では読めず、Shift_JIS として矛盾なく読めるため', certain: true };
      if (euc && !sjis) return { encoding: 'euc-jp', reason: 'UTF-8 では読めず、EUC-JP として矛盾なく読めるため', certain: true };
      if (sjis && euc) return { encoding: 'shift_jis', reason: 'Shift_JIS と EUC-JP のどちらでも読めるため、一般的な Shift_JIS を採用', certain: false };
      return { encoding: 'shift_jis', reason: 'どの文字コードでも一部が読めないため Shift_JIS で表示（文字化けの可能性あり）', certain: false };
    },

    decode(bytes, encoding) {
      return new TextDecoder(encoding).decode(bytes);
    }
  };

  /* ---------------------------------------------------------------------
   * CsvParser：引用符・改行入りセルに対応した区切り文字テキストの解析
   * ------------------------------------------------------------------- */
  const DELIMITERS = [
    { value: ',', label: 'カンマ（,）' },
    { value: '\t', label: 'タブ' },
    { value: ';', label: 'セミコロン（;）' },
    { value: '|', label: '縦棒（|）' }
  ];

  const CsvParser = {
    delimiters: DELIMITERS,

    delimiterLabel(value) {
      const found = DELIMITERS.find((d) => d.value === value);
      return found ? found.label : value;
    },

    /** 先頭 30 行で「各行に同じ数だけ現れる」区切り文字を選ぶ */
    detectDelimiter(text, preferred) {
      const sample = text.slice(0, 64 * 1024);
      const lines = [];
      let inQuotes = false;
      let current = '';
      for (let i = 0; i < sample.length && lines.length < 30; i++) {
        const ch = sample[i];
        if (ch === '"') inQuotes = !inQuotes;
        if (!inQuotes && (ch === '\n' || ch === '\r')) {
          if (current !== '') lines.push(current);
          current = '';
          continue;
        }
        if (!inQuotes) current += ch;
      }
      if (current !== '' && lines.length < 30) lines.push(current);
      let best = null;
      DELIMITERS.forEach((d) => {
        const counts = lines.map((line) => line.split(d.value).length - 1);
        const nonZero = counts.filter((c) => c > 0);
        if (!nonZero.length) return;
        const freq = new Map();
        nonZero.forEach((c) => freq.set(c, (freq.get(c) || 0) + 1));
        let mode = 0;
        let modeCount = 0;
        freq.forEach((cnt, val) => {
          if (cnt > modeCount || (cnt === modeCount && val > mode)) {
            mode = val;
            modeCount = cnt;
          }
        });
        const score = (modeCount / lines.length) * 1000 + mode;
        if (!best || score > best.score) best = { value: d.value, score: score, consistency: modeCount / lines.length };
      });
      if (!best) {
        const fallback = preferred || ',';
        return { delimiter: fallback, reason: '区切り文字が見つからないため 1 列のデータとして読み込み' };
      }
      const pct = Math.round(best.consistency * 100);
      return { delimiter: best.value, reason: '先頭の行の ' + pct + '% で同じ数だけ現れるため' };
    },

    parse(text, delimiter) {
      const rows = [];
      const d = delimiter.charCodeAt(0);
      const n = text.length;
      let row = [];
      let field = '';
      let i = 0;
      let inQuotes = false;
      let fieldStarted = false;
      while (i < n) {
        const c = text.charCodeAt(i);
        if (inQuotes) {
          if (c === 34) {
            if (text.charCodeAt(i + 1) === 34) {
              field += '"';
              i += 2;
            } else {
              inQuotes = false;
              i += 1;
            }
            continue;
          }
          const next = text.indexOf('"', i);
          if (next === -1) {
            field += text.slice(i);
            i = n;
          } else {
            field += text.slice(i, next);
            i = next;
          }
          continue;
        }
        if (c === 34 && !fieldStarted) {
          inQuotes = true;
          fieldStarted = true;
          i += 1;
          continue;
        }
        if (c === d) {
          row.push(field);
          field = '';
          fieldStarted = false;
          i += 1;
          continue;
        }
        if (c === 10 || c === 13) {
          row.push(field);
          rows.push(row);
          row = [];
          field = '';
          fieldStarted = false;
          i += (c === 13 && text.charCodeAt(i + 1) === 10) ? 2 : 1;
          continue;
        }
        let j = i + 1;
        while (j < n) {
          const cj = text.charCodeAt(j);
          if (cj === d || cj === 10 || cj === 13) break;
          j++;
        }
        field += text.slice(i, j);
        fieldStarted = true;
        i = j;
      }
      if (fieldStarted || field !== '' || row.length) {
        row.push(field);
        rows.push(row);
      }
      return rows;
    }
  };

  /* ---------------------------------------------------------------------
   * ExcelReader：ブックの読み込みとシート → grid 変換
   * 数値は元の値、日付は yyyy/mm/dd 形式にそろえる（表示形式による丸めを避ける）
   * ------------------------------------------------------------------- */
  const EXCEL_ERRORS = { 0: '#NULL!', 7: '#DIV/0!', 15: '#VALUE!', 23: '#REF!', 29: '#NAME?', 36: '#NUM!', 42: '#N/A', 43: '#GETTING_DATA' };

  function formatNumber(value) {
    if (Number.isInteger(value)) return String(value);
    return String(parseFloat(value.toPrecision(15)));
  }

  function formatDateCode(dc, serial) {
    const pad = LQ.Util.pad2;
    const hasTime = (dc.H || dc.M || dc.S);
    if (Math.floor(serial) === 0 && hasTime) {
      return dc.H + ':' + pad(dc.M) + (dc.S ? ':' + pad(dc.S) : '');
    }
    let text = dc.y + '/' + pad(dc.m) + '/' + pad(dc.d);
    if (hasTime) text += ' ' + pad(dc.H) + ':' + pad(dc.M) + (dc.S ? ':' + pad(dc.S) : '');
    return text;
  }

  function cellToText(XLSX, cell, date1904) {
    if (!cell) return '';
    switch (cell.t) {
      case 's':
      case 'str':
        return cell.v === null || cell.v === undefined ? '' : String(cell.v);
      case 'n':
        if (cell.z && XLSX.SSF.is_date(cell.z)) {
          const dc = XLSX.SSF.parse_date_code(cell.v, { date1904: date1904 });
          if (dc) return formatDateCode(dc, cell.v);
        }
        return formatNumber(cell.v);
      case 'b':
        return cell.v ? 'TRUE' : 'FALSE';
      case 'e':
        return cell.w || EXCEL_ERRORS[cell.v] || '#ERROR';
      case 'd':
        return cell.v instanceof Date ? LQ.ValueParser.formatDate(cell.v.getTime()) : String(cell.v);
      case 'z':
        return '';
      default:
        return cell.v === null || cell.v === undefined ? '' : String(cell.v);
    }
  }

  const ExcelReader = {
    async readWorkbook(buffer) {
      const XLSX = await ExcelLibrary.ensure();
      return XLSX.read(new Uint8Array(buffer), {
        type: 'array',
        dense: true,
        cellDates: false,
        cellNF: true,
        cellText: false,
        cellFormula: false,
        cellHTML: false,
        cellStyles: false
      });
    },

    /** 空でない最初のシート名（なければ先頭） */
    firstUsedSheet(workbook) {
      const names = workbook.SheetNames || [];
      const used = names.find((name) => {
        const ws = workbook.Sheets[name];
        return ws && ws['!ref'];
      });
      return used || names[0] || '';
    },

    sheetToGrid(workbook, name) {
      const XLSX = global.XLSX;
      const ws = workbook.Sheets[name];
      if (!ws || !ws['!ref']) return [];
      const range = XLSX.utils.decode_range(ws['!ref']);
      const props = workbook.Workbook && workbook.Workbook.WBProps;
      const date1904 = !!(props && props.date1904);
      const dense = ws['!data'];
      const grid = [];
      for (let r = 0; r <= range.e.r; r++) {
        const rowCells = dense ? dense[r] : null;
        const row = [];
        let last = -1;
        if (r >= range.s.r) {
          for (let c = 0; c <= range.e.c; c++) {
            const cell = dense ? (rowCells ? rowCells[c] : undefined) : ws[XLSX.utils.encode_cell({ r: r, c: c })];
            const text = c >= range.s.c ? cellToText(XLSX, cell, date1904) : '';
            row.push(text);
            if (text !== '') last = c;
          }
        }
        row.length = last + 1;
        grid.push(row);
      }
      return grid;
    }
  };

  /* ---------------------------------------------------------------------
   * SourceFile：読み込んだファイル（または貼り付け）を保持し、
   *   文字コード・区切り文字・シートを切り替えて grid を作り直せるようにする
   * ------------------------------------------------------------------- */
  const EXCEL_EXT = new Set(['xlsx', 'xlsm', 'xls', 'xlsb', 'ods']);
  const TEXT_EXT = new Set(['csv', 'tsv', 'txt']);
  const KIND_LABEL = { excel: 'Excel', csv: 'CSV', paste: '貼り付け', sample: 'サンプル' };

  function sniffKind(bytes) {
    if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) return 'excel';
    if (bytes.length >= 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) return 'excel';
    return 'csv';
  }

  class SourceFile {
    constructor(kind, name, size) {
      this.kind = kind;
      this.name = name;
      this.size = size || 0;
      this.grid = [];
      this.encodingChoice = 'auto';
      this.delimiterChoice = 'auto';
      this.encoding = null;
      this.delimiter = null;
      this.sheetName = '';
      this.sheetNames = [];
      this._bytes = null;
      this._text = null;
      this._workbook = null;
    }

    static isSupportedName(name) {
      const ext = LQ.Util.extName(name);
      return EXCEL_EXT.has(ext) || TEXT_EXT.has(ext);
    }

    static async fromFile(file) {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const ext = LQ.Util.extName(file.name);
      const kind = EXCEL_EXT.has(ext) ? 'excel' : (TEXT_EXT.has(ext) ? 'csv' : sniffKind(bytes));
      const src = new SourceFile(kind, file.name, file.size);
      if (kind === 'excel') {
        src._workbook = await ExcelReader.readWorkbook(buffer);
        src.sheetNames = src._workbook.SheetNames.slice();
        src.sheetName = ExcelReader.firstUsedSheet(src._workbook);
      } else {
        src._bytes = bytes;
        if (ext === 'tsv') src.delimiterChoice = '\t';
      }
      src.build();
      return src;
    }

    static fromText(text, name) {
      const src = new SourceFile('paste', name, text.length);
      src._text = text;
      src.build();
      return src;
    }

    static fromGrid(grid, name, kind) {
      const src = new SourceFile(kind || 'sample', name, 0);
      src.grid = grid;
      return src;
    }

    get kindLabel() {
      return KIND_LABEL[this.kind] || this.kind;
    }

    get hasEncoding() {
      return this.kind === 'csv';
    }

    get hasDelimiter() {
      return this.kind === 'csv' || this.kind === 'paste';
    }

    get hasSheets() {
      return this.kind === 'excel';
    }

    build() {
      if (this.kind === 'excel') {
        this.grid = ExcelReader.sheetToGrid(this._workbook, this.sheetName);
        return;
      }
      if (this.kind === 'sample') return;
      let text = this._text;
      if (this.kind === 'csv') {
        if (this.encodingChoice === 'auto') {
          const detected = EncodingDetector.detect(this._bytes);
          this.encoding = { value: detected.encoding, reason: detected.reason, certain: detected.certain, auto: true };
        } else {
          this.encoding = { value: this.encodingChoice, reason: '手動で指定', certain: true, auto: false };
        }
        text = EncodingDetector.decode(this._bytes, this.encoding.value);
      }
      if (this.delimiterChoice === 'auto') {
        const detected = CsvParser.detectDelimiter(text, this.kind === 'paste' ? '\t' : ',');
        this.delimiter = { value: detected.delimiter, reason: detected.reason, auto: true };
      } else {
        this.delimiter = { value: this.delimiterChoice, reason: '手動で指定', auto: false };
      }
      this.grid = CsvParser.parse(text, this.delimiter.value);
    }

    setEncoding(choice) {
      this.encodingChoice = choice;
      this.build();
    }

    setDelimiter(choice) {
      this.delimiterChoice = choice;
      this.build();
    }

    setSheet(name) {
      if (this.sheetNames.indexOf(name) === -1) return;
      this.sheetName = name;
      this.build();
    }

    /** 読み込み設定の保存用（文字コード・区切り・シート） */
    exportChoices() {
      return { encoding: this.encodingChoice, delimiter: this.delimiterChoice, sheet: this.sheetName };
    }

    applyChoices(choices) {
      if (!choices) return false;
      let changed = false;
      if (this.hasEncoding && choices.encoding && choices.encoding !== this.encodingChoice) {
        this.encodingChoice = choices.encoding;
        changed = true;
      }
      if (this.hasDelimiter && choices.delimiter && choices.delimiter !== this.delimiterChoice) {
        this.delimiterChoice = choices.delimiter;
        changed = true;
      }
      if (this.hasSheets && choices.sheet && this.sheetNames.indexOf(choices.sheet) !== -1 && choices.sheet !== this.sheetName) {
        this.sheetName = choices.sheet;
        changed = true;
      }
      if (changed) this.build();
      return changed;
    }
  }

  LQ.ExcelLibrary = ExcelLibrary;
  LQ.EncodingDetector = EncodingDetector;
  LQ.CsvParser = CsvParser;
  LQ.ExcelReader = ExcelReader;
  LQ.SourceFile = SourceFile;
})(window);
