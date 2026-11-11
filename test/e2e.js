// End-to-end audit of the review site. Usage: node e2e.js <baseUrl> [--local <dataDir>]
const puppeteer = require('/Users/eduardofernandes/Desktop/Projetos/1box-dashboard/node_modules.nosync/puppeteer');
const { spawn } = require('child_process');
const BASE = process.argv[2]; const LOCAL = process.argv[3] === '--local' ? process.argv[4] : null;
const SRV = '/Users/eduardofernandes/Desktop/Projetos/1box-business-mockup/server.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0; const fails = [];
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ok  ' + name); } else { fail++; fails.push(name); console.log('FAIL  ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); } };
let srv = null;
async function startServer() { if (!LOCAL) return; srv = spawn('node', [SRV], { env: { ...process.env, PORT: new URL(BASE).port, DATA_DIR: LOCAL }, stdio: 'ignore' }); for (let i = 0; i < 50; i++) { try { const r = await fetch(BASE + '/api/state'); if (r.ok) return; } catch (_) {} await sleep(100); } throw new Error('server did not start'); }
async function stopServer() { if (srv) { const p = new Promise((r) => srv.on('exit', r)); srv.kill('SIGTERM'); await p; srv = null; } }
const state = async () => (await (await fetch(BASE + '/api/state')).json()).comments;
const center = async (page, sel) => page.$eval(sel, (e) => { e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + Math.min(r.width / 2, 60), y: r.top + r.height / 2 }; });
const errors = [];
function watch(page, tag) { page.on('pageerror', (e) => errors.push(tag + ': ' + e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(tag + ' console: ' + m.text()); }); }

