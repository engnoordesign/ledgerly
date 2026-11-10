'use strict';
/* Actions: every mutation of user data. Each validates input and returns {error} or a result.
   Deletes return what they removed so the UI can offer Undo. */
const A = (() => {
  const A = {};
  const clean = s => String(s ?? '').trim();
  const normTags = t => [...new Set((Array.isArray(t) ? t : String(t || '').split(/[,\s]+/)).map(x => clean(x).replace(/^#/, '').toLowerCase()).filter(Boolean))];

  /* ---------- transactions ---------- */
  A.validateTx = x => {
    if (!['income', 'expense'].includes(x.type)) return t('Choose a type.');
    if (!Number.isFinite(x.amount) || x.amount <= 0) return t('Enter an amount greater than zero.');
    if (!U.isDate(x.date)) return t('Enter a valid date.');
    return null;
  };
  const normImp = v => { const n = Math.round(+v); return n >= 1 && n <= 4 ? n : undefined; };   // 1 = lowest, 4 = highest
  const build = (t, base) => ({
    id: (base && base.id) || U.uid('t'), type: t.type, date: t.date, amount: Math.round(t.amount),
    accountId: Q.main().id,
    categoryId: t.categoryId || undefined,
    payee: clean(t.payee), note: clean(t.note), tags: normTags(t.tags !== undefined ? t.tags : base && base.tags),
    purpose: clean(t.purpose).slice(0, 200) || undefined, importance: normImp(t.importance),
    recurringId: t.recurringId || undefined,
    recurringIndex: t.recurringIndex != null ? t.recurringIndex : undefined,
    createdAt: (base && base.createdAt) || Date.now(),
  });
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
  A.recategorize = (ids, categoryId) => {
    const set = new Set(ids);
    S.commit(st => { st.transactions.forEach(t => { if (set.has(t.id)) t.categoryId = categoryId || undefined; }); });
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
  /** A category the user typed: matched by name (case-insensitive, built-in names in either language), else created. */
  // "الراتب" and "راتب", "أجرة" and "اجره" are the same word to a person typing quickly
  const loose = s => clean(s).toLowerCase().replace(/[\u064B-\u065F\u0670]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .split(/\s+/).map(w => w.replace(/^(ال)(?=..)/, '')).join(' ');
  A.findCategory = (type, name) => {
    const n = clean(name).toLowerCase();
    if (!n) return null;
    const list = S.state.categories.filter(c => c.type === type);
    const exact = list.find(c => c.name.toLowerCase() === n || Q.catName(c).toLowerCase() === n);
    if (exact) return exact;
    const l = loose(n);
    return list.find(c => loose(c.name) === l || loose(Q.catName(c)) === l || (c.sys && loose(I18N.dicts.ar ? I18N.dicts.ar[c.name] || '' : '') === l)) || null;
  };
  // a fitting icon for a new category, from words in English or Arabic
  const ICON_WORDS = [
    ['home', /rent|house|home|إيجار|ايجار|سكن|بيت|منزل/], ['cart', /grocer|market|food|supermarket|بقال|سوق|مواد|طعام|اكل|أكل/], ['utensils', /restaurant|dining|lunch|dinner|مطعم|غداء|عشاء/],
    ['car', /car|fuel|petrol|gas|taxi|transport|سيار|بنزين|وقود|تكسي|نقل|مواصلات/], ['zap', /electric|power|water|utilit|كهرباء|ماء|مولد/], ['heart', /health|doctor|medic|pharm|صح|طبيب|دواء|صيدلي|علاج/],
    ['phone', /phone|internet|mobile|هاتف|انترنت|إنترنت|موبايل|رصيد/], ['book', /school|educat|course|book|مدرس|تعليم|دراس|كتب|جامع/], ['coffee', /coffee|cafe|قهوة|مقهى|كافي/],
    ['bag', /shop|cloth|مشتريات|ملابس|تسوق/], ['gift', /gift|donat|charity|هدي|تبرع|صدق|زكاة/], ['plane', /travel|trip|flight|سفر|رحل|طيران/], ['film', /movie|fun|game|entertain|ترفيه|العاب|ألعاب|سينما/],
    ['briefcase', /salary|wage|job|work|راتب|معاش|وظيف|عمل/], ['banknote', /sale|sell|freelance|cash|بيع|مبيعات|ربح|أرباح|ارباح/], ['trending-up', /invest|profit|dividend|استثمار/],
    ['repeat', /subscri|اشتراك/], ['shield', /insur|تأمين|تامين/],
  ];
  const guessIcon = name => { const n = String(name).toLowerCase(); const hit = ICON_WORDS.find(([, re]) => re.test(n)); return hit ? hit[0] : 'tag'; };
  A.ensureCategory = (type, name, importance) => {
    if (type !== 'income' && type !== 'expense') return '';
    const label = clean(name).replace(/\s+/g, ' ').slice(0, 40);
    if (!label) return '';
    const found = A.findCategory(type, label);
    if (found) { if (found.archived) S.commit(st => { st.categories.find(c => c.id === found.id).archived = false; }, { silent: true }); return found.id; }
    const id = U.uid('c');
    S.commit(st => {
      st.categories.push({ id, name: label, type, icon: guessIcon(label), color: K.PALETTE[st.categories.length % K.PALETTE.length],
        bucket: type === 'expense' ? (+importance >= 3 ? 'needs' : 'wants') : undefined });
    }, { silent: true });
    return id;
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

  /* ---------- scheduled ---------- */
  A.saveRecurring = r => {
    const name = clean(r.name);
    if (!name) return { error: t('Give it a name, like “Rent”.') };
    if (!(r.amount > 0)) return { error: t('Enter an amount greater than zero.') };
    if (!U.isDate(r.startDate)) return { error: t('Enter a valid first date.') };
    if (r.endDate && (!U.isDate(r.endDate) || r.endDate < r.startDate)) return { error: t('The end date must be after the first date.') };
    if (!['income', 'expense'].includes(r.type)) return { error: t('Choose a type.') };
    let id = r.id;
    S.commit(st => {
      const body = {
        name, type: r.type, amount: Math.round(r.amount), accountId: Q.main().id,
        categoryId: r.categoryId || undefined, payee: clean(r.payee) || name, note: clean(r.note),
        purpose: clean(r.purpose).slice(0, 200) || undefined, importance: normImp(r.importance),
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
        type: r.type, date, amount: amount || r.amount, categoryId: r.categoryId,
        payee: r.payee || r.name, note: r.note, purpose: r.purpose, importance: r.importance, recurringId: r.id, recurringIndex: idx,
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
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.transactions)) return { error: t('This does not look like a Ledgerly backup.') };
    S.replace(obj);
    S.state.meta.onboarded = true;
    S.persist();
    return { transactions: S.state.transactions.length };
  };
  A.markBackup = () => S.commit(st => { st.meta.lastBackup = U.today(); }, { silent: true });

  const amountText = (t, signed) => (((signed && t.type === 'expense') ? -1 : 1) * t.amount / U.currency().pow).toFixed(U.currency().digits);
  /** Transactions as CSV (opens in Excel). Includes week and month columns so a spreadsheet can total by day, week or month. */
  A.exportCsv = (list = Q.sorted()) => {
    const cats = Q.catMap(), ws = S.state.settings.weekStart;
    const rows = [['Date', 'Week starting', 'Month', 'Type', 'Category', 'Payee', 'Purpose', 'Importance (1-4)', 'Note', 'Amount']];
    for (const t of list) rows.push([
      t.date, U.weekStart(t.date, ws), t.date.slice(0, 7), t.type, Q.catName(cats.get(t.categoryId)), t.payee, t.purpose || '', t.importance || '', t.note,
      amountText(t, true),
    ]);
    return U.csv(rows);
  };
  /** Totals per day, week or month as CSV. */
  A.exportSummaryCsv = (list, kind) => {
    const name = { day: 'Day', week: 'Week', month: 'Month' }[kind];
    const rows = [[name, 'From', 'To', 'Income', 'Expenses', 'Net', 'Transactions']];
    const fx = c => (c / U.currency().pow).toFixed(U.currency().digits);
    for (const g of Q.groupBy(list, kind, 'old')) rows.push([kind === 'month' ? g.key : g.from, g.from, g.to, fx(g.income), fx(g.expense), fx(g.net), g.count]);
    return U.csv(rows);
  };

  /** Parse a CSV (a Ledgerly export, a spreadsheet or a bank statement) into draft rows. opts.dateOrder: 'mdy' | 'dmy' for ambiguous dates. */
  A.parseBankCsv = (text, opts = {}) => {
    const grid = U.parseCsv(text);
    if (grid.length < 2) return { error: t('The file has no rows.') };
    const head = grid[0].map(h => clean(h).toLowerCase());
    const find = (...names) => head.findIndex(h => names.some(n => h === n || h.includes(n)));
    const exact = (...names) => head.findIndex(h => names.includes(h));
    const ix = {
      date: find('date', 'posted', 'التاريخ', 'تاريخ'), amount: find('amount', 'value', 'المبلغ', 'مبلغ'), debit: find('debit', 'withdraw', 'مدين', 'سحب'), credit: find('credit', 'deposit', 'دائن', 'إيداع', 'ايداع'),
      payee: find('payee', 'description', 'merchant', 'details', 'الوصف', 'الجهة', 'البيان'), cat: find('category', 'الفئة', 'التصنيف', 'الصنف'),
      type: exact('type', 'النوع'), note: find('note', 'memo', 'ملاحظة', 'ملاحظات'), purpose: find('purpose', 'الغرض', 'السبب'), imp: find('importance', 'الأهمية', 'الاهمية'),
    };
    if (ix.payee < 0) ix.payee = find('name', 'الاسم');
    if (ix.date < 0 || (ix.amount < 0 && ix.debit < 0 && ix.credit < 0)) return { error: t('Could not find Date and Amount columns. The first row should contain headers like Date, Description, Amount.') };
    const parseDate = s => {
      s = clean(s).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
      if (U.isDate(s.slice(0, 10)) && /^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
      const iso = s.match(/^(\d{4})[\/.](\d{1,2})[\/.](\d{1,2})/);
      if (iso) { const out = `${iso[1]}-${U.pad(+iso[2])}-${U.pad(+iso[3])}`; return U.isDate(out) ? out : null; }
      const m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
      if (!m) return null;
      let a = +m[1], b = +m[2], y = +m[3]; if (y < 100) y += 2000;
      let mo = a, d = b;
      if (a > 12) { d = a; mo = b; } else if (b > 12) { mo = a; d = b; } else if (opts.dateOrder === 'dmy') { d = a; mo = b; }
      const out = `${y}-${U.pad(mo)}-${U.pad(d)}`;
      return U.isDate(out) ? out : null;
    };
    const typeOf = v => {
      v = clean(v).toLowerCase();
      if (/^(inc|in$|دخل|إيراد|ايراد|وارد)/.test(v)) return 'income';
      if (/^(exp|out$|مصروف|مصاريف|صرف|نفق)/.test(v)) return 'expense';
      if (/^(tra|تحويل)/.test(v)) return 'transfer';   // old exports: recognised so the row can be skipped
      return null;
    };
    const cell = (r, i) => (i >= 0 ? clean(r[i]) : '');
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
      const type = typeOf(cell(r, ix.type)) || (amt < 0 ? 'expense' : 'income');
      const imp = Math.round(+cell(r, ix.imp));
      rows.push({
        date, type, amount: Math.abs(amt), payee: cell(r, ix.payee), note: ix.note >= 0 && ix.note !== ix.payee ? cell(r, ix.note) : '',
        categoryName: cell(r, ix.cat), purpose: cell(r, ix.purpose), importance: imp >= 1 && imp <= 4 ? imp : undefined,
      });
    });
    const skipped = rows.filter(r => r.type === 'transfer').length;
    return { rows: rows.filter(r => r.type !== 'transfer'), errors: skipped ? [...errors, t('{n} transfers were skipped. Ledgerly only keeps income and expenses.', { n: skipped })] : errors };
  };
  /** Add parsed rows. Categories are matched or created; rows already in the ledger are skipped. */
  A.importRows = rows => {
    const sigOf = x => `${x.date}|${x.type}|${x.amount}|${(x.payee || '').toLowerCase()}`;
    const have = new Set(S.state.transactions.map(sigOf));
    const before = S.state.categories.length;
    const ready = rows.map(r => ({ ...r }));
    for (const r of ready) if (r.categoryName) r.categoryId = A.ensureCategory(r.type, r.categoryName, r.importance);
    let added = 0, skipped = 0;
    S.commit(st => {
      for (const r of ready) {
        const sig = sigOf(r);
        if (have.has(sig)) { skipped++; continue; }
        have.add(sig);
        st.transactions.push(build(r));
        added++;
      }
    });
    return { added, skipped, newCategories: S.state.categories.length - before };
  };

  return A;
})();
