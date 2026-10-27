'use strict';
/* Shared UI kit: event registry, icons, modal, toast, tooltip and small reusable components. */

/** Action registry. Markup uses data-act / data-change / data-input / data-submit; views register handlers by name. */
const App = {
  handlers: { click: {}, change: {}, input: {}, submit: {} },
  on(name, fn) { this.handlers.click[name] = fn; },
  onChange(name, fn) { this.handlers.change[name] = fn; },
  onInput(name, fn) { this.handlers.input[name] = fn; },
  onSubmit(name, fn) { this.handlers.submit[name] = fn; },
  views: {},
  month: U.curMonth(),
};

const UI = (() => {
  const UI = {};
  const { h, esc, money } = U;

  UI.icon = (name, size = 18, cls = '') => U.raw(`<svg class="i ${cls}" width="${size}" height="${size}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`);
  UI.num = (c, o = {}) => h`<span class="num${o.cls ? ' ' + o.cls : ''}">${money(c, o)}</span>`;

  /* ---------- modal ---------- */
  const stack = [];
  UI.modal = ({ title, body, footer, size = 'md', sticky = false, onMount }) => {
    const root = U.$('#modal-root'), id = U.uid('m');
    const el = document.createElement('div');
    el.className = 'modal-back';
    el.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true" aria-labelledby="${id}"><header class="m-head"><h2 id="${id}">${esc(title)}</h2>`
      + (sticky ? '' : `<button type="button" class="btn icon ghost" data-close aria-label="${esc(t('Close'))}">${UI.icon('x')}</button>`) + `</header>`
      + `<div class="m-body">${body}</div>${footer ? `<footer class="m-foot">${footer}</footer>` : ''}</div>`;
    root.appendChild(el);
    document.body.classList.add('modal-open');
    const prev = document.activeElement;
    let resolve; const done = new Promise(r => { resolve = r; });
    const ctl = {
      el, dlg: el.firstElementChild, body: U.$('.m-body', el), done, sticky,
      close(v) {
        const i = stack.indexOf(ctl); if (i < 0) return;
        stack.splice(i, 1); el.classList.remove('in');
        setTimeout(() => el.remove(), 160);
        if (!stack.length) document.body.classList.remove('modal-open');
        if (prev && prev.focus && document.contains(prev)) prev.focus({ preventScroll: true });
        resolve(v);
      },
    };
    el.addEventListener('mousedown', e => { if (e.target === el && !sticky) ctl.close(); });
    el.addEventListener('click', e => { if (e.target.closest('[data-close]')) ctl.close(); });
    stack.push(ctl);
    requestAnimationFrame(() => {
      el.classList.add('in');
      const f = U.$('[autofocus]', el) || U.$('input:not([type=hidden]):not([type=checkbox]), select, textarea', ctl.body);
      (f || ctl.dlg).focus({ preventScroll: true });
    });
    if (onMount) onMount(ctl);
    return ctl;
  };
  UI.topModal = () => stack[stack.length - 1];
  UI.closeAll = () => [...stack].forEach(m => m.close());

  UI.confirm = ({ title, message, confirm, danger = false }) => new Promise(res => {
    const ctl = UI.modal({
      title, size: 'sm', body: h`<p class="muted">${message}</p>`,
      footer: h`<button type="button" class="btn" data-close>${t('Cancel')}</button><button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-ok>${confirm || t('Confirm')}</button>`,
    });
    ctl.el.addEventListener('click', e => { if (e.target.closest('[data-ok]')) ctl.close(true); });
    ctl.done.then(v => res(!!v));
  });

  /* ---------- toast ---------- */
  UI.toast = (msg, { action, kind = 'ok', ms = 6000 } = {}) => {
    const root = U.$('#toast-root'), el = document.createElement('div');
    el.className = 'toast ' + kind; el.setAttribute('role', 'status');
    el.innerHTML = `<span>${esc(msg)}</span>` + (action ? `<button type="button" class="btn sm ghost">${esc(action.label)}</button>` : '');
    root.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    const kill = () => { el.classList.remove('in'); setTimeout(() => el.remove(), 200); };
    const timer = setTimeout(kill, ms);
    if (action) U.$('button', el).addEventListener('click', () => { clearTimeout(timer); kill(); action.fn(); });
    while (root.children.length > 3) root.firstElementChild.remove();
  };

  /* ---------- tooltip ---------- */
  UI.initTooltip = () => {
    const tipEl = U.$('#tip');
    let cur = null;
    const show = (el, x, y) => {
      const lines = el.dataset.tip.split('\n');
      tipEl.innerHTML = `<b>${esc(lines[0])}</b>${lines.slice(1).map(l => `<span>${esc(l)}</span>`).join('')}`;
      tipEl.classList.add('on');
      const r = tipEl.getBoundingClientRect(), pad = 8;
      let left = x - r.width / 2, top = y - r.height - 14;
      if (top < pad) top = y + 18;
      left = Math.max(pad, Math.min(innerWidth - r.width - pad, left));
      tipEl.style.transform = `translate(${left}px,${top}px)`;
    };
    const hide = () => { cur = null; tipEl.classList.remove('on'); };
    document.addEventListener('pointerover', e => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el && el !== cur) { cur = el; show(el, e.clientX, e.clientY); } else if (!el) hide(); });
    document.addEventListener('pointermove', e => { if (cur && e.pointerType !== 'touch') show(cur, e.clientX, e.clientY); });
    document.addEventListener('pointerdown', e => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el && e.pointerType === 'touch') { cur = el; show(el, e.clientX, e.clientY); } else hide(); });
    document.addEventListener('scroll', hide, true);
  };

  /* ---------- components ---------- */
  UI.catIcon = (c, size = 34) => { const k = c || { color: '#64748b', icon: 'tag' }; return h`<span class="cico" style="--c:${k.color};--s:${size}px">${UI.icon(k.icon || 'tag', Math.round(size * 0.52))}</span>`; };
  UI.catChip = c => h`<span class="cchip" style="--c:${c.color}"><i></i>${Q.catName(c)}</span>`;
  UI.accIcon = (a, size = 38) => h`<span class="cico sq" style="--c:${a.color};--s:${size}px">${UI.icon(Q.accType(a).icon, Math.round(size * 0.52))}</span>`;
  UI.goalIcon = (g, size = 38) => h`<span class="cico" style="--c:${g.color};--s:${size}px">${UI.icon('target', Math.round(size * 0.52))}</span>`;

  UI.delta = (cur, prev, { upGood = true, label } = {}) => {
    if (!prev && !cur) return h``;
    if (!prev) return h`<span class="delta neutral">${t('New')}</span>`;
    const r = (cur - prev) / Math.abs(prev);
    if (Math.abs(r) < 0.005) return h`<span class="delta neutral" data-tip="${label || t('vs previous period')}">0%</span>`;
    const good = (r > 0) === upGood;
    return h`<span class="delta ${good ? 'good' : 'bad'}" data-tip="${label || t('vs previous period')}">${UI.icon(r > 0 ? 'arrow-up' : 'arrow-down', 12)}${Math.min(999, Math.abs(r * 100)).toFixed(0)}%</span>`;
  };
  UI.kpi = ({ label, value, sub, delta, spark, tone = '', hero = false }) =>
    h`<div class="kpi ${tone}${hero ? ' hero' : ''}"><div class="k-top"><span class="k-label">${label}</span>${delta || ''}</div><div class="k-val num">${value}</div>${sub ? h`<div class="k-sub">${sub}</div>` : ''}${spark || ''}</div>`;

  UI.seg = (act, options, value, cls = '') =>
    h`<div class="segc ${cls}" role="tablist">${options.map(([v, l]) => h`<button type="button" role="tab" class="${String(v) === String(value) ? 'on' : ''}" aria-selected="${String(v) === String(value)}" data-act="${act}" data-v="${v}">${l}</button>`)}</div>`;

  UI.empty = ({ icon = 'sparkles', title, text, action }) =>
    h`<div class="empty">${UI.icon(icon, 28)}<b>${title}</b>${text ? h`<p>${text}</p>` : ''}${action || ''}</div>`;
  UI.pageHead = ({ title, sub, actions }) =>
    h`<div class="page-head"><div><h1>${title}</h1>${sub ? h`<p class="sub">${sub}</p>` : ''}</div>${actions ? h`<div class="head-actions">${actions}</div>` : ''}</div>`;
  UI.card = (title, body, { actions, cls = '', sub } = {}) =>
    h`<section class="card ${cls}">${title || actions ? h`<header class="card-h"><div><h3>${title}</h3>${sub ? h`<p class="sub">${sub}</p>` : ''}</div>${actions ? h`<div class="card-a">${actions}</div>` : ''}</header>` : ''}${body}</section>`;

  /** Previous / next month control. act is the registered action name (data-v = -1 | 1 | 0). */
  UI.monthNav = (key, act) => h`<div class="monthnav"><button type="button" class="btn icon ghost" data-act="${act}" data-v="-1" aria-label="${t('Previous month')}">${UI.icon('chevron-left', 18, 'flip')}</button>
    <button type="button" class="mlabel" data-act="${act}" data-v="0" data-tip="${t('Jump to this month')}">${U.fmtMonth(key)}</button>
    <button type="button" class="btn icon ghost" data-act="${act}" data-v="1" aria-label="${t('Next month')}">${UI.icon('chevron-right', 18, 'flip')}</button></div>`;

  UI.txTitle = x => x.payee || x.note || (x.type === 'transfer' ? t('Transfer') : x.type === 'income' ? t('Income') : Q.catName(Q.cat(x.categoryId)));
  UI.txIcon = x => x.type === 'transfer'
    ? h`<span class="cico sq" style="--c:#64748b;--s:36px">${UI.icon('swap', 19)}</span>` : UI.catIcon(Q.cat(x.categoryId) || { color: '#64748b', icon: x.type === 'income' ? 'banknote' : 'tag' }, 36);
  UI.txAmount = x => h`<b class="num amt ${x.type}">${x.type === 'income' ? '+' : x.type === 'expense' ? '−' : ''}${money(x.amount)}</b>`;
  /** One transaction row. opts: {date, select, actions} */
  UI.txRow = (x, o = {}) => {
    const cat = Q.cat(x.categoryId), acc = Q.acc(x.accountId), to = Q.acc(x.toAccountId), future = x.date > U.today();
    const meta = x.type === 'transfer'
      ? h`<span>${acc ? acc.name : '?'}</span>${UI.icon('arrow-right', 12, 'flip')}<span>${to ? to.name : '?'}</span>`
      : h`${cat ? UI.catChip(cat) : h`<span class="muted">${t('Uncategorized')}</span>`}<span class="dotsep">·</span><span>${acc ? acc.name : '?'}</span>`;
    return h`<div class="txr${o.select ? ' sel' : ''}" data-id="${x.id}" data-act="tx:edit">
      ${o.select ? h`<label class="chk" data-act="noop"><input type="checkbox" data-change="tx:pick" data-id="${x.id}" ${o.picked ? 'checked' : ''} aria-label="${t('Select')}"><i></i></label>` : ''}
      ${UI.txIcon(x)}
      <div class="tx-main"><b class="tx-title">${UI.txTitle(x)}</b><span class="tx-meta">${meta}${(x.tags || []).slice(0, 2).map(g => h`<span class="tag">#${g}</span>`)}${future ? h`<span class="pill info">${t('Scheduled')}</span>` : ''}</span></div>
      ${o.date ? h`<span class="tx-date">${o.date === 'rel' ? U.relDay(x.date) : U.fmtDate(x.date, 'short')}</span>` : ''}
      ${UI.txAmount(x)}
      ${o.actions ? h`<div class="tx-actions">
        <button type="button" class="btn icon ghost sm${x.cleared ? ' on' : ''}" data-act="tx:clear" data-id="${x.id}" data-tip="${x.cleared ? t('Cleared') : t('Mark as cleared')}">${UI.icon('check', 15)}</button>
        <button type="button" class="btn icon ghost sm" data-act="tx:edit" data-id="${x.id}" data-tip="${t('Edit')}">${UI.icon('edit', 15)}</button>
        <button type="button" class="btn icon ghost sm" data-act="tx:dup" data-id="${x.id}" data-tip="${t('Duplicate')}">${UI.icon('copy', 15)}</button>
        <button type="button" class="btn icon ghost sm" data-act="tx:del" data-id="${x.id}" data-tip="${t('Delete')}">${UI.icon('trash', 15)}</button></div>` : ''}
    </div>`;
  };

  /* ---------- forms ---------- */
  UI.amountInput = (id, cents, { name, placeholder = '0', required = true, change, autofocus } = {}) =>
    h`<div class="amt-input"><span class="cur" aria-hidden="true">${U.currency().symbol}</span><input id="${id}" name="${name || id}" inputmode="decimal" autocomplete="off" data-amt placeholder="${placeholder}" value="${cents ? U.toInput(cents) : ''}" ${required ? 'required' : ''} ${autofocus ? 'autofocus' : ''} ${change ? h`data-change="${change}"` : ''}></div>`;
  /** Read a form's fields into a plain object (amount fields parsed to minor units). */
  UI.read = form => {
    const o = {};
    for (const el of form.elements) {
      if (!el.name) continue;
      if (el.type === 'checkbox') o[el.name] = el.checked;
      else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
      else o[el.name] = el.hasAttribute('data-amt') ? U.parseAmount(el.value) : el.value;
    }
    return o;
  };
  UI.formError = (form, msg) => {
    let e = U.$('.form-error', form);
    if (!e) { e = document.createElement('div'); e.className = 'form-error'; e.setAttribute('role', 'alert'); form.appendChild(e); }
    e.textContent = msg || ''; e.hidden = !msg;
    if (msg) e.scrollIntoView({ block: 'nearest' });
  };
  UI.options = (list, selected, blank) =>
    h`${blank != null ? h`<option value="">${blank}</option>` : ''}${list.map(([v, l]) => h`<option value="${v}" ${String(v) === String(selected) ? 'selected' : ''}>${l}</option>`)}`;
  UI.accountOptions = (selected, { exclude, blank, all = false } = {}) =>
    UI.options(Q.accounts(all).filter(a => a.id !== exclude || a.id === selected).map(a => [a.id, a.name]), selected, blank);
  UI.categoryOptions = (type, selected, blank) => UI.options(Q.cats(type).map(c => [c.id, Q.catName(c)]), selected, blank);
  UI.swatches = (name, selected) => h`<div class="swatches" role="radiogroup">${K.PALETTE.map(c => h`<label><input type="radio" name="${name}" value="${c}" ${c === selected ? 'checked' : ''}><i style="--c:${c}"></i></label>`)}</div>`;

  return UI;
})();
