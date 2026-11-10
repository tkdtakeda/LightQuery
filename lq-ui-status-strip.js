/* =========================================================================
 * LightQuery - lq-ui-status-strip.js
 * 表の上の情報を「1 行の状態帯」にまとめ、表の面積を最大にする（基本設計 1-1・1-13）
 *   左：要約（.lq-summary。入りきらない項目は隠し、全文はツールチップ）
 *   中：札（チップ）。処理の流れ・絞り込み・② 未一致・前回との違い・お知らせ など。押すと元の帯の中身（操作つき）をポップオーバーで開く
 *   右：要約の操作ボタン（.lq-summary__actions）
 *   入りきらない札は、優先度の低い順に「+N」の札にまとめる（1 行を保つ。適用中であることは隠さない）
 *
 * 使い方（各タブの描画は今までどおり info に要素を足すだけ）：
 *   ・札にしたい帯は StatusStrip.fold(el, spec) で印を付けてから足す
 *   ・印のない注意（.lq-note）は自動で札にまとめる（警告・誤り →「ご注意 N」／お知らせ・ヒント →「お知らせ N」）
 *   ・印のないそのほかの要素（表示するグラフ・表示する行・② の切替など、常に触る選択）は、状態帯の下に 1 行ずつ残す
 *   ・描画の最後に StatusStrip.layout(ctx, info) を呼ぶ
 * ========================================================================= */
