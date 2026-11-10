'use strict';
/* App shell: routing, navigation chrome, global events, boot. */
(() => {
  const { h } = U;
  // main pages first; the rest sit under "More" so the everyday screens stay simple
  const NAV = () => [
    ['dashboard', 'grid', t('Home')], ['transactions', 'receipt', t('Transactions')], ['stats', 'chart', t('Statistics')], ['budget', 'pie', t('Budget')],
    ['data', 'download', t('Import & Export')], ['settings', 'settings', t('Settings')],
  ];
  const MORE = () => [['scheduled', 'repeat', t('Scheduled')], ['plans', 'sparkles', t('Plans')]];
  const ALL = () => [...NAV(), ...MORE()];
  const sideMore = () => { try { return localStorage.getItem('ledgerly:side-more') === '1'; } catch (e) { return false; } };

  App.route = () => {
    const [path, qs] = location.hash.replace(/^#\/?/, '').split('?');
    return { name: App.views[path] ? path : 'dashboard', params: new URLSearchParams(qs || '') };
  };
  const effectiveDark = () => {
    const th = S.state.settings.theme;
    return th === 'dark' || (th === 'system' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  };

  /* ---------- chrome ---------- */
  const renderShell = name => {
    if (!S.state) return;
    const link = (k, ic, l) => h`<a href="#/${k}" class="${k === name ? 'on' : ''}" ${k === name ? 'aria-current="page"' : ''}>${UI.icon(ic, 19)}<span>${l}</span></a>`;
    const nav = NAV(), more = MORE(), s = S.state.settings, meta = S.state.meta, inMore = more.some(m => m[0] === name);
    const backupAge = meta.lastBackup ? U.diffDays(meta.lastBackup, U.today()) : null;
    const nudge = !S.state.transactions.length ? '' : meta.demo
      ? h`<a class="nudge" href="#/settings">${UI.icon('sparkles', 14)}<span>${t('Sample data')}</span></a>`
      : (backupAge == null || backupAge > 30) ? h`<a class="nudge warn" href="#/settings">${UI.icon('download', 14)}<span>${t('Back up your data')}</span></a>` : '';
    U.$('#sidebar').innerHTML = String(h`
      <a class="brand" href="#/dashboard" aria-label="Ledgerly"><svg class="logo" width="30" height="30" aria-hidden="true"><use href="#logo"/></svg><span>Ledgerly</span></a>
      <nav aria-label="${t('Main')}">${nav.slice(0, -1).map(([k, ic, l]) => link(k, ic, l))}
        <details class="side-more" data-side-more ${inMore || sideMore() ? 'open' : ''}><summary>${UI.icon('menu', 19)}<span>${t('More')}</span></summary>${more.map(([k, ic, l]) => link(k, ic, l))}</details>
        ${link(...nav[nav.length - 1])}</nav>
      <div class="side-foot">${nudge}${AccountView.chip()}
        <div class="toggles"><button class="btn icon ghost side" data-act="set:lang" data-v="${s.lang === 'ar' ? 'en' : 'ar'}" data-tip="${s.lang === 'ar' ? 'English' : 'العربية'}" aria-label="${s.lang === 'ar' ? 'English' : 'العربية'}"><b>${s.lang === 'ar' ? 'EN' : 'ع'}</b></button>
          <button class="btn icon ghost side" data-act="app:theme" data-tip="${effectiveDark() ? t('Switch to light mode') : t('Switch to dark mode')}" aria-label="${effectiveDark() ? t('Switch to light mode') : t('Switch to dark mode')}">${UI.icon(effectiveDark() ? 'sun' : 'moon', 18)}</button></div></div>`);
    U.$('#topbar').innerHTML = String(h`
      <a class="brand sm" href="#/dashboard" aria-label="Ledgerly"><svg class="logo" width="28" height="28" aria-hidden="true"><use href="#logo"/></svg><span>Ledgerly</span></a>
      <div class="top-actions">${AccountView.topButton()}
        <button class="btn ghost icon" data-act="set:lang" data-v="${s.lang === 'ar' ? 'en' : 'ar'}" aria-label="${s.lang === 'ar' ? 'English' : 'العربية'}"><b>${s.lang === 'ar' ? 'EN' : 'ع'}</b></button>
        <button class="btn ghost icon" data-act="app:theme" aria-label="${effectiveDark() ? t('Switch to light mode') : t('Switch to dark mode')}">${UI.icon(effectiveDark() ? 'sun' : 'moon', 18)}</button>
      </div>`);
    U.$('#tabbar').setAttribute('aria-label', t('Quick navigation'));
    const tabs = [['dashboard', 'grid', t('Home')], ['transactions', 'receipt', t('Activity')]];
    U.$('#tabbar').innerHTML = String(h`
      ${tabs.map(([k, ic, l]) => h`<a href="#/${k}" class="${k === name ? 'on' : ''}">${UI.icon(ic, 22)}<span>${l}</span></a>`)}
      <button class="fab" data-act="tx:new" aria-label="${t('New transaction')}">${UI.icon('plus', 26)}</button>
      <a href="#/stats" class="${name === 'stats' ? 'on' : ''}">${UI.icon('chart', 22)}<span>${t('Reports')}</span></a>
      <button class="${!['dashboard', 'transactions', 'stats'].includes(name) ? 'on' : ''}" data-act="app:more">${UI.icon('menu', 22)}<span>${t('More')}</span></button>`);
  };
  App.refreshChrome = () => { if (S.state) renderShell(App.route().name); };
  App.on('app:theme', () => S.commit(st => { st.settings.theme = effectiveDark() ? 'light' : 'dark'; }, { settings: true }));
  App.on('app:more', () => {
    const items = ALL().filter(([k]) => !['dashboard', 'transactions', 'stats'].includes(k));
    const ctl = UI.modal({ title: t('More'), size: 'sheet', body: h`<nav class="more-nav">${items.map(([k, ic, l]) => h`<a href="#/${k}" data-close>${UI.icon(ic, 22)}<span>${l}</span></a>`)}
      <button type="button" data-act="app:qr">${UI.icon('qr', 22)}<span>${t('Open on another device')}</span></button></nav>` });
    ctl.el.addEventListener('click', e => { if (e.target.closest('.more-nav a, .more-nav button')) ctl.close(); });
  });

  /* ---------- render ---------- */
  const captureFocus = root => {
    const a = document.activeElement;
    if (!a || !root.contains(a) || !a.id) return null;
    return { id: a.id, s: a.selectionStart, e: a.selectionEnd };
  };
  const restoreFocus = f => {
    if (!f) return;
    const el = document.getElementById(f.id);
    if (!el) return;
    el.focus({ preventScroll: true });
    try { if (f.s != null) el.setSelectionRange(f.s, f.e); } catch (e) { /* not a text input */ }
  };
  let lastRoute = null;
  App.render = () => {
    if (!S.state) return;
    const r = App.route(), view = App.views[r.name], root = U.$('#view');
    const sameRoute = lastRoute === r.name, focus = captureFocus(root), y = window.scrollY;
    try {
      renderShell(r.name);
      root.innerHTML = String(view.render(r.params));
      if (view.mount) view.mount(root);
    } catch (err) {
      console.error(err);
      root.innerHTML = `<div class="empty"><b>Something went wrong</b><p>${U.esc(err.message)}</p><button class="btn" data-act="app:reload">Reload</button></div>`;
    }
    document.title = `${(ALL().find(n => n[0] === r.name) || [0, 0, 'Ledgerly'])[2]} · Ledgerly`;
    if (sameRoute) { window.scrollTo(0, y); restoreFocus(focus); } else window.scrollTo(0, 0);
    lastRoute = r.name;
  };
  let pending = false;
  const schedule = () => { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; App.render(); }); };

  window.addEventListener('hashchange', () => {
    const r = App.route(), v = App.views[r.name];
    if (v.enter) v.enter(r.params);
    lastRoute = null;
    App.render();
  });

  /* ---------- global events ---------- */
  const H = App.handlers;
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = H.click[el.dataset.act];
    if (fn) { if (el.tagName === 'A') e.preventDefault(); fn(el, e); }
  });
  document.addEventListener('change', e => {
    const el = e.target.closest('[data-change]');
    if (el && H.change[el.dataset.change]) H.change[el.dataset.change](el, e);
  });
  document.addEventListener('input', e => {
    const el = e.target.closest('[data-input]');
    if (el && H.input[el.dataset.input]) H.input[el.dataset.input](el, e);
  });
  document.addEventListener('submit', e => {
    const f = e.target.closest('form[data-submit]');
    if (!f) return;
    e.preventDefault();
    if (H.submit[f.dataset.submit]) H.submit[f.dataset.submit](f, e);
  });
  // tidy amount fields when leaving them
  document.addEventListener('focusout', e => {
    const el = e.target;
    if (!el.matches || !el.matches('[data-amt]') || !el.value.trim()) return;
    const v = U.parseAmount(el.value);
    if (Number.isFinite(v)) el.value = U.toInput(v);
  });
  document.addEventListener('keydown', e => {
    const m = UI.topModal();
    if (e.key === 'Escape' && m && !m.sticky) { m.close(); return; }
    if (e.key === 'Tab' && m) {
      const f = U.$$('a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled])', m.dlg).filter(x => x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      return;
    }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName) || (document.activeElement || {}).isContentEditable;
    if (!S.state || typing || m || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); TxForm.open(); }
    else if (e.key === '/') {
      e.preventDefault();
      if (App.route().name !== 'transactions') location.hash = '#/transactions';
      setTimeout(() => { const q = U.$('#tx-q'); if (q) q.focus(); }, 30);
    }
  });

  document.addEventListener('toggle', e => {
    if (e.target.matches && e.target.matches('[data-side-more]')) { try { localStorage.setItem('ledgerly:side-more', e.target.open ? '1' : '0'); } catch (err) { /* ignore */ } }
  }, true);
  App.on('noop', () => {});
  App.on('app:reload', () => location.reload());

  /* ---------- settings-driven handlers shared with the shell ---------- */
  App.on('ob:theme', el => {
    S.commit(st => { st.settings.theme = el.dataset.v; }, { settings: true });
    U.$$('[data-act="ob:theme"]').forEach(b => { b.classList.toggle('on', b === el); b.setAttribute('aria-selected', String(b === el)); });
  });

  /* ---------- boot ---------- */
  /** Runs after a profile unlocks (or this tab's session is restored). */
  App.afterUnlock = async () => {
    A.processRecurring();
    const r = App.route();
    if (App.views[r.name].enter) App.views[r.name].enter(r.params);
    lastRoute = null;
    App.render();
    if (!S.state.meta.onboarded) SettingsView.onboard();
    Sync.start();
  };

  const boot = () => {
    S.onStorageError = () => { if (!boot.warned) { boot.warned = true; UI.toast(t('Could not save to this browser. Download a backup so you do not lose your work.'), { kind: 'warn', ms: 12000 }); } };
    UI.initTooltip();
    S.subscribe(schedule);
    let day = U.today();
    const rollover = () => { if (S.state && U.today() !== day) { day = U.today(); A.processRecurring(); S.version++; App.render(); } };
    setInterval(rollover, 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) rollover(); });
    if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => App.render());
    Auth.start();
  };
  document.addEventListener('DOMContentLoaded', boot);
})();
