'use strict';
/* Constants, application state and persistence.
   Everything that changes data goes through S.commit(); nothing else touches S.state. */

const K = {
  // Categorical hues from the validated chart palette + extras (category colour follows the entity, never its rank)
  PALETTE: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948', '#0e8fa3', '#9a6b3f', '#64748b', '#7aa21c'],
  ACCOUNT_TYPES: {
    checking: { label: 'Checking', icon: 'landmark' },
    cash: { label: 'Cash', icon: 'banknote' },
    savings: { label: 'Savings', icon: 'vault', saving: true },
    investment: { label: 'Investment', icon: 'trending-up', saving: true },
    credit: { label: 'Credit card', icon: 'card', liability: true },
    loan: { label: 'Loan', icon: 'landmark', liability: true },
  },
  FREQ: { weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly', quarterly: 'Every 3 months', yearly: 'Yearly' },
  BUCKETS: { needs: 'Needs', wants: 'Wants' },
  IMP_COLORS: { 4: '#256abf', 3: '#3987e5', 2: '#6da7ec', 1: '#9ec5f4' },   // importance: one blue ramp, darker = more important
  CAT_ICONS: ['home', 'cart', 'car', 'zap', 'heart', 'shield', 'phone', 'book', 'utensils', 'film', 'bag', 'repeat', 'plane', 'gift', 'coffee', 'briefcase', 'banknote', 'trending-up', 'landmark', 'tag'],
  VERSION: '1.0.0',
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
    accounts: [], categories: [], transactions: [], budgets: {}, goals: [], recurring: [],
    meta: { created: Date.now(), lastBackup: null, onboarded: false, demo: false },
  });

  /** Fill in anything an older / hand-edited file might lack, and drop obviously broken rows. */
  S.normalize = raw => {
    const b = S.blank(), o = raw && typeof raw === 'object' ? raw : {};
    const st = {
      schema: 1,
      settings: Object.assign(b.settings, o.settings || {}),
      accounts: Array.isArray(o.accounts) ? o.accounts : [],
      categories: Array.isArray(o.categories) ? o.categories : [],
      transactions: Array.isArray(o.transactions) ? o.transactions : [],
      budgets: o.budgets && typeof o.budgets === 'object' ? o.budgets : {},
      goals: Array.isArray(o.goals) ? o.goals : [],
      recurring: Array.isArray(o.recurring) ? o.recurring : [],
      meta: Object.assign(b.meta, o.meta || {}),
    };
    st.transactions = st.transactions.filter(t => t && t.id && U.isDate(t.date) && Number.isFinite(t.amount) && ['income', 'expense', 'transfer'].includes(t.type));
    st.accounts.forEach(a => { a.opening = Number.isFinite(a.opening) ? a.opening : 0; });
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
