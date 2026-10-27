'use strict';
/* Ledgerly server: lets one person (or a household) reach their data from any device.
   - Zero dependencies. Needs Node 18 or newer.
   - Stores ONLY encrypted data. Passwords and encryption keys never reach this server: the app derives a
     login secret from the password in the browser, and the server keeps a scrypt hash of that secret.
   - Also serves the app itself (index.html, css, js, assets and nothing else).

   node server/server.js [--port 8787] [--host 127.0.0.1] [--data ./data]
                         [--signup open|invite|closed] [--invite CODE] [--cert file --key file]
   Environment: LEDGERLY_PORT, LEDGERLY_HOST, LEDGERLY_DATA, LEDGERLY_SIGNUP, LEDGERLY_INVITE,
                LEDGERLY_MAX_USERS, LEDGERLY_TRUST_PROXY=1 (read the client IP from X-Forwarded-For) */
const http = require('http'), https = require('https'), fs = require('fs'), path = require('path'), crypto = require('crypto'), os = require('os');

const ROOT = path.join(__dirname, '..');
const VERSION = '1.0.0';
const USERNAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}._-]{2,31}$/u;
const SECRET_RE = /^[A-Za-z0-9_-]{43}$/;                 // 32 bytes, base64url
const SEALED_RE = /^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/; // "v1.<iv>.<ciphertext>" produced by the app
const WINDOW_MS = 10 * 60 * 1000, MAX_FAILS = 8;

class HttpError extends Error {
  constructor(status, code, message, headers) { super(message || code); this.status = status; this.code = code; this.headers = headers; }
}
const bad = (code, msg) => new HttpError(400, code, msg);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const STATIC_OK = /^\/(index\.html|css\/[\w.-]+|js\/[\w.-]+|js\/views\/[\w.-]+|assets\/[\w.-]+)$/;
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; "
  + "img-src 'self' data: blob:; connect-src 'self' http: https:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

