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

// ---- Arabic ----
if (run(`!!I18N.dicts.ar`)) {
  run(`S.state.settings.lang = 'ar'; S.applySettings(); I18N.missing.clear();`);
  run(`Q.insights(U.curMonth()); Q.health(U.curMonth()); Q.plans(); Q.buildPlan(Q.plans()[0], ${income});`);
  const miss = run(`[...I18N.missing]`);
  ok(miss.length === 0, 'engine strings translated to Arabic' + (miss.length ? ': ' + miss.join(' | ') : ''));
  eq(run(`I18N.count(2, 'day')`), 'يومان', 'arabic dual');
  eq(run(`I18N.count(5, 'day')`), '5 أيام', 'arabic few');
  eq(run(`I18N.count(15, 'day')`), '15 يومًا', 'arabic many');
  eq(run(`document.documentElement.dir`), 'rtl', 'rtl set');
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
