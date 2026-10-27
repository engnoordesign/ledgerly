'use strict';
/* Sync: keeps a profile's data available on every device through a Ledgerly server.
   Only encrypted data leaves the device. The server keeps one encrypted copy per account and a version number;
   every save says which version it started from, so two devices can never silently overwrite each other. */
const Sync = (() => {
  const Y = { state: 'off', detail: '' };
  const { h } = U;
  let token = null, busy = false, again = false, applying = false, paused = false, retries = 0;
  const timers = { push: null, poll: null, retry: null };

  const cfg = () => (Auth.profile && Auth.profile.sync) || null;
  Y.cfg = cfg;
  Y.enabled = () => { const c = cfg(); return !!c && c.enabled !== false; };

  class NetError extends Error { constructor() { super('NETWORK'); } }

  /* ---------- http ---------- */
  const normUrl = raw => {
    let s = String(raw || '').trim();
    if (!s) throw new UserError(t('Enter the server address.'));
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = (/^(localhost|127\.|\[::1\]|10\.|192\.168\.)/i.test(s) ? 'http://' : 'https://') + s;
    let u; try { u = new URL(s); } catch (e) { throw new UserError(t('That server address does not look right.')); }
    if (!/^https?:$/.test(u.protocol)) throw new UserError(t('That server address does not look right.'));
    return u.origin;
  };
  async function http(server, method, path, body, tok) {
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 20000);
    try {
      const r = await fetch(server + path, { method, signal: ctl.signal, cache: 'no-store',
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
      let j = null; try { j = await r.json(); } catch (e) { /* no body */ }
      return { status: r.status, body: j || {} };
    } catch (e) { throw new NetError(); } finally { clearTimeout(to); }
  }
  const serverError = r => {
    const code = (r.body && r.body.error) || '';
    const map = {
      username_taken: t('That username is already taken on this server.'), signup_closed: t('This server is not accepting new accounts.'),
      bad_invite: t('That invite code is not valid.'), server_full: t('This server has reached its account limit.'),
      bad_credentials: t('Wrong username or password.'), too_many_attempts: t('Too many attempts. Try again in a few minutes.'),
      bad_username: t('Usernames are 3 to 32 letters, numbers, dots, dashes or underscores.'), too_large: t('Your data is too large for this server.'),
    };
    return new UserError(map[code] || t('The server refused the request ({code}).', { code: code || r.status }));
  };

  /* ---------- status ---------- */
  Y.label = () => ({ off: t('Not syncing'), connecting: t('Connecting…'), synced: t('Up to date'), pending: t('Waiting to sync'),
    offline: t('Offline. Will sync when you are back online.'), conflict: t('Needs your decision'), auth: t('Sign in again to keep syncing'), error: t('Sync problem') })[Y.state];
  function setState(state, detail = '') { Y.state = state; Y.detail = detail; if (Y.onChange) Y.onChange(); }

  /* ---------- session with the server ---------- */
  async function login() {
    const c = cfg(), r = await http(c.server, 'POST', '/api/login', { username: c.username, auth: Auth.secret });
    if (r.status === 200) { token = r.body.token; return r.body; }
    if (r.status === 401) throw new Error('AUTH');
    throw serverError(r);
  }
  async function call(method, path, body) {
    const c = cfg();
    if (!token) await login();
    let r = await http(c.server, method, path, body, token);
    if (r.status === 401) { token = null; await login(); r = await http(c.server, method, path, body, token); }   // session expired: sign in once more
    return r;
  }

  /* ---------- moving data ---------- */
  const seal = () => Vault.seal(Auth.dk, JSON.stringify(S.state));
  const openState = async blob => S.normalize(JSON.parse(await Vault.open(Auth.dk, blob)));

  async function push() {
    const c = cfg(); if (!c) return;
    const v0 = S.version, blob = await seal();
    const r = await call('PUT', '/api/data', { baseVersion: c.version, blob });
    if (r.status === 200) {
      c.version = r.body.version; c.dirty = S.version !== v0; c.lastSyncedAt = Date.now(); Auth.saveList();
      setState(c.dirty ? 'pending' : 'synced'); if (c.dirty) schedulePush();
      return;
    }
    if (r.status === 409) return conflict(r.body);
    throw serverError(r);
  }
  async function pullApply(remote, announce) {
    const next = await openState(remote.blob);
    applying = true;
    try { S.state = next; S.version++; S.applySettings(); await S.persist(); } finally { applying = false; }
    const c = cfg(); c.version = remote.version; c.dirty = false; c.lastSyncedAt = Date.now(); Auth.saveList();
    S.emit(); setState('synced');
    if (announce) UI.toast(t('Updated from another device.'));
  }
  async function reconcile() {
    const c = cfg(), r = await call('GET', '/api/data');
    if (r.status !== 200) throw serverError(r);
    if (r.body.version === c.version) {
      if (c.dirty) return push();
      c.lastSyncedAt = Date.now(); Auth.saveList(); setState('synced'); return;
    }
    if (!c.dirty) return pullApply(r.body, true);
    return conflict(r.body);
  }
  async function check() {
    if (!Y.enabled() || busy || paused) return;
    busy = true;
    try {
      const c = cfg(), r = await call('GET', '/api/version');
      if (r.status === 200 && r.body.version !== c.version) await reconcile();
      else if (r.status === 200 && !c.dirty && Y.state !== 'synced') setState('synced');
    } catch (e) { handleError(e); } finally { busy = false; }
  }

  /* ---------- both sides changed: the user decides ---------- */
  const ask = (mine, theirs, remote) => new Promise(resolve => {
    const col = (title, s, note) => h`<div class="cf-col"><b>${title}</b><span>${U.plural(s.transactions, 'transaction')}</span><span>${U.plural(s.accounts, 'account')}</span>${note ? h`<small class="muted">${note}</small>` : ''}</div>`;
    const ctl = UI.modal({
      title: t('This profile changed on two devices'), sticky: true,
      body: h`<p class="muted">${t('You made changes here while another device saved different changes. Choose what to keep.')}</p>
        <div class="cf-cols">${col(t('This device'), mine, '')}${col(t('Server'), theirs, remote.updatedAt ? t('Saved {date}', { date: U.fmtDate(remote.updatedAt.slice(0, 10), 'med') }) : '')}</div>
        <div class="stack-btns col">
          <button type="button" class="btn primary" data-pick="merge"><span>${t('Merge both (recommended)')}</span></button><small class="muted">${t('Keeps everything from both. Anything deleted on one side comes back.')}</small>
          <button type="button" class="btn" data-pick="mine">${t('Keep this device’s data')}</button><small class="muted">${t('Replaces the server copy.')}</small>
          <button type="button" class="btn" data-pick="theirs">${t('Use the server’s data')}</button><small class="muted">${t('Replaces what is on this device.')}</small></div>`,
    });
    ctl.el.addEventListener('click', e => { const b = e.target.closest('[data-pick]'); if (b) { ctl.close(); resolve(b.dataset.pick); } });
  });
  async function conflict(remote) {
    paused = true; setState('conflict');
    let theirs, choice;
    try { theirs = await openState(remote.blob); choice = await ask(Merge.summary(S.state), Merge.summary(theirs), remote); } finally { paused = false; }
    const c = cfg();
    if (choice === 'theirs') return pullApply(remote, false);
    if (choice === 'merge') {
      applying = true;
      try { S.state = S.normalize(Merge.states(S.state, theirs)); S.version++; S.applySettings(); await S.persist(); } finally { applying = false; }
      S.emit();
    }
    c.version = remote.version; c.dirty = true; Auth.saveList();   // our version now builds on the server's
    return push();
  }

  /* ---------- scheduling ---------- */
  function schedulePush(ms = 2500) { clearTimeout(timers.push); timers.push = setTimeout(runPush, ms); }
  async function runPush() {
    if (!Y.enabled() || paused) return;
    if (busy) { again = true; return; }
    busy = true;
    try { await push(); retries = 0; } catch (e) { handleError(e); }
    finally { busy = false; if (again) { again = false; schedulePush(500); } }
  }
  function retry(ms) {
    clearTimeout(timers.retry); retries++;
    timers.retry = setTimeout(() => { if (Y.enabled()) Y.syncNow(true); }, ms || Math.min(120000, 5000 * Math.pow(2, Math.min(retries, 5))));
  }
  function handleError(e) {
    if (e instanceof NetError) { setState('offline'); retry(); return; }
    if (e && e.message === 'AUTH') { setState('auth'); return; }
    if (!(e instanceof UserError)) console.error(e);
    setState('error', e instanceof UserError ? e.message : ''); retry(60000);
  }
  /** Called after every local save. */
  Y.onLocalSave = () => {
    if (applying || !Y.enabled()) return;
    const c = cfg(); c.dirty = true; Auth.saveList();
    if (Y.state !== 'conflict') setState('pending');
    schedulePush();
  };
  S.onSaved = Y.onLocalSave;

  Y.start = async () => {
    Y.stop(true);
    if (!Y.enabled()) { setState('off'); return; }
    setState('connecting');
    try { await login(); await reconcile(); } catch (e) { handleError(e); }
    timers.poll = setInterval(check, 60000);
  };
  Y.stop = quiet => {
    clearTimeout(timers.push); clearTimeout(timers.retry); clearInterval(timers.poll);
    token = null; busy = false; again = false; paused = false; retries = 0;
    if (!quiet) setState('off');
  };
  Y.syncNow = async quiet => {
    if (!Y.enabled() || busy) return;
    busy = true; if (!quiet) setState('connecting');
    try { await S.persist(); await reconcile(); } catch (e) { handleError(e); } finally { busy = false; }
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  window.addEventListener('online', () => { if (Y.enabled()) Y.syncNow(true); });

  /* ---------- account on a server ---------- */
  Y.probe = async serverRaw => {
    const server = normUrl(serverRaw), r = await http(server, 'GET', '/api/info');
    if (r.status !== 200 || r.body.app !== 'ledgerly-server') throw new UserError(t('That address is not a Ledgerly server.'));
    return { server, ...r.body };
  };
  /** Start syncing the open profile: create its account on the server (or reconnect to one it already had). */
  Y.enable = async (serverRaw, username, invite) => {
    const p = Auth.profile;
    if (p.sync && p.sync.server) { p.sync.enabled = true; Auth.saveList(); await Y.start(); return; }
    const info = await Y.probe(serverRaw);
    username = Auth.normUser(username || p.username);
    if (!Auth.USER_RE.test(username)) throw new UserError(t('Usernames are 3 to 32 letters, numbers, dots, dashes or underscores.'));
    if (info.signup === 'closed') throw new UserError(t('This server is not accepting new accounts.'));
    if (!p.recAuthSealed) throw new UserError(t('Create a new recovery key first, then turn sync on.'));
    const recAuth = await Vault.open(Auth.dk, p.recAuthSealed);
    const r = await http(info.server, 'POST', '/api/register', { username, salt: p.salt, iter: p.iter, auth: Auth.secret, pwWrap: p.pwWrap, recAuth, recWrap: p.recWrap, blob: await seal(), invite: invite || undefined });
    if (r.status === 409) throw new UserError(t('That username is already taken on this server. If it is your account from another device, use “Sign in from another device” on the lock screen. Otherwise pick another username.'));
    if (r.status !== 201) throw serverError(r);
    p.sync = { server: info.server, username, version: r.body.version, lastSyncedAt: Date.now(), dirty: false, enabled: true };
    Auth.saveList(); try { localStorage.setItem('ledgerly:server', info.server); } catch (e) { /* ignore */ }
    await Y.start();
  };
  Y.disable = () => { const c = cfg(); if (c) { c.enabled = false; Auth.saveList(); } Y.stop(); };

  /** New device: sign in to an existing account (or reset its password with the recovery key) and build a local profile from it. */
  Y.join = async ({ server: raw, username, password, recovery, exists }) => {
    const info = await Y.probe(raw), server = info.server;
    username = Auth.normUser(username);
    if (!Auth.USER_RE.test(username)) throw new UserError(t('Usernames are 3 to 32 letters, numbers, dots, dashes or underscores.'));
    if (exists(username)) throw new UserError(t('A profile named {u} is already on this device. Unlock it instead.', { u: username }));
    const k = await http(server, 'GET', '/api/kdf?username=' + encodeURIComponent(username));
    if (k.status !== 200) throw serverError(k);
    let kek, auth;
    if (recovery) {
      const bytes = Vault.parseRecovery(recovery);
      if (!bytes) throw new UserError(t('A recovery key has 26 letters and numbers. Check it and try again.'));
      if (String(password || '').length < 8) throw new UserError(t('Use at least 8 characters for the password.'));
      const rc = await Vault.fromRecovery(bytes), f = await http(server, 'POST', '/api/recover/fetch', { username, recAuth: rc.auth });
      if (f.status !== 200) throw serverError(f);
      let dk0; try { dk0 = (await Vault.unlockWithRecovery(bytes, f.body.recWrap)).dk; } catch (e) { throw new UserError(t('That recovery key does not match this profile.')); }
      const re = await Vault.rewrap(password, dk0);
      const rr = await http(server, 'POST', '/api/recover/reset', { username, recAuth: rc.auth, newAuth: re.auth, salt: re.salt, iter: re.iter, pwWrap: re.pwWrap });
      if (rr.status !== 200) throw serverError(rr);
      kek = (await Vault.fromPassword(password, Vault.unb64(re.salt), re.iter)).kek; auth = re.auth;
    } else {
      ({ kek, auth } = await Vault.fromPassword(password, Vault.unb64(k.body.salt), k.body.iter));
    }
    const lg = await http(server, 'POST', '/api/login', { username, auth });
    if (lg.status !== 200) throw serverError(lg);
    let dk; try { dk = await Vault.open(kek, lg.body.pwWrap, true); } catch (e) { throw new UserError(t('Wrong username or password.')); }
    const d = await http(server, 'GET', '/api/data', null, lg.body.token);
    if (d.status !== 200) throw serverError(d);
    let state; try { state = S.normalize(JSON.parse(await Vault.open(dk, d.body.blob))); } catch (e) { throw new UserError(t('This profile’s data could not be read.')); }
    const p = { id: U.uid('p'), username, name: state.settings.name || username, color: K.PALETTE[Auth.profiles.length % K.PALETTE.length], salt: lg.body.salt, iter: lg.body.iter,
      pwWrap: lg.body.pwWrap, recWrap: lg.body.recWrap, createdAt: Date.now(), autoLock: 15,
      sync: { server, username, version: d.body.version, lastSyncedAt: Date.now(), dirty: false, enabled: true } };
    localStorage.setItem(K.KEY_DATA + p.id, await Vault.seal(dk, JSON.stringify(state)));
    try { localStorage.setItem('ledgerly:server', server); } catch (e) { /* ignore */ }
    return { p, dk, auth };
  };

  /** The password was changed on another device: sign in again with the new one. */
  Y.reauth = async password => {
    const c = cfg(), k = await http(c.server, 'GET', '/api/kdf?username=' + encodeURIComponent(c.username));
    if (k.status !== 200) throw serverError(k);
    const { kek, auth } = await Vault.fromPassword(password, Vault.unb64(k.body.salt), k.body.iter);
    const lg = await http(c.server, 'POST', '/api/login', { username: c.username, auth });
    if (lg.status !== 200) throw serverError(lg);
    try { await Vault.open(kek, lg.body.pwWrap, true); } catch (e) { throw new UserError(t('Wrong username or password.')); }
    Auth.setCredentials({ salt: lg.body.salt, iter: lg.body.iter, pwWrap: lg.body.pwWrap }, auth);
    await Y.start();
  };

  const need = async (method, path, body) => {
    let r;
    try { r = await call(method, path, body); } catch (e) { if (e instanceof NetError) throw new UserError(t('Connect to the internet to do this for a synced profile.')); throw e; }
    if (r.status !== 200) throw serverError(r);
    return r;
  };
  Y.changePassword = (curAuth, re) => need('POST', '/api/password', { auth: curAuth, newAuth: re.auth, salt: re.salt, iter: re.iter, pwWrap: re.pwWrap });
  Y.setRecovery = (curAuth, recAuth, recWrap) => need('POST', '/api/recovery', { auth: curAuth, recAuth, recWrap });
  Y.deleteRemote = async () => { await need('DELETE', '/api/account', { auth: Auth.secret }); };
  Y.recoverReset = async (p, recAuth, re) => {
    let r;
    try { r = await http(p.sync.server, 'POST', '/api/recover/reset', { username: p.sync.username, recAuth, newAuth: re.auth, salt: re.salt, iter: re.iter, pwWrap: re.pwWrap }); }
    catch (e) { if (e instanceof NetError) throw new UserError(t('Connect to the internet to reset the password of a synced profile.')); throw e; }
    if (r.status !== 200) throw serverError(r);
  };

  return Y;
})();
