/* =========================================================================
 * LightQuery - lq-storage.js
 * 保存：抽出条件の JSON・ブラウザへの自動保存
 * （下の区切りごとに独立した部品。読み込み順どおりに並べている）
 * ========================================================================= */

/* =========================================================================
 * ── 抽出条件の JSON ──
 * 抽出条件の JSON：書き出し（1 件／一括）と読み込み（1 件／一括／旧形式）
 *   format 2 … kind:'profile'（1 件）/ kind:'library'（一括：全件＋振り分け・照合ルール・出力列・① の読み込み範囲）
 *   format 1 … 旧形式（条件 1 セット）。1 件の抽出条件として読み込む
 *   ② の中身（grid）は含めても含めなくてもよい。含めないときはファイル名と読み込み範囲だけを記録する。
 *   照合ルール：個別の設定がある抽出条件は profile.rules に、全体の設定は rules（1 件のときは globalRules）に書く。
 *   出力列は覚えている並び（今は使えない列を含む）を書く。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Util = LQ.Util;
  const QueryOps = LQ.QueryOps;
  const Profile = LQ.Profile;
  const Normalizer = LQ.Normalizer;

  const APP = 'LightQuery';
  const FORMAT = 2;
  const RE_LEGACY_NAME = /^LightQuery_条件_\d{8}_\d{4}$/;

  /** 抽出条件 1 件 → 素のオブジェクト（個別の照合ルールがあるときだけ rules を書く） */
  function profileToPlain(profile, priority, withData) {
    const ref = profile.currentRef();
    if (ref && withData && profile.condition) ref.grid = profile.condition.grid;
    const plain = {
      name: profile.name,
      priority: priority,
      enabled: profile.enabled,
      query: QueryOps.toPlain(profile.query)
    };
    if (profile.rules) plain.rules = Util.clone(profile.rules);
    plain.condition = ref;
    return plain;
  }

  function cleanCombine(combine) {
    if (!combine || typeof combine !== 'object') return null;
    return { mode: combine.mode === 'independent' ? 'independent' : 'assign', includeUnmatched: !!combine.includeUnmatched };
  }

  function cleanOutput(output) {
    return output && typeof output === 'object' && Array.isArray(output.columns) ? { columns: output.columns } : null;
  }

  function cleanRead(read) {
    const src = read && typeof read === 'object' ? read.source : null;
    if (!src || typeof src !== 'object') return null;
    return { source: { settings: src.settings || null, choices: src.choices || null, fileName: String(src.fileName || '') } };
  }

  function cleanView(view) {
    return view && typeof view === 'object' && view.pageSize ? { pageSize: view.pageSize } : null;
  }

  function priorityOf(plain, index) {
    const n = Number(plain && plain.priority);
    return isFinite(n) && n > 0 ? n : index + 1;
  }

  /** 旧形式（format 1：条件 1 セット）→ 抽出条件 1 件 */
  function parseLegacy(obj, fileName) {
    if (!obj.query || !Array.isArray(obj.query.conditions)) throw new Error('LightQuery の条件設定ファイルではありません');
    const read = obj.read && typeof obj.read === 'object' ? obj.read : {};
    const cond = read.condition && typeof read.condition === 'object' ? read.condition : null;
    const base = Util.baseName(fileName || '');
    const plain = {
      name: base && !RE_LEGACY_NAME.test(base) ? base : '読み込んだ抽出条件',
      query: obj.query,
      condition: cond ? { fileName: cond.fileName, settings: cond.settings, choices: cond.choices } : null
    };
    return {
      kind: 'legacy',
      profiles: [Profile.fromPlain(plain)],
      skipped: 0,
      combine: null,
      rules: Normalizer.cleanRules(obj.rules),
      output: cleanOutput(obj.output),
      read: cleanRead(obj.read),
      view: cleanView(obj.view)
    };
  }

  const Bundle = {
    /**
     * 1 件の書き出し用オブジェクト。全体の照合ルールを使っている抽出条件は、その内容を globalRules に書く
     * （読み込む側の全体の設定と違うとき、同じ結果になるよう個別の設定として付けるため）。
     */
    exportProfile(profile, priority, withData, globalRules) {
      const obj = { app: APP, format: FORMAT, kind: 'profile', savedAt: new Date().toISOString(), profile: profileToPlain(profile, priority, withData) };
      if (!profile.rules && globalRules) obj.globalRules = Util.clone(globalRules);
      return obj;
    },

    /** 一括の書き出し用オブジェクト（今の一覧の全件と、振り分け・照合ルール・出力列・① の読み込み範囲・列の追加・集計・グラフの設定） */
    exportLibrary(state, withData) {
      const src = state.datasets.source;
      return {
        app: APP,
        format: FORMAT,
        kind: 'library',
        savedAt: new Date().toISOString(),
        profiles: state.profiles.items.map((p, i) => profileToPlain(p, i + 1, withData)),
        combine: Util.clone(state.combine),
        rules: Util.clone(state.rules),
        output: { columns: Util.clone(state.output.memory) },
        derived: Util.clone(state.derived),
        aggregate: Util.clone(state.aggregate),
        charts: Util.clone(state.charts),
        read: src ? { source: { settings: Util.clone(src.settings), choices: src.source.exportChoices(), fileName: src.name } } : {},
        view: { pageSize: state.view.pageSize }
      };
    },

    /** 読みやすい JSON（構造は字下げし、② の表は 1 行＝1 行で詰めて書く） */
    stringify(obj) {
      const grids = [];
      const token = '@@LQGRID' + Date.now().toString(36) + '_';
      const json = JSON.stringify(obj, (key, value) => {
        if (key === 'grid' && Array.isArray(value)) {
          grids.push(value);
          return token + (grids.length - 1);
        }
        return value;
      }, 2);
      if (!grids.length) return json;
      const re = new RegExp('"' + token + '(\\d+)"', 'g');
      return json.replace(re, (match, idx, offset) => {
        const rows = grids[Number(idx)];
        if (!rows.length) return '[]';
        const lineStart = json.lastIndexOf('\n', offset) + 1;
        const indent = /^\s*/.exec(json.slice(lineStart, offset))[0];
        return '[\n' + rows.map((r) => indent + '  ' + JSON.stringify(r)).join(',\n') + '\n' + indent + ']';
      });
    },

    /**
     * 読み込んだ JSON を解釈する。rules は書き出し元の全体の照合ルール（1 件のときは globalRules）。
     * @returns {{kind:'profile'|'library'|'legacy', profiles:LQ.Profile[], skipped:number, combine:object|null,
     *            rules:object|null, output:object|null, read:object|null, view:object|null}}
     */
    parse(obj, fileName) {
      if (!obj || typeof obj !== 'object' || obj.app !== APP) throw new Error('LightQuery の抽出条件ファイルではありません');
      if (obj.format === 1) return parseLegacy(obj, fileName);
      if (obj.format !== FORMAT) throw new Error('このバージョンでは読み込めない形式です（format ' + obj.format + '）');
      if (obj.kind === 'profile') {
        if (!obj.profile || typeof obj.profile !== 'object') throw new Error('抽出条件が入っていません');
        return {
          kind: 'profile',
          profiles: [Profile.fromPlain(obj.profile)],
          skipped: 0,
          combine: null,
          rules: Normalizer.cleanRules(obj.globalRules),
          output: null,
          read: null,
          view: null
        };
      }
      if (obj.kind === 'library') {
        const list = (Array.isArray(obj.profiles) ? obj.profiles : []).filter((p) => p && typeof p === 'object');
        if (!list.length) throw new Error('抽出条件が 1 件も入っていません');
        const ordered = list.map((p, i) => ({ p: p, rank: priorityOf(p, i), i: i }))
          .sort((a, b) => a.rank - b.rank || a.i - b.i)
          .map((x) => x.p);
        return {
          kind: 'library',
          profiles: ordered.slice(0, Profile.MAX).map((p) => Profile.fromPlain(p)),
          skipped: Math.max(0, ordered.length - Profile.MAX),
          combine: cleanCombine(obj.combine),
          rules: Normalizer.cleanRules(obj.rules),
          output: cleanOutput(obj.output),
          derived: obj.derived && typeof obj.derived === 'object'
            ? { source: LQ.Derive.cleanList(obj.derived.source), condition: LQ.Derive.cleanList(obj.derived.condition) } : null,
          aggregate: obj.aggregate && typeof obj.aggregate === 'object' ? LQ.AggregateSettings.clean(obj.aggregate) : null,
          charts: obj.charts && typeof obj.charts === 'object' ? LQ.ChartSettings.cleanAll(obj.charts) : null,
          read: cleanRead(obj.read),
          view: cleanView(obj.view)
        };
      }
      throw new Error('抽出条件ファイルの種類を判別できません');
    }
  };

  LQ.Bundle = Bundle;
})(window);

