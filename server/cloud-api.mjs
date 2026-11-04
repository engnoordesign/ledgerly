/* Ledgerly sync API for Cloudflare Workers (and any runtime with fetch-style Request / Response and WebCrypto).
   Same HTTP API as server/server.js, so the app cannot tell them apart. Storage is SQLite behind a small D1-style interface
   (prepare / bind / first / all / run / batch): on Cloudflare a Durable Object's built-in SQLite (see server/worker.mjs),
   in tests Node's own SQLite (see server/sql-adapter.mjs).

   What is stored: one encrypted blob per account (split into chunks, because a SQLite row is capped at 2 MB there), a version number,
   and an HMAC of the login secret. The login secret is derived in the browser with PBKDF2-SHA256 (600,000 rounds), so it is
   already slow to guess; the server keys its hash with a secret pepper that never sits in the database rows it protects.
   Passwords and encryption keys never reach the server. */

export const VERSION = '1.1.0';
const USERNAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}._-]{2,31}$/u;
const SECRET_RE = /^[A-Za-z0-9_-]{43}$/;                    // 32 bytes, base64url
const SEALED_RE = /^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/; // "v1.<iv>.<ciphertext>" produced by the app
const WINDOW_MS = 10 * 60 * 1000, MAX_FAILS = 8, CHUNK = 900000;

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (key TEXT PRIMARY KEY, username TEXT NOT NULL, salt TEXT NOT NULL, iter INTEGER NOT NULL, auth TEXT NOT NULL,
    rec_auth TEXT NOT NULL, pw_wrap TEXT NOT NULL, rec_wrap TEXT NOT NULL, version INTEGER NOT NULL, wnonce TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS chunks (user_key TEXT NOT NULL, version INTEGER NOT NULL, idx INTEGER NOT NULL, part TEXT NOT NULL, PRIMARY KEY (user_key, version, idx))`,
  `CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_key TEXT NOT NULL, created INTEGER NOT NULL, exp INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_key)`,
  `CREATE TABLE IF NOT EXISTS limits (k TEXT PRIMARY KEY, n INTEGER NOT NULL, until INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
];

class HttpError extends Error {
  constructor(status, code, message, headers) { super(message || code); this.status = status; this.code = code; this.headers = headers; }
}
const bad = (code, msg) => new HttpError(400, code, msg);

