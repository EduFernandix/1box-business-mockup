// 1BOX business page mockup — static pages + a small comment API, data in one JSON file on a volume.
// Same pattern as the Persona Board: no dependencies, read-modify-write per change, live via SSE.
const http = require('http'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || '/data';
const DATA = path.join(DATA_DIR, 'comments.json');
const PUB = path.join(__dirname, 'public');
const MAX_COMMENTS = 5000, MAX_TEXT = 2000, MAX_NAME = 60;
const PAGES = new Set(['home', 'a', 'b']);
const ROUTES = { '/': '/index.html', '/a': '/a.html', '/b': '/b.html' };
fs.mkdirSync(DATA_DIR, { recursive: true });

let state = { comments: {} };
function load() { try { const s = JSON.parse(fs.readFileSync(DATA, 'utf8')); if (s && s.comments) state = s; } catch (_) {} return state; }
load();
function publicState() { const comments = {}; for (const [k, v] of Object.entries(state.comments)) { const { tokenHash, ...pub } = v; comments[k] = pub; } return { comments }; }

const clients = new Set();
function broadcast() { const data = 'event: state\ndata: ' + JSON.stringify(publicState()) + '\n\n'; for (const res of clients) { try { res.write(data); } catch (_) { clients.delete(res); } } }
setInterval(() => { for (const res of clients) { try { res.write(': ping\n\n'); } catch (_) { clients.delete(res); } } }, 20000);
let writing = Promise.resolve(); let lastSig = '';
function mutate(fn) {
  const p = writing.then(async () => { load(); const out = fn(state); await fs.promises.writeFile(DATA + '.tmp', JSON.stringify(state)); await fs.promises.rename(DATA + '.tmp', DATA); try { const st = fs.statSync(DATA); lastSig = st.size + ':' + st.mtimeMs; } catch (_) {} broadcast(); return out; });
  writing = p.catch((e) => console.error('save', e)); return p;
}
setInterval(() => { try { const st = fs.statSync(DATA); const sig = st.size + ':' + st.mtimeMs; if (sig !== lastSig) { lastSig = sig; load(); broadcast(); } } catch (_) {} }, 2000);

const MIME = { '.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const SEC = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin', 'x-robots-tag': 'noindex, nofollow', 'x-frame-options': 'SAMEORIGIN' };
function json(res, code, body) { res.writeHead(code, { ...SEC, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); }
function readBody(req) { return new Promise((ok, no) => { let b = '', over = false; req.on('data', (c) => { if (over) return; b += c; if (b.length > 2e4) { over = true; b = ''; const e = new Error('Comment is too long'); e.status = 413; no(e); } }); req.on('end', () => { if (over) return; try { ok(b ? JSON.parse(b) : {}); } catch (e) { no(new Error('bad request')); } }); req.on('error', no); }); }
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n);
const num = (v, lo, hi) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : 0; };
const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');
const SEL = /^[#a-z0-9_:\-()> .]{0,600}$/i;

// tiny per-IP rate limit for writes: 30 a minute
const hits = new Map();
function limited(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',').pop().trim();
  const now = Date.now(); const arr = (hits.get(ip) || []).filter((t) => now - t < 60000); arr.push(now); hits.set(ip, arr); return arr.length > 30;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some((t) => now - t < 60000)) hits.delete(k); }, 60000);

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/state' && req.method === 'GET') { load(); return json(res, 200, publicState()); }
    if (url.pathname === '/api/events' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      load(); res.write('retry: 2000\n\n'); res.write('event: state\ndata: ' + JSON.stringify(publicState()) + '\n\n');
      clients.add(res); res.on('error', () => clients.delete(res)); req.on('close', () => clients.delete(res)); return;
    }
    if (url.pathname === '/api/comment' && req.method === 'POST') {
      if (limited(req)) return json(res, 429, { error: 'Too many comments, try again in a minute' });
      const b = await readBody(req);
      const page = clean(b.page, 10), text = clean(b.text, MAX_TEXT), author = clean(b.author, MAX_NAME) || 'Someone', token = clean(b.token, 64);
      const parent = b.parent ? clean(b.parent, 16) : null;
      if (!PAGES.has(page) || !text) return json(res, 400, { error: 'bad request' });
      let anchor = null;
      if (!parent && !b.general) {
        const a = b.anchor || {}; const sel = clean(a.sel, 600);
        if (!SEL.test(sel)) return json(res, 400, { error: 'bad anchor' });
        anchor = { sel, fx: num(a.fx, 0, 1), fy: num(a.fy, 0, 1), px: num(a.px, 0, 1), py: num(a.py, 0, 1e6), vw: num(a.vw, 0, 10000) };
      } else if (parent && !/^[a-f0-9]{16}$/.test(parent)) return json(res, 400, { error: 'bad parent' });
      const id = crypto.randomBytes(8).toString('hex');
      const out = await mutate((st) => {
        if (Object.keys(st.comments).length >= MAX_COMMENTS) return 507;
        if (parent && (!st.comments[parent] || st.comments[parent].parent)) return 404;
        st.comments[id] = { page: parent ? st.comments[parent].page : page, parent, anchor, text, author, resolved: false, tokenHash: token ? hash(token) : null, createdAt: new Date().toISOString() };
        const { tokenHash, ...pub } = st.comments[id]; return pub;
      });
      if (out === 507) return json(res, 507, { error: 'comment limit reached' });
      if (out === 404) return json(res, 404, { error: 'thread not found' });
      return json(res, 200, { ok: true, id, comment: out });
    }
    let m = url.pathname.match(/^\/api\/comment\/([a-f0-9]{16})\/resolve$/);
    if (m && req.method === 'POST') {
      if (limited(req)) return json(res, 429, { error: 'Too many changes, try again in a minute' });
      const b = await readBody(req);
      const r = await mutate((st) => { const c = st.comments[m[1]]; if (!c || c.parent) return 404; c.resolved = !!b.resolved; c.resolvedBy = c.resolved ? clean(b.by, MAX_NAME) : null; c.resolvedAt = c.resolved ? new Date().toISOString() : null; return 200; });
      return r === 404 ? json(res, 404, { error: 'not found' }) : json(res, 200, { ok: true });
    }
    m = url.pathname.match(/^\/api\/comment\/([a-f0-9]{16})$/);
    if (m && req.method === 'DELETE') {
      const b = await readBody(req); const h = b.token ? hash(clean(b.token, 64)) : null;
      const r = await mutate((st) => {
        const c = st.comments[m[1]]; if (!c) return 404; if (!c.tokenHash || h !== c.tokenHash) return 403;
        delete st.comments[m[1]]; for (const [k, v] of Object.entries(st.comments)) if (v.parent === m[1]) delete st.comments[k]; return 200;
      });
      if (r === 404) return json(res, 404, { error: 'not found' });
      if (r === 403) return json(res, 403, { error: 'Only the author can delete this comment' });
      return json(res, 200, { ok: true });
    }
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not found' });

    if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'method not allowed' });
    const canon = { '/a/': '/a', '/b/': '/b', '/a.html': '/a', '/b.html': '/b', '/index.html': '/' }[url.pathname];
    if (canon) { res.writeHead(302, { ...SEC, location: canon }); return res.end(); }
    let p = ROUTES[url.pathname] || decodeURIComponent(url.pathname);
    const file = path.normalize(path.join(PUB, p)); if (!file.startsWith(PUB + path.sep)) return json(res, 403, { error: 'forbidden' });
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404, SEC); return res.end('not found'); }
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, { ...SEC, 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': ['.html', '.js', '.css'].includes(ext) ? 'no-cache' : 'public, max-age=86400' });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    });
  } catch (e) { if (!res.headersSent) json(res, e.status || 400, { error: String(e.message || e) }); else res.end(); }
}).listen(PORT, () => console.log('business mockup on', PORT, 'data', DATA));
// node is PID 1 in the container: without this, a deploy waits 10 s for a kill
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => writing.finally(() => process.exit(0)));
