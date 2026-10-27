'use strict';
const GoalsView = (() => {
  const V = {};
  const { h, money } = U;
  const STATUS = () => ({ done: [t('Reached'), 'good'], ontrack: [t('On track'), 'good'], behind: [t('Behind'), 'warn'], overdue: [t('Past date'), 'bad'], open: [t('In progress'), 'info'] });

  const card = g => {
    const i = Q.goalInfo(g), st = STATUS()[i.status], acc = Q.acc(g.accountId);
    const recent = S.state.transactions.filter(x => x.goalId === g.id).sort((a, b) => b.date < a.date ? -1 : 1).slice(0, 3);
    return h`<article class="card goal">
      <header>${C.ring({ pct: i.pct, size: 76, color: g.color })}
        <div class="g-t"><h3>${g.name}</h3><span class="pill ${st[1]}">${st[0]}</span></div>
        <button class="btn icon ghost sm" data-act="goal:edit" data-id="${g.id}" data-tip="${t('Edit')}">${UI.icon('edit', 15)}</button></header>
      <div class="g-amt"><b class="num">${money(i.saved)}</b><span class="muted">${t('of {amount}', { amount: money(i.target) })}</span></div>
      ${C.meter(i.pct, { color: g.color })}
      <dl class="g-meta">
        <div><dt>${t('Still to go')}</dt><dd class="num">${money(i.remaining)}</dd></div>
        <div><dt>${t('Target date')}</dt><dd>${g.deadline ? U.fmtDate(g.deadline, 'med') : '—'}</dd></div>
        <div><dt>${t('Needed per month')}</dt><dd class="num">${i.need != null && !i.done ? money(i.need) : '—'}</dd></div>
        <div><dt>${t('Your pace')}</dt><dd class="num">${i.avg ? t('{amount}/mo', { amount: money(i.avg) }) : '—'}</dd></div>
      </dl>
      ${i.eta && !i.done ? h`<p class="muted small">${UI.icon('calendar', 13)} ${t('At your current pace you will get there around {date}.', { date: U.fmtMonth(i.eta.slice(0, 7)) })}</p>` : ''}
      <p class="muted small">${UI.icon('landmark', 13)} ${t('Kept in {account}', { account: acc ? acc.name : '?' })}</p>
      ${recent.length ? h`<ul class="g-recent">${recent.map(x => h`<li><span>${U.fmtDate(x.date, 'short')}</span><span class="num ${x.toAccountId === g.accountId ? 'pos' : ''}">${x.toAccountId === g.accountId ? '+' : '−'}${money(x.amount)}</span></li>`)}</ul>` : ''}
      <footer><button class="btn sm primary" data-act="goal:add" data-id="${g.id}">${UI.icon('plus', 14)}${t('Add money')}</button>
        <button class="btn sm" data-act="goal:take" data-id="${g.id}" ${i.saved > 0 ? '' : 'disabled'}>${t('Withdraw')}</button></footer>
    </article>`;
  };

  V.render = () => {
    const gs = S.state.goals, infos = gs.map(g => Q.goalInfo(g));
    const tot = U.sum(infos, i => i.saved), tgt = U.sum(infos, i => i.target);
    const cushion = Q.avgMonthlyExpense() * S.state.settings.emergencyMonths;
    const hasEmergency = gs.some(g => /emergency|طوارئ/i.test(g.name));
    return h`
      ${UI.pageHead({ title: t('Savings goals'), sub: t('Save towards something specific. Deposits are transfers, so your spending figures stay honest.'),
        actions: h`<button class="btn primary" data-act="goal:new">${UI.icon('plus', 16)}<span>${t('New goal')}</span></button>` })}
      ${gs.length ? h`
        <div class="kpis three">
          ${UI.kpi({ label: t('Saved so far'), value: money(tot), sub: t('across {n}', { n: U.plural(gs.length, 'goal') }), tone: 'pos' })}
          ${UI.kpi({ label: t('Total target'), value: money(tgt), sub: t('{pct} complete', { pct: U.fmtPct(tgt ? tot / tgt : 0) }) })}
          ${UI.kpi({ label: t('On track'), value: `${infos.filter(i => i.status === 'ontrack' || i.status === 'done').length} / ${gs.length}`, sub: infos.some(i => i.status === 'behind' || i.status === 'overdue') ? t('Some goals need a boost') : t('Nice work') })}
        </div>
        <div class="goal-grid">${gs.map(card)}</div>`
        : UI.empty({ icon: 'target', title: t('No goals yet'), text: t('A trip, a laptop, an emergency fund. Name it, set an amount and a date, and we work out the monthly amount.'), action: h`<button class="btn primary" data-act="goal:new">${t('Create your first goal')}</button>` })}
      ${!hasEmergency && cushion > 0 ? h`<section class="card tip-card"><div>${UI.icon('shield', 22)}</div><div><h3>${t('Suggested: emergency fund')}</h3>
        <p class="muted">${t('{n} months of your usual spending is {amount}. It is the cushion that keeps surprises from becoming debt.', { n: S.state.settings.emergencyMonths, amount: money(cushion) })}</p></div>
        <button class="btn" data-act="goal:new" data-preset="emergency">${t('Create this goal')}</button></section>` : ''}`;
  };

  const goalForm = (g, preset) => {
    const ed = !!g;
    const accs = Q.accounts().slice().sort((a, b) => (Q.accType(b).saving ? 1 : 0) - (Q.accType(a).saving ? 1 : 0));
    if (!accs.length) return UI.toast(t('Add an account first.'), { kind: 'warn' });
    const x = g || (preset === 'emergency'
      ? { name: t('Emergency fund'), target: Q.avgMonthlyExpense() * S.state.settings.emergencyMonths, accountId: accs[0].id, color: K.PALETTE[0], initial: 0 }
      : { name: '', target: 0, accountId: accs[0].id, color: K.PALETTE[S.state.goals.length % K.PALETTE.length], initial: 0 });
    V.ctl = UI.modal({
      title: ed ? t('Edit goal') : t('New goal'),
      body: h`<form id="goalf" novalidate data-submit="goal:save" ${ed ? h`data-id="${g.id}"` : ''}>
        <div class="field"><label for="g-name">${t('Goal name')}</label><input id="g-name" name="name" value="${x.name}" required autocomplete="off" placeholder="${t('e.g. Summer trip')}"></div>
        <div class="row2">
          <div class="field"><label for="g-target">${t('Target amount')}</label>${UI.amountInput('g-target', x.target, { name: 'target' })}</div>
          <div class="field"><label for="g-date">${t('Target date (optional)')}</label><input type="date" id="g-date" name="deadline" value="${x.deadline || ''}"></div>
        </div>
        <div class="row2">
          <div class="field"><label for="g-acc">${t('Kept in account')}</label><select id="g-acc" name="accountId">${UI.options(accs.map(a => [a.id, a.name]), x.accountId)}</select></div>
          <div class="field"><label for="g-init">${t('Already saved')}</label>${UI.amountInput('g-init', x.initial, { name: 'initial', required: false })}</div>
        </div>
        <div class="field"><label>${t('Colour')}</label>${UI.swatches('color', x.color)}</div>
        <div class="form-error" role="alert" hidden></div></form>`,
      footer: h`${ed ? h`<button type="button" class="btn danger ghost push" data-act="goal:delete" data-id="${g.id}">${UI.icon('trash', 16)}${t('Delete')}</button>` : ''}<button type="button" class="btn" data-close>${t('Cancel')}</button><button type="submit" form="goalf" class="btn primary">${t('Save')}</button>`,
    });
  };
  App.on('goal:new', el => goalForm(null, el && el.dataset && el.dataset.preset));
  App.on('goal:edit', el => goalForm(Q.goalMap().get(el.dataset.id)));
  App.onSubmit('goal:save', f => {
    const d = UI.read(f), res = A.saveGoal({ id: f.dataset.id, name: d.name, target: d.target, deadline: d.deadline, accountId: d.accountId, color: d.color, initial: Number.isFinite(d.initial) ? d.initial : 0 });
    if (res.error) return UI.formError(f, res.error);
    V.ctl.close(); UI.toast(t('Goal saved'));
    if (!location.hash.startsWith('#/goals')) location.hash = '#/goals';
  });
  App.on('goal:delete', async el => {
    const g = Q.goalMap().get(el.dataset.id);
    if (await UI.confirm({ title: t('Delete this goal?'), message: t('“{name}” will be removed. The transfers you made stay in your ledger.', { name: g.name }), confirm: t('Delete'), danger: true })) {
      V.ctl.close(); A.deleteGoal(g.id); UI.toast(t('Goal deleted'));
    }
  });

  const moveForm = (id, withdraw) => {
    const g = Q.goalMap().get(id), others = Q.accounts().filter(a => a.id !== g.accountId), acc = Q.acc(g.accountId);
    const i = Q.goalInfo(g);
    V.move = { id, withdraw };
    V.ctl = UI.modal({
      title: withdraw ? t('Withdraw from {name}', { name: g.name }) : t('Add to {name}', { name: g.name }), size: 'sm',
      body: h`<form id="movef" novalidate data-submit="goal:move">
        <div class="field big"><label for="mv-amt">${t('Amount')}</label>${UI.amountInput('mv-amt', !withdraw && i.need ? i.need : 0, { name: 'amount', autofocus: true })}</div>
        <div class="field"><label for="mv-date">${t('Date')}</label><input type="date" id="mv-date" name="date" value="${U.today()}" required></div>
        <div class="field"><label for="mv-acc">${withdraw ? t('Move it to') : t('Take it from')}</label>
          <select id="mv-acc" name="accountId">${UI.options([...others.map(a => [a.id, a.name]), ['', t('Already in {account}', { account: acc ? acc.name : '?' })]], others[0] ? others[0].id : '')}</select></div>
        <p class="muted small">${i.need && !withdraw ? t('Suggested for this month: {amount}', { amount: money(i.need) }) : ''}</p>
        <div class="form-error" role="alert" hidden></div></form>`,
      footer: h`<button type="button" class="btn" data-close>${t('Cancel')}</button><button type="submit" form="movef" class="btn primary">${withdraw ? t('Withdraw') : t('Add money')}</button>`,
    });
  };
  App.on('goal:add', el => moveForm(el.dataset.id, false));
  App.on('goal:take', el => moveForm(el.dataset.id, true));
  App.onSubmit('goal:move', f => {
    const d = UI.read(f), res = A.moveGoal({ goalId: V.move.id, amount: d.amount, date: d.date, accountId: d.accountId, withdraw: V.move.withdraw });
    if (res.error) return UI.formError(f, res.error);
    V.ctl.close(); UI.toast(V.move.withdraw ? t('Withdrawal recorded') : t('Nice. Added to your goal.'));
  });

  App.views.goals = V;
  return V;
})();
