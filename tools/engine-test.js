/* Headless engine tests: node tools/engine-test.js
   Loads the real source files into one vm context with minimal browser stubs. */
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.join(__dirname, '..');
const store = {};
const ctx = {
  console, setTimeout, clearTimeout, Intl, Date, Math, JSON, Number, String, Array, Object, Map, Set, Blob: class {}, URL: {},
  navigator: { language: 'en-US' },
  localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => delete store[k] },
  document: { documentElement: { removeAttribute() {}, dataset: {} }, addEventListener() {}, createElement: () => ({}) },
  window: { addEventListener() {} },
};
vm.createContext(ctx);
const load = f => vm.runInContext(fs.readFileSync(path.join(root, 'js', f), 'utf8'), ctx, { filename: f });
['util.js', 'i18n.js', 'store.js', 'engine.js', 'actions.js', 'seed.js'].forEach(load);
if (fs.existsSync(path.join(root, 'js', 'lang-ar.js'))) load('lang-ar.js');
const run = code => vm.runInContext(code, ctx);

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('  FAIL: ' + msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${a}, expected ${b})`);

/* ---- money parsing ---- */
run(`U.setCurrency('USD','en-US')`);
eq(run(`U.parseAmount('1,234.56')`), 123456, 'parse 1,234.56');
eq(run(`U.parseAmount('1234.5')`), 123450, 'parse 1234.5');
eq(run(`U.parseAmount('12')`), 1200, 'parse 12');
eq(run(`U.parseAmount('$ 99.99')`), 9999, 'parse $ 99.99');
eq(run(`U.parseAmount('1.234,56')`), 123456, 'parse european');
eq(run(`U.parseAmount('(45.00)')`), -4500, 'parse parentheses negative');
eq(run(`U.parseAmount('١٢٣٫٥')`), 12350, 'parse arabic-indic digits');
eq(run(`isNaN(U.parseAmount('abc'))`), true, 'parse junk is NaN');
eq(run(`U.money(-123456)`), '−$1,234.56', 'format negative');
eq(run(`U.money(5, {sign:true})`), '+$0.05', 'format signed');
run(`U.setCurrency('JPY','en-US')`);
eq(run(`U.parseAmount('1,500')`), 1500, 'JPY has no decimals');
run(`U.setCurrency('KWD','en-US')`);
eq(run(`U.parseAmount('1.234')`), 1234, 'KWD 3 decimals');
run(`U.setCurrency('USD','en-US')`);

/* ---- dates ---- */
eq(run(`U.addMonths('2026-01-31', 1)`), '2026-02-28', 'month-end clamp');
eq(run(`U.addMonths('2026-01-31', 2, 31)`), '2026-03-31', 'anchor day restored');
eq(run(`U.weekStart('2026-10-27', 1)`), '2026-10-26', 'week starts monday');
eq(run(`U.weekStart('2026-10-27', 6)`), '2026-10-24', 'week starts saturday');
eq(run(`U.diffMonths('2026-01', '2026-10')`), 9, 'diffMonths');

/* ---- demo year ---- */
run(`S.state = Seed.demo({ lang: 'en', currency: 'USD', locale: 'en-US', savingsTarget: 20, emergencyMonths: 6, weekStart: 1, theme: 'system', name: '' }); S.version++; S.applySettings();`);
const n = run(`S.state.transactions.length`);
ok(n > 400, `demo has plenty of transactions (${n})`);
eq(run(`S.state.transactions.every(x => Number.isInteger(x.amount) && x.amount > 0)`), true, 'all amounts positive integers');
eq(run(`S.state.transactions.filter(x => x.date > U.today()).length`), 0, 'no future transactions');
eq(run(`new Set(S.state.transactions.map(x => x.id)).size`), n, 'ids unique');

// accounting identity: net worth == sum of openings + income - expenses
const nw = run(`Q.netWorth().net`);
const ident = run(`U.sum(S.state.accounts, a => a.opening) + U.sum(S.state.transactions.filter(x => x.type==='income'), x => x.amount) - U.sum(S.state.transactions.filter(x => x.type==='expense'), x => x.amount)`);
eq(nw, ident, 'net worth equals openings + income - expenses (transfers net to zero)');
eq(run(`U.sum([...Q.balances().values()])`), nw, 'sum of balances equals net worth');
eq(run(`Q.netWorthSeries(12)[11].value`), nw, 'net-worth series ends at current net worth');

// month aggregates reconcile with raw data
const cm = run(`U.curMonth()`);
eq(run(`Q.month('${cm}').income`), run(`U.sum(S.state.transactions.filter(x => x.type==='income' && x.date.startsWith('${cm}')), x => x.amount)`), 'month income aggregate');
eq(run(`U.sum([...Q.month('${cm}').exp.values()])`), run(`Q.month('${cm}').expense`), 'category expense sums to month expense');
const pm = run(`U.addMonthKey(U.curMonth(), -1)`);
const [f, tt] = run(`[U.monthStart('${pm}'), U.monthEnd('${pm}')]`);
eq(run(`Q.sumDays('${f}', '${tt}').expense`), run(`Q.month('${pm}').expense`), 'sumDays equals month aggregate');
eq(run(`Q.range('${f}', '${tt}').income`), run(`Q.month('${pm}').income`), 'range equals month aggregate');

// recurring is idempotent
const before = run(`S.state.transactions.length`);
run(`A.postDue(S.state)`);
eq(run(`S.state.transactions.length`), before, 'postDue is idempotent');
ok(run(`Q.pending().length`) >= 0, 'pending list works');

// budget
const br = run(`JSON.parse(JSON.stringify((() => { const b = Q.budgetRows(U.curMonth()); return { n: b.expense.length, t: b.totals, un: b.totals.unassigned, has: b.hasPlan }; })()))`);
ok(br.has, 'budget plan carries forward to current month');
eq(br.un, 0, 'demo plan is fully assigned (zero-based)');
ok(br.t.actualExpense > 0, 'current month has spending');

// goals
const gi = run(`JSON.parse(JSON.stringify(S.state.goals.map(g => Q.goalInfo(g))))`);
ok(gi[0].saved > gi[0].target * 0.4, 'emergency fund progress counts initial + contributions');
ok(gi.some(g => g.status === 'behind'), 'a goal is flagged behind');

// plans
const income = run(`Q.planIncome().amount`);
ok(income > 400000, 'plan income detected');
for (const id of ['smart', 'balanced', 'highcost', 'starter', 'fast', 'frugal']) {
  const built = run(`JSON.parse(JSON.stringify(Q.buildPlan(Q.plans().find(p => p.id==='${id}'), ${income})))`);
  const expTotal = Object.entries(built.lines).filter(([k]) => run(`Q.cat('${k}').type`) === 'expense').reduce((a, [, v]) => a + v, 0);
  const incTotal = Object.entries(built.lines).filter(([k]) => run(`Q.cat('${k}').type`) === 'income').reduce((a, [, v]) => a + v, 0);
  eq(incTotal - expTotal - built.savings, 0, `plan ${id}: income - expenses - savings = 0`);
  eq(incTotal, income, `plan ${id}: planned income equals basis`);
  ok(built.savings >= 0, `plan ${id}: savings non-negative`);
  if (id !== 'smart') {
    const pct = built.savings / income * 100, want = run(`Q.plans().find(p => p.id==='${id}').savings`);
    ok(Math.abs(pct - want) < 1.5, `plan ${id}: savings share ~${want}% (got ${pct.toFixed(1)}%)`);
  }
}
eq(run(`Q.buildPlan(Q.plans()[1], 0)`), null, 'plan with zero income returns null');

// statistics
for (const kind of ['day', 'week', 'month', 'year']) {
  const tr = run(`Q.trend('${kind}')`), inside = run(`Q.inside('${kind}', U.today())`);
  ok(tr.length > 0 && inside.length > 0, `${kind}: trend and breakdown build`);
}
eq(run(`Q.trend('month').length`), 12, '12 monthly bars');
eq(run(`Q.inside('week', '2026-10-27').length`), 7, 'week has 7 bars');
eq(run(`Q.inside('year', '2026-06-01').length`), 12, 'year has 12 bars');
eq(run(`Q.inside('month', '2026-02-10').length`), 28, 'february has 28 bars');
const rh = run(`Q.rhythm()`);
ok(rh.reliable && rh.expense.month > 0 && Math.abs(rh.expense.week * 52 - rh.expense.year) / rh.expense.year < 0.02, 'rhythm scales consistently');
ok(run(`Q.health(U.curMonth())`) && run(`Q.health(U.curMonth()).score`) >= 0, 'health score computes');
ok(run(`Q.insights(U.curMonth()).length`) >= 1, 'insights produced');

// filtering
const q1 = run(`Q.filter({ q: 'netflix' }).length`);
ok(q1 >= 10, 'search finds recurring netflix payments');
ok(run(`Q.filter({ type: 'transfer' }).every(x => x.type === 'transfer')`), 'type filter');

// actions validation
ok(run(`A.addTx({type:'expense', amount: 0, date:'2026-01-01', accountId:'a_chk'}).error`), 'rejects zero amount');
ok(run(`A.addTx({type:'transfer', amount: 100, date:'2026-01-01', accountId:'a_chk', toAccountId:'a_chk'}).error`), 'rejects same-account transfer');
eq(run(`A.deleteAccount('a_chk').error !== undefined`), true, 'cannot delete account with history');

// bank csv import
const csv = 'Date,Description,Amount\n2026-10-01,Coffee Shop,-4.50\n10/02/2026,Paycheck,"1,200.00"\nbad,Oops,5\n';
const parsed = run(`A.parseBankCsv(${JSON.stringify(csv)})`);
eq(parsed.rows.length, 2, 'csv rows parsed');
eq(parsed.errors.length, 1, 'csv bad row reported');
eq(parsed.rows[0].type, 'expense', 'negative amount is expense');
eq(parsed.rows[1].amount, 120000, 'csv amount with thousands separator');

/* ---- purpose and importance ---- */
ok(run(`S.state.transactions.filter(x => x.importance).length`) > 400, 'demo entries carry an importance');
ok(run(`S.state.transactions.filter(x => x.purpose).length`) > 200, 'demo entries carry a purpose');
eq(run(`S.state.transactions.filter(x => x.type === 'transfer').every(x => x.importance === undefined && x.purpose === undefined)`), true, 'transfers never carry importance or purpose');
const cmk = run(`U.curMonth()`);
eq(run(`U.sum([...Q.month('${cmk}').impExp.values()])`), run(`Q.month('${cmk}').expense`), 'expense by importance sums to total expense');
eq(run(`U.sum([...Q.month('${cmk}').impInc.values()])`), run(`Q.month('${cmk}').income`), 'income by importance sums to total income');
ok(run(`Q.filter({ importance: '4', type: 'expense' }).length`) > 50 && run(`Q.filter({ importance: '4' }).every(x => x.importance === 4 && x.type !== 'transfer')`), 'the importance filter returns only that level');
eq(run(`Q.filter({ importance: 'none' }).every(x => !x.importance)`), true, 'the "not set" filter works');
run(`A.addTx({ type: 'expense', amount: 1000, date: U.today(), accountId: 'a_chk', categoryId: 'c_dining', payee: 'ImpTest', purpose: '  Birthday dinner for Mum  ', importance: '3' })`);
const imp1 = run(`S.state.transactions.find(x => x.payee === 'ImpTest')`);
eq(String([imp1.purpose, imp1.importance]), 'Birthday dinner for Mum,3', 'purpose is trimmed and importance is stored as a number');
run(`A.addTx({ type: 'expense', amount: 1000, date: U.today(), accountId: 'a_chk', payee: 'ImpBad', importance: 9 })`);
eq(run(`S.state.transactions.find(x => x.payee === 'ImpBad').importance`), undefined, 'an out-of-range importance is dropped');
run(`A.addTx({ type: 'transfer', amount: 1000, date: U.today(), accountId: 'a_chk', toAccountId: 'a_sav', purpose: 'x', importance: 4 })`);
eq(run(`S.state.transactions.filter(x => x.type === 'transfer').sort((a, b) => b.createdAt - a.createdAt)[0].importance`), undefined, 'a transfer ignores importance');
eq(run(`Q.filter({ q: 'birthday dinner' }).length`), 1, 'search finds text typed in the purpose');
ok(run(`Q.filter({ q: 'nice to have' }).length`) > 10, 'search finds entries by their importance word');
ok(/Birthday dinner for Mum/.test(run(`A.exportCsv(Q.filter({ q: 'ImpTest' }))`)) && /Importance \(1-4\)/.test(run(`A.exportCsv([])`)), 'CSV export includes purpose and importance');
ok(run(`Q.purposes().has('birthday dinner for mum')`), 'typed purposes are remembered for quick re-use');
eq(String(run(`Q.importance('expense').map(i => i.level)`)), '4,3,2,1', 'the scale has four levels, most important first');
ok(run(`Q.importance('income')[3].label !== Q.importance('expense')[3].label`), 'income and expenses use different wording');
const gymId = run(`A.saveRecurring({ name: 'Gym', type: 'expense', amount: 3000, accountId: 'a_chk', categoryId: 'c_health', frequency: 'monthly', startDate: U.addDays(U.today(), -1), autoPost: true, purpose: 'Stay fit', importance: 3 }).id`);
run(`A.postDue(S.state)`);
const gym = run(`S.state.transactions.find(x => x.recurringId === '${gymId}')`);
eq(String([gym.purpose, gym.importance]), 'Stay fit,3', 'a scheduled item posts with its purpose and importance');

// ---- Arabic ----
if (run(`!!I18N.dicts.ar`)) {
  run(`S.state.settings.lang = 'ar'; S.applySettings(); I18N.missing.clear();`);
  run(`Q.importance('income'); Q.importance('expense'); Q.insights(U.curMonth()); Q.health(U.curMonth()); Q.plans(); Q.buildPlan(Q.plans()[0], ${income});`);
  const miss = run(`[...I18N.missing]`);
  ok(miss.length === 0, 'engine strings translated to Arabic' + (miss.length ? ': ' + miss.join(' | ') : ''));
  eq(run(`I18N.count(2, 'day')`), 'يومان', 'arabic dual');
  eq(run(`I18N.count(5, 'day')`), '5 أيام', 'arabic few');
  eq(run(`I18N.count(15, 'day')`), '15 يومًا', 'arabic many');
  eq(run(`document.documentElement.dir`), 'rtl', 'rtl set');
}

/* ---- typed categories ---- */
run(`S.state.settings.lang = 'en'; S.applySettings();`);
{
  const n0 = run(`S.state.categories.length`);
  eq(run(`A.ensureCategory('expense', 'groceries')`), 'c_groceries', 'a typed name matches an existing category, ignoring case');
  run(`S.state.settings.lang = 'ar'; S.applySettings();`);
  eq(run(`A.ensureCategory('expense', I18N.t('Groceries'))`), 'c_groceries', 'the Arabic name of a built-in category matches it too');
  run(`S.state.settings.lang = 'en'; S.applySettings();`);
  const id = run(`A.ensureCategory('expense', '  Generator   fuel ', 4)`);
  ok(id && id !== 'c_groceries', 'a new name creates a category');
  eq(run(`S.state.categories.length`), n0 + 1, 'exactly one category is added');
  eq(run(`Q.cat('${id}').name`), 'Generator fuel', 'the new name is tidied');
  eq(run(`Q.cat('${id}').bucket`), 'needs', 'an important new expense category counts as a need');
  eq(run(`Q.cat('${id}').icon`), 'car', 'a fitting icon is guessed from the name');
  eq(run(`A.ensureCategory('expense', 'generator FUEL')`), id, 'typing it again reuses it');
  eq(run(`A.ensureCategory('income', 'Generator fuel')`) !== id, true, 'income and expense categories are separate');
  eq(run(`Q.cat(A.ensureCategory('expense', 'مولدة كهرباء')).icon`), 'zap', 'Arabic words pick an icon as well');
  eq(run(`A.ensureCategory('expense', '   ')`), '', 'a blank name means uncategorised');
  eq(run(`A.ensureCategory('transfer', 'x')`), '', 'transfers have no category');
}

/* ---- daily / weekly / monthly groups ---- */
{
  run(`S.version++`);
  const r = JSON.parse(run(`(() => { const list = Q.filter({ from: U.addDays(U.today(), -120), to: U.today() });
    const res = {};
    for (const k of ['day', 'week', 'month']) {
      const g = Q.groupBy(list, k, 'new');
      res[k] = { n: g.length, count: g.reduce((a, x) => a + x.count, 0), inc: g.reduce((a, x) => a + x.income, 0), exp: g.reduce((a, x) => a + x.expense, 0),
        sortedNew: g.every((x, i) => !i || g[i - 1].key > x.key), inside: g.every(x => x.items.every(t => t.date >= x.from && t.date <= x.to)), netOk: g.every(x => x.net === x.income - x.expense) };
    }
    const old = Q.groupBy(list, 'week', 'old'), big = Q.groupBy(list, 'month', 'big');
    res.oldSorted = old.every((x, i) => !i || old[i - 1].key < x.key) && old.every(x => x.items.every((t, i) => !i || x.items[i - 1].date <= t.date));
    res.bigSorted = big.every(x => x.items.every((t, i) => !i || x.items[i - 1].amount >= t.amount));
    res.total = list.length; res.inc = U.sum(list.filter(x => x.type === 'income'), x => x.amount); res.exp = U.sum(list.filter(x => x.type === 'expense'), x => x.amount);
    res.weekStartsMonday = Q.groupBy(list, 'week').every(x => U.parse(x.from).getDay() === 1);
    return JSON.stringify(res); })()`));
  for (const k of ['day', 'week', 'month']) {
    eq(r[k].count, r.total, `${k} groups hold every transaction once`);
    ok(r[k].inc === r.inc && r[k].exp === r.exp, `${k} totals add up to the period totals`);
    ok(r[k].sortedNew && r[k].inside && r[k].netOk, `${k} groups are newest first, hold only their own dates, and net = income - expenses`);
  }
  ok(r.day.n > r.week.n && r.week.n > r.month.n, 'there are more days than weeks than months');
  ok(r.oldSorted, 'oldest first sorts groups and rows ascending');
  ok(r.bigSorted, 'largest first sorts rows by amount inside each group');
  ok(r.weekStartsMonday, 'weeks start on the configured week day');
}

/* ---- CSV export and import round trip ---- */
{
  const csv = run(`A.exportCsv(Q.filter({ from: U.addDays(U.today(), -40), to: U.today() }))`);
  const head = csv.split('\r\n')[0];
  ok(head.includes('Week starting') && head.includes('Month') && head.includes('Importance (1-4)'), 'the export has week, month and importance columns');
  const parsed = JSON.parse(run(`JSON.stringify(A.parseBankCsv(${JSON.stringify(csv)}))`));
  const want = run(`Q.filter({ from: U.addDays(U.today(), -40), to: U.today() }).length`);
  eq(parsed.rows.length, want, 'every exported row parses back');
  eq(parsed.errors.length, 0, 'no parse errors on our own export');
  ok(parsed.rows.some(x => x.type === 'transfer' && x.toAccountName), 'transfers keep their "to" account');
  ok(parsed.rows.some(x => x.importance && x.purpose !== undefined), 'importance comes back');
  const again = JSON.parse(run(`JSON.stringify(A.importRows(${JSON.stringify(parsed.rows)}, 'a_chk'))`));
  eq(again.added, 0, 'importing our own export again adds nothing (duplicates skipped)');
  const ar = 'التاريخ,النوع,الفئة,الوصف,المبلغ,الأهمية\r\n2026-03-05,مصروف,مولدة,اشتراك المولدة,25000,4\r\n05/03/2026,دخل,راتب,راتب آذار,900000,4\r\n2026-03-06,مصروف,نقل جديد,تكسي,-7000,';
  const pa = JSON.parse(run(`JSON.stringify(A.parseBankCsv(${JSON.stringify(ar)}, { dateOrder: 'dmy' }))`));
  eq(pa.rows.length, 3, 'Arabic headers are understood');
  ok(pa.rows[0].type === 'expense' && pa.rows[1].type === 'income' && pa.rows[1].date === '2026-03-05', 'Arabic type words and day/month dates are read');
  eq(pa.rows[2].amount, 700000, 'the sign is dropped when the type column says expense');
  run(`S.state.settings.lang = 'ar'; S.applySettings();`);
  const n0 = run(`S.state.categories.length`);
  const ia = JSON.parse(run(`JSON.stringify(A.importRows(${JSON.stringify(pa.rows)}, 'a_chk'))`));
  ok(ia.added === 3 && ia.newCategories === 2 && run(`S.state.categories.length`) === n0 + 2, 'importing creates new categories and matches existing ones (راتب is the built-in Salary)');
  eq(run(`S.state.transactions.find(x => x.purpose === undefined && x.payee === 'راتب آذار').categoryId`), 'c_salary', 'the imported salary row lands in Salary');
  run(`S.state.settings.lang = 'en'; S.applySettings();`);
}

/* ---- printable statement ---- */
{
  run(`S.version++`);
  const checks = JSON.parse(run(`(() => {
    const today = U.today(), out = [];
    const spans = {
      day: Q.periodRange('day', U.addDays(today, -1)),
      week: Q.periodRange('week', U.addDays(today, -9)),
      month: Q.periodRange('month', U.addMonths(today, -2, 1)),
      year: Q.periodRange('year', today),   // ends in the future: still reconciles
      custom: [U.addDays(today, -100), U.addDays(today, -3)],
      empty: ['2001-03-01', '2001-03-31'],
    };
    for (const [name, [from, to]] of Object.entries(spans)) {
      const d = Q.statement(from, to), r = {};
      r.name = name; r.grain = d.grain;
      r.reconciles = d.opening + d.income - d.expense === d.closing;
      r.net = d.net === d.income - d.expense;
      r.rowsSum = !d.rows.length || (U.sum(d.rows, x => x.income) === d.income && U.sum(d.rows, x => x.expense) === d.expense);
      r.rowsCover = !d.rows.length || (d.rows[0].from === from && d.rows[d.rows.length - 1].to === to && d.rows.every((x, i) => !i || U.addDays(d.rows[i - 1].to, 1) === x.from));
      r.rowCount = !d.rows.length || U.sum(d.rows, x => x.count) === d.incomeCount + d.expenseCount;
      r.catsSum = U.sum(d.incomeCats, x => x.value) === d.income && U.sum(d.expenseCats, x => x.value) === d.expense;
      r.pct = !d.expense || Math.abs(U.sum(d.expenseCats, x => x.pct) - 1) < 1e-9;
      r.accReconcile = d.accounts.every(a => a.opening + a.in - a.out === a.closing);
      r.accNet = U.sum(d.accounts, a => a.in) - U.sum(d.accounts, a => a.out) === d.income - d.expense;
      r.accOpen = U.sum(d.accounts, a => a.opening) === d.opening && U.sum(d.accounts, a => a.closing) === d.closing;
      r.items = d.items.every((x, i) => x.date >= from && x.date <= to && (!i || d.items[i - 1].date <= x.date));
      r.counts = d.incomeCount + d.expenseCount + d.transferCount === d.items.length;
      r.sameAsRange = d.income === Q.range(from, to).income && d.expense === Q.range(from, to).expense;
      r.n = d.items.length; r.income = d.income; r.days = d.days; r.rows = d.rows.length;
      out.push(r);
    }
    return JSON.stringify(out);
  })()`));
  for (const r of checks) {
    ok(r.reconciles, `${r.name}: opening + income - expenses = closing`);
    ok(r.net && r.sameAsRange, `${r.name}: totals match the statistics engine`);
    ok(r.rowsSum && r.rowsCover && r.rowCount, `${r.name}: the day/week/month rows cover the period exactly and add up to the totals`);
    ok(r.catsSum && r.pct, `${r.name}: category totals add up to the income and expense totals`);
    ok(r.accReconcile && r.accNet && r.accOpen, `${r.name}: each account reconciles and the accounts add up to the whole`);
    ok(r.items && r.counts, `${r.name}: transactions are inside the period, oldest first, and counted once`);
  }
  const by = Object.fromEntries(checks.map(r => [r.name, r]));
  eq(by.day.grain, null, 'a one-day statement has no breakdown rows');
  eq(by.week.grain, 'day', 'a week is broken down by day');
  eq(by.month.grain, 'week', 'a month is broken down by week');
  eq(by.year.grain, 'month', 'a year is broken down by month');
  eq(by.year.rows, 12, 'a year has twelve month rows');
  eq(by.week.rows, 7, 'a week has seven day rows');
  ok(by.month.n > 0 && by.year.n > by.month.n && by.year.income > 0, 'the demo months and year hold real entries');
  eq(by.empty.n + by.empty.income, 0, 'a period with nothing in it is empty, not an error');
  eq(run(`Q.statementGrain('2026-01-01', '2026-03-01')`), 'week', '60 days are shown by week');
  eq(run(`Q.statementGrain('2026-01-01', '2026-04-15')`), 'month', 'over 70 days are shown by month');
  // weeks follow the configured first day of the week, and the first/last rows are clipped to the period
  run(`S.state.settings.weekStart = 6; S.version++;`);
  const wk = JSON.parse(run(`(() => { const d = Q.statement(U.addDays(U.today(), -45), U.addDays(U.today(), -3));
    return JSON.stringify({ inner: d.rows.slice(1).every(r => U.parse(r.from).getDay() === 6), n: d.rows.length, rec: d.opening + d.income - d.expense === d.closing }); })()`));
  ok(wk.inner && wk.n >= 6 && wk.rec, 'week rows start on Saturday when that is the week start');
  run(`S.state.settings.weekStart = 1; S.version++;`);
  // the view script parses (it needs a browser to run, so only its syntax is checked here)
  let parsed = true; try { new vm.Script(fs.readFileSync(path.join(root, 'js', 'views', 'statement.js'), 'utf8')); } catch (e) { parsed = false; }
  ok(parsed, 'js/views/statement.js is valid JavaScript');
}

/* ---- web app shell: the offline list covers every script the page loads ---- */
{
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const sw = { self: { addEventListener() {} } }; vm.createContext(sw);
  vm.runInContext(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), sw);
  const shell = new Set(sw.self.SHELL);
  const used = [...html.matchAll(/<script src="([^"]+)"/g), ...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(m => m[1]);
  const missing = used.filter(u => !shell.has(u));
  eq(missing.join(','), '', 'sw.js precaches every script and stylesheet in index.html');
  ok([...shell].every(f => f === './' || fs.existsSync(path.join(root, f))), 'every file in the offline list exists');
  const mf = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  ok(mf.icons.every(i => fs.existsSync(path.join(root, i.src))) && mf.icons.some(i => i.purpose === 'maskable') && mf.display === 'standalone', 'the manifest is installable (icons exist, maskable icon, standalone)');
}

if (process.argv.includes('--report')) {
  run(`S.state.settings.lang = 'en'; S.applySettings();`);
  console.log(run(`Q.series(U.curMonth(), 12).map(m => m.key + '  income ' + (m.income / 100).toFixed(0).padStart(6) + '  spent ' + (m.expense / 100).toFixed(0).padStart(6) + '  rate ' + (m.income ? ((m.income - m.expense) / m.income * 100).toFixed(0) : '-') + '%  to-savings ' + (m.saved / 100).toFixed(0))`).join('\n'));
  console.log('balances:', run(`S.state.accounts.map(a => a.name + ' ' + U.money(Q.balance(a.id))).join(' | ')`));
  console.log('health:', JSON.stringify(run(`Q.health(U.curMonth())`)));
  console.log('insights:\n  ' + run(`Q.insights(U.curMonth()).map(i => i.kind + ': ' + i.title + ' - ' + i.text)`).join('\n  '));
  console.log('rhythm:', JSON.stringify(run(`Q.rhythm()`)));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
