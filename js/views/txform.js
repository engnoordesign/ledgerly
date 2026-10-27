'use strict';
/* The add / edit transaction dialog and the global transaction actions (used from every page). */
const TxForm = (() => {
  const TF = {};
  const { h } = U;

  TF.open = (init = {}) => {
    const accs = Q.accounts();
    if (!accs.length) { UI.toast(t('Add an account first.'), { kind: 'warn' }); location.hash = '#/accounts'; return; }
    const editing = !!init.id;
    const x = { type: 'expense', date: U.today(), accountId: (TF.lastAccount && Q.acc(TF.lastAccount) && !Q.acc(TF.lastAccount).archived ? TF.lastAccount : accs[0].id), cleared: false, ...init };
    const payees = [...Q.payees().values()].sort((a, b) => b.count - a.count).slice(0, 80);
    const catType = x.type === 'income' ? 'income' : 'expense';
    const body = h`<form id="txf" novalidate data-submit="txf" data-type="${x.type}" ${editing ? h`data-id="${x.id}"` : ''}>
      <div class="type-tabs" role="radiogroup" aria-label="${t('Type')}">
        ${[['expense', t('Expense')], ['income', t('Income')], ['transfer', t('Transfer')]].map(([v, l]) => h`<label class="tt ${v}"><input type="radio" name="type" value="${v}" data-change="txf:type" ${v === x.type ? 'checked' : ''}><span>${l}</span></label>`)}
      </div>
      <div class="field big"><label for="txf-amount">${t('Amount')}</label>${UI.amountInput('txf-amount', x.amount, { name: 'amount', autofocus: !editing })}</div>
      <div class="row2">
        <div class="field"><label for="txf-date">${t('Date')}</label>
          <input type="date" id="txf-date" name="date" value="${x.date}" required>
          <div class="quick"><button type="button" class="chipbtn" data-act="txf:date" data-v="0">${t('Today')}</button><button type="button" class="chipbtn" data-act="txf:date" data-v="-1">${t('Yesterday')}</button></div></div>
        <div class="field"><label for="txf-acc"><span class="not-transfer">${t('Account')}</span><span class="only-transfer">${t('From account')}</span></label>
          <select id="txf-acc" name="accountId">${UI.accountOptions(x.accountId, { all: false })}${x.accountId && Q.acc(x.accountId) && Q.acc(x.accountId).archived ? h`<option value="${x.accountId}" selected>${Q.acc(x.accountId).name}</option>` : ''}</select></div>
      </div>
      <div class="field only-transfer"><label for="txf-to">${t('To account')}</label>
        <select id="txf-to" name="toAccountId">${UI.accountOptions(x.toAccountId, { blank: t('Choose account') })}</select></div>
      <div class="field only-transfer"><label for="txf-goal">${t('Savings goal (optional)')}</label>
        <select id="txf-goal" name="goalId" data-change="txf:goal">${UI.options(S.state.goals.map(g => [g.id, g.name]), x.goalId, t('No goal'))}</select></div>
      <div class="field not-transfer"><label for="txf-cat">${t('Category')}</label>
        <select id="txf-cat" name="categoryId">${UI.categoryOptions(catType, x.categoryId, t('Uncategorized'))}</select></div>
      <div class="field"><label for="txf-payee"><span class="not-transfer">${t('Payee or description')}</span><span class="only-transfer">${t('Description')}</span></label>
        <input id="txf-payee" name="payee" value="${x.payee || ''}" list="txf-payees" autocomplete="off" data-input="txf:payee" placeholder="${t('e.g. Green Basket Market')}">
        <datalist id="txf-payees">${payees.map(p => h`<option value="${p.name}"></option>`)}</datalist></div>
      <details class="more"${(x.note || (x.tags || []).length || x.cleared) ? ' open' : ''}><summary>${t('More options')}</summary>
        <div class="field"><label for="txf-note">${t('Note')}</label><input id="txf-note" name="note" value="${x.note || ''}"></div>
        <div class="field"><label for="txf-tags">${t('Tags')}</label><input id="txf-tags" name="tags" value="${(x.tags || []).join(' ')}" placeholder="${t('separate with spaces')}"></div>
        <label class="check"><input type="checkbox" name="cleared" ${x.cleared ? 'checked' : ''}><span>${t('Cleared (matches my bank statement)')}</span></label>
        ${editing ? '' : h`<div class="field"><label for="txf-repeat">${t('Repeat')}</label>
          <select id="txf-repeat" name="repeat">${UI.options([['', t('Does not repeat')], ...Object.entries(K.FREQ).map(([k, v]) => [k, t(v)])], '')}</select></div>`}
      </details>
      <div class="form-error" role="alert" hidden></div>
    </form>`;
    const footer = h`${editing ? h`<button type="button" class="btn danger ghost push" data-act="tx:del-modal" data-id="${x.id}">${UI.icon('trash', 16)}${t('Delete')}</button>` : ''}
      <button type="button" class="btn" data-close>${t('Cancel')}</button>
      ${editing ? '' : h`<button type="submit" form="txf" class="btn" data-again="1">${t('Save and add another')}</button>`}
      <button type="submit" form="txf" class="btn primary">${editing ? t('Save changes') : t('Save')}</button>`;
    const ctl = UI.modal({ title: editing ? t('Edit transaction') : t('New transaction'), body, footer });
    TF.ctl = ctl;
    return ctl;
  };

  const fillCategories = form => {
    const type = form.elements.type.value, sel = form.elements.categoryId;
    form.dataset.type = type;
    if (type !== 'transfer') sel.innerHTML = String(UI.categoryOptions(type === 'income' ? 'income' : 'expense', '', t('Uncategorized')));
  };
  App.onChange('txf:type', el => fillCategories(el.form));
  App.onChange('txf:goal', el => {
    const g = Q.goalMap().get(el.value);
    if (g) el.form.elements.toAccountId.value = g.accountId;
  });
  App.on('txf:date', el => { const f = U.$('#txf'); f.elements.date.value = U.addDays(U.today(), +el.dataset.v); });
  App.onInput('txf:payee', el => {
    const p = Q.payees().get(el.value.trim().toLowerCase());
    if (!p) return;
    const f = el.form;
    if (p.type === f.elements.type.value) {
      if (f.elements.categoryId && !f.elements.categoryId.value && p.categoryId) f.elements.categoryId.value = p.categoryId;
      if (!f.elements.amount.value.trim()) f.elements.amount.value = U.toInput(p.amount);
    }
  });

  App.onSubmit('txf', (form, e) => {
    const d = UI.read(form), again = e.submitter && e.submitter.dataset.again;
    const data = { type: d.type, amount: d.amount, date: d.date, accountId: d.accountId, toAccountId: d.toAccountId, categoryId: d.categoryId,
      payee: d.payee, note: d.note, tags: d.tags, cleared: d.cleared, goalId: d.goalId };
    const id = form.dataset.id;
    let res;
    if (id) res = A.updateTx(id, data);
    else if (d.repeat && Number.isFinite(d.amount) && d.amount > 0 && !A.validateTx(data)) {
      const label = d.payee || (d.type === 'transfer' ? t('Transfer') : Q.catName(Q.cat(d.categoryId)));
      const r = A.saveRecurring({ name: label, type: d.type, amount: d.amount, accountId: d.accountId, toAccountId: d.toAccountId, categoryId: d.categoryId,
        payee: d.payee, note: d.note, frequency: d.repeat, startDate: d.date, autoPost: true, goalId: d.goalId });
      S.commit(st => { const rr = st.recurring.find(z => z.id === r.id); rr.count = 1; rr.lastPosted = d.date; }, { silent: true });
      res = A.addTx({ ...data, recurringId: r.id, recurringIndex: 0 });
    } else res = A.addTx(data);
    if (res.error) { UI.formError(form, res.error); return; }
    TF.lastAccount = d.accountId;
    TF.ctl.close(true);
    UI.toast(id ? t('Changes saved') : t('Transaction saved'));
    if (again) TF.open({ type: d.type, date: d.date, accountId: d.accountId });
  });

  /* ---------- global transaction actions ---------- */
  App.on('tx:new', el => TF.open(el && el.dataset && el.dataset.type ? { type: el.dataset.type } : {}));
  App.on('tx:edit', el => { const x = S.state.transactions.find(z => z.id === el.dataset.id); if (x) TF.open(x); });
  App.on('tx:dup', el => { const x = S.state.transactions.find(z => z.id === el.dataset.id); if (x) TF.open({ ...x, id: undefined, date: U.today(), cleared: false, recurringId: undefined }); });
  App.on('tx:clear', el => { const x = S.state.transactions.find(z => z.id === el.dataset.id); if (x) A.setCleared([x.id], !x.cleared); });
  const del = ids => {
    const removed = A.deleteTx(ids);
    UI.toast(t('{n} deleted', { n: U.plural(removed.length, 'transaction') }), { action: { label: t('Undo'), fn: () => A.restoreTx(removed) } });
  };
  TF.del = del;
  App.on('tx:del', el => del([el.dataset.id]));
  App.on('tx:del-modal', el => { TF.ctl.close(); del([el.dataset.id]); });

  return TF;
})();
