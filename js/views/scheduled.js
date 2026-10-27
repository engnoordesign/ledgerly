'use strict';
const ScheduledView = (() => {
  const V = {};
  const { h, money } = U;
  const sign = r => r.type === 'income' ? '+' : r.type === 'expense' ? '−' : '';

  const rowHtml = r => {
    const next = Q.nextOccurrence(r), cat = Q.cat(r.categoryId), acc = Q.acc(r.accountId), to = Q.acc(r.toAccountId);
    const off = r.active === false;
    return h`<div class="srow${off ? ' off' : ''}">
      ${r.type === 'transfer' ? h`<span class="cico sq" style="--c:#64748b;--s:36px">${UI.icon('swap', 19)}</span>` : UI.catIcon(cat || { color: '#64748b', icon: r.type === 'income' ? 'banknote' : 'tag' }, 36)}
      <div class="s-main"><b>${r.name}</b><span class="tx-meta"><span>${t(K.FREQ[r.frequency])}</span><span class="dotsep">·</span><span>${acc ? acc.name : '?'}${r.type === 'transfer' ? ' → ' + (to ? to.name : '?') : ''}</span>
        ${r.autoPost ? h`<span class="pill info">${t('Auto')}</span>` : h`<span class="pill">${t('Ask me')}</span>`}${off ? h`<span class="pill warn">${t('Paused')}</span>` : ''}</span></div>
      <div class="s-next">${next && !off ? h`<b>${U.relDay(next)}</b><small>${U.fmtDate(next, 'med')}</small>` : h`<small class="muted">${off ? t('Paused') : t('Finished')}</small>`}</div>
      <b class="num amt ${r.type}">${sign(r)}${money(r.amount)}</b>
      <div class="tx-actions">
        <button class="btn icon ghost sm" data-act="sch:toggle" data-id="${r.id}" data-tip="${off ? t('Resume') : t('Pause')}">${UI.icon(off ? 'play' : 'pause', 15)}</button>
        <button class="btn icon ghost sm" data-act="sch:edit" data-id="${r.id}" data-tip="${t('Edit')}">${UI.icon('edit', 15)}</button></div>
    </div>`;
  };

  V.render = () => {
    const rs = S.state.recurring, pending = Q.pending().filter(u => !u.r.autoPost), next30 = Q.upcoming(30).filter(u => u.date > U.today() || u.r.autoPost === false);
    const active = rs.filter(r => r.active !== false);
    const inc = U.sum(active.filter(r => r.type === 'income'), Q.perMonth), exp = U.sum(active.filter(r => r.type === 'expense'), Q.perMonth);
    const group = (title, list) => list.length ? h`<div class="card flush"><div class="grp-h">${title}</div>${list.map(rowHtml)}</div>` : '';
    const byWeek = [...U.groupBy(next30, u => U.weekStart(u.date, S.state.settings.weekStart))];
    return h`
      ${UI.pageHead({ title: t('Scheduled'), sub: t('Salary, rent and subscriptions that repeat. Let them post themselves, or confirm each time.'),
        actions: h`<button class="btn primary" data-act="sch:new">${UI.icon('plus', 16)}<span>${t('Add scheduled')}</span></button>` })}
      ${pending.length ? h`<section class="card attn"><h3>${UI.icon('alert', 16)} ${t('Waiting for your confirmation')}</h3>
        <div class="tx-list">${pending.map(u => h`<div class="srow"><div class="s-main"><b>${u.r.name}</b><span class="tx-meta">${U.fmtDate(u.date, 'med')} · ${U.relDay(u.date)}</span></div>
          <b class="num amt ${u.r.type}">${sign(u.r)}${money(u.r.amount)}</b>
          <div class="tx-actions show"><button class="btn sm primary" data-act="sch:confirm" data-id="${u.r.id}">${t('Confirm')}</button><button class="btn sm ghost" data-act="sch:skip" data-id="${u.r.id}">${t('Skip')}</button></div></div>`)}</div></section>` : ''}
      ${rs.length ? h`
        <div class="kpis three">
          ${UI.kpi({ label: t('Regular income'), value: money(Math.round(inc)), sub: t('per month, from {n}', { n: U.plural(active.filter(r => r.type === 'income').length, 'item') }), tone: 'inc' })}
          ${UI.kpi({ label: t('Fixed costs'), value: money(Math.round(exp)), sub: t('per month, from {n}', { n: U.plural(active.filter(r => r.type === 'expense').length, 'item') }), tone: 'exp' })}
          ${UI.kpi({ label: t('Share of income'), value: inc ? U.fmtPct(exp / inc) : '—', sub: inc && exp / inc > 0.6 ? t('High. Little room left for flexibility.') : t('Fixed costs compared with regular income') })}
        </div>
        <div class="grid">
          <div class="s8 stack">${group(t('Income'), rs.filter(r => r.type === 'income'))}${group(t('Bills and subscriptions'), rs.filter(r => r.type === 'expense'))}${group(t('Transfers and savings'), rs.filter(r => r.type === 'transfer'))}</div>
          ${UI.card(t('Next 30 days'), byWeek.length ? h`${byWeek.map(([w, us]) => h`<div class="wk"><div class="wk-h">${t('Week of {date}', { date: U.fmtDate(w, 'short') })}</div>
            ${us.map(u => h`<div class="wk-r"><span class="muted">${U.fmtDate(u.date, 'short')}</span><span>${u.r.name}</span><b class="num ${u.r.type === 'income' ? 'pos' : ''}">${sign(u.r)}${money(u.r.amount)}</b></div>`)}</div>`)}
            <div class="wk-t"><span>${t('Money in')}</span><b class="num pos">${money(U.sum(next30.filter(u => u.r.type === 'income'), u => u.r.amount))}</b></div>
            <div class="wk-t"><span>${t('Money out')}</span><b class="num">${money(U.sum(next30.filter(u => u.r.type === 'expense'), u => u.r.amount))}</b></div>`
            : UI.empty({ icon: 'calendar', title: t('Nothing due soon') }), { cls: 's4' })}
        </div>`
        : UI.empty({ icon: 'repeat', title: t('Nothing scheduled yet'), text: t('Add your salary, rent and subscriptions once. They will appear in your ledger on the right dates.'), action: h`<button class="btn primary" data-act="sch:new">${t('Add scheduled')}</button>` })}`;
  };

  const form = r => {
    const ed = !!r;
    const accs = Q.accounts();
    if (!accs.length) return UI.toast(t('Add an account first.'), { kind: 'warn' });
    const x = r || { type: 'expense', frequency: 'monthly', startDate: U.today(), autoPost: true, accountId: accs[0].id };
    V.ctl = UI.modal({
      title: ed ? t('Edit scheduled item') : t('Add scheduled item'),
      body: h`<form id="schf" novalidate data-submit="sch:save" data-type="${x.type}" ${ed ? h`data-id="${r.id}"` : ''}>
        <div class="type-tabs" role="radiogroup" aria-label="${t('Type')}">${[['expense', t('Expense')], ['income', t('Income')], ['transfer', t('Transfer')]].map(([v, l]) => h`<label class="tt ${v}"><input type="radio" name="type" value="${v}" data-change="sch:type" ${v === x.type ? 'checked' : ''}><span>${l}</span></label>`)}</div>
        <div class="field"><label for="sch-name">${t('Name')}</label><input id="sch-name" name="name" value="${x.name || ''}" required autocomplete="off" placeholder="${t('e.g. Rent')}"></div>
        <div class="row2">
          <div class="field big"><label for="sch-amt">${t('Amount')}</label>${UI.amountInput('sch-amt', x.amount, { name: 'amount' })}</div>
          <div class="field"><label for="sch-freq">${t('Repeats')}</label><select id="sch-freq" name="frequency">${UI.options(Object.entries(K.FREQ).map(([k, v]) => [k, t(v)]), x.frequency)}</select></div>
        </div>
        <div class="row2">
          <div class="field"><label for="sch-acc"><span class="not-transfer">${t('Account')}</span><span class="only-transfer">${t('From account')}</span></label><select id="sch-acc" name="accountId">${UI.accountOptions(x.accountId)}</select></div>
          <div class="field only-transfer"><label for="sch-to">${t('To account')}</label><select id="sch-to" name="toAccountId">${UI.accountOptions(x.toAccountId, { blank: t('Choose account') })}</select></div>
          <div class="field not-transfer"><label for="sch-cat">${t('Category')}</label><select id="sch-cat" name="categoryId">${UI.categoryOptions(x.type === 'income' ? 'income' : 'expense', x.categoryId, t('Uncategorized'))}</select></div>
        </div>
        <div class="field only-transfer"><label for="sch-goal">${t('Savings goal (optional)')}</label><select id="sch-goal" name="goalId">${UI.options(S.state.goals.map(g => [g.id, g.name]), x.goalId, t('No goal'))}</select></div>
        <div class="row2">
          <div class="field"><label for="sch-start">${t('First date')}</label><input type="date" id="sch-start" name="startDate" value="${x.startDate}" required></div>
          <div class="field"><label for="sch-end">${t('Ends (optional)')}</label><input type="date" id="sch-end" name="endDate" value="${x.endDate || ''}"></div>
        </div>
        <label class="check"><input type="checkbox" name="autoPost" ${x.autoPost ? 'checked' : ''}><span>${t('Add it automatically on the due date')}</span></label>
        <div class="form-error" role="alert" hidden></div></form>`,
      footer: h`${ed ? h`<button type="button" class="btn danger ghost push" data-act="sch:delete" data-id="${r.id}">${UI.icon('trash', 16)}${t('Delete')}</button>` : ''}<button type="button" class="btn" data-close>${t('Cancel')}</button><button type="submit" form="schf" class="btn primary">${t('Save')}</button>`,
    });
  };
  App.on('sch:new', () => form());
  App.on('sch:edit', el => form(S.state.recurring.find(r => r.id === el.dataset.id)));
  App.onChange('sch:type', el => {
    const f = el.form; f.dataset.type = el.value;
    if (el.value !== 'transfer') f.elements.categoryId.innerHTML = String(UI.categoryOptions(el.value === 'income' ? 'income' : 'expense', '', t('Uncategorized')));
  });
  App.onSubmit('sch:save', f => {
    const d = UI.read(f);
    const res = A.saveRecurring({ id: f.dataset.id, name: d.name, type: d.type, amount: d.amount, accountId: d.accountId, toAccountId: d.toAccountId, categoryId: d.categoryId,
      frequency: d.frequency, startDate: d.startDate, endDate: d.endDate, autoPost: d.autoPost, goalId: d.goalId });
    if (res.error) return UI.formError(f, res.error);
    V.ctl.close(); A.processRecurring(); UI.toast(t('Scheduled item saved'));
  });
  App.on('sch:delete', async el => {
    const r = S.state.recurring.find(z => z.id === el.dataset.id);
    if (await UI.confirm({ title: t('Delete this scheduled item?'), message: t('“{name}” will stop repeating. Transactions it already created stay in your ledger.', { name: r.name }), confirm: t('Delete'), danger: true })) {
      V.ctl.close(); A.deleteRecurring(r.id); UI.toast(t('Scheduled item deleted'));
    }
  });
  App.on('sch:toggle', el => A.toggleRecurring(el.dataset.id));
  App.on('sch:confirm', el => { A.confirmOccurrence(el.dataset.id); UI.toast(t('Added to your ledger')); });
  App.on('sch:skip', el => { A.skipOccurrence(el.dataset.id); UI.toast(t('Skipped this time')); });

  App.views.scheduled = V;
  return V;
})();
