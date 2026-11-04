/* Two small adapters that give cloud-api.mjs one D1-style interface over SQLite:
   prepare(sql).bind(...args) -> { first(), all(), run() }, and batch([statements]) which runs them in one transaction.
   - fromDurableObject(ctx.storage): a Cloudflare Durable Object's SQLite storage (used by server/worker.mjs)
   - fromNodeSqlite(new DatabaseSync(file)): Node 22's built-in node:sqlite (used by the tests and the local preview) */

export function fromDurableObject(storage) {
  const sql = storage.sql;
  const exec = (q, args) => { const c = sql.exec(q, ...args); const rows = c.toArray(); return { rows, changes: c.rowsWritten }; };
  const stmt = (q, args = []) => ({
    bind: (...a) => stmt(q, a),
    exec: () => exec(q, args),
    first: async () => exec(q, args).rows[0] || null,
    all: async () => ({ results: exec(q, args).rows }),
    run: async () => ({ meta: { changes: exec(q, args).changes } }),
  });
  return {
    prepare: q => stmt(q),
    batch: async list => storage.transactionSync(() => list.map(s => ({ meta: { changes: s.exec().changes } }))),
  };
}

export function fromNodeSqlite(db) {
  const stmt = (q, args = []) => ({
    bind: (...a) => stmt(q, a),
    exec: () => ({ changes: Number(db.prepare(q).run(...args).changes) }),
    first: async () => { const r = db.prepare(q).get(...args); return r ? { ...r } : null; },
    all: async () => ({ results: db.prepare(q).all(...args).map(r => ({ ...r })) }),
    run: async () => ({ meta: { changes: Number(db.prepare(q).run(...args).changes) } }),
  });
  return {
    prepare: q => stmt(q),
    batch: async list => {
      db.exec('BEGIN IMMEDIATE');
      try { const out = list.map(s => ({ meta: { changes: s.exec().changes } })); db.exec('COMMIT'); return out; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}
