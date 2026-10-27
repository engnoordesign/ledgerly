'use strict';
const SettingsView = (() => {
  const V = {};
  const { h, money } = U;
  const set = () => S.state.settings;
  const localeLabel = ([code, ex]) => code === 'ar-EG' ? `${t('Arabic digits')} (١٢٣٬٤٥٦٫٧٨)` : ex;
  const update = patch => S.commit(st => Object.assign(st.settings, patch), { settings: true });
  const currencyOptions = sel => UI.options(U.CURRENCIES.map(([c, n]) => [c, `${c} – ${t(n)}`]), sel);

  const catRow = c => h`<li class="catrow">${UI.catIcon(c, 30)}<span class="c-n">${Q.catName(c)}</span>${c.type === 'expense' ? h`<span class="pill">${t(K.BUCKETS[c.bucket || 'wants'])}</span>` : ''}
    <button class="btn icon ghost sm" data-act="cat:edit" data-id="${c.id}" data-tip="${t('Edit')}">${UI.icon('edit', 15)}</button></li>`;

  V.render = () => {
    const s = set(), meta = S.state.meta;
    const backupAge = meta.lastBackup ? U.diffDays(meta.lastBackup, U.today()) : null;
    return h`
      ${UI.pageHead({ title: t('Settings'), sub: t('Make Ledgerly fit the way you work.') })}
      <div class="grid">
        ${UI.card(t('Preferences'), h`
          <div class="form-grid">
            <div class="field"><label>${t('Language')}</label>${UI.seg('set:lang', [['en', 'English'], ['ar', 'العربية']], s.lang)}</div>
            <div class="field"><label>${t('Appearance')}</label>${UI.seg('set:theme', [['light', t('Light')], ['dark', t('Dark')], ['system', t('Auto')]], s.theme)}</div>
            <div class="field"><label for="set-name">${t('Your name')}</label><input id="set-name" name="name" data-change="set:field" value="${s.name}" autocomplete="off" placeholder="${t('Optional')}"></div>
            <div class="field"><label for="set-cur">${t('Currency')}</label><select id="set-cur" name="currency" data-change="set:currency">${currencyOptions(s.currency)}</select>
              <small class="muted">${t('Changes how amounts are shown. Existing amounts are not converted.')}</small></div>
            <div class="field"><label for="set-loc">${t('Number format')}</label><select id="set-loc" name="locale" data-change="set:field">${UI.options(U.LOCALES.map(l => [l[0], localeLabel(l)]), s.locale)}</select>
              <small class="muted">${t('Preview')}: <b class="num">${money(123456789)}</b></small></div>
            <div class="field"><label for="set-week">${t('Week starts on')}</label><select id="set-week" name="weekStart" data-change="set:field">${UI.options([[6, t('Saturday')], [0, t('Sunday')], [1, t('Monday')]], s.weekStart)}</select></div>
            <div class="field"><label for="set-sav">${t('Savings target')}</label><div class="suffix"><input id="set-sav" name="savingsTarget" type="number" min="1" max="90" data-change="set:field" value="${s.savingsTarget}"><span>%</span></div>
              <small class="muted">${t('Share of income you want to keep. Drives insights and the Smart plan.')}</small></div>
            <div class="field"><label for="set-em">${t('Emergency cushion')}</label><div class="suffix"><input id="set-em" name="emergencyMonths" type="number" min="1" max="24" data-change="set:field" value="${s.emergencyMonths}"><span>${t('months')}</span></div>
              <small class="muted">${t('How many months of spending your savings should cover.')}</small></div>
          </div>`, { cls: 's12' })}

        ${UI.card(t('Categories'), h`<div class="cat-cols">
            <div><div class="cat-h"><b>${t('Spending')}</b><button class="btn sm" data-act="cat:new" data-type="expense">${UI.icon('plus', 14)}${t('Add')}</button></div><ul class="catlist">${Q.cats('expense').map(catRow)}</ul></div>
            <div><div class="cat-h"><b>${t('Income')}</b><button class="btn sm" data-act="cat:new" data-type="income">${UI.icon('plus', 14)}${t('Add')}</button></div><ul class="catlist">${Q.cats('income').map(catRow)}</ul></div></div>`,
          { cls: 's7', sub: t('Needs and Wants drive the ready-made plans.') })}

        ${UI.card(t('Your data'), h`
          <p class="muted">${S.storageOK ? t('Everything is stored privately in this browser. Nothing is sent anywhere.') : t('This browser is blocking storage, so changes will be lost when you close the page. Export a backup often.')}</p>
          <p class="backup ${backupAge == null || backupAge > 30 ? 'warn' : ''}">${UI.icon(backupAge == null || backupAge > 30 ? 'alert' : 'check', 15)}${meta.lastBackup ? t('Last backup: {date}', { date: U.fmtDate(meta.lastBackup, 'med') }) : t('You have not made a backup yet.')}</p>
          <div class="stack-btns">
            <button class="btn primary" data-act="data:export">${UI.icon('download', 16)}${t('Download backup')}</button>
            <button class="btn" data-act="data:import">${UI.icon('upload', 16)}${t('Restore from backup')}</button>
            <button class="btn" data-act="data:csv">${UI.icon('download', 16)}${t('Export all as CSV')}</button>
            <input type="file" id="data-file" accept=".json,application/json" hidden data-change="data:file">
          </div>
          <hr>
          <div class="stack-btns">
            <button class="btn" data-act="data:demo">${UI.icon('sparkles', 16)}${t('Load sample data')}</button>
            <button class="btn danger ghost" data-act="data:reset">${UI.icon('trash', 16)}${t('Erase everything')}</button>
          </div>`, { cls: 's5' })}

        ${UI.card(t('Shortcuts'), h`<ul class="kbd-list">
          <li><kbd>N</kbd><span>${t('New transaction')}</span></li><li><kbd>/</kbd><span>${t('Search transactions')}</span></li>
          <li><kbd>Esc</kbd><span>${t('Close a dialog')}</span></li><li><kbd>Enter</kbd><span>${t('Save a form')}</span></li></ul>`, { cls: 's12' })}
      </div>`;
  };

  /* ---------- preferences ---------- */
  App.on('set:lang', el => update({ lang: el.dataset.v }));
  App.on('set:theme', el => update({ theme: el.dataset.v }));
  App.onChange('set:currency', el => update({ currency: el.value }));
  App.onChange('set:field', el => {
    let v = el.value;
    if (el.name === 'weekStart') v = +v;
    if (el.name === 'savingsTarget') v = U.clamp(Math.round(+v) || 20, 1, 90);
    if (el.name === 'emergencyMonths') v = U.clamp(Math.round(+v) || 6, 1, 24);
    update({ [el.name]: v });
  });

  /* ---------- categories ---------- */
  const catForm = (c, type) => {
    const ed = !!c, x = c || { type, color: K.PALETTE[S.state.categories.length % K.PALETTE.length], icon: 'tag', bucket: 'wants', name: '' };
    V.ctl = UI.modal({
      title: ed ? t('Edit category') : x.type === 'income' ? t('New income category') : t('New spending category'), size: 'md',
      body: h`<form id="catf" novalidate data-submit="cat:save" ${ed ? h`data-id="${c.id}"` : ''}><input type="hidden" name="type" value="${x.type}">
        <div class="field"><label for="cat-name">${t('Name')}</label><input id="cat-name" name="name" value="${ed ? Q.catName(x) : ''}" required autocomplete="off"></div>
        ${x.type === 'expense' ? h`<div class="field"><label>${t('Counts as')}</label><div class="type-tabs two" role="radiogroup">${Object.entries(K.BUCKETS).map(([k, l]) => h`<label class="tt"><input type="radio" name="bucket" value="${k}" ${(x.bucket || 'wants') === k ? 'checked' : ''}><span>${t(l)}</span></label>`)}</div></div>` : ''}
        <div class="field"><label>${t('Icon')}</label><div class="icon-pick" role="radiogroup">${K.CAT_ICONS.map(i => h`<label><input type="radio" name="icon" value="${i}" ${i === x.icon ? 'checked' : ''}><span>${UI.icon(i, 18)}</span></label>`)}</div></div>
        <div class="field"><label>${t('Colour')}</label>${UI.swatches('color', x.color)}</div>
        <div class="form-error" role="alert" hidden></div></form>`,
      footer: h`${ed ? h`<button type="button" class="btn danger ghost push" data-act="cat:delete" data-id="${c.id}">${UI.icon('trash', 16)}${t('Delete')}</button>` : ''}<button type="button" class="btn" data-close>${t('Cancel')}</button><button type="submit" form="catf" class="btn primary">${t('Save')}</button>`,
    });
  };
  App.on('cat:new', el => catForm(null, el.dataset.type));
  App.on('cat:edit', el => catForm(Q.cat(el.dataset.id)));
  App.onSubmit('cat:save', f => {
    const d = UI.read(f), old = f.dataset.id ? Q.cat(f.dataset.id) : null;
    const nameChanged = old && d.name.trim() !== Q.catName(old);
    const res = A.saveCategory({ id: f.dataset.id, name: d.name, type: d.type, color: d.color, icon: d.icon, bucket: d.bucket });
    if (res.error) return UI.formError(f, res.error);
    if (old && old.sys && nameChanged) S.commit(st => { st.categories.find(c => c.id === old.id).sys = false; }, { silent: true });
    V.ctl.close(); S.emit(); UI.toast(t('Category saved'));
  });
  App.on('cat:delete', async el => {
    const c = Q.cat(el.dataset.id), n = S.state.transactions.filter(x => x.categoryId === c.id).length;
    if (await UI.confirm({ title: t('Delete this category?'), message: n ? t('{n} will become Uncategorized. This cannot be undone.', { n: U.plural(n, 'transaction') }) : t('This category has no transactions.'), confirm: t('Delete'), danger: true })) {
      V.ctl.close(); A.deleteCategory(c.id); UI.toast(t('Category deleted'));
    }
  });

  /* ---------- data ---------- */
  const undoAction = () => ({ label: t('Undo'), fn: () => { if (S.restoreSnapshot()) UI.toast(t('Restored the previous data.')); } });
  App.on('data:export', () => { U.download(`ledgerly-backup-${U.today()}.json`, S.export(), 'application/json'); A.markBackup(); S.emit(); UI.toast(t('Backup downloaded. Keep it somewhere safe.')); });
  App.on('data:csv', () => { U.download(`ledgerly-all-${U.today()}.csv`, '﻿' + A.exportCsv(), 'text/csv'); UI.toast(t('Exported {n}.', { n: U.plural(S.state.transactions.length, 'transaction') })); });
  App.on('data:import', () => U.$('#data-file').click());
  App.onChange('data:file', async el => {
    const f = el.files[0]; if (!f) return;
    const text = await f.text(); el.value = '';
    if (!await UI.confirm({ title: t('Replace your data with this backup?'), message: t('Everything currently in Ledgerly will be replaced. You can undo this right after.'), confirm: t('Restore') })) return;
    const res = A.importJSON(text);
    if (res.error) return UI.toast(res.error, { kind: 'warn' });
    UI.toast(t('Restored {a} and {b}.', { a: U.plural(res.accounts, 'account'), b: U.plural(res.transactions, 'transaction') }), { action: undoAction() });
  });
  App.on('data:demo', async () => {
    if (S.state.transactions.length && !await UI.confirm({ title: t('Replace your data with sample data?'), message: t('Your current entries will be replaced by a year of example transactions. You can undo this right after.'), confirm: t('Load sample data') })) return;
    S.replace(Seed.demo(S.state.settings));
    S.state.meta.onboarded = true; S.persist();
    UI.toast(t('Sample data loaded. Erase it any time in Settings.'), { action: S.state.transactions.length ? undoAction() : undefined });
    location.hash = '#/dashboard';
  });
  App.on('data:reset', () => {
    const word = t('ERASE');
    const ctl = UI.modal({
      title: t('Erase everything?'), size: 'sm',
      body: h`<p class="muted">${t('This deletes all accounts, transactions, budgets and goals from this browser. Download a backup first if you might want them back.')}</p>
        <div class="field"><label for="erase-in">${t('Type {word} to confirm', { word })}</label><input id="erase-in" autocomplete="off" data-input="data:erasecheck"></div>`,
      footer: h`<button type="button" class="btn" data-close>${t('Cancel')}</button><button type="button" class="btn danger" id="erase-go" data-act="data:erase" disabled>${t('Erase everything')}</button>`,
    });
    V.erase = { ctl, word };
  });
  App.onInput('data:erasecheck', el => { U.$('#erase-go').disabled = el.value.trim().toUpperCase() !== V.erase.word.toUpperCase(); });
  App.on('data:erase', () => {
    V.erase.ctl.close();
    const keep = { lang: set().lang, theme: set().theme, currency: set().currency, locale: set().locale };
    const b = S.blank(); Object.assign(b.settings, keep);
    S.replace(b);
    UI.toast(t('All data erased.'), { action: undoAction() });
    V.onboard();
  });

  /* ---------- first run ---------- */
  const ob = { name: '', accountName: '', accountType: 'checking', opening: '' };
  V.onboard = () => {
    const s = set();
    const ctl = UI.modal({
      title: t('Welcome to Ledgerly'), size: 'lg', sticky: true,
      body: h`<form id="obf" novalidate data-submit="ob:start">
        <p class="muted lead">${t('Track income and spending, plan with proven budgets, and watch your savings grow. Your data stays on this device.')}</p>
        <div class="row2">
          <div class="field"><label>${t('Language')}</label>${UI.seg('ob:lang', [['en', 'English'], ['ar', 'العربية']], s.lang)}</div>
          <div class="field"><label>${t('Appearance')}</label>${UI.seg('ob:theme', [['light', t('Light')], ['dark', t('Dark')], ['system', t('Auto')]], s.theme)}</div>
        </div>
        <div class="row2">
          <div class="field"><label for="ob-name">${t('Your name')}</label><input id="ob-name" name="name" value="${ob.name}" autocomplete="off" data-input="ob:keep" placeholder="${t('Optional')}"></div>
          <div class="field"><label for="ob-cur">${t('Currency')}</label><select id="ob-cur" name="currency" data-change="ob:currency">${currencyOptions(s.currency)}</select></div>
        </div>
        <h3 class="sec-s">${t('Your first account')}</h3>
        <div class="row3">
          <div class="field"><label for="ob-acc">${t('Name')}</label><input id="ob-acc" name="accountName" value="${ob.accountName}" autocomplete="off" data-input="ob:keep" placeholder="${t('Main account')}"></div>
          <div class="field"><label for="ob-type">${t('Type')}</label><select id="ob-type" name="accountType" data-change="ob:keep">${UI.options(Object.entries(K.ACCOUNT_TYPES).map(([k, v]) => [k, t(v.label)]), ob.accountType)}</select></div>
          <div class="field"><label for="ob-open">${t('Current balance')}</label>${UI.amountInput('ob-open', U.parseAmount(ob.opening) || 0, { name: 'opening', required: false, change: 'ob:keep' })}</div>
        </div>
        <div class="form-error" role="alert" hidden></div></form>`,
      footer: h`<button type="button" class="btn" data-act="ob:demo">${UI.icon('sparkles', 16)}${t('Explore with sample data')}</button><button type="submit" form="obf" class="btn primary">${t('Start fresh')}</button>`,
    });
    V.ob = ctl;
  };
  const keepOb = el => { const f = el.form; ob.name = f.elements.name.value; ob.accountName = f.elements.accountName.value; ob.accountType = f.elements.accountType.value; ob.opening = f.elements.opening.value; };
  App.onInput('ob:keep', keepOb); App.onChange('ob:keep', keepOb);
  App.onChange('ob:currency', el => { keepOb(el); update({ currency: el.value }); V.ob.close(); V.onboard(); });
  App.on('ob:lang', el => { keepOb(U.$('#ob-name')); update({ lang: el.dataset.v, weekStart: el.dataset.v === 'ar' ? 6 : 1 }); V.ob.close(); V.onboard(); });
  App.onSubmit('ob:start', f => {
    const d = UI.read(f), s = { ...set(), name: d.name.trim() };
    S.replace(Seed.fresh(s, { name: d.accountName.trim() || t('Main account'), type: d.accountType, opening: Number.isFinite(d.opening) ? d.opening : 0 }));
    V.ob.close(); location.hash = '#/dashboard';
    UI.toast(t('All set. Add your first transaction with the + button.'));
  });
  App.on('ob:demo', () => {
    S.replace(Seed.demo({ ...set(), name: (U.$('#ob-name') || {}).value || '' }));
    V.ob.close(); location.hash = '#/dashboard';
    UI.toast(t('Sample data loaded. Erase it any time in Settings.'));
  });

  App.views.settings = V;
  return V;
})();
