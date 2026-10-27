'use strict';
/* Actions: every mutation of user data. Each validates input and returns {error} or a result.
   Deletes return what they removed so the UI can offer Undo. */
const A = (() => {
  const A = {};
  const clean = s => String(s ?? '').trim();
  const normTags = t => [...new Set((Array.isArray(t) ? t : String(t || '').split(/[,\s]+/)).map(x => clean(x).replace(/^#/, '').toLowerCase()).filter(Boolean))];

  /* ---------- transactions ---------- */
  A.validateTx = x => {
    if (!['income', 'expense', 'transfer'].includes(x.type)) return t('Choose a type.');
    if (!Number.isFinite(x.amount) || x.amount <= 0) return t('Enter an amount greater than zero.');
    if (!U.isDate(x.date)) return t('Enter a valid date.');
    if (!Q.acc(x.accountId)) return x.type === 'transfer' ? t('Choose the account the money leaves.') : t('Choose an account.');
    if (x.type === 'transfer') {
      if (!Q.acc(x.toAccountId)) return t('Choose the account the money goes to.');
      if (x.toAccountId === x.accountId) return t('Pick two different accounts.');
    }
    return null;
  };
  const build = (t, base) => {
    const tr = t.type === 'transfer';
    return {
      id: (base && base.id) || U.uid('t'), type: t.type, date: t.date, amount: Math.round(t.amount),
      accountId: t.accountId, toAccountId: tr ? t.toAccountId : undefined,
      categoryId: tr ? undefined : (t.categoryId || undefined),
      payee: clean(t.payee), note: clean(t.note), tags: normTags(t.tags), cleared: !!t.cleared,
      goalId: t.goalId || undefined, recurringId: t.recurringId || undefined,
      recurringIndex: t.recurringIndex != null ? t.recurringIndex : undefined,
      createdAt: (base && base.createdAt) || Date.now(),
    };
  };
  A.addTx = t => {
    const error = A.validateTx(t); if (error) return { error };
    const tx = build(t);
    S.commit(st => { st.transactions.push(tx); });
    return { id: tx.id };
  };
  A.updateTx = (id, t) => {
    const cur = S.state.transactions.find(x => x.id === id);
    if (!cur) return { error: t('That transaction no longer exists.') };
    const error = A.validateTx(t); if (error) return { error };
    const next = build({ ...t, recurringId: cur.recurringId, recurringIndex: cur.recurringIndex }, cur);
    S.commit(st => { st.transactions[st.transactions.indexOf(cur)] = next; });
    return { id };
  };
  A.deleteTx = ids => {
    const set = new Set(ids), removed = S.state.transactions.filter(t => set.has(t.id));
    S.commit(st => { st.transactions = st.transactions.filter(t => !set.has(t.id)); });
    return removed;
  };
  A.restoreTx = list => S.commit(st => { st.transactions.push(...list); });
  A.setCleared = (ids, flag) => {
    const set = new Set(ids);
    S.commit(st => { st.transactions.forEach(t => { if (set.has(t.id)) t.cleared = flag; }); });
  };
  A.recategorize = (ids, categoryId) => {
    const set = new Set(ids);
    S.commit(st => { st.transactions.forEach(t => { if (set.has(t.id) && t.type !== 'transfer') t.categoryId = categoryId || undefined; }); });
  };

  /* ---------- accounts ---------- */
  A.saveAccount = a => {
    const name = clean(a.name);
    if (!name) return { error: t('Give the account a name.') };
    if (!K.ACCOUNT_TYPES[a.type]) return { error: t('Choose an account type.') };
    if (S.state.accounts.some(x => x.id !== a.id && x.name.toLowerCase() === name.toLowerCase())) return { error: t('You already have an account with that name.') };
    const opening = Number.isFinite(a.opening) ? Math.round(a.opening) : 0;
    let id = a.id;
    S.commit(st => {
      if (id) { const x = st.accounts.find(z => z.id === id); Object.assign(x, { name, type: a.type, opening, color: a.color || x.color }); }
      else { id = U.uid('a'); st.accounts.push({ id, name, type: a.type, opening, color: a.color || K.PALETTE[st.accounts.length % K.PALETTE.length] }); }
    });
    return { id };
  };
  A.archiveAccount = (id, flag) => S.commit(st => { const a = st.accounts.find(x => x.id === id); if (a) a.archived = flag; });
  A.deleteAccount = id => {
    if (S.state.transactions.some(t => t.accountId === id || t.toAccountId === id)) return { error: t('This account has transactions. Archive it instead to keep your history.') };
    if (S.state.goals.some(g => g.accountId === id) || S.state.recurring.some(r => r.accountId === id || r.toAccountId === id)) return { error: t('A goal or scheduled item uses this account. Archive it instead.') };
    S.commit(st => { st.accounts = st.accounts.filter(a => a.id !== id); });
    return {};
  };

  /* ---------- categories ---------- */
  A.saveCategory = c => {
    const name = clean(c.name);
    if (!name) return { error: t('Give the category a name.') };
    if (S.state.categories.some(x => x.id !== c.id && x.type === c.type && x.name.toLowerCase() === name.toLowerCase())) return { error: t('That category already exists.') };
    let id = c.id;
    S.commit(st => {
      const body = { name, type: c.type, color: c.color, icon: c.icon || 'tag', bucket: c.type === 'expense' ? (c.bucket || 'wants') : undefined };
      if (id) Object.assign(st.categories.find(x => x.id === id), body);
      else { id = U.uid('c'); st.categories.push({ id, ...body }); }
    });
    return { id };
  };
  A.deleteCategory = id => {
    let n = 0;
    S.commit(st => {
      st.transactions.forEach(t => { if (t.categoryId === id) { t.categoryId = undefined; n++; } });
      st.recurring.forEach(r => { if (r.categoryId === id) r.categoryId = undefined; });
      Object.values(st.budgets).forEach(p => { delete p.lines[id]; });
      st.categories = st.categories.filter(c => c.id !== id);
    });
    return { affected: n };
  };

  /* ---------- budget ---------- */
  const ensureMonth = (st, month) => {
    if (!st.budgets[month]) { const eff = Q.plan(month); st.budgets[month] = { lines: { ...eff.lines }, savings: eff.savings || 0 }; }
    return st.budgets[month];
  };
  A.setBudgetLine = (month, catId, cents) => S.commit(st => {
    const p = ensureMonth(st, month);
    if (cents > 0) p.lines[catId] = Math.round(cents); else delete p.lines[catId];
  });
  A.setSavingsPlan = (month, cents) => S.commit(st => { ensureMonth(st, month).savings = Math.max(0, Math.round(cents) || 0); });
  A.copyBudget = (from, to) => S.commit(st => {
    const src = Q.plan(from);
    st.budgets[to] = { lines: { ...src.lines }, savings: src.savings || 0 };
  });
  A.resetBudget = month => S.commit(st => { delete st.budgets[month]; });
  /** Plan every category at its recent average, rounded up to a tidy figure. */
  A.suggestBudget = month => S.commit(st => {
    const p = ensureMonth(st, month), pow = U.currency().pow, step = 5 * pow;
    for (const c of st.categories) {
      if (c.type !== 'expense' || c.archived) continue;
      const vals = [1, 2, 3].map(i => Q.month(U.addMonthKey(month, -i)).exp.get(c.id) || 0).filter(v => v > 0);
      if (!vals.length) continue;
      p.lines[c.id] = Math.ceil(U.sum(vals) / vals.length / step) * step;
    }
  });

  /** Apply a built plan (see Q.buildPlan) to a month; later months inherit it until they get their own. */
  A.applyPlan = (month, built, planId) => S.commit(st => {
    st.budgets[month] = { lines: { ...built.lines }, savings: Math.max(0, Math.round(built.savings)), planId };
  });

  /* ---------- goals ---------- */
  A.saveGoal = g => {
    const name = clean(g.name);
    if (!name) return { error: t('Give the goal a name.') };
    if (!(g.target > 0)) return { error: t('Enter a target amount greater than zero.') };
    if (!Q.acc(g.accountId)) return { error: t('Choose the account where this money is kept.') };
    if (g.deadline && !U.isDate(g.deadline)) return { error: t('Enter a valid target date.') };
    let id = g.id;
    S.commit(st => {
      const body = { name, target: Math.round(g.target), deadline: g.deadline || undefined, accountId: g.accountId, color: g.color, initial: Math.round(g.initial || 0), note: clean(g.note) };
      if (id) Object.assign(st.goals.find(x => x.id === id), body);
      else { id = U.uid('g'); st.goals.push({ id, ...body }); }
    });
    return { id };
  };
  A.deleteGoal = id => S.commit(st => {
    st.goals = st.goals.filter(g => g.id !== id);
    st.transactions.forEach(t => { if (t.goalId === id) t.goalId = undefined; });
  });
  /** Add to (or take from) a goal. A blank other-account means the money already sits in the goal's account. */
  A.moveGoal = ({ goalId, amount, date, accountId, note, withdraw }) => {
    const g = Q.goalMap().get(goalId);
    if (!g) return { error: t('That goal no longer exists.') };
    if (!(amount > 0)) return { error: t('Enter an amount greater than zero.') };
    if (!U.isDate(date)) return { error: t('Enter a valid date.') };
    if (!accountId) {
      S.commit(st => { const x = st.goals.find(z => z.id === goalId); x.initial = (x.initial || 0) + (withdraw ? -amount : amount); });
      return {};
    }
    if (accountId === g.accountId) return { error: t('Pick a different account than the goal account.') };
    return A.addTx({
      type: 'transfer', date, amount, goalId,
      accountId: withdraw ? g.accountId : accountId, toAccountId: withdraw ? accountId : g.accountId,
      payee: withdraw ? t('Withdrawal from {name}', { name: g.name }) : t('Saved for {name}', { name: g.name }), note,
    });
  };

  /* ---------- scheduled ---------- */
  A.saveRecurring = r => {
    const name = clean(r.name);
    if (!name) return { error: t('Give it a name, like “Rent”.') };
    if (!(r.amount > 0)) return { error: t('Enter an amount greater than zero.') };
    if (!U.isDate(r.startDate)) return { error: t('Enter a valid first date.') };
    if (r.endDate && (!U.isDate(r.endDate) || r.endDate < r.startDate)) return { error: t('The end date must be after the first date.') };
    if (!Q.acc(r.accountId)) return { error: t('Choose an account.') };
    if (r.type === 'transfer' && (!Q.acc(r.toAccountId) || r.toAccountId === r.accountId)) return { error: t('Choose two different accounts.') };
    let id = r.id;
    S.commit(st => {
      const body = {
        name, type: r.type, amount: Math.round(r.amount), accountId: r.accountId, toAccountId: r.type === 'transfer' ? r.toAccountId : undefined,
        categoryId: r.type === 'transfer' ? undefined : (r.categoryId || undefined), payee: clean(r.payee) || name, note: clean(r.note),
        goalId: r.type === 'transfer' ? (r.goalId || undefined) : undefined,
        frequency: r.frequency, startDate: r.startDate, endDate: r.endDate || undefined, autoPost: !!r.autoPost, active: r.active !== false,
      };
      if (id) {
        const x = st.recurring.find(z => z.id === id), moved = x.startDate !== body.startDate || x.frequency !== body.frequency;
        Object.assign(x, body);
        if (moved) { // re-anchor: skip every occurrence on or before the last one already posted
          let i = 0; while (x.lastPosted && Q.occurrence(x, i) && Q.occurrence(x, i) <= x.lastPosted && i < 5000) i++;
          x.count = i;
        }
      } else { id = U.uid('r'); st.recurring.push({ id, count: 0, ...body }); }
    });
    return { id };
  };
  A.deleteRecurring = id => S.commit(st => { st.recurring = st.recurring.filter(r => r.id !== id); });
  A.toggleRecurring = id => S.commit(st => { const r = st.recurring.find(x => x.id === id); if (r) r.active = r.active === false; });

  const post = (st, r, date, amount) => {
    const idx = r.count || 0;
    if (!st.transactions.some(t => t.recurringId === r.id && t.recurringIndex === idx)) {
      st.transactions.push(build({
        type: r.type, date, amount: amount || r.amount, accountId: r.accountId, toAccountId: r.toAccountId, categoryId: r.categoryId,
        payee: r.payee || r.name, note: r.note, goalId: r.goalId, recurringId: r.id, recurringIndex: idx,
      }));
    }
    r.count = idx + 1; r.lastPosted = date;
  };
  /** Post every auto-post occurrence that is due on a draft state. Idempotent. Returns how many were created. */
  A.postDue = (st, today = U.today()) => {
    let n = 0;
    for (const r of st.recurring) {
      if (r.active === false || !r.autoPost) continue;
      for (let guard = 0, d; guard < 400 && (d = Q.occurrence(r, r.count || 0)) && d <= today; guard++) { post(st, r, d); n++; }
    }
    return n;
  };
  A.processRecurring = () => {
    const today = U.today();
    const due = S.state.recurring.some(r => r.active !== false && r.autoPost && (() => { const d = Q.occurrence(r, r.count || 0); return d && d <= today; })());
    if (!due) return 0;
    return S.commit(st => A.postDue(st, today));
  };
  A.confirmOccurrence = (rid, amount) => S.commit(st => {
    const r = st.recurring.find(x => x.id === rid), d = r && Q.occurrence(r, r.count || 0);
    if (r && d) post(st, r, d, amount);
  });
  A.skipOccurrence = rid => S.commit(st => { const r = st.recurring.find(x => x.id === rid); if (r) r.count = (r.count || 0) + 1; });

  /* ---------- import / export ---------- */
  A.importJSON = text => {
    let obj;
    try { obj = JSON.parse(text); } catch (e) { return { error: t('That file is not valid JSON.') }; }
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.transactions) || !Array.isArray(obj.accounts)) return { error: t('This does not look like a Ledgerly backup.') };
    S.replace(obj);
    S.state.meta.onboarded = true;
    S.persist();
    return { accounts: S.state.accounts.length, transactions: S.state.transactions.length };
  };
  A.markBackup = () => S.commit(st => { st.meta.lastBackup = U.today(); }, { silent: true });

  A.exportCsv = (list = Q.sorted()) => {
    const accs = Q.accMap(), cats = Q.catMap();
    const rows = [['Date', 'Type', 'Account', 'To account', 'Category', 'Payee', 'Note', 'Tags', 'Amount', 'Cleared']];
    for (const t of list) rows.push([
      t.date, t.type, (accs.get(t.accountId) || {}).name, t.type === 'transfer' ? (accs.get(t.toAccountId) || {}).name : '',
      (cats.get(t.categoryId) || {}).name || '', t.payee, t.note, (t.tags || []).join(' '),
      ((t.type === 'expense' ? -1 : 1) * t.amount / U.currency().pow).toFixed(U.currency().digits), t.cleared ? 'yes' : 'no',
    ]);
    return U.csv(rows);
  };

  /** Parse a bank CSV into draft rows. opts.dateOrder: 'mdy' | 'dmy' for ambiguous dates. */
  A.parseBankCsv = (text, opts = {}) => {
    const grid = U.parseCsv(text);
    if (grid.length < 2) return { error: t('The file has no rows.') };
    const head = grid[0].map(h => clean(h).toLowerCase());
    const find = (...names) => head.findIndex(h => names.some(n => h === n || h.includes(n)));
    const ix = {
      date: find('date', 'posted'), amount: find('amount', 'value'), debit: find('debit', 'withdraw'), credit: find('credit', 'deposit'),
      payee: find('payee', 'description', 'merchant', 'name', 'memo', 'details'), cat: find('category'), type: head.indexOf('type'), note: find('note', 'memo'),
    };
    if (ix.date < 0 || (ix.amount < 0 && ix.debit < 0 && ix.credit < 0)) return { error: t('Could not find Date and Amount columns. The first row should contain headers like Date, Description, Amount.') };
    const parseDate = s => {
      s = clean(s);
      if (U.isDate(s.slice(0, 10)) && /^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
      const m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
      if (!m) return null;
      let a = +m[1], b = +m[2], y = +m[3]; if (y < 100) y += 2000;
      let mo = a, d = b;
      if (a > 12) { d = a; mo = b; } else if (b > 12) { mo = a; d = b; } else if (opts.dateOrder === 'dmy') { d = a; mo = b; }
      const out = `${y}-${U.pad(mo)}-${U.pad(d)}`;
      return U.isDate(out) ? out : null;
    };
    const rows = [], errors = [];
    grid.slice(1).forEach((r, i) => {
      const date = parseDate(r[ix.date]);
      let amt = NaN;
      if (ix.amount >= 0) amt = U.parseAmount(r[ix.amount]);
      else {
        const dr = U.parseAmount(r[ix.debit]), cr = U.parseAmount(r[ix.credit]);
        amt = Number.isFinite(cr) && cr ? cr : Number.isFinite(dr) && dr ? -Math.abs(dr) : NaN;
      }
      if (!date || !Number.isFinite(amt) || amt === 0) { errors.push(t('Row {n}: {why}', { n: i + 2, why: !date ? t('unreadable date') : t('unreadable amount') })); return; }
      let type = amt < 0 ? 'expense' : 'income';
      if (ix.type >= 0) { const t = clean(r[ix.type]).toLowerCase(); if (t.startsWith('inc')) type = 'income'; else if (t.startsWith('exp')) type = 'expense'; }
      rows.push({ date, type, amount: Math.abs(amt), payee: clean(r[ix.payee]), note: ix.note >= 0 && ix.note !== ix.payee ? clean(r[ix.note]) : '', categoryName: ix.cat >= 0 ? clean(r[ix.cat]) : '' });
    });
    return { rows, errors };
  };
  A.importRows = (rows, accountId) => {
    if (!Q.acc(accountId)) return { error: t('Choose the account these rows belong to.') };
    const byName = new Map(S.state.categories.map(c => [c.type + ':' + c.name.toLowerCase(), c.id]));
    const have = new Set(S.state.transactions.filter(t => t.accountId === accountId).map(t => `${t.date}|${t.type}|${t.amount}|${(t.payee || '').toLowerCase()}`));
    let added = 0, skipped = 0;
    S.commit(st => {
      for (const r of rows) {
        const sig = `${r.date}|${r.type}|${r.amount}|${(r.payee || '').toLowerCase()}`;
        if (have.has(sig)) { skipped++; continue; }
        have.add(sig);
        st.transactions.push(build({ ...r, accountId, categoryId: byName.get(r.type + ':' + (r.categoryName || '').toLowerCase()) }));
        added++;
      }
    });
    return { added, skipped };
  };

  return A;
})();