/* ---------- bytes ---------- */
const enc = new TextEncoder();
const b64 = bytes => { let s = ''; const b = new Uint8Array(bytes); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
const b64url = bytes => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const random = n => crypto.getRandomValues(new Uint8Array(n));
const hex = bytes => [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
const sha256 = async s => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const sameBytes = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; };
const sameString = (a, b) => sameBytes(enc.encode(String(a)), enc.encode(String(b)));

export function createApi(options = {}) {
  const cfg = {
    signup: options.signup || 'open',
    invite: options.invite || '',
    maxUsers: +(options.maxUsers || 50),
    maxBlob: +(options.maxBlob || 8 * 1024 * 1024),
    minIter: +(options.minIter || 100000),
    sessionMs: (+(options.sessionDays || 30)) * 86400000,
    log: options.log || (() => {}),
  };
  if (!['open', 'invite', 'closed'].includes(cfg.signup)) cfg.signup = 'closed';
  const db = options.db;
  if (!db) throw new Error('A database is required.');
  const configError = cfg.signup === 'invite' && !cfg.invite ? 'LEDGERLY_SIGNUP=invite needs LEDGERLY_INVITE as well.' : null;

  /* ---------- database ---------- */
  let ready = null;
  const init = () => (ready = ready || (async () => {
    await db.batch(SCHEMA.map(s => db.prepare(s)));
    let secret = options.secret ? String(options.secret) : null;
    if (!secret) {   // no pepper configured: keep one in the database (setting LEDGERLY_SECRET is better)
      await db.prepare('INSERT OR IGNORE INTO meta (k, v) VALUES (?, ?)').bind('secret', b64url(random(32))).run();
      secret = (await db.prepare('SELECT v FROM meta WHERE k = ?').bind('secret').first()).v;
    }
    const pepper = await crypto.subtle.importKey('raw', enc.encode('ledgerly-pepper:' + secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return { pepper };
  })().catch(e => { ready = null; throw e; }));

  const norm = s => String(s == null ? '' : s).normalize('NFKC').trim().toLowerCase();
  const userKey = async lower => (await sha256('user:' + lower)).slice(0, 40);
  const loadByKey = key => db.prepare('SELECT * FROM users WHERE key = ?').bind(key).first();
  const countUsers = async () => (await db.prepare('SELECT COUNT(*) AS n FROM users').first()).n;
  const readBlob = async u => {
    const r = await db.prepare('SELECT part FROM chunks WHERE user_key = ? AND version = ? ORDER BY idx').bind(u.key, u.version).all();
    return (r.results || []).map(x => x.part).join('');
  };
  /** Statements that store `blob` as `version`, but only if the account row still carries `nonce` (set by the same batch). */
  const chunkWrites = (key, version, nonce, blob) => {
    const out = [];
    for (let i = 0, idx = 0; i < blob.length || idx === 0; i += CHUNK, idx++) {
      out.push(db.prepare('INSERT OR REPLACE INTO chunks (user_key, version, idx, part) SELECT ?, ?, ?, ? WHERE (SELECT wnonce FROM users WHERE key = ?) = ?')
        .bind(key, version, idx, blob.slice(i, i + CHUNK), key, nonce));
    }
    out.push(db.prepare('DELETE FROM chunks WHERE user_key = ? AND version <> ? AND (SELECT wnonce FROM users WHERE key = ?) = ?').bind(key, version, key, nonce));
    return out;
  };

  /* ---------- secrets ---------- */
  const mac = async (salt, secret) => b64((await crypto.subtle.sign('HMAC', (await init()).pepper, enc.encode('auth:' + salt + ':' + secret))));
  const hashSecret = async secret => { const salt = b64(random(16)); return JSON.stringify({ salt, hash: await mac(salt, secret) }); };
  const checkSecret = async (secret, stored) => {
    const rec = JSON.parse(stored), got = unb64(await mac(rec.salt, secret)), want = unb64(rec.hash);
    return sameBytes(got, want);
  };
  const burn = secret => mac('none', secret);   // same work for unknown users

  /* ---------- rate limiting (in the database, so it holds across edge locations) ---------- */
  const limitRow = k => db.prepare('SELECT n, until FROM limits WHERE k = ?').bind(k).first();
  const guard = async k => {
    const e = await limitRow(k);
    if (!e) return;
    if (e.until < Date.now()) { await db.prepare('DELETE FROM limits WHERE k = ?').bind(k).run(); return; }
    if (e.n >= MAX_FAILS) throw new HttpError(429, 'too_many_attempts', 'Too many attempts. Try again later.', { 'Retry-After': String(Math.max(1, Math.ceil((e.until - Date.now()) / 1000))) });
  };
  const fail = (k, windowMs = WINDOW_MS) => {
    const now = Date.now();
    return db.prepare(`INSERT INTO limits (k, n, until) VALUES (?, 1, ?) ON CONFLICT (k) DO UPDATE SET
      n = CASE WHEN limits.until < ? THEN 1 ELSE limits.n + 1 END, until = CASE WHEN limits.until < ? THEN excluded.until ELSE limits.until END`).bind(k, now + windowMs, now, now).run();
  };
  const clear = k => db.prepare('DELETE FROM limits WHERE k = ?').bind(k).run();

  /* ---------- request helpers ---------- */
  const readBody = async (req, limit = cfg.maxBlob * 1.5 + 4096) => {
    const len = +(req.headers.get('content-length') || 0);
    if (len > limit) throw new HttpError(413, 'too_large', 'Request is too large.');
    const text = await req.text();
    if (text.length > limit) throw new HttpError(413, 'too_large', 'Request is too large.');
    try { const j = text ? JSON.parse(text) : {}; return j && typeof j === 'object' ? j : {}; } catch (e) { throw bad('bad_json', 'Body must be JSON.'); }
  };
  const need = (cond, code, msg) => { if (!cond) throw bad(code, msg); };
  const secretOk = s => typeof s === 'string' && SECRET_RE.test(s);
  const sealedOk = s => typeof s === 'string' && s.length <= cfg.maxBlob && SEALED_RE.test(s);
  const saltOk = s => { if (typeof s !== 'string' || !/^[A-Za-z0-9+/=]{20,32}$/.test(s)) return false; try { return unb64(s).length === 16; } catch (e) { return false; } };
  const iterOk = n => Number.isInteger(n) && n >= cfg.minIter && n <= 10000000;
  const usernameOf = raw => { const n = norm(raw); need(USERNAME_RE.test(n), 'bad_username', 'Usernames are 3 to 32 letters, numbers, dots, dashes or underscores.'); return n; };
  const fakeKdf = async lower => ({ salt: b64(unb64(await mac('kdf', lower)).subarray(0, 16)), iter: 600000 });

  async function session(req) {
    const m = /^Bearer (\S+)$/.exec(req.headers.get('authorization') || '');
    if (!m) throw new HttpError(401, 'unauthorized', 'Sign in first.');
    const token = m[1], key = token.split('.')[0];
    if (!/^[a-f0-9]{40}$/.test(key)) throw new HttpError(401, 'unauthorized', 'Your session expired. Sign in again.');
    const hash = await sha256(token), s = await db.prepare('SELECT exp FROM sessions WHERE hash = ? AND user_key = ?').bind(hash, key).first();
    const u = s && s.exp >= Date.now() ? await loadByKey(key) : null;
    if (!u) throw new HttpError(401, 'unauthorized', 'Your session expired. Sign in again.');
    return { user: u, token, hash };
  }
  /** A new session token. The newest ten sessions per account are kept. */
  const newSessionStmts = async key => {
    const token = key + '.' + b64url(random(32)), now = Date.now();
    return {
      token, expiresAt: new Date(now + cfg.sessionMs).toISOString(),
      stmts: [
        db.prepare('DELETE FROM sessions WHERE user_key = ? AND (exp < ? OR hash NOT IN (SELECT hash FROM sessions WHERE user_key = ? ORDER BY created DESC LIMIT 9))').bind(key, now, key),
        db.prepare('INSERT INTO sessions (hash, user_key, created, exp) VALUES (?, ?, ?, ?)').bind(await sha256(token), key, now, now + cfg.sessionMs),
      ],
    };
  };
  const view = u => ({ version: u.version, updatedAt: u.updated_at });

  /* ---------- API ---------- */
  const routes = {
    'GET /api/health': async () => ({ ok: true }),
    'GET /api/info': async () => ({ app: 'ledgerly-server', version: VERSION, signup: cfg.signup, inviteRequired: cfg.signup === 'invite', iterations: 600000, maxBlob: cfg.maxBlob, host: 'cloudflare' }),

    'GET /api/kdf': async (req, c) => {
      const lower = norm(c.query.get('username'));
      need(USERNAME_RE.test(lower), 'bad_username', 'Usernames are 3 to 32 letters, numbers, dots, dashes or underscores.');
      const u = await loadByKey(await userKey(lower));
      return u ? { salt: u.salt, iter: u.iter } : fakeKdf(lower);
    },

    'POST /api/register': async (req, c) => {
      const b = await readBody(req);
      if (cfg.signup === 'closed') throw new HttpError(403, 'signup_closed', 'This server is not accepting new accounts.');
      if (cfg.signup === 'invite' && !sameString(b.invite || '', cfg.invite)) throw new HttpError(403, 'bad_invite', 'That invite code is not valid.');
      const sk = 'reg|' + c.ip, e = await limitRow(sk);
      if (e && e.until >= Date.now() && e.n >= 10) throw new HttpError(429, 'too_many_attempts', 'Too many new accounts from this address. Try later.', { 'Retry-After': '3600' });
      const lower = usernameOf(b.username);
      need(saltOk(b.salt) && iterOk(b.iter), 'bad_kdf', 'Invalid key settings.');
      need(secretOk(b.auth) && secretOk(b.recAuth), 'bad_secret', 'Invalid login secret.');
      need(sealedOk(b.pwWrap) && sealedOk(b.recWrap) && sealedOk(b.blob), 'bad_data', 'Invalid encrypted data.');
      const key = await userKey(lower);
      if (await loadByKey(key)) throw new HttpError(409, 'username_taken', 'That username is already taken on this server.');
      if (await countUsers() >= cfg.maxUsers) throw new HttpError(403, 'server_full', 'This server has reached its account limit.');
      const now = new Date().toISOString(), nonce = b64url(random(12)), s = await newSessionStmts(key);
      const res = await db.batch([
        db.prepare(`INSERT INTO users (key, username, salt, iter, auth, rec_auth, pw_wrap, rec_wrap, version, wnonce, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?) ON CONFLICT (key) DO NOTHING`)
          .bind(key, String(b.username).normalize('NFKC').trim(), b.salt, b.iter, await hashSecret(b.auth), await hashSecret(b.recAuth), b.pwWrap, b.recWrap, nonce, now, now),
        ...chunkWrites(key, 1, nonce, b.blob),
      ]);
      if (!res[0].meta || !res[0].meta.changes) throw new HttpError(409, 'username_taken', 'That username is already taken on this server.');
      await db.batch(s.stmts);
      await fail(sk, 3600000);   // counts sign-ups per address
      cfg.log('account created');
      return { status: 201, body: { token: s.token, expiresAt: s.expiresAt, version: 1, updatedAt: now } };
    },

    'POST /api/login': async (req, c) => {
      const b = await readBody(req), lower = usernameOf(b.username), lk = 'login|' + c.ip + '|' + lower;
      await guard(lk);
      need(secretOk(b.auth), 'bad_secret', 'Invalid login secret.');
      const key = await userKey(lower), u = await loadByKey(key);
      const ok = u ? await checkSecret(b.auth, u.auth) : (await burn(b.auth), false);
      if (!ok) { await fail(lk); throw new HttpError(401, 'bad_credentials', 'Wrong username or password.'); }
      await clear(lk);
      const s = await newSessionStmts(key);
      await db.batch(s.stmts);
      return { token: s.token, expiresAt: s.expiresAt, ...view(u), salt: u.salt, iter: u.iter, pwWrap: u.pw_wrap, recWrap: u.rec_wrap };
    },

    'POST /api/logout': async req => {
      const { hash } = await session(req);
      await db.prepare('DELETE FROM sessions WHERE hash = ?').bind(hash).run();
      return { ok: true };
    },

    'GET /api/version': async req => view((await session(req)).user),

    'POST /api/recovery': async req => {
      const { user } = await session(req), b = await readBody(req), lk = 'rk|' + user.key;
      await guard(lk);
      need(secretOk(b.auth) && secretOk(b.recAuth) && sealedOk(b.recWrap), 'bad_data', 'Invalid recovery key data.');
      if (!await checkSecret(b.auth, user.auth)) { await fail(lk); throw new HttpError(401, 'bad_credentials', 'The password is wrong.'); }
      await db.prepare('UPDATE users SET rec_auth = ?, rec_wrap = ? WHERE key = ?').bind(await hashSecret(b.recAuth), b.recWrap, user.key).run();
      return { ok: true };
    },

    'GET /api/data': async req => {
      const { user } = await session(req);
      return { ...view(user), blob: await readBlob(user) };
    },

    // Optimistic concurrency: the client says which version it started from. Exactly one of several racing saves wins.
    'PUT /api/data': async req => {
      const { user } = await session(req), b = await readBody(req);
      need(Number.isInteger(b.baseVersion) && sealedOk(b.blob), 'bad_data', 'Invalid encrypted data.');
      const nonce = b64url(random(12)), next = b.baseVersion + 1, now = new Date().toISOString();
      const res = await db.batch([
        db.prepare('UPDATE users SET version = ?, wnonce = ?, updated_at = ? WHERE key = ? AND version = ?').bind(next, nonce, now, user.key, b.baseVersion),
        ...chunkWrites(user.key, next, nonce, b.blob),
      ]);
      if (!res[0].meta || !res[0].meta.changes) {
        const u = await loadByKey(user.key);
        return { status: 409, body: { error: 'conflict', message: 'The data changed on another device.', ...view(u), blob: await readBlob(u) } };
      }
      return { version: next, updatedAt: now };
    },

    'POST /api/password': async req => {
      const { user, hash } = await session(req), b = await readBody(req), lk = 'pw|' + user.key;
      await guard(lk);
      need(secretOk(b.auth) && secretOk(b.newAuth) && saltOk(b.salt) && iterOk(b.iter) && sealedOk(b.pwWrap), 'bad_data', 'Invalid password change.');
      if (!await checkSecret(b.auth, user.auth)) { await fail(lk); throw new HttpError(401, 'bad_credentials', 'The current password is wrong.'); }
      await db.batch([
        db.prepare('UPDATE users SET auth = ?, salt = ?, iter = ?, pw_wrap = ? WHERE key = ?').bind(await hashSecret(b.newAuth), b.salt, b.iter, b.pwWrap, user.key),
        db.prepare('DELETE FROM sessions WHERE user_key = ? AND hash <> ?').bind(user.key, hash),   // sign every other device out
      ]);
      return { ok: true };
    },

    'POST /api/recover/fetch': async (req, c) => {
      const b = await readBody(req), lower = usernameOf(b.username), lk = 'rec|' + c.ip + '|' + lower;
      await guard(lk); need(secretOk(b.recAuth), 'bad_secret', 'Invalid recovery secret.');
      const u = await loadByKey(await userKey(lower));
      const ok = u ? await checkSecret(b.recAuth, u.rec_auth) : (await burn(b.recAuth), false);
      if (!ok) { await fail(lk); throw new HttpError(401, 'bad_credentials', 'Wrong username or recovery key.'); }
      return { recWrap: u.rec_wrap, ...view(u) };
    },
    'POST /api/recover/reset': async (req, c) => {
      const b = await readBody(req), lower = usernameOf(b.username), lk = 'rec|' + c.ip + '|' + lower;
      await guard(lk);
      need(secretOk(b.recAuth) && secretOk(b.newAuth) && saltOk(b.salt) && iterOk(b.iter) && sealedOk(b.pwWrap), 'bad_data', 'Invalid reset.');
      const key = await userKey(lower), u = await loadByKey(key);
      const ok = u ? await checkSecret(b.recAuth, u.rec_auth) : (await burn(b.recAuth), false);
      if (!ok) { await fail(lk); throw new HttpError(401, 'bad_credentials', 'Wrong username or recovery key.'); }
      await db.batch([
        db.prepare('UPDATE users SET auth = ?, salt = ?, iter = ?, pw_wrap = ? WHERE key = ?').bind(await hashSecret(b.newAuth), b.salt, b.iter, b.pwWrap, key),
        db.prepare('DELETE FROM sessions WHERE user_key = ?').bind(key),
      ]);
      return { ok: true };
    },

    'DELETE /api/account': async req => {
      const { user } = await session(req), b = await readBody(req), lk = 'del|' + user.key;
      await guard(lk); need(secretOk(b.auth), 'bad_secret', 'Invalid login secret.');
      if (!await checkSecret(b.auth, user.auth)) { await fail(lk); throw new HttpError(401, 'bad_credentials', 'Wrong password.'); }
      await db.batch(['users WHERE key', 'chunks WHERE user_key', 'sessions WHERE user_key'].map(w => db.prepare('DELETE FROM ' + w + ' = ?').bind(user.key)));
      return { ok: true };
    },
  };

  const apiHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Max-Age': '600', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
  const json = (status, body, extra = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...apiHeaders, ...extra } });

  /** Handle one request to /api/*. ip is the client address (CF-Connecting-IP on Cloudflare). */
  async function handle(request, ip = '?') {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: apiHeaders });
    const fn = routes[request.method + ' ' + url.pathname];
    if (!fn) return json(404, { error: 'not_found' });
    if (configError) return json(503, { error: 'not_configured', message: configError });
    try {
      await init();
      const out = await fn(request, { query: url.searchParams, ip });
      return out && out.status ? json(out.status, out.body) : json(200, out);
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { error: e.code, message: e.message }, e.headers || {});
      console.error(e);
      return json(500, { error: 'server_error', message: 'Something went wrong on the server.' });
    }
  }
  return { handle, cfg };
}
