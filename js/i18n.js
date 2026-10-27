'use strict';
/* Translation layer. English text IS the key:  t('Add transaction')  ->  Arabic when lang === 'ar'.
   Missing Arabic strings fall back to English and are recorded in I18N.missing (see tools/check-i18n.js).
   Placeholders use {name}. Dictionaries live in lang-ar.js. */
const I18N = (() => {
  const I = { lang: 'en', dicts: {}, missing: new Set() };

  I.t = (key, vars) => {
    let s = key;
    if (I.lang !== 'en') {
      const d = I.dicts[I.lang];
      if (d && Object.prototype.hasOwnProperty.call(d, key)) s = d[key]; else I.missing.add(key);
    }
    return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : s;
  };

  /* Units: English [singular, plural]; Arabic [singular, dual, 3-10, 11+] */
  const EN = { day: ['day', 'days'], week: ['week', 'weeks'], month: ['month', 'months'], year: ['year', 'years'], category: ['category', 'categories'],
    bill: ['bill', 'bills'], transaction: ['transaction', 'transactions'], account: ['account', 'accounts'], goal: ['goal', 'goals'],
    payment: ['payment', 'payments'], item: ['item', 'items'], row: ['row', 'rows'], plan: ['plan', 'plans'] };
  const AR = { day: ['يوم', 'يومان', 'أيام', 'يومًا'], week: ['أسبوع', 'أسبوعان', 'أسابيع', 'أسبوعًا'], month: ['شهر', 'شهران', 'أشهر', 'شهرًا'],
    year: ['سنة', 'سنتان', 'سنوات', 'سنة'], category: ['فئة', 'فئتان', 'فئات', 'فئة'], bill: ['فاتورة', 'فاتورتان', 'فواتير', 'فاتورة'],
    transaction: ['معاملة', 'معاملتان', 'معاملات', 'معاملة'], account: ['حساب', 'حسابان', 'حسابات', 'حسابًا'], goal: ['هدف', 'هدفان', 'أهداف', 'هدفًا'],
    payment: ['دفعة', 'دفعتان', 'دفعات', 'دفعة'], item: ['عنصر', 'عنصران', 'عناصر', 'عنصرًا'], row: ['صف', 'صفان', 'صفوف', 'صفًّا'],
    plan: ['خطة', 'خطتان', 'خطط', 'خطة'] };

  /** I18N.count(3, 'day') -> "3 days" / "3 أيام" */
  I.count = (n, unit) => {
    if (I.lang === 'ar') {
      const f = AR[unit] || [unit, unit, unit, unit];
      if (n === 1) return f[0];
      if (n === 2) return f[1];
      return `${n} ${n >= 3 && n <= 10 ? f[2] : n === 0 ? f[2] : f[3]}`;
    }
    const f = EN[unit] || [unit, unit + 's'];
    return `${n} ${n === 1 ? f[0] : f[1]}`;
  };

  I.isRTL = () => I.lang === 'ar';
  I.set = lang => {
    I.lang = lang === 'ar' ? 'ar' : 'en';
    const de = document.documentElement;
    de.lang = I.lang; de.dir = I.lang === 'ar' ? 'rtl' : 'ltr';
  };
  return I;
})();
const t = I18N.t;
