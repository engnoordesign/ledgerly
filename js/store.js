'use strict';
/* Constants, application state and persistence.
   Everything that changes data goes through S.commit(); nothing else touches S.state. */

const K = {
  // Categorical hues from the validated chart palette + extras (category colour follows the entity, never its rank)
  PALETTE: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948', '#0e8fa3', '#9a6b3f', '#64748b', '#7aa21c'],
  FREQ: { weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly', quarterly: 'Every 3 months', yearly: 'Yearly' },
  BUCKETS: { needs: 'Needs', wants: 'Wants' },
  IMP_COLORS: { 4: '#256abf', 3: '#3987e5', 2: '#6da7ec', 1: '#9ec5f4' },   // importance: one blue ramp, darker = more important
  CAT_ICONS: ['home', 'cart', 'car', 'zap', 'heart', 'shield', 'phone', 'book', 'utensils', 'film', 'bag', 'repeat', 'plane', 'gift', 'coffee', 'briefcase', 'banknote', 'trending-up', 'landmark', 'tag'],
  VERSION: '1.1.0',
  KEY: 'ledgerly:v1',                 // legacy single-profile data (migrated into a profile, then removed)
  KEY_PROFILES: 'ledgerly:profiles',
  KEY_DATA: 'ledgerly:data:',          // + profile id: that profile's encrypted data
  KEY_SESSION: 'ledgerly:session',     // sessionStorage: unlock state for this tab only
  KEY_THEME: 'ledgerly:theme',
  KEY_LANG: 'ledgerly:lang',
  KEY_REMEMBER: 'ledgerly:remember:',  // + profile id: unlock secret sealed with this device's key (only if the user chose to stay signed in)
};

const S = (() => {
  const S = { state: null, version: 0, storageOK: true, listeners: new Set() };

  const navLang = () => ((navigator.language || 'en').slice(0, 2) === 'ar' ? 'ar' : 'en');
  const pickLocale = () => {
    const nav = (navigator.language || 'en-US');
    if (nav.slice(0, 2) === 'ar') return 'en-US'; // Western digits by default, Arabic-Indic is one tap away in Settings
    const hit = U.LOCALES.find(l => l[0].toLowerCase() === nav.toLowerCase()) || U.LOCALES.find(l => l[0].slice(0, 2) === nav.slice(0, 2));
    return hit ? hit[0] : 'en-US';
  };
  let langHint = null;
  try { langHint = localStorage.getItem(K.KEY_LANG); } catch (e) { /* ignore */ }

  S.blank = () => ({
    schema: 1,
    settings: { name: '', lang: langHint || navLang(), currency: 'USD', locale: pickLocale(), theme: 'system', savingsTarget: 20, emergencyMonths: 6, weekStart: (langHint || navLang()) === 'ar' ? 6 : 1 },
    accounts: [], categories: [], transactions: [], budgets: {}, recurring: [],
    meta: { created: Date.now(), lastBackup: null, onboarded: false, demo: false },
  });

  const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const mergeById = (a, b) => { const m = new Map(); for (const x of [...(a || []), ...(b || [])]) if (x && x.id) m.set(x.id, x); return [...m.values()]; };

  /** Fill in anything an older / hand-edited file might lack, and drop obviously broken rows.
      Ledgerly has ONE account and only income and expenses. Older data with several accounts, transfers or savings goals is folded
      into that shape (the balance is unchanged, because transfers only ever moved money between a person's own accounts).
      Whatever is taken out is kept under meta.legacy, so nothing is lost. The result depends only on the data, so two devices agree. */
  S.normalize = raw => {
    const b = S.blank(), o = raw && typeof raw === 'object' ? raw : {};
    const st = {
      schema: 1,
      settings: Object.assign(b.settings, o.settings || {}),
      accounts: Array.isArray(o.accounts) ? o.accounts.filter(a => a && a.id) : [],
      categories: Array.isArray(o.categories) ? o.categories : [],
      transactions: Array.isArray(o.transactions) ? o.transactions : [],
      budgets: o.budgets && typeof o.budgets === 'object' ? o.budgets : {},
      recurring: Array.isArray(o.recurring) ? o.recurring : [],
      meta: Object.assign(b.meta, o.meta || {}),
    };
    st.transactions = st.transactions.filter(t => t && t.id && U.isDate(t.date) && Number.isFinite(t.amount) && ['income', 'expense', 'transfer'].includes(t.type));
    st.accounts.forEach(a => { a.opening = Number.isFinite(a.opening) ? a.opening : 0; });

    const all = st.accounts.slice().sort(byId), main = all[0] || { id: 'a_main', name: 'Main', opening: 0, color: K.PALETTE[0] };
    const others = all.slice(1), transfers = st.transactions.filter(t => t.type === 'transfer'), recTransfers = st.recurring.filter(r => r && r.type === 'transfer');
    const goals = Array.isArray(o.goals) ? o.goals.filter(g => g && g.id) : [];
    if (others.length || transfers.length || recTransfers.length || goals.length) {
      const old = (st.meta.legacy && typeof st.meta.legacy === 'object') ? st.meta.legacy : {};
      st.meta.legacy = {
        at: old.at || U.today(),
        accounts: mergeById(old.accounts, others), transfers: mergeById(old.transfers, transfers),
        recurring: mergeById(old.recurring, recTransfers), goals: mergeById(old.goals, goals),
      };
    }
    main.opening = U.sum(all, a => a.opening);          // every account's starting money is now in the one account
    delete main.type; delete main.archived;
    st.accounts = [main];
    st.transactions = st.transactions.filter(t => t.type !== 'transfer');
    for (const t of st.transactions) { t.accountId = main.id; delete t.toAccountId; delete t.goalId; }
    st.recurring = st.recurring.filter(r => r && r.type !== 'transfer');
    for (const r of st.recurring) { r.accountId = main.id; delete r.toAccountId; delete r.goalId; }
    return st;
  };

  S.applySettings = () => {
    const s = S.state.settings;
    U.setCurrency(s.currency, s.locale);
    I18N.set(s.lang);
    U.setDateLocale(s.lang === 'ar' ? (s.locale.startsWith('ar') ? 'ar-EG' : 'ar-EG-u-nu-latn') : 'en-US');
    if (s.theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.dataset.theme = s.theme;
    try { localStorage.setItem(K.KEY_THEME, s.theme); localStorage.setItem(K.KEY_LANG, s.lang); } catch (e) { /* ignore */ }
  };

  /** Read the old, unencrypted single-profile data from before profiles existed. Null if there is none. */
  S.readLegacy = () => {
    try { const raw = localStorage.getItem(K.KEY); return raw ? S.normalize(JSON.parse(raw)) : null; } catch (e) { return null; }
  };

  let timer = null, saving = Promise.resolve(), changed = false;   // changed: real edits not yet reported to S.onSaved

  /** Make a profile's decrypted data the live state. saver(json) must return a promise that resolves once it is stored. */
  S.attach = (state, saver) => {
    S.state = state; S.saver = saver; S.snapshot = null; S.version++;
    S.applySettings();
  };
  /** Drop everything from memory (lock or sign out). */
  S.detach = () => { clearTimeout(timer); timer = null; changed = false; S.state = null; S.saver = null; S.snapshot = null; S.version++; };

  /** Save now. Writes are serialised so an older save can never land after a newer one. */
  S.persist = () => {
    clearTimeout(timer); timer = null;
    if (!S.state || !S.saver) return saving;
    const json = JSON.stringify(S.state), saver = S.saver, was = changed;   // capture now, encrypt and store in order
    changed = false;
    saving = saving.then(() => saver(json)).then(
      () => { S.storageOK = true; if (was && S.onSaved) S.onSaved(); },   // a plain flush with no edits is not a change
      e => { S.storageOK = false; if (S.onStorageError) S.onStorageError(e); });
    return saving;
  };
  const persistSoon = () => { clearTimeout(timer); timer = setTimeout(S.persist, 200); };
  window.addEventListener('pagehide', () => { if (timer) S.persist(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && timer) S.persist(); });

  S.subscribe = fn => { S.listeners.add(fn); return () => S.listeners.delete(fn); };
  S.emit = () => S.listeners.forEach(fn => fn());

  /** Mutate state. fn receives the live state object. */
  S.commit = (fn, opts = {}) => {
    const out = fn(S.state);
    S.version++;
    changed = true;
    persistSoon();
    if (opts.settings) S.applySettings();
    if (!opts.silent) S.emit();
    return out;
  };

  /** Replace the whole state (import / reset / demo). Keeps one undo snapshot, in memory only. */
  S.replace = (next, opts = {}) => {
    S.snapshot = S.state ? JSON.stringify(S.state) : null;
    S.state = S.normalize(next);
    S.version++;
    changed = true;
    S.applySettings();
    S.persist();
    if (!opts.silent) S.emit();
  };
  S.restoreSnapshot = () => {
    if (!S.snapshot) return false;
    try {
      S.state = S.normalize(JSON.parse(S.snapshot)); S.snapshot = null;
      S.version++; changed = true; S.applySettings(); S.persist(); S.emit();
      return true;
    } catch (e) { return false; }
  };

  S.export = () => JSON.stringify({ app: 'ledgerly', exportedAt: new Date().toISOString(), ...S.state }, null, 2);

  return S;
})();
