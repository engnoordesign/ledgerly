'use strict';
/* Profile menu, "Profile and security" and "Sync across devices" (shown on the Settings page). */
const AccountView = (() => {
  const V = {};
  const { h } = U;
  const prof = () => Auth.profile;
  const avatar = (p, size) => h`<span class="avatar" style="--c:${p.color};--s:${size}px">${U.initials(p.name).slice(0, 1)}</span>`;
  const dot = () => h`<i class="sdot ${Sync.state}"></i>`;
  const defaultServer = () => { try { return localStorage.getItem('ledgerly:server') || ''; } catch (e) { return ''; } } ;
  const guessServer = () => defaultServer() || (/^https?:$/.test(location.protocol) ? location.origin : '');
  const when = ms => ms ? new Date(ms).toLocaleString(I18N.lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

  /* ---------- sidebar / header ---------- */
  V.chip = () => {
    const p = prof();
    return h`<button type="button" class="profile-chip" data-act="acct:menu" aria-label="${t('Profile menu')}">${avatar(p, 32)}
      <span class="pc-t"><b>${p.name}</b><small>${Sync.enabled() ? h`${dot()}${Sync.label()}` : t('This device only')}</small></span></button>`;
  };
  V.topButton = () => { const p = prof(); return h`<button type="button" class="btn ghost icon" data-act="acct:menu" aria-label="${t('Profile menu')}">${avatar(p, 28)}</button>`; };

  App.on('acct:menu', () => {
    const p = prof();
    UI.modal({
      title: t('Profile'), size: 'sm',
      body: h`<div class="pmenu"><div class="pm-head">${avatar(p, 52)}<div><b>${p.name}</b><small class="muted">${Auth.at(p.username)}</small></div></div>
        <div class="pm-sync">${Sync.enabled() ? h`${dot()}<span>${Sync.label()}</span>` : h`<span class="muted">${t('Your data stays on this device.')}</span>`}</div>
        <button type="button" class="btn wide" data-act="acct:lock">${UI.icon('lock', 16)}<span>${p.remember ? t('Sign out') : t('Lock now')}</span></button>
        <button type="button" class="btn wide" data-act="acct:switch">${UI.icon('users', 16)}<span>${t('Switch profile')}</span></button>
        <a class="btn wide" href="#/settings" data-close>${UI.icon('settings', 16)}<span>${t('Profile and security')}</span></a></div>`,
    });
  });
  App.on('acct:lock', () => { UI.closeAll(); Auth.lock(); });
  App.on('acct:switch', () => { UI.closeAll(); Auth.lock({ forget: false }); });
  App.onChange('acct:remember', async el => {
    try {
      if (el.checked) { await Auth.remember(); UI.toast(t('This device will stay signed in.')); }
      else { Auth.forget(); UI.toast(t('This device will ask for the password again.')); }
    } catch (e) { Auth.forget(); UI.toast(t('This browser could not keep you signed in.'), { kind: 'warn' }); }
    App.render();
  });

  /* ---------- settings cards ---------- */
  const profileBody = () => {
    const p = prof(), al = p.autoLock == null ? 15 : p.autoLock;
    return h`<div class="acct-head">${avatar(p, 56)}<div><b>${p.name}</b><span class="muted">${Auth.at(p.username)}</span></div></div>
      <div class="form-grid">
        <div class="field"><label for="pf-name">${t('Display name')}</label><input id="pf-name" data-change="acct:rename" value="${p.name}" autocomplete="off"></div>
        <div class="field"><label for="pf-lock">${t('Lock automatically after')}</label>
          <select id="pf-lock" data-change="acct:autolock" ${p.remember ? 'disabled' : ''}>${UI.options([[0, t('Never')], ...[1, 5, 15, 30, 60].map(n => [n, U.plural(n, 'minute')])], al)}</select>
          <small class="muted">${p.remember ? t('Auto-lock is off while this device stays signed in.') : t('Reopening the profile needs its password.')}</small></div>
        <div class="field stay-field"><label class="check"><input type="checkbox" id="pf-stay" data-change="acct:remember" ${p.remember ? 'checked' : ''} ${Auth.canRemember() ? '' : 'disabled'}><span>${t('Stay signed in on this device')}</span></label>
          <small class="muted">${t('Anyone who can open Ledgerly on this device can see this profile. Turn it off on shared or public computers.')}</small></div>
      </div>
      <div class="stack-btns">
        <button type="button" class="btn" data-act="acct:lock">${UI.icon('lock', 16)}${p.remember ? t('Sign out') : t('Lock now')}</button>
        <button type="button" class="btn" data-act="acct:pw">${UI.icon('key', 16)}${t('Change password')}</button>
        <button type="button" class="btn" data-act="acct:newkey">${UI.icon('shield', 16)}${t('New recovery key')}</button>
        <button type="button" class="btn danger ghost" data-act="acct:delete">${UI.icon('trash', 16)}${t('Delete this profile')}</button></div>`;
  };
  const syncBody = () => {
    const c = Sync.cfg(), on = Sync.enabled();
    if (on) {
      return h`<div class="sync-row">${dot()}<b>${Sync.label()}</b>${Sync.detail ? h`<span class="muted">${Sync.detail}</span>` : ''}</div>
        <dl class="a-meta"><div><dt>${t('Server')}</dt><dd class="num" dir="ltr">${c.server}</dd></div><div><dt>${t('Account')}</dt><dd>${Auth.at(c.username)}</dd></div><div><dt>${t('Last synced')}</dt><dd>${when(c.lastSyncedAt)}</dd></div></dl>
        ${Sync.state === 'auth' ? h`<div class="notice warn">${UI.icon('alert', 15)}<span>${t('The password for this account was changed on another device. Sign in again to keep syncing.')}</span><button type="button" class="btn sm" data-act="acct:reauth">${t('Sign in again')}</button></div>` : ''}
        <div class="stack-btns"><button type="button" class="btn" data-act="acct:syncnow">${UI.icon('repeat', 16)}${t('Sync now')}</button><button type="button" class="btn danger ghost" data-act="acct:syncoff">${t('Turn off sync')}</button></div>`;
    }
    return h`<p class="muted">${c && c.server ? t('Sync is off for this profile. Your data stays on this device until you turn it back on.')
      : t('Keep this profile up to date on every device. Your data is encrypted before it leaves this device, so the server only ever holds scrambled data.')}</p>
      ${c && c.server ? h`<div class="stack-btns"><button type="button" class="btn primary" data-act="acct:syncagain">${t('Turn sync back on')}</button></div>` : h`
      <form id="syncf" data-submit="acct:syncon" novalidate>
        <div class="form-grid">
          <div class="field"><label for="sy-srv">${t('Server address')}</label><input id="sy-srv" name="server" dir="ltr" value="${guessServer()}" placeholder="https://ledgerly.example.com" autocapitalize="off" spellcheck="false" required></div>
          <div class="field"><label for="sy-user">${t('Server username')}</label><input id="sy-user" name="username" value="${prof().username}" autocapitalize="off" spellcheck="false" required></div>
          <div class="field"><label for="sy-inv">${t('Invite code')}</label><input id="sy-inv" name="invite" autocomplete="off" placeholder="${t('Only if the server asks for one')}"></div></div>
        <div class="form-error" role="alert" hidden></div>
        <div class="stack-btns"><button type="submit" class="btn primary">${UI.icon('cloud', 16)}<span>${t('Turn on sync')}</span></button></div></form>`}`;
  };
  V.cards = () => h`${UI.card(t('Profile and security'), profileBody(), { cls: 's12' })}${UI.card(t('Sync across devices'), syncBody(), { cls: 's12' })}`;

  App.onChange('acct:rename', el => { if (el.value.trim()) Auth.rename(el.value); });
  App.onChange('acct:autolock', el => Auth.setAutoLock(+el.value));

  /** Run an async form action with a busy button and a visible error. */
  const work = async (form, fn) => {
    const btn = U.$('button[type=submit]', form), label = btn && btn.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = `<span>${U.esc(t('Working…'))}</span>`; }
    UI.formError(form, '');
    try { await fn(); return true; }
    catch (e) {
      if (!(e instanceof UserError)) console.error(e);
      UI.formError(form, e instanceof UserError ? e.message : e.message === 'NETWORK' ? t('Cannot reach the server. Check the address and your connection.') : t('Something went wrong. Please try again.'));
      if (btn) { btn.disabled = false; btn.innerHTML = label; }
      return false;
    }
  };
  const pwField = (id, name, label, auto) => h`<div class="field"><label for="${id}">${label}</label><input type="password" id="${id}" name="${name}" autocomplete="${auto}" required></div>`;

  /* ---------- change password ---------- */
  App.on('acct:pw', () => {
    const ctl = UI.modal({
      title: t('Change password'), size: 'sm',
      body: h`<form id="pwf" data-submit="acct:pw-go" novalidate>${pwField('pw-cur', 'current', t('Current password'), 'current-password')}${pwField('pw-new', 'next', t('New password'), 'new-password')}${pwField('pw-new2', 'next2', t('Confirm new password'), 'new-password')}
        <p class="muted small">${t('Your data is not re-encrypted. Your recovery key keeps working.')}</p><div class="form-error" role="alert" hidden></div></form>`,
      footer: h`<button type="button" class="btn" data-close>${t('Cancel')}</button><button type="submit" form="pwf" class="btn primary">${t('Change password')}</button>`,
    });
    V.ctl = ctl;
  });
  App.onSubmit('acct:pw-go', form => work(form, async () => {
    const d = form.elements;
    if (d.next.value !== d.next2.value) throw new UserError(t('The two passwords do not match.'));
    await Auth.changePassword(d.current.value, d.next.value);
    V.ctl.close(); UI.toast(t('Password changed.'));
  }));

  /* ---------- new recovery key ---------- */
  App.on('acct:newkey', () => {
    V.ctl = UI.modal({
      title: t('New recovery key'), size: 'sm',
      body: h`<form id="rkf" data-submit="acct:newkey-go" novalidate><p class="muted">${t('This replaces your old recovery key. The old one will stop working. Enter your password to continue.')}</p>
        ${pwField('rk-pw', 'password', t('Password'), 'current-password')}<div class="form-error" role="alert" hidden></div></form>`,
      footer: h`<button type="button" class="btn" data-close>${t('Cancel')}</button><button type="submit" form="rkf" class="btn primary">${t('Create new key')}</button>`,
    });
  });
  App.onSubmit('acct:newkey-go', form => work(form, async () => {
    const text = await Auth.newRecoveryKey(form.elements.password.value);
    V.key = text;
    const body = V.ctl.body;
    body.innerHTML = String(h`<div class="keyscreen small"><p class="muted">${t('Save this key now. It is shown only once.')}</p><div class="keybox num" id="rk-key" dir="ltr">${text}</div>
      <div class="key-actions"><button type="button" class="btn" data-act="acct:copykey">${UI.icon('copy', 16)}${t('Copy')}</button><button type="button" class="btn" data-act="acct:savekey">${UI.icon('download', 16)}${t('Save as file')}</button></div></div>`);
    U.$('.m-foot', V.ctl.el).innerHTML = String(h`<button type="button" class="btn primary" data-close>${t('Done')}</button>`);
  }));
  App.on('acct:copykey', async () => { try { await navigator.clipboard.writeText(V.key); UI.toast(t('Copied.')); } catch (e) { UI.toast(t('Select the key and copy it.')); } });
  App.on('acct:savekey', () => U.download(`ledgerly-recovery-key-${prof().username}.txt`, `Ledgerly recovery key for @${prof().username}\r\n\r\n${V.key}\r\n\r\nKeep this file private. Anyone with it and your username can reset your password.\r\n`));

  /* ---------- delete profile ---------- */
  App.on('acct:delete', () => {
    const p = prof();
    V.ctl = UI.modal({
      title: t('Delete this profile?'), size: 'sm',
      body: h`<form id="delf" data-submit="acct:delete-go" novalidate><p class="muted">${t('All of this profile’s data on this device will be erased. Download a backup first if you might want it back.')}</p>
        ${Sync.enabled() ? h`<label class="check"><input type="checkbox" name="remote"><span>${t('Also delete the account and its data on the server')}</span></label>` : ''}
        <div class="field"><label for="del-in">${t('Type {word} to confirm', { word: p.username })}</label><input id="del-in" name="confirm" autocomplete="off" autocapitalize="off"></div><div class="form-error" role="alert" hidden></div></form>`,
      footer: h`<button type="button" class="btn" data-close>${t('Cancel')}</button><button type="submit" form="delf" class="btn danger">${t('Delete this profile')}</button>`,
    });
  });
  App.onSubmit('acct:delete-go', form => work(form, async () => {
    if (form.elements.confirm.value.trim().toLowerCase() !== prof().username.toLowerCase()) throw new UserError(t('That does not match the username.'));
    const remote = !!(form.elements.remote && form.elements.remote.checked);
    V.ctl.close(); await Auth.remove(remote);
  }));

  /* ---------- sync ---------- */
  App.onSubmit('acct:syncon', form => work(form, async () => {
    const d = form.elements;
    await Sync.enable(d.server.value, d.username.value, d.invite.value.trim());
    UI.toast(t('Sync is on.'));
  }));
  App.on('acct:syncagain', async () => { try { await Sync.enable(); UI.toast(t('Sync is on.')); } catch (e) { UI.toast(e instanceof UserError ? e.message : t('Something went wrong. Please try again.'), { kind: 'warn' }); } });
  App.on('acct:syncnow', () => Sync.syncNow());
  App.on('acct:syncoff', async () => {
    if (await UI.confirm({ title: t('Turn off sync?'), message: t('This device will stop sending and receiving changes. Your data on the server stays where it is.'), confirm: t('Turn off sync') })) { Sync.disable(); UI.toast(t('Sync is off.')); }
  });
  App.on('acct:reauth', () => {
    V.ctl = UI.modal({
      title: t('Sign in again'), size: 'sm',
      body: h`<form id="raf" data-submit="acct:reauth-go" novalidate><p class="muted">${t('Enter the new password for {user}.', { user: Auth.iso('@' + Sync.cfg().username) })}</p>${pwField('ra-pw', 'password', t('Password'), 'current-password')}<div class="form-error" role="alert" hidden></div></form>`,
      footer: h`<button type="button" class="btn" data-close>${t('Cancel')}</button><button type="submit" form="raf" class="btn primary">${t('Sign in')}</button>`,
    });
  });
  App.onSubmit('acct:reauth-go', form => work(form, async () => { await Sync.reauth(form.elements.password.value); V.ctl.close(); UI.toast(t('Sync is on.')); }));

  Sync.onChange = () => { if (Auth.profile) { App.refreshChrome(); if (App.route().name === 'settings') App.render(); } };

  return V;
})();
