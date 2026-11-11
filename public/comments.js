// Review layer: pin comments on any element, reply, resolve; live for everyone with the link.
(function () {
  const PAGE = document.body.dataset.page || 'home';
  const LS_NAME = 'cmx-name', LS_TOKEN = 'cmx-token', LS_MINE = 'cmx-mine';
  // localStorage can be blocked (private mode): fall back to memory so the session still works
  const mem = {};
  const store = {
    get(k) { try { const v = localStorage.getItem(k); if (v != null) return v; } catch (_) {} return mem[k] || ''; },
    set(k, v) { mem[k] = v; try { localStorage.setItem(k, v); } catch (_) {} },
  };
  let token = store.get(LS_TOKEN);
  if (!/^[a-f0-9]{32}$/.test(token)) { token = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''); store.set(LS_TOKEN, token); }
  let mineArr = []; try { mineArr = JSON.parse(store.get(LS_MINE) || '[]'); } catch (_) {}
  const mine = new Set(Array.isArray(mineArr) ? mineArr : []);
  const saveMine = () => store.set(LS_MINE, JSON.stringify([...mine]));
  let comments = {}; let showResolved = false; let openId = null; let pop = null;

  const h = (tag, attrs, ...kids) => { const el = document.createElement(tag); for (const [k, v] of Object.entries(attrs || {})) { if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v); } for (const c of kids) if (c != null) el.append(c); return el; };
  const ICON_C = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 5h16v11H9l-5 4V5Z" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/></svg>';
  const ICON_P = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>';
  const ago = (iso) => { const s = (Date.now() - new Date(iso)) / 1000; if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago'; if (s < 86400) return Math.floor(s / 3600) + ' h ago'; return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
  const isUI = (el) => !!(el && el.closest && el.closest('.cmx-bar,.cmx-layer,.cmx-pop,.cmx-side,.cmx-hint,.cmx-toast'));
  function toast(msg) { const t = h('div', { class: 'cmx-toast notranslate', translate: 'no', role: 'status', text: msg }); document.body.append(t); setTimeout(() => t.remove(), 3200); }

  // ---------- toolbar ----------
  const add = h('button', { type: 'button', class: 'cmx-add', 'aria-pressed': 'false', title: 'Add a comment (C)' });
  add.innerHTML = ICON_P + '<span><span class="cmx-lg">Add </span>comment</span>';
  const count = h('span', { class: 'cmx-badge', text: '0' });
  const listBtn = h('button', { type: 'button', class: 'cmx-listbtn', title: 'All comments', 'aria-label': 'All comments' }); listBtn.innerHTML = ICON_C + '<span class="cmx-lg">Comments</span>'; listBtn.append(count);
  const bar = h('nav', { class: 'cmx-bar notranslate', translate: 'no', 'aria-label': 'Review' },
    h('a', { href: '/', class: 'cmx-ov' + (PAGE === 'home' ? ' on' : ''), text: 'Overview' }),
    h('a', { href: '/a', class: PAGE === 'a' ? 'on' : '', 'aria-label': 'Variation A' }, h('span', { class: 'cmx-lg', text: 'Variation ' }), 'A'),
    h('a', { href: '/b', class: PAGE === 'b' ? 'on' : '', 'aria-label': 'Variation B' }, h('span', { class: 'cmx-lg', text: 'Variation ' }), 'B'),
    h('span', { class: 'cmx-sep', 'aria-hidden': 'true' }), add, listBtn);
  const layer = h('div', { class: 'cmx-layer notranslate', translate: 'no' });
  const hover = h('div', { class: 'cmx-hover', hidden: true });
  const hint = h('div', { class: 'cmx-hint notranslate', translate: 'no', hidden: true, text: 'Click anywhere on the page to leave a comment · Esc to stop' });
  document.body.append(layer, hover, hint, bar);
  // placeholder links (href="#") should not jump to the top of the page
  document.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('a[href="#"]'); if (a) e.preventDefault(); });

  // ---------- sidebar ----------
  const list = h('div', { class: 'cmx-list' });
  const resolvedBox = h('input', { type: 'checkbox', onchange: (e) => { showResolved = e.target.checked; render(); } });
  const side = h('aside', { class: 'cmx-side notranslate', translate: 'no', 'aria-label': 'Comments' },
    h('div', { class: 'cmx-side-h' }, h('b', { text: 'Comments' }), h('button', { type: 'button', class: 'cmx-x', 'aria-label': 'Close', text: '✕', onclick: () => side.classList.remove('open') })),
    h('div', { class: 'cmx-side-f' }, h('label', {}, resolvedBox, 'Show resolved')),
    list);
  document.body.append(side);
  listBtn.addEventListener('click', () => side.classList.toggle('open'));

  // ---------- anchoring ----------
  function cssPath(el) {
    const parts = []; let rooted = false;
    while (el && el.nodeType === 1 && el !== document.body && el !== document.documentElement) {
      if (el.tagName === 'FONT') { el = el.parentNode; continue; } // browser-translation wrappers
      if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) { parts.unshift('#' + el.id); rooted = true; break; }
      let sel = el.tagName.toLowerCase();
      const sib = Array.from(el.parentNode.children).filter((c) => c.tagName === el.tagName);
      if (sib.length > 1) sel += ':nth-of-type(' + (sib.indexOf(el) + 1) + ')';
      parts.unshift(sel); el = el.parentNode;
    }
    if (!parts.length) return '';
    return (rooted ? '' : 'body > ') + parts.join(' > ');
  }
  function where(a) {
    a = a || {};
    let el = null; try { el = a.sel ? document.querySelector(a.sel) : null; } catch (_) {}
    if (el && el.getClientRects().length) { const r = el.getBoundingClientRect(); return { x: r.left + scrollX + r.width * (a.fx || 0), y: r.top + scrollY + r.height * (a.fy || 0) }; }
    return { x: (a.px || 0) * document.documentElement.scrollWidth, y: a.py || 0 };
  }

  // ---------- comment mode ----------
  let down = null, swallowUntil = 0;
  function setMode(on) {
    window.__commentMode = on; document.body.classList.toggle('cmx-mode', on);
    add.classList.toggle('on', on); add.setAttribute('aria-pressed', String(on));
    hint.hidden = !on; if (!on) { hover.hidden = true; down = null; }
  }
  add.addEventListener('click', () => { closePop(); setMode(!window.__commentMode); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (pop) closePop(); else if (window.__commentMode) setMode(false); else side.classList.remove('open'); return; }
    const t = document.activeElement; const typing = t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
    if ((e.key === 'c' || e.key === 'C') && !e.metaKey && !e.ctrlKey && !e.altKey && !typing) { closePop(); setMode(!window.__commentMode); }
  });
  document.addEventListener('mousemove', (e) => {
    if (!window.__commentMode) return; const el = e.target;
    if (isUI(el) || el === document.body || el === document.documentElement) { hover.hidden = true; return; }
    const r = el.getBoundingClientRect(); Object.assign(hover.style, { left: r.left + scrollX + 'px', top: r.top + scrollY + 'px', width: r.width + 'px', height: r.height + 'px' }); hover.hidden = false;
  }, true);
  function pick(e) {
    let el = document.elementFromPoint(e.clientX, e.clientY) || e.target;
    if (isUI(el)) return;
    while (el.parentElement && el.tagName === 'FONT') el = el.parentElement;
    const r = el.getBoundingClientRect();
    const anchor = { sel: cssPath(el), fx: r.width ? (e.clientX - r.left) / r.width : 0, fy: r.height ? (e.clientY - r.top) / r.height : 0, px: (e.clientX + scrollX) / document.documentElement.scrollWidth, py: e.clientY + scrollY, vw: innerWidth };
    swallowUntil = Date.now() + 700; setMode(false); compose(anchor, e.clientX + scrollX, e.clientY + scrollY);
  }
  const swallow = (e) => (window.__commentMode || Date.now() < swallowUntil) && !isUI(e.target);
  // Touch: iOS does not send click events for plain elements to document listeners, so taps are read from pointer events.
  document.addEventListener('pointerdown', (e) => { if (!window.__commentMode || isUI(e.target)) return; down = { x: e.clientX, y: e.clientY }; e.preventDefault(); e.stopPropagation(); }, true);
  document.addEventListener('pointerup', (e) => {
    if (!window.__commentMode || isUI(e.target) || !down) return; const d = down; down = null; e.preventDefault(); e.stopPropagation();
    if (e.pointerType !== 'mouse' && Math.hypot(e.clientX - d.x, e.clientY - d.y) <= 10) pick(e);
  }, true);
  document.addEventListener('pointercancel', () => { down = null; }, true);
  // Mouse: a click places the comment. Everything the page would do with it is swallowed.
  ['mousedown', 'mouseup', 'click', 'submit'].forEach((t) => document.addEventListener(t, (e) => {
    if (!swallow(e)) return;
    e.preventDefault(); e.stopPropagation();
    if (t === 'click' && window.__commentMode) pick(e);
  }, true));

  // ---------- popovers ----------
  function closePop() { if (pop) { pop.remove(); pop = null; } openId = null; layer.querySelectorAll('.cmx-pin.active').forEach((p) => p.classList.remove('active')); }
  function place(el, x, y) {
    if (!el.isConnected) document.body.append(el); // never re-append: moving the node would drop focus (and the phone keyboard)
    const w = el.offsetWidth, hh = el.offsetHeight;
    let left = x + 14, top = y - 10;
    if (left + w > scrollX + innerWidth - 12) left = Math.max(scrollX + 12, Math.min(x - w - 14, scrollX + innerWidth - w - 12));
    if (left < scrollX + 12) left = scrollX + 12;
    if (top + hh > scrollY + innerHeight - 80) top = Math.max(scrollY + 12, scrollY + innerHeight - hh - 80);
    el.style.left = left + 'px'; el.style.top = top + 'px';
  }
  // who is posting: remembered name with a "change" link, or a name field the first time
  function identity() {
    const name = h('input', { type: 'text', placeholder: 'Your name', maxlength: '60', 'aria-label': 'Your name', autocomplete: 'name' });
    name.value = store.get(LS_NAME);
    const slot = h('div', { class: 'cmx-idslot' });
    const showInput = () => { slot.textContent = ''; slot.append(name); };
    if (store.get(LS_NAME)) slot.append(h('div', { class: 'cmx-who' }, 'Posting as ', h('b', { text: store.get(LS_NAME) }), ' · ', h('button', { type: 'button', class: 'cmx-link', text: 'change', onclick: () => { showInput(); name.focus(); name.select(); } })));
    else showInput();
    return {
      slot,
      read() { const v = (name.isConnected ? name.value : store.get(LS_NAME)).trim().slice(0, 60); if (!v) { showInput(); name.focus(); return null; } store.set(LS_NAME, v); return v; },
      first(text) { return name.isConnected ? name : text; },
    };
  }
  async function api(method, url, body) {
    let r; try { r = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); }
    catch (_) { throw new Error('no connection — try again'); }
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j;
  }
  function compose(anchor, x, y) {
    closePop();
    const id = identity(); const text = h('textarea', { placeholder: 'Write a comment…', maxlength: '2000', 'aria-label': 'Comment' });
    const post = h('button', { type: 'submit', class: 'cmx-btn pri', text: 'Post' });
    const form = h('form', { class: 'cmx-form', style: 'border-top:0' }, id.slot, text,
      h('div', { class: 'cmx-row' }, h('button', { type: 'button', class: 'cmx-btn sec', text: 'Cancel', onclick: closePop }), post));
    let busy = false;
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); if (busy) return;
      const t = text.value.trim(); if (!t) return text.focus();
      const author = id.read(); if (!author) return;
      busy = true; post.disabled = true;
      try { const r = await api('POST', '/api/comment', { page: PAGE, anchor, text: t, author, token }); mine.add(r.id); saveMine(); comments[r.id] = r.comment; closePop(); render(); openThread(r.id); }
      catch (err) { busy = false; post.disabled = false; toast('Could not save: ' + err.message); }
    });
    form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit(); } });
    pop = h('div', { class: 'cmx-pop notranslate', translate: 'no', role: 'dialog', 'aria-label': 'New comment' }, h('div', { class: 'cmx-pop-h' }, 'New comment'), form);
    place(pop, x, y); id.first(text).focus({ preventScroll: true });
  }
  const repliesOf = (id) => Object.entries(comments).filter(([, r]) => r.parent === id).sort((a, b) => a[1].createdAt.localeCompare(b[1].createdAt));
  const sigOf = (id) => { const c = comments[id]; return c ? JSON.stringify([c.resolved, c.text, repliesOf(id).map(([rid, r]) => [rid, r.text])]) : ''; };
  function openThread(id, keep) {
    const c = comments[id]; if (!c || c.parent) return; closePop(); openId = id;
    const pin = layer.querySelector('[data-id="' + id + '"]'); if (pin) pin.classList.add('active');
    const msg = (rid, r) => h('div', { class: 'cmx-msg' },
      h('div', { class: 'cmx-meta' }, h('b', { text: r.author }), h('span', {}, ago(r.createdAt), mine.has(rid) ? h('span', {}, ' · ', h('button', { type: 'button', class: 'cmx-link', text: 'Delete', onclick: () => del(rid) })) : null)),
      h('div', { class: 'cmx-text', text: r.text }));
    const msgs = h('div', { class: 'cmx-msgs' }, msg(id, c), ...repliesOf(id).map(([rid, r]) => msg(rid, r)));
    const idn = identity(); const text = h('textarea', { placeholder: 'Reply…', maxlength: '2000', 'aria-label': 'Reply', style: 'min-height:52px' });
    const send = h('button', { type: 'submit', class: 'cmx-btn pri', text: 'Reply' });
    const form = h('form', { class: 'cmx-form' }, idn.slot, text, h('div', { class: 'cmx-row' }, send));
    let busy = false;
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); if (busy) return;
      const t = text.value.trim(); if (!t) return text.focus();
      const author = idn.read(); if (!author) return;
      busy = true; send.disabled = true;
      try { const r = await api('POST', '/api/comment', { page: PAGE, parent: id, text: t, author, token }); mine.add(r.id); saveMine(); comments[r.id] = r.comment; openThread(id); }
      catch (err) { busy = false; send.disabled = false; toast('Could not save: ' + err.message); }
    });
    form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit(); } });
    const resolve = h('button', { type: 'button', class: 'cmx-link', text: c.resolved ? 'Reopen' : 'Resolve', onclick: async () => {
      try { await api('POST', '/api/comment/' + id + '/resolve', { resolved: !c.resolved, by: store.get(LS_NAME) }); if (comments[id]) comments[id].resolved = !c.resolved; closePop(); render(); }
      catch (err) { toast('Could not save: ' + err.message); } } });
    pop = h('div', { class: 'cmx-pop notranslate', translate: 'no', role: 'dialog', 'aria-label': 'Comment thread' },
      h('div', { class: 'cmx-pop-h' }, h('span', { text: '#' + (c.n || '') + (c.resolved ? ' · resolved' : '') }), h('span', {}, resolve, ' ', h('button', { type: 'button', class: 'cmx-x', 'aria-label': 'Close', text: '✕', onclick: closePop }))),
      msgs, form);
    pop.dataset.sig = sigOf(id);
    const p = where(c.anchor); place(pop, p.x, p.y); msgs.scrollTop = msgs.scrollHeight;
    if (keep) { text.value = keep.draft || ''; if (keep.focused) text.focus({ preventScroll: true }); }
  }
  async function del(id) {
    if (!confirm('Delete this comment?')) return;
    try {
      await api('DELETE', '/api/comment/' + id, { token });
      for (const [k, v] of Object.entries(comments)) if (v.parent === id) delete comments[k];
      delete comments[id]; mine.delete(id); saveMine();
      const parent = openId; closePop(); render(); if (parent && comments[parent]) openThread(parent);
    } catch (err) { toast(err.message); }
  }
  // click outside closes the popover — unless there is unsent text in it
  document.addEventListener('mousedown', (e) => {
    if (!pop || pop.contains(e.target) || (e.target.closest && e.target.closest('.cmx-pin,.cmx-item,.cmx-bar'))) return;
    const ta = pop.querySelector('textarea'); if (ta && ta.value.trim()) return;
    closePop();
  });

  // ---------- render ----------
  function threads() {
    return Object.entries(comments).filter(([, c]) => c.page === PAGE && !c.parent).sort((a, b) => a[1].createdAt.localeCompare(b[1].createdAt)).map(([id, c], i) => (c.n = i + 1, [id, c]));
  }
  function render() {
    const ts = threads(); const open = ts.filter(([, c]) => !c.resolved);
    count.textContent = String(open.length);
    layer.textContent = '';
    for (const [id, c] of ts) {
      if (c.resolved && !showResolved && openId !== id) continue;
      const p = where(c.anchor);
      const pin = h('button', { type: 'button', class: 'cmx-pin' + (c.resolved ? ' resolved' : '') + (openId === id ? ' active' : ''), 'data-id': id, 'aria-label': 'Comment ' + c.n + ' by ' + c.author, text: String(c.n), onclick: (e) => { e.stopPropagation(); openThread(id); } });
      pin.style.left = Math.max(0, Math.min(p.x, document.documentElement.scrollWidth - 32)) + 'px'; pin.style.top = Math.max(32, p.y) + 'px'; layer.append(pin);
    }
    list.textContent = '';
    const shown = ts.filter(([, c]) => showResolved || !c.resolved); const nres = ts.length - open.length;
    if (!shown.length) list.append(h('div', { class: 'cmx-empty', text: ts.length ? 'No open comments. ' + nres + ' resolved — tick “Show resolved” to see them.' : 'No comments on this page yet. Press “comment” in the bar and click anywhere on the page.' }));
    for (const [id, c] of shown) {
      const nrep = repliesOf(id).length;
      list.append(h('button', { type: 'button', class: 'cmx-item' + (c.resolved ? ' resolved' : ''), onclick: () => {
        if (innerWidth < 760) side.classList.remove('open');
        const p = where(c.anchor); scrollTo({ top: Math.max(0, p.y - innerHeight / 3), behavior: 'smooth' }); setTimeout(() => openThread(id), 350);
      } },
        h('span', { class: 'n', text: String(c.n) }),
        h('span', { class: 'b' }, h('span', { class: 'cmx-meta' }, h('b', { text: c.author }), h('span', { text: ago(c.createdAt) + (nrep ? ' · ' + nrep + (nrep > 1 ? ' replies' : ' reply') : '') + (c.resolved ? ' · resolved' : '') })), h('span', { class: 't', text: c.text }))));
    }
  }
  // keep pins on their elements as the layout moves (images, fonts, accordions, resize)
  let raf = 0;
  const reflow = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { render(); if (openId && pop && comments[openId]) { const p = where(comments[openId].anchor); place(pop, p.x, p.y); } }); };
  addEventListener('resize', reflow); addEventListener('load', reflow);
  document.addEventListener('toggle', reflow, true);
  if ('ResizeObserver' in window) new ResizeObserver(reflow).observe(document.body);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(reflow).catch(() => {});

  // ---------- live data ----------
  function apply(state) {
    if (!state || !state.comments) return;
    comments = state.comments;
    if (openId && !comments[openId]) closePop();
    render();
    // refresh an open thread only when it actually changed, keeping any half-typed reply
    if (openId && pop && pop.dataset.sig !== sigOf(openId)) { const ta = pop.querySelector('textarea'); openThread(openId, { draft: ta ? ta.value : '', focused: document.activeElement === ta }); }
  }
  const pull = () => fetch('/api/state', { cache: 'no-store' }).then((r) => r.json()).then(apply).catch(() => {});
  pull();
  let es = null;
  if ('EventSource' in window) { es = new EventSource('/api/events'); es.addEventListener('state', (e) => { try { apply(JSON.parse(e.data)); } catch (_) {} }); }
  // safety net when the live stream is blocked (some proxies): poll, and refresh when the tab comes back
  setInterval(() => { if (!es || es.readyState !== 1) pull(); }, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pull(); });
  setInterval(() => { if (!pop) render(); }, 60000); // keep "5 min ago" fresh
})();
