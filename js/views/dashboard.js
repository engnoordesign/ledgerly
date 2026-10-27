'use strict';
const DashboardView = (() => {
  const V = { period: 'month' };
  const { h, money } = U;

  const greeting = () => {
    const hr = new Date().getHours(), n = S.state.settings.name;
    const g = hr < 5 ? t('Good evening') : hr < 12 ? t('Good morning') : hr < 18 ? t('Good afternoon') : t('Good evening');
    return n ? `${g}${I18N.lang === 'ar' ? '، ' : ', '}${n}` : g;
  };
  const periodOptions = () => [['day', t('Day')], ['week', t('Week')], ['month', t('Month')], ['year', t('Year')]];

  V.render = () => {
    const mk = App.month, set = S.state.settings;
    if (!S.state.transactions.length) {
      return h`${UI.pageHead({ title: greeting(), sub: t('Let’s get your money organised.') })}
        ${UI.empty({ icon: 'wallet', title: t('No transactions yet'), text: t('Add your first income or expense, or explore the app with a year of sample data.'),
          action: h`<div class="row-actions"><button class="btn primary" data-act="tx:new">${UI.icon('plus', 16)}${t('Add transaction')}</button><button class="btn" data-act="data:demo">${t('Load sample data')}</button></div>` })}`;
    }
    const isCur = mk === U.curMonth(), pk = U.addMonthKey(mk, -1), cur = Q.month(mk), br = Q.budgetRows(mk), tot = br.totals;
    // a month in progress is compared with the same point last month, not with a finished month
    const prev = isCur ? (() => { const s = U.monthStart(pk), me = U.monthEnd(pk), e = U.addDays(s, +U.today().slice(8, 10) - 1); return Q.sumDays(s, e > me ? me : e); })() : Q.month(pk);
    const cmpLabel = isCur ? t('vs same point last month') : t('vs previous period');
    const nw = Q.netWorth(), nws = Q.netWorthSeries(12), nwPrev = nws[10].value;
    const net = cur.income - cur.expense, prevNet = prev.income - prev.expense;
    const anchor = isCur ? U.today() : U.monthEnd(mk);
    const bars = Q.trend(V.period, anchor);
    const winIncome = U.sum(bars, b => b.income), winExpense = U.sum(bars, b => b.expense);
    const top = Q.topCats(cur.exp, 6), insights = Q.insights(mk), health = Q.health(mk);
    const recent = Q.sorted().filter(x => x.date <= U.today()).slice(0, 7);
    const upcoming = Q.upcoming(14).slice(0, 5), goals = S.state.goals.map(g => ({ g, i: Q.goalInfo(g) })).sort((a, b) => a.i.done - b.i.done || b.i.pct - a.i.pct).slice(0, 3);
    const rh = Q.rhythm();
    const used = tot.plannedExpense ? tot.actualExpense / tot.plannedExpense : 0;
    const hot = br.expense.filter(r => r.planned > 0).sort((a, b) => b.ratio - a.ratio).slice(0, 4);

    return h`
      ${UI.pageHead({ title: greeting(), sub: U.fmtDate(U.today(), 'long'), actions: h`${UI.monthNav(mk, 'dash:month')}<button class="btn primary" data-act="tx:new">${UI.icon('plus', 16)}<span>${t('New transaction')}</span></button>` })}
      <div class="grid">
        <section class="card hero-card s5">
          <div class="k-top"><span class="k-label">${t('Net worth')}</span>${UI.delta(nw.net, nwPrev, { label: t('vs end of last month') })}</div>
          <div class="hero-num num">${money(nw.net)}</div>
          <div class="muted small">${nw.net - nwPrev >= 0 ? t('{amount} up since last month', { amount: money(nw.net - nwPrev) }) : t('{amount} down since last month', { amount: money(nwPrev - nw.net) })}</div>
          <div class="hero-spark">${C.spark(nws.map(p => p.value))}</div>
          <div class="hero-split"><div><span class="k-label">${t('Assets')}</span><b class="num">${money(nw.assets)}</b></div><div><span class="k-label">${t('Liabilities')}</span><b class="num">${money(nw.liabilities)}</b></div></div>
        </section>
        <div class="kpis s7">
          ${UI.kpi({ label: t('Income'), value: money(cur.income), delta: UI.delta(cur.income, prev.income, { label: cmpLabel }), sub: isCur ? t('{month} so far', { month: U.fmtMonth(mk, 'month') }) : t('{month} total', { month: U.fmtMonth(mk, 'month') }), tone: 'inc' })}
          ${UI.kpi({ label: t('Expenses'), value: money(cur.expense), delta: UI.delta(cur.expense, prev.expense, { upGood: false, label: cmpLabel }), sub: t('{n} entries', { n: cur.count }), tone: 'exp' })}
          ${UI.kpi({ label: t('Net saved'), value: money(net, { sign: true }), delta: UI.delta(net, prevNet, { label: cmpLabel }), sub: cur.income ? t('{pct} of income', { pct: U.fmtPct(net / cur.income) }) : t('No income yet'), tone: net >= 0 ? 'pos' : 'neg' })}
          ${tot.plannedExpense
            ? UI.kpi({ label: t('Budget left'), value: money(tot.plannedExpense - tot.actualExpense), sub: t('{pct} of budget used', { pct: U.fmtPct(used) }), tone: used > 1 ? 'neg' : '' })
            : UI.kpi({ label: t('Budget left'), value: '—', sub: h`<a href="#/plans">${t('Pick a ready-made plan')}</a>` })}
        </div>

        ${UI.card(t('Cash flow'), h`
          <div class="cf-sum"><span><i class="sw inc"></i>${t('Income')} <b class="num">${money(winIncome)}</b></span><span><i class="sw exp"></i>${t('Expenses')} <b class="num">${money(winExpense)}</b></span><span>${t('Net')} <b class="num ${winIncome - winExpense < 0 ? 'neg' : 'pos'}">${money(winIncome - winExpense, { sign: true })}</b></span></div>
          ${C.bars({ bars })}`,
          { cls: 's8', actions: UI.seg('dash:period', periodOptions(), V.period), sub: { day: t('Last 14 days'), week: t('Last 12 weeks'), month: t('Last 12 months'), year: t('Last 5 years') }[V.period] })}

        ${UI.card(t('Where it went'), top.length ? h`
          ${C.donut({ items: top.map(r => ({ label: Q.catName(r.cat), value: r.value, color: r.cat.color })), center: h`<small>${t('Spent')}</small><b class="num">${money(cur.expense, { compact: cur.expense >= 1000000 * U.currency().pow })}</b>` })}
          <ul class="legend-list">${top.map(r => h`<li><a href="#/transactions?cat=${r.id === '_other' ? '' : r.id}&month=${mk}"><i class="sw" style="background:${r.cat.color}"></i><span>${Q.catName(r.cat)}</span><b class="num">${money(r.value)}</b></a></li>`)}</ul>`
          : UI.empty({ icon: 'pie', title: t('No spending yet'), text: t('Expenses you add this month will be broken down here.') }), { cls: 's4', sub: U.fmtMonth(mk) })}

        ${UI.card(t('Budget'), tot.plannedExpense ? h`
          <div class="bud-top"><b class="num">${money(tot.actualExpense)}</b><span class="muted">${t('of {amount}', { amount: money(tot.plannedExpense) })}</span></div>
          ${C.meter(used)}
          <ul class="mini-list">${hot.map(r => h`<li><span class="mini-n">${UI.catIcon(r.cat, 26)}<span>${Q.catName(r.cat)}</span></span><span class="mini-v"><b class="num ${r.ratio > 1 ? 'neg' : ''}">${U.fmtPct(r.ratio)}</b>${C.meter(r.ratio)}</span></li>`)}</ul>`
          : UI.empty({ icon: 'pie', title: t('No budget for this month'), text: t('Pick a ready-made plan and it is built from your own income.'), action: h`<a class="btn" href="#/plans">${t('See plans')}</a>` }),
          { cls: 's4', actions: h`<a class="btn ghost sm" href="#/budget">${t('Open')}</a>` })}

        ${UI.card(t('Insights'), h`
          ${health ? h`<div class="health"><div class="health-ring">${C.ring({ pct: health.score / 100, size: 72, text: health.score, color: health.score >= 60 ? 'var(--good)' : health.score >= 40 ? 'var(--warn)' : 'var(--bad)' })}</div>
            <div><b>${t('Financial health')}: ${health.label}</b><ul class="health-parts">${health.parts.map(p => h`<li data-tip="${p.detail}"><span>${p.label}</span>${C.meter(p.score, { plain: true })}</li>`)}</ul></div></div>` : ''}
          <ul class="insights">${insights.length ? insights.map(i => h`<li class="ins ${i.kind}"><a href="${i.href}"><span class="ins-i">${UI.icon(i.icon, 16)}</span><span><b>${i.title}</b><small>${i.text}</small></span></a></li>`)
            : h`<li class="muted">${t('Nothing needs your attention right now.')}</li>`}</ul>`, { cls: 's4' })}

        ${UI.card(t('Coming up'), upcoming.length ? h`<ul class="up-list">${upcoming.map(u => h`<li>
            <span class="up-d ${u.overdue ? 'due' : ''}"><b>${U.fmtDate(u.date, 'day')}</b><small>${U.fmtMonth(u.date.slice(0, 7), 'short')}</small></span>
            <span class="up-n"><b>${u.r.name}</b><small>${u.overdue ? t('Needs your confirmation') : U.relDay(u.date)}</small></span>
            ${u.overdue && !u.r.autoPost ? h`<span class="up-a"><button class="btn sm primary" data-act="sch:confirm" data-id="${u.r.id}">${t('Confirm')}</button><button class="btn sm ghost" data-act="sch:skip" data-id="${u.r.id}">${t('Skip')}</button></span>`
              : h`<b class="num amt ${u.r.type}">${u.r.type === 'income' ? '+' : u.r.type === 'expense' ? '−' : ''}${money(u.r.amount)}</b>`}</li>`)}</ul>`
          : UI.empty({ icon: 'calendar', title: t('Nothing scheduled'), text: t('Rent, salary and subscriptions can repeat on their own.'), action: h`<a class="btn" href="#/scheduled">${t('Add scheduled')}</a>` }),
          { cls: 's4', actions: h`<a class="btn ghost sm" href="#/scheduled">${t('All')}</a>` })}

        ${UI.card(t('Savings goals'), goals.length ? h`<ul class="goal-mini">${goals.map(({ g, i }) => h`<li><a href="#/goals">${C.ring({ pct: i.pct, size: 52, color: g.color })}<span><b>${g.name}</b><small class="num">${money(i.saved)} / ${money(i.target)}</small></span></a></li>`)}</ul>`
          : UI.empty({ icon: 'target', title: t('No goals yet'), text: t('Save towards something specific and watch it grow.'), action: h`<a class="btn" href="#/goals">${t('Create a goal')}</a>` }),
          { cls: 's4', actions: h`<a class="btn ghost sm" href="#/goals">${t('All')}</a>` })}

        ${UI.card(t('Recent activity'), h`<div class="tx-list">${recent.map(x => UI.txRow(x, { date: 'rel' }))}</div>`,
          { cls: 's8', actions: h`<a class="btn ghost sm" href="#/transactions">${t('View all')}</a>` })}

        ${UI.card(t('Your rhythm'), rh.hasData ? h`
          <div class="table-wrap"><table class="rhythm"><thead><tr><th></th>${[t('Day'), t('Week'), t('Month'), t('Year')].map(l => h`<th>${l}</th>`)}</tr></thead><tbody>
            ${[[t('Income'), rh.income, 'pos'], [t('Expenses'), rh.expense, ''], [t('Net'), rh.net, 'net']].map(([l, o, c]) => h`<tr><th scope="row">${l}</th>${['day', 'week', 'month', 'year'].map(k => h`<td class="num ${c === 'net' ? (o[k] < 0 ? 'neg' : 'pos') : c}">${money(o[k], { compact: true, sign: c === 'net' })}</td>`)}</tr>`)}
          </tbody></table></div>
          <p class="muted small">${rh.reliable ? t('Averages from the last {n}.', { n: U.plural(rh.days, 'day') }) : t('Based on only {n} of data so far.', { n: U.plural(rh.days, 'day') })}</p>` : UI.empty({ icon: 'chart', title: t('Not enough data') }),
          { cls: 's4', actions: h`<a class="btn ghost sm" href="#/stats">${t('Statistics')}</a>` })}
      </div>`;
  };

  App.on('dash:period', el => { V.period = el.dataset.v; App.render(); });
  App.on('dash:month', el => {
    const v = +el.dataset.v;
    App.month = v === 0 ? U.curMonth() : U.addMonthKey(App.month, v);
    App.render();
  });
  App.views.dashboard = V;
  return V;
})();
