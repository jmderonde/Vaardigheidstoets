// Gedeelde schermonderdelen voor de jury-console en het groot scherm.
import { esc, f2, fmtMs, fmtN } from './lib.js';

export const hmMin = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return m ? +m[1] * 60 + +m[2] : null; };
export const toHM = (min) => { min = Math.max(0, Math.min(1439, min)); return `${f2(Math.floor(min / 60))}:${f2(min % 60)}`; };
export const LAB = { plan: '○ Gepland', ready: '⚡ Ready', run: '● Lopend', wrap: '◐ Afronden', done: '✓ Gespeeld', out: '✕ Vervallen' };
export const isFuture = (t) => t.status === 'plan' || t.status === 'ready';

export function bonusPts(ms, maxMin, s) {
  if (ms == null) return 0;
  const rem = (maxMin * 60000 - ms) / 60000;
  if (rem <= 0) return 0;
  const m = s.rounding === 'floor' ? Math.floor(rem) : s.rounding === 'round' ? Math.round(rem) : Math.round(rem * 100) / 100;
  return m * s.bonusPerMin;
}
const minutesOfDay = (ms) => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; };

/* ---------- tijdlijn ---------- */
export function timeline(teams, s) {
  const starts = teams.map((t) => hmMin(t.start)).filter((x) => x != null);
  const slot = s.maxSpeelMin + s.wrapMin;
  let lo = 8 * 60, hi = 17 * 60;
  if (starts.length) { lo = Math.floor((Math.min(...starts) - 20) / 60) * 60; hi = Math.ceil((Math.max(...starts) + slot + 10) / 60) * 60; }
  const tot = hi - lo;
  let h = '<div class="ax"></div>';
  for (let m = Math.ceil(lo / 60) * 60; m <= hi; m += 60) h += `<span class="tk" style="left:${(m - lo) / tot * 100}%">${f2(m / 60)}:00</span>`;
  teams.forEach((t, i) => {
    const st = hmMin(t.start);
    if (st == null) return;
    h += `<div class="blk ${t.status}" style="left:${(st - lo) / tot * 100}%;width:${slot / tot * 100}%;--pl:${s.maxSpeelMin};--wr:${s.wrapMin}" title="${esc(t.name)}"><div class="pl">${t.status === 'out' ? '✕' : i + 1}</div><div class="wr"></div></div>`;
  });
  return `<div class="tl" data-lo="${lo}" data-tot="${tot}">${h}<div class="now" data-now></div></div>`;
}
export function tickTimeline(root, now) {
  const tl = root.querySelector('.tl'), n = root.querySelector('[data-now]');
  if (!tl || !n) return;
  n.style.left = ((minutesOfDay(now) - +tl.dataset.lo) / +tl.dataset.tot * 100) + '%';
}

/* ---------- live inzet ---------- */
export function stepsOf(t) {
  if (!t) return [];
  const V = t.victims || 1;
  const flags = [['Aanwezig', !!(t.gemeld_at || t.gemeld)], ['Ready', !!(t.ready_at || t.ready)], ['Start', !!t.started_at], [V > 1 ? `Gered ${t.rescued_n || 0}/${V}` : 'Gered', !!t.rescued_at], ['Einde', !!t.ended_at], ['Afronden', t.status === 'done'], ['Vergrendeld', t.status === 'done']];
  // "Afronden" is klaar zodra de afrondtijd voorbij is; "Vergrendeld" volgt direct.
  const cur = flags.findIndex((f) => !f[1]);
  return flags.map(([n, d], i) => `<div class="${d ? 'ok' : i === cur ? 'cur' : ''}">${d ? '✓ ' : ''}${n}</div>`);
}

