/* Ledgerly service worker: lets the app open without a connection and be installed on phones, tablets and computers.
   Network first (so a new version shows up as soon as you are online), falling back to the copy saved on this device.
   It never stores or answers /api/ requests: your data only syncs live, and only encrypted. */
const CACHE = 'ledgerly-shell-v3';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/styles.css',
  'js/early.js', 'js/util.js', 'js/i18n.js', 'js/lang-ar.js', 'js/vault.js', 'js/merge.js', 'js/store.js', 'js/engine.js', 'js/actions.js', 'js/seed.js',
  'js/charts.js', 'js/ui.js', 'js/qrcode.js', 'js/pwa.js', 'js/auth.js', 'js/sync.js',
  'js/views/txform.js', 'js/views/dashboard.js', 'js/views/transactions.js', 'js/views/budget.js', 'js/views/plans.js', 'js/views/stats.js',
  'js/views/scheduled.js', 'js/views/data.js', 'js/views/statement.js', 'js/views/settings.js', 'js/views/account.js', 'js/app.js',
  'assets/ledgerly.svg', 'assets/ledgerly.ico', 'assets/icon-192.png', 'assets/icon-512.png', 'assets/apple-touch-icon.png',
];
self.SHELL = SHELL;   // read by tools/engine-test.js to check the list matches index.html

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('ledgerly-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;   // the browser handles it as usual
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') { const shell = await cache.match('index.html'); if (shell) return shell; }
      throw err;
    }
  })());
});
