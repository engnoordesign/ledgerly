'use strict';
/* Starting data: default categories, a clean start, and a realistic demo year.
   Built-in category names are English keys flagged `sys` and translated on display (Q.catName). */
const Seed = (() => {
  const Seed = {};
  const P = K.PALETTE;
  // key, English name, type, icon, palette index, bucket
  const CATS = [
    ['housing', 'Housing', 'expense', 'home', 0, 'needs'], ['groceries', 'Groceries', 'expense', 'cart', 2, 'needs'],
    ['utilities', 'Utilities', 'expense', 'zap', 3, 'needs'], ['transport', 'Transport', 'expense', 'car', 5, 'needs'],
    ['health', 'Health', 'expense', 'heart', 7, 'needs'], ['insurance', 'Insurance', 'expense', 'shield', 9, 'needs'],
    ['phone', 'Phone & Internet', 'expense', 'phone', 10, 'needs'], ['education', 'Education', 'expense', 'book', 11, 'needs'],
    ['dining', 'Dining out', 'expense', 'utensils', 1, 'wants'], ['entertainment', 'Entertainment', 'expense', 'film', 6, 'wants'],
    ['shopping', 'Shopping', 'expense', 'bag', 4, 'wants'], ['subscriptions', 'Subscriptions', 'expense', 'repeat', 8, 'wants'],
    ['travel', 'Travel', 'expense', 'plane', 3, 'wants'], ['gifts', 'Gifts & donations', 'expense', 'gift', 4, 'wants'],
    ['otherx', 'Other', 'expense', 'tag', 10, 'wants'],
    ['salary', 'Salary', 'income', 'briefcase', 2], ['freelance', 'Freelance', 'income', 'banknote', 0],
    ['invest', 'Investments', 'income', 'trending-up', 6], ['giftin', 'Gifts received', 'income', 'gift', 4], ['otherin', 'Other income', 'income', 'tag', 10],
  ];
  // how important each kind of money is, and why it was spent (the demo mixes in some impulse buys)
  const IMP = { c_housing: 4, c_groceries: 4, c_utilities: 4, c_transport: 3, c_health: 4, c_insurance: 4, c_phone: 4, c_education: 3, c_dining: 2, c_entertainment: 2,
    c_shopping: 2, c_subscriptions: 2, c_travel: 2, c_gifts: 3, c_otherx: 2, c_salary: 4, c_freelance: 3, c_invest: 2, c_giftin: 1, c_otherin: 1 };
  Seed.categories = () => CATS.map(([k, name, type, icon, ci, bucket]) => ({ id: 'c_' + k, name, sys: true, type, icon, color: P[ci], bucket }));

  /** Brand-new user: default categories and the one account, with the money they have today. */
  Seed.fresh = (settings, acct = {}) => {
    const st = S.blank();
    Object.assign(st.settings, settings);
    st.categories = Seed.categories();
    st.accounts = [{ id: 'a_main', name: 'Main', opening: acct.opening || 0, color: P[0] }];
    st.meta.onboarded = true;
    return st;
  };

  // rough units per US dollar so demo amounts feel natural in other currencies
  const RATE = { SAR: 3.75, AED: 3.67, EGP: 48, KWD: 0.31, QAR: 3.64, BHD: 0.38, OMR: 0.385, JOD: 0.71, MAD: 10, TND: 3.1, DZD: 135, IQD: 1310, LBP: 89000,
    TRY: 34, JPY: 150, KRW: 1350, INR: 83, PKR: 280, IDR: 15800, BRL: 5.5, MXN: 18, ZAR: 18, NGN: 1500, RUB: 90, CNY: 7.2, SEK: 10.5, NOK: 10.7, DKK: 6.9,
    PLN: 4, CHF: 0.88, GBP: 0.79, EUR: 0.92, CAD: 1.36, AUD: 1.5, SGD: 1.34 };

  /** A full year of believable activity, relative to today. */
  Seed.demo = settings => {
    const st = S.blank();
    Object.assign(st.settings, settings);
    U.setCurrency(st.settings.currency, st.settings.locale);
    const pow = U.currency().pow, rate = RATE[st.settings.currency] || 1, today = U.today(), cm = U.curMonth();
    const R = U.rand(20260607);
    const rnd = (a, b) => a + R() * (b - a), int = (a, b) => Math.floor(rnd(a, b + 1)), pick = arr => arr[Math.floor(R() * arr.length)], chance = p => R() < p;
    const amt = usd => {
      let v = usd * rate;
      v = rate >= 100 ? Math.round(v / 10) * 10 : rate >= 10 ? Math.round(v) : Math.round(v * pow) / pow;
      return Math.round(v * pow);
    };
    const first = U.addMonthKey(cm, -11);

    st.categories = Seed.categories();
    st.meta.onboarded = true; st.meta.demo = true;
    st.accounts = [{ id: 'a_main', name: 'Main', opening: amt(4200), color: P[0] }];

    // scheduled items; auto-posted ones are replayed through the same engine the app uses
    const start = d => `${first}-${U.pad(d)}`;
    const rec = (name, type, usd, accountId, categoryId, day, extra = {}) => ({
      id: U.uid('r'), name, type, amount: amt(usd), accountId: 'a_main', categoryId, payee: name, note: '', importance: IMP[categoryId], frequency: 'monthly',
      startDate: start(day), autoPost: true, active: true, count: 0, ...extra,
    });
    st.recurring = [
      rec(t('Employer payroll'), 'income', 4500, 'a_main', 'c_salary', 1),
      rec(t('Rent'), 'expense', 1650, 'a_main', 'c_housing', 1),
      rec(t('Fiber internet'), 'expense', 59.99, 'a_main', 'c_phone', 8),
      rec(t('Mobile plan'), 'expense', 45, 'a_main', 'c_phone', 15),
      rec(t('Car insurance'), 'expense', 96, 'a_main', 'c_insurance', 20),
      rec(t('Gym membership'), 'expense', 29.99, 'a_main', 'c_health', 3),
      rec('Netflix', 'expense', 15.49, 'a_main', 'c_subscriptions', 9),
      rec('Spotify', 'expense', 10.99, 'a_main', 'c_subscriptions', 11),
      rec(t('Cloud storage'), 'expense', 2.99, 'a_main', 'c_subscriptions', 14),
      rec(t('Water bill'), 'expense', 38, 'a_main', 'c_utilities', 1, { autoPost: false, startDate: U.addDays(today, 2) }),
    ];
    A.postDue(st, today);

    // everything that varies month to month
    const out = st.transactions;
    const add = (date, type, usd, accountId, categoryId, payee, extra = {}) => {
      if (date > today) return;
      const why = PURPOSE[categoryId], low = { c_dining: 0.25, c_shopping: 0.4, c_entertainment: 0.3, c_otherx: 0.5 }[categoryId];
      out.push({ id: U.uid('t'), type, date, amount: amt(usd), accountId: 'a_main', categoryId, payee, note: '', tags: [], createdAt: Date.now() + out.length,
        purpose: why, importance: low && chance(low) ? 1 : IMP[categoryId], ...extra });
    };
    const PURPOSE = { c_groceries: t('Weekly groceries'), c_dining: t('Eating out'), c_transport: t('Getting around'), c_shopping: t('Clothes and things for home'), c_entertainment: t('Fun and outings'),
      c_travel: t('Trip'), c_health: t('Health and medicine'), c_gifts: t('Gifts for family and friends'), c_education: t('Learning'), c_otherx: t('Small cash spending'),
      c_freelance: t('Side project payment'), c_invest: t('Interest earned') };
    const groceries = [t('Green Basket Market'), t('Corner Grocer'), t('FreshMart'), t('Bulk Warehouse')];
    const diners = [t('Sunrise Café'), t("Luigi's Pizza"), t('Noodle House'), t('Burger Yard'), t('Taco Stand')];
    const shops = [t('Urban Outfit'), t('Tech Hub'), t('HomeGoods Plus'), t('Book Corner')];
    const fun = [t('Cinema City'), t('Concert tickets'), t('Game store')];
    for (let i = 11; i >= 0; i--) {
      const mk = U.addMonthKey(cm, -i), dim = U.daysInMonth(+mk.slice(0, 4), +mk.slice(5, 7));
      const day = () => `${mk}-${U.pad(int(1, dim))}`;
      for (let n = int(7, 9); n--;) add(day(), 'expense', rnd(28, 125), 'a_main', 'c_groceries', pick(groceries));
      for (let n = int(4, 8); n--;) add(day(), 'expense', rnd(12, 62) * (chance(0.1) ? 1.8 : 1), 'a_main', 'c_dining', pick(diners));
      for (let n = int(3, 4); n--;) add(day(), 'expense', rnd(36, 55), 'a_main', 'c_transport', t('City Fuel'));
      for (let n = int(0, 3); n--;) add(day(), 'expense', rnd(8, 24), 'a_main', 'c_transport', t('QuickRide'));
      add(`${mk}-12`, 'expense', rnd(70, 118), 'a_main', 'c_utilities', t('City Power & Light'));
      if (chance(0.45)) add(day(), 'expense', rnd(18, 95), 'a_main', 'c_health', pick([t('Care Pharmacy'), t('Dr. Patel Clinic')]));
      for (let n = int(1, 3); n--;) add(day(), 'expense', rnd(24, 160), 'a_main', 'c_shopping', pick(shops));
      for (let n = int(1, 3); n--;) add(day(), 'expense', rnd(12, 60), 'a_main', 'c_entertainment', pick(fun));
      if (chance(0.12)) add(day(), 'expense', rnd(25, 90), 'a_main', 'c_gifts', t('Gift shop'));
      if (chance(0.1)) add(day(), 'expense', 39, 'a_main', 'c_education', t('Online course'));
      for (let n = int(1, 3); n--;) add(day(), 'expense', rnd(8, 40), 'a_main', 'c_otherx', t('Cash purchase'));
      if (i === 6) { add(`${mk}-09`, 'expense', 640, 'a_main', 'c_travel', t('Airline tickets')); add(`${mk}-14`, 'expense', 420, 'a_main', 'c_travel', t('Seaside hotel')); }
      if (i === 2) add(`${mk}-18`, 'expense', 210, 'a_main', 'c_travel', t('Weekend getaway'));
      if (chance(0.55)) add(`${mk}-${U.pad(int(10, Math.min(24, dim)))}`, 'income', rnd(220, 620), 'a_main', 'c_freelance', t('Freelance client'));
      add(`${mk}-${U.pad(Math.min(28, dim))}`, 'income', rnd(12, 26), 'a_main', 'c_invest', t('Savings interest'));
    }
    const lines = { c_housing: 1650, c_groceries: 650, c_utilities: 260, c_transport: 200, c_health: 100, c_insurance: 100, c_phone: 110, c_education: 40,
      c_dining: 240, c_entertainment: 100, c_shopping: 200, c_subscriptions: 40, c_travel: 150, c_gifts: 60, c_otherx: 50, c_salary: 4500, c_freelance: 250 };
    st.budgets[first] = { lines: Object.fromEntries(Object.entries(lines).map(([k, v]) => [k, amt(v)])), savings: amt(800), planId: 'balanced' };
    return st;
  };

  return Seed;
})();
