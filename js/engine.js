'use strict';
/* Accounting engine: read-only selectors over S.state, memoised per state version.
   Conventions
   - Account balance = opening + income - expense +/- transfers (only transactions dated <= today count).
   - A transfer moves money between two accounts and is NEVER income or expense.
   - "Saved" = transfers INTO a savings/investment account from a non-savings account (minus withdrawals).
   - Net worth = sum of all account balances (credit cards / loans carry negative balances). */
const Q = (() => {
  const Q = {};
  const memo = new Map(); let mv = -1;
  const cached = (key, fn) => {
    if (mv !== S.version) { memo.clear(); mv = S.version; }
    if (!memo.has(key)) memo.set(key, fn());
    return memo.get(key);
  };
  Q.cached = cached;

  /* ---------- lookups ---------- */
  Q.accMap = () => cached('accMap', () => new Map(S.state.accounts.map(a => [a.id, a])));
  Q.catMap = () => cached('catMap', () => new Map(S.state.categories.map(c => [c.id, c])));
  Q.acc = id => Q.accMap().get(id);
  Q.cat = id => Q.catMap().get(id);
  Q.accounts = (all = false) => S.state.accounts.filter(a => all || !a.archived);
  Q.cats = (type, all = false) => S.state.categories.filter(c => (all || !c.archived) && (!type || c.type === type));
  Q.accType = a => K.ACCOUNT_TYPES[a && a.type] || K.ACCOUNT_TYPES.checking;
  Q.isSaving = id => !!Q.accType(Q.acc(id)).saving;
  Q.isLiability = a => !!Q.accType(a).liability;
  Q.goalMap = () => cached('goalMap', () => new Map(S.state.goals.map(g => [g.id, g])));

  Q.sorted = () => cached('sorted', () => S.state.transactions.slice().sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0)));

  /** [accountId, signedDelta] pairs for a transaction. */
  Q.legs = t => t.type === 'income' ? [[t.accountId, t.amount]]
    : t.type === 'expense' ? [[t.accountId, -t.amount]]
    : [[t.accountId, -t.amount], [t.toAccountId, t.amount]];

  /* ---------- balances ---------- */
  Q.balances = (asOf = U.today()) => cached('bal:' + asOf, () => {
    const m = new Map(S.state.accounts.map(a => [a.id, a.opening || 0]));
    for (const t of S.state.transactions) {
      if (t.date > asOf) continue;
      for (const [id, d] of Q.legs(t)) if (m.has(id)) m.set(id, m.get(id) + d);
    }
    return m;
  });
  Q.balance = id => Q.balances().get(id) || 0;
  Q.clearedBalance = id => cached('cb:' + id, () => {
    const a = Q.acc(id); let v = a ? (a.opening || 0) : 0;
    for (const t of S.state.transactions) {
      if (!t.cleared) continue;
      for (const [aid, d] of Q.legs(t)) if (aid === id) v += d;
    }
    return v;
  });
  Q.netWorth = () => cached('nw', () => {
    const bal = Q.balances(); let assets = 0, liabilities = 0;
    for (const a of S.state.accounts) {
      const b = bal.get(a.id) || 0;
      if (Q.isLiability(a)) liabilities += -b; else assets += b;
    }
    return { assets, liabilities, net: assets - liabilities };
  });
  /** Balance at the end of each of the last n months (index n-1 = today) for every account. */
  Q.balanceHistory = (n = 6) => cached('bh:' + n, () => {
    const endKey = U.curMonth(), startKey = U.addMonthKey(endKey, -(n - 1)), startDate = U.monthStart(startKey), today = U.today();
    const base = new Map(), delta = new Map();
    for (const a of S.state.accounts) { base.set(a.id, a.opening || 0); delta.set(a.id, new Array(n).fill(0)); }
    for (const t of S.state.transactions) {
      if (t.date > today) continue;
      for (const [id, d] of Q.legs(t)) {
        if (!base.has(id)) continue;
        if (t.date < startDate) base.set(id, base.get(id) + d);
        else delta.get(id)[U.diffMonths(startKey, t.date.slice(0, 7))] += d;
      }
    }
    const out = new Map();
    for (const [id, arr] of delta) { let run = base.get(id); out.set(id, arr.map(d => (run += d))); }
    return out;
  });
  Q.netWorthSeries = (n = 12) => cached('nws:' + n, () => {
    const h = Q.balanceHistory(n), endKey = U.curMonth();
    return Array.from({ length: n }, (_, i) => ({
      key: U.addMonthKey(endKey, -(n - 1 - i)),
      value: U.sum([...h.values()], arr => arr[i]),
    }));
  });

  /* ---------- aggregation ---------- */
  const emptyAgg = key => ({ key, income: 0, expense: 0, saved: 0, count: 0, exp: new Map(), inc: new Map(), impExp: new Map(), impInc: new Map() });
  const addTo = (g, t, accs) => {
    g.count++;
    const im = t.importance || 0;   // 0 = not set
    if (t.type === 'income') { g.income += t.amount; const c = t.categoryId || '_none'; g.inc.set(c, (g.inc.get(c) || 0) + t.amount); g.impInc.set(im, (g.impInc.get(im) || 0) + t.amount); }
    else if (t.type === 'expense') { g.expense += t.amount; const c = t.categoryId || '_none'; g.exp.set(c, (g.exp.get(c) || 0) + t.amount); g.impExp.set(im, (g.impExp.get(im) || 0) + t.amount); }
    else {
      const f = accs.get(t.accountId), to = accs.get(t.toAccountId);
      const fs = f && Q.accType(f).saving, ts = to && Q.accType(to).saving;
      if (ts && !fs) g.saved += t.amount; else if (fs && !ts) g.saved -= t.amount;
    }
  };
  Q.monthAgg = () => cached('monthAgg', () => {
    const m = new Map(), accs = Q.accMap();
    for (const t of S.state.transactions) {
      const k = t.date.slice(0, 7);
      addTo(m.get(k) || m.set(k, emptyAgg(k)).get(k), t, accs);
    }
    return m;
  });
  Q.month = k => Q.monthAgg().get(k) || emptyAgg(k);
  /** Aggregate for an arbitrary inclusive date range. */
  Q.range = (from, to) => cached(`r:${from}:${to}`, () => {
    const g = emptyAgg(from + '..' + to), accs = Q.accMap();
    for (const t of S.state.transactions) if (t.date >= from && t.date <= to) addTo(g, t, accs);
    return g;
  });
  Q.series = (endKey, n) => Array.from({ length: n }, (_, i) => {
    const k = U.addMonthKey(endKey, -(n - 1 - i)), a = Q.month(k);
    return { key: k, income: a.income, expense: a.expense, net: a.income - a.expense, saved: a.saved };
  });
  /** First and last month that have any data. */
  Q.span = () => cached('span', () => {
    const keys = [...Q.monthAgg().keys()].sort();
    return keys.length ? [keys[0], keys[keys.length - 1]] : [U.curMonth(), U.curMonth()];
  });
  /** Top categories (+ "Other") from a Map(catId -> cents). */
  Q.topCats = (map, max = 6) => {
    const rows = [...map].map(([id, v]) => ({ id, value: v, cat: Q.cat(id) || { id: '_none', name: 'Uncategorized', sys: true, color: '#64748b', icon: 'tag' } }))
      .filter(r => r.value > 0).sort((a, b) => b.value - a.value);
    if (rows.length <= max) return rows;
    const head = rows.slice(0, max - 1), rest = rows.slice(max - 1);
    head.push({ id: '_other', value: U.sum(rest, r => r.value), cat: { id: '_other', name: t('Other ({n})', { n: rest.length }), color: '#9a9990', icon: 'tag' }, rest });
    return head;
  };

  /* ---------- transactions query ---------- */
  Q.filter = (o = {}) => {
    const q = (o.q || '').trim().toLowerCase();
    const accs = Q.accMap(), cats = Q.catMap();
    return Q.sorted().filter(t => {
      if (o.from && t.date < o.from) return false;
      if (o.to && t.date > o.to) return false;
      if (o.type && t.type !== o.type) return false;
      if (o.accountId && t.accountId !== o.accountId && t.toAccountId !== o.accountId) return false;
      if (o.categoryId && (o.categoryId === '_none' ? t.categoryId : t.categoryId !== o.categoryId)) return false;
      if (o.goalId && t.goalId !== o.goalId) return false;
      if (o.importance) { if (t.type === 'transfer' || (t.importance || 0) !== (o.importance === 'none' ? 0 : +o.importance)) return false; }
      if (o.uncleared && t.cleared) return false;
      if (q) {
        const hay = [t.payee, t.note, t.purpose, Q.importanceLabel(t.type, t.importance), (t.tags || []).join(' '), (cats.get(t.categoryId) || {}).name, (accs.get(t.accountId) || {}).name,
          U.toInput(t.amount), U.money(t.amount, { plain: true })].join(' ').toLowerCase();
        if (!q.split(/\s+/).every(w => hay.includes(w))) return false;
      }
      return true;
    });
  };
  Q.payees = () => cached('payees', () => {
    const m = new Map();
    for (const t of Q.sorted()) {
      if (!t.payee) continue;
      const k = t.payee.toLowerCase(), e = m.get(k);
      if (!e) m.set(k, { name: t.payee, type: t.type, categoryId: t.categoryId, accountId: t.accountId, toAccountId: t.toAccountId, amount: t.amount, purpose: t.purpose, importance: t.importance, count: 1 });
      else e.count++;
    }
    return m;
  });
  /** The importance scale for income or expenses: 4 = most important. The wording fits the kind of money. */
  Q.importance = type => type === 'income'
    ? [{ level: 4, label: t('Essential'), hint: t('Money you rely on to live') }, { level: 3, label: t('Important'), hint: t('A regular, planned source') },
      { level: 2, label: t('Helpful'), hint: t('A welcome extra') }, { level: 1, label: t('Extra'), hint: t('A one-off or unexpected bonus') }]
    : [{ level: 4, label: t('Essential'), hint: t('Something you must pay for, like rent, food or bills') }, { level: 3, label: t('Important'), hint: t('Matters a lot, but could wait a little') },
      { level: 2, label: t('Nice to have'), hint: t('Pleasant, but you could do without it') }, { level: 1, label: t('Not needed'), hint: t('An impulse, or something you did not really need') }];
  Q.importanceLabel = (type, level) => { const f = level ? Q.importance(type).find(i => i.level === level) : null; return f ? f.label : ''; };
  /** Reasons people have typed before, most used first, for quick re-use. */
  Q.purposes = () => cached('purposes', () => {
    const m = new Map();
    for (const x of Q.sorted()) {
      if (!x.purpose) continue;
      const k = x.purpose.toLowerCase(), e = m.get(k);
      if (!e) m.set(k, { text: x.purpose, count: 1 }); else e.count++;
    }
    return m;
  });
  Q.tags = () => cached('tags', () => [...new Set(S.state.transactions.flatMap(t => t.tags || []))].sort());

  /* ---------- budget ---------- */
  /** The plan in force for a month: the latest saved plan at or before it (history stays fixed). */
  Q.planKey = month => {
    const keys = Object.keys(S.state.budgets).filter(k => k <= month).sort();
    return keys.length ? keys[keys.length - 1] : null;
  };
  Q.plan = month => { const k = Q.planKey(month); return k ? S.state.budgets[k] : { lines: {}, savings: 0 }; };

  Q.budgetRows = month => cached('br:' + month, () => {
    const plan = Q.plan(month), agg = Q.month(month);
    const row = (cat, planned, actual) => ({ cat, id: cat.id, planned, actual, remaining: planned - actual, ratio: planned > 0 ? actual / planned : (actual > 0 ? Infinity : 0) });
    const build = (type, map) => {
      const out = [], seen = new Set();
      for (const c of S.state.categories) {
        if (c.type !== type) continue;
        const planned = plan.lines[c.id] || 0, actual = map.get(c.id) || 0;
        seen.add(c.id);
        if (c.archived && !planned && !actual) continue;
        out.push(row(c, planned, actual));
      }
      let loose = 0;
      for (const [id, v] of map) if (!seen.has(id)) loose += v;
      if (loose) out.push(row({ id: '_none', name: 'Uncategorized', sys: true, type, color: '#64748b', icon: 'tag', bucket: 'wants' }, 0, loose));
      return out;
    };
    const expense = build('expense', agg.exp), income = build('income', agg.inc);
    const t = {
      plannedIncome: U.sum(income, r => r.planned), actualIncome: agg.income,
      plannedExpense: U.sum(expense, r => r.planned), actualExpense: agg.expense,
      plannedSavings: plan.savings || 0, actualSaved: agg.saved,
    };
    t.unassigned = t.plannedIncome - t.plannedExpense - t.plannedSavings;
    return { income, expense, totals: t, hasPlan: !!Q.planKey(month), explicit: !!S.state.budgets[month] };
  });

  /* ---------- goals ---------- */
  Q.goalInfo = g => cached('g:' + g.id, () => {
    const sign = t => (t.toAccountId === g.accountId ? t.amount : -t.amount);
    const txs = S.state.transactions.filter(t => t.goalId === g.id);
    const today = U.today(), from = U.addDays(today, -90);
    const saved = (g.initial || 0) + U.sum(txs, sign), target = g.target || 0;
    const remaining = Math.max(0, target - saved);
    const done = target > 0 && saved >= target;
    const avg = Math.max(0, Math.round(U.sum(txs.filter(t => t.date >= from && t.date <= today), sign) / 3));
    let monthsLeft = null, need = null, status = done ? 'done' : 'open';
    if (!done && g.deadline) {
      monthsLeft = Math.max(0, U.diffMonths(U.curMonth(), g.deadline.slice(0, 7)));
      need = Math.ceil(remaining / Math.max(1, monthsLeft));
      status = g.deadline < today ? 'overdue' : (avg >= need ? 'ontrack' : 'behind');
    }
    const eta = !done && avg > 0 ? U.addMonths(today, Math.ceil(remaining / avg)) : null;
    return { saved, target, remaining, pct: target ? U.clamp(saved / target, 0, 1) : 0, done, avg, monthsLeft, need, eta, status, count: txs.length };
  });

  /* ---------- scheduled / recurring ---------- */
  Q.occurrence = (r, i) => {
    const s = r.startDate, a = U.dayOfMonth(s);
    let d;
    switch (r.frequency) {
      case 'weekly': d = U.addDays(s, 7 * i); break;
      case 'biweekly': d = U.addDays(s, 14 * i); break;
      case 'quarterly': d = U.addMonths(s, 3 * i, a); break;
      case 'yearly': d = U.addMonths(s, 12 * i, a); break;
      default: d = U.addMonths(s, i, a);
    }
    return r.endDate && d > r.endDate ? null : d;
  };
  Q.nextOccurrence = r => r.active === false ? null : Q.occurrence(r, r.count || 0);
  Q.perMonth = r => r.amount * ({ weekly: 52 / 12, biweekly: 26 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 }[r.frequency] || 1);
  /** Occurrences from today-ish through `days` ahead (includes overdue, unconfirmed ones). */
  Q.upcoming = (days = 30) => cached('up:' + days, () => {
    const end = U.addDays(U.today(), days), today = U.today(), out = [];
    for (const r of S.state.recurring) {
      if (r.active === false) continue;
      for (let i = r.count || 0, n = 0; n < 40; i++, n++) {
        const d = Q.occurrence(r, i);
        if (!d || d > end) break;
        out.push({ r, date: d, index: i, overdue: d < today });
      }
    }
    return out.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  });
  Q.pending = () => Q.upcoming(0).filter(u => u.date <= U.today());

  /* ---------- health ---------- */
  Q.avgMonthlyExpense = () => {
    const cm = U.curMonth(), arr = [];
    for (let i = 1; i <= 3; i++) { const a = Q.month(U.addMonthKey(cm, -i)); if (a.count) arr.push(a.expense); }
    if (!arr.length) return Q.month(cm).expense;
    return Math.round(U.sum(arr) / arr.length);
  };
  Q.savingsBalance = () => U.sum(S.state.accounts.filter(a => Q.accType(a).saving), a => Q.balance(a.id));

  Q.health = month => cached('health:' + month, () => {
    const a = Q.month(month), set = S.state.settings;
    if (!a.income && !a.expense) return null;
    const parts = [];
    const target = Math.max(1, set.savingsTarget) / 100;
    if (a.income > 0) {
      const rate = (a.income - a.expense) / a.income;
      parts.push({ key: 'rate', label: t('Savings rate'), w: 40, score: U.clamp(rate / target, 0, 1), detail: t('{pct} of income kept (target {target}%)', { pct: U.fmtPct(rate), target: set.savingsTarget }) });
    }
    const rows = Q.budgetRows(month).expense.filter(r => r.planned > 0);
    if (rows.length) {
      const ok = rows.filter(r => r.actual <= r.planned).length;
      parts.push({ key: 'budget', label: t('Budget discipline'), w: 30, score: ok / rows.length, detail: t('{ok} of {total} categories within budget', { ok, total: rows.length }) });
    }
    const avgExp = Q.avgMonthlyExpense();
    if (avgExp > 0) {
      const months = Q.savingsBalance() / avgExp;
      parts.push({ key: 'fund', label: t('Emergency cushion'), w: 30, score: U.clamp(months / set.emergencyMonths, 0, 1), detail: t('Savings cover {months} months (target {target})', { months: Math.max(0, months).toFixed(1), target: set.emergencyMonths }) });
    }
    if (!parts.length) return null;
    const wsum = U.sum(parts, p => p.w), score = Math.round(100 * U.sum(parts, p => p.w * p.score) / wsum);
    const label = score >= 80 ? t('Excellent') : score >= 60 ? t('Good') : score >= 40 ? t('Fair') : t('Needs attention');
    return { score, label, parts };
  });

  /* ---------- insights ---------- */
  Q.insights = month => cached('ins:' + month, () => {
    const out = [], today = U.today(), isCur = month === U.curMonth(), set = S.state.settings;
    const a = Q.month(month), prev = Q.month(U.addMonthKey(month, -1)), br = Q.budgetRows(month), $ = U.money;
    const sep = I18N.lang === 'ar' ? '، ' : ', ';
    const dim = U.daysInMonth(+month.slice(0, 4), +month.slice(5, 7)), day = isCur ? +today.slice(8, 10) : dim;

    const over = br.expense.filter(r => r.planned > 0 && r.actual > r.planned).sort((x, y) => (y.actual - y.planned) - (x.actual - x.planned));
    if (over.length) out.push({ kind: 'bad', icon: 'alert', title: t('Over budget: {n}', { n: U.plural(over.length, 'category') }),
      text: over.slice(0, 3).map(r => t('{name} by {amount}', { name: Q.catName(r.cat), amount: $(r.actual - r.planned) })).join(sep), href: '#/budget' });
    const near = br.expense.filter(r => r.planned > 0 && r.ratio >= 0.85 && r.ratio <= 1);
    if (near.length) out.push({ kind: 'warn', icon: 'alert', title: t('Close to the limit: {n}', { n: U.plural(near.length, 'category') }),
      text: near.slice(0, 3).map(r => `${Q.catName(r.cat)} ${U.fmtPct(r.ratio)}`).join(sep), href: '#/budget' });

    if (isCur && br.totals.plannedExpense > 0 && dim - day > 0) {
      const left = br.totals.plannedExpense - br.totals.actualExpense;
      if (left > 0) out.push({ kind: 'info', icon: 'sparkles', title: t('{amount} a day is safe to spend', { amount: $(Math.floor(left / (dim - day + 1))) }),
        text: t('{amount} of budget remains for the next {days}.', { amount: $(left), days: U.plural(dim - day + 1, 'day') }), href: '#/budget' });
    }

    if (a.income > 0 && (!isCur || day >= 10 || a.expense > 0)) {
      const rate = (a.income - a.expense) / a.income, target = set.savingsTarget / 100;
      if (rate >= target) out.push({ kind: 'good', icon: 'trending-up', title: t('Saving {pct} of income', { pct: U.fmtPct(rate) }), text: t('That is above your {target}% target.', { target: set.savingsTarget }), href: '#/stats' });
      else if (rate >= 0) out.push({ kind: 'warn', icon: 'trending-up', title: t('Savings rate is {pct}', { pct: U.fmtPct(rate) }), text: t('Reaching {target}% means keeping another {amount} this month.', { target: set.savingsTarget, amount: $(Math.round(a.income * target - (a.income - a.expense))) }), href: '#/stats' });
      else out.push({ kind: 'bad', icon: 'alert', title: t('Spending is above income'), text: t('Expenses exceed income by {amount} this month.', { amount: $(a.expense - a.income) }), href: '#/stats' });
    }

    const skip = a.impExp.get(1) || 0;
    if (a.expense > 0 && skip >= 10 * U.currency().pow && skip / a.expense >= 0.1) out.push({ kind: 'info', icon: 'tag', title: t('{pct} of your spending was marked “Not needed”', { pct: U.fmtPct(skip / a.expense) }),
      text: t('That is {amount} you could keep.', { amount: $(skip) }), href: '#/transactions?imp=1&month=' + month });

    if (prev.count && (!isCur || day >= 10)) {
      const scale = isCur ? day / dim : 1;
      let best = null;
      for (const [id, v] of a.exp) {
        const p = (prev.exp.get(id) || 0) * scale, d = v - p;
        if (p > 0 && v >= p * 1.3 && d >= 20 * U.currency().pow && (!best || d > best.d)) best = { id, v, p, d };
      }
      const c = best && Q.cat(best.id);
      if (c) out.push({ kind: 'info', icon: 'trending-up', title: t('{name} is up {pct}', { name: Q.catName(c), pct: U.fmtPct(best.d / best.p) }),
        text: isCur ? t('{amount} more than at this point last month.', { amount: $(best.d) }) : t('{amount} more than last month.', { amount: $(best.d) }), href: '#/transactions?cat=' + c.id });
    }

    const soon = Q.upcoming(7).filter(u => u.r.type === 'expense');
    if (soon.length) out.push({ kind: 'info', icon: 'calendar', title: t('Due in the next 7 days: {n}', { n: U.plural(soon.length, 'bill') }),
      text: t('{amount} in total: {names}.', { amount: $(U.sum(soon, u => u.r.amount)), names: soon.slice(0, 3).map(u => u.r.name).join(sep) }), href: '#/scheduled' });

    for (const g of S.state.goals) {
      const gi = Q.goalInfo(g);
      if (gi.status === 'behind' || gi.status === 'overdue') {
        out.push(gi.status === 'overdue'
          ? { kind: 'warn', icon: 'target', title: t('{name} is past its target date', { name: g.name }), text: t('{amount} still to go.', { amount: $(gi.remaining) }), href: '#/goals' }
          : { kind: 'warn', icon: 'target', title: t('{name} is behind schedule', { name: g.name }), text: t('Needs {amount} a month to finish by {date}.', { amount: $(gi.need), date: U.fmtDate(g.deadline, 'med') }), href: '#/goals' });
        break;
      }
    }
    const rank = { bad: 0, warn: 1, info: 2, good: 3 };
    return out.sort((x, y) => rank[x.kind] - rank[y.kind]).slice(0, 5);
  });

  /* ---------- statistics: day / week / month / year ---------- */
  Q.dayTotals = () => cached('days', () => {
    const m = new Map();
    for (const x of S.state.transactions) {
      let d = m.get(x.date);
      if (!d) m.set(x.date, d = { income: 0, expense: 0, count: 0 });
      d.count++;
      if (x.type === 'income') d.income += x.amount; else if (x.type === 'expense') d.expense += x.amount;
    }
    return m;
  });
  /** Income / expense over an inclusive date range, from the per-day index. */
  Q.sumDays = (from, to) => {
    const m = Q.dayTotals(); let income = 0, expense = 0, count = 0;
    for (let d = from; d <= to; d = U.addDays(d, 1)) { const x = m.get(d); if (x) { income += x.income; expense += x.expense; count += x.count; } }
    return { income, expense, net: income - expense, count };
  };
  /** The day / week / month / year containing `anchor`, as an inclusive [from, to]. */
  Q.periodRange = (kind, anchor) => {
    switch (kind) {
      case 'day': return [anchor, anchor];
      case 'week': { const f = U.weekStart(anchor, S.state.settings.weekStart); return [f, U.addDays(f, 6)]; }
      case 'year': return [U.yearStart(anchor.slice(0, 4)), U.yearEnd(anchor.slice(0, 4))];
      default: { const k = anchor.slice(0, 7); return [U.monthStart(k), U.monthEnd(k)]; }
    }
  };
  Q.shiftAnchor = (kind, anchor, n) => kind === 'day' ? U.addDays(anchor, n) : kind === 'week' ? U.addDays(anchor, 7 * n)
    : kind === 'year' ? U.addMonths(anchor, 12 * n, 1) : U.addMonths(anchor, n, 1);
  Q.periodLabel = (kind, anchor) => {
    const [f, to] = Q.periodRange(kind, anchor);
    return kind === 'day' ? U.fmtDate(anchor, 'med') : kind === 'week' ? U.fmtRange(f, to) : kind === 'year' ? anchor.slice(0, 4) : U.fmtMonth(anchor.slice(0, 7));
  };
  const bar = (from, to, label, title, cur) => ({ from, to, label, title, cur, ...Q.sumDays(from, to) });
  /** Bars for a trend chart that ends at `anchor`: 14 days, 12 weeks, 12 months or 5 years. */
  Q.trend = (kind, anchor = U.today()) => cached(`trend:${kind}:${anchor}`, () => {
    const out = [];
    if (kind === 'day') for (let i = 13; i >= 0; i--) { const d = U.addDays(anchor, -i); out.push(bar(d, d, U.fmtDate(d, 'day'), U.fmtDate(d, 'long'), i === 0)); }
    else if (kind === 'week') {
      const w0 = U.weekStart(anchor, S.state.settings.weekStart);
      for (let i = 11; i >= 0; i--) { const f = U.addDays(w0, -7 * i), e = U.addDays(f, 6); out.push(bar(f, e, U.fmtDate(f, 'short'), U.fmtRange(f, e), i === 0)); }
    } else if (kind === 'year') {
      const y = +anchor.slice(0, 4);
      for (let i = 4; i >= 0; i--) out.push(bar(U.yearStart(y - i), U.yearEnd(y - i), String(y - i), String(y - i), i === 0));
    } else {
      const k = anchor.slice(0, 7);
      for (let i = 11; i >= 0; i--) { const mk = U.addMonthKey(k, -i); out.push(bar(U.monthStart(mk), U.monthEnd(mk), U.fmtMonth(mk, 'short'), U.fmtMonth(mk), i === 0)); }
    }
    return out;
  });
  /** Bars inside a selected period: day -> last 14 days, week -> its 7 days, month -> its days, year -> its 12 months. */
  Q.inside = (kind, anchor, range) => cached(`in:${kind}:${anchor}:${range ? range.join() : ''}`, () => {
    if (kind === 'day') return Q.trend('day', anchor);
    const [f, to] = range || Q.periodRange(kind, anchor), out = [];
    if (kind === 'year' || (kind === 'custom' && U.diffDays(f, to) > 92)) {
      for (let k = f.slice(0, 7); k <= to.slice(0, 7); k = U.addMonthKey(k, 1)) {
        const s = k < f.slice(0, 7) ? f : U.monthStart(k), e = U.monthEnd(k) > to ? to : U.monthEnd(k);
        out.push(bar(s, e, U.fmtMonth(k, 'short'), U.fmtMonth(k), false));
      }
    } else for (let d = f; d <= to; d = U.addDays(d, 1)) out.push(bar(d, d, kind === 'week' ? U.fmtDate(d, 'weekday') : U.fmtDate(d, 'day'), U.fmtDate(d, 'long'), d === anchor));
    return out;
  });
  /** Average income / spending per day, week, month and year, measured over the most recent `days` of real data. */
  Q.rhythm = (days = 90) => cached('rhythm:' + days, () => {
    const today = U.today(), sorted = Q.sorted(), first = sorted.length ? sorted[sorted.length - 1].date : today;
    let from = U.addDays(today, -(days - 1)); if (first > from) from = first;
    const n = Math.max(1, U.diffDays(from, today) + 1), s = Q.sumDays(from, today);
    const scale = v => ({ day: Math.round(v / n), week: Math.round(v / n * 7), month: Math.round(v / n * 30.4375), year: Math.round(v / n * 365.25) });
    return { days: n, reliable: n >= 28, hasData: s.count > 0, income: scale(s.income), expense: scale(s.expense), net: scale(s.income - s.expense) };
  });

  /* ---------- ready-made plans ---------- */
  Q.catName = c => !c ? t('Uncategorized') : (c.sys ? t(c.name) : c.name);
  Q.plans = () => [
    { id: 'smart', smart: true, name: t('Smart plan (built from you)'), desc: t('Keeps your essential spending as it really is, trims wants first, and aims for your savings target.'), icon: 'sparkles' },
    { id: 'balanced', name: t('Balanced 50/30/20'), desc: t('Half for needs, 30% for wants, 20% saved. The classic starting point.'), needs: 50, wants: 30, savings: 20, icon: 'pie' },
    { id: 'highcost', name: t('High cost of living 60/20/20'), desc: t('More room for rent and essentials while still saving a fifth.'), needs: 60, wants: 20, savings: 20, icon: 'home' },
    { id: 'starter', name: t('Starter 60/30/10'), desc: t('A gentle plan when you are just beginning to save.'), needs: 60, wants: 30, savings: 10, icon: 'seedling' },
    { id: 'fast', name: t('Fast saver 50/20/30'), desc: t('Cuts wants to build savings or clear debt faster.'), needs: 50, wants: 20, savings: 30, icon: 'trending-up' },
    { id: 'frugal', name: t('Frugal 45/15/40'), desc: t('Aggressive saving for a big goal. Wants stay small.'), needs: 45, wants: 15, savings: 40, icon: 'target' },
  ];

  /** Income to plan with: average of the last 3 completed months, else this month. */
  Q.planIncome = () => {
    const cm = U.curMonth(), vals = [];
    for (let i = 1; i <= 3; i++) { const a = Q.month(U.addMonthKey(cm, -i)); if (a.income > 0) vals.push(a.income); }
    if (vals.length) return { amount: Math.round(U.sum(vals) / vals.length), basis: 'avg', months: vals.length };
    const a = Q.month(cm);
    return a.income > 0 ? { amount: a.income, basis: 'month', months: 1 } : { amount: 0, basis: 'none', months: 0 };
  };
  /** Average monthly figures over the last 3 completed months (this month if there are none). */
  Q.profile = () => cached('profile', () => {
    const cm = U.curMonth(), keys = [];
    for (let i = 1; i <= 3; i++) if (Q.month(U.addMonthKey(cm, -i)).count) keys.push(U.addMonthKey(cm, -i));
    if (!keys.length) keys.push(cm);
    const exp = new Map(), inc = new Map();
    for (const k of keys) {
      const a = Q.month(k);
      a.exp.forEach((v, id) => exp.set(id, (exp.get(id) || 0) + v / keys.length));
      a.inc.forEach((v, id) => inc.set(id, (inc.get(id) || 0) + v / keys.length));
    }
    let needs = 0, wants = 0;
    exp.forEach((v, id) => { const c = Q.cat(id); if (c && c.bucket === 'needs') needs += v; else wants += v; });
    const income = U.sum([...inc.values()]);
    return { exp, inc, needs: Math.round(needs), wants: Math.round(wants), income: Math.round(income), months: keys.length };
  });
  Q.fixedPerCategory = () => {
    const m = new Map();
    for (const r of S.state.recurring) if (r.active !== false && r.type === 'expense' && r.categoryId) m.set(r.categoryId, (m.get(r.categoryId) || 0) + Q.perMonth(r));
    return m;
  };

  /** Turn percentages (or the smart rule) into concrete budget lines for a given monthly income. */
  Q.buildPlan = (plan, income) => {
    if (!(income > 0)) return null;
    const cur = U.currency(), prof = Q.profile(), fixed = Q.fixedPerCategory();
    const unit = Math.max(1, Math.pow(10, Math.floor(Math.log10(Math.max(1, income / cur.pow) / 400)))) * cur.pow;
    const flags = [];
    let shares;
    if (plan.smart) {
      const savingsGoal = Math.round(income * S.state.settings.savingsTarget / 100);
      const needs = Math.min(prof.needs, income);
      const wants = U.clamp(income - needs - savingsGoal, 0, prof.wants);
      shares = { needs: needs / income * 100, wants: wants / income * 100, savings: (income - needs - wants) / income * 100 };
      if (prof.needs + savingsGoal > income) flags.push('needs-tight');
    } else shares = { needs: plan.needs, wants: plan.wants, savings: plan.savings };

    const lines = {};
    const bucketTotal = { needs: Math.round(income * shares.needs / 100), wants: Math.round(income * shares.wants / 100) };
    for (const bucket of ['needs', 'wants']) {
      const cats = Q.cats('expense').filter(c => (c.bucket || 'wants') === bucket);
      if (!cats.length) continue;
      const total = bucketTotal[bucket];
      let w = cats.map(c => prof.exp.get(c.id) || 0);
      if (!U.sum(w)) w = cats.map(() => 1);
      const sw = U.sum(w);
      let v = cats.map((c, i) => total * w[i] / sw);
      // fixed commitments (scheduled bills) are a floor; the shortfall is taken from categories with slack
      const floors = cats.map(c => Math.ceil((fixed.get(c.id) || 0) / unit) * unit);
      let deficit = 0;
      v = v.map((x, i) => { if (x < floors[i]) { deficit += floors[i] - x; return floors[i]; } return x; });
      if (deficit > 0) {
        const slack = v.map((x, i) => Math.max(0, x - floors[i])), sl = U.sum(slack);
        if (sl > 0) v = v.map((x, i) => x - Math.min(slack[i], deficit * slack[i] / sl));
      }
      let r = v.map((x, i) => Math.max(floors[i], Math.round(x / unit) * unit));
      const diff = total - U.sum(r);
      if (diff !== 0) { const big = r.indexOf(Math.max(...r)); r[big] = Math.max(floors[big], r[big] + diff); }
      if (U.sum(floors) > total) flags.push(bucket + '-floor');
      cats.forEach((c, i) => { if (r[i] > 0) lines[c.id] = r[i]; });
    }
    // expected income lines, split by recent history (or all on the first income category)
    const incCats = Q.cats('income'), incLines = {};
    if (incCats.length) {
      const hist = incCats.map(c => prof.inc.get(c.id) || 0), hs = U.sum(hist);
      let rem = income;
      incCats.forEach((c, i) => { const share = hs ? Math.round(income * hist[i] / hs) : (i === 0 ? income : 0); if (share > 0) { incLines[c.id] = share; rem -= share; } });
      const first = Object.keys(incLines)[0]; if (first) incLines[first] += rem;
    }
    const spend = U.sum(Object.values(lines));
    return { lines: { ...lines, ...incLines }, savings: Math.max(0, income - spend), shares, flags, expenseTotal: spend, income };
  };
  /** How the user actually splits income today, as percentages. */
  Q.actualSplit = () => {
    const p = Q.profile(), inc = Q.planIncome().amount || p.income;
    if (!inc) return null;
    return { needs: p.needs / inc * 100, wants: p.wants / inc * 100, savings: (inc - p.needs - p.wants) / inc * 100 };
  };

  return Q;
})();