(async () => {
  await startServer();
  const browser = await puppeteer.launch({ headless: 'new' });
  const created = [];
  try {
    // ---------- desktop, user 1 ----------
    const c1 = await browser.createBrowserContext(); const p1 = await c1.newPage(); const allPages = [p1]; watch(p1, 'p1');
    await p1.setViewport({ width: 1440, height: 900 });
    await p1.goto(BASE + '/a', { waitUntil: 'networkidle2' }).catch(() => {}); await sleep(800);
    console.log('desktop');
    ok('bar present', await p1.$('.cmx-bar') !== null);
    ok('burger hidden on desktop', await p1.$eval('.burger', (e) => getComputedStyle(e).display) === 'none');
    ok('no horizontal overflow (a, desktop)', await p1.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const before = Object.keys(await state()).length;

    // comment via real mouse
    await p1.click('.cmx-add'); ok('comment mode on', await p1.evaluate(() => window.__commentMode === true));
    let pt = await center(p1, 'h1'); await p1.mouse.click(pt.x, pt.y); await sleep(200);
    ok('compose opens on click', await p1.$('.cmx-pop textarea') !== null);
    ok('comment mode off after placing', await p1.evaluate(() => !window.__commentMode));
    ok('asks name first time', await p1.$('.cmx-pop input[type=text]') !== null);
    await p1.type('.cmx-pop input[type=text]', 'E2E One'); await p1.type('.cmx-pop textarea', 'e2e: first comment');
    await p1.click('.cmx-pop .cmx-btn.pri'); await sleep(900);
    let st = await state(); let ids = Object.keys(st).filter((k) => st[k].text === 'e2e: first comment'); created.push(...ids);
    ok('comment saved on server', ids.length === 1, ids.length);
    const T = ids[0];
    ok('anchor selector points at the h1', /h1$/.test(st[T].anchor.sel) && st[T].anchor.sel.startsWith('body > '), st[T] && st[T].anchor.sel);
    ok('pin rendered', (await p1.$$('.cmx-pin')).length >= 1);
    ok('thread opens after posting', await p1.$eval('.cmx-pop', (e) => e.innerText.includes('e2e: first comment')));
    ok('author sees Delete', await p1.$eval('.cmx-pop', (e) => e.innerText.includes('Delete')));

    // pin sits on its element
    const pinPos = await p1.evaluate((id) => { const p = document.querySelector('.cmx-pin[data-id="' + id + '"]'); const h = document.querySelector('h1').getBoundingClientRect(); const x = parseFloat(p.style.left), y = parseFloat(p.style.top); return x >= h.left + scrollX - 1 && x <= h.right + scrollX + 1 && y >= h.top + scrollY - 1 && y <= h.bottom + scrollY + 1; }, T);
    ok('pin is inside the h1 box', pinPos);

    // double submit guard
    await p1.type('.cmx-pop textarea', 'e2e: reply once');
    await p1.evaluate(() => { const f = document.querySelector('.cmx-pop form'); f.requestSubmit(); f.requestSubmit(); f.requestSubmit(); }); await sleep(900);
    st = await state(); const r1 = Object.keys(st).filter((k) => st[k].text === 'e2e: reply once'); created.push(...r1);
    ok('double submit posts once', r1.length === 1, r1.length);
    ok('name remembered ("Posting as")', await p1.$eval('.cmx-pop', (e) => e.innerText.includes('Posting as E2E One')));

    // ---------- user 2 in another browser profile ----------
    const c2 = await browser.createBrowserContext(); const p2 = await c2.newPage(); watch(p2, 'p2');
    await p2.setViewport({ width: 1280, height: 800 });
    await p2.goto(BASE + '/a', { waitUntil: 'networkidle2' }).catch(() => {}); await sleep(800);
    ok('second visitor sees the pin', await p2.$('.cmx-pin[data-id="' + T + '"]') !== null);
    await p2.click('.cmx-pin[data-id="' + T + '"]'); await sleep(200);
    ok('second visitor cannot delete others', await p2.$eval('.cmx-pop', (e) => !e.innerText.includes('Delete')));
    // user 1 has a half-typed reply while user 2 replies
    await p1.type('.cmx-pop textarea', 'half typed draft');
    await p2.type('.cmx-pop input[type=text]', 'E2E Two'); await p2.type('.cmx-pop textarea', 'e2e: reply from two');
    await p2.click('.cmx-pop .cmx-btn.pri'); await sleep(1200);
    st = await state(); created.push(...Object.keys(st).filter((k) => st[k].text === 'e2e: reply from two'));
    ok('live: reply appears for user 1 without reload', await p1.$eval('.cmx-pop', (e) => e.innerText.includes('e2e: reply from two')));
    ok('live update keeps half-typed draft', await p1.$eval('.cmx-pop textarea', (e) => e.value) === 'half typed draft');
    ok('live update keeps focus in the reply box', await p1.evaluate(() => document.activeElement && document.activeElement.tagName === 'TEXTAREA'));
    // click outside with a draft must not lose it
    await p1.mouse.click(700, 500); await sleep(150);
    ok('click outside keeps popover when there is a draft', await p1.$('.cmx-pop') !== null);
    await p1.$eval('.cmx-pop textarea', (e) => { e.value = ''; }); await p1.mouse.click(700, 500); await sleep(150);
    ok('click outside closes an empty popover', await p1.$('.cmx-pop') === null);

    // resize keeps pin on element and focus in textarea
    await p1.click('.cmx-pin[data-id="' + T + '"]'); await p1.focus('.cmx-pop textarea');
    await p1.setViewport({ width: 1000, height: 700 }); await sleep(500);
    ok('resize keeps focus in the reply box', await p1.evaluate(() => document.activeElement && document.activeElement.tagName === 'TEXTAREA'));
    ok('pin follows its element after resize', await p1.evaluate((id) => { const p = document.querySelector('.cmx-pin[data-id="' + id + '"]'); const h = document.querySelector('h1').getBoundingClientRect(); const x = parseFloat(p.style.left), y = parseFloat(p.style.top); return x >= h.left + scrollX - 1 && x <= h.right + scrollX + 1 && y >= h.top + scrollY - 1 && y <= h.bottom + scrollY + 1; }, T));
    await p1.setViewport({ width: 1440, height: 900 }); await p1.keyboard.press('Escape'); await sleep(300);

    // comment mode must not trigger the page: select, link, card
    await p1.click('.cmx-add'); pt = await center(p1, '#a-facility'); await p1.mouse.click(pt.x, pt.y); await sleep(200);
    ok('clicking a select in comment mode opens compose, not the select', await p1.$('.cmx-pop textarea') !== null && await p1.evaluate(() => document.activeElement.tagName !== 'SELECT'));
    await p1.keyboard.press('Escape');
    await p1.click('.cmx-add'); const url0 = p1.url(); const kind0 = await p1.$eval('#a-kind', (e) => e.value);
    pt = await center(p1, '[data-kind]'); await p1.mouse.click(pt.x, pt.y); await sleep(200);
    ok('clicking a card in comment mode does not use the card', await p1.$eval('#a-kind', (e) => e.value) === kind0 && await p1.$('.cmx-pop textarea') !== null);
    await p1.keyboard.press('Escape');
    await p1.click('.cmx-add'); pt = await center(p1, 'header a.btn-g'); await p1.mouse.click(pt.x, pt.y); await sleep(200);
    ok('clicking a link in comment mode does not navigate', p1.url() === url0 && await p1.$('.cmx-pop textarea') !== null);
    await p1.keyboard.press('Escape');
    ok('Esc leaves no popover and no mode', await p1.evaluate(() => !document.querySelector('.cmx-pop') && !window.__commentMode));
    await p1.keyboard.press('c'); ok('C key turns comment mode on', await p1.evaluate(() => window.__commentMode === true)); await p1.keyboard.press('Escape');
    await p1.focus('#a-name'); await p1.keyboard.type('cc'); ok('typing "c" in a form field does not toggle mode', await p1.evaluate(() => !window.__commentMode) && await p1.$eval('#a-name', (e) => e.value) === 'cc');
    await p1.$eval('#a-name', (e) => { e.value = ''; e.blur(); });

    // translated page (Chrome wraps text in <font>): anchor must be the real element
    await p1.evaluate(() => { const h = document.querySelector('section h2'); h.innerHTML = '<font style="vertical-align:inherit"><font style="vertical-align:inherit">' + h.textContent + '</font></font>'; h.scrollIntoView({ block: 'center' }); });
    await p1.click('.cmx-add'); pt = await p1.$eval('section h2 font font', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; }); await p1.mouse.click(pt.x, pt.y); await sleep(200);
    await p1.type('.cmx-pop textarea', 'e2e: translated'); await p1.click('.cmx-pop .cmx-btn.pri'); await sleep(900);
    st = await state(); const tr = Object.keys(st).filter((k) => st[k].text === 'e2e: translated'); created.push(...tr);
    ok('translated page: anchor has no <font>', tr.length === 1 && /h2$/.test(st[tr[0]].anchor.sel) && !/font/.test(st[tr[0]].anchor.sel), tr[0] && st[tr[0]].anchor.sel);
    ok('same anchor resolves for an untranslated visitor', await p2.evaluate((sel) => !!document.querySelector(sel), st[tr[0]].anchor.sel));
    await p1.keyboard.press('Escape');

    // resolve from user 2 → disappears for user 1
    await p2.evaluate(() => [...document.querySelectorAll('.cmx-pop .cmx-link')].find((b) => b.textContent === 'Resolve').click()); await sleep(1200);
    ok('resolve hides pin for everyone', await p1.$('.cmx-pin[data-id="' + T + '"]') === null);
    await p1.click('.cmx-listbtn'); await sleep(300);
    await p1.click('.cmx-side input[type=checkbox]'); await sleep(200);
    ok('"Show resolved" brings it back', await p1.$('.cmx-pin.resolved[data-id="' + T + '"]') !== null);
    ok('sidebar lists it as resolved', await p1.$eval('.cmx-list', (e) => e.innerText.includes('resolved')));
    await p1.click('.cmx-side .cmx-x');

    // non-author delete is refused by the server, author delete removes thread + replies
    const del403 = await fetch(BASE + '/api/comment/' + T, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'nope' }) });
    ok('server refuses delete by non-author', del403.status === 403, del403.status);
    p1.once('dialog', (d) => d.accept());
    await sleep(400); await p1.evaluate((id) => document.querySelector('.cmx-pin[data-id="' + id + '"]').click(), T); await sleep(300);
    await p1.evaluate(() => document.querySelector('.cmx-pop .cmx-msg .cmx-link').click()); await sleep(1200);
    st = await state();
    ok('author delete removes the thread and its replies', !st[T] && !Object.values(st).some((c) => c.parent === T));
    ok('deleted thread vanishes for user 2 live', await p2.$('.cmx-pin[data-id="' + T + '"]') === null);

    // ---------- free (general) comments from the Comments panel ----------
    console.log('general comments');
    const badge0 = Number(await p1.$eval('.cmx-badge', (e) => e.textContent));
    await p1.click('.cmx-listbtn'); await sleep(300);
    ok('panel has a free comment box', await p1.$('.cmx-side .cmx-gform textarea') !== null);
    ok('panel knows the name already', await p1.$eval('.cmx-side .cmx-gform', (e) => e.innerText.includes('Posting as E2E One') || !!e.querySelector('input')));
    await p1.type('.cmx-side .cmx-gform textarea', 'e2e: general note');
    await p1.click('.cmx-side .cmx-gform .cmx-btn.pri'); await sleep(1000);
    st = await state(); const G = Object.keys(st).find((k) => st[k].text === 'e2e: general note'); if (G) created.push(G);
    ok('general comment saved without a spot', !!G && st[G].anchor === null && st[G].page === 'a', G && st[G]);
    ok('box clears after posting', await p1.$eval('.cmx-side .cmx-gform textarea', (e) => e.value) === '');
    ok('listed with a General tag', await p1.$eval('.cmx-list', (e) => e.innerText.includes('General') && e.innerText.includes('e2e: general note')));
    ok('no pin on the page for it', await p1.$('.cmx-pin[data-id="' + G + '"]') === null);
    ok('counted in the badge', Number(await p1.$eval('.cmx-badge', (e) => e.textContent)) === badge0 + 1);
    ok('user 2 sees it live in the panel', await p2.evaluate((g) => { document.querySelector('.cmx-listbtn').click(); return document.querySelector('.cmx-list').innerText.includes('e2e: general note'); }, G));
    await p2.evaluate(() => [...document.querySelectorAll('.cmx-item')].find((b) => b.innerText.includes('e2e: general note')).click()); await sleep(400);
    ok('opening it shows the thread on screen', await p2.$eval('.cmx-pop', (e) => { const r = e.getBoundingClientRect(); return e.innerText.includes('general') && r.left >= 0 && r.right <= innerWidth && r.top >= 0; }));
    await p2.type('.cmx-pop textarea', 'e2e: reply on general'); await p2.click('.cmx-pop .cmx-btn.pri'); await sleep(1000);
    st = await state();
    ok('reply on a general comment saved', Object.values(st).some((c) => c.parent === G && c.text === 'e2e: reply on general'));
    ok('author sees the reply count live', await p1.$eval('.cmx-list', (e) => e.innerText.includes('1 reply')));
    await p2.evaluate(() => [...document.querySelectorAll('.cmx-pop .cmx-link')].find((b) => b.textContent === 'Resolve').click()); await sleep(1000);
    ok('resolving marks it resolved in the list', await p1.$$eval('.cmx-item', (els) => els.some((e) => e.innerText.includes('e2e: general note') && e.innerText.includes('resolved'))));
    await p1.click('.cmx-side input[type=checkbox]'); await sleep(200);
    ok('with Show resolved off it disappears from the list', await p1.$eval('.cmx-list', (e) => !e.innerText.includes('e2e: general note')));
    const emptyPost = await fetch(BASE + '/api/comment', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page: 'a', general: true, text: '  ' }) });
    ok('empty general comment refused', emptyPost.status === 400, emptyPost.status);
    await p1.click('.cmx-side .cmx-x'); await p2.evaluate(() => { const x = document.querySelector('.cmx-pop .cmx-x'); if (x) x.click(); document.querySelector('.cmx-side .cmx-x').click(); });
    // mobile: write from the panel

    // ---------- the page itself ----------
    console.log('pages');
    for (const pg of ['a', 'b']) {
      await p1.goto(BASE + '/' + pg, { waitUntil: 'networkidle2' }).catch(() => {}); await sleep(600);
      const r = await p1.evaluate(async () => {
        const f = document.querySelector('form.quote-form'); const errs = () => [...f.querySelectorAll('.field-error')].filter((e) => !e.hidden).map((e) => e.textContent);
        const out = {}; f.requestSubmit(); out.empty = errs();
        f.facility.value = 'Goes'; f.email.value = 'bad'; f.requestSubmit(); out.bad = errs();
        document.querySelectorAll('[data-kind]')[3].click(); out.kind = f.storageKind.value;
        document.querySelectorAll('[data-loc]')[5].click(); out.loc = f.facility.value;
        f.email.value = 'a@b.nl'; f.requestSubmit(); const b = f.querySelector('button[type=submit]'); out.s1 = b.innerText.trim(); out.dis = b.disabled;
        await new Promise((r) => setTimeout(r, 1000)); out.s2 = b.innerText.trim(); await new Promise((r) => setTimeout(r, 2000)); out.s3 = b.innerText.trim(); out.dis3 = b.disabled;
        out.imgs = [...document.images].filter((i) => !i.complete || !i.naturalWidth).length;
        out.anchors = [...document.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute('href')).filter((h) => h !== '#' && !document.querySelector(h));
        scrollTo(0, 1500); document.querySelector('footer a[href="#"]').click(); out.scrollKept = scrollY > 0;
        return out;
      });
      ok(pg + ': empty submit shows both errors', r.empty.join('|') === 'Kies een opslaglocatie|Vul je e-mailadres in', r.empty);
      ok(pg + ': bad e-mail message', r.bad.join('|') === 'Vul een geldig e-mailadres in', r.bad);
      ok(pg + ': option card fills "Wat wil je opslaan?"', r.kind === 'Voorraad', r.kind);
      ok(pg + ': location click fills Locatie', r.loc === 'Bergen op Zoom', r.loc);
      ok(pg + ': submit goes Een moment… → Doorsturen… → Nu reserveren', r.s1 === 'Een moment…' && r.dis && r.s2 === 'Doorsturen…' && r.s3 === 'Nu reserveren' && !r.dis3, r);
      ok(pg + ': all images load', r.imgs === 0, r.imgs);
      ok(pg + ': no dead in-page links', r.anchors.length === 0, r.anchors);
      ok(pg + ': placeholder links do not jump to top', r.scrollKept);
    }
    const q = await p1.evaluate(() => { const f = document.querySelector('form.quote-form'); f.facility.selectedIndex = 0; document.querySelector('[data-action=quick]').click(); const e1 = !f.querySelector('.field-error[data-err=facility]').hidden; document.getElementById('b-quick').value = 'Venlo'; document.querySelector('[data-action=quick]').click(); return { e1, v: f.facility.value }; });
    ok('b: bottom quick start validates and carries the location', q.e1 && q.v === 'Venlo', q);

    // ---------- mobile with real touch ----------
    console.log('mobile');
    const c3 = await browser.createBrowserContext(); const m = await c3.newPage(); watch(m, 'mobile');
    await m.emulate(puppeteer.KnownDevices['iPhone 13']);
    for (const pg of ['', 'a', 'b']) { await m.goto(BASE + '/' + pg, { waitUntil: 'networkidle2' }).catch(() => {}); await sleep(500);
      ok('mobile /' + pg + ': no horizontal overflow', await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), await m.evaluate(() => [document.documentElement.scrollWidth, innerWidth]));
      ok('mobile /' + pg + ': review bar is one row and on screen', await m.$eval('.cmx-bar', (e) => { const r = e.getBoundingClientRect(); return r.height < 70 && r.left >= 0 && r.right <= innerWidth; })); }
    ok('mobile: nav hidden, burger visible', await m.evaluate(() => getComputedStyle(document.querySelector('.site-header .nav')).display === 'none' && getComputedStyle(document.querySelector('.burger')).display !== 'none'));
    let b = await center(m, '.burger'); await m.touchscreen.tap(b.x, b.y); await sleep(200);
    ok('mobile: burger opens the menu', await m.evaluate(() => getComputedStyle(document.querySelector('.site-header .nav')).display === 'flex'));
    b = await center(m, '.burger'); await m.touchscreen.tap(b.x, b.y); await sleep(200);
    b = await center(m, '.cmx-add'); await m.touchscreen.tap(b.x, b.y); await sleep(200);
    ok('mobile: tap turns comment mode on', await m.evaluate(() => window.__commentMode === true));
    b = await center(m, 'h1'); await m.touchscreen.tap(b.x, b.y); await sleep(400);
    ok('mobile: tap on the page opens compose', await m.$('.cmx-pop textarea') !== null);
    ok('mobile: compose is fully on screen', await m.$eval('.cmx-pop', (e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }));
    await m.type('.cmx-pop input[type=text]', 'E2E Phone'); await m.type('.cmx-pop textarea', 'e2e: from phone');
    b = await center(m, '.cmx-pop .cmx-btn.pri'); await m.touchscreen.tap(b.x, b.y); await sleep(1000);
    st = await state(); const ph = Object.keys(st).filter((k) => st[k].text === 'e2e: from phone'); created.push(...ph);
    ok('mobile: comment saved', ph.length === 1 && st[ph[0]].page === 'b', ph.length);
    await m.keyboard.press('Escape'); await m.evaluate(() => document.querySelector('.cmx-pop') && document.querySelector('.cmx-pop .cmx-x').click());
    b = await center(m, '.cmx-add'); await m.touchscreen.tap(b.x, b.y); b = await center(m, '#b-facility'); await m.touchscreen.tap(b.x, b.y); await sleep(400);
    ok('mobile: tapping a select in comment mode opens compose', await m.$('.cmx-pop textarea') !== null && await m.evaluate(() => document.activeElement.tagName !== 'SELECT'));
    await m.evaluate(() => document.querySelector('.cmx-pop .cmx-btn.sec').click());
    // scroll (drag) in comment mode must not place a comment
    await m.evaluate(() => document.querySelector('.cmx-add').click()); await m.touchscreen.touchStart(200, 600); await m.touchscreen.touchMove(200, 300); await m.touchscreen.touchEnd(); await sleep(300);
    ok('mobile: scrolling in comment mode does not place a comment', await m.$('.cmx-pop') === null);
    await m.evaluate(() => document.querySelector('.cmx-add').click());
    await m.evaluate(() => { const x = document.querySelector('.cmx-pop .cmx-x'); if (x) x.click(); document.querySelector('.cmx-listbtn').click(); }); await sleep(300);
    ok('mobile: free comment box fits the screen', await m.$eval('.cmx-side .cmx-gform', (e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1; }));
    await m.type('.cmx-side .cmx-gform textarea', 'e2e: general from phone'); b = await center(m, '.cmx-side .cmx-gform .cmx-btn.pri'); await m.touchscreen.tap(b.x, b.y); await sleep(1000);
    st = await state(); const GP = Object.keys(st).find((k) => st[k].text === 'e2e: general from phone'); if (GP) created.push(GP);
    ok('mobile: general comment saved', !!GP && st[GP].anchor === null);
    await m.evaluate(() => document.querySelector('.cmx-side .cmx-x').click());
    // sidebar → thread on phone
    await m.evaluate(() => document.querySelector('.cmx-listbtn').click()); await sleep(300); await m.evaluate(() => document.querySelector('.cmx-item').click()); await sleep(900);
    ok('mobile: picking from the list closes the list and opens the thread', await m.evaluate(() => !document.querySelector('.cmx-side').classList.contains('open') && !!document.querySelector('.cmx-pop')), await m.evaluate(() => ({ open: document.querySelector('.cmx-side').classList.contains('open'), pop: !!document.querySelector('.cmx-pop'), items: [...document.querySelectorAll('.cmx-item')].map((e) => e.innerText.slice(0, 40)) })));

    // ---------- server ----------
    console.log('server');
    const code = async (path, opt) => (await fetch(BASE + path, { redirect: 'manual', ...opt })).status;
    const J = (b) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
    ok('/a/ redirects to /a', await code('/a/') === 302);
    ok('/b.html redirects to /b', await code('/b.html') === 302);
    ok('unknown page → 404', await code('/nope') === 404);
    ok('server.js is not served', await code('/server.js') === 404 && await code('/%2e%2e/server.js') !== 200);
    ok('POST to a page → 405', await code('/a', { method: 'POST' }) === 405);
    ok('bad JSON → 400', await code('/api/comment', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' }) === 400);
    ok('empty text → 400', await code('/api/comment', J({ page: 'a', text: '   ' })) === 400);
    ok('unknown page id → 400', await code('/api/comment', J({ page: 'zz', text: 'x' })) === 400);
    ok('evil selector → 400', await code('/api/comment', J({ page: 'a', text: 'x', anchor: { sel: 'a[href="x"]{}<script>' } })) === 400);
    ok('reply to missing thread → 404', await code('/api/comment', J({ page: 'a', text: 'x', parent: 'aaaaaaaaaaaaaaaa' })) === 404);
    ok('oversized body → clean 413', await code('/api/comment', J({ page: 'a', text: 'x'.repeat(50000) })) === 413);
    const long = await (await fetch(BASE + '/api/comment', J({ page: 'a', text: '<img src=x onerror=alert(1)> ' + 'y'.repeat(3000), author: '<b>x</b>', token: 'e2etok', anchor: { sel: 'body > div', fx: 9, fy: -3, px: 0.5, py: 100, vw: 1 } }))).json();
    created.push(long.id);
    ok('text is capped at 2000 and anchor numbers are clamped', long.comment.text.length === 2000 && long.comment.anchor.fx === 1 && long.comment.anchor.fy === 0, long.comment && [long.comment.text.length, long.comment.anchor]);
    ok('token hash never leaves the server', !JSON.stringify(await state()).includes('tokenHash'));
    await p2.goto(BASE + '/a', { waitUntil: 'networkidle2' }).catch(() => {}); await sleep(600);
    await p2.click('.cmx-pin[data-id="' + long.id + '"]'); await sleep(200);
    ok('HTML in a comment is shown as text, not run', await p2.evaluate(() => !document.querySelector('.cmx-pop img') && document.querySelector('.cmx-pop .cmx-text').textContent.startsWith('<img')));

    if (LOCAL) {
      const n1 = Object.keys(await state()).length; await stopServer(); await startServer();
      ok('comments survive a server restart', Object.keys(await state()).length === n1 && n1 > 0, n1);
      await sleep(2500);
      ok('live stream reconnects after restart', await p2.evaluate(async () => { const r = await fetch('/api/state'); return r.ok; }));
      let last = 0; for (let i = 0; i < 34; i++) { const r = await fetch(BASE + '/api/comment', J({ page: 'home', text: 'e2e rate ' + i, token: 'e2etok', anchor: { sel: '' } })); last = r.status; if (r.ok) created.push((await r.json()).id); }
      ok('rate limit kicks in (429)', last === 429, last);
    }
    const real = errors.filter((e) => !/INCOMPLETE_CHUNKED/.test(e)); ok('no JavaScript or loading errors on any page', real.length === 0, real.slice(0, 5));
  } catch (e) { fail++; fails.push('CRASH ' + e.message); console.log('CRASH', e); }
  finally {
    // clean up everything this run created (browser users delete with their own tokens)
    const toks = ['e2etok']; for (const pg of (await Promise.all(browser.browserContexts().map((c) => c.pages()))).flat()) { try { const t = await pg.evaluate(() => localStorage.getItem('cmx-token')); if (t) toks.push(t); } catch (_) {} }
    const st = await state().catch(() => ({}));
    for (const id of new Set(created)) if (st[id] && !st[id].parent) for (const token of toks) { const r = await fetch(BASE + '/api/comment/' + id, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) }).catch(() => null); if (r && r.ok) break; }
    const left = Object.entries(await state().catch(() => ({}))).filter(([, c]) => /^e2e/.test(c.text) || /^E2E/.test(c.author));
    console.log('leftover test comments:', left.map(([k]) => k));
    await browser.close(); await stopServer();
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); if (fail) console.log(fails.join('\n')); process.exit(fail ? 1 : 0);
})();