(function (global) {
  'use strict';

  const LQ = global.LQ;
  const Dom = LQ.Dom;
  const UI = LQ.UI;
  const h = Dom.h;

  const KEY = 'strip:';
  const SPEC = '_lqStrip';
  /* この優先度以上の札（未反映など）は「+N」にまとめない */
  const KEEP = 100;
  /* 自動でまとめる注意の札（優先度：大きいほど先に並べ、最後まで残す） */
  const NOTE_GROUPS = [
    { id: 'notes-warn', kinds: ['warn', 'error'], icon: 'triangle-exclamation', label: 'ご注意', tone: 'warn', priority: 80 },
    { id: 'notes-info', kinds: ['info', 'tip', 'ok'], icon: 'circle-info', label: 'お知らせ', tone: 'muted', priority: 10 }
  ];

  function noteKind(el) {
    const m = /lq-note--(\w+)/.exec(el.className);
    return m ? m[1] : 'info';
  }

  const StatusStrip = {
    /**
     * 帯に「札にまとめる」印を付ける
     * @param {Element|null} el
     * @param {{id:string, label:string, icon?:string, badge?:string[], tone?:'primary'|'cond'|'warn'|'muted', priority?:number, heading?:string, title?:string}} spec
     * @returns {Element|null}
     */
    fold(el, spec) {
      if (el) el[SPEC] = spec;
      return el;
    },

    /**
     * info の中身を、状態帯（要約・札・操作）と残す行に並べ直す
     * @param {object} ctx
     * @param {Element} info
     */
    layout(ctx, info) {
      const children = Array.from(info.children);
      if (!children.length) return;
      const summary = children.find((el) => el.classList.contains('lq-summary')) || null;
      const chips = [];
      const rows = [];
      const notes = new Map();
      children.forEach((el) => {
        if (el === summary) return;
        if (el[SPEC]) chips.push({ spec: el[SPEC], body: [el] });
        else if (el.classList.contains('lq-note')) {
          const group = NOTE_GROUPS.find((g) => g.kinds.indexOf(noteKind(el)) !== -1) || NOTE_GROUPS[1];
          if (!notes.has(group)) notes.set(group, []);
          notes.get(group).push(el);
        } else rows.push(el);
      });
      notes.forEach((list, g) => chips.push({ spec: { id: g.id, icon: g.icon, label: g.label + ' ' + list.length, tone: g.tone, priority: g.priority, heading: g.label }, body: list }));
      chips.sort((a, b) => (b.spec.priority || 0) - (a.spec.priority || 0));
      Dom.clear(info);
      if (summary || chips.length) info.appendChild(StatusStrip._line(ctx, summary, chips));
      rows.forEach((el) => info.appendChild(el));
      StatusStrip._refreshOpen(ctx, chips);
    },

    _line(ctx, summary, chips) {
      const actions = h('span', { class: 'lq-strip__actions' });
      if (summary) {
        summary.querySelectorAll(':scope > .lq-summary__actions').forEach((el) => actions.appendChild(el));
        summary.classList.add('lq-strip__summary');
        if (!summary.title) {
          const facts = summary.querySelector('.lq-summary__facts') || summary;
          summary.title = Array.from(facts.children).map((el) => el.textContent.trim()).filter(Boolean).join('　｜　');
        }
      }
      const box = h('span', { class: 'lq-strip__chips' });
      const line = h('div', { class: 'lq-strip' }, [summary, box, actions.children.length ? actions : null]);
      line._lqFit = () => StatusStrip._fit(ctx, line, box, chips);
      /* 幅が変わったら（パネルの開閉・画面の大きさ）札の入り方を決め直す */
      if (global.ResizeObserver) {
        let width = 0;
        const ro = new ResizeObserver(() => {
          if (!line.isConnected) {
            ro.disconnect();
            return;
          }
          if (line.clientWidth === width) return;
          width = line.clientWidth;
          line._lqFit();
        });
        ro.observe(line);
      }
      global.requestAnimationFrame(() => line.isConnected && line._lqFit());
      StatusStrip._fill(ctx, box, chips, []);
      return line;
    },

    /**
     * 1 行に収まるまで詰める：① 右の操作ボタンを文字なし（アイコンだけ。ツールチップは残す）にする
     *   → ② 優先度の低い札から「+N」にまとめる（未反映などの警告（優先度 100 以上）はまとめない）
     */
    _fit(ctx, line, box, chips) {
      const over = () => line.scrollWidth > line.clientWidth + 1;
      let hidden = [];
      line.classList.remove('is-tight');
      StatusStrip._fill(ctx, box, chips, hidden);
      if (!over()) return;
      line.classList.add('is-tight');
      const foldable = chips.filter((c) => (c.spec.priority || 0) < KEEP);
      while (over() && hidden.length < foldable.length) {
        hidden = foldable.slice(foldable.length - hidden.length - 1);
        StatusStrip._fill(ctx, box, chips, hidden);
      }
    },

    _fill(ctx, box, chips, hidden) {
      Dom.clear(box);
      chips.filter((c) => hidden.indexOf(c) === -1).forEach((c) => box.appendChild(StatusStrip._chip(ctx, c)));
      if (hidden.length) {
        const more = { spec: { id: 'more', label: '+' + hidden.length, tone: 'muted', heading: 'ほかの状態（' + hidden.length + ' 件）',
          title: hidden.map((c) => c.spec.heading || c.spec.label).join('・') }, body: null, hidden: hidden };
        box.appendChild(StatusStrip._chip(ctx, more));
      }
    },

    _chip(ctx, c) {
      const s = c.spec;
      const key = KEY + s.id;
      const open = ctx.popovers.isOpen(key);
      const btn = h('button', {
        class: 'lq-schip lq-schip--' + (s.tone || 'primary') + (open ? ' is-open' : ''), type: 'button',
        title: (s.title || s.heading || s.label) + '（押すと詳しく表示）', 'aria-haspopup': 'dialog', 'aria-expanded': open ? 'true' : 'false',
        dataset: { focusKey: key }
      }, [
        s.badge ? UI.badge(s.badge[0], s.badge[1]) : (s.icon ? Dom.icon(s.icon) : null),
        h('span', { class: 'lq-schip__label lq-num', text: s.label }),
        Dom.icon('chevron-down', 'lq-schip__caret')
      ]);
      btn.addEventListener('click', () => StatusStrip._toggle(ctx, btn, c));
      c.el = btn;
      return btn;
    },

    _toggle(ctx, btn, c) {
      const pop = ctx.popovers;
      const key = KEY + c.spec.id;
      if (pop.isOpen(key)) {
        pop.close();
        return;
      }
      pop.open(btn, StatusStrip._content(ctx, c), {
        key: key, placement: 'bottom-start', className: 'lq-strip-pop',
        onClose: () => {
          if (btn.isConnected) {
            btn.classList.remove('is-open');
            btn.setAttribute('aria-expanded', 'false');
          }
        }
      });
      btn.classList.add('is-open');
      btn.setAttribute('aria-expanded', 'true');
    },

    _content(ctx, c) {
      const pop = ctx.popovers;
      const sections = c.hidden
        ? c.hidden.map((x) => h('section', { class: 'lq-strip-pop__section' }, [h('h4', { class: 'lq-strip-pop__sub', text: x.spec.heading || x.spec.label })].concat(x.body)))
        : c.body;
      return [
        h('div', { class: 'lq-popover__head' }, [c.spec.icon ? Dom.icon(c.spec.icon) : null, h('span', { class: 'lq-colmenu__title', text: c.spec.heading || c.spec.label }),
          UI.iconButton('xmark', '閉じる（Esc）', () => pop.close(), 'lq-btn--sm')]),
        h('div', { class: 'lq-popover__body lq-strip-pop__body' }, sections)
      ];
    },

    /** 描き直したとき、開いている札の中身を新しいものに入れ替える（なくなった札なら閉じる） */
    _refreshOpen(ctx, chips) {
      const pop = ctx.popovers;
      const cur = pop.current;
      if (!cur || !cur.key || cur.key.indexOf(KEY) !== 0) return;
      const id = cur.key.slice(KEY.length);
      global.requestAnimationFrame(() => {
        if (pop.current !== cur) return;
        /* 「+N」は中身の組み合わせが変わりうるため、描き直したら閉じる */
        const c = chips.find((x) => x.spec.id === id);
        if (!c || !c.el || !c.el.isConnected) {
          pop.close();
          return;
        }
        const scroll = cur.el.querySelector('.lq-strip-pop__body');
        const top = scroll ? scroll.scrollTop : 0;
        Dom.clear(cur.el);
        StatusStrip._content(ctx, c).forEach((el) => cur.el.appendChild(el));
        const next = cur.el.querySelector('.lq-strip-pop__body');
        if (next) next.scrollTop = top;
        cur.anchor = c.el;
        c.el.classList.add('is-open');
        c.el.setAttribute('aria-expanded', 'true');
      });
    }
  };

  LQ.StatusStrip = StatusStrip;
})(window);
