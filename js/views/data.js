'use strict';
/* Import & Export: every way data comes in or goes out, on one page. */
const DataView = (() => {
  const V = { range: 'all', level: 'month', from: '', to: '' };
  const { h, money } = U;

  const ranges = () => [['all', t('All time')], ['cur', t('This month')], ['prev', t('Last month')], ['ytd', t('This year')], ['lyear', t('Last year')], ['custom', t('Custom range')]];
  const dates = () => {
    const cm = U.curMonth(), today = U.today(), y = +today.slice(0, 4);
    switch (V.range) {
      case 'cur': return [U.monthStart(cm), U.monthEnd(cm)];
      case 'prev': { const k = U.addMonthKey(cm, -1); return [U.monthStart(k), U.monthEnd(k)]; }
      case 'ytd': return [U.yearStart(String(y)), today];
      case 'lyear': return [U.yearStart(String(y - 1)), U.yearEnd(String(y - 1))];
      case 'custom': return [V.from || '', V.to || ''];
      default: return ['', ''];
    }
  };
  const list = () => { const [from, to] = dates(); return Q.filter({ from, to }); };
  const suffix = () => { const [from, to] = dates(); return from || to ? `${from || 'start'}_${to || U.today()}` : U.today(); };

  V.render = () => {
    const xs = list(), meta = S.state.meta;
    const inc = U.sum(xs.filter(x => x.type === 'income'), x => x.amount), exp = U.sum(xs.filter(x => x.type === 'expense'), x => x.amount);
    const backupAge = meta.lastBackup ? U.diffDays(meta.lastBackup, U.today()) : null;
    const groups = Q.groupBy(xs, V.level, 'new').slice(0, 6);
    const [dFrom, dTo] = dates(), stmtFrom = dFrom || (xs.length ? xs[xs.length - 1].date : U.today()), stmtTo = dTo || U.today();   // the statement opens on the period chosen above
    return h`
      ${UI.pageHead({ title: t('Import & Export'), sub: t('Move your data in and out: Excel-friendly CSV files and full backups.') })}
      <div class="grid">
        ${UI.card(t('Export'), h`
          <div class="form-grid">
            <div class="field"><label for="dx-range">${t('Period')}</label><select id="dx-range" data-change="dx:range">${UI.options(ranges(), V.range)}</select></div>
            ${V.range === 'custom' ? h`<div class="field"><label>${t('From')} / ${t('To')}</label><div class="range-in"><input type="date" id="dx-from" data-change="dx:from" value="${V.from}" aria-label="${t('From')}"><span>→</span><input type="date" id="dx-to" data-change="dx:to" value="${V.to}" aria-label="${t('To')}"></div></div>` : ''}
          </div>
          <p class="muted small">${t('{n} in this period', { n: U.plural(xs.length, 'transaction') })} · ${t('Income')} <b class="num pos">${money(inc)}</b> · ${t('Expenses')} <b class="num">${money(exp)}</b></p>
          <div class="io-list">
            <div class="io"><span class="io-i">${UI.icon('file', 20)}</span><div><b>${t('Transactions (CSV for Excel)')}</b><small class="muted">${t('Every entry with its category, importance, week and month. Opens in Excel, Google Sheets or Numbers.')}</small></div>
              <button class="btn primary" data-act="dx:csv" ${xs.length ? '' : 'disabled'}>${UI.icon('download', 16)}<span>${t('Download')}</span></button></div>
            <div class="io"><span class="io-i">${UI.icon('layers', 20)}</span><div><b>${t('Totals by day, week or month (CSV)')}</b><small class="muted">${t('One row per period with income, expenses and net.')}</small>
              ${UI.seg('dx:level', [['day', t('Daily')], ['week', t('Weekly')], ['month', t('Monthly')]], V.level, 'fit')}</div>
              <button class="btn" data-act="dx:summary" ${xs.length ? '' : 'disabled'}>${UI.icon('download', 16)}<span>${t('Download')}</span></button></div>
            <div class="io"><span class="io-i">${UI.icon('printer', 20)}</span><div><b>${t('Printable statement (PDF)')}</b><small class="muted">${t('A tidy statement of income and expenses for a day, week, month, year or any dates. Print it or save it as a PDF.')}</small></div>
              <button class="btn" data-act="stmt:open" data-kind="custom" data-from="${stmtFrom}" data-to="${stmtTo}">${UI.icon('printer', 16)}<span>${t('Open')}</span></button></div>
            <div class="io"><span class="io-i">${UI.icon('shield', 20)}</span><div><b>${t('Full backup (JSON)')}</b><small class="muted">${t('Everything: accounts, categories, budgets, goals and settings. Restore it here on any device.')}</small>
              <small class="backup ${backupAge == null || backupAge > 30 ? 'warn' : ''}">${meta.lastBackup ? t('Last backup: {date}', { date: U.fmtDate(meta.lastBackup, 'med') }) : t('You have not made a backup yet.')}</small></div>
              <button class="btn" data-act="data:export">${UI.icon('download', 16)}<span>${t('Download')}</span></button></div>
          </div>`, { cls: 's7' })}

        ${UI.card(t('Import'), h`
          <div class="io-list">
            <div class="io"><span class="io-i">${UI.icon('upload', 20)}</span><div><b>${t('Transactions from a CSV file')}</b><small class="muted">${t('A Ledgerly export you edited in Excel, another spreadsheet, or your bank’s statement. Duplicates are skipped and new categories are added.')}</small></div>
              <button class="btn primary" data-act="tx:import">${UI.icon('upload', 16)}<span>${t('Choose file')}</span></button></div>
            <div class="io"><span class="io-i">${UI.icon('undo', 20)}</span><div><b>${t('Restore a backup (JSON)')}</b><small class="muted">${t('Replaces everything in this profile with the backup. You can undo it right after.')}</small></div>
              <button class="btn" data-act="data:import">${UI.icon('upload', 16)}<span>${t('Choose file')}</span></button></div>
          </div>
          <input type="file" id="data-file" accept=".json,application/json" hidden data-change="data:file">
          <p class="muted small">${t('Tip: export transactions, edit or add rows in Excel, save as CSV, then import the file back.')}</p>`, { cls: 's5' })}

        ${UI.card(t('Preview by period'), groups.length ? h`<div class="table-wrap"><table class="plain"><thead><tr><th>${{ day: t('Day'), week: t('Week'), month: t('Month') }[V.level]}</th><th class="r">${t('Income')}</th><th class="r">${t('Expenses')}</th><th class="r">${t('Net')}</th></tr></thead><tbody>
            ${groups.map(g => h`<tr><td>${g.label}</td><td class="r num pos">${money(g.income)}</td><td class="r num">${money(g.expense)}</td><td class="r num ${g.net < 0 ? 'neg' : 'pos'}">${money(g.net, { sign: true })}</td></tr>`)}</tbody></table></div>
            <p class="muted small">${t('The latest periods. The download has all of them.')}</p>`
          : UI.empty({ icon: 'layers', title: t('Nothing in this period') }), { cls: 's12' })}
      </div>`;
  };

  App.onChange('dx:range', el => { V.range = el.value; App.render(); });
  App.onChange('dx:from', el => { V.from = el.value; App.render(); });
  App.onChange('dx:to', el => { V.to = el.value; App.render(); });
  App.on('dx:level', el => { V.level = el.dataset.v; App.render(); });
  App.on('dx:csv', () => {
    const xs = list();
    U.download(`ledgerly-transactions-${suffix()}.csv`, '﻿' + A.exportCsv(xs), 'text/csv');
    UI.toast(t('Exported {n}.', { n: U.plural(xs.length, 'transaction') }));
  });
  App.on('dx:summary', () => {
    const xs = list();
    U.download(`ledgerly-${V.level}-totals-${suffix()}.csv`, '﻿' + A.exportSummaryCsv(xs, V.level), 'text/csv');
    UI.toast(t('Totals downloaded.'));
  });

  App.views.data = V;
  return V;
})();
