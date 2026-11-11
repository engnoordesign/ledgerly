'use strict';
/* Printable statement: pick a day, week, month, year or any date range, preview the sheet, then print it or save it as a PDF.
   The sheet is plain HTML styled for paper. Printing uses the browser's own print engine (window.print), which shapes Arabic
   and right-to-left layouts correctly and lets the person choose "Save as PDF" as the printer. */
const StatementView = (() => {
  const V = { kind: 'month', anchor: U.today(), from: '', to: '', paper: 'A4' };
  const { h, money } = U;
  const PAPER = { A4: 794, Letter: 816 };            // sheet width in CSS px at 96 dpi
  try { const p = localStorage.getItem('ledgerly:paper'); if (PAPER[p]) V.paper = p; } catch (e) { /* storage blocked */ }

  const kinds = () => [['day', t('Daily')], ['week', t('Weekly')], ['month', t('Monthly')], ['year', t('Yearly')], ['custom', t('Custom')]];
  const range = () => V.kind === 'custom' ? [V.from, V.to] : Q.periodRange(V.kind, V.anchor);
  const valid = () => { const [f, to] = range(); return U.isDate(f) && U.isDate(to) && f <= to; };
  const label = () => V.kind === 'custom' ? U.fmtRange(V.from, V.to) : Q.periodLabel(V.kind, V.anchor);
  const heading = () => ({ day: t('Daily statement'), week: t('Weekly statement'), month: t('Monthly statement'), year: t('Yearly statement'), custom: t('Statement') })[V.kind];
  const fileName = (from, to) => `Ledgerly-statement_${from}${to === from ? '' : '_' + to}`;

  const amt = v => h`<span class="num">${money(v)}</span>`;
  const primary = x => x.purpose || UI.txTitle(x);
  const secondary = x => [x.purpose ? (x.payee || '') : '', x.note && x.note !== primary(x) ? x.note : '', Q.importanceLabel(x.type, x.importance)].filter(Boolean).join(' · ');
  /* ---------- the sheet ---------- */
  const sheet = () => {
    const [from, to] = range(), d = Q.statement(from, to), today = U.today();
    const who = (Auth.profile && Auth.profile.name) || S.state.settings.name || '';
    const ref = `LG-${from.replace(/-/g, '')}-${to.replace(/-/g, '')}`;
    const items = d.items;
    const sameYear = from.slice(0, 4) === to.slice(0, 4);
    const entries = d.incomeCount + d.expenseCount;

    return h`<article class="rpt-sheet" lang="${I18N.lang}">
      <header class="rpt-head">
        <div class="rpt-brand">${UI.logo(38)}<div><b>Ledgerly</b><small>${t('Income and expense statement')}</small></div></div>
        <div class="rpt-title"><h1>${heading()}</h1><p>${label()}</p></div>
      </header>
      <dl class="rpt-meta">
        <div><dt>${t('Prepared for')}</dt><dd>${who || '—'}</dd></div>
        <div><dt>${t('Period')}</dt><dd>${U.fmtRange(from, to)}</dd></div>
        <div><dt>${t('Statement no.')}</dt><dd><span class="num">${ref}</span></dd></div>
        <div><dt>${t('Issued')}</dt><dd>${U.fmtDate(today, 'med')}</dd></div>
        <div><dt>${t('Currency')}</dt><dd>${U.currency().code}</dd></div>
      </dl>

      <section class="rpt-sec"><h2>${t('Transactions')}</h2>${items.length
        ? h`<table class="rpt-t rpt-tx"><colgroup><col class="c-d"><col class="c-t"><col class="c-c"><col class="c-m"><col class="c-m"></colgroup><thead><tr><th>${t('Date')}</th><th>${t('Details')}</th><th>${t('Category')}</th><th class="r">${t('Income')}</th><th class="r">${t('Expenses')}</th></tr></thead><tbody>
          ${items.map(x => { const sub = secondary(x); return h`<tr>
            <td class="rpt-d"><span class="num">${U.fmtDate(x.date, sameYear ? 'short' : 'med')}</span></td>
            <td><b>${primary(x)}</b>${sub ? h`<small class="rpt-sub">${sub}</small>` : ''}</td>
            <td>${Q.catName(Q.cat(x.categoryId))}</td>
            <td class="r">${x.type === 'income' ? amt(x.amount) : ''}</td><td class="r">${x.type === 'expense' ? amt(x.amount) : ''}</td></tr>`; })}
          <tr class="tot"><td colspan="3">${t('Total')}</td><td class="r">${amt(d.income)}</td><td class="r">${amt(d.expense)}</td></tr>
        </tbody></table>`
        : h`<p class="rpt-none">${entries ? t('Nothing to list.') : t('No income or expenses were recorded in this period.')}</p>`}</section>

      <footer class="rpt-foot">
        <span>${t('Issued by Ledgerly on {date}. All amounts are in {currency}.', { date: U.fmtDate(today, 'med'), currency: U.currency().code })}</span>
        ${to > today ? h`<span>${t('This period has not ended yet, so the statement shows what has been recorded so far.')}</span>` : ''}
      </footer>
    </article>`;
  };

  /* ---------- the dialog ---------- */
  const nav = () => h`<div class="monthnav"><button type="button" class="btn icon ghost" data-act="stmt:nav" data-v="-1" aria-label="${t('Previous')}">${UI.icon('chevron-left', 18, 'flip')}</button>
    <button type="button" class="mlabel" data-act="stmt:nav" data-v="0" data-tip="${t('Jump to today')}">${label()}</button>
    <button type="button" class="btn icon ghost" data-act="stmt:nav" data-v="1" aria-label="${t('Next')}">${UI.icon('chevron-right', 18, 'flip')}</button></div>`;
  const optsHtml = () => h`
    <div class="field"><label>${t('Statement for')}</label>
      <div class="stmt-kinds" role="radiogroup">${kinds().map(([v, l]) => h`<button type="button" role="radio" aria-checked="${V.kind === v}" class="${V.kind === v ? 'on' : ''}" data-act="stmt:kind" data-v="${v}">${l}</button>`)}</div></div>
    ${V.kind === 'custom'
      ? h`<div class="field"><label>${t('From')} / ${t('To')}</label><div class="range-in"><input type="date" id="stmt-from" data-change="stmt:from" value="${V.from}" aria-label="${t('From')}"><span>→</span><input type="date" id="stmt-to" data-change="stmt:to" value="${V.to}" aria-label="${t('To')}"></div></div>`
      : h`<div class="field"><label>${t('Period')}</label>${nav()}</div>`}
    <div class="field"><label for="stmt-paper">${t('Paper size')}</label><select id="stmt-paper" data-change="stmt:paper">${UI.options([['A4', 'A4'], ['Letter', 'Letter']], V.paper)}</select></div>
    <p class="muted small">${t('In the print window, choose “Save as PDF” as the destination to get a PDF file.')}</p>`;

  const shell = () => h`<div class="stmt-wrap"><div class="stmt-opts" id="stmt-opts">${optsHtml()}</div>
    <div class="stmt-stage" id="stmt-stage" aria-label="${t('Preview')}"><div id="stmt-sheet"></div></div></div>`;

  /** Scale the sheet to the width of the preview panel. */
  const fit = () => {
    const stage = U.$('#stmt-stage'), host = U.$('#stmt-sheet'), sh = host && host.firstElementChild;
    if (!stage || !sh) return;
    sh.style.setProperty('--pw', PAPER[V.paper] + 'px');
    sh.style.zoom = String(Math.min(1, Math.max(0.3, (stage.clientWidth - 20) / PAPER[V.paper])));
  };
  const paintSheet = () => {
    const host = U.$('#stmt-sheet'), btn = U.$('#stmt-print');
    if (!host) return;
    if (btn) btn.disabled = !valid();
    host.innerHTML = valid() ? sheet().toString()
      : UI.empty({ icon: 'calendar', title: t('Choose a valid date range'), text: t('The end date must be on or after the start date.') }).toString();
    fit();
  };
  const paintOpts = () => { const el = U.$('#stmt-opts'); if (el) el.innerHTML = optsHtml().toString(); };
  const repaint = () => { paintOpts(); paintSheet(); };

  /** Open the dialog. `sel` may carry the period being looked at: { kind, anchor, from, to }. */
  V.open = (sel = {}) => {
    const today = U.today();
    V.kind = ['day', 'week', 'month', 'year', 'custom'].includes(sel.kind) ? sel.kind : 'month';
    V.anchor = U.isDate(sel.anchor) ? sel.anchor : today;
    V.to = U.isDate(sel.to) ? sel.to : today;
    V.from = U.isDate(sel.from) ? sel.from : U.addDays(V.to, -29);
    if (V.kind === 'custom' && V.from > V.to) V.from = V.to;
    const ctl = UI.modal({
      title: t('Print a statement'), size: 'xl', body: shell().toString(),
      footer: h`<span class="stmt-hint muted small">${t('Preview. Page breaks are set when you print.')}</span><button type="button" class="btn" data-close>${t('Close')}</button>
        <button type="button" class="btn primary" id="stmt-print" data-act="stmt:print">${UI.icon('printer', 16)}<span>${t('Print or save as PDF')}</span></button>`.toString(),
    });
    V.ctl = ctl;
    paintSheet();
    const onSize = U.debounce(fit, 60);
    window.addEventListener('resize', onSize);
    ctl.done.then(() => { window.removeEventListener('resize', onSize); V.ctl = null; });
    return ctl;
  };

  /* ---------- printing ---------- */
  /** Put the sheet in #print-root, let the browser print it (the print stylesheet hides everything else), then clean up. */
  V.prepare = () => {
    const [from, to] = range();
    const root = document.createElement('div'); root.id = 'print-root'; root.innerHTML = sheet().toString();
    const page = document.createElement('style');
    page.textContent = `@page { size: ${V.paper} portrait; margin: 14mm 14mm 16mm; @bottom-center { content: counter(page) " / " counter(pages); font: 9pt sans-serif; color: #5f6673; } }`;
    const title = document.title;
    document.head.appendChild(page); document.body.appendChild(root);
    document.title = fileName(from, to);          // browsers suggest this as the PDF file name
    document.body.classList.add('printing');
    let done = false;
    return function clean() {
      if (done) return; done = true;
      window.removeEventListener('afterprint', clean);
      document.body.classList.remove('printing'); root.remove(); page.remove(); document.title = title;
    };
  };
  V.print = () => {
    if (!valid()) return;
    const clean = V.prepare();
    window.addEventListener('afterprint', clean);
    setTimeout(clean, 5 * 60 * 1000);             // some browsers never report afterprint
    setTimeout(() => { try { window.print(); } catch (e) { clean(); } }, 60);
  };

  App.on('stmt:kind', el => {
    const was = V.kind; V.kind = el.dataset.v;
    if (was === 'custom' && V.kind !== 'custom' && U.isDate(V.from)) V.anchor = V.from;
    if (V.kind === 'custom' && was !== 'custom') { const [f, to] = Q.periodRange(was === 'custom' ? 'month' : was, V.anchor); V.from = f; V.to = to; }
    repaint();
  });
  App.on('stmt:nav', el => { const v = +el.dataset.v; V.anchor = v === 0 ? U.today() : Q.shiftAnchor(V.kind, V.anchor, v); repaint(); });
  App.onChange('stmt:from', el => { V.from = el.value; paintSheet(); });
  App.onChange('stmt:to', el => { V.to = el.value; paintSheet(); });
  App.onChange('stmt:paper', el => { V.paper = el.value; try { localStorage.setItem('ledgerly:paper', V.paper); } catch (e) { /* storage blocked */ } paintSheet(); });
  App.on('stmt:print', () => V.print());
  /** Entry point for buttons elsewhere: data-kind / data-anchor / data-from / data-to carry the period on show. */
  App.on('stmt:open', el => V.open({ kind: el.dataset.kind, anchor: el.dataset.anchor, from: el.dataset.from, to: el.dataset.to }));

  V.sheet = sheet;
  return V;
})();
