/* =========================================================================
 * LightQuery - lq-bundle.js
 * 抽出条件の JSON：書き出し（1 件／一括）と読み込み（1 件／一括／旧形式）
 *   format 2 … kind:'profile'（1 件）/ kind:'library'（一括：全件＋振り分け・照合ルール・出力列・① の読み込み範囲）
 *   format 1 … 旧形式（条件 1 セット）。1 件の抽出条件として読み込む
 *   ② の中身（grid）は含めても含めなくてもよい。含めないときはファイル名と読み込み範囲だけを記録する。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Util = LQ.Util;
  const QueryOps = LQ.QueryOps;
  const Profile = LQ.Profile;

  const APP = 'LightQuery';
  const FORMAT = 2;
  const RULE_TYPES = { space: 'string', width: 'boolean', caseless: 'boolean', numeric: 'boolean', date: 'boolean' };
  const SPACE_VALUES = ['trim', 'all', 'keep'];
  const RE_LEGACY_NAME = /^LightQuery_条件_\d{8}_\d{4}$/;

  function profileToPlain(profile, priority, withData) {
    const ref = profile.currentRef();
    if (ref && withData && profile.condition) ref.grid = profile.condition.grid;
    return {
      name: profile.name,
      priority: priority,
      enabled: profile.enabled,
      query: QueryOps.toPlain(profile.query),
      condition: ref
    };
  }

  function cleanRules(rules) {
    if (!rules || typeof rules !== 'object') return null;
    const out = {};
    Object.keys(RULE_TYPES).forEach((key) => {
      const v = rules[key];
      if (typeof v !== RULE_TYPES[key]) return;
      if (key === 'space' && SPACE_VALUES.indexOf(v) === -1) return;
      out[key] = v;
    });
    return Object.keys(out).length ? out : null;
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
      rules: cleanRules(obj.rules),
      output: cleanOutput(obj.output),
      read: cleanRead(obj.read),
      view: cleanView(obj.view)
    };
  }

  const Bundle = {
    /** 1 件の書き出し用オブジェクト */
    exportProfile(profile, priority, withData) {
      return { app: APP, format: FORMAT, kind: 'profile', savedAt: new Date().toISOString(), profile: profileToPlain(profile, priority, withData) };
    },

    /** 一括の書き出し用オブジェクト（今の一覧の全件と、振り分け・照合ルール・出力列・① の読み込み範囲） */
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
        output: { columns: Util.clone(state.output.columns) },
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
     * 読み込んだ JSON を解釈する。
     * @returns {{kind:'profile'|'library'|'legacy', profiles:LQ.Profile[], skipped:number, combine:object|null,
     *            rules:object|null, output:object|null, read:object|null, view:object|null}}
     */
    parse(obj, fileName) {
      if (!obj || typeof obj !== 'object' || obj.app !== APP) throw new Error('LightQuery の抽出条件ファイルではありません');
      if (obj.format === 1) return parseLegacy(obj, fileName);
      if (obj.format !== FORMAT) throw new Error('このバージョンでは読み込めない形式です（format ' + obj.format + '）');
      if (obj.kind === 'profile') {
        if (!obj.profile || typeof obj.profile !== 'object') throw new Error('抽出条件が入っていません');
        return { kind: 'profile', profiles: [Profile.fromPlain(obj.profile)], skipped: 0, combine: null, rules: null, output: null, read: null, view: null };
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
          rules: cleanRules(obj.rules),
          output: cleanOutput(obj.output),
          read: cleanRead(obj.read),
          view: cleanView(obj.view)
        };
      }
      throw new Error('抽出条件ファイルの種類を判別できません');
    }
  };

  LQ.Bundle = Bundle;
})(window);