function createServer(options = {}) {
  const env = process.env;
  const cfg = {
    dataDir: path.resolve(options.dataDir || env.LEDGERLY_DATA || path.join(ROOT, 'data')),
    signup: options.signup || env.LEDGERLY_SIGNUP || 'open',
    invite: options.invite || env.LEDGERLY_INVITE || '',
    maxUsers: +(options.maxUsers || env.LEDGERLY_MAX_USERS || 50),
    maxBlob: +(options.maxBlob || 8 * 1024 * 1024),
    minIter: options.minIter || 100000,
    scryptN: options.scryptN || 16384,
    sessionMs: (options.sessionDays || 30) * 86400000,
    trustProxy: options.trustProxy != null ? options.trustProxy : env.LEDGERLY_TRUST_PROXY === '1',
    serveApp: options.serveApp !== false,
    log: options.log || (() => {}),
  };
  if (cfg.signup === 'invite' && !cfg.invite) throw new Error('signup=invite needs an invite code (--invite CODE)');
  fs.mkdirSync(path.join(cfg.dataDir, 'users'), { recursive: true });

  /* ---------- storage: one small JSON file per account, written atomically ---------- */
  const secretFile = path.join(cfg.dataDir, 'secret.key');
  if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  const serverSecret = Buffer.from(fs.readFileSync(secretFile, 'utf8').trim(), 'hex');

  const norm = s => String(s == null ? '' : s).normalize('NFKC').trim().toLowerCase();
  const userKey = lower => crypto.createHash('sha256').update(lower).digest('hex').slice(0, 40);
  const fileOf = key => path.join(cfg.dataDir, 'users', key + '.json');
  const loadByKey = key => { try { return JSON.parse(fs.readFileSync(fileOf(key), 'utf8')); } catch (e) { return null; } };
  const saveUser = u => {
    const f = fileOf(u.key), tmp = f + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(u), { mode: 0o600 });
    fs.renameSync(tmp, f);
  };
  const countUsers = () => fs.readdirSync(path.join(cfg.dataDir, 'users')).filter(f => f.endsWith('.json')).length;

  const locks = new Map();
  const withLock = (key, fn) => {
    const next = (locks.get(key) || Promise.resolve()).then(fn, fn);
    locks.set(key, next.catch(() => {}));
    return next;
  };

  /* ---------- secrets ---------- */
  const scrypt = (secret, salt) => new Promise((res, rej) => crypto.scrypt(secret, salt, 32, { N: cfg.scryptN, r: 8, p: 1, maxmem: 128 * 1024 * 1024 }, (e, k) => (e ? rej(e) : res(k))));
  const hashSecret = async secret => { const salt = crypto.randomBytes(16); return { salt: salt.toString('base64'), hash: (await scrypt(secret, salt)).toString('base64') }; };
  const checkSecret = async (secret, rec) => {
    const k = await scrypt(secret, Buffer.from(rec.salt, 'base64')), want = Buffer.from(rec.hash, 'base64');
    return want.length === k.length && crypto.timingSafeEqual(k, want);
  };
  const dummy = { salt: crypto.randomBytes(16).toString('base64'), hash: '' };
  const burn = secret => scrypt(secret, Buffer.from(dummy.salt, 'base64')).catch(() => {}); // equalise timing for unknown users
  const sha = s => crypto.createHash('sha256').update(s).digest('hex');
  const sameString = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

  /* ---------- rate limiting (in memory) ---------- */
  const fails = new Map();
  const limited = key => { const e = fails.get(key); if (!e) return false; if (e.until < Date.now()) { fails.delete(key); return false; } return e.n >= MAX_FAILS; };
  const fail = key => { const e = fails.get(key); if (!e || e.until < Date.now()) fails.set(key, { n: 1, until: Date.now() + WINDOW_MS }); else e.n++; };
  const retryAfter = key => Math.max(1, Math.ceil(((fails.get(key) || { until: Date.now() }).until - Date.now()) / 1000));
  const guard = key => { if (limited(key)) throw new HttpError(429, 'too_many_attempts', 'Too many attempts. Try again later.', { 'Retry-After': String(retryAfter(key)) }); };
  const signups = new Map();

  /* ---------- request helpers ---------- */
  const ipOf = req => (cfg.trustProxy && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : req.socket.remoteAddress) || '?';
  const readBody = (req, limit = cfg.maxBlob * 1.5 + 4096) => new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new HttpError(413, 'too_large', 'Request is too large.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { const t = Buffer.concat(chunks).toString('utf8'); resolve(t ? JSON.parse(t) : {}); } catch (e) { reject(bad('bad_json', 'Body must be JSON.')); } });
    req.on('error', reject);
  });
  const need = (cond, code, msg) => { if (!cond) throw bad(code, msg); };
  const secretOk = s => typeof s === 'string' && SECRET_RE.test(s);
  const sealedOk = s => typeof s === 'string' && s.length <= cfg.maxBlob && SEALED_RE.test(s);
  const saltOk = s => typeof s === 'string' && /^[A-Za-z0-9+/=]{20,32}$/.test(s) && Buffer.from(s, 'base64').length === 16;
  const iterOk = n => Number.isInteger(n) && n >= cfg.minIter && n <= 10000000;
  const usernameOf = raw => { const n = norm(raw); need(USERNAME_RE.test(n), 'bad_username', 'Usernames are 3 to 32 letters, numbers, dots, dashes or underscores.'); return n; };

  const fakeKdf = lower => ({ salt: crypto.createHmac('sha256', serverSecret).update('kdf:' + lower).digest().subarray(0, 16).toString('base64'), iter: 600000 });

  async function session(req, body) {
    const m = /^Bearer (\S+)$/.exec(req.headers.authorization || '');
    if (!m) throw new HttpError(401, 'unauthorized', 'Sign in first.');
    const token = m[1], key = token.split('.')[0], u = /^[a-f0-9]{40}$/.test(key) ? loadByKey(key) : null, s = u && u.sessions[sha(token)];
    if (!s || s.exp < Date.now()) throw new HttpError(401, 'unauthorized', 'Your session expired. Sign in again.');
    return { user: u, token };
  }
  const newSession = u => {
    const token = u.key + '.' + crypto.randomBytes(32).toString('base64url'), now = Date.now();
    for (const [h, s] of Object.entries(u.sessions)) if (s.exp < now) delete u.sessions[h];
    const keep = Object.entries(u.sessions).sort((a, b) => b[1].created - a[1].created).slice(0, 9);
    u.sessions = Object.fromEntries(keep);
    u.sessions[sha(token)] = { created: now, exp: now + cfg.sessionMs };
    return { token, expiresAt: new Date(now + cfg.sessionMs).toISOString() };
  };
  const view = u => ({ version: u.version, updatedAt: u.updatedAt });

  /* ---------- API ---------- */
  const routes = {
    'GET /api/health': async () => ({ ok: true }),
    'GET /api/info': async () => ({ app: 'ledgerly-server', version: VERSION, signup: cfg.signup, inviteRequired: cfg.signup === 'invite', iterations: 600000 }),

    // KDF settings for a username. Unknown names get stable fake values so names cannot be probed.
    'GET /api/kdf': async (req, c) => {
      const lower = norm(c.query.get('username'));
      need(USERNAME_RE.test(lower), 'bad_username', 'Usernames are 3 to 32 letters, numbers, dots, dashes or underscores.');
      const u = loadByKey(userKey(lower));
      return u ? { salt: u.salt, iter: u.iter } : fakeKdf(lower);
    },

    'POST /api/register': async (req, c) => {
      const b = await readBody(req);
      if (cfg.signup === 'closed') throw new HttpError(403, 'signup_closed', 'This server is not accepting new accounts.');
      if (cfg.signup === 'invite' && !sameString(b.invite || '', cfg.invite)) throw new HttpError(403, 'bad_invite', 'That invite code is not valid.');
      const sk = 'reg|' + c.ip, e = signups.get(sk) || { n: 0, until: Date.now() + 3600000 };
      if (e.until < Date.now()) { e.n = 0; e.until = Date.now() + 3600000; }
      if (e.n >= 10) throw new HttpError(429, 'too_many_attempts', 'Too many new accounts from this address. Try later.', { 'Retry-After': '3600' });
      const lower = usernameOf(b.username);
      need(saltOk(b.salt) && iterOk(b.iter), 'bad_kdf', 'Invalid key settings.');
      need(secretOk(b.auth) && secretOk(b.recAuth), 'bad_secret', 'Invalid login secret.');
      need(sealedOk(b.pwWrap) && sealedOk(b.recWrap) && sealedOk(b.blob), 'bad_data', 'Invalid encrypted data.');
      const key = userKey(lower);
      return withLock(key, async () => {
        if (loadByKey(key)) throw new HttpError(409, 'username_taken', 'That username is already taken on this server.');
        if (countUsers() >= cfg.maxUsers) throw new HttpError(403, 'server_full', 'This server has reached its account limit.');
        const a = await hashSecret(b.auth), r = await hashSecret(b.recAuth), now = new Date().toISOString();
        const u = { key, username: String(b.username).normalize('NFKC').trim(), salt: b.salt, iter: b.iter, auth: a, recAuth: r, pwWrap: b.pwWrap, recWrap: b.recWrap,
          blob: b.blob, version: 1, createdAt: now, updatedAt: now, sessions: {} };
        const s = newSession(u);
        saveUser(u); e.n++; signups.set(sk, e);
        cfg.log('account created');
        return { status: 201, body: { ...s, ...view(u) } };
      });
    },

    'POST /api/login': async (req, c) => {
      const b = await readBody(req), lower = usernameOf(b.username), lk = 'login|' + c.ip + '|' + lower;
      guard(lk);
      need(secretOk(b.auth), 'bad_secret', 'Invalid login secret.');
      const key = userKey(lower);
      return withLock(key, async () => {
        const u = loadByKey(key);
        const ok = u ? await checkSecret(b.auth, u.auth) : (await burn(b.auth), false);
        if (!ok) { fail(lk); throw new HttpError(401, 'bad_credentials', 'Wrong username or password.'); }
        fails.delete(lk);
        const s = newSession(u); saveUser(u);
        return { ...s, ...view(u), salt: u.salt, iter: u.iter, pwWrap: u.pwWrap, recWrap: u.recWrap };
      });
    },

    'POST /api/logout': async req => {
      const { user, token } = await session(req);
      return withLock(user.key, async () => { const u = loadByKey(user.key); delete u.sessions[sha(token)]; saveUser(u); return { ok: true }; });
    },

    // Cheap check used for polling: has anything changed since the version I have?
    'GET /api/version': async req => view((await session(req)).user),

    // A new recovery key: needs the current password, replaces the old key's proof and wrap
    'POST /api/recovery': async req => {
      const { user } = await session(req), b = await readBody(req), lk = 'rk|' + user.key;
      guard(lk);
      need(secretOk(b.auth) && secretOk(b.recAuth) && sealedOk(b.recWrap), 'bad_data', 'Invalid recovery key data.');
      return withLock(user.key, async () => {
        const u = loadByKey(user.key);
        if (!await checkSecret(b.auth, u.auth)) { fail(lk); throw new HttpError(401, 'bad_credentials', 'The password is wrong.'); }
        u.recAuth = await hashSecret(b.recAuth); u.recWrap = b.recWrap; saveUser(u); return { ok: true };
      });
    },

    'GET /api/data': async req => {
      const { user } = await session(req);
      return { ...view(user), blob: user.blob };
    },

    // Optimistic concurrency: the client says which version it started from.
    'PUT /api/data': async req => {
      const { user } = await session(req), b = await readBody(req);
      need(Number.isInteger(b.baseVersion) && sealedOk(b.blob), 'bad_data', 'Invalid encrypted data.');
      return withLock(user.key, async () => {
        const u = loadByKey(user.key);
        if (u.version !== b.baseVersion) return { status: 409, body: { error: 'conflict', message: 'The data changed on another device.', ...view(u), blob: u.blob } };
        u.blob = b.blob; u.version++; u.updatedAt = new Date().toISOString(); saveUser(u);
        return view(u);
      });
    },

    'POST /api/password': async (req, c) => {
      const { user, token } = await session(req), b = await readBody(req), lk = 'pw|' + user.key;
      guard(lk);
      need(secretOk(b.auth) && secretOk(b.newAuth) && saltOk(b.salt) && iterOk(b.iter) && sealedOk(b.pwWrap), 'bad_data', 'Invalid password change.');
      return withLock(user.key, async () => {
        const u = loadByKey(user.key);
        if (!await checkSecret(b.auth, u.auth)) { fail(lk); throw new HttpError(401, 'bad_credentials', 'The current password is wrong.'); }
        u.auth = await hashSecret(b.newAuth); u.salt = b.salt; u.iter = b.iter; u.pwWrap = b.pwWrap;
        u.sessions = { [sha(token)]: u.sessions[sha(token)] };   // sign every other device out
        saveUser(u); return { ok: true };
      });
    },

    // Forgot-password flow, proven with the recovery key instead of the password
    'POST /api/recover/fetch': async (req, c) => {
      const b = await readBody(req), lower = usernameOf(b.username), lk = 'rec|' + c.ip + '|' + lower;
      guard(lk); need(secretOk(b.recAuth), 'bad_secret', 'Invalid recovery secret.');
      const u = loadByKey(userKey(lower));
      const ok = u ? await checkSecret(b.recAuth, u.recAuth) : (await burn(b.recAuth), false);
      if (!ok) { fail(lk); throw new HttpError(401, 'bad_credentials', 'Wrong username or recovery key.'); }
      return { recWrap: u.recWrap, ...view(u) };
    },
    'POST /api/recover/reset': async (req, c) => {
      const b = await readBody(req), lower = usernameOf(b.username), lk = 'rec|' + c.ip + '|' + lower;
      guard(lk);
      need(secretOk(b.recAuth) && secretOk(b.newAuth) && saltOk(b.salt) && iterOk(b.iter) && sealedOk(b.pwWrap), 'bad_data', 'Invalid reset.');
      const key = userKey(lower);
      return withLock(key, async () => {
        const u = loadByKey(key);
        const ok = u ? await checkSecret(b.recAuth, u.recAuth) : (await burn(b.recAuth), false);
        if (!ok) { fail(lk); throw new HttpError(401, 'bad_credentials', 'Wrong username or recovery key.'); }
        u.auth = await hashSecret(b.newAuth); u.salt = b.salt; u.iter = b.iter; u.pwWrap = b.pwWrap; u.sessions = {};
        saveUser(u); return { ok: true };
      });
    },

    'DELETE /api/account': async req => {
      const { user } = await session(req), b = await readBody(req), lk = 'del|' + user.key;
      guard(lk); need(secretOk(b.auth), 'bad_secret', 'Invalid login secret.');
      return withLock(user.key, async () => {
        const u = loadByKey(user.key);
        if (!await checkSecret(b.auth, u.auth)) { fail(lk); throw new HttpError(401, 'bad_credentials', 'Wrong password.'); }
        fs.unlinkSync(fileOf(user.key)); return { ok: true };
      });
    },
  };

  /* ---------- static files: only the app, never server code or data ---------- */
  function serveStatic(req, res, pathname) {
    if (!cfg.serveApp || (req.method !== 'GET' && req.method !== 'HEAD')) return send(res, 404, 'text/plain', 'Not found');
    const p = pathname === '/' ? '/index.html' : pathname;
    if (!STATIC_OK.test(p) || p.includes('..')) return send(res, 404, 'text/plain', 'Not found');
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT + path.sep)) return send(res, 404, 'text/plain', 'Not found');
    fs.readFile(file, (err, data) => {
      if (err) return send(res, 404, 'text/plain', 'Not found');
      send(res, 200, MIME[path.extname(file)] || 'application/octet-stream', req.method === 'HEAD' ? '' : data,
        { 'Cache-Control': p.startsWith('/assets/') ? 'public, max-age=86400' : 'no-cache', 'Content-Security-Policy': CSP });
    });
  }
  function send(res, status, type, body, extra = {}) {
    res.writeHead(status, { 'Content-Type': type + (type.startsWith('text/') || type.includes('json') ? '; charset=utf-8' : ''), 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer', ...extra });
    res.end(body);
  }
  const apiHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Max-Age': '600', 'Cache-Control': 'no-store' };

  async function handler(req, res) {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch (e) { return send(res, 400, 'text/plain', 'Bad request'); }
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, decodeURIComponent(url.pathname));
    if (req.method === 'OPTIONS') { res.writeHead(204, apiHeaders); return res.end(); }
    const fn = routes[req.method + ' ' + url.pathname];
    if (!fn) return send(res, 404, 'application/json', JSON.stringify({ error: 'not_found' }), apiHeaders);
    try {
      const out = await fn(req, { query: url.searchParams, ip: ipOf(req) });
      const status = out && out.status ? out.status : 200, body = out && out.status ? out.body : out;
      send(res, status, 'application/json', JSON.stringify(body), apiHeaders);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, 'application/json', JSON.stringify({ error: e.code, message: e.message }), { ...apiHeaders, ...(e.headers || {}) });
      console.error(e);
      send(res, 500, 'application/json', JSON.stringify({ error: 'server_error', message: 'Something went wrong on the server.' }), apiHeaders);
    }
  }

  const server = options.tls ? https.createServer(options.tls, handler) : http.createServer(handler);
  server.requestTimeout = 30000;
  return {
    server, cfg,
    listen: (port, host) => new Promise((res, rej) => { server.once('error', rej); server.listen(port, host, () => res(server.address())); }),
    close: () => new Promise(res => server.close(res)),
  };
}

