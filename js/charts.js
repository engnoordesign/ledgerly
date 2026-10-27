'use strict';
/* Charts: HTML + SVG hybrids so text stays crisp at any width.
   Every mark carries data-tip (shown by the global tooltip in ui.js). Charts are always LTR: time runs left to right
   in both languages. Colours come from CSS tokens so they follow light / dark. */
const C = (() => {
  const C = {};
  const { h, money } = U;
  const tip = (...lines) => lines.flat().filter(Boolean).join('\n');
  const pct = (v, max) => (max ? Math.max(0, Math.min(100, v / max * 100)) : 0).toFixed(2);

  /** Grouped income / expense columns. bars: [{label, title, income, expense, cur}] */
  C.bars = ({ bars, height = 210 }) => {
    const max = Math.max(1, ...bars.map(b => Math.max(b.income, b.expense)));
    const sc = U.niceScale(max, 4), step = Math.ceil(bars.length / (window.innerWidth < 520 ? 6 : 12));
    return h`<div class="chart bars" dir="ltr" style="--h:${height}px">
      <div class="plot">
        ${sc.ticks.map(v => h`<div class="gl" style="bottom:${pct(v, sc.max)}%"><span>${v ? money(v, { compact: true }) : '0'}</span></div>`)}
        <div class="cols">
          ${bars.map(b => h`<div class="bcol${b.cur ? ' cur' : ''}" data-tip="${tip(b.title, `${t('Income')}: ${money(b.income)}`, `${t('Expenses')}: ${money(b.expense)}`, `${t('Net')}: ${money(b.net, { sign: true })}`)}">
            <div class="pair">
              <i class="bar inc${b.income ? '' : ' z'}" style="height:${pct(b.income, sc.max)}%"></i>
              <i class="bar exp${b.expense ? '' : ' z'}" style="height:${pct(b.expense, sc.max)}%"></i>
            </div></div>`)}
        </div>
      </div>
      <div class="xlab">${bars.map((b, i) => h`<span class="${b.cur ? 'cur' : ''}">${i % step === 0 || b.cur ? b.label : ''}</span>`)}</div>
    </div>`;
  };
  C.legend = items => h`<div class="legend">${items.map(i => h`<span><i class="sw" style="background:${i.color}"></i>${i.label}</span>`)}</div>`;

  /** Area / line over time. points: [{label, title, value}] */
  C.line = ({ points, height = 200, color = 'var(--accent)' }) => {
    const n = points.length, vals = points.map(p => p.value);
    const min = Math.min(...vals), max = Math.max(...vals), sc = U.niceScale(Math.max(1, max - min), 3);
    let lo = Math.floor(min / sc.step) * sc.step, hi = Math.ceil(max / sc.step) * sc.step;
    if (hi === lo) hi = lo + sc.step;
    const x = i => n === 1 ? 50 : 3 + i / (n - 1) * 94, y = v => 100 - (v - lo) / (hi - lo) * 100;
    const ln = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)} ${y(p.value).toFixed(2)}`).join(' ');
    const ticks = []; for (let v = lo; v <= hi + sc.step / 1e6; v += sc.step) ticks.push(v);
    const step = Math.ceil(n / (window.innerWidth < 520 ? 4 : 8)), last = n - 1;
    return h`<div class="chart line" dir="ltr" style="--h:${height}px;--c:${color}">
      <div class="plot">
        ${ticks.map(v => h`<div class="gl" style="bottom:${pct(v - lo, hi - lo)}%"><span>${money(v, { compact: true })}</span></div>`)}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path class="area" d="${ln} L${x(last).toFixed(2)} 100 L${x(0).toFixed(2)} 100Z"/>
          <path class="ln" d="${ln}"/>
        </svg>
        <div class="hits">${points.map((p, i) => h`<div class="hit" data-tip="${tip(p.title, money(p.value))}" style="left:${x(i) - 47 / Math.max(1, n - 1)}%;width:${94 / Math.max(1, n - 1)}%"></div>`)}</div>
        <i class="dot" style="left:${x(last)}%;top:${y(points[last].value)}%"></i>
      </div>
      <div class="xlab">${points.map((p, i) => h`<span>${i % step === 0 || i === last ? p.label : ''}</span>`)}</div>
    </div>`;
  };

  /** Donut. items: [{label, value, color}]; center: html */
  C.donut = ({ items, center, size = 168 }) => {
    const total = U.sum(items, i => i.value) || 1; let acc = 0;
    const gap = items.length > 1 ? 0.9 : 0;
    const segs = items.map(i => {
      const p = i.value / total * 100;
      const s = h`<circle class="seg" cx="50" cy="50" r="40" pathLength="100" style="stroke:${i.color}" stroke-dasharray="${Math.max(0.2, p - gap).toFixed(3)} 100" stroke-dashoffset="${(-acc).toFixed(3)}" data-tip="${tip(i.label, `${money(i.value)} · ${U.fmtPct(p / 100, p < 10 ? 1 : 0)}`)}"/>`;
      acc += p; return s;
    });
    return h`<div class="donut" dir="ltr" style="--s:${size}px">
      <svg viewBox="0 0 100 100" aria-hidden="true"><circle class="track" cx="50" cy="50" r="40"/><g transform="rotate(-90 50 50)">${segs}</g></svg>
      <div class="donut-c">${center}</div></div>`;
  };

  /** Progress ring. */
  C.ring = ({ pct: p, color = 'var(--accent)', size = 72, text }) => h`<div class="ring" dir="ltr" style="--s:${size}px;--c:${color}">
    <svg viewBox="0 0 40 40" aria-hidden="true"><circle class="track" cx="20" cy="20" r="16"/><circle class="arc" cx="20" cy="20" r="16" pathLength="100" stroke-dasharray="${(p * 100).toFixed(2)} 100" transform="rotate(-90 20 20)"/></svg>
    <span>${text != null ? text : U.fmtPct(p)}</span></div>`;

  /** Tiny trend line. values: numbers */
  C.spark = (values, { color = 'var(--accent)' } = {}) => {
    if (!values || values.length < 2) return h``;
    const min = Math.min(...values), max = Math.max(...values), span = max - min || 1, n = values.length;
    const pts = values.map((v, i) => [i / (n - 1) * 100, 36 - (v - min) / span * 32]);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
    return h`<svg class="spark" viewBox="0 0 100 40" preserveAspectRatio="none" style="--c:${color}" aria-hidden="true"><path class="area" d="${d} L100 40 L0 40Z"/><path class="ln" d="${d}"/></svg>`;
  };

  /** Budget meter: fill turns amber at 85% and red over 100%. A coloured or plain meter shows progress only (goals, scores). */
  C.meter = (ratio, { color, plain } = {}) => {
    const state = color || plain ? 'ok' : ratio > 1 ? 'bad' : ratio >= 0.85 ? 'warn' : 'ok';
    return h`<div class="meter ${state}"${color ? h` style="--c:${color}"` : ''} role="presentation"><i style="width:${(U.clamp(ratio, 0, 1) * 100).toFixed(1)}%"></i></div>`;
  };

  /** Single stacked bar with 2px gaps: [{label, value, color}] */
  C.split = segs => {
    const total = U.sum(segs, s => s.value) || 1;
    return h`<div class="split" dir="ltr">${segs.filter(s => s.value > 0).map(s => h`<i style="flex:${s.value};background:${s.color}" data-tip="${tip(s.label, U.fmtPct(s.value / total, 0))}"></i>`)}</div>`;
  };

  /** Ranked horizontal bars: items [{label, value, color, icon, sub}] */
  C.hbars = (items, { total } = {}) => {
    const max = Math.max(1, ...items.map(i => i.value)), sum = total || U.sum(items, i => i.value) || 1;
    return h`<div class="hbars">${items.map(i => h`<div class="hrow" data-tip="${tip(i.label, money(i.value))}">
      <div class="hl">${i.lead || ''}<span class="hn">${i.label}</span></div>
      <div class="ht"><i style="width:${pct(i.value, max)}%;background:${i.color}"></i></div>
      <div class="hv"><b class="num">${money(i.value)}</b><small>${U.fmtPct(i.value / sum, i.value / sum < 0.1 ? 1 : 0)}</small></div>
    </div>`)}</div>`;
  };

  return C;
})();
