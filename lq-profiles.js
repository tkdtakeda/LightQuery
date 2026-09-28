/* =========================================================================
 * LightQuery - lq-profiles.js
 * 抽出条件のモデル
 *   QueryOps    … 条件 A〜Z・組み合わせ・抽出のしかた（query）を操作する関数群（状態を持たない）
 *   Profile     … 1 件の抽出条件（名前・有効／無効・② 条件データ・query）
 *   ProfileList … 優先順位の順に並べた抽出条件の一覧（先頭が 1 位）
 * 抽出条件ごとに ② を持つため、② の列構成は抽出条件ごとに異なってよい。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Util = LQ.Util;
  const Logic = LQ.Logic;

  const MAX_CONDITIONS = 26;
  const MAX_PROFILES = 30;
  const NAME_MAX = 40;
  const NAME_BASE = '抽出条件';
  const RE_DEFAULT_NAME = /^抽出条件 \d+$/;
  const LOGIC_MODES = ['and', 'or', 'expr'];
  const JOIN_KINDS = ['inner', 'anti', 'left'];
  const MATCH_MODES = ['first', 'all'];

  function text(value) {
    return value === null || value === undefined ? '' : String(value);
  }

  function emptyRight() {
    return { type: 'column', col: '', value: '' };
  }

  /** 保存データの表を「文字列の二次元配列」にそろえる */
  function cleanGrid(grid) {
    return grid.map((row) => (Array.isArray(row) ? row.map((v) => text(v)) : []));
  }

  /* ---------------------------------------------------------------------
   * QueryOps：query（条件・組み合わせ・抽出のしかた）の操作
   * ------------------------------------------------------------------- */
  const QueryOps = {
    MAX_CONDITIONS: MAX_CONDITIONS,

    create() {
      return { conditions: [], logic: { mode: 'and', expr: '' }, joinKind: 'inner', matchMode: 'first' };
    },

    labels(query) {
      return query.conditions.map((c) => c.label);
    },

    find(query, id) {
      return query.conditions.find((c) => c.id === id) || null;
    },

    canAdd(query) {
      return query.conditions.length < MAX_CONDITIONS;
    },

    /** 使われていない次の記号（最後の記号の次を優先し、なければ空いている記号） */
    nextLabel(query) {
      const used = new Set(QueryOps.labels(query));
      let max = -1;
      used.forEach((label) => {
        max = Math.max(max, label.charCodeAt(0) - 65);
      });
      for (let i = max + 1; i < 26; i++) {
        const label = String.fromCharCode(65 + i);
        if (!used.has(label)) return label;
      }
      for (let i = 0; i < 26; i++) {
        const label = String.fromCharCode(65 + i);
        if (!used.has(label)) return label;
      }
      return null;
    },

    /**
     * 条件を追加する。式で指定しているときは式の末尾に「and ＋記号」を加える。
     * @returns {{cond:object, exprChanged:boolean}|null}
     */
    add(query, init) {
      if (!QueryOps.canAdd(query)) return null;
      const label = QueryOps.nextLabel(query);
      const labelsBefore = QueryOps.labels(query);
      const cond = Object.assign({ id: Util.uid('cond'), left: '', op: 'eq' }, init || {}, { label: label });
      cond.right = Object.assign(emptyRight(), (init && init.right) || {});
      query.conditions.push(cond);
      const isExpr = query.logic.mode === 'expr';
      if (isExpr) {
        const parsed = Logic.parse(query.logic.expr, labelsBefore);
        if (parsed.ok) {
          const children = parsed.ast.type === 'and' ? parsed.ast.children.slice() : [parsed.ast];
          children.push({ type: 'cond', label: label });
          query.logic.expr = Logic.serialize({ type: 'and', children: children });
        } else {
          const expr = query.logic.expr.trim();
          query.logic.expr = expr ? expr + ' and ' + label : label;
        }
      }
      return { cond: cond, exprChanged: isExpr };
    },

    update(query, id, patch) {
      const cond = QueryOps.find(query, id);
      if (!cond) return false;
      Object.keys(patch).forEach((key) => {
        if (key === 'right') cond.right = Object.assign({}, cond.right, patch.right);
        else if (key !== 'id' && key !== 'label') cond[key] = patch[key];
      });
      return true;
    },

    /**
     * 条件を削除し、式からも取り除く。
     * @returns {{removed:object, exprChanged:boolean}|null}
     */
    remove(query, id) {
      const idx = query.conditions.findIndex((c) => c.id === id);
      if (idx < 0) return null;
      const labelsBefore = QueryOps.labels(query);
      const removed = query.conditions.splice(idx, 1)[0];
      let exprChanged = false;
      if (query.logic.expr.trim()) {
        const parsed = Logic.parse(query.logic.expr, labelsBefore);
        if (parsed.ok) {
          const ast = Logic.removeLabel(parsed.ast, removed.label);
          query.logic.expr = ast ? Logic.serialize(ast) : '';
          exprChanged = true;
        }
      }
      return { removed: removed, exprChanged: exprChanged && query.logic.mode === 'expr' };
    },

    /** @returns {boolean} 変わったか */
    setLogicMode(query, mode) {
      if (mode === query.logic.mode) return false;
      if (mode === 'expr' && !query.logic.expr.trim()) {
        const ast = Logic.fromMode(query.logic.mode, QueryOps.labels(query));
        query.logic.expr = ast ? Logic.serialize(ast) : '';
      }
      query.logic.mode = mode;
      return true;
    },

    /** 保存・JSON 用の素のオブジェクト（画面用の id は含めない） */
    toPlain(query) {
      return {
        conditions: query.conditions.map((c) => ({
          label: c.label,
          left: c.left,
          op: c.op,
          right: { type: c.right.type, col: c.right.col || '', value: c.right.value || '' }
        })),
        logic: { mode: query.logic.mode, expr: query.logic.expr },
        joinKind: query.joinKind,
        matchMode: query.matchMode
      };
    },

    /** 素のオブジェクト → query（値の種類を確かめ、欠けているものは初期値で補う） */
    fromPlain(plain) {
      const q = QueryOps.create();
      const src = plain && typeof plain === 'object' ? plain : {};
      const logic = src.logic && typeof src.logic === 'object' ? src.logic : {};
      q.logic.mode = LOGIC_MODES.indexOf(logic.mode) !== -1 ? logic.mode : 'and';
      q.logic.expr = typeof logic.expr === 'string' ? logic.expr : '';
      q.joinKind = JOIN_KINDS.indexOf(src.joinKind) !== -1 ? src.joinKind : 'inner';
      q.matchMode = MATCH_MODES.indexOf(src.matchMode) !== -1 ? src.matchMode : 'first';
      (Array.isArray(src.conditions) ? src.conditions : []).slice(0, MAX_CONDITIONS).forEach((c) => {
        if (!c || typeof c !== 'object') return;
        const right = c.right && typeof c.right === 'object' ? c.right : {};
        const cond = {
          id: Util.uid('cond'),
          label: typeof c.label === 'string' && /^[A-Z]$/.test(c.label) ? c.label : '',
          left: typeof c.left === 'string' ? c.left : '',
          op: typeof c.op === 'string' ? c.op : 'eq',
          right: { type: right.type === 'value' ? 'value' : 'column', col: text(right.col), value: text(right.value) }
        };
        if (!cond.label || QueryOps.labels(q).indexOf(cond.label) !== -1) cond.label = QueryOps.nextLabel(q);
        q.conditions.push(cond);
      });
      return q;
    },

    /** 結果に影響する内容の署名（結果が最新かの判定・検証結果の再利用に使う） */
    signature(query) {
      return JSON.stringify([
        query.conditions.map((k) => [k.label, k.left, k.op, k.right.type, k.right.col || '', k.right.value || '']),
        query.logic,
        query.joinKind,
        query.matchMode
      ]);
    },

    /** 条件がすべて固定値か（② が不要か） */
    fixedOnly(query) {
      return query.conditions.length > 0 && query.conditions.every((c) => c.right.type === 'value');
    }
  };

  /* ---------------------------------------------------------------------
   * Profile：1 件の抽出条件
   * ------------------------------------------------------------------- */
  class Profile {
    /**
     * @param {{id?:string, name?:string, enabled?:boolean, origin?:'user'|'sample', query?:object,
     *          condition?:LQ.Dataset|null, conditionRef?:object|null, createdAt?:string}} init
     */
    constructor(init) {
      const o = init || {};
      this.id = o.id || Util.uid('prof');
      this.name = Profile.cleanName(o.name) || NAME_BASE;
      this.enabled = o.enabled !== false;
      this.origin = o.origin === 'sample' ? 'sample' : 'user';
      this.query = o.query || QueryOps.create();
      this.condition = o.condition || null;
      this.conditionRef = o.conditionRef || null;
      this.createdAt = o.createdAt || new Date().toISOString();
    }

    static get MAX() {
      return MAX_PROFILES;
    }

    static get NAME_MAX() {
      return NAME_MAX;
    }

    static cleanName(name) {
      return text(name).replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
    }

    /** 「抽出条件 1」のような自動の名前か（② を読み込んだとき表の名前に置き換えてよいか） */
    static isDefaultName(name) {
      return RE_DEFAULT_NAME.test(name);
    }

    get isSample() {
      return this.origin === 'sample';
    }

    /** ② も条件もない（追加したままの）抽出条件か */
    isBlank() {
      return !this.condition && !this.conditionRef && !this.query.conditions.length;
    }

    /** ② を差し替える（null で外す）。覚えておく情報（ファイル名・読み込み範囲）も合わせて更新する */
    setCondition(dataset) {
      this.condition = dataset || null;
      this.conditionRef = dataset ? Profile.describeDataset(dataset) : null;
    }

    /** ② のファイル名・読み込み範囲など（保存・JSON 用。中身は含めない） */
    currentRef() {
      if (this.condition) return Profile.describeDataset(this.condition);
      return this.conditionRef ? Util.clone(this.conditionRef) : null;
    }

    static describeDataset(ds) {
      const src = ds.source;
      const stored = src.storedRef || null;
      return {
        fileName: ds.name,
        kindLabel: stored ? stored.kindLabel : src.kindLabel,
        sheetName: stored ? stored.sheetName : (src.hasSheets ? src.sheetName : ''),
        settings: Util.clone(ds.settings),
        choices: stored ? Util.clone(stored.choices) : src.exportChoices(),
        rowCount: ds.rowCount,
        colCount: ds.colCount
      };
    }

    /** 読み込んだ ref の値の種類をそろえる（中身の表は含めない） */
    static cleanRef(ref) {
      const r = ref && typeof ref === 'object' ? ref : {};
      const choices = r.choices && typeof r.choices === 'object' ? r.choices : {};
      return {
        fileName: text(r.fileName).slice(0, 200),
        kindLabel: text(r.kindLabel).slice(0, 20),
        sheetName: text(r.sheetName).slice(0, 100),
        settings: r.settings && typeof r.settings === 'object' ? LQ.Dataset.normalizeSettings(r.settings) : null,
        choices: { encoding: text(choices.encoding) || 'auto', delimiter: text(choices.delimiter) || 'auto', sheet: text(choices.sheet) },
        rowCount: Number(r.rowCount) || 0,
        colCount: Number(r.colCount) || 0
      };
    }

    /** 取り消し用の写し（② は参照のまま持ち、版で変化を見分ける） */
    snapshot() {
      return {
        id: this.id,
        name: this.name,
        enabled: this.enabled,
        origin: this.origin,
        query: Util.clone(this.query),
        condition: this.condition,
        conditionVersion: this.condition ? this.condition.version : 0,
        conditionRef: Util.clone(this.conditionRef),
        createdAt: this.createdAt
      };
    }

    static fromSnapshot(snap) {
      return new Profile({
        id: snap.id,
        name: snap.name,
        enabled: snap.enabled,
        origin: snap.origin,
        query: Util.clone(snap.query),
        condition: snap.condition,
        conditionRef: Util.clone(snap.conditionRef),
        createdAt: snap.createdAt
      });
    }

    /** 複製（② は読み込み範囲の変更が互いに影響しないよう別のデータにする。サンプルの複製は自分のものになる） */
    duplicate() {
      const copy = new Profile({
        name: this.name,
        enabled: this.enabled,
        origin: 'user',
        query: QueryOps.fromPlain(QueryOps.toPlain(this.query)),
        conditionRef: Util.clone(this.conditionRef)
      });
      if (this.condition) copy.condition = this.condition.clone({ isSample: false });
      return copy;
    }

    /**
     * 保存・JSON の素のオブジェクト → 抽出条件。② の表があれば読み込み済みにする。
     * @param {object} plain {name, enabled, query, condition:{fileName, settings, choices, grid?, ...}}
     * @param {{id?:string, origin?:string, grid?:Array}} options grid を別に渡すとき（ブラウザ保存）は options.grid
     */
    static fromPlain(plain, options) {
      const o = plain && typeof plain === 'object' ? plain : {};
      const opts = options || {};
      const p = new Profile({
        id: opts.id,
        name: o.name,
        enabled: o.enabled !== false,
        origin: opts.origin,
        query: QueryOps.fromPlain(o.query),
        createdAt: typeof o.createdAt === 'string' ? o.createdAt : undefined
      });
      const ref = o.condition && typeof o.condition === 'object' ? o.condition : null;
      if (!ref) return p;
      p.conditionRef = Profile.cleanRef(ref);
      const grid = opts.grid !== undefined ? opts.grid : ref.grid;
      if (Array.isArray(grid) && grid.length) {
        const src = LQ.SourceFile.fromStored(cleanGrid(grid), p.conditionRef.fileName || '保存データ', p.conditionRef);
        p.condition = new LQ.Dataset('condition', src, { settings: p.conditionRef.settings, isSample: p.isSample });
      }
      return p;
    }
  }

  /* ---------------------------------------------------------------------
   * ProfileList：優先順位の順（先頭が 1 位）
   * ------------------------------------------------------------------- */
  class ProfileList {
    constructor(items) {
      this.items = items || [];
    }

    get length() {
      return this.items.length;
    }

    find(id) {
      return this.items.find((p) => p.id === id) || null;
    }

    indexOf(id) {
      return this.items.findIndex((p) => p.id === id);
    }

    /** 優先順位（1 始まり。見つからなければ 0） */
    rank(id) {
      return this.indexOf(id) + 1;
    }

    enabled() {
      return this.items.filter((p) => p.enabled);
    }

    canAdd(count) {
      return this.items.length + (count || 1) <= MAX_PROFILES;
    }

    /** @returns {number} 入れた位置 */
    insert(profile, index) {
      const len = this.items.length;
      const at = index === undefined || index === null || index < 0 || index > len ? len : index;
      this.items.splice(at, 0, profile);
      return at;
    }

    remove(id) {
      const idx = this.indexOf(id);
      return idx < 0 ? null : this.items.splice(idx, 1)[0];
    }

    /** @returns {boolean} 動いたか */
    move(id, to) {
      const from = this.indexOf(id);
      if (from < 0) return false;
      const target = Util.clamp(to, 0, this.items.length - 1);
      if (target === from) return false;
      const item = this.items.splice(from, 1)[0];
      this.items.splice(target, 0, item);
      return true;
    }

    /** 使われていない「抽出条件 N」 */
    defaultName() {
      const used = new Set(this.items.map((p) => p.name));
      let n = 1;
      while (used.has(NAME_BASE + ' ' + n)) n++;
      return NAME_BASE + ' ' + n;
    }

    /** 他と重ならない名前（重なるときは「名前 (2)」） */
    uniqueName(name, exceptId) {
      const clean = Profile.cleanName(name) || this.defaultName();
      const used = new Set(this.items.filter((p) => p.id !== exceptId).map((p) => p.name));
      if (!used.has(clean)) return clean;
      const base = clean.slice(0, NAME_MAX - 5);
      let k = 2;
      while (used.has(base + ' (' + k + ')')) k++;
      return base + ' (' + k + ')';
    }
  }

  LQ.QueryOps = QueryOps;
  LQ.Profile = Profile;
  LQ.ProfileList = ProfileList;
})(window);