/* =========================================================================
 * ── ブラウザへの自動保存 ──
 * 抽出条件の一覧と出力列の並びをブラウザ（localStorage）に自動保存し、次に開いたときに復元する。
 *   ・保存するのは自分の抽出条件（サンプルは保存しない）と、並び順・選択中・振り分けの設定・個別の照合ルール
 *   ・出力列の並びと表示は列の名前で覚える（サンプル表示中は、サンプル前の並びを保存し続ける）
 *   ・② の中身も保存する。1 件 1,000,000 文字・合計 2,000,000 文字を超える分はファイル名と読み込み範囲だけを記録する
 *   ・書き込みは変更から少し待ってまとめて行い、変わっていないものは書き直さない
 *   ・① 元データは保存しない
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const QueryOps = LQ.QueryOps;

  const PREFIX = 'lightquery.v1.';
  const KEY_LIBRARY = PREFIX + 'library';
  const KEY_PROFILE = PREFIX + 'profile.';
  const KEY_DATA = PREFIX + 'pdata.';
  const KEY_OUTPUT = PREFIX + 'output';
  const DATA_LIMIT = 1000000;
  const TOTAL_LIMIT = 2000000;
  const SAVE_DELAY = 400;
  const TOPICS = new Set(['profiles', 'query', 'datasets', 'rules', 'output']);
  const REASON_TEXT = {
    size: '② が大きいため、ブラウザにはファイル名だけを保存しています（次回は ② を読み込み直してください）',
    total: '保存容量の上限のため、ブラウザにはファイル名だけを保存しています（次回は ② を読み込み直してください）',
    quota: 'ブラウザの保存容量を超えたため、② はファイル名だけを保存しています',
    unavailable: 'このブラウザの設定では保存できません。JSON に書き出して保管してください'
  };

  function storage() {
    try {
      return global.localStorage || null;
    } catch (e) {
      return null;
    }
  }

  function read(ls, key) {
    try {
      const raw = ls.getItem(key);
      return raw === null ? null : JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  class ProfileStore {
    constructor(state, bus) {
      this.state = state;
      this.bus = bus;
      this._written = new Map();
      this._dataGrid = new Map();
      this._gridText = new WeakMap();
      this._status = new Map();
      this._timer = null;
      this._notice = null;
      this._warned = new Set();
    }

    static reasonText(reason) {
      return REASON_TEXT[reason] || '';
    }

    /**
     * 前回の一覧と出力列の並びを状態に読み込む（画面を組み立てる前に呼ぶ）。
     * @returns {{count:number, missing:number}|null} 復元した件数と、② を読み込み直す必要がある件数
     */
    restore() {
      const ls = storage();
      if (!ls) return null;
      const out = read(ls, KEY_OUTPUT);
      if (out && Array.isArray(out.memory)) this.state.importOutputColumns(out.memory);
      const lib = read(ls, KEY_LIBRARY);
      if (!lib || !Array.isArray(lib.order)) return null;
      const profiles = [];
      let missing = 0;
      lib.order.forEach((id) => {
        if (typeof id !== 'string') return;
        const def = read(ls, KEY_PROFILE + id);
        if (!def) return;
        const cond = def.condition && typeof def.condition === 'object' ? def.condition : null;
        const data = cond && cond.stored ? read(ls, KEY_DATA + id) : null;
        const p = LQ.Profile.fromPlain(def, { id: id, grid: data && Array.isArray(data.grid) ? data.grid : null });
        if (p.condition) {
          this._dataGrid.set(id, p.condition.grid);
          this._status.set(id, { stored: true, reason: null });
        } else if (cond && cond.fileName) {
          missing++;
          this._status.set(id, { stored: false, reason: cond.stored ? 'quota' : (cond.reason || 'size') });
        }
        profiles.push(p);
      });
      if (!profiles.length || profiles.every((p) => p.isBlank())) return null;
      this.state.replaceProfiles(profiles, typeof lib.activeId === 'string' ? lib.activeId : null);
      if (lib.combine) this.state.setCombine(lib.combine);
      return { count: profiles.length, missing: missing };
    }

    /** 状態の変化を見て自動保存を始める。onNotice({type,title,message}) は保存できないときの知らせ */
    attach(onNotice) {
      this._notice = onNotice || null;
      this.bus.on('change', (e) => {
        if (TOPICS.has(e.topic)) this.schedule();
      });
      global.addEventListener('pagehide', () => this.flush());
      global.addEventListener('beforeunload', () => this.flush());
    }

    schedule() {
      clearTimeout(this._timer);
      this._timer = setTimeout(() => this.flush(), SAVE_DELAY);
    }

    /** ② の保存状態（{stored, reason}）。② がない・未保存なら null */
    statusOf(id) {
      return this._status.get(id) || null;
    }

    /** 今すぐ保存する */
    flush() {
      clearTimeout(this._timer);
      this._timer = null;
      const ls = storage();
      if (!ls) {
        this._warnOnce('unavailable');
        return;
      }
      const s = this.state;
      const profiles = s.userProfiles();
      const previous = this._status;
      const before = JSON.stringify(Array.from(previous.entries()));
      this._status = new Map();
      let total = 0;
      let quota = false;
      let failed = false;
      /* 出力列の並びは ② のデータより先に保存する（容量が足りないとき、② はファイル名だけの保存に切り替わる） */
      if (!this._write(ls, KEY_OUTPUT, JSON.stringify({ format: 1, memory: s.userOutputMemory() }))) failed = true;
      profiles.forEach((p) => {
        const ref = p.currentRef();
        let stored = false;
        let reason = null;
        if (p.condition) {
          const grid = p.condition.grid;
          const text = this._gridJson(grid);
          if (text.length > DATA_LIMIT) reason = 'size';
          else if (total + text.length > TOTAL_LIMIT) reason = 'total';
          else if (this._dataGrid.get(p.id) === grid || this._write(ls, KEY_DATA + p.id, '{"grid":' + text + '}')) {
            stored = true;
            total += text.length;
            this._dataGrid.set(p.id, grid);
          } else {
            reason = 'quota';
            quota = true;
          }
          this._status.set(p.id, { stored: stored, reason: reason });
        } else if (ref && previous.has(p.id)) {
          /* ② を読み込み直す前は、保存しなかった理由を引き継ぐ */
          this._status.set(p.id, previous.get(p.id));
          reason = previous.get(p.id).reason;
        }
        if (!stored) this._removeData(ls, p.id);
        if (ref) {
          ref.stored = stored;
          if (reason) ref.reason = reason;
        }
        const def = { name: p.name, enabled: p.enabled, createdAt: p.createdAt, query: QueryOps.toPlain(p.query), rules: p.rules, condition: ref };
        if (!this._write(ls, KEY_PROFILE + p.id, JSON.stringify(def))) failed = true;
      });
      const lib = { format: 1, order: profiles.map((p) => p.id), activeId: s.userActiveId(), combine: s.userCombine() };
      if (!this._write(ls, KEY_LIBRARY, JSON.stringify(lib))) failed = true;
      this._sweep(ls, new Set(lib.order));
      if (failed) this._warnOnce('unavailable');
      else if (quota) this._warnOnce('quota');
      if (JSON.stringify(Array.from(this._status.entries())) !== before) this.bus.emit('store', {});
    }

    _gridJson(grid) {
      let text = this._gridText.get(grid);
      if (text === undefined) {
        text = JSON.stringify(grid);
        this._gridText.set(grid, text);
      }
      return text;
    }

    /** 変わったときだけ書き込む。@returns {boolean} 書き込めたか（同じ内容なら true） */
    _write(ls, key, text) {
      if (this._written.get(key) === text) return true;
      try {
        ls.setItem(key, text);
        this._written.set(key, text);
        return true;
      } catch (e) {
        return false;
      }
    }

    _removeData(ls, id) {
      this._dataGrid.delete(id);
      const key = KEY_DATA + id;
      this._written.delete(key);
      try {
        ls.removeItem(key);
      } catch (e) {
        /* 消せなくても次の保存で再び試す */
      }
    }

    /** 一覧にない抽出条件の保存分を消す */
    _sweep(ls, ids) {
      try {
        for (let i = ls.length - 1; i >= 0; i--) {
          const key = ls.key(i);
          if (!key) continue;
          let id = null;
          if (key.indexOf(KEY_PROFILE) === 0) id = key.slice(KEY_PROFILE.length);
          else if (key.indexOf(KEY_DATA) === 0) id = key.slice(KEY_DATA.length);
          if (id !== null && !ids.has(id)) {
            ls.removeItem(key);
            this._written.delete(key);
            this._dataGrid.delete(id);
          }
        }
      } catch (e) {
        /* 読み取りできない環境では掃除しないだけ */
      }
    }

    _warnOnce(kind) {
      if (this._warned.has(kind) || !this._notice) return;
      this._warned.add(kind);
      this._notice({
        type: 'warn',
        title: kind === 'quota' ? '② の一部をブラウザに保存できませんでした' : '抽出条件をブラウザに保存できませんでした',
        message: REASON_TEXT[kind] + '。抽出条件パネルの「書き出し」で JSON に保管できます。'
      });
    }
  }

  LQ.ProfileStore = ProfileStore;
})(window);

