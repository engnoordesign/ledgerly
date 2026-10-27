'use strict';
/* Ledgerly utilities
   - ids, safe HTML templating (auto-escaping)
   - money: always integer MINOR units (cents). Never floats.
   - dates: always local ISO strings 'YYYY-MM-DD' / month keys 'YYYY-MM'
*/
const U = (() => {
  const U = {};

  /* ---------- ids ---------- */
  U.uid = (p = '') => p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);

  /* ---------- html templating ---------- */
  class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  U.esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);
  U.raw = s => new Raw(String(s ?? ''));
  const rend = v => v instanceof Raw ? v.s
    : Array.isArray(v) ? v.map(rend).join('')
    : (v === false || v == null) ? '' : U.esc(v);
  /** html`<b>${userText}</b>` – interpolations are escaped unless they are nested html`` results. */
  U.h = (strings, ...vals) => {
    let out = '';
    strings.forEach((s, i) => { out += s; if (i < vals.length) out += rend(vals[i]); });
    return new Raw(out);
  };

  /* ---------- money ---------- */
  const cur = { code: 'USD', locale: 'en-US', digits: 2, pow: 100, dec: '.' };
  U.CURRENCIES = [
    ['USD', 'US Dollar'], ['EUR', 'Euro'], ['GBP', 'British Pound'], ['SAR', 'Saudi Riyal'],
    ['AED', 'UAE Dirham'], ['EGP', 'Egyptian Pound'], ['KWD', 'Kuwaiti Dinar'], ['QAR', 'Qatari Riyal'],
    ['BHD', 'Bahraini Dinar'], ['OMR', 'Omani Rial'], ['JOD', 'Jordanian Dinar'], ['MAD', 'Moroccan Dirham'],
    ['TND', 'Tunisian Dinar'], ['DZD', 'Algerian Dinar'], ['IQD', 'Iraqi Dinar'], ['LBP', 'Lebanese Pound'],
    ['TRY', 'Turkish Lira'], ['CAD', 'Canadian Dollar'], ['AUD', 'Australian Dollar'], ['CHF', 'Swiss Franc'],
    ['JPY', 'Japanese Yen'], ['CNY', 'Chinese Yuan'], ['INR', 'Indian Rupee'], ['PKR', 'Pakistani Rupee'],
    ['BRL', 'Brazilian Real'], ['MXN', 'Mexican Peso'], ['ZAR', 'South African Rand'], ['NGN', 'Nigerian Naira'],
    ['SEK', 'Swedish Krona'], ['NOK', 'Norwegian Krone'], ['DKK', 'Danish Krone'], ['PLN', 'Polish Zloty'],
    ['RUB', 'Russian Ruble'], ['KRW', 'South Korean Won'], ['SGD', 'Singapore Dollar'], ['IDR', 'Indonesian Rupiah'],
  ];
  U.LOCALES = [['en-US', '1,234.56'], ['en-GB', '1,234.56 (UK)'], ['de-DE', '1.234,56'], ['fr-FR', '1 234,56'], ['en-IN', '1,23,456.78'], ['ar-EG', 'Arabic digits']];

  U.setCurrency = (code, locale) => {
    cur.code = code || 'USD';
    cur.locale = locale || 'en-US';
    let nf;
    try { nf = new Intl.NumberFormat(cur.locale, { style: 'currency', currency: cur.code }); }
    catch (e) { cur.code = 'USD'; cur.locale = 'en-US'; nf = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }); }
    cur.digits = nf.resolvedOptions().maximumFractionDigits;
    cur.pow = Math.pow(10, cur.digits);
    cur.nf = nf;
    cur.nfc = new Intl.NumberFormat(cur.locale, { style: 'currency', currency: cur.code, notation: 'compact', maximumFractionDigits: 1 });
    cur.nfn = new Intl.NumberFormat(cur.locale, { minimumFractionDigits: cur.digits, maximumFractionDigits: cur.digits });
    cur.nfi = new Intl.NumberFormat(cur.locale, { minimumFractionDigits: cur.digits, maximumFractionDigits: cur.digits, useGrouping: false });
    const dp = cur.nfn.formatToParts(1.1).find(p => p.type === 'decimal');
    cur.dec = dp ? dp.value : '.';
    const sp = nf.formatToParts(1).find(p => p.type === 'currency');
    cur.symbol = sp ? sp.value : cur.code;
  };
  U.currency = () => cur;
  U.setCurrency('USD', 'en-US');

  /** Format minor units. opts: {sign, compact, plain} */
  U.money = (c, o = {}) => {
    c = Number(c) || 0;
    const v = Math.abs(c) / cur.pow;
    const body = o.compact ? cur.nfc.format(v) : o.plain ? cur.nfn.format(v) : cur.nf.format(v);
    return (c < 0 ? '−' : (o.sign && c > 0 ? '+' : '')) + body;
  };
  /** Editable string for an input (no grouping, locale decimal). */
  U.toInput = c => (c == null || isNaN(c)) ? '' : (c < 0 ? '-' : '') + cur.nfi.format(Math.abs(c) / cur.pow);

  /** Parse what a human typed into minor units. Returns NaN if it isn't a number. */
  U.parseAmount = input => {
    if (typeof input === 'number') return Math.round(input * cur.pow);
    let s = String(input ?? '').trim();
    if (!s) return NaN;
    s = s.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
      .replace(/٫/g, '.').replace(/[٬\s ']/g, '');
    const neg = /^\(.*\)$/.test(s) || /^[-−]/.test(s);
    s = s.replace(/[^0-9.,]/g, '');
    if (!s || !/\d/.test(s)) return NaN;
    const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
    let decAt = -1;
    if (lastDot >= 0 && lastComma >= 0) decAt = Math.max(lastDot, lastComma);
    else if (lastDot >= 0 || lastComma >= 0) {
      const i = Math.max(lastDot, lastComma), sep = s[i];
      const count = s.split(sep).length - 1, after = s.length - i - 1;
      if (count === 1 && (sep === cur.dec || after !== 3)) decAt = i;
    }
    const intPart = (decAt < 0 ? s : s.slice(0, decAt)).replace(/[.,]/g, '') || '0';
    const frac = decAt < 0 ? '' : s.slice(decAt + 1).replace(/[.,]/g, '');
    const fracMinor = cur.digits ? Number((frac + '0'.repeat(cur.digits)).slice(0, cur.digits)) : 0;
    const m = Number(intPart) * cur.pow + fracMinor;
    if (!isFinite(m)) return NaN;
    return neg ? -m : m;
  };
  U.fmtPct = (r, d = 0) => (isFinite(r) ? (r * 100).toFixed(d) : '0') + '%';
  U.fmtDelta = r => (r > 0 ? '+' : r < 0 ? '−' : '') + Math.abs(r * 100).toFixed(0) + '%';

  /* ---------- dates ---------- */
  const pad = n => String(n).padStart(2, '0');
  U.pad = pad;
  U.iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  U.today = () => U.iso(new Date());
  U.parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
  U.isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && U.iso(U.parse(s)) === s;
  U.addDays = (s, n) => { const d = U.parse(s); d.setDate(d.getDate() + n); return U.iso(d); };
  U.daysInMonth = (y, m) => new Date(y, m, 0).getDate();
  U.addMonths = (s, n, anchorDay) => {
    const [y, m, d] = s.split('-').map(Number);
    const t = y * 12 + (m - 1) + n, ny = Math.floor(t / 12), nm = t % 12 + 1;
    return `${ny}-${pad(nm)}-${pad(Math.min(anchorDay || d, U.daysInMonth(ny, nm)))}`;
  };
  U.monthKey = s => s.slice(0, 7);
  U.addMonthKey = (k, n) => U.addMonths(k + '-01', n).slice(0, 7);
  U.monthStart = k => k + '-01';
  U.monthEnd = k => `${k}-${pad(U.daysInMonth(+k.slice(0, 4), +k.slice(5, 7)))}`;
  U.monthsBetween = (a, b) => { const out = []; for (let k = a; k <= b; k = U.addMonthKey(k, 1)) out.push(k); return out; };
  U.diffDays = (a, b) => Math.round((U.parse(b) - U.parse(a)) / 86400000);
  U.diffMonths = (a, b) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));
  U.curMonth = () => U.today().slice(0, 7);
  U.dayOfMonth = s => +s.slice(8, 10);

  let dfc = {};
  U.dateLocale = 'en-US';
  U.setDateLocale = loc => { U.dateLocale = loc; dfc = {}; };
  const df = (k, o) => dfc[k] || (dfc[k] = new Intl.DateTimeFormat(U.dateLocale, o));
  U.fmtDate = (s, style = 'med') => {
    const d = U.parse(s);
    switch (style) {
      case 'short': return df('s', { month: 'short', day: 'numeric' }).format(d);
      case 'long': return df('l', { weekday: 'long', month: 'long', day: 'numeric' }).format(d);
      case 'weekday': return df('w', { weekday: 'short' }).format(d);
      case 'day': return df('d', { day: 'numeric' }).format(d);
      default: return df('m', { month: 'short', day: 'numeric', year: 'numeric' }).format(d);
    }
  };
  U.fmtMonth = (k, style = 'long') => {
    const d = U.parse(k + '-01');
    switch (style) {
      case 'short': return df('ms', { month: 'short' }).format(d);
      case 'month': return df('mm', { month: 'long' }).format(d);
      case 'short-year': return df('msy', { month: 'short', year: '2-digit' }).format(d);
      default: return df('ml', { month: 'long', year: 'numeric' }).format(d);
    }
  };
  U.relDay = s => {
    const n = U.diffDays(U.today(), s);
    if (n === 0) return t('Today');
    if (n === 1) return t('Tomorrow');
    if (n === -1) return t('Yesterday');
    return n > 0 ? t('in {n}', { n: I18N.count(n, 'day') }) : t('{n} ago', { n: I18N.count(-n, 'day') });
  };
  /** First day of the week containing `s`; startDay: 0 Sun, 1 Mon, 6 Sat. */
  U.weekStart = (s, startDay = 1) => { const dow = U.parse(s).getDay(); return U.addDays(s, -((dow - startDay + 7) % 7)); };
  U.yearStart = y => `${y}-01-01`;
  U.yearEnd = y => `${y}-12-31`;
  U.fmtRange = (a, b) => a === b ? U.fmtDate(a, 'med')
    : a.slice(0, 4) === b.slice(0, 4) ? `${U.fmtDate(a, 'short')} – ${U.fmtDate(b, 'med')}` : `${U.fmtDate(a, 'med')} – ${U.fmtDate(b, 'med')}`;

  /* ---------- misc ---------- */
  U.debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  U.sum = (arr, f) => arr.reduce((a, x) => a + (f ? f(x) : x), 0);
  U.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  U.ratio = (a, b) => (b ? a / b : 0);
  U.groupBy = (arr, f) => { const m = new Map(); for (const x of arr) { const k = f(x); (m.get(k) || m.set(k, []).get(k)).push(x); } return m; };
  U.plural = (n, unit) => I18N.count(n, unit);
  U.initials = s => String(s || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  U.rand = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

  /** Nice axis scale for a maximum value (works in minor units). */
  U.niceScale = (max, want = 4) => {
    if (!(max > 0)) return { max: 1, step: 1, ticks: [0, 1] };
    const raw = max / want, mag = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / mag;
    const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
    const top = Math.ceil(max / step - 1e-9) * step, ticks = [];
    for (let v = 0; v <= top + step / 1e6; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
    return { max: top, step, ticks };
  };

  /* ---------- files & csv ---------- */
  U.download = (name, text, mime = 'text/plain') => {
    const blob = new Blob([text], { type: mime + ';charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };
  U.csv = rows => rows.map(r => r.map(c => {
    const s = String(c ?? '');
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n');
  U.parseCsv = text => {
    const rows = []; let row = [], cell = '', q = false;
    text = text.replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',' || ch === ';') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = ''; if (row.some(c => c !== '')) rows.push(row); row = [];
      } else cell += ch;
    }
    row.push(cell); if (row.some(c => c !== '')) rows.push(row);
    return rows;
  };

  /* ---------- tiny DOM helpers ---------- */
  U.$ = (sel, root = document) => root.querySelector(sel);
  U.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  return U;
})();
