'use strict';
/* Web app: install on any device (phone, tablet, computer), work offline, and a QR code that opens the site on another device. */
const Pwa = (() => {
  const P = { prompt: null };
  const { h } = U;
  const web = /^https?:$/.test(location.protocol);

  P.standalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  P.ios = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  P.canInstall = () => !!P.prompt && !P.standalone();
  const refresh = () => { if (window.Auth && Auth.redraw) Auth.redraw(); if (window.App && App.refreshChrome) App.refreshChrome(); };

  addEventListener('beforeinstallprompt', e => { e.preventDefault(); P.prompt = e; refresh(); });
  addEventListener('appinstalled', () => { P.prompt = null; refresh(); UI.toast(t('Ledgerly is installed. Open it from your home screen or apps.')); });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname))) {
    addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => { /* the app still works, just not offline */ }); });
  }

  /** The address other devices should open: this site, or the server this profile syncs with. */
  P.siteUrl = () => {
    if (web) return location.origin + location.pathname.replace(/index\.html$/, '');
    const c = window.Sync && Sync.cfg && Sync.cfg();
    if (c && c.server) return c.server + '/';
    try { const s = localStorage.getItem('ledgerly:server'); return s ? s + '/' : ''; } catch (e) { return ''; }
  };

  /* ---------- QR code ---------- */
  const matrix = text => {
    qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
    const q = qrcode(0, 'M'); q.addData(text, 'Byte'); q.make();
    const n = q.getModuleCount(), m = [];
    for (let r = 0; r < n; r++) { m.push([]); for (let c = 0; c < n; c++) m[r].push(q.isDark(r, c)); }
    return m;
  };
  /** An SVG QR code (dark modules on white, with the quiet zone scanners need). */
  P.qrSvg = (text, px = 240) => {
    const m = matrix(text), n = m.length, q = 4, size = n + q * 2;
    let d = '';
    m.forEach((row, r) => row.forEach((on, c) => { if (on) d += `M${c + q} ${r + q}h1v1h-1z`; }));
    return `<svg class="qr" viewBox="0 0 ${size} ${size}" width="${px}" height="${px}" role="img" aria-label="${U.esc(t('QR code for {url}', { url: text }))}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  };
  P.qrPng = (text, scale = 12) => new Promise(res => {
    const m = matrix(text), n = m.length, q = 4, size = (n + q * 2) * scale, cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, size, size); g.fillStyle = '#000';
    m.forEach((row, r) => row.forEach((on, c) => { if (on) g.fillRect((c + q) * scale, (r + q) * scale, scale, scale); }));
    cv.toBlob(res, 'image/png');
  });

  const installHelp = () => P.standalone() ? h`<p class="muted small">${t('Ledgerly is already installed on this device.')}</p>`
    : h`<ul class="install-steps small">
      <li><b>${t('iPhone and iPad')}</b><span>${t('Open the address in Safari, tap Share, then Add to Home Screen.')}</span></li>
      <li><b>${t('Android')}</b><span>${t('Open it in Chrome, tap the ⋮ menu, then Install app (or Add to Home screen).')}</span></li>
      <li><b>${t('Computer')}</b><span>${t('In Chrome or Edge, click the install icon at the end of the address bar.')}</span></li></ul>`;

  P.showQr = () => {
    const url = P.siteUrl();
    const ctl = UI.modal({
      title: t('Open on another device'), size: 'sm',
      body: url ? h`<div class="qr-box">${U.raw(P.qrSvg(url))}<p class="muted">${t('Scan with your phone camera to open Ledgerly. Then sign in with your username and password.')}</p>
          <div class="qr-url num" dir="ltr">${url}</div>
          <div class="stack-btns center"><button type="button" class="btn" data-act="pwa:copy">${UI.icon('copy', 16)}${t('Copy link')}</button>
            <button type="button" class="btn" data-act="pwa:png">${UI.icon('download', 16)}${t('Download QR image')}</button>
            ${navigator.share ? h`<button type="button" class="btn" data-act="pwa:share">${UI.icon('arrow-up', 16)}${t('Share')}</button>` : ''}</div></div>
          <h3 class="sec-s">${t('Install it like an app')}</h3>${installHelp()}
          ${P.canInstall() ? h`<button type="button" class="btn primary wide" data-act="app:install">${UI.icon('download', 16)}${t('Install app')}</button>` : ''}`
        : h`<p class="muted">${t('This copy of Ledgerly is opened from a file, so other devices cannot reach it. Put it online (see README) or turn on sync, then the QR code appears here.')}</p>`,
      footer: h`<button type="button" class="btn primary" data-close>${t('Done')}</button>`,
    });
    P.url = url; P.ctl = ctl;
  };
  App.on('app:qr', () => P.showQr());
  App.on('pwa:copy', async () => { try { await navigator.clipboard.writeText(P.url); UI.toast(t('Link copied.')); } catch (e) { UI.toast(P.url); } });
  App.on('pwa:share', async () => { try { await navigator.share({ title: 'Ledgerly', url: P.url }); } catch (e) { /* cancelled */ } });
  App.on('pwa:png', async () => {
    const blob = await P.qrPng(P.url), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'ledgerly-qr.png'; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  });
  P.install = async () => {
    if (!P.prompt) { P.showQr(); return; }
    P.prompt.prompt();
    try { await P.prompt.userChoice; } catch (e) { /* ignore */ }
    P.prompt = null; refresh();
  };
  App.on('app:install', () => P.install());
  return P;
})();