export function liveHTML(t, s, controls = '') {
  const idle = !t;
  const state = idle ? '<span class="state idle">WACHT OP START</span>'
    : t.status === 'wrap' ? '<span class="state wrap">AFRONDEN · WAARNEMERS</span>' : '<span class="state">● LOPEND</span>';
  return `<div class="live" data-live-root>
   <div class="gauge"><svg viewBox="0 0 280 280" aria-hidden="true"><defs><linearGradient id="gg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#38bdf8"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs>
    <circle cx="140" cy="140" r="116" fill="none" stroke="rgba(111,134,163,.22)" stroke-width="14"/>
    <circle data-l="arc" cx="140" cy="140" r="116" fill="none" stroke="url(#gg)" stroke-width="14" stroke-linecap="round" stroke-dasharray="728.8" stroke-dashoffset="728.8" style="filter:drop-shadow(0 0 8px rgba(34,211,238,.8))"/>
    <circle cx="140" cy="140" r="96" fill="none" stroke="rgba(56,189,248,.2)" stroke-dasharray="2 8"/></svg>
    <div class="mid"><div class="big" data-l="big">00:00</div><div class="lbl" data-l="lbl">speeltijd</div><div class="max" data-l="max">max ${fmtMs(s.maxSpeelMin * 60000)}</div></div></div>
   <div><div class="team">${idle ? 'Geen inzet actief' : esc(t.name)}</div><div style="margin-top:8px">${state}</div>
    <div class="meta"><div class="kv"><small data-l="redlbl">Redtijd</small><b class="g" data-l="red">–</b></div><div class="kv"><small>Bonus redtijd</small><b class="g" data-l="bred">–</b></div><div class="kv"><small>Bonus speeltijd nu</small><b class="c" data-l="bsp">–</b></div></div>
    <div class="steps">${stepsOf(t).join('')}</div>${controls}</div></div>`;
}

export function tickLive(root, t, s, now) {
  const q = (n) => root.querySelector(`[data-l="${n}"]`);
  if (!q('big')) return;
  if (!t) { q('big').textContent = '00:00'; return; }
  const maxS = s.maxSpeelMin * 60000;
  const wrap = t.status === 'wrap';
  const sp = (t.ended_at || now) - t.started_at;
  const pct = Math.min(1, sp / maxS);
  q('arc').style.strokeDashoffset = 728.8 * (1 - pct);
  q('arc').style.stroke = pct > 0.85 ? 'var(--warn)' : 'url(#gg)';
  q('big').textContent = wrap ? fmtMs(Math.max(0, t.wrap_end - now)) : fmtMs(sp);
  q('lbl').textContent = wrap ? 'afrondtijd waarnemers' : 'speeltijd';
  q('max').textContent = wrap ? 'speeltijd ' + fmtMs(sp) : 'max ' + fmtMs(maxS);
  const red = t.rescued_at ? t.rescued_at - t.started_at : null;
  const V = t.victims || 1;
  q('redlbl').textContent = V > 1 ? `Redtijd · ${t.rescued_n || 0}/${V} gered` : 'Redtijd';
  q('red').textContent = red != null ? fmtMs(red) : (t.ended_at ? 'niet gered' : fmtMs(now - t.started_at));
  q('red').style.opacity = red != null ? 1 : 0.6;
  q('bred').textContent = red != null ? '+' + fmtN(bonusPts(red, s.maxRedMin, s)) : '–';
  q('bsp').textContent = '+' + fmtN(bonusPts(sp, s.maxSpeelMin, s));
}

/* ---------- volgende ploeg ---------- */
export function nextHTML(next, later, outs, controls = '') {
  if (!next) return '<div class="nm">Geen ploegen meer</div><p class="mut">Alle ploegen zijn gespeeld of vervallen.</p>';
  const ready = !!(next.ready_at || next.ready);
  return `<div class="nm">${esc(next.name)}</div>
   ${ready ? `<span class="rd">⚡ READY TO START</span>${next.ready_by ? `<div class="mut" style="font-size:12px">gemarkeerd door ${esc(next.ready_by)}</div>` : ''}` : `<span class="rd grey">○ WACHT OP READY</span><div class="mut" style="font-size:12px">${next.gemeld_at || next.gemeld ? 'ploeg is aanwezig' : 'ploeg is nog niet aanwezig'}</div>`}
   <div class="cd" data-cd="${hmMin(next.start) ?? ''}">--:--</div><div class="cdl" data-cdl>${next.start ? 'tot geplande start ' + esc(next.start) : 'geen starttijd ingesteld'}</div>
   <div class="meta" style="grid-template-columns:1fr 1fr;margin:12px 0 0"><div class="kv"><small>Meldtijd</small><b>${esc(next.meld || '–')}</b></div><div class="kv"><small>Starttijd</small><b>${esc(next.start || '–')}</b></div></div>
   ${controls}
   <div class="after"><small class="cdl">Daarna</small>${later.map((y) => `<div><span>${esc(y.name)}</span><span>meld ${esc(y.meld || '–')} · start ${esc(y.start || '–')}</span></div>`).join('') || '<div><span class="mut">geen</span></div>'}
   ${outs.map((y) => `<div style="color:var(--bad)"><span>✕ ${esc(y.name)}</span><span>vervallen</span></div>`).join('')}</div>`;
}
export function tickNext(root, now) {
  const cd = root.querySelector('[data-cd]');
  if (!cd) return;
  const min = cd.dataset.cd === '' ? null : +cd.dataset.cd;
  if (min == null) { cd.textContent = '--:--'; return; }
  const d = new Date(now); d.setHours(Math.floor(min / 60), min % 60, 0, 0);
  const diff = d.getTime() - now;
  const abs = Math.abs(diff);
  const h = Math.floor(abs / 3600000);
  cd.textContent = (diff < 0 ? '+' : '') + (h ? h + ':' : '') + (h ? f2(Math.floor(abs / 60000) % 60) : f2(Math.floor(abs / 60000))) + ':' + f2(Math.floor(abs / 1000) % 60);
  cd.classList.toggle('late', diff < 0);
  const l = root.querySelector('[data-cdl]');
  if (l && diff < 0) l.textContent = 'over de geplande starttijd';
}

