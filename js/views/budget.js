'use strict';
const BudgetView = (() => {
  const V = {};
  const { h, money } = U;
  const SPLIT = () => ({ needs: { label: t('Needs'), color: K.PALETTE[0] }, wants: { label: t('Wants'), color: K.PALETTE[1] }, savings: { label: t('Savings'), color: K.PALETTE[2] } });

  const row = (r, mk, income) => {
    const editable = r.id !== '_none';
    const state = income ? 'ok' : r.planned > 0 && r.actual > r.planned ? 'over' : r.planned > 0 && r.ratio >= 0.85 ? 'near' : 'ok';
    const left = income ? r.actual - r.planned : r.remaining;
    return h`<div class="brow ${state}">
      <div class="b-name">${UI.catIcon(r.cat, 30)}<a href="#/transactions?cat=${r.id === '_none' ? '' : r.id}&month=${mk}">${Q.catName(r.cat)}</a></div>
      <div class="b-plan" data-l="${income ? t('Expected') : t('Budgeted')}">${editable
        ? h`<div class="amt-input sm"><span class="cur" aria-hidden="true">${U.currency().symbol}</span><input id="bud-${r.id}" data-amt inputmode="decimal" autocomplete="off" data-change="bud:set" data-id="${r.id}" value="${r.planned ? U.toInput(r.planned) : ''}" placeholder="0" aria-label="${income ? t('Expected') : t('Budgeted')}: ${Q.catName(r.cat)}"></div>`
        : h`<span class="muted">—</span>`}</div>
      <div class="b-act num" data-l="${income ? t('Received') : t('Spent')}">${money(r.actual)}</div>
      <div class="b-left num ${state === 'over' ? 'neg' : income && left >= 0 && r.planned ? 'pos' : ''}" data-l="${income ? t('Difference') : t('Remaining')}">${state === 'over' ? UI.icon('alert', 14) : ''}${r.planned || r.actual ? money(left, { sign: income }) : '—'}</div>
      <div class="b-bar">${r.planned ? C.meter(income ? Math.min(1, r.ratio) : r.ratio, { color: income ? 'var(--income)' : undefined }) : ''}</div>
    </div>`;
  };

  V.render = () => {
    const mk = App.month, br = Q.budgetRows(mk), tot = br.totals, plan = Q.plan(mk), pk = Q.planKey(mk), sp = SPLIT();
    const needs = br.expense.filter(r => (r.cat.bucket || 'wants') === 'needs'), wants = br.expense.filter(r => (r.cat.bucket || 'wants') !== 'needs');
    const sum = (rows, k) => U.sum(rows, r => r[k]);
    const base = tot.plannedIncome || tot.actualIncome || 1;
    const planSplit = [{ ...sp.needs, value: sum(needs, 'planned') }, { ...sp.wants, value: sum(wants, 'planned') }, { ...sp.savings, value: tot.plannedSavings }];
    const actSplit = [{ ...sp.needs, value: sum(needs, 'actual') }, { ...sp.wants, value: sum(wants, 'actual') }, { ...sp.savings, value: Math.max(0, tot.actualIncome - tot.actualExpense) }];
    const un = tot.unassigned, planLabel = Q.plans().find(p => p.id === (S.state.budgets[pk] || {}).planId);
    const group = (title, rows, key) => h`<div class="bgroup"><div class="bg-h"><b>${title}</b><span class="muted num">${money(sum(rows, 'planned'))} · ${money(sum(rows, 'actual'))}</span></div>${rows.length ? rows.map(r => row(r, mk, false)) : h`<p class="muted small pad">${t('No categories here yet.')}</p>`}</div>`;

    return h`
      ${UI.pageHead({ title: t('Budget'), sub: t('Give every unit of income a job. Costs and savings should add up to what you earn.'),
        actions: h`${UI.monthNav(mk, 'bud:month')}<a class="btn" href="#/plans">${UI.icon('sparkles', 16)}<span>${t('Ready-made plans')}</span></a>` })}

      <div class="grid">
        <section class="card s8 bud-sum">
          <div class="sum4">
            <div><small>${t('Expected income')}</small><b class="num">${money(tot.plannedIncome)}</b></div>
            <div><small>${t('Planned spending')}</small><b class="num">${money(tot.plannedExpense)}</b></div>
            <div><small>${t('Planned savings')}</small><b class="num">${money(tot.plannedSavings)}</b></div>
            <div class="${un === 0 ? 'ok' : un > 0 ? 'warn' : 'bad'}"><small>${t('Left to budget')}</small><b class="num">${money(un)}</b></div>
          </div>
          <p class="assign ${un === 0 ? 'ok' : un > 0 ? 'warn' : 'bad'}">${UI.icon(un === 0 ? 'check' : 'alert', 15)}${un === 0 ? t('Every unit of income is assigned.') : un > 0 ? t('{amount} of income has no job yet. Add it to a category or to savings.', { amount: money(un) }) : t('You planned {amount} more than you expect to earn.', { amount: money(-un) })}</p>
          <div class="split-block">
            <div class="split-row"><span>${t('Plan')}</span>${C.split(planSplit)}</div>
            <div class="split-row"><span>${t('Actual')}</span>${C.split(actSplit)}</div>
            ${C.legend(planSplit.map(s => ({ color: s.color, label: `${s.label} ${U.fmtPct(s.value / base)}` })))}
          </div>
        </section>
        <section class="card s4 bud-meta">
          <h3>${t('This month’s plan')}</h3>
          <p class="muted small">${br.hasPlan ? (br.explicit ? t('Set specifically for {month}.', { month: U.fmtMonth(mk) }) : t('Carried forward from {month}. Edit any line to start this month’s own plan.', { month: U.fmtMonth(pk) })) : t('No plan yet. Fill it in below or pick a ready-made plan.')}</p>
          ${planLabel ? h`<p><span class="pill info">${UI.icon('sparkles', 12)}${planLabel.name}</span></p>` : ''}
          <div class="stack-btns">
            <button class="btn sm" data-act="bud:suggest">${UI.icon('sparkles', 14)}${t('Fill from my averages')}</button>
            <button class="btn sm" data-act="bud:copy">${UI.icon('copy', 14)}${t('Copy last month')}</button>
            ${br.explicit ? h`<button class="btn sm ghost" data-act="bud:reset">${UI.icon('undo', 14)}${t('Back to carried-forward')}</button>` : ''}
          </div>
        </section>

        <section class="card s12 bud-table">
          <div class="brow head"><div>${t('Category')}</div><div>${t('Budgeted')}</div><div>${t('Spent')}</div><div>${t('Remaining')}</div><div></div></div>
          ${group(t('Needs'), needs)}
          ${group(t('Wants'), wants)}
          <div class="bgroup"><div class="bg-h"><b>${t('Savings')}</b><span class="muted num">${money(tot.plannedSavings)} · ${money(tot.actualSaved)}</span></div>
            <div class="brow ${tot.actualSaved >= tot.plannedSavings && tot.plannedSavings ? 'ok' : ''}">
              <div class="b-name"><span class="cico" style="--c:${K.PALETTE[2]};--s:30px">${UI.icon('vault', 16)}</span><span>${t('Moved to savings and investments')}</span></div>
              <div class="b-plan" data-l="${t('Budgeted')}"><div class="amt-input sm"><span class="cur" aria-hidden="true">${U.currency().symbol}</span><input id="bud-savings" data-amt inputmode="decimal" autocomplete="off" data-change="bud:savings" value="${plan.savings ? U.toInput(plan.savings) : ''}" placeholder="0" aria-label="${t('Planned savings')}"></div></div>
              <div class="b-act num" data-l="${t('Saved')}">${money(tot.actualSaved)}</div>
              <div class="b-left num" data-l="${t('Remaining')}">${money(tot.plannedSavings - tot.actualSaved)}</div>
              <div class="b-bar">${tot.plannedSavings ? C.meter(0.0 + tot.actualSaved / tot.plannedSavings, { color: 'var(--income)' }) : ''}</div>
            </div></div>
          <div class="bgroup"><div class="bg-h"><b>${t('Income')}</b><span class="muted num">${money(tot.plannedIncome)} · ${money(tot.actualIncome)}</span></div>
            ${br.income.map(r => row(r, mk, true))}</div>
        </section>
      </div>`;
  };

  App.on('bud:month', el => { const v = +el.dataset.v; App.month = v === 0 ? U.curMonth() : U.addMonthKey(App.month, v); App.render(); });
  App.onChange('bud:set', el => {
    const v = el.value.trim() === '' ? 0 : U.parseAmount(el.value);
    if (!Number.isFinite(v) || v < 0) { UI.toast(t('Enter a valid amount.'), { kind: 'warn' }); return App.render(); }
    A.setBudgetLine(App.month, el.dataset.id, v);
  });
  App.onChange('bud:savings', el => {
    const v = el.value.trim() === '' ? 0 : U.parseAmount(el.value);
    if (!Number.isFinite(v) || v < 0) { UI.toast(t('Enter a valid amount.'), { kind: 'warn' }); return App.render(); }
    A.setSavingsPlan(App.month, v);
  });
  App.on('bud:suggest', () => { A.suggestBudget(App.month); UI.toast(t('Budget filled from your recent averages.')); });
  App.on('bud:copy', () => { A.copyBudget(U.addMonthKey(App.month, -1), App.month); UI.toast(t('Copied from last month.')); });
  App.on('bud:reset', () => { A.resetBudget(App.month); UI.toast(t('Back to the carried-forward plan.')); });

  App.views.budget = V;
  return V;
})();
