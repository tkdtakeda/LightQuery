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
      const parser = createCsvParser(text, delimiter);
      parser.run(null);
      return parser.rows;
    },

    /**
     * 大きなテキストを小分けに解析し、合間に画面へ処理を返す（進み具合を onRatio で伝える）。
     * @param {string} text
     * @param {string} delimiter
     * @param {Function} [onRatio] 0〜1（解析した文字数の割合）
     * @returns {Promise<string[][]>}
     */
    async parseAsync(text, delimiter, onRatio) {
      const parser = createCsvParser(text, delimiter);
      const slicer = LQ.Async.createSlicer();
      while (!parser.run(slicer.due)) {
        if (onRatio) onRatio(parser.ratio());
        await LQ.Async.yieldToUI();
        slicer.reset();
      }
      if (onRatio) onRatio(1);
      return parser.rows;
    }
  };

  /* 区切りを確かめる間隔（行数）。毎行の時刻確認を避ける */
  const CSV_CHECK_ROWS = 512;

  /**
   * 区切り文字テキストの解析器。run(due) は due() が真になった行の区切りで止まり、続きは次の run で再開する。
   * @returns {{rows:string[][], run:Function, ratio:Function}} run：最後まで解析したら true
   */
  function createCsvParser(text, delimiter) {
    const rows = [];
    const d = delimiter.charCodeAt(0);
    const n = text.length;
    let row = [];
    let field = '';
    let started = false;
    let i = 0;
    let sinceCheck = 0;

    function run(due) {
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
          if (due && ++sinceCheck >= CSV_CHECK_ROWS) {
            sinceCheck = 0;
            if (due()) return false;
          }
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
        row = [];
        started = false;
      }
      return true;
    }

    return { rows: rows, run: run, ratio: () => (n ? i / n : 1) };
  }

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

    /** 値の入ったセルがある最初のシート名（なければ先頭） */
    firstUsedSheet(workbook) {
      const names = workbook.SheetNames || [];
      const used = names.find((name) => ExcelReader.hasData(workbook, name));
      return used || names[0] || '';
    },

    /** 値の入ったセルがあるシートか（Excel に記録された使用範囲ではなく実際のセルで判定。最初の 1 つで打ち切る） */
    hasData(workbook, name) {
      const XLSX = global.XLSX;
      const ws = workbook.Sheets[name];
      if (!ws) return false;
      const filled = (cell) => cellToText(XLSX, cell, false) !== '';
      const dense = ws['!data'];
      if (dense) return dense.some((rowCells) => !!rowCells && rowCells.some(filled));
      return Object.keys(ws).some((key) => key.charAt(0) !== '!' && filled(ws[key]));
    },

    /** 実際のデータが記録された使用範囲の外にはみ出しているか */
    isBeyond(declared, actual) {
      if (!actual) return false;
      if (!declared) return true;
      const XLSX = global.XLSX;
      const d = XLSX.utils.decode_range(declared);
      const a = XLSX.utils.decode_range(actual);
      return a.s.r < d.s.r || a.s.c < d.s.c || a.e.r > d.e.r || a.e.c > d.e.c;
    },

    /**
     * シートを grid にする。Excel に記録された使用範囲（!ref）は信用せず、値の入ったセルの範囲を使う。
     * 記録より外にあるデータも読み、書式だけで広がった範囲の空行は作らない。
     * @returns {{grid:string[][], declared:string, actual:string}} declared：記録された範囲 / actual：実際の範囲（値がなければ ''）
     */
    readSheet(workbook, name) {
      const reader = createSheetReader(workbook, name);
      reader.run(null);
      return reader.result();
    },

    /** readSheet を小分けに実行し、合間に画面へ処理を返す（進み具合を onRatio で伝える） */
    async readSheetAsync(workbook, name, onRatio) {
      const reader = createSheetReader(workbook, name);
      const slicer = LQ.Async.createSlicer();
      while (!reader.run(slicer.due)) {
        if (onRatio) onRatio(reader.ratio());
        await LQ.Async.yieldToUI();
        slicer.reset();
      }
      if (onRatio) onRatio(1);
      return reader.result();
    }
  };

  /* 区切りを確かめる間隔（行数・セル数） */
  const SHEET_CHECK_ROWS = 256;
  const SHEET_CHECK_CELLS = 4096;

  /**
   * シートの読み取り器。run(due) は due() が真になったところで止まり、続きは次の run で再開する。
   * @returns {{run:Function, ratio:Function, result:Function}} run：最後まで読んだら true
   */
  function createSheetReader(workbook, name) {
    const XLSX = global.XLSX;
    const ws = workbook.Sheets[name];
    const declared = ws && ws['!ref'] ? ws['!ref'] : '';
    const props = workbook.Workbook && workbook.Workbook.WBProps;
    const date1904 = !!(props && props.date1904);
    const rows = [];
    const put = (r, c, cell) => {
      const text = cellToText(XLSX, cell, date1904);
      if (text === '') return;
      (rows[r] || (rows[r] = []))[c] = text;
    };
    const dense = ws ? ws['!data'] : null;
    const keys = ws && !dense ? Object.keys(ws).filter((key) => key.charAt(0) !== '!') : [];
    const total = !ws ? 0 : (dense ? dense.length : keys.length);
    let pos = 0;

    function run(due) {
      if (dense) {
        while (pos < total) {
          const rowCells = dense[pos];
          if (rowCells) rowCells.forEach((cell, c) => put(pos, c, cell));
          pos++;
          if (due && pos % SHEET_CHECK_ROWS === 0 && due()) return false;
        }
        return true;
      }
      while (pos < total) {
        const key = keys[pos];
        const at = XLSX.utils.decode_cell(key);
        put(at.r, at.c, ws[key]);
        pos++;
        if (due && pos % SHEET_CHECK_CELLS === 0 && due()) return false;
      }
      return true;
    }

    function result() {
      if (!ws) return { grid: [], declared: declared, actual: '' };
      const grid = new Array(rows.length);
      let minR = -1;
      let minC = Infinity;
      let maxC = -1;
      for (let r = 0; r < rows.length; r++) {
        const src = rows[r];
        const row = [];
        if (src) {
          for (let c = 0; c < src.length; c++) {
            const text = src[c];
            if (text === undefined) {
              row.push('');
              continue;
            }
            row.push(text);
            if (c < minC) minC = c;
          }
          if (minR < 0) minR = r;
          if (src.length - 1 > maxC) maxC = src.length - 1;
        }
        grid[r] = row;
      }
      const actual = minR < 0 ? '' : XLSX.utils.encode_range({ s: { r: minR, c: minC }, e: { r: rows.length - 1, c: maxC } });
      return { grid: grid, declared: declared, actual: actual };
    }

    return { run: run, ratio: () => (total ? pos / total : 1), result: result };
  }

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

  /** ファイルを読み取る（読み取った割合を onRatio で伝える） */
  function readFileBuffer(file, onRatio) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onprogress = (e) => {
        if (e.lengthComputable && e.total) onRatio(e.loaded / e.total);
      };
      reader.onload = () => {
        onRatio(1);
        resolve(reader.result);
      };
      reader.onerror = () => reject(reader.error || new Error('ファイルを読み取れませんでした。'));
      reader.readAsArrayBuffer(file);
    });
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
      this.extent = null;
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

    /**
     * 読み込みの段階（呼び出し側が Progress.plan に渡す。後ろに呼び出し側の段階を足してよい）。
     * 拡張子で判断できないファイルは区切り文字テキストの段階にする。
     */
    static loadSteps(fileName) {
      if (EXCEL_EXT.has(LQ.Util.extName(fileName))) {
        return [
          { id: 'read', label: 'ファイルの読み取り', weight: 2 },
          { id: 'library', label: 'Excel 用ライブラリの準備', weight: 1 },
          { id: 'parse', label: 'ブックの解析', weight: 5 },
          { id: 'convert', label: 'セルの読み取り', weight: 2 }
        ];
      }
      return [
        { id: 'read', label: 'ファイルの読み取り', weight: 2 },
        { id: 'decode', label: '文字コードの判定', weight: 1 },
        { id: 'parse', label: '区切りの解析', weight: 4 }
      ];
    }

    /**
     * @param {File} file
     * @param {LQ.Progress} [progress] 段階（loadSteps の id）ごとに進み具合を伝える
     */
    static async fromFile(file, progress) {
      const P = progress || LQ.Progress.none();
      const ext = LQ.Util.extName(file.name);
      const known = EXCEL_EXT.has(ext) || TEXT_EXT.has(ext);
      if (!known && MEDIA_MIME.test(file.type || '')) throw unsupportedError(/^image/i.test(file.type) ? '画像' : '音声・動画');
      P.begin('read', true);
      const buffer = await readFileBuffer(file, (ratio) => P.update(ratio, LQ.Util.formatBytes(file.size * ratio) + ' / ' + LQ.Util.formatBytes(file.size)));
      const bytes = new Uint8Array(buffer);
      const kind = EXCEL_EXT.has(ext) ? 'excel' : (TEXT_EXT.has(ext) ? 'csv' : sniffKind(bytes));
      if (kind === 'csv') {
        const label = binaryLabel(bytes);
        if (label) throw unsupportedError(label);
      }
      const src = new SourceFile(kind, file.name, file.size);
      if (kind === 'excel') {
        if (ExcelLibrary.state === 'ready') P.skip('library');
        else {
          P.begin('library', false);
          await ExcelLibrary.ensure();
        }
        P.begin('parse', false);
        /* ブックの解析は途中経過を返さない同期処理のため、段階の表示を描いてから入る */
        await LQ.Async.paint();
        src._workbook = await ExcelReader.readWorkbook(buffer);
        src.sheetNames = src._workbook.SheetNames.slice();
        src.sheetName = ExcelReader.firstUsedSheet(src._workbook);
      } else {
        src._bytes = bytes;
        if (ext === 'tsv') src.delimiterChoice = '\t';
      }
      await src._buildAsync(P);
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
        this._applySheet(ExcelReader.readSheet(this._workbook, this.sheetName));
        return;
      }
      if (this.kind === 'sample' || this.kind === 'stored') return;
      const text = this._decodeText();
      this.grid = CsvParser.parse(text, this._resolveDelimiter(text));
    }

    /** build の小分け版（ファイルを開いたときだけ使い、進み具合を伝える） */
    async _buildAsync(P) {
      if (this.kind === 'excel') {
        P.begin('convert', true);
        this._applySheet(await ExcelReader.readSheetAsync(this._workbook, this.sheetName, (r) => P.update(r)));
        return;
      }
      P.begin('decode', false);
      await LQ.Async.paint();
      const text = this._decodeText();
      const delimiter = this._resolveDelimiter(text);
      P.begin('parse', true);
      this.grid = await CsvParser.parseAsync(text, delimiter, (r) => P.update(r));
    }

    _applySheet(sheet) {
      this.grid = sheet.grid;
      this.extent = { declared: sheet.declared, actual: sheet.actual, beyond: ExcelReader.isBeyond(sheet.declared, sheet.actual) };
    }

    /** 文字コードを決めてテキストにする（CSV 以外は持っているテキスト） */
    _decodeText() {
      if (this.kind !== 'csv') return this._text;
      if (this.encodingChoice === 'auto') {
        const detected = EncodingDetector.detect(this._bytes);
        this.encoding = { value: detected.encoding, reason: detected.reason, certain: detected.certain, auto: true };
      } else {
        this.encoding = { value: this.encodingChoice, reason: '手動で指定', certain: true, auto: false };
      }
      return EncodingDetector.decode(this._bytes, this.encoding.value);
    }

    /** 区切り文字を決めて返す */
    _resolveDelimiter(text) {
      if (this.delimiterChoice === 'auto') {
        const detected = this.kind === 'paste' && text.indexOf('\t') !== -1
          ? { delimiter: '\t', reason: 'Excel からの貼り付けはタブ区切りのため' }
          : CsvParser.detectDelimiter(text, this.kind === 'paste' ? '\t' : ',');
        this.delimiter = { value: detected.delimiter, reason: detected.reason, auto: true };
      } else {
        this.delimiter = { value: this.delimiterChoice, reason: '手動で指定', auto: false };
      }
      return this.delimiter.value;
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
      return this.sheetNames.filter((name) => ExcelReader.hasData(this._workbook, name));
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
      copy.extent = this.extent ? Object.assign({}, this.extent) : null;
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