module.exports = { createServer, VERSION };

/* ---------- command line ---------- */
if (require.main === module) {
  const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def; };
  const env = process.env;
  const port = +arg('port', env.PORT || env.LEDGERLY_PORT || 8787), host = arg('host', env.LEDGERLY_HOST || '127.0.0.1');
  const cert = arg('cert'), key = arg('key');
  let app;
  try {
    app = createServer({ dataDir: arg('data'), signup: arg('signup'), invite: arg('invite'), log: m => console.log(new Date().toISOString(), m),
      tls: cert && key ? { cert: fs.readFileSync(cert), key: fs.readFileSync(key) } : undefined });
  } catch (e) { console.error('Cannot start: ' + e.message); process.exit(1); }
  app.listen(port, host).then(addr => {
    const proto = cert && key ? 'https' : 'http';
    console.log(`\n  Ledgerly server ${VERSION}`);
    console.log(`  Data folder : ${app.cfg.dataDir}`);
    console.log(`  New accounts: ${app.cfg.signup}`);
    console.log(`  Open        : ${proto}://localhost:${addr.port}`);
    if (host === '0.0.0.0' || host === '::') {
      for (const list of Object.values(os.networkInterfaces())) for (const n of list || []) if (n.family === 'IPv4' && !n.internal) console.log(`  On your network: ${proto}://${n.address}:${addr.port}`);
      if (!(cert && key)) console.log('\n  Note: other devices need HTTPS for the app to unlock (browsers disable encryption on plain http).\n  Use a tunnel or a hosting service that provides HTTPS, or pass --cert and --key.');
    } else console.log('  Reachable only from this computer. Use --host 0.0.0.0 to allow other devices.');
    console.log('\n  Press Ctrl+C to stop.\n');
  }).catch(e => { console.error(e.code === 'EADDRINUSE' ? `Port ${port} is already in use. Try --port ${port + 1}.` : e.message); process.exit(1); });
}
