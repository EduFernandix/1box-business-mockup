// Review layer: pin comments on any element, reply, resolve; live for everyone with the link.
(function () {
  const PAGE = (document.body.dataset.page || location.pathname.replace(/^\/|\.html$/g, '') || 'home');
  const LS_NAME = 'cmx-name', LS_TOKEN = 'cmx-token';
  const store = { get(k) { try { return localStorage.getItem(k) || ''; } catch (_) { return ''; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} } };
  let token = store.get(LS_TOKEN);
  if (!token) { token = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''); store.set(LS_TOKEN, token); }
  const tokenHash = null; // the server never returns hashes; ownership is checked server-side on delete
  let comments = {}; let showResolved = false; let openId = null;
  const mine = new Set(JSON.parse(store.get('cmx-mine') || '[]'));
  const saveMine = () => store.set('cmx-mine', JSON.stringify([...mine]));

  const h = (tag, attrs, ...kids) => { const el = document.createElement(tag); for (const [k, v] of Object.entries(attrs || {})) { if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v); } for (const c of kids) if (c != null) el.append(c); return el; };
  const ICON_C = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 5h16v11H9l-5 4V5Z" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/></svg>';
  const ICON_P = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>';
  const ago = (iso) => { const s = (Date.now() - new Date(iso)) / 1000; if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago'; if (s < 86400) return Math.floor(s / 3600) + ' h ago'; return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' }); };
  const isUI = (el) => !!(el && el.closest && el.closest('.cmx-bar,.cmx-layer,.cmx-pop,.cmx-side,.cmx-hint,.cmx-toast'));
  function toast(msg) { const t = h('div', { class: 'cmx-toast', role: 'status', text: msg }); document.body.append(t); setTimeout(() => t.remove(), 2600); }

  // ---------- toolbar ----------
  const add = h('button', { type: 'button', class: 'cmx-add', 'aria-pressed': 'false', title: 'Add a comment (C)' });
  add.innerHTML = ICON_P + '<span>Add comment</span>';
  const count = h('span', { class: 'cmx-badge', text: '0' });
  const listBtn = h('button', { type: 'button', title: 'All comments' }); listBtn.innerHTML = ICON_C + '<span>Comments</span>'; listBtn.append(count);
  const bar = h('nav', { class: 'cmx-bar', 'aria-label': 'Review' },
    h('a', { href: '/', text: 'Overview' }),
    h('a', { href: '/a', class: PAGE === 'a' ? 'on' : '', text: 'Variation A' }),
    h('a', { href: '/b', class: PAGE === 'b' ? 'on' : '', text: 'Variation B' }),
    h('span', { class: 'cmx-sep', 'aria-hidden': 'true' }), add, listBtn);
  const layer = h('div', { class: 'cmx-layer' });
  const hover = h('div', { class: 'cmx-hover', hidden: true });
  const hint = h('div', { class: 'cmx-hint', hidden: true, text: 'Click anywhere on the page to leave a comment · Esc to stop' });
  document.body.append(layer, hover, hint, bar);

  // ---------- sidebar ----------
  const list = h('div', { class: 'cmx-list' });
  const resolvedBox = h('input', { type: 'checkbox', onchange: (e) => { showResolved = e.target.checked; render(); } });
  const side = h('aside', { class: 'cmx-side', 'aria-label': 'Comments' },
    h('div', { class: 'cmx-side-h' }, h('b', { text: 'Comments' }), h('button', { type: 'button', class: 'cmx-x', 'aria-label': 'Close', text: '✕', onclick: () => side.classList.remove('open') })),
    h('div', { class: 'cmx-side-f' }, h('label', {}, resolvedBox, 'Show resolved')),
    list);
  document.body.append(side);
  listBtn.addEventListener('click', () => side.classList.toggle('open'));

  // ---------- anchoring ----------
  function cssPath(el) {
    const parts = [];
    while (el && el.nodeType === 1 && el !== document.body) {
      let sel = el.tagName.toLowerCase();
      if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) { parts.unshift('#' + el.id); break; }
      const sib = Array.from(el.parentNode.children).filter((c) => c.tagName === el.tagName);
      if (sib.length > 1) sel += ':nth-of-type(' + (sib.indexOf(el) + 1) + ')';
      parts.unshift(sel); el = el.parentNode;
    }
    return parts.join(' > ');
  }
  function where(a) {
    let el = null; try { el = a.sel ? document.querySelector(a.sel) : null; } catch (_) {}
    if (el && el.getClientRects().length) { const r = el.getBoundingClientRect(); return { x: r.left + scrollX + r.width * a.fx, y: r.top + scrollY + r.height * a.fy }; }
    return { x: a.px * document.documentElement.scrollWidth, y: a.py };
  }

  // ---------- comment mode ----------
  function setMode(on) {
    window.__commentMode = on; document.body.classList.toggle('cmx-mode', on);
    add.classList.toggle('on', on); add.setAttribute('aria-pressed', String(on));
    hint.hidden = !on; if (!on) hover.hidden = true;
  }
  add.addEventListener('click', () => { closePop(); setMode(!window.__commentMode); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (pop) closePop(); else setMode(false); }
    if ((e.key === 'c' || e.key === 'C') && !e.metaKey && !e.ctrlKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) { closePop(); setMode(!window.__commentMode); }
  });
  document.addEventListener('mousemove', (e) => {
    if (!window.__commentMode) return; const el = e.target;
    if (isUI(el) || el === document.body || el === document.documentElement) { hover.hidden = true; return; }
    const r = el.getBoundingClientRect(); Object.assign(hover.style, { left: r.left + scrollX + 'px', top: r.top + scrollY + 'px', width: r.width + 'px', height: r.height + 'px' }); hover.hidden = false;
  }, true);
  // Swallow page interaction while commenting (links, buttons, form controls)
  ['pointerdown', 'mousedown', 'mouseup', 'click', 'focusin', 'submit'].forEach((t) => document.addEventListener(t, (e) => {
    if (!window.__commentMode || isUI(e.target)) return;
    e.preventDefault(); e.stopPropagation();
    if (t === 'click') {
      const el = e.target; const r = el.getBoundingClientRect();
      const anchor = { sel: cssPath(el), fx: r.width ? (e.clientX - r.left) / r.width : 0, fy: r.height ? (e.clientY - r.top) / r.height : 0, px: e.pageX / document.documentElement.scrollWidth, py: e.pageY, vw: innerWidth };
      setMode(false); compose(anchor, e.pageX, e.pageY);
    }
  }, true));

  // ---------- popovers ----------
  let pop = null;
  function closePop() { if (pop) { pop.remove(); pop = null; } openId = null; layer.querySelectorAll('.cmx-pin.active').forEach((p) => p.classList.remove('active')); }
  function place(el, x, y) {
    document.body.append(el); const w = el.offsetWidth, hh = el.offsetHeight;
    let left = x + 14, top = y - 10;
    if (left + w > scrollX + innerWidth - 12) left = Math.max(scrollX + 12, x - w - 14);
    if (top + hh > scrollY + innerHeight - 80) top = Math.max(scrollY + 12, scrollY + innerHeight - hh - 80);
    el.style.left = left + 'px'; el.style.top = top + 'px';
  }
  function nameField() { return h('input', { type: 'text', placeholder: 'Your name', maxlength: '60', value: store.get(LS_NAME), 'aria-label': 'Your name', autocomplete: 'name' }); }
  async function api(method, url, body) {
    const r = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j;
  }
  function compose(anchor, x, y) {
    closePop();
    const name = nameField(); const text = h('textarea', { placeholder: 'Write a comment…', maxlength: '2000', 'aria-label': 'Comment' });
    const post = h('button', { type: 'submit', class: 'cmx-btn pri', text: 'Post' });
    const form = h('form', { class: 'cmx-form', style: 'border-top:0' }, store.get(LS_NAME) ? null : name, text,
      h('div', { class: 'cmx-row' }, h('button', { type: 'button', class: 'cmx-btn sec', text: 'Cancel', onclick: closePop }), post));
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); const t = text.value.trim(); if (!t) return text.focus();
      const author = (name.value || store.get(LS_NAME)).trim(); if (!author) { if (!name.isConnected) form.prepend(name); return name.focus(); }
      store.set(LS_NAME, author); post.disabled = true;
      try { const r = await api('POST', '/api/comment', { page: PAGE, anchor, text: t, author, token }); mine.add(r.id); saveMine(); comments[r.id] = r.comment; closePop(); render(); openThread(r.id); }
      catch (err) { post.disabled = false; toast('Could not save: ' + err.message); }
    });
    form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) form.requestSubmit(); });
    pop = h('div', { class: 'cmx-pop', role: 'dialog', 'aria-label': 'New comment' }, h('div', { class: 'cmx-pop-h' }, 'New comment'), form);
    place(pop, x, y); (store.get(LS_NAME) ? text : name).focus();
  }
  function openThread(id) {
    const c = comments[id]; if (!c) return; closePop(); openId = id;
    const pin = layer.querySelector('[data-id="' + id + '"]'); if (pin) pin.classList.add('active');
    const replies = Object.entries(comments).filter(([, r]) => r.parent === id).sort((a, b) => a[1].createdAt.localeCompare(b[1].createdAt));
    const msg = (rid, r) => h('div', { class: 'cmx-msg' },
      h('div', { class: 'cmx-meta' }, h('b', { text: r.author }), h('span', {}, ago(r.createdAt), mine.has(rid) ? h('span', {}, ' · ', h('button', { type: 'button', class: 'cmx-link', text: 'Delete', onclick: () => del(rid) })) : null)),
      h('div', { class: 'cmx-text', text: r.text }));
    const msgs = h('div', { class: 'cmx-msgs' }, msg(id, c), ...replies.map(([rid, r]) => msg(rid, r)));
    const name = nameField(); const text = h('textarea', { placeholder: 'Reply…', maxlength: '2000', 'aria-label': 'Reply', style: 'min-height:52px' });
    const form = h('form', { class: 'cmx-form' }, store.get(LS_NAME) ? null : name, text,
      h('div', { class: 'cmx-row' }, h('button', { type: 'submit', class: 'cmx-btn pri', text: 'Reply' })));
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); const t = text.value.trim(); if (!t) return text.focus();
      const author = (name.value || store.get(LS_NAME)).trim(); if (!author) { if (!name.isConnected) form.prepend(name); return name.focus(); }
      store.set(LS_NAME, author);
      try { const r = await api('POST', '/api/comment', { page: PAGE, parent: id, text: t, author, token }); mine.add(r.id); saveMine(); comments[r.id] = r.comment; openThread(id); }
      catch (err) { toast('Could not save: ' + err.message); }
    });
    form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) form.requestSubmit(); });
    const resolve = h('button', { type: 'button', class: 'cmx-link', text: c.resolved ? 'Reopen' : 'Resolve', onclick: async () => {
      try { await api('POST', '/api/comment/' + id + '/resolve', { resolved: !c.resolved, by: store.get(LS_NAME) }); comments[id].resolved = !c.resolved; closePop(); render(); }
      catch (err) { toast('Could not save: ' + err.message); } } });
    pop = h('div', { class: 'cmx-pop', role: 'dialog', 'aria-label': 'Comment thread' },
      h('div', { class: 'cmx-pop-h' }, h('span', { text: '#' + c.n + (c.resolved ? ' · resolved' : '') }), h('span', {}, resolve, ' ', h('button', { type: 'button', class: 'cmx-x', 'aria-label': 'Close', text: '✕', onclick: closePop }))),
      msgs, form);
    const p = where(c.anchor); place(pop, p.x, p.y);
  }
  async function del(id) {
    if (!confirm('Delete this comment?')) return;
    try { await api('DELETE', '/api/comment/' + id, { token }); delete comments[id]; mine.delete(id); saveMine(); const parent = openId; closePop(); render(); if (parent && comments[parent]) openThread(parent); }
    catch (err) { toast(err.message); }
  }
  document.addEventListener('mousedown', (e) => { if (pop && !pop.contains(e.target) && !e.target.closest('.cmx-pin,.cmx-item,.cmx-bar')) closePop(); });

  // ---------- render ----------
  function threads() {
    return Object.entries(comments).filter(([, c]) => c.page === PAGE && !c.parent).sort((a, b) => a[1].createdAt.localeCompare(b[1].createdAt)).map(([id, c], i) => (c.n = i + 1, [id, c]));
  }
  function render() {
    const ts = threads(); const open = ts.filter(([, c]) => !c.resolved);
    count.textContent = String(open.length);
    layer.textContent = '';
    for (const [id, c] of ts) {
      if (c.resolved && !showResolved) continue;
      const p = where(c.anchor);
      const pin = h('button', { type: 'button', class: 'cmx-pin' + (c.resolved ? ' resolved' : '') + (openId === id ? ' active' : ''), 'data-id': id, 'aria-label': 'Comment ' + c.n + ' by ' + c.author, text: String(c.n), onclick: (e) => { e.stopPropagation(); openThread(id); } });
      pin.style.left = p.x + 'px'; pin.style.top = p.y + 'px'; layer.append(pin);
    }
    list.textContent = '';
    const shown = ts.filter(([, c]) => showResolved || !c.resolved);
    if (!shown.length) list.append(h('div', { class: 'cmx-empty', text: 'No comments on this page yet. Press “Add comment” and click anywhere on the page.' }));
    for (const [id, c] of shown) {
      const nrep = Object.values(comments).filter((r) => r.parent === id).length;
      list.append(h('button', { type: 'button', class: 'cmx-item' + (c.resolved ? ' resolved' : ''), onclick: () => { const p = where(c.anchor); scrollTo({ top: Math.max(0, p.y - innerHeight / 3), behavior: 'smooth' }); setTimeout(() => openThread(id), 350); } },
        h('span', { class: 'n', text: String(c.n) }),
        h('span', { class: 'b' }, h('span', { class: 'cmx-meta' }, h('b', { text: c.author }), h('span', { text: ago(c.createdAt) + (nrep ? ' · ' + nrep + (nrep > 1 ? ' replies' : ' reply') : '') })), h('span', { class: 't', text: c.text }))));
    }
  }
  // keep pins on their elements as the layout moves (images, fonts, accordions, resize)
  let raf = 0; const reflow = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { render(); if (openId && pop) { const c = comments[openId]; if (c) { const p = where(c.anchor); place(pop, p.x, p.y); } } }); };
  addEventListener('resize', reflow); addEventListener('load', reflow);
  document.addEventListener('toggle', reflow, true);
  if ('ResizeObserver' in window) new ResizeObserver(() => { if (!pop) reflow(); }).observe(document.body);

  // ---------- live data ----------
  function apply(state) { comments = state.comments || {}; if (openId && !comments[openId]) closePop(); if (!pop) render(); else { render(); } }
  fetch('/api/state').then((r) => r.json()).then(apply).catch(() => {});
  if ('EventSource' in window) { const es = new EventSource('/api/events'); es.addEventListener('state', (e) => { try { const keep = openId; apply(JSON.parse(e.data)); if (keep && comments[keep] && pop && !pop.querySelector('textarea:focus') ) openThread(keep); } catch (_) {} }); }
})();