/* ---------- planning en tussenstand ---------- */
export function planningRows(teams, { edit = false, showScores = true, warn = () => '' } = {}) {
  const scoreCell = (t) => {
    if (t.total == null || !showScores) return '<span class="mut">–</span>';
    return `<span class="sc">${fmtN(t.total)}<span class="mini" style="width:${Math.max(0, (t.total - 300) / 2.5)}px"></span></span>`;
  };
  return teams.map((t, i) => {
    const ed = edit && isFuture(t);
    const meld = ed ? `<input class="tm" inputmode="numeric" maxlength="5" value="${esc(t.meld)}" data-tid="${t.id}" data-f="meld" aria-label="Meldtijd ${esc(t.name)} (uu:mm)">`
      : esc(t.meld || '–') + (t.gemeld_at || t.gemeld || t.started_at ? ' <span style="color:var(--ok)">✓</span>' : '');
    const start = ed ? `<input class="tm" inputmode="numeric" maxlength="5" value="${esc(t.start)}" data-tid="${t.id}" data-f="start" aria-label="Starttijd ${esc(t.name)} (uu:mm)">` : esc(t.start || '–');
    const prevF = isFuture(teams[i - 1] || {}), nextF = isFuture(teams[i + 1] || {});
    const act = !edit ? '' : isFuture(t)
      ? `<button class="btn sm" data-a="up" data-tid="${t.id}" ${prevF ? '' : 'disabled'} aria-label="Eerder">↑</button> <button class="btn sm" data-a="down" data-tid="${t.id}" ${nextF ? '' : 'disabled'} aria-label="Later">↓</button> <button class="btn sm" data-a="out" data-tid="${t.id}">Vervalt</button>`
      : t.status === 'out' ? `<button class="btn sm" data-a="restore" data-tid="${t.id}">Herstel</button>` : '';
    const time = t.speelMs != null ? fmtMs(t.speelMs) : (t.status === 'run' ? '<span data-live-time style="color:var(--cy)">…</span>' : '–');
    return `<tr class="${t.status}"><td class="mono mut">${i + 1}</td>
     <td><b class="nm2">${esc(t.name)}</b>${t.status === 'out' ? `<span class="rsn">Vervallen: ${esc(t.out_reason || '')}</span>` : ''}${edit ? warn(t, i) : ''}</td>
     <td class="mono">${meld}</td><td class="mono">${start}</td><td><span class="st ${t.status}">${LAB[t.status]}</span></td>
     <td class="n mono">${time}</td><td class="n">${scoreCell(t)}</td>
     <td class="n">${t.rank && showScores ? `<span class="rk ${t.rank === 1 ? 'r1' : ''}">${t.rank}</span>` : '<span class="mut">–</span>'}</td>
     ${edit ? `<td class="n" style="white-space:nowrap">${act}</td>` : ''}</tr>`;
  }).join('');
}
export const planningHead = (edit) => `<thead><tr><th>#</th><th>Post</th><th>Meld</th><th>Start</th><th>Status</th><th class="n">Speeltijd</th><th class="n">Score</th><th class="n">Plek</th>${edit ? '<th class="n">Acties</th>' : ''}</tr></thead>`;

export function progressCards(list) {
  return `<div class="obs4">${list.map((o) => {
    const pct = o.total ? o.done / o.total * 100 : 0;
    const cls = o.finished ? 'ok' : o.warn ? 'warn' : '';
    return `<div class="ob"><div class="r"><span>${esc(o.role)}</span><b>${o.done}/${o.total}</b></div><div class="bar"><i class="${cls}" style="width:${pct}%"></i></div><small>${o.note || ''}</small></div>`;
  }).join('')}</div>`;
}
