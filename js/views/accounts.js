'use strict';
const AccountsView = (() => {
  const V = { showArchived: false };
  const { h, money } = U;

  const card = (a, hist) => {
    const bal = Q.balance(a.id), ty = Q.accType(a), liab = Q.isLiability(a);
    const mine = S.state.transactions.filter(x => x.accountId === a.id || x.toAccountId === a.id), n = mine.length;
    const last = mine.reduce((m, x) => (x.date <= U.today() && x.date > m ? x.date : m), ''), h6 = hist.get(a.id) || [];
    return h`<article class="card acct${a.archived ? ' arch' : ''}">
      <header>${UI.accIcon(a)}<div class="a-t"><h3>${a.name}</h3><small>${t(ty.label)}${a.archived ? ' · ' + t('Archived') : ''}</small></div>
        <button class="btn icon ghost sm" data-act="acc:edit" data-id="${a.id}" data-tip="${t('Edit')}">${UI.icon('edit', 15)}</button></header>
      <div class="a-bal"><small>${liab ? t('Balance owed') : t('Balance')}</small><b class="num ${bal < 0 && !liab ? 'neg' : ''}">${money(liab ? -bal : bal)}</b></div>
      <div class="a-spark">${C.spark(h6, { color: a.color })}<small>${t('Last 6 months')}</small></div>
      <dl class="a-meta">
        <div><dt>${t('Opening balance')}</dt><dd class="num">${money(liab ? -a.opening : a.opening)}</dd></div>
        <div><dt>${t('Entries')}</dt><dd>${n}</dd></div>
        <div><dt>${t('Last entry')}</dt><dd>${last ? U.fmtDate(last, 'short') : '—'}</dd></div>
      </dl>
      <footer>
        <a class="btn sm" href="#/transactions?acc=${a.id}">${t('Ledger')}</a>
        <button class="btn sm" data-act="acc:reconcile" data-id="${a.id}" ${n ? '' : 'disabled'}>${UI.icon('check', 14)}${t('Reconcile')}</button>
        <button class="btn sm ghost" data-act="acc:archive" data-id="${a.id}">${a.archived ? t('Restore') : t('Archive')}</button>
      </footer></article>`;
  };

  V.render = () => {
    const all = Q.accounts(true), live = all.filter(a => !a.archived), arch = all.filter(a => a.archived);
    const nw = Q.netWorth(), hist = Q.balanceHistory(6);
    const assets = live.filter(a => !Q.isLiability(a)), liabs = live.filter(Q.isLiability);
    return h`
      ${UI.pageHead({ title: t('Accounts'), sub: t('Where your money lives. Balances update from the transactions you enter.'),
        actions: h`<button class="btn" data-act="tx:new" data-type="transfer">${UI.icon('swap', 16)}<span>${t('Transfer')}</span></button><button class="btn primary" data-act="acc:new">${UI.icon('plus', 16)}<span>${t('Add account')}</span></button>` })}
      <div class="kpis three">
        ${UI.kpi({ label: t('Assets'), value: money(nw.assets), sub: U.plural(assets.length, 'account'), tone: 'inc' })}
        ${UI.kpi({ label: t('Liabilities'), value: money(nw.liabilities), sub: liabs.length ? U.plural(liabs.length, 'account') : t('Nothing owed'), tone: 'exp' })}
        ${UI.kpi({ label: t('Net worth'), value: money(nw.net), sub: t('Assets minus liabilities'), tone: nw.net >= 0 ? 'pos' : 'neg' })}
      </div>
      ${live.length ? h`
        ${assets.length ? h`<h2 class="sec">${t('Assets')}</h2><div class="acct-grid">${assets.map(a => card(a, hist))}</div>` : ''}
        ${liabs.length ? h`<h2 class="sec">${t('Liabilities')}</h2><div class="acct-grid">${liabs.map(a => card(a, hist))}</div>` : ''}`
        : UI.empty({ icon: 'wallet', title: t('No accounts yet'), text: t('Add the places you keep money, like a bank account, cash or a credit card.'), action: h`<button class="btn primary" data-act="acc:new">${t('Add account')}</button>` })}
      ${arch.length ? h`<div class="sec-row"><button class="btn ghost sm" data-act="acc:showarch">${V.showArchived ? t('Hide archived') : t('Show archived ({n})', { n: arch.length })}</button></div>${V.showArchived ? h`<div class="acct-grid">${arch.map(a => card(a, hist))}</div>` : ''}` : ''}`;
  };

  const form = a => {
    const ed = !!a;
    const x = a || { type: 'checking', opening: 0, color: K.PALETTE[S.state.accounts.length % K.PALETTE.length] };
    const ctl = UI.modal({
      title: ed ? t('Edit account') : t('Add account'),
      body: h`<form id="accf" novalidate data-submit="acc:save" ${ed ? h`data-id="${a.id}"` : ''}>
        <div class="field"><label for="acc-name">${t('Name')}</label><input id="acc-name" name="name" value="${x.name || ''}" required autocomplete="off" placeholder="${t('e.g. Main bank account')}"></div>
        <div class="row2">
          <div class="field"><label for="acc-type">${t('Type')}</label><select id="acc-type" name="type">${UI.options(Object.entries(K.ACCOUNT_TYPES).map(([k, v]) => [k, t(v.label)]), x.type)}</select></div>
          <div class="field"><label for="acc-open">${t('Opening balance')}</label>${UI.amountInput('acc-open', x.opening, { name: 'opening', required: false })}</div>
        </div>
        <p class="muted small">${t('For a credit card or loan, enter what you owe as a negative number, or leave it at zero.')}</p>
        <div class="field"><label>${t('Colour')}</label>${UI.swatches('color', x.color)}</div>
        <div class="form-error" role="alert" hidden></div></form>`,
      footer: h`${ed && !S.state.transactions.some(z => z.accountId === a.id || z.toAccountId === a.id) ? h`<button type="button" class="btn danger ghost push" data-act="acc:delete" data-id="${a.id}">${UI.icon('trash', 16)}${t('Delete')}</button>` : ''}
        <button type="button" class="btn" data-close>${t('Cancel')}</button><button type="submit" form="accf" class="btn primary">${t('Save')}</button>`,
    });
    V.ctl = ctl;
  };
  App.on('acc:new', () => form());
  App.on('acc:edit', el => form(Q.acc(el.dataset.id)));
  App.onSubmit('acc:save', f => {
    const d = UI.read(f), res = A.saveAccount({ id: f.dataset.id, name: d.name, type: d.type, opening: Number.isFinite(d.opening) ? d.opening : 0, color: d.color });
    if (res.error) return UI.formError(f, res.error);
    V.ctl.close(); UI.toast(t('Account saved'));
  });
  App.on('acc:delete', el => { const r = A.deleteAccount(el.dataset.id); if (r.error) return UI.toast(r.error, { kind: 'warn' }); V.ctl.close(); UI.toast(t('Account deleted')); });
  App.on('acc:archive', el => { const a = Q.acc(el.dataset.id); A.archiveAccount(a.id, !a.archived); });
  App.on('acc:showarch', () => { V.showArchived = !V.showArchived; App.render(); });

  /* ---------- reconcile ---------- */
  const diffHtml = id => {
    const stmt = U.parseAmount(U.$('#rec-bal').value), cleared = Q.clearedBalance(id), liab = Q.isLiability(Q.acc(id));
    if (!Number.isFinite(stmt)) return `<span class="muted">${U.esc(t('Enter the ending balance from your statement.'))}</span>`;
    const target = liab ? -stmt : stmt, diff = target - cleared;
    return diff === 0 ? `<span class="pos">${String(UI.icon('check', 15))} ${U.esc(t('Reconciled. Your records match the statement.'))}</span>`
      : `<span class="neg">${U.esc(t('Difference: {amount}. Tick the transactions that appear on your statement.', { amount: money(diff, { sign: true }) }))}</span>`;
  };
  App.on('acc:reconcile', el => {
    const a = Q.acc(el.dataset.id), today = U.today();
    const open = Q.filter({ accountId: a.id }).filter(x => !x.cleared && x.date <= today).slice(0, 300);
    const eff = x => Q.legs(x).filter(l => l[0] === a.id).reduce((s, l) => s + l[1], 0);
    const ctl = UI.modal({
      title: t('Reconcile {name}', { name: a.name }), size: 'lg',
      body: h`<div class="rec-top"><div class="field"><label for="rec-bal">${t('Statement ending balance')}</label>${UI.amountInput('rec-bal', 0, { name: 'bal', required: false, change: 'rec:calc' })}</div>
        <div><small class="muted">${t('Cleared balance in Ledgerly')}</small><b class="num big">${money(Q.isLiability(a) ? -Q.clearedBalance(a.id) : Q.clearedBalance(a.id))}</b></div></div>
        <div id="rec-diff" class="rec-diff" aria-live="polite"></div>
        <div class="rec-list">${open.length ? open.map(x => h`<label class="rec-row"><input type="checkbox" data-change="rec:toggle" data-id="${x.id}" data-acc="${a.id}"><span class="r-d">${U.fmtDate(x.date, 'short')}</span><span class="r-t">${UI.txTitle(x)}</span><b class="num ${eff(x) < 0 ? '' : 'pos'}">${money(eff(x), { sign: true })}</b></label>`)
          : h`<p class="muted pad">${t('Everything is already cleared.')}</p>`}</div>`,
      footer: h`<button type="button" class="btn" data-close>${t('Done')}</button>`,
      onMount: c => { U.$('#rec-diff', c.el).innerHTML = diffHtml(a.id); },
    });
    V.rec = { ctl, id: a.id };
  });
  App.onChange('rec:calc', () => { U.$('#rec-diff').innerHTML = diffHtml(V.rec.id); });
  App.onChange('rec:toggle', el => { A.setCleared([el.dataset.id], el.checked); U.$('#rec-diff').innerHTML = diffHtml(el.dataset.acc); });

  App.views.accounts = V;
  return V;
})();
