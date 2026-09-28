/* =========================================================================
 * LightQuery - lq-readers.js
 * 読み込み：文字コード判定・CSV 解析・Excel（SheetJS）・貼り付け・保存データ（ブラウザ／JSON）
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
   *   引用符で始まるセルは「正しく閉じている」ときだけ引用として扱い、
   *   閉じていない引用符（例：5" 画面）は文字としてそのまま残す（列ずれ防止）。
   * ------------------------------------------------------------------- */
  const DELIMITERS = [
    { value: ',', label: 'カンマ（,）' },
    { value: '\t', label: 'タブ' },
    { value: ';', label: 'セミコロン（;）' },
    { value: '|', label: '縦棒（|）' }
  ];
  const DETECT_CHARS = 64 * 1024;
  const DETECT_ROWS = 30;

  /** from 以降で引用を閉じる引用符の位置。閉じていない・途中に単独の引用符があれば -1 */
  function closingQuote(text, from, d) {
    const n = text.length;
    let j = from;
    for (;;) {
      const k = text.indexOf('"', j);
      if (k === -1) return -1;
      const next = text.charCodeAt(k + 1);
      if (next === 34) {
        j = k + 2;
        continue;
      }
      if (k + 1 >= n || next === d || next === 10 || next === 13) return k;
      return -1;
    }
  }

  const CsvParser = {
    delimiters: DELIMITERS,

    delimiterLabel(value) {
      const found = DELIMITERS.find((d) => d.value === value);
      return found ? found.label : value;
    },

    /** 先頭 30 行を各区切り文字で実際に分け、列数が最もそろう区切り文字を選ぶ */
    detectDelimiter(text, preferred) {
      const truncated = text.length > DETECT_CHARS;
      const sample = truncated ? text.slice(0, DETECT_CHARS) : text;
      let best = null;
      DELIMITERS.forEach((d) => {
        let rows = CsvParser.parse(sample, d.value);
        if (truncated && rows.length > 1) rows = rows.slice(0, -1);
        rows = rows.filter((r) => !(r.length === 1 && r[0].trim() === '')).slice(0, DETECT_ROWS);
        const freq = new Map();
        rows.forEach((r) => {
          if (r.length > 1) freq.set(r.length, (freq.get(r.length) || 0) + 1);
        });
        if (!freq.size) return;
        let mode = 0;
        let modeCount = 0;
        freq.forEach((cnt, cols) => {
          if (cnt > modeCount || (cnt === modeCount && cols > mode)) {
            mode = cols;
            modeCount = cnt;
          }
        });
        const consistency = modeCount / rows.length;
        const score = consistency * 1000 + Math.min(mode, 999);
        if (!best || score > best.score) best = { value: d.value, score: score, consistency: consistency, mode: mode, rows: rows.length };
      });
      if (!best) {
        return { delimiter: preferred || ',', reason: '区切り文字が見つからないため 1 列のデータとして読み込み' };
      }
      return {
        delimiter: best.value,
        reason: '先頭 ' + best.rows + ' 行のうち ' + Math.round(best.consistency * 100) + '% が同じ列数（' + best.mode + ' 列）になるため'
      };
    },

    parse(text, delimiter) {
      const rows = [];
      const d = delimiter.charCodeAt(0);
      const n = text.length;
      let row = [];
      let field = '';
      let started = false;
      let i = 0;
      while (i < n) {
        const c = text.charCodeAt(i);
        if (c === 34 && !started) {
          const end = closingQuote(text, i + 1, d);
          if (end !== -1) {
            field = text.slice(i + 1, end).replace(/""/g, '"');
            started = true;
            i = end + 1;
            continue;
          }
        }
        if (c === d) {
          row.push(field);
          field = '';
          started = false;
          i += 1;
          continue;
        }
        if (c === 10 || c === 13) {
          row.push(field);
          rows.push(row);
          row = [];
          field = '';
          started = false;
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
        started = true;
        i = j;
      }
      if (started || row.length) {
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
  const KIND_LABEL = { excel: 'Excel', csv: 'CSV', paste: '貼り付け', sample: 'サンプル', stored: '保存データ' };

  const TEXT_MIME = /^text\/(csv|plain|tab-separated-values)|spreadsheet|ms-excel/i;
  const MEDIA_MIME = /^(image|audio|video)\//i;
  const BINARY_SIGNATURES = [
    { bytes: [0x89, 0x50, 0x4e, 0x47], label: '画像（PNG）' },
    { bytes: [0xff, 0xd8, 0xff], label: '画像（JPEG）' },
    { bytes: [0x47, 0x49, 0x46, 0x38], label: '画像（GIF）' },
    { bytes: [0x25, 0x50, 0x44, 0x46], label: 'PDF' }
  ];
  const BINARY_CHECK_BYTES = 8192;

  function sniffKind(bytes) {
    if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) return 'excel';
    if (bytes.length >= 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) return 'excel';
    return 'csv';
  }

  /** 文字として読めないファイル（画像・PDF など）なら種類名、テキストなら null */
  function binaryLabel(bytes) {
    const sig = BINARY_SIGNATURES.find((s) => s.bytes.every((b, i) => bytes[i] === b));
    if (sig) return sig.label;
    if (bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) return null;
    const limit = Math.min(bytes.length, BINARY_CHECK_BYTES);
    for (let i = 0; i < limit; i++) {
      if (bytes[i] === 0) return '文字データではないファイル';
    }
    return null;
  }

  function unsupportedError(label) {
    return new Error(label + 'は読み込めません。Excel（.xlsx .xls など）・CSV・TSV・TXT のファイルを選んでください。');
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

    /** 表のデータとして読み込めるファイルか（貼り付けで画像と区別するため、拡張子と種類で判定） */
    static isDataFile(file) {
      return SourceFile.isSupportedName(file.name) || TEXT_MIME.test(file.type || '');
    }

    static async fromFile(file) {
      const ext = LQ.Util.extName(file.name);
      const known = EXCEL_EXT.has(ext) || TEXT_EXT.has(ext);
      if (!known && MEDIA_MIME.test(file.type || '')) throw unsupportedError(/^image/i.test(file.type) ? '画像' : '音声・動画');
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const kind = EXCEL_EXT.has(ext) ? 'excel' : (TEXT_EXT.has(ext) ? 'csv' : sniffKind(bytes));
      if (kind === 'csv') {
        const label = binaryLabel(bytes);
        if (label) throw unsupportedError(label);
      }
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

    /**
     * ブラウザや JSON に保存した表から作る。元の種類・シート・読み込み方法は ref に残し、表示と再保存に使う。
     * @param {string[][]} grid
     * @param {string} name 元のファイル名
     * @param {{kindLabel?:string, sheetName?:string, choices?:object}} ref
     */
    static fromStored(grid, name, ref) {
      const src = new SourceFile('stored', name, 0);
      src.grid = grid;
      const r = ref || {};
      src.storedRef = { kindLabel: r.kindLabel || '', sheetName: r.sheetName || '', choices: Object.assign({}, r.choices || {}) };
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
      if (this.kind === 'sample' || this.kind === 'stored') return;
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
        const detected = this.kind === 'paste' && text.indexOf('\t') !== -1
          ? { delimiter: '\t', reason: 'Excel からの貼り付けはタブ区切りのため' }
          : CsvParser.detectDelimiter(text, this.kind === 'paste' ? '\t' : ',');
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

    /** 中身のあるシート名（Excel 以外は空） */
    usedSheetNames() {
      if (!this.hasSheets || !this._workbook) return [];
      return this.sheetNames.filter((name) => {
        const ws = this._workbook.Sheets[name];
        return !!(ws && ws['!ref']);
      });
    }

    /** 同じファイルを別の抽出条件で使うための複製（元のバイト列・ブックは共有し、設定は別々に持つ） */
    clone() {
      const copy = new SourceFile(this.kind, this.name, this.size);
      copy.encodingChoice = this.encodingChoice;
      copy.delimiterChoice = this.delimiterChoice;
      copy.encoding = this.encoding;
      copy.delimiter = this.delimiter;
      copy.sheetName = this.sheetName;
      copy.sheetNames = this.sheetNames.slice();
      copy.storedRef = this.storedRef ? Object.assign({}, this.storedRef) : undefined;
      copy._bytes = this._bytes;
      copy._text = this._text;
      copy._workbook = this._workbook;
      copy.grid = this.grid;
      return copy;
    }

    /** 別のシートを読む複製 */
    forSheet(name) {
      const copy = this.clone();
      copy.setSheet(name);
      return copy;
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
