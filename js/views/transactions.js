'use strict';
const TransactionsView = (() => {
  const V = {};
  const { h, money } = U;
  const fresh = () => ({ q: '', type: '', accountId: '', categoryId: '', importance: '', range: 'cur', from: '', to: '', limit: 100, picked: new Set(),
    group: V.f ? V.f.group : 'day', sort: V.f ? V.f.sort : 'new', open: new Set(), more: false });
  V.f = fresh();

  const rangeOptions = () => {
    const o = [['cur', t('This month')], ['prev', t('Last month')], ['l30', t('Last 30 days')], ['l90', t('Last 90 days')], ['ytd', t('This year')], ['all', t('All time')], ['custom', t('Custom range')]];
    if (/^m:/.test(V.f.range)) o.unshift([V.f.range, U.fmtMonth(V.f.range.slice(2))]);
    return o;
  };
  const rangeDates = () => {
    const f = V.f, today = U.today(), cm = U.curMonth();
    if (/^m:/.test(f.range)) { const k = f.range.slice(2); return [U.monthStart(k), U.monthEnd(k)]; }
    switch (f.range) {
      case 'cur': return [U.monthStart(cm), U.monthEnd(cm)];
      case 'prev': { const k = U.addMonthKey(cm, -1); return [U.monthStart(k), U.monthEnd(k)]; }
      case 'l30': return [U.addDays(today, -29), today];
      case 'l90': return [U.addDays(today, -89), today];
      case 'ytd': return [U.yearStart(today.slice(0, 4)), today];
      case 'custom': return [f.from || '', f.to || ''];
      default: return ['', ''];
    }
  };
  const results = () => {
    const f = V.f, [from, to] = rangeDates();
    return Q.filter({ q: f.q, type: f.type, accountId: f.accountId, categoryId: f.categoryId, importance: f.importance, from, to });
  };

  const resultsHtml = () => {
    const list = results(), f = V.f, shown = list.slice(0, f.limit);
    const inc = U.sum(list.filter(x => x.type === 'income'), x => x.amount), exp = U.sum(list.filter(x => x.type === 'expense'), x => x.amount);
    if (!list.length) {
      return h`${UI.empty({ icon: 'search', title: S.state.transactions.length ? t('Nothing matches these filters') : t('No transactions yet'),
        text: S.state.transactions.length ? t('Try a wider date range or clear the search.') : t('Add your first income or expense to get started.'),
        action: S.state.transactions.length ? h`<button class="btn" data-act="tx:reset">${t('Clear filters')}</button>` : h`<button class="btn primary" data-act="tx:new">${UI.icon('plus', 16)}${t('Add transaction')}</button>` })}`;
    }
    const groups = Q.groupBy(list, f.group, f.sort), today = U.today();
    const cap = f.group === 'day' ? f.limit : 3000;
    let left = cap;
    const totals = g => h`<span class="g-tot"><span class="num pos" data-tip="${t('Income')}">+${money(g.income)}</span><span class="num neg-soft" data-tip="${t('Expenses')}">−${money(g.expense)}</span><b class="num ${g.net < 0 ? 'neg' : 'pos'}" data-tip="${t('Net')}">${money(g.net, { sign: true })}</b></span>`;
    const rows = g => { const xs = g.items.slice(0, Math.max(0, left)); left -= xs.length; return h`${xs.map(x => UI.txRow(x, { select: true, actions: true, picked: f.picked.has(x.id), date: f.group === 'day' ? '' : 'short' }))}`; };
    const shownCount = Math.min(list.length, cap);
    const body = f.group === 'day'
      ? groups.map(g => left <= 0 ? '' : h`<div class="day"><div class="day-h"><b>${U.fmtDate(g.key, 'long')}</b><span class="muted">${g.key === today ? t('Today') : g.key > today ? U.relDay(g.key) : ''}</span>${totals(g)}</div>${rows(g)}</div>`)
      : groups.map((g, i) => { const open = f.open.has(g.key) || (!f.open.size && i < 2); return h`<details class="grp" data-grp="${g.key}" ${open ? 'open' : ''}>
          <summary class="tg-h"><span class="grp-t"><b>${f.group === 'week' ? t('Week of {range}', { range: g.label }) : g.label}</b><small class="muted">${U.plural(g.count, 'transaction')}</small></span>${totals(g)}</summary>${rows(g)}</details>`; });
    return h`
      <div class="sum-strip">
        <span><small>${t('Showing')}</small><b>${U.plural(list.length, 'transaction')}</b></span>
        <span><small>${t('Income')}</small><b class="num pos">${money(inc)}</b></span>
        <span><small>${t('Expenses')}</small><b class="num">${money(exp)}</b></span>
        <span><small>${t('Net')}</small><b class="num ${inc - exp < 0 ? 'neg' : 'pos'}">${money(inc - exp, { sign: true })}</b></span>
      </div>
      <div class="card flush">
        <div class="list-head"><label class="chk"><input type="checkbox" data-change="tx:pickall" aria-label="${t('Select all shown')}" ${shown.length && shown.every(x => f.picked.has(x.id)) ? 'checked' : ''}><i></i></label><span class="muted small">${t('Select all shown')}</span>
          ${f.group !== 'day' ? h`<span class="push"></span><button type="button" class="btn ghost sm" data-act="tx:openall" data-v="1">${t('Open all')}</button><button type="button" class="btn ghost sm" data-act="tx:openall" data-v="0">${t('Close all')}</button>` : ''}</div>
        ${body}
        ${f.group === 'day' && list.length > shownCount ? h`<div class="more-row"><button class="btn" data-act="tx:more">${t('Show more')} (${list.length - shownCount})</button></div>` : ''}
      </div>`;
  };
  const bulkHtml = () => {
    const n = V.f.picked.size;
    if (!n) return h``;
    return h`<div class="bulk" role="region" aria-label="${t('Selected transactions')}"><b>${t('{n} selected', { n })}</b>
      <select id="bulk-cat" data-change="tx:bulkcat" aria-label="${t('Change category')}"><option value="">${t('Change category…')}</option><option value="_none">${t('Uncategorized')}</option>${Q.cats().map(c => h`<option value="${c.id}">${Q.catName(c)}</option>`)}</select>
      <button class="btn sm" data-act="tx:bulkclear">${UI.icon('check', 14)}${t('Mark cleared')}</button>
      <button class="btn sm danger" data-act="tx:bulkdel">${UI.icon('trash', 14)}${t('Delete')}</button>
      <button class="btn sm ghost" data-act="tx:unpick">${t('Clear selection')}</button></div>`;
  };

  V.render = () => {
    const f = V.f, nMore = [f.accountId, f.categoryId, f.importance].filter(Boolean).length;
    if (nMore) f.more = true;
    return h`
      ${UI.pageHead({ title: t('Transactions'), sub: t('Organise your money by day, week or month.'),
        actions: h`<a class="btn hide-sm" href="#/data">${UI.icon('upload', 16)}<span>${t('Import / Export')}</span></a><button class="btn primary" data-act="tx:new">${UI.icon('plus', 16)}<span>${t('New')}</span></button>` })}
      <div class="levels">
        <div class="lv-l"><small class="muted">${t('Group by')}</small>${UI.seg('tx:group', [['day', t('Daily')], ['week', t('Weekly')], ['month', t('Monthly')]], f.group, 'fit')}</div>
        <div class="lv-l"><small class="muted">${t('Sort')}</small><select id="tx-sort" data-change="tx:sort" aria-label="${t('Sort')}">${UI.options([['new', t('Newest first')], ['old', t('Oldest first')], ['big', t('Largest amounts first')]], f.sort)}</select></div>
        <div class="lv-l"><small class="muted">${t('Period')}</small><select id="tx-range" data-change="tx:range" aria-label="${t('Date range')}">${UI.options(rangeOptions(), f.range)}</select></div>
      </div>
      <div class="filters">
        <div class="search">${UI.icon('search', 16)}<input id="tx-q" type="search" data-input="tx:q" value="${f.q}" placeholder="${t('Search payee, note, category, amount…')}" aria-label="${t('Search')}" autocomplete="off"></div>
        <button type="button" class="btn ${nMore ? 'on' : ''}" data-act="tx:morefilters" aria-expanded="${f.more}">${UI.icon('settings', 16)}<span>${nMore ? t('Filters ({n})', { n: nMore }) : t('Filters')}</span></button>
        ${UI.seg('tx:type', [['', t('All')], ['income', t('Income')], ['expense', t('Expenses')], ['transfer', t('Transfers')]], f.type, 'fit')}
        ${f.more ? h`<select id="tx-acc" data-change="tx:acc" aria-label="${t('Account')}">${UI.accountOptions(f.accountId, { blank: t('All accounts'), all: true })}</select>
        <select id="tx-cat" data-change="tx:cat" aria-label="${t('Category')}">${UI.options([...Q.cats('expense', true), ...Q.cats('income', true)].map(c => [c.id, Q.catName(c) + ' · ' + (c.type === 'income' ? t('Income') : t('Expense'))]), f.categoryId, t('All categories'))}</select>
        <select id="tx-imp" data-change="tx:imp" aria-label="${t('Importance')}">${UI.options([...Q.importance(f.type === 'income' ? 'income' : 'expense').map(i => [i.level, i.label]), ['none', t('Not set')]], f.importance, t('Any importance'))}</select>
        ${nMore ? h`<button type="button" class="btn ghost sm" data-act="tx:reset">${t('Clear filters')}</button>` : ''}` : ''}
        ${f.range === 'custom' ? h`<div class="range-in"><input type="date" id="tx-from" data-change="tx:from" value="${f.from}" aria-label="${t('From')}"><span>\u2192</span><input type="date" id="tx-to" data-change="tx:to" value="${f.to}" aria-label="${t('To')}"></div>` : ''}
      </div>
      <div id="tx-bulk">${bulkHtml()}</div>
      <div id="tx-results">${resultsHtml()}</div>`;
  };

  const refresh = () => { U.$('#tx-results').innerHTML = resultsHtml(); U.$('#tx-bulk').innerHTML = bulkHtml(); };
  const apply = fn => { fn(V.f); V.f.limit = 100; App.render(); };

  /** Replace the filters (used by links from other pages). */
  V.open = patch => { V.f = { ...fresh(), ...patch }; V.skipEnter = true; };

  /** Hash query (?cat=…&month=…&acc=…&goal=…) pre-sets filters, e.g. from dashboard links. */
  V.enter = params => {
    if (!params || ![...params.keys()].length) return;
    V.f = fresh();
    if (params.get('cat')) V.f.categoryId = params.get('cat');
    if (params.get('acc')) V.f.accountId = params.get('acc');
    if (params.get('month')) V.f.range = 'm:' + params.get('month');
    if (params.get('type')) V.f.type = params.get('type');
    if (params.get('imp')) V.f.importance = params.get('imp');
    if (params.get('q')) V.f.q = params.get('q');
    if (['day', 'week', 'month'].includes(params.get('group'))) V.f.group = params.get('group');
    if (params.get('range')) V.f.range = params.get('range');
    if (params.get('new')) setTimeout(() => TxForm.open(), 50);   // app shortcut: "New transaction"
  };

  App.onInput('tx:q', U.debounce(el => { V.f.q = el.value; V.f.limit = 100; refresh(); }, 150));
  App.on('tx:type', el => apply(f => { f.type = el.dataset.v; }));
  App.on('tx:group', el => apply(f => {
    f.group = el.dataset.v; f.open = new Set();
    if (f.group === 'week' && ['cur', 'prev', 'l30'].includes(f.range)) f.range = 'l90';            // a few weeks to compare
    if (f.group === 'month' && ['cur', 'prev', 'l30', 'l90'].includes(f.range)) f.range = 'ytd';     // the months of this year
  }));
  App.onChange('tx:sort', el => apply(f => { f.sort = el.value; }));
  App.on('tx:morefilters', () => { V.f.more = !V.f.more; App.render(); });
  App.on('tx:openall', el => { const on = el.dataset.v === '1'; U.$$('details[data-grp]').forEach(d => { d.open = on; }); });
  // remember which week / month groups are open across re-renders
  document.addEventListener('toggle', e => {
    const d = e.target;
    if (!d.matches || !d.matches('details[data-grp]')) return;
    if (!V.f.open.size) U.$$('details[data-grp]').forEach(x => { if (x.open) V.f.open.add(x.dataset.grp); });
    if (d.open) V.f.open.add(d.dataset.grp); else V.f.open.delete(d.dataset.grp);
    if (!V.f.open.size) V.f.open.add('_none');
  }, true);
  App.onChange('tx:range', el => apply(f => { f.range = el.value; }));
  App.onChange('tx:acc', el => apply(f => { f.accountId = el.value; }));
  App.onChange('tx:cat', el => apply(f => { f.categoryId = el.value; }));
  App.onChange('tx:imp', el => apply(f => { f.importance = el.value; }));
  App.onChange('tx:from', el => apply(f => { f.from = el.value; }));
  App.onChange('tx:to', el => apply(f => { f.to = el.value; }));
  App.on('tx:reset', () => { V.f = fresh(); App.render(); });
  App.on('tx:more', () => { V.f.limit += 200; refresh(); });
  App.onChange('tx:pick', el => { el.checked ? V.f.picked.add(el.dataset.id) : V.f.picked.delete(el.dataset.id); U.$('#tx-bulk').innerHTML = bulkHtml(); });
  App.onChange('tx:pickall', el => {
    const ids = results().slice(0, V.f.limit).map(x => x.id);
    ids.forEach(id => (el.checked ? V.f.picked.add(id) : V.f.picked.delete(id)));
    refresh();
  });
  App.on('tx:unpick', () => { V.f.picked.clear(); refresh(); });
  App.on('tx:bulkdel', () => { const ids = [...V.f.picked]; V.f.picked.clear(); TxForm.del(ids); });
  App.on('tx:bulkclear', () => { A.setCleared([...V.f.picked], true); V.f.picked.clear(); UI.toast(t('Marked as cleared')); });
  App.onChange('tx:bulkcat', el => {
    if (!el.value) return;
    A.recategorize([...V.f.picked], el.value === '_none' ? '' : el.value);
    V.f.picked.clear(); UI.toast(t('Category updated'));
  });

  V.results = results;
  App.on('tx:export', () => {
    const list = results();
    U.download(`ledgerly-transactions-${U.today()}.csv`, '\uFEFF' + A.exportCsv(list), 'text/csv');
    UI.toast(t('Exported {n}.', { n: U.plural(list.length, 'transaction') }));
  });

  /* ---------- bank CSV import ---------- */
  App.on('tx:import', () => {
    const accs = Q.accounts();
    if (!accs.length) return UI.toast(t('Add an account first.'), { kind: 'warn' });
    const ctl = UI.modal({
      title: t('Import transactions from a CSV file'), size: 'lg',
      body: h`<form id="impf" novalidate>
        <p class="muted">${t('Use a file exported from Ledgerly, a spreadsheet saved as CSV, or your bank’s CSV. It needs Date and Amount columns; Type, Account, Category, Purpose and Importance are used when present. Negative amounts become expenses. New categories are added and rows already in your ledger are skipped.')}</p>
        <div class="row2">
          <div class="field"><label for="imp-file">${t('CSV file')}</label><input type="file" id="imp-file" accept=".csv,text/csv,text/plain" data-change="imp:file"></div>
          <div class="field"><label for="imp-acc">${t('Account for rows that do not name one')}</label><select id="imp-acc" name="accountId">${UI.accountOptions(accs[0].id)}</select></div>
        </div>
        <div class="field"><label for="imp-order">${t('Dates like 03/04/2026 mean')}</label><select id="imp-order" name="order" data-change="imp:file">${UI.options([['mdy', t('Month / Day / Year')], ['dmy', t('Day / Month / Year')]], 'mdy')}</select></div>
        <div id="imp-preview"></div><div class="form-error" hidden></div></form>`,
      footer: h`<button type="button" class="btn" data-close>${t('Cancel')}</button><button type="button" class="btn primary" id="imp-go" data-act="imp:go" disabled>${t('Import')}</button>`,
    });
    V.imp = { ctl, rows: [] };
  });
  App.onChange('imp:file', async () => {
    const f = U.$('#imp-file').files[0], box = U.$('#imp-preview'), go = U.$('#imp-go');
    if (!f) return;
    const text = await f.text(), res = A.parseBankCsv(text, { dateOrder: U.$('#imp-order').value });
    if (res.error) { box.innerHTML = `<div class="notice bad">${U.esc(res.error)}</div>`; go.disabled = true; return; }
    V.imp.rows = res.rows; go.disabled = !res.rows.length;
    const sample = res.rows.slice(0, 6);
    box.innerHTML = String(h`<div class="notice ok">${t('{n} ready to import.', { n: U.plural(res.rows.length, 'row') })}${res.errors.length ? ' ' + t('{n} skipped.', { n: U.plural(res.errors.length, 'row') }) : ''}</div>
      <div class="table-wrap"><table class="plain"><thead><tr><th>${t('Date')}</th><th>${t('Type')}</th><th>${t('Category')}</th><th>${t('Description')}</th><th class="r">${t('Amount')}</th></tr></thead><tbody>
      ${sample.map(r => h`<tr><td>${U.fmtDate(r.date, 'med')}</td><td>${{ income: t('Income'), expense: t('Expense'), transfer: t('Transfer') }[r.type]}</td><td>${r.categoryName || '\u2014'}</td><td>${r.payee || r.purpose || '\u2014'}</td><td class="r num ${r.type === 'income' ? 'pos' : ''}">${money(r.type === 'expense' ? -r.amount : r.amount)}</td></tr>`)}</tbody></table></div>
      ${res.errors.length ? h`<details class="more"><summary>${t('Skipped rows')}</summary><ul class="small muted">${res.errors.slice(0, 20).map(e => h`<li>${e}</li>`)}</ul></details>` : ''}`);
  });
  App.on('imp:go', () => {
    const acc = U.$('#imp-acc').value, res = A.importRows(V.imp.rows, acc);
    if (res.error) return UI.formError(U.$('#impf'), res.error);
    V.imp.ctl.close();
    UI.toast(t('Imported {n}. {m} duplicates skipped.', { n: U.plural(res.added, 'transaction'), m: res.skipped })
      + (res.newCategories ? ' ' + t('{n} new categories.', { n: res.newCategories }) : '') + (res.newAccounts ? ' ' + t('{n} new accounts.', { n: res.newAccounts }) : ''), { ms: 9000 });
  });

  App.views.transactions = V;
  return V;
})();
