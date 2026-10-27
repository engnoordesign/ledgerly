'use strict';
/* Profiles: several people (or several budgets) on one device, each behind its own password.
   A profile's data is encrypted in the browser with a key that only its password (or its recovery key) can open,
   so a locked profile is just ciphertext, even to someone who opens the browser's developer tools.
   Keys live in memory (and this tab's sessionStorage) only while a profile is unlocked. */
class UserError extends Error {}

const Auth = (() => {
  const X = { profiles: [], last: null, profile: null, dk: null, secret: null, prefs: {} };
  const { h } = U;
  const ls = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, del: k => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } } };
  const ss = { get: k => { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } }, del: k => { try { sessionStorage.removeItem(k); } catch (e) { /* ignore */ } } };
  const USER_RE = /^[\p{L}\p{N}][\p{L}\p{N}._-]{2,31}$/u;
  const normUser = s => String(s || '').normalize('NFKC').trim();
  /** @name that keeps its order inside right-to-left text. */
  X.at = u => U.raw('<bdi dir="ltr">@' + U.esc(u) + '</bdi>');
  X.iso = s => '\u2066' + s + '\u2069';
  X.USER_RE = USER_RE; X.normUser = normUser;

  /* ---------- profile list ---------- */
  const loadList = () => {
    try { const j = JSON.parse(ls.get(K.KEY_PROFILES) || '{}'); X.profiles = Array.isArray(j.list) ? j.list : []; X.last = j.last || null; } catch (e) { X.profiles = []; }
  };
  const saveList = () => {
    try { localStorage.setItem(K.KEY_PROFILES, JSON.stringify({ v: 1, list: X.profiles, last: X.last })); } catch (e) { if (S.onStorageError) S.onStorageError(e); }
  };
  X.saveList = saveList;
  const byId = id => X.profiles.find(p => p.id === id);
  const needPassword = pw => { if (String(pw || '').length < 8) throw new UserError(t('Use at least 8 characters for the password.')); };

  /* ---------- unlocked session ---------- */
  const writeSession = () => ss.set(K.KEY_SESSION, JSON.stringify({ pid: X.profile.id, dk: Vault.b64(X.dk), secret: X.secret }));
  const readSession = () => { try { return JSON.parse(ss.get(K.KEY_SESSION)); } catch (e) { return null; } };
  const saverFor = (p, dk) => async json => { localStorage.setItem(K.KEY_DATA + p.id, await Vault.seal(dk, json)); };

  async function enter(p, dk, secret) {
    const sealed = ls.get(K.KEY_DATA + p.id);
    let state = null;
    if (sealed) { try { state = S.normalize(JSON.parse(await Vault.open(dk, sealed))); } catch (e) { throw new UserError(t('This profile’s data could not be read.')); } }
    X.profile = p; X.dk = dk; X.secret = secret;
    S.attach(state || S.blank(), saverFor(p, dk));
    if (!sealed && !S.state.settings.name) S.state.settings.name = p.name;
    if (X.prefs.lang) S.state.settings.lang = X.prefs.lang;     // a language or theme picked on the lock screen carries over
    if (X.prefs.theme) S.state.settings.theme = X.prefs.theme;
    X.prefs = {};
    S.applySettings();
    X.last = p.id; saveList(); writeSession();
    if (!sealed) await S.persist();                             // a brand-new profile has its encrypted copy before the app opens
    hide(); touch(); startIdle();
    await App.afterUnlock();
  }
  X.enter = enter;

  X.login = async (p, password) => {
    let r;
    try { r = await Vault.unlock(password, p); } catch (e) { throw new UserError(t('Wrong password.')); }
    await enter(p, r.dk, r.auth);
  };

  X.create = async ({ name, username, password, adopt }) => {
    username = normUser(username); name = String(name || '').trim() || username;
    if (!USER_RE.test(username)) throw new UserError(t('Usernames are 3 to 32 letters, numbers, dots, dashes or underscores.'));
    if (X.profiles.some(p => p.username.toLowerCase() === username.toLowerCase())) throw new UserError(t('That username is already used on this device.'));
    needPassword(password);
    const acct = await Vault.createAccount(password);
    const p = { id: U.uid('p'), username, name, color: K.PALETTE[X.profiles.length % K.PALETTE.length], salt: acct.salt, iter: acct.iter, pwWrap: acct.pwWrap,
      recWrap: acct.recWrap, recAuthSealed: await Vault.seal(acct.dk, acct.recAuth), createdAt: Date.now(), autoLock: 15, sync: null };
    const legacy = adopt ? S.readLegacy() : null, first = legacy || S.blank();
    if (!first.settings.name) first.settings.name = name;
    localStorage.setItem(K.KEY_DATA + p.id, await Vault.seal(acct.dk, JSON.stringify(first)));
    X.profiles.push(p); saveList();
    return { p, dk: acct.dk, auth: acct.auth, text: Vault.formatRecovery(acct.recovery), adopted: !!legacy };
  };
  const dropLegacy = () => { ls.del(K.KEY); ls.del('ledgerly:v1:snapshot'); };

  /** Forgot password: the recovery key opens the same data key, then a new password wraps it again. */
  X.recover = async (p, recoveryText, newPassword) => {
    const bytes = Vault.parseRecovery(recoveryText);
    if (!bytes) throw new UserError(t('A recovery key has 26 letters and numbers. Check it and try again.'));
    needPassword(newPassword);
    let dk;
    try { dk = (await Vault.unlockWithRecovery(bytes, p.recWrap)).dk; } catch (e) { throw new UserError(t('That recovery key does not match this profile.')); }
    const re = await Vault.rewrap(newPassword, dk);
    if (p.sync && p.sync.enabled !== false) await Sync.recoverReset(p, (await Vault.fromRecovery(bytes)).auth, re);   // server first, so both always agree
    Object.assign(p, { salt: re.salt, iter: re.iter, pwWrap: re.pwWrap }); saveList();
    await enter(p, dk, re.auth);
  };

  const confirmCurrent = async password => { try { return await Vault.unlock(password, X.profile); } catch (e) { throw new UserError(t('The current password is wrong.')); } };
  X.changePassword = async (current, next) => {
    needPassword(next);
    const cur = await confirmCurrent(current), re = await Vault.rewrap(next, X.dk);
    if (Sync.enabled()) await Sync.changePassword(cur.auth, re);
    X.setCredentials(re, re.auth);
  };
  /** Store a profile's new password wrap and login secret (after a password change or a re-sign-in). */
  X.setCredentials = (re, secret) => {
    Object.assign(X.profile, { salt: re.salt, iter: re.iter, pwWrap: re.pwWrap }); X.secret = secret; saveList(); writeSession();
  };
  X.newRecoveryKey = async password => {
    const cur = await confirmCurrent(password), p = X.profile, rec = Vault.random(16), rc = await Vault.fromRecovery(rec);
    const recWrap = await Vault.seal(rc.kek, X.dk), recAuthSealed = await Vault.seal(X.dk, rc.auth);
    if (Sync.enabled()) await Sync.setRecovery(cur.auth, rc.auth, recWrap);
    p.recWrap = recWrap; p.recAuthSealed = recAuthSealed; saveList();
    return Vault.formatRecovery(rec);
  };
  X.rename = name => { const p = X.profile; p.name = String(name || '').trim() || p.username; saveList(); S.commit(st => { st.settings.name = p.name; }, { silent: false }); };
  X.setAutoLock = minutes => { X.profile.autoLock = minutes; saveList(); };
  X.remove = async (alsoServer) => {
    const p = X.profile;
    if (alsoServer && Sync.enabled()) await Sync.deleteRemote();
    await X.lock();
    ls.del(K.KEY_DATA + p.id);
    X.profiles = X.profiles.filter(x => x.id !== p.id); saveList();
    show('pick');
  };

  /* ---------- lock, idle ---------- */
  let lastActive = Date.now(), idleTimer = null;
  const touch = () => { lastActive = Date.now(); };
  ['pointerdown', 'keydown', 'touchstart', 'scroll'].forEach(ev => addEventListener(ev, touch, { passive: true, capture: true }));
  const startIdle = () => {
    clearInterval(idleTimer);
    idleTimer = setInterval(() => { const m = X.profile && X.profile.autoLock; if (m > 0 && Date.now() - lastActive > m * 60000) X.lock(); }, 10000);
  };
  X.lock = async () => {
    if (!X.profile) return;
    Sync.stop();
    try { await S.persist(); } catch (e) { /* surfaced by onStorageError */ }
    clearInterval(idleTimer); ss.del(K.KEY_SESSION);
    X.profile = X.dk = X.secret = null;
    S.detach();
    for (const id of ['view', 'sidebar', 'topbar', 'tabbar']) U.$('#' + id).innerHTML = '';   // nothing financial stays in the page
    UI.closeAll(); U.$('#app').hidden = true;
    show(X.profiles.length ? 'pick' : 'create');
  };
  // another tab changed this profile's data: pick up its version
  window.addEventListener('storage', async e => {
    if (!X.profile) return;
    if (e.key === K.KEY_PROFILES) { loadList(); if (!byId(X.profile.id)) X.lock(); else X.profile = byId(X.profile.id); return; }
    if (e.key === K.KEY_DATA + X.profile.id && e.newValue) {
      try { S.state = S.normalize(JSON.parse(await Vault.open(X.dk, e.newValue))); S.version++; S.applySettings(); S.emit(); } catch (err) { /* ignore */ }
    }
  });

  /* ---------- start ---------- */
  X.start = async () => {
    applyDeviceUi();
    if (!Vault.available()) return show('nocrypto');
    loadList();
    const s = readSession(), p = s && byId(s.pid);
    if (p) { try { await enter(p, Vault.unb64(s.dk), s.secret); return; } catch (e) { ss.del(K.KEY_SESSION); } }
    show(X.profiles.length ? 'pick' : 'create');
  };

  /* ---------- lock screen ---------- */
  const mount = () => U.$('#auth');
  let ui = { view: 'pick', ctx: {}, busy: false };
  const dark = () => { const th = document.documentElement.dataset.theme; return th === 'dark' || (!th && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches); };
  function applyDeviceUi() {
    const lang = ls.get(K.KEY_LANG) === 'ar' ? 'ar' : 'en', theme = ls.get(K.KEY_THEME);
    I18N.set(lang); U.setDateLocale(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US');
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme; else document.documentElement.removeAttribute('data-theme');
  }
  const avatar = (p, size = 56) => h`<span class="avatar" style="--c:${p.color};--s:${size}px">${U.initials(p.name).slice(0, 1)}</span>`;
  const pw = (id, name, auto, focus) => h`<div class="pw"><input type="password" id="${id}" name="${name}" autocomplete="${auto}" ${focus ? 'autofocus' : ''} required>
    <button type="button" class="btn icon ghost sm" data-act="auth:peek" data-for="${id}" aria-label="${t('Show or hide the password')}">${UI.icon('eye', 16)}</button></div>`;
  const links = (...l) => h`<div class="auth-links">${l}</div>`;
  const link = (act, label, extra = '') => h`<button type="button" class="link" data-act="${act}" ${extra ? U.raw(extra) : ''}>${label}</button>`;
  const err = () => h`<div class="form-error" role="alert" hidden></div>`;
  const defaultServer = () => ls.get('ledgerly:server') || (/^https?:$/.test(location.protocol) ? location.origin : '');

  const views = {
    nocrypto: () => h`<div class="keyscreen">${UI.icon('lock', 28)}<h1>${t('Encryption is not available here')}</h1>
      <p class="sub">${t('Your browser only turns on encryption for secure pages. Open Ledgerly from its desktop icon, from an https:// address, or from http://localhost.')}</p></div>`,

    pick: () => h`<h1>${t('Who is using Ledgerly?')}</h1><p class="sub">${t('Choose a profile to unlock it. Each profile has its own password and its own data.')}</p>
      <div class="profile-grid">${X.profiles.map(p => h`<button type="button" class="ptile" data-act="auth:select" data-id="${p.id}">${avatar(p, 60)}<b>${p.name}</b><small>${X.at(p.username)}</small>${p.sync && p.sync.enabled !== false ? h`<span class="pill info">${t('Synced')}</span>` : ''}</button>`)}
        <button type="button" class="ptile add" data-act="auth:new"><span class="avatar plus" style="--s:60px">${UI.icon('plus', 24)}</span><b>${t('Add profile')}</b></button></div>
      ${links(link('auth:server', `${t('Sign in from another device')}`))}`,

    login: () => { const p = ui.ctx.p; return h`<form id="auf" data-submit="auth:login" novalidate>${avatar(p, 76)}<h1>${p.name}</h1><p class="sub">${X.at(p.username)}</p>
      <div class="field"><label for="au-pass">${t('Password')}</label>${pw('au-pass', 'password', 'current-password', true)}</div>${err()}
      <button class="btn primary wide" type="submit">${UI.icon('lock', 16)}<span>${t('Unlock')}</span></button>
      ${links(link('auth:forgot', t('Forgot password?'), `data-id="${p.id}"`), link('auth:back', t('Switch profile')))}</form>`; },

    create: () => { const first = !X.profiles.length, legacy = S.readLegacy(); return h`<form id="auf" data-submit="auth:create" novalidate>
      <h1>${first ? t('Create your profile') : t('Add a profile')}</h1>
      <p class="sub">${first ? t('Your profile has its own password. Everything is encrypted in this browser.') : t('A new profile starts empty and has its own password.')}</p>
      ${legacy ? h`<div class="notice ok">${UI.icon('check', 15)}<label class="check"><input type="checkbox" name="adopt" checked><span>${t('Keep the data already on this device in this profile ({n}).', { n: U.plural(legacy.transactions.length, 'transaction') })}</span></label></div>` : ''}
      <div class="row2"><div class="field"><label for="au-name">${t('Your name')}</label><input id="au-name" name="name" autocomplete="name" ${legacy && legacy.settings.name ? h`value="${legacy.settings.name}"` : ''}></div>
        <div class="field"><label for="au-user">${t('Username')}</label><input id="au-user" name="username" autocomplete="username" autocapitalize="off" spellcheck="false" required></div></div>
      <div class="field"><label for="au-pass">${t('Password')}</label><div class="pw"><input type="password" id="au-pass" name="password" autocomplete="new-password" data-input="auth:strength" required>
        <button type="button" class="btn icon ghost sm" data-act="auth:peek" data-for="au-pass" aria-label="${t('Show or hide the password')}">${UI.icon('eye', 16)}</button></div>
        <div class="strength" id="au-str" data-s="0"><i></i><i></i><i></i><i></i><span>${t('At least 8 characters')}</span></div></div>
      <div class="field"><label for="au-pass2">${t('Confirm password')}</label>${pw('au-pass2', 'password2', 'new-password')}</div>
      <p class="muted small">${t('Nobody can read your data without the password, not even us. You will get a recovery key on the next screen.')}</p>${err()}
      <button class="btn primary wide" type="submit">${t('Create profile')}</button>
      ${links(X.profiles.length ? link('auth:back', t('Back')) : '', link('auth:server', t('Sign in from another device')))}</form>`; },

    key: () => h`<div class="keyscreen">${UI.icon('key', 28)}<h1>${t('Save your recovery key')}</h1>
      <p class="sub">${t('If you forget your password, this key is the only way back into your data. Write it down or save it somewhere safe. It is shown only once.')}</p>
      <div class="keybox num" id="au-key" dir="ltr">${ui.ctx.text}</div>
      <div class="key-actions"><button type="button" class="btn" data-act="auth:copykey">${UI.icon('copy', 16)}${t('Copy')}</button><button type="button" class="btn" data-act="auth:savekey">${UI.icon('download', 16)}${t('Save as file')}</button></div>
      <label class="check"><input type="checkbox" id="au-saved" data-change="auth:saved"><span>${t('I have saved my recovery key')}</span></label>
      <button type="button" class="btn primary wide" id="au-continue" data-act="auth:continue" disabled>${t('Continue')}</button></div>`,

    forgot: () => { const p = ui.ctx.p; return h`<form id="auf" data-submit="auth:reset" novalidate>${avatar(p, 60)}<h1>${t('Reset your password')}</h1>
      <p class="sub">${t('Enter the recovery key you saved when you created {user}, then choose a new password.', { user: X.iso('@' + p.username) })}</p>
      <div class="field"><label for="au-rec">${t('Recovery key')}</label><input id="au-rec" name="recovery" class="num" dir="ltr" autocomplete="off" spellcheck="false" placeholder="ABCD-EFGH-IJKL-MNPQ-RSTV-WX" autofocus required></div>
      <div class="field"><label for="au-pass">${t('New password')}</label>${pw('au-pass', 'password', 'new-password')}</div>
      <div class="field"><label for="au-pass2">${t('Confirm password')}</label>${pw('au-pass2', 'password2', 'new-password')}</div>${err()}
      <button class="btn primary wide" type="submit">${t('Reset password')}</button>${links(link('auth:select', t('Back'), `data-id="${p.id}"`))}</form>`; },

    server: () => { const f = !!ui.ctx.forgot; return h`<form id="auf" data-submit="auth:server-go" novalidate>${UI.icon('cloud', 28)}<h1>${t('Sign in from another device')}</h1>
      <p class="sub">${f ? t('Use your recovery key to set a new password for your account on the server.') : t('Use the account you set up on a Ledgerly server. Your data is downloaded here and decrypted with your password.')}</p>
      <div class="field"><label for="au-srv">${t('Server address')}</label><input id="au-srv" name="server" dir="ltr" value="${ui.ctx.server || defaultServer()}" placeholder="https://ledgerly.example.com" autocapitalize="off" spellcheck="false" required></div>
      <div class="field"><label for="au-user">${t('Username')}</label><input id="au-user" name="username" autocomplete="username" autocapitalize="off" spellcheck="false" required></div>
      ${f ? h`<div class="field"><label for="au-rec">${t('Recovery key')}</label><input id="au-rec" name="recovery" class="num" dir="ltr" autocomplete="off" spellcheck="false" placeholder="ABCD-EFGH-IJKL-MNPQ-RSTV-WX" required></div>
        <div class="field"><label for="au-pass">${t('New password')}</label>${pw('au-pass', 'password', 'new-password')}</div>`
        : h`<div class="field"><label for="au-pass">${t('Password')}</label>${pw('au-pass', 'password', 'current-password')}</div>`}${err()}
      <button class="btn primary wide" type="submit">${UI.icon('cloud', 16)}<span>${f ? t('Reset and sign in') : t('Sign in')}</span></button>
      ${links(link('auth:server-toggle', f ? t('Use my password instead') : t('Forgot password?')), X.profiles.length ? link('auth:back', t('Back')) : '')}</form>`; },
  };

  function draw() {
    const el = mount(), keep = {};
    for (const f of U.$$('#auth input[name]')) if (f.type !== 'checkbox') keep[f.name] = f.value; else keep['#' + f.name] = f.checked;
    el.hidden = false; document.body.classList.add('locked');
    el.innerHTML = String(h`<div class="auth-scroll"><div class="auth-card"><div class="auth-brand">${UI.logo(44)}<b>Ledgerly</b></div>${views[ui.view]()}</div>
      <div class="auth-foot"><button type="button" class="btn ghost sm" data-act="auth:lang">${I18N.lang === 'ar' ? 'English' : 'العربية'}</button>
        <button type="button" class="btn ghost icon sm" data-act="auth:theme" aria-label="${dark() ? t('Switch to light mode') : t('Switch to dark mode')}">${UI.icon(dark() ? 'sun' : 'moon', 16)}</button></div></div>`);
    for (const f of U.$$('#auth input[name]')) { if (f.type === 'checkbox') { if (('#' + f.name) in keep) f.checked = keep['#' + f.name]; } else if (f.name in keep && f.type !== 'password') f.value = keep[f.name]; }
    U.$('#app').hidden = true;
    const first = U.$('#auth [autofocus]') || U.$('#auth input:not([type=checkbox]):not([type=hidden])');
    if (first) setTimeout(() => first.focus({ preventScroll: true }), 30);
  }
  function show(view, ctx = {}) { ui = { view, ctx, busy: false }; draw(); }
  function hide() { const el = mount(); el.hidden = true; el.innerHTML = ''; document.body.classList.remove('locked'); U.$('#app').hidden = false; }
  X.show = show;

  /** Run an async form action with a busy state and tidy error messages. */
  async function work(form, fn) {
    if (ui.busy) return; ui.busy = true;
    const btn = U.$('button[type=submit]', form), label = btn && btn.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = `<span>${U.esc(t('Working…'))}</span>`; }
    UI.formError(form, '');
    try { await fn(); }
    catch (e) {
      if (!(e instanceof UserError)) console.error(e);
      UI.formError(form, e instanceof UserError ? e.message : (e.message === 'NETWORK' ? t('Cannot reach the server. Check the address and your connection.') : t('Something went wrong. Please try again.')));
      if (btn) { btn.disabled = false; btn.innerHTML = label; }
    } finally { ui.busy = false; }
  }
  const fails = {};
  const waitLeft = p => Math.max(0, Math.ceil((((fails[p.id] || {}).until || 0) - Date.now()) / 1000));

  App.on('auth:select', el => { const p = byId(el.dataset.id); if (p) show('login', { p }); });
  App.on('auth:back', () => show(X.profiles.length ? 'pick' : 'create'));
  App.on('auth:new', () => show('create'));
  App.on('auth:forgot', el => show('forgot', { p: byId(el.dataset.id) }));
  App.on('auth:server', () => show('server', {}));
  App.on('auth:server-toggle', () => show('server', { forgot: !ui.ctx.forgot, server: (U.$('#au-srv') || {}).value }));
  App.on('auth:peek', el => { const i = U.$('#' + el.dataset.for); i.type = i.type === 'password' ? 'text' : 'password'; i.focus(); });
  App.on('auth:lang', () => {
    const lang = I18N.lang === 'ar' ? 'en' : 'ar';
    try { localStorage.setItem(K.KEY_LANG, lang); } catch (e) { /* ignore */ }
    X.prefs.lang = lang; applyDeviceUi(); draw();
  });
  App.on('auth:theme', () => {
    const th = dark() ? 'light' : 'dark';
    try { localStorage.setItem(K.KEY_THEME, th); } catch (e) { /* ignore */ }
    X.prefs.theme = th; applyDeviceUi(); draw();
  });
  App.onInput('auth:strength', el => {
    const s = Vault.strength(el.value), bar = U.$('#au-str');
    bar.dataset.s = s; bar.lastElementChild.textContent = [t('At least 8 characters'), t('Weak'), t('Fair'), t('Good'), t('Strong')][s];
  });

  App.onSubmit('auth:login', (form) => work(form, async () => {
    const p = ui.ctx.p, wait = waitLeft(p);
    if (wait) throw new UserError(t('Too many tries. Wait {n} seconds.', { n: wait }));
    try { await X.login(p, form.elements.password.value); delete fails[p.id]; }
    catch (e) {
      if (e instanceof UserError && e.message === t('Wrong password.')) { const f = fails[p.id] = fails[p.id] || { n: 0 }; f.n++; if (f.n >= 5) f.until = Date.now() + Math.min(60, Math.pow(2, f.n - 4)) * 1000; }
      throw e;
    }
  }));

  App.onSubmit('auth:create', form => work(form, async () => {
    const d = form.elements;
    if (d.password.value !== d.password2.value) throw new UserError(t('The two passwords do not match.'));
    const r = await X.create({ name: d.name.value, username: d.username.value, password: d.password.value, adopt: d.adopt ? d.adopt.checked : false });
    show('key', r);
  }));
  App.on('auth:copykey', async el => {
    try { await navigator.clipboard.writeText(ui.ctx.text); UI.toast(t('Copied.')); }
    catch (e) { const r = document.createRange(); r.selectNodeContents(U.$('#au-key')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); UI.toast(t('Select the key and copy it.')); }
  });
  App.on('auth:savekey', () => {
    const p = ui.ctx.p;
    U.download(`ledgerly-recovery-key-${p.username}.txt`, `Ledgerly recovery key for @${p.username}\r\n\r\n${ui.ctx.text}\r\n\r\nKeep this file private. Anyone with it and your username can reset your password.\r\n`);
  });
  App.onChange('auth:saved', el => { U.$('#au-continue').disabled = !el.checked; });
  App.on('auth:continue', async el => {
    el.disabled = true;
    const r = ui.ctx;
    try { await enter(r.p, r.dk, r.auth); if (r.adopted) dropLegacy(); }
    catch (e) { el.disabled = false; UI.toast(e instanceof UserError ? e.message : t('Something went wrong. Please try again.'), { kind: 'warn' }); }
  });

  App.onSubmit('auth:reset', form => work(form, async () => {
    const d = form.elements;
    if (d.password.value !== d.password2.value) throw new UserError(t('The two passwords do not match.'));
    await X.recover(ui.ctx.p, d.recovery.value, d.password.value);
  }));

  App.onSubmit('auth:server-go', form => work(form, async () => {
    const d = form.elements, forgot = !!ui.ctx.forgot;
    const j = await Sync.join({ server: d.server.value, username: d.username.value, password: d.password.value, recovery: forgot ? d.recovery.value : null,
      exists: n => X.profiles.some(p => p.username.toLowerCase() === n.toLowerCase()) });
    X.profiles.push(j.p); saveList();
    await enter(j.p, j.dk, j.auth);
  }));

  return X;
})();
