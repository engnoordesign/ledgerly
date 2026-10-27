'use strict';
/* Merge two versions of the same profile's data (this device and the server).
   Items are matched by id. Where both sides have an item, this device's copy wins.
   Deletions cannot be told apart from "never had it", so a merge only ever adds. */
const Merge = (() => {
  const M = {};
  const union = (mine, theirs) => {
    const map = new Map();
    for (const x of theirs || []) if (x && x.id) map.set(x.id, x);
    for (const x of mine || []) if (x && x.id) map.set(x.id, x);
    return [...map.values()];
  };
  /** Counts shown to the user when they have to choose. */
  M.summary = st => ({
    accounts: (st.accounts || []).length, transactions: (st.transactions || []).length, goals: (st.goals || []).length,
    recurring: (st.recurring || []).length, latest: (st.transactions || []).reduce((m, t) => (t.date > m ? t.date : m), ''),
  });
  /** mine = this device, theirs = server. Returns a new state object. */
  M.states = (mine, theirs) => {
    const out = { ...theirs, ...mine };
    for (const k of ['accounts', 'categories', 'transactions', 'goals', 'recurring']) out[k] = union(mine[k], theirs[k]);
    out.budgets = { ...(theirs.budgets || {}), ...(mine.budgets || {}) };
    out.settings = { ...(theirs.settings || {}), ...(mine.settings || {}) };
    out.meta = { ...(theirs.meta || {}), ...(mine.meta || {}), onboarded: !!((mine.meta || {}).onboarded || (theirs.meta || {}).onboarded) };
    return out;
  };
  return M;
})();
