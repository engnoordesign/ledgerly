'use strict';
const PlansView = (() => {
  const V = { income: null };
  const { h, money } = U;
  const COL = () => ({ needs: K.PALETTE[0], wants: K.PALETTE[1], savings: K.PALETTE[2] });
  const names = () => ({ needs: t('Needs'), wants: t('Wants'), savings: t('Savings') });

  const basis = () => {
    const b = Q.planIncome();
    return V.income != null ? { ...b, amount: V.income, basis: 'manual' } : b;
  };

  V.render = () => {
    const mk = App.month, b = basis(), act = Q.actualSplit(), col = COL(), nm = names();
    const plans = Q.plans(), built = plans.map(p => ({ p, b: Q.buildPlan(p, b.amount) }));
    const fixed = built.filter(x => !x.p.smart && x.b);
    let best = null;
    if (act && fixed.length) best = fixed.map(x => ({ id: x.p.id, d: Math.abs(x.p.needs - act.needs) + Math.abs(x.p.wants - act.wants) + Math.abs(x.p.savings - Math.max(0, act.savings)) })).sort((x, y) => x.d - y.d)[0].id;
    const basisText = b.basis === 'avg' ? t('Average income of your last {n}.', { n: U.plural(b.months, 'month') }) : b.basis === 'month' ? t('Income recorded so far this month.') : b.basis === 'manual' ? t('Amount you entered.') : t('No income recorded yet. Enter your monthly income to see the plans.');

    return h`
      ${UI.pageHead({ title: t('Ready-made plans'), sub: t('Proven budgeting rules, worked out in actual money from your own income and spending. Preview, then apply.'),
        actions: UI.monthNav(mk, 'plan:month') })}
      <div class="grid">
        <section class="card s7 plan-income">
          <h3>${t('Plan with this monthly income')}</h3>
          <div class="pi-row"><div class="field big"><label for="plan-inc" class="sr-only">${t('Monthly income')}</label>${UI.amountInput('plan-inc', b.amount, { name: 'inc', required: false, change: 'plan:income' })}</div>
            ${V.income != null ? h`<button class="btn sm ghost" data-act="plan:auto">${UI.icon('undo', 14)}${t('Use detected')}</button>` : ''}</div>
          <p class="muted small">${basisText}</p>
        </section>
        <section class="card s5 plan-now">
          <h3>${t('How you spend today')}</h3>
          ${act ? h`${C.split([{ label: nm.needs, value: Math.max(0, act.needs), color: col.needs }, { label: nm.wants, value: Math.max(0, act.wants), color: col.wants }, { label: nm.savings, value: Math.max(0, act.savings), color: col.savings }])}
            ${C.legend([{ color: col.needs, label: `${nm.needs} ${U.fmtPct(act.needs / 100)}` }, { color: col.wants, label: `${nm.wants} ${U.fmtPct(act.wants / 100)}` }, { color: col.savings, label: `${nm.savings} ${U.fmtPct(Math.max(0, act.savings) / 100)}` }])}`
            : h`<p class="muted">${t('Add some income and expenses and your real split appears here.')}</p>`}
        </section>
      </div>
      <div class="plan-grid">
        ${built.map(({ p, b: pb }) => {
          const sh = pb ? pb.shares : { needs: p.needs || 0, wants: p.wants || 0, savings: p.savings || 0 };
          return h`<article class="card plan ${p.smart ? 'smart' : ''}">
            <header><span class="plan-i">${UI.icon(p.icon, 20)}</span><div><h3>${p.name}</h3>${p.smart ? h`<span class="pill info">${t('Built from you')}</span>` : best === p.id ? h`<span class="pill good">${UI.icon('check', 12)}${t('Closest to your habits')}</span>` : ''}</div></header>
            <p class="muted">${p.desc}</p>
            ${C.split([{ label: nm.needs, value: sh.needs, color: col.needs }, { label: nm.wants, value: sh.wants, color: col.wants }, { label: nm.savings, value: sh.savings, color: col.savings }])}
            <dl class="plan-nums">${['needs', 'wants', 'savings'].map(k => h`<div><dt><i class="sw" style="background:${col[k]}"></i>${nm[k]} <span class="muted">${U.fmtPct(sh[k] / 100)}</span></dt><dd class="num">${pb ? money(Math.round(b.amount * sh[k] / 100)) : '—'}</dd></div>`)}</dl>
            <button class="btn ${p.smart ? 'primary' : ''}" data-act="plan:preview" data-id="${p.id}" ${pb ? '' : 'disabled'}>${t('Preview and apply')}</button>
          </article>`;
        })}
      </div>`;
  };

  const preview = id => {
    const p = Q.plans().find(x => x.id === id), b = basis(), pb = Q.buildPlan(p, b.amount);
    if (!pb) return UI.toast(t('Enter a monthly income first.'), { kind: 'warn' });
    const prof = Q.profile(), col = COL(), nm = names();
    const catRow = c => {
      const avg = prof.exp.get(c.id) || 0, plan = pb.lines[c.id] || 0;
      if (!avg && !plan) return '';
      const d = plan - avg;
      return h`<tr><td><span class="cat-cell">${UI.catIcon(c, 24)}${Q.catName(c)}</span></td><td class="r num muted">${money(avg)}</td><td class="r num"><b>${money(plan)}</b></td><td class="r num ${d > 0 ? 'pos' : d < 0 ? 'neg' : 'muted'}">${d ? money(d, { sign: true }) : '—'}</td></tr>`;
    };
    const section = k => {
      const cats = Q.cats('expense').filter(c => (c.bucket || 'wants') === k);
      const tot = U.sum(cats, c => pb.lines[c.id] || 0), avg = U.sum(cats, c => prof.exp.get(c.id) || 0);
      return h`<tr class="grp"><td><i class="sw" style="background:${col[k]}"></i>${nm[k]}</td><td class="r num">${money(avg)}</td><td class="r num">${money(tot)}</td><td class="r num">${money(tot - avg, { sign: true })}</td></tr>${cats.map(catRow)}`;
    };
    const notes = [];
    if (pb.flags.includes('needs-floor')) notes.push(t('Your scheduled bills in Needs add up to more than this plan’s share, so those bills were kept in full.'));
    if (pb.flags.includes('needs-tight')) notes.push(t('Your essentials already take a large part of your income, so wants were trimmed first.'));
    if (pb.flags.includes('wants-floor')) notes.push(t('Some scheduled payments in Wants exceed this plan’s share and were kept in full.'));
    const ctl = UI.modal({
      title: p.name, size: 'lg',
      body: h`<div class="pv-top"><div><small>${t('Monthly income')}</small><b class="num">${money(b.amount)}</b></div><div><small>${t('Spending plan')}</small><b class="num">${money(pb.expenseTotal)}</b></div><div class="g"><small>${t('Savings')}</small><b class="num">${money(pb.savings)}</b></div></div>
        ${notes.map(n => h`<div class="notice warn">${UI.icon('alert', 15)}${n}</div>`)}
        <div class="table-wrap"><table class="plain pv"><thead><tr><th>${t('Category')}</th><th class="r">${t('Recent average')}</th><th class="r">${t('New plan')}</th><th class="r">${t('Change')}</th></tr></thead><tbody>
          ${section('needs')}${section('wants')}
          <tr class="grp"><td><i class="sw" style="background:${col.savings}"></i>${nm.savings}</td><td class="r num">${money(Math.max(0, Q.actualSplit() ? Math.round(Q.actualSplit().savings / 100 * b.amount) : 0))}</td><td class="r num">${money(pb.savings)}</td><td class="r num">—</td></tr>
        </tbody></table></div>
        <p class="muted small">${t('Applies to {month} and every month after it until you change it. Earlier months keep their own plans.', { month: U.fmtMonth(App.month) })}</p>`,
      footer: h`<button type="button" class="btn" data-close>${t('Cancel')}</button><button type="button" class="btn primary" data-act="plan:apply" data-id="${id}">${t('Apply to {month}', { month: U.fmtMonth(App.month, 'month') })}</button>`,
    });
    V.pv = { ctl, pb, id };
  };

  App.on('plan:month', el => { const v = +el.dataset.v; App.month = v === 0 ? U.curMonth() : U.addMonthKey(App.month, v); App.render(); });
  App.onChange('plan:income', el => { const v = U.parseAmount(el.value); V.income = Number.isFinite(v) && v > 0 ? v : null; App.render(); });
  App.on('plan:auto', () => { V.income = null; App.render(); });
  App.on('plan:preview', el => preview(el.dataset.id));
  App.on('plan:apply', () => {
    A.applyPlan(App.month, V.pv.pb, V.pv.id);
    V.pv.ctl.close();
    UI.toast(t('Plan applied to {month}.', { month: U.fmtMonth(App.month) }));
    location.hash = '#/budget';
  });

  App.views.plans = V;
  return V;
})();
