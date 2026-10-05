/* =========================================================================
 * LightQuery - lq-ui-kit.js
 * 画面の共通部品：入力補助（全選択・Enter で次へ）、反映の合図、通知、小窓、モーダル、部品の組み立て
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Dom = LQ.Dom;
  const h = Dom.h;

  /* ---------------------------------------------------------------------
   * FormNav：選択時は変更できる部分を全選択、Enter で確定して次の入力へ（Shift+Enter で前へ）
   * ------------------------------------------------------------------- */
  const NAV_SELECTOR = 'input:not([type=checkbox]):not([type=radio]):not([type=file]):not([disabled]), select:not([disabled])';
  const SELECTABLE = /^(text|search|number|tel|url)$/;

  const FormNav = {
    attach(root) {
      root.addEventListener('focusin', (e) => {
        const el = e.target;
        if (el.tagName !== 'INPUT' || !SELECTABLE.test(el.type || 'text')) return;
        el.select();
        el._lqSelectedAt = performance.now();
      });
      root.addEventListener('mouseup', (e) => {
        const el = e.target;
        if (el._lqSelectedAt && performance.now() - el._lqSelectedAt < 400) e.preventDefault();
        el._lqSelectedAt = 0;
      });
      root.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
        const el = e.target;
        if (!el.matches || !el.matches('input, select') || el.type === 'checkbox' || el.type === 'radio') return;
        if (el.dataset.navStop === 'true') return;
        e.preventDefault();
        el.dispatchEvent(new Event('change', { bubbles: true }));
        /* 確定の処理がフォーカスを別の欄へ移した（例：固定値の入力欄へ）ときは、その移動を優先する */
        if (document.activeElement !== el) return;
        FormNav.focusNext(root, el, e.shiftKey ? -1 : 1);
      });
    },

    focusNext(root, from, dir) {
      const fields = Dom.qsa(NAV_SELECTOR, root).filter((el) => el.offsetParent !== null);
      const next = fields[fields.indexOf(from) + dir];
      if (next) next.focus();
      else from.blur();
    }
  };

  /* ---------------------------------------------------------------------
   * Flash：入力が反映されたことを直感的に知らせる（色の瞬き＋「✓ 反映」）
   * ------------------------------------------------------------------- */
  const Flash = {
    el(el, kind) {
      if (el && el._lqCombo) el = el._lqCombo.input;
      if (!el) return;
      const cls = kind === 'warn' ? 'lq-flash--warn' : 'lq-flash';
      el.classList.remove('lq-flash', 'lq-flash--warn');
      void el.offsetWidth;
      el.classList.add(cls);
      el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
    },

    /** .lq-field の見出し横に「✓ 反映」を一瞬表示する */
    applied(field, text) {
      if (!field) return;
      const label = field.querySelector('.lq-field__label') || field;
      const old = label.querySelector('.lq-applied');
      if (old) old.remove();
      const tag = h('span', { class: 'lq-applied' }, [Dom.icon('check'), text || '反映']);
      label.appendChild(tag);
      tag.addEventListener('animationend', () => tag.remove(), { once: true });
    },

    /** 入力欄を瞬かせ、所属する .lq-field に「✓ 反映」を出す */
    input(input, kind, text) {
      Flash.el(input, kind);
      Flash.applied(input && input.closest('.lq-field'), text);
    }
  };

  /* ---------------------------------------------------------------------
   * ToastHost：画面右下の通知。取り消しなどの操作ボタンを付けられる
   * ------------------------------------------------------------------- */
  const TOAST_ICON = { success: 'circle-check', info: 'circle-info', warn: 'triangle-exclamation', error: 'circle-exclamation' };
  const TOAST_MS = { base: 5000, action: 10000, error: 9000, resume: 2500 };
  const TOAST_MAX = 3;

  class ToastHost {
    constructor(root) {
      this.root = root;
    }

    /**
     * @param {{type?:string, title:string, message?:string, actions?:Array<{label:string, icon?:string, onClick:Function}>, duration?:number}} opt
     */
    show(opt) {
      const type = opt.type || 'info';
      const actions = opt.actions || [];
      let timer = null;
      let el = null;
      const close = () => {
        if (!el || el.classList.contains('is-leaving')) return;
        clearTimeout(timer);
        el.classList.add('is-leaving');
        el.addEventListener('animationend', () => el.remove(), { once: true });
      };
      el = h('div', { class: 'lq-toast lq-toast--' + type, role: type === 'error' ? 'alert' : 'status' }, [
        Dom.icon(TOAST_ICON[type] || TOAST_ICON.info, 'lq-toast__icon'),
        h('div', { class: 'lq-toast__body' }, [
          h('div', { class: 'lq-toast__title', text: opt.title }),
          opt.message ? h('div', { class: 'lq-toast__msg', text: opt.message }) : null,
          actions.length ? h('div', { class: 'lq-toast__actions' }, actions.map((a) => h('button', {
            class: 'lq-btn lq-btn--sm' + (a.primary ? ' lq-btn--primary' : ''),
            type: 'button',
            onclick: () => {
              close();
              a.onClick();
            }
          }, [a.icon ? Dom.icon(a.icon) : null, a.label]))) : null
        ]),
        h('button', { class: 'lq-btn lq-btn--ghost lq-btn--icon lq-btn--sm', type: 'button', title: '閉じる', onclick: close }, Dom.icon('xmark'))
      ]);
      this.root.appendChild(el);
      while (this.root.children.length > TOAST_MAX) this.root.firstElementChild.remove();
      const ms = opt.duration || (actions.length ? TOAST_MS.action : (type === 'error' ? TOAST_MS.error : TOAST_MS.base));
      timer = setTimeout(close, ms);
      el.addEventListener('mouseenter', () => clearTimeout(timer));
      el.addEventListener('mouseleave', () => {
        clearTimeout(timer);
        timer = setTimeout(close, TOAST_MS.resume);
      });
      return { close: close };
    }
  }

  /* ---------------------------------------------------------------------
   * PopoverHost：ボタンに付いて開く小窓。外側のクリック・Esc で閉じる（同時に 1 つ）
   * ------------------------------------------------------------------- */
  const GAP = 6;
  const MARGIN = 12;

  class PopoverHost {
    constructor(root) {
      this.root = root;
      this.current = null;
      document.addEventListener('mousedown', (e) => {
        if (!this.current) return;
        const c = this.current;
        if (c.el.contains(e.target)) return;
        if (c.anchor && c.anchor.contains && c.anchor.contains(e.target)) return;
        this.close();
      }, true);
      global.addEventListener('resize', () => this.close());
    }

    isOpen(key) {
      return !!this.current && (key === undefined || this.current.key === key);
    }

    /**
     * @param {Element|null} anchor 基準の要素（null なら画面上部中央）
     * @param {Node|Node[]} content 中身
     * @param {{key?:string, size?:'lg'|'xl', placement?:string, onClose?:Function, className?:string}} options
     */
    open(anchor, content, options) {
      const opt = options || {};
      if (anchor && anchor._lqCombo) anchor = anchor._lqCombo.el;
      this.close();
      const el = h('div', {
        class: 'lq-popover' + (opt.size ? ' lq-popover--' + opt.size : '') + (opt.className ? ' ' + opt.className : ''),
        role: 'dialog'
      }, content);
      this.root.appendChild(el);
      this.current = { el: el, anchor: anchor, key: opt.key || null, onClose: opt.onClose || null };
      this._position(el, anchor, opt.placement || 'bottom-end');
      return { el: el, close: () => this.close() };
    }

    close() {
      if (!this.current) return false;
      const c = this.current;
      this.current = null;
      c.el.remove();
      if (c.onClose) c.onClose();
      return true;
    }

    /* 実行時に決まる座標だけは style で与える（見た目の値ではないため） */
    _position(el, anchor, placement) {
      const vw = global.innerWidth;
      const vh = global.innerHeight;
      const w = el.offsetWidth;
      const hgt = el.offsetHeight;
      let left;
      let top;
      if (!anchor) {
        left = (vw - w) / 2;
        top = vh * 0.14;
      } else {
        const r = anchor.getBoundingClientRect();
        if (placement === 'right-start') {
          left = r.right + GAP;
          top = r.top;
        } else if (placement === 'right-end') {
          left = r.right + GAP;
          top = r.bottom - hgt;
        } else {
          left = placement === 'bottom-start' ? r.left : r.right - w;
          top = r.bottom + GAP;
          if (top + hgt > vh - MARGIN && r.top - GAP - hgt > MARGIN) top = r.top - GAP - hgt;
        }
      }
      left = Math.max(MARGIN, Math.min(left, vw - w - MARGIN));
      top = Math.max(MARGIN, Math.min(top, vh - hgt - MARGIN));
      el.style.left = Math.round(left) + 'px';
      el.style.top = Math.round(top) + 'px';
    }
  }

  /* ---------------------------------------------------------------------
   * 部品の組み立て
   * ------------------------------------------------------------------- */
  const STATUS_ICON = { ok: 'circle-check', warn: 'triangle-exclamation', error: 'circle-exclamation', info: 'circle-info' };

  /** 切替ボタン群（値の変更は onChange で受け取る） */
  class Segmented {
    constructor(options, value, onChange, extraClass) {
      this.options = options;
      this.value = value;
      this.onChange = onChange;
      this.buttons = new Map();
      this.el = h('div', { class: 'lq-seg' + (extraClass ? ' ' + extraClass : ''), role: 'radiogroup' });
      options.forEach((opt) => {
        const btn = h('button', {
          class: 'lq-seg__item',
          type: 'button',
          title: opt.title || null,
          onclick: () => {
            if (btn.disabled || this.value === opt.value) return;
            this.set(opt.value);
            this.onChange(opt.value);
          }
        }, [opt.icon ? Dom.icon(opt.icon) : null, opt.label]);
        this.buttons.set(opt.value, btn);
        this.el.appendChild(btn);
      });
      this.set(value);
    }

    set(value) {
      this.value = value;
      this.buttons.forEach((btn, v) => {
        btn.classList.toggle('is-active', v === value);
        btn.setAttribute('aria-checked', v === value ? 'true' : 'false');
      });
    }

    setDisabled(disabled) {
      this.buttons.forEach((btn) => {
        btn.disabled = !!disabled;
      });
    }
  }

  const UI = {
    field(label, control, hint, extraClass) {
      return h('div', { class: 'lq-field' + (extraClass ? ' ' + extraClass : '') }, [
        h('label', { class: 'lq-field__label', text: label }),
        control,
        hint ? h('div', { class: 'lq-field__hint', text: hint }) : null
      ]);
    },

    section(title, children, extra) {
      return h('section', { class: 'lq-section' }, [
        h('h3', { class: 'lq-section__title' }, [title].concat(extra || [])),
        h('div', { class: 'lq-stack' }, children)
      ]);
    },

    /**
     * 開閉できる区画（使う頻度の低い設定を畳んでおく）。見出しの横に現在の設定の要約を出す。
     * @param {string} title
     * @param {Node[]} children
     * @param {{open?:boolean, onToggle?:Function}} options
     * @returns {{el:HTMLElement, summary:HTMLElement}}
     */
    collapsible(title, children, options) {
      const o = options || {};
      const summary = h('span', { class: 'lq-collapse__summary' });
      const el = h('details', { class: 'lq-section lq-collapse' }, [
        h('summary', { class: 'lq-section__title lq-collapse__head' }, [Dom.icon('chevron-right', 'lq-collapse__chevron'), title, summary]),
        h('div', { class: 'lq-stack' }, children)
      ]);
      el.open = !!o.open;
      if (o.onToggle) el.addEventListener('toggle', () => o.onToggle(el.open));
      return { el: el, summary: summary };
    },

    /** メニューの項目（押すと小窓を閉じてから実行。無効のときは理由を小さく表示する） */
    menuItem(pop, icon, label, sub, onClick, opts) {
      const o = opts || {};
      return h('button', {
        class: 'lq-menu__item' + (o.danger ? ' is-danger' : ''), type: 'button', disabled: !!o.disabled, title: o.title || null,
        onclick: () => {
          pop.close();
          onClick();
        }
      }, [Dom.icon(icon), h('span', { class: 'lq-menu__text' }, [h('span', { text: label }), sub ? h('span', { class: 'lq-menu__sub', text: sub }) : null])]);
    },

    switchToggle(text, checked, onChange) {
      const input = h('input', { type: 'checkbox', checked: checked });
      input.addEventListener('change', () => onChange(input.checked));
      const el = h('label', { class: 'lq-switch' }, [input, h('span', { class: 'lq-switch__track' }), h('span', { class: 'lq-switch__text', text: text })]);
      return { el: el, input: input };
    },

    /** options：[{value,label}] または [{group,items:[...]}] */
    fillSelect(select, options, value, placeholder) {
      Dom.clear(select);
      if (placeholder) select.appendChild(h('option', { value: '', text: placeholder }));
      options.forEach((opt) => {
        if (opt.items) {
          const g = h('optgroup', { label: opt.group });
          opt.items.forEach((item) => g.appendChild(h('option', { value: item.value, text: item.label, disabled: item.disabled })));
          select.appendChild(g);
        } else {
          select.appendChild(h('option', { value: opt.value, text: opt.label, disabled: opt.disabled }));
        }
      });
      select.value = value === null || value === undefined ? '' : value;
      if (select.value !== (value || '') && placeholder) select.value = '';
    },

    status(kind, text) {
      return h('span', { class: 'lq-status lq-status--' + kind }, [Dom.icon(STATUS_ICON[kind] || STATUS_ICON.info), h('span', { text: text })]);
    },

    note(kind, body, action) {
      const icon = { tip: 'lightbulb', warn: 'triangle-exclamation', error: 'circle-exclamation', ok: 'circle-check', info: 'circle-info' }[kind] || 'circle-info';
      return h('div', { class: 'lq-note lq-note--' + kind }, [
        Dom.icon(icon),
        h('div', { class: 'lq-note__body' }, [body, action ? h('div', { class: 'lq-note__action' }, action) : null])
      ]);
    },

    iconButton(icon, title, onClick, extraClass) {
      return h('button', { class: 'lq-btn lq-btn--ghost lq-btn--icon' + (extraClass ? ' ' + extraClass : ''), type: 'button', title: title, 'aria-label': title, onclick: onClick }, Dom.icon(icon));
    },

    badge(kind, text) {
      return h('span', { class: 'lq-badge lq-badge--' + kind, text: text });
    },

    /** 優先順位の印（画面のどこでも同じ見た目・同じ書き方「N 位」にする） */
    rank(n, title) {
      return h('span', { class: 'lq-badge lq-badge--rank', text: n + ' 位', title: title || null });
    },

    sourceBadge(prefix) {
      if (prefix === 's:') return UI.badge('src', '①');
      if (prefix === 'c:') return UI.badge('cond', '②');
      return UI.badge('meta', '情報');
    }
  };

  LQ.FormNav = FormNav;
  LQ.Flash = Flash;
  LQ.ToastHost = ToastHost;
  LQ.PopoverHost = PopoverHost;
  LQ.Segmented = Segmented;
  LQ.UI = UI;
})(window);
