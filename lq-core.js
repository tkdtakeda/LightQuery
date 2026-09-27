/* =========================================================================
 * LightQuery - lq-core.js
 * 共通基盤：名前空間・イベント・DOM 生成・書式・設定保存・分割実行
 * すべての JS はクラシックスクリプト（file:// で動作）として window.LQ に登録する。
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ = global.LQ || {};

  /* ---------------------------------------------------------------------
   * EventBus：画面部品どうしを疎結合につなぐ購読・通知
   * ------------------------------------------------------------------- */
  class EventBus {
    constructor() {
      this._handlers = new Map();
    }

    on(name, handler) {
      if (!this._handlers.has(name)) this._handlers.set(name, new Set());
      this._handlers.get(name).add(handler);
      return () => this.off(name, handler);
    }

    off(name, handler) {
      const set = this._handlers.get(name);
      if (set) set.delete(handler);
    }

    emit(name, payload) {
      const set = this._handlers.get(name);
      if (!set) return;
      Array.from(set).forEach((handler) => handler(payload));
    }
  }

  /* ---------------------------------------------------------------------
   * Util：書式・変換などの小さな関数群
   * ------------------------------------------------------------------- */
  const Util = {
    formatInt(value) {
      return Number(value || 0).toLocaleString('ja-JP');
    },

    formatPercent(ratio, digits) {
      if (!isFinite(ratio)) return '—';
      return (ratio * 100).toFixed(digits === undefined ? 1 : digits) + '%';
    },

    formatSeconds(ms) {
      const sec = ms / 1000;
      if (sec < 10) return sec.toFixed(2) + ' 秒';
      if (sec < 60) return sec.toFixed(1) + ' 秒';
      const min = Math.floor(sec / 60);
      return min + ' 分 ' + Math.round(sec - min * 60) + ' 秒';
    },

    formatBytes(bytes) {
      if (!isFinite(bytes) || bytes <= 0) return '0 KB';
      if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)).toLocaleString('ja-JP') + ' KB';
      return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    },

    /** 0 始まりの列番号 → Excel の列記号（0 → A, 26 → AA） */
    colLetter(index) {
      let n = index + 1;
      let out = '';
      while (n > 0) {
        const rem = (n - 1) % 26;
        out = String.fromCharCode(65 + rem) + out;
        n = Math.floor((n - 1) / 26);
      }
      return out;
    },

    /** 列の指定（"B" / "b" / "2" / "Ｂ"）→ 1 始まりの列番号。解釈できなければ NaN */
    parseColumnRef(text) {
      const s = String(text || '').normalize('NFKC').trim().toUpperCase();
      if (/^\d+$/.test(s)) {
        const n = parseInt(s, 10);
        return n >= 1 ? n : NaN;
      }
      if (!/^[A-Z]{1,3}$/.test(s)) return NaN;
      let n = 0;
      for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
      return n;
    },

    /** 行番号の入力（"12" / "１２"）→ 正の整数。空欄は null、不正は NaN */
    parseRowRef(text) {
      const s = String(text === null || text === undefined ? '' : text).normalize('NFKC').trim();
      if (s === '') return null;
      if (!/^\d+$/.test(s)) return NaN;
      const n = parseInt(s, 10);
      return n >= 1 ? n : NaN;
    },

    escapeHtml(value) {
      return String(value === null || value === undefined ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },

    debounce(fn, wait) {
      let timer = null;
      const wrapped = function () {
        const args = arguments;
        const self = this;
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(self, args), wait);
      };
      wrapped.cancel = () => clearTimeout(timer);
      return wrapped;
    },

    clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    },

    pad2(n) {
      return (n < 10 ? '0' : '') + n;
    },

    /** ファイル名用の日時（20260927_1530） */
    timestamp(date) {
      const d = date || new Date();
      return d.getFullYear() + Util.pad2(d.getMonth() + 1) + Util.pad2(d.getDate()) +
        '_' + Util.pad2(d.getHours()) + Util.pad2(d.getMinutes());
    },

    /** 表示用の日時（2026/09/27 15:30） */
    dateTimeText(date) {
      const d = date || new Date();
      return d.getFullYear() + '/' + Util.pad2(d.getMonth() + 1) + '/' + Util.pad2(d.getDate()) +
        ' ' + Util.pad2(d.getHours()) + ':' + Util.pad2(d.getMinutes());
    },

    uid(prefix) {
      Util._seq = (Util._seq || 0) + 1;
      return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + Util._seq;
    },

    clone(value) {
      return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    },

    baseName(fileName) {
      const name = String(fileName || '');
      const dot = name.lastIndexOf('.');
      return dot > 0 ? name.slice(0, dot) : name;
    },

    extName(fileName) {
      const name = String(fileName || '');
      const dot = name.lastIndexOf('.');
      return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
    },

    sanitizeFileName(name) {
      const cleaned = String(name || '').replace(/[\\/:*?"<>|\r\n\t]/g, '_').trim();
      return cleaned || 'LightQuery';
    }
  };

  /* ---------------------------------------------------------------------
   * Dom：安全な要素生成（文字列は textContent で入れる）
   * ------------------------------------------------------------------- */
  const BOOL_PROPS = new Set(['checked', 'disabled', 'selected', 'hidden', 'readOnly', 'multiple']);

  const Dom = {
    h(tag, props, children) {
      const el = document.createElement(tag);
      if (props) {
        Object.keys(props).forEach((key) => {
          const value = props[key];
          if (value === undefined || value === null) return;
          if (key === 'class') el.className = value;
          else if (key === 'text') el.textContent = value;
          else if (key === 'html') el.innerHTML = value;
          else if (key === 'dataset') Object.assign(el.dataset, value);
          else if (key === 'value') el.value = value;
          else if (BOOL_PROPS.has(key)) el[key] = !!value;
          else if (key.indexOf('on') === 0 && typeof value === 'function') el.addEventListener(key.slice(2), value);
          else if (value !== false) el.setAttribute(key, value === true ? '' : value);
        });
      }
      Dom.append(el, children);
      return el;
    },

    append(el, children) {
      if (children === undefined || children === null || children === false) return el;
      const list = Array.isArray(children) ? children : [children];
      list.forEach((child) => {
        if (child === undefined || child === null || child === false) return;
        if (Array.isArray(child)) Dom.append(el, child);
        else if (child instanceof Node) el.appendChild(child);
        else el.appendChild(document.createTextNode(String(child)));
      });
      return el;
    },

    /** Font Awesome のアイコン要素 */
    icon(name, extraClass) {
      return Dom.h('i', {
        class: 'fa-solid fa-' + name + (extraClass ? ' ' + extraClass : ''),
        'aria-hidden': 'true'
      });
    },

    /** innerHTML 用のアイコン文字列 */
    iconHtml(name, extraClass) {
      return '<i class="fa-solid fa-' + name + (extraClass ? ' ' + extraClass : '') + '" aria-hidden="true"></i>';
    },

    clear(el) {
      while (el.firstChild) el.removeChild(el.firstChild);
      return el;
    },

    qs(selector, root) {
      return (root || document).querySelector(selector);
    },

    qsa(selector, root) {
      return Array.from((root || document).querySelectorAll(selector));
    },

    /** 入力中の要素（テキスト入力・選択・編集領域）か */
    isEditable(el) {
      if (!el) return false;
      const tag = el.tagName;
      if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (tag === 'INPUT') {
        const type = (el.type || 'text').toLowerCase();
        return ['checkbox', 'radio', 'button', 'submit', 'file', 'range', 'color'].indexOf(type) === -1;
      }
      return !!el.isContentEditable;
    }
  };

  /* ---------------------------------------------------------------------
   * Prefs：表示件数などの「使い勝手の記憶」だけを保存（データは保存しない）
   * ------------------------------------------------------------------- */
  const PREFIX = 'lightquery.v1.';

  const Prefs = {
    get(key, fallback) {
      try {
        const raw = global.localStorage.getItem(PREFIX + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },

    set(key, value) {
      try {
        global.localStorage.setItem(PREFIX + key, JSON.stringify(value));
      } catch (e) {
        /* 保存できない環境では記憶しないだけで動作は継続する */
      }
    }
  };

  /* ---------------------------------------------------------------------
   * Async：重い処理を小分けにして画面を固めないための道具
   * ------------------------------------------------------------------- */
  const Async = {
    /** 描画・入力を先に処理させてから続きを実行する */
    yieldToUI() {
      return new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
          channel.port1.close();
          resolve();
        };
        channel.port2.postMessage(0);
      });
    },

    nextFrame() {
      return new Promise((resolve) => global.requestAnimationFrame(() => resolve()));
    },

    /** 状態表示を確実に描画してから重い同期処理に入るために使う */
    async paint() {
      await Async.nextFrame();
      await Async.nextFrame();
    },

    /** 一定時間ごとに処理を区切る判定器 */
    createSlicer(budgetMs) {
      const budget = budgetMs || 24;
      let start = performance.now();
      return {
        due() {
          return performance.now() - start > budget;
        },
        reset() {
          start = performance.now();
        }
      };
    }
  };

  /** 処理の中止要求を伝える */
  class CancelToken {
    constructor() {
      this.cancelled = false;
    }

    cancel() {
      this.cancelled = true;
    }
  }

  LQ.EventBus = EventBus;
  LQ.Util = Util;
  LQ.Dom = Dom;
  LQ.Prefs = Prefs;
  LQ.Async = Async;
  LQ.CancelToken = CancelToken;
})(window);
