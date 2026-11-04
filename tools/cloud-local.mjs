/* Runs the Cloudflare version of the sync API (server/cloud-api.mjs) on this computer, on Node's built-in SQLite.
   Used by tools/auth-test.js, and handy for trying the online sign-in without deploying:
     node tools/cloud-local.mjs [--port 8788]      then open http://localhost:8788
   (The real deployment is `npx wrangler deploy`, see wrangler.jsonc.) */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createApi } from '../server/cloud-api.mjs';
import { fromNodeSqlite } from '../server/sql-adapter.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const STATIC_OK = /^\/(index\.html|manifest\.webmanifest|sw\.js|css\/[\w.-]+|js\/[\w.-]+|js\/views\/[\w.-]+|assets\/[\w.-]+)$/;

export async function createCloudLocal(opts = {}) {
  const file = opts.file || path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ledgerly-cloud-')), 'store.sqlite');
  const sqlite = new DatabaseSync(file);
  const api = createApi({ db: fromNodeSqlite(sqlite), secret: opts.secret || 'local-test-secret', ...opts });
  const csp = (fs.readFileSync(path.join(ROOT, '_headers'), 'utf8').match(/Content-Security-Policy: (.*)/) || [])[1];

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) {
      const p = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
      if (opts.serveApp === false || !STATIC_OK.test(p) || p.includes('..')) { res.writeHead(404); return res.end('Not found'); }
      return fs.readFile(path.join(ROOT, p), (err, data) => {
        if (err) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Content-Security-Policy': csp, 'Cache-Control': 'no-cache' });
        res.end(data);
      });
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length && !['GET', 'HEAD'].includes(req.method) ? Buffer.concat(chunks) : undefined;
    const request = new Request(new URL(req.url, 'http://127.0.0.1'), { method: req.method, headers: req.headers, body });
    const out = await api.handle(request, req.socket.remoteAddress);
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
  });
  return {
    server, cfg: api.cfg, maxBlob: api.cfg.maxBlob, node: false,
    listen: (port = 0, host = '127.0.0.1') => new Promise((ok, no) => { server.once('error', no); server.listen(port, host, () => ok(server.address())); }),
    close: () => new Promise(ok => server.close(() => { sqlite.close(); ok(); })),
    /** Everything the database holds, as text (tests check it contains no plaintext). */
    dump: () => ['users', 'chunks', 'sessions', 'meta'].map(tb => JSON.stringify(sqlite.prepare('SELECT * FROM ' + tb).all())).join('\n'),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const i = process.argv.indexOf('--port'), port = i > 0 ? +process.argv[i + 1] : 8788;
  fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
  const s = await createCloudLocal({ file: path.join(ROOT, 'data', 'cloud-local.sqlite'), minIter: 100000 });
  await s.listen(port, '127.0.0.1');
  console.log(`Ledgerly (Cloudflare API, local SQLite) at http://localhost:${port}`);
}
