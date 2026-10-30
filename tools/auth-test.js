/* Tests for the profile / sync system:  node tools/auth-test.js
   Covers the crypto vault, the merge helper, and the real server over HTTP (on a random port, in a temp folder). */
const fs = require('fs'), vm = require('vm'), path = require('path'), os = require('os'), http = require('http');
const { createServer } = require('../server/server.js');
const root = path.join(__dirname, '..');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('  FAIL: ' + msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, expected ${JSON.stringify(b)})`);
const throws = async (fn, msg) => { try { await fn(); ok(false, msg + ' (did not throw)'); } catch (e) { ok(true, msg); return e; } };

const ctx = { console, TextEncoder, TextDecoder, btoa, atob, Uint8Array, crypto: globalThis.crypto, Error, String, Array, Object, Map, JSON, Number };
vm.createContext(ctx);
for (const f of ['vault.js', 'merge.js']) vm.runInContext(fs.readFileSync(path.join(root, 'js', f), 'utf8'), ctx, { filename: f });
const run = code => vm.runInContext(code, ctx);
const { Vault, Merge } = run('({ Vault, Merge })');
Vault.ITER = 1000; // fast for tests; the app uses 600,000

(async () => {
  /* ================= vault ================= */
  const acct = await Vault.createAccount('correct horse battery');
  ok(acct.dk.length === 32 && acct.recovery.length === 16, 'account has a 256-bit data key and 128-bit recovery key');
  const u1 = await Vault.unlock('correct horse battery', acct);
  eq(Array.from(u1.dk), Array.from(acct.dk), 'password unlocks the same data key');
  eq(u1.auth, acct.auth, 'login secret is reproducible from the password');
  await throws(() => Vault.unlock('wrong password!!', acct), 'wrong password is rejected');
  const u2 = await Vault.unlock('correct horse battery'.normalize('NFD'), acct);
  ok(u2.auth === acct.auth, 'unicode normalisation (NFKC) makes equivalent passwords match');
  const ar = await Vault.createAccount('كلمة سر عربية طويلة');
  eq(Array.from((await Vault.unlock('كلمة سر عربية طويلة', ar)).dk), Array.from(ar.dk), 'an Arabic password works');

  const sealed = await Vault.seal(acct.dk, JSON.stringify({ hello: 'مرحبا', n: 42 }));
  ok(/^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/.test(sealed), 'sealed format is v1.iv.ciphertext');
  eq(JSON.parse(await Vault.open(acct.dk, sealed)).hello, 'مرحبا', 'seal/open round-trips unicode');
  ok(sealed !== await Vault.seal(acct.dk, JSON.stringify({ hello: 'مرحبا', n: 42 })), 'a fresh random IV is used every time');
  const parts = sealed.split('.'); const flipped = Buffer.from(parts[2], 'base64'); flipped[0] ^= 1;
  await throws(() => Vault.open(acct.dk, `v1.${parts[1]}.${flipped.toString('base64')}`), 'tampered ciphertext is detected');
  await throws(() => Vault.open(Vault.random(32), sealed), 'wrong key cannot decrypt');
  await throws(() => Vault.open(acct.dk, 'garbage'), 'malformed input is rejected');

  const txt = Vault.formatRecovery(acct.recovery);
  ok(/^([0-9A-Z]{4}-){6}[0-9A-Z]{2}$/.test(txt), 'recovery key is formatted in groups: ' + txt);
  eq(Array.from(Vault.parseRecovery(txt)), Array.from(acct.recovery), 'recovery key parses back');
  eq(Array.from(Vault.parseRecovery(txt.toLowerCase().replace(/-/g, ' '))), Array.from(acct.recovery), 'recovery key accepts lower case and spaces');
  eq(Vault.parseRecovery('too short'), null, 'a short recovery key is rejected');
  eq(Array.from((await Vault.unlockWithRecovery(acct.recovery, acct.recWrap)).dk), Array.from(acct.dk), 'recovery key unlocks the same data key');
  await throws(() => Vault.unlockWithRecovery(Vault.random(16), acct.recWrap), 'wrong recovery key is rejected');

  const re = await Vault.rewrap('a brand new password', acct.dk);
  eq(Array.from((await Vault.unlock('a brand new password', { ...acct, ...re })).dk), Array.from(acct.dk), 'changing the password keeps the same data key');
  ok(re.auth !== acct.auth && re.salt !== acct.salt, 'new password gives a new salt and login secret');
  await throws(() => Vault.unlock('correct horse battery', { ...acct, ...re }), 'old password stops working after a change');
  eq(Array.from((await Vault.unlockWithRecovery(acct.recovery, acct.recWrap)).dk), Array.from(acct.dk), 'recovery still works after a password change');
  ok(Vault.strength('abc') === 0 && Vault.strength('password') <= 1 && Vault.strength('Tr1cky-long-passphrase!') >= 3, 'strength guide ranks passwords sensibly');

  // device key: "stay signed in on this device"
  const dev = await Vault.newDeviceKey();
  ok(dev.extractable === false, 'the device key cannot be exported');
  const saved = await Vault.sealWithKey(dev, JSON.stringify({ dk: 'abc', secret: 'xyz' }));
  eq(JSON.parse(await Vault.openWithKey(dev, saved)).secret, 'xyz', 'the device key seals and reopens the saved sign-in');
  await throws(() => Vault.newDeviceKey().then(k => Vault.openWithKey(k, saved)), 'another device key cannot open it');
  const dparts = saved.split('.'), dflip = Buffer.from(dparts[2], 'base64'); dflip[0] ^= 1;
  await throws(() => Vault.openWithKey(dev, `v1.${dparts[1]}.${dflip.toString('base64')}`), 'a tampered saved sign-in is rejected');
  ok(!saved.includes('abc') && !saved.includes('xyz'), 'the saved sign-in is not readable text');

  /* ================= merge ================= */
  const mine = { accounts: [{ id: 'a1', name: 'Mine' }], categories: [], transactions: [{ id: 't1', date: '2026-10-01', amount: 100 }, { id: 't2', date: '2026-10-02', amount: 5 }],
    goals: [], recurring: [], budgets: { '2026-10': { lines: { x: 1 } } }, settings: { currency: 'USD', name: 'Me' }, meta: { onboarded: true } };
  const theirs = { accounts: [{ id: 'a1', name: 'Theirs' }, { id: 'a2', name: 'Server only' }], categories: [], transactions: [{ id: 't1', date: '2026-10-01', amount: 999 }, { id: 't3', date: '2026-10-09', amount: 7 }],
    goals: [], recurring: [], budgets: { '2026-09': { lines: { y: 2 } }, '2026-10': { lines: { x: 9 } } }, settings: { currency: 'EUR', theme: 'dark' }, meta: { onboarded: false } };
  const m = Merge.states(mine, theirs);
  eq(m.transactions.map(t => t.id).sort(), ['t1', 't2', 't3'], 'merge keeps every transaction from both sides');
  eq(m.transactions.find(t => t.id === 't1').amount, 100, 'this device wins when both have the same id');
  eq(m.accounts.map(a => a.id).sort(), ['a1', 'a2'], 'merge adds accounts that only the server had');
  eq(Object.keys(m.budgets).sort(), ['2026-09', '2026-10'], 'merge keeps budget months from both sides');
  eq(m.budgets['2026-10'].lines.x, 1, 'this device wins for a month both planned');
  eq([m.settings.currency, m.settings.theme, m.settings.name], ['USD', 'dark', 'Me'], 'settings merge with this device winning');
  eq(Merge.summary(m).transactions, 3, 'summary counts transactions');

  /* ================= server ================= */
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ledgerly-test-'));
  const mk = async (opts = {}) => { const s = createServer({ dataDir: fs.mkdtempSync(path.join(tmp, 'd-')), minIter: 1000, scryptN: 1024, ...opts }); const a = await s.listen(0, '127.0.0.1'); s.base = `http://127.0.0.1:${a.port}`; return s; };
  const call = async (s, method, p, body, token) => {
    const r = await fetch(s.base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch (e) { /* not json */ }
    return { status: r.status, body: j, headers: r.headers };
  };
  const raw = (s, p) => new Promise(res => { http.get({ host: '127.0.0.1', port: new URL(s.base).port, path: p }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res({ status: r.statusCode, body: d, headers: r.headers })); }); });

  const S = await mk();
  const info = await call(S, 'GET', '/api/info');
  ok(info.status === 200 && info.body.app === 'ledgerly-server', 'info endpoint identifies the server');
  ok(info.headers.get('access-control-allow-origin') === '*', 'API sends CORS headers so the file:// app can connect');

  const k1 = await call(S, 'GET', '/api/kdf?username=nobody'), k2 = await call(S, 'GET', '/api/kdf?username=NOBODY');
  eq(k1.body, k2.body, 'unknown usernames get the same stable fake KDF settings (no user probing)');

  const PLAINTEXT = 'SECRET-MARKER-balance-12345';
  const noor = await Vault.createAccount('noor password one');
  const blob1 = await Vault.seal(noor.dk, JSON.stringify({ note: PLAINTEXT }));
  const reg = (extra = {}) => ({ username: 'Noor', salt: noor.salt, iter: noor.iter, auth: noor.auth, pwWrap: noor.pwWrap, recAuth: noor.recAuth, recWrap: noor.recWrap, blob: blob1, ...extra });
  const r1 = await call(S, 'POST', '/api/register', reg());
  ok(r1.status === 201 && r1.body.token && r1.body.version === 1, 'register creates the account and signs in');
  eq((await call(S, 'POST', '/api/register', reg({ username: 'NOOR' }))).status, 409, 'usernames are unique, case-insensitively');
  eq((await call(S, 'POST', '/api/register', reg({ username: 'x' }))).status, 400, 'a too-short username is rejected');
  eq((await call(S, 'POST', '/api/register', reg({ username: 'bad name!', blob: 'plaintext' }))).status, 400, 'plaintext data is not accepted');
  eq((await call(S, 'POST', '/api/register', reg({ username: 'weak', iter: 5 }))).status, 400, 'a weak key-derivation setting is rejected');
  const kd = await call(S, 'GET', '/api/kdf?username=noor');
  eq([kd.body.salt, kd.body.iter], [noor.salt, noor.iter], 'kdf returns the real settings for a real account');

  const stored = fs.readdirSync(path.join(S.cfg.dataDir, 'users')).map(f => fs.readFileSync(path.join(S.cfg.dataDir, 'users', f), 'utf8')).join('');
  ok(!stored.includes(PLAINTEXT) && !stored.includes('noor password one'), 'the server file contains no plaintext and no password');
  ok(!stored.includes(noor.auth), 'the server stores a hash of the login secret, not the secret');

  eq((await call(S, 'GET', '/api/data')).status, 401, 'data needs a session');
  eq((await call(S, 'GET', '/api/data', null, 'nope.nope')).status, 401, 'a made-up token is rejected');
  const bad1 = await call(S, 'POST', '/api/login', { username: 'noor', auth: 'A'.repeat(43) });
  eq(bad1.status, 401, 'login with the wrong secret fails');
  const l1 = await call(S, 'POST', '/api/login', { username: 'NOOR', auth: noor.auth });
  ok(l1.status === 200 && l1.body.pwWrap === noor.pwWrap && l1.body.salt === noor.salt, 'login succeeds and returns the password wrap for a new device');
  const T = l1.body.token;

  const g1 = await call(S, 'GET', '/api/data', null, T);
  eq(JSON.parse(await Vault.open(noor.dk, g1.body.blob)).note, PLAINTEXT, 'the client can decrypt what the server stored');
  const blob2 = await Vault.seal(noor.dk, JSON.stringify({ note: 'v2' }));
  const p1 = await call(S, 'PUT', '/api/data', { baseVersion: 1, blob: blob2 }, T);
  ok(p1.status === 200 && p1.body.version === 2, 'saving from the current version succeeds');
  const p2 = await call(S, 'PUT', '/api/data', { baseVersion: 1, blob: blob1 }, T);
  ok(p2.status === 409 && p2.body.version === 2 && p2.body.blob === blob2, 'saving from an old version is a conflict that returns the current data');
  eq((await call(S, 'PUT', '/api/data', { baseVersion: 2, blob: 'not sealed' }, T)).status, 400, 'a PUT with unencrypted data is refused');
  const bigBlob = 'v1.' + 'A'.repeat(100) + '.' + 'A'.repeat(S.cfg.maxBlob + 10);
  const big = await call(S, 'PUT', '/api/data', { baseVersion: 2, blob: bigBlob }, T).catch(() => ({ status: 'closed' }));
  ok(big.status === 400 || big.status === 413 || big.status === 'closed', 'an oversized blob is refused');

  // concurrent writers: exactly one wins
  const race = await Promise.all([1, 2, 3, 4].map(i => Vault.seal(noor.dk, 'r' + i).then(b => call(S, 'PUT', '/api/data', { baseVersion: 2, blob: b }, T))));
  eq(race.filter(r => r.status === 200).length, 1, 'of four simultaneous saves from the same version exactly one succeeds');

  // password change
  const nw = await Vault.rewrap('noor new password two', noor.dk);
  eq((await call(S, 'POST', '/api/password', { auth: 'B'.repeat(43), newAuth: nw.auth, salt: nw.salt, iter: nw.iter, pwWrap: nw.pwWrap }, T)).status, 401, 'password change needs the current password');
  const other = (await call(S, 'POST', '/api/login', { username: 'noor', auth: noor.auth })).body.token;
  eq((await call(S, 'POST', '/api/password', { auth: noor.auth, newAuth: nw.auth, salt: nw.salt, iter: nw.iter, pwWrap: nw.pwWrap }, T)).status, 200, 'password change succeeds');
  eq((await call(S, 'GET', '/api/data', null, other)).status, 401, 'password change signs out other devices');
  eq((await call(S, 'GET', '/api/data', null, T)).status, 200, 'the device that changed it stays signed in');
  eq((await call(S, 'POST', '/api/login', { username: 'noor', auth: noor.auth })).status, 401, 'the old password no longer logs in');
  const nl = await call(S, 'POST', '/api/login', { username: 'noor', auth: nw.auth });
  eq(Array.from((await Vault.unlock('noor new password two', { salt: nl.body.salt, iter: nl.body.iter, pwWrap: nl.body.pwWrap })).dk), Array.from(noor.dk), 'a new device decrypts with the new password');

  // forgot password -> recovery key
  eq((await call(S, 'POST', '/api/recover/fetch', { username: 'noor', recAuth: 'C'.repeat(43) })).status, 401, 'recovery with the wrong key is refused');
  const rf = await call(S, 'POST', '/api/recover/fetch', { username: 'noor', recAuth: noor.recAuth });
  ok(rf.status === 200 && rf.body.recWrap === noor.recWrap, 'recovery key proves ownership and returns the recovery wrap');
  const dkRec = (await Vault.unlockWithRecovery(noor.recovery, rf.body.recWrap)).dk;
  const reset = await Vault.rewrap('noor third password', dkRec);
  eq((await call(S, 'POST', '/api/recover/reset', { username: 'noor', recAuth: noor.recAuth, newAuth: reset.auth, salt: reset.salt, iter: reset.iter, pwWrap: reset.pwWrap })).status, 200, 'reset with the recovery key succeeds');
  eq((await call(S, 'GET', '/api/data', null, T)).status, 401, 'a reset signs out every device');
  const fin = await call(S, 'POST', '/api/login', { username: 'noor', auth: reset.auth });
  ok(/^r[1-4]$/.test(await Vault.open(dkRec, (await call(S, 'GET', '/api/data', null, fin.body.token)).body.blob)), 'data is still readable after a reset (same data key)');

  // polling endpoint and recovery-key rotation
  const ver = await call(S, 'GET', '/api/version', null, fin.body.token);
  ok(ver.status === 200 && Number.isInteger(ver.body.version) && !('blob' in ver.body), 'the version check returns a version and no data');
  eq(fin.body.recWrap, Vault.b64 ? (await call(S, 'POST', '/api/login', { username: 'noor', auth: reset.auth })).body.recWrap : null, 'login returns the recovery wrap for a new device');
  const rec2 = Vault.random(16), rc2 = await Vault.fromRecovery(rec2), recWrap2 = await Vault.seal(rc2.kek, dkRec);
  eq((await call(S, 'POST', '/api/recovery', { auth: 'F'.repeat(43), recAuth: rc2.auth, recWrap: recWrap2 }, fin.body.token)).status, 401, 'rotating the recovery key needs the password');
  eq((await call(S, 'POST', '/api/recovery', { auth: reset.auth, recAuth: rc2.auth, recWrap: recWrap2 }, fin.body.token)).status, 200, 'the recovery key can be replaced');
  eq((await call(S, 'POST', '/api/recover/fetch', { username: 'noor', recAuth: noor.recAuth })).status, 401, 'the old recovery key stops working');
  eq((await call(S, 'POST', '/api/recover/fetch', { username: 'noor', recAuth: rc2.auth })).status, 200, 'the new recovery key works');

  // brute force protection
  const S2 = await mk();
  await call(S2, 'POST', '/api/register', reg());
  let last; for (let i = 0; i < 9; i++) last = await call(S2, 'POST', '/api/login', { username: 'noor', auth: 'D'.repeat(43) });
  ok(last.status === 429 && last.headers.get('retry-after'), 'repeated wrong logins are rate-limited with Retry-After');
  eq((await call(S2, 'POST', '/api/login', { username: 'noor', auth: noor.auth })).status, 429, 'even the right secret waits out the limit');
  await S2.close();

  // account deletion
  eq((await call(S, 'DELETE', '/api/account', { auth: 'E'.repeat(43) }, fin.body.token)).status, 401, 'deleting an account needs the password');
  eq((await call(S, 'DELETE', '/api/account', { auth: reset.auth }, fin.body.token)).status, 200, 'an account can be deleted');
  eq((await call(S, 'POST', '/api/login', { username: 'noor', auth: reset.auth })).status, 401, 'a deleted account cannot sign in');

  // static files: the app only
  const idx = await raw(S, '/');
  ok(idx.status === 200 && /<title>Ledgerly/.test(idx.body), 'the server serves the app');
  ok(/script-src 'self'/.test(idx.headers['content-security-policy'] || ''), 'the app is served with a Content-Security-Policy');
  eq((await raw(S, '/js/vault.js')).status, 200, 'app scripts are served');
  for (const bad of ['/server/server.js', '/data/secret.key', '/.git/config', '/tools/auth-test.js', '/package.json', '/js/%2e%2e/server/server.js', '/%2e%2e/%2e%2e/windows/win.ini', '/js/..%5cserver%5cserver.js', '/README.md'])
    eq((await raw(S, bad)).status, 404, 'not served: ' + bad);
  ok(!(await raw(S, '/api/data')).body.includes('blob'), 'API paths are never served as files');

  // sign-up policies
  const SI = await mk({ signup: 'invite', invite: 'letmein' });
  eq((await call(SI, 'GET', '/api/info')).body.inviteRequired, true, 'info tells clients an invite code is needed');
  eq((await call(SI, 'POST', '/api/register', reg())).status, 403, 'invite-only: no code is refused');
  eq((await call(SI, 'POST', '/api/register', reg({ invite: 'wrong' }))).status, 403, 'invite-only: wrong code is refused');
  eq((await call(SI, 'POST', '/api/register', reg({ invite: 'letmein' }))).status, 201, 'invite-only: right code works');
  await SI.close();
  const SC = await mk({ signup: 'closed' });
  eq((await call(SC, 'POST', '/api/register', reg())).status, 403, 'closed servers refuse new accounts');
  await SC.close();
  const SM = await mk({ maxUsers: 1 });
  await call(SM, 'POST', '/api/register', reg());
  eq((await call(SM, 'POST', '/api/register', reg({ username: 'second' }))).status, 403, 'the account limit is enforced');
  await SM.close();
  await throws(async () => createServer({ dataDir: fs.mkdtempSync(path.join(tmp, 'd-')), signup: 'invite' }), 'invite mode without a code refuses to start');

  const opt = await new Promise(res => { const rq = http.request({ host: '127.0.0.1', port: new URL(S.base).port, path: '/api/data', method: 'OPTIONS' }, r => res(r.statusCode)); rq.end(); });
  eq(opt, 204, 'CORS preflight is answered');

  await S.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