/* =========================================================================
 * ── 読み込みの記憶（毎月差し替える表のために） ──
 * ① と、② の抽出条件ごとに、読み込み範囲（シート・ヘッダー行・データ開始行・開始列）と絞り込み・重複の削除を記憶し、
 * 次に表を読み込んだときに当てはめる。
 *   ・読み込み範囲：当てはめた結果の列名が、記憶した列名の 8 割以上と一致したときだけ使う（違う構成の表なら自動判定のまま）。
 *                   終了行は月ごとに行数が変わるため引き継がない
 *   ・絞り込み：列名で当てはめる。「値を選ぶ」は前回選んだ値だけを残し、前回の一覧になかった値（新しい値）は外して知らせる
 *   ・重複の削除：比べる列を列名で当てはめる（ない列は除いて比べ、その旨を処理の流れに出す）
 *   ・縦持ち：縦持ちにする列を列名で当てはめる（1 列もなければ当てはめない）
 *   キーは ① が 'source'、② が 'cond:' + 抽出条件の id。サンプルの表は記憶しない。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Prefs = LQ.Prefs;
  const READ_KEY = 'loadMemory.read';
  const FILTER_KEY = 'loadMemory.filters';
  const DEDUP_KEY = 'loadMemory.dedup';
  const UNPIVOT_KEY = 'loadMemory.unpivot';
  const MATCH_RATIO = 0.8;
  const MAX_ENTRIES = 60;
  const NEW_VALUE_LIMIT = 5;

  function load(key) {
    const v = Prefs.get(key, null);
    return v && typeof v === 'object' ? v : {};
  }

  function save(key, map) {
    const keys = Object.keys(map);
    if (keys.length > MAX_ENTRIES) keys.slice(0, keys.length - MAX_ENTRIES).forEach((k) => delete map[k]);
    Prefs.set(key, map);
  }

  function baseNames(ds) {
    /* 縦持ちにしているときは、縦持ちにする前の列の名前（同じ構成の表かを比べるため） */
    const own = ds.columns.filter((c) => !c.derived && !c.fileCol && !c.unpivot).map((c) => c.name);
    return ds.unpivotInfo ? own.concat(ds.unpivotInfo.cols) : own;
  }

  function matchRatio(remembered, names) {
    if (!remembered.length) return 0;
    const set = new Set(names);
    return remembered.filter((n) => set.has(n)).length / remembered.length;
  }

  const LoadMemory = {
    keyOf(role, profileId) {
      return role === 'source' ? 'source' : 'cond:' + profileId;
    },

    /** 今の読み込み範囲を記憶する */
    rememberRead(key, ds) {
      if (!ds || ds.isSample) return;
      const map = load(READ_KEY);
      const s = ds.settings;
      delete map[key];
      map[key] = {
        sheet: ds.source.hasSheets ? ds.source.sheetName : '',
        settings: { hasHeader: s.hasHeader, headerRow: s.headerRow, startRow: s.startRow, startCol: s.startCol },
        columns: baseNames(ds)
      };
      save(READ_KEY, map);
    },

    /**
     * 記憶した読み込み範囲を当てはめる（列名が合わなければ元に戻す）。
     * @returns {string|null} 当てはめたときの説明
     */
    applyRead(key, ds) {
      const m = load(READ_KEY)[key];
      if (!m || !m.settings || !Array.isArray(m.columns)) return null;
      const before = { choices: ds.source.exportChoices(), settings: Object.assign({}, ds.settings) };
      const autoRatio = matchRatio(m.columns, baseNames(ds));
      try {
        const sheetChanged = m.sheet && ds.source.hasSheets && ds.source.sheetNames.indexOf(m.sheet) !== -1 && m.sheet !== ds.source.sheetName
          ? ds.source.applyChoices({ sheet: m.sheet }) : false;
        if (sheetChanged) ds.reload(null);
        ds.applySettings(Object.assign({}, m.settings, { endRow: null }));
      } catch (err) {
        return null;
      }
      const ratio = matchRatio(m.columns, baseNames(ds));
      if (ratio < MATCH_RATIO || ratio < autoRatio) {
        if (ds.source.applyChoices(before.choices)) ds.reload(before.settings);
        else ds.applySettings(before.settings);
        return null;
      }
      const s = ds.settings;
      return '前回と同じ読み込み範囲（' + (m.sheet && ds.source.hasSheets ? 'シート「' + m.sheet + '」・' : '') +
        (s.hasHeader ? 'ヘッダー ' + s.headerRow + ' 行目・' : 'ヘッダーなし・') + 'データ ' + s.startRow + ' 行目から・開始列 ' +
        LQ.Util.colLetter(s.startCol - 1) + '）を使いました。終了行は月ごとに行数が変わるため引き継いでいません';
    },

    /** 絞り込みを記憶する（[] なら「絞り込みなし」を記憶） */
    rememberFilters(key, ds) {
      if (!ds || ds.isSample) return;
      const map = load(FILTER_KEY);
      delete map[key];
      map[key] = LQ.Util.clone(ds.filters || []);
      save(FILTER_KEY, map);
    },

    /**
     * 記憶した絞り込みを当てはめる。
     * @returns {{count:number, notes:string[]}|null} 当てはめた件数と、知らせること（新しく出てきた値・列がない）
     */
    applyFilters(key, ds) {
      const list = load(FILTER_KEY)[key];
      if (!Array.isArray(list) || !list.length) return null;
      const norm = new LQ.Normalizer(LQ.Normalizer.DEFAULT_RULES);
      const notes = [];
      list.forEach((f) => {
        const c = ds.findColumn(f.col);
        if (c < 0) {
          notes.push('列「' + f.col + '」がないため、その絞り込みは使っていません');
          return;
        }
        if (f.mode !== 'values' || f.exclude) return;
        const known = new Set((f.known || f.values || []).map((v) => norm.text(v)));
        const fresh = new Set();
        for (let r = 0; r < ds.baseRowCount; r++) {
          const raw = ds.baseCell(r, c);
          const v = LQ.Normalizer.isBlank(raw) ? '' : String(raw);
          if (!known.has(norm.text(v))) fresh.add(v === '' ? '（空欄）' : v);
        }
        if (fresh.size) {
          const shown = Array.from(fresh).slice(0, NEW_VALUE_LIMIT);
          notes.push('「' + f.col + '」の前回の一覧になかった値 ' + fresh.size + ' 種類（' + shown.join('・') + (fresh.size > NEW_VALUE_LIMIT ? ' ほか' : '') + '）は外しています');
        }
      });
      ds.setFilters(LQ.Util.clone(list));
      return { count: list.length, notes: notes };
    },

    /** 縦持ちを記憶する（使っていなければ「使わない」を記憶） */
    rememberUnpivot(key, ds) {
      if (!ds || ds.isSample) return;
      const map = load(UNPIVOT_KEY);
      delete map[key];
      map[key] = ds.unpivot ? LQ.Util.clone(ds.unpivot) : null;
      save(UNPIVOT_KEY, map);
    },

    /**
     * 記憶した縦持ちを当てはめる（縦持ちにする列が 1 つもない表には当てはめない）
     * @returns {string|null} 当てはめたときの説明
     */
    applyUnpivot(key, ds) {
      const def = LQ.Unpivot.clean(load(UNPIVOT_KEY)[key]);
      if (!def || !def.cols.some((n) => ds.findColumn(n) >= 0)) return null;
      ds.setUnpivot(def);
      const info = ds.unpivotInfo;
      return '前回の縦持ち（' + LQ.Unpivot.describe(def) + '）を掛けました（' + LQ.Util.formatInt(info.base) + ' 行 → ' + LQ.Util.formatInt(info.kept) + ' 行）';
    },

    /** 重複の削除を記憶する（使っていなければ「使わない」を記憶） */
    rememberDedup(key, ds) {
      if (!ds || ds.isSample) return;
      const map = load(DEDUP_KEY);
      delete map[key];
      map[key] = ds.dedup ? LQ.Util.clone(ds.dedup) : null;
      save(DEDUP_KEY, map);
    },

    /**
     * 記憶した重複の削除を当てはめる
     * @returns {string|null} 当てはめたときの説明
     */
    applyDedup(key, ds) {
      const def = load(DEDUP_KEY)[key];
      if (!def || !Array.isArray(def.cols)) return null;
      ds.setDedup(def);
      return '前回の重複の削除（' + LQ.Dedup.describe(def) + 'は最初の行だけ残す）を掛けました（' + LQ.Util.formatInt(ds.dedupInfo.removed.length) + ' 行を除外）';
    }
  };

  LQ.LoadMemory = LoadMemory;
})(window);
