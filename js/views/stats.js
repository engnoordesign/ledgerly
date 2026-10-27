'use strict';
/* Statistics: daily, weekly, monthly, yearly (and custom) figures built from the user's own entries. */
const StatsView = (() => {
  const V = { kind: 'month', anchor: U.today(), from: '', to: '' };
  const { h, money } = U;

  const kinds = () => [['day', t('Day')], ['week', t('Week')], ['month', t('Month')], ['year', t('Year')], ['custom', t('Custom')]];
  const range = () => V.kind === 'custom' ? [V.from, V.to] : Q.periodRange(V.kind, V.anchor);
  const prevRange = ([f, to]) => {
    if (V.kind !== 'custom') return Q.periodRange(V.kind, Q.shiftAnchor(V.kind, V.anchor, -1));
    const n = U.diffDays(f, to) + 1;
    return [U.addDays(f, -n), U.addDays(f, -1)];
  };
  const label = () => V.kind === 'custom' ? U.fmtRange(V.from, V.to) : Q.periodLabel(V.kind, V.anchor);
  const chartTitle = () => ({ day: t('Last 14 days'), week: t('Each day of the week'), month: t('Each day of the month'), year: t('Each month of the year'), custom: t('Across the range') })[V.kind];

  const lines = (cur, prev, type) => {
    const ids = new Set([...cur.keys(), ...prev.keys()]);
    return [...ids].map(id => ({ id, cat: Q.cat(id) || { id: '_none', name: 'Uncategorized', sys: true, color: '#64748b', icon: 'tag', bucket: 'wants', type }, cur: cur.get(id) || 0, prev: prev.get(id) || 0 }))
      .filter(r => r.cur || r.prev).sort((a, b) => b.cur - a.cur || b.prev - a.prev);
  };
  const stRow = (r, p) => {
    const d = r.cur - r.prev;
    return h`<tr><td><span class="cat-cell">${UI.catIcon(r.cat, 22)}${Q.catName(r.cat)}</span></td><td class="r num">${money(r.cur)}</td><td class="r num muted">${money(r.prev)}</td><td class="r num ${d === 0 ? 'muted' : ''}">${d ? money(d, { sign: true }) : '—'}</td></tr>`;
  };

  V.render = () => {
    const hasData = S.state.transactions.length > 0;
    const [from, to] = range();
    const valid = U.isDate(from) && U.isDate(to) && from <= to;
    const head = UI.pageHead({ title: t('Statistics'), sub: t('Daily, weekly, monthly and yearly figures, calculated from what you enter.') });
    const controls = h`<div class="stat-controls">${UI.seg('stat:kind', kinds(), V.kind)}
      ${V.kind === 'custom'
        ? h`<div class="range-in"><input type="date" id="st-from" data-change="stat:from" value="${V.from}" aria-label="${t('From')}"><span>→</span><input type="date" id="st-to" data-change="stat:to" value="${V.to}" aria-label="${t('To')}"></div>`
        : h`<div class="monthnav"><button class="btn icon ghost" data-act="stat:nav" data-v="-1" aria-label="${t('Previous')}">${UI.icon('chevron-left', 18, 'flip')}</button>
            <button class="mlabel" data-act="stat:nav" data-v="0" data-tip="${t('Jump to today')}">${label()}</button>
            <button class="btn icon ghost" data-act="stat:nav" data-v="1" aria-label="${t('Next')}">${UI.icon('chevron-right', 18, 'flip')}</button></div>`}</div>`;
    if (!hasData) return h`${head}${UI.empty({ icon: 'chart', title: t('No data to analyse yet'), text: t('Add some income and expenses and the statistics appear here.'), action: h`<button class="btn primary" data-act="tx:new">${UI.icon('plus', 16)}${t('Add transaction')}</button>` })}`;
    if (!valid) return h`${head}${controls}${UI.empty({ icon: 'calendar', title: t('Choose a valid date range'), text: t('The end date must be on or after the start date.') })}`;

    const today = U.today(), last = to > today ? today : to, partial = to > today;
    const days = Math.max(1, U.diffDays(from, last) + 1);
    let [pf, pt] = prevRange([from, to]);
    // a period still in progress is compared with the same stretch of the previous one
    if (partial) { const cut = U.addDays(pf, days - 1); if (cut < pt) pt = cut; }
    const cur = Q.range(from, to), prev = Q.range(pf, pt);
    const cmp = partial ? t('vs the same days of the previous period') : t('vs previous period');
    const net = cur.income - cur.expense, prevNet = prev.income - prev.expense;
    const bars = Q.inside(V.kind === 'custom' ? 'custom' : V.kind, V.anchor, V.kind === 'custom' ? [from, to] : undefined);
    const list = Q.filter({ from, to });
    const spends = list.filter(x => x.type === 'expense');
    const biggest = spends.slice().sort((a, b) => b.amount - a.amount)[0];
    const topDay = [...U.groupBy(spends, x => x.date)].map(([d, xs]) => ({ d, v: U.sum(xs, x => x.amount) })).sort((a, b) => b.v - a.v)[0];
    const payees = [...U.groupBy(spends.filter(x => x.payee), x => x.payee.toLowerCase())].map(([, xs]) => ({ name: xs[0].payee, v: U.sum(xs, x => x.amount), n: xs.length })).sort((a, b) => b.v - a.v).slice(0, 5);
    const topExp = Q.topCats(cur.exp, 8), topInc = Q.topCats(cur.inc, 6);
    const nwStart = U.sum([...Q.balances(U.addDays(from, -1)).values()]), nwEnd = U.sum([...Q.balances(last).values()]);
    const expLines = lines(cur.exp, prev.exp, 'expense'), incLines = lines(cur.inc, prev.inc, 'income');
    const rate = cur.income ? net / cur.income : null;
    const shown = V.kind === 'day' ? list : list.slice(0, 10);

    return h`${head}${controls}
      <div class="kpis five">
        ${UI.kpi({ label: t('Income'), value: money(cur.income), delta: UI.delta(cur.income, prev.income, { label: cmp }), sub: partial ? t('Up to today') : '', tone: 'inc' })}
        ${UI.kpi({ label: t('Expenses'), value: money(cur.expense), delta: UI.delta(cur.expense, prev.expense, { upGood: false, label: cmp }), sub: t('{amount} per day', { amount: money(Math.round(cur.expense / days)) }), tone: 'exp' })}
        ${UI.kpi({ label: t('Net'), value: money(net, { sign: true }), delta: UI.delta(net, prevNet, { label: cmp }), sub: rate == null ? t('No income in this period') : t('Savings rate {pct}', { pct: U.fmtPct(rate) }), tone: net >= 0 ? 'pos' : 'neg' })}
        ${UI.kpi({ label: t('Moved to savings'), value: money(cur.saved), sub: t('Transfers into savings and investments') })}
        ${UI.kpi({ label: t('Transactions'), value: String(cur.count), sub: cur.count ? t('{amount} average expense', { amount: money(spends.length ? Math.round(cur.expense / spends.length) : 0) }) : '—' })}
      </div>

      <div class="grid">
        ${UI.card(chartTitle(), h`${C.bars({ bars, height: 230 })}${C.legend([{ color: 'var(--income)', label: t('Income') }, { color: 'var(--expense)', label: t('Expenses') }])}`, { cls: 's12', sub: label() })}

        ${UI.card(t('Spending by category'), topExp.length ? C.hbars(topExp.map(r => ({ label: Q.catName(r.cat), value: r.value, color: r.cat.color, lead: UI.catIcon(r.cat, 26) })), { total: cur.expense }) : UI.empty({ icon: 'pie', title: t('No spending in this period') }), { cls: 's6' })}
        ${UI.card(t('Income sources'), topInc.length ? C.hbars(topInc.map(r => ({ label: Q.catName(r.cat), value: r.value, color: r.cat.color, lead: UI.catIcon(r.cat, 26) })), { total: cur.income }) : UI.empty({ icon: 'banknote', title: t('No income in this period') }), { cls: 's6' })}

        ${UI.card(t('Income statement'), h`<div class="table-wrap"><table class="plain stmt"><thead><tr><th>${t('Line')}</th><th class="r">${label()}</th><th class="r">${t('Previous')}</th><th class="r">${t('Change')}</th></tr></thead><tbody>
          <tr class="grp"><td>${t('Income')}</td><td class="r num pos">${money(cur.income)}</td><td class="r num muted">${money(prev.income)}</td><td class="r num">${money(cur.income - prev.income, { sign: true })}</td></tr>
          ${incLines.map(r => stRow(r))}
          <tr class="grp"><td>${t('Expenses')}</td><td class="r num">${money(cur.expense)}</td><td class="r num muted">${money(prev.expense)}</td><td class="r num">${money(cur.expense - prev.expense, { sign: true })}</td></tr>
          ${expLines.map(r => stRow(r))}
          <tr class="total"><td>${t('Net income')}</td><td class="r num ${net < 0 ? 'neg' : 'pos'}">${money(net, { sign: true })}</td><td class="r num muted">${money(prevNet, { sign: true })}</td><td class="r num">${money(net - prevNet, { sign: true })}</td></tr>
          <tr><td class="muted">${t('Net worth at start → end')}</td><td class="r num" colspan="3">${money(nwStart)} → ${money(nwEnd)} <b class="${nwEnd - nwStart < 0 ? 'neg' : 'pos'}">(${money(nwEnd - nwStart, { sign: true })})</b></td></tr>
        </tbody></table></div>`, { cls: 's7' })}

        ${UI.card(t('Highlights'), h`<ul class="hlights">
          ${biggest ? h`<li><small>${t('Biggest expense')}</small><b>${UI.txTitle(biggest)}</b><span class="num">${money(biggest.amount)} · ${U.fmtDate(biggest.date, 'short')}</span></li>` : ''}
          ${topDay && V.kind !== 'day' ? h`<li><small>${t('Highest spending day')}</small><b>${U.fmtDate(topDay.d, 'long')}</b><span class="num">${money(topDay.v)}</span></li>` : ''}
          ${topExp[0] ? h`<li><small>${t('Top category')}</small><b>${Q.catName(topExp[0].cat)}</b><span class="num">${money(topExp[0].value)} · ${U.fmtPct(topExp[0].value / (cur.expense || 1))}</span></li>` : ''}
          ${payees.length ? h`<li><small>${t('Top payees')}</small><ol class="payees">${payees.map(p => h`<li><span>${p.name}</span><span class="num">${money(p.v)}</span></li>`)}</ol></li>` : ''}
          ${!biggest && !topExp[0] ? h`<li class="muted">${t('Nothing to highlight yet.')}</li>` : ''}
        </ul>`, { cls: 's5' })}

        ${UI.card(V.kind === 'day' ? t('Everything on this day') : t('Latest in this period'), shown.length ? h`<div class="tx-list">${shown.map(x => UI.txRow(x, { date: V.kind === 'day' ? '' : 'short', actions: V.kind === 'day' }))}</div>` : UI.empty({ icon: 'receipt', title: t('No transactions in this period') }),
          { cls: 's12', actions: list.length > shown.length || V.kind !== 'day' ? h`<button class="btn sm" data-act="stat:open" data-from="${from}" data-to="${to}">${t('Open in ledger')} (${list.length})</button>` : '' })}
      </div>`;
  };

  App.on('stat:kind', el => {
    V.kind = el.dataset.v;
    if (V.kind === 'custom' && !V.from) { V.to = U.today(); V.from = U.addDays(V.to, -29); }
    App.render();
  });
  App.on('stat:nav', el => {
    const v = +el.dataset.v;
    V.anchor = v === 0 ? U.today() : Q.shiftAnchor(V.kind, V.anchor, v);
    App.render();
  });
  App.onChange('stat:from', el => { V.from = el.value; App.render(); });
  App.onChange('stat:to', el => { V.to = el.value; App.render(); });
  App.on('stat:open', el => { TransactionsView.open({ range: 'custom', from: el.dataset.from, to: el.dataset.to }); location.hash = '#/transactions'; });

  App.views.stats = V;
  return V;
})();
