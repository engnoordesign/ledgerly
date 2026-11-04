/* Ledgerly on Cloudflare Workers.
   - Static files (the app) are served from the Worker's static assets (see wrangler.jsonc and .assetsignore).
   - /api/* goes to one Durable Object that keeps every account in its own SQLite database. A single object means every
     save is strictly ordered, so two devices can never overwrite each other (the same guarantee as the Node server).
   Optional settings (Worker → Settings → Variables and secrets):
     LEDGERLY_SECRET   (secret) a long random text; keys the hash of every login secret. Set it once and never change it.
     LEDGERLY_SIGNUP   open | invite | closed   who may create accounts (default open; set closed once your accounts exist)
     LEDGERLY_INVITE   the code new accounts need when LEDGERLY_SIGNUP is invite
     LEDGERLY_MAX_USERS  account limit (default 50) */
import { DurableObject } from 'cloudflare:workers';
import { createApi } from './cloud-api.mjs';
import { fromDurableObject } from './sql-adapter.mjs';

export class LedgerlyStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.api = createApi({
      db: fromDurableObject(ctx.storage), secret: env.LEDGERLY_SECRET, signup: env.LEDGERLY_SIGNUP, invite: env.LEDGERLY_INVITE, maxUsers: env.LEDGERLY_MAX_USERS,
    });
  }
  fetch(request) { return this.api.handle(request, request.headers.get('X-Ledgerly-Client-IP') || '?'); }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      const headers = new Headers(request.headers);
      headers.set('X-Ledgerly-Client-IP', request.headers.get('CF-Connecting-IP') || '?');
      const store = env.STORE.get(env.STORE.idFromName('ledgerly'));
      return store.fetch(new Request(request, { headers }));
    }
    return env.ASSETS.fetch(request);
  },
};
