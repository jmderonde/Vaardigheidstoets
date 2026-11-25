// Grafieken voor de prijsuitreiking. Invoer: de "charts"-gegevens uit /api/display/:key/state.
import { esc, fmtMs, fmtN, f1 } from './lib.js';

const SC_MIN = 4, SC_MAX = 10;
const catLabel = (c) => c.short || c.name;
const dark = true;

export function stackChart(teams) {
  const W = 900, L = 200, R = 70, rh = 34, top = 8, H = top + teams.length * rh + 28;
  const max = Math.max(...teams.map((x) => x.total), 1);
  const sx = (v) => L + (W - L - R) * v / max;
  const step = max > 200 ? 100 : 50;
  let ax = '', g = '';
  for (let v = 0; v <= max; v += step) ax += `<line x1="${sx(v)}" x2="${sx(v)}" y1="${top}" y2="${H - 24}" stroke="rgba(56,189,248,.14)"/><text x="${sx(v)}" y="${H - 8}" text-anchor="middle">${v}</text>`;
  teams.forEach((x, i) => {
    const y = top + i * rh + 6;
    let cx = 0;
    g += `<text x="${L - 10}" y="${y + 14}" text-anchor="end" class="ink">${x.rank}. ${esc(x.name)}</text>`;
    [[x.crit, '#38bdf8', 'Criteria'], [x.red, '#fb923c', 'Bonus redtijd'], [x.sp, '#34d399', 'Bonus speeltijd']].forEach(([v, c, n]) => {
      if (v <= 0) return;
      const x1 = sx(cx), w = sx(cx + v) - x1;
      g += `<rect x="${x1}" y="${y}" width="${Math.max(w, 0)}" height="20" fill="${c}" stroke="#0a1424" stroke-width="2" data-tip="${esc(x.name)} · ${n}: ${fmtN(v)}"/>`;
      cx += v;
    });
    g += `<text x="${sx(x.total) + 8}" y="${y + 15}" class="ink" style="font-weight:700">${fmtN(x.total)}</text>`;
  });
  return `<div class="legend"><span><i style="background:#38bdf8"></i>Criteria</span><span><i style="background:#fb923c"></i>Bonus redtijd</span><span><i style="background:#34d399"></i>Bonus speeltijd</span></div>
   <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Totaalscore per post">${ax}${g}</svg>`;
}

export function radarChart(c, teamName) {
  const n = c.categories.length;
  if (n < 3) return '<p class="hint">Minimaal 3 categorieën nodig voor dit diagram.</p>';
  const team = c.teams.find((t) => t.name === teamName) || c.teams[0];
  const W = 520, H = 430, cx = W / 2, cy = H / 2 + 6, R = 140;
  const ang = (i) => -Math.PI / 2 + 2 * Math.PI * i / n;
  const pt = (i, v) => { const r = R * (Math.max(v, SC_MIN) - SC_MIN) / (SC_MAX - SC_MIN); return [cx + r * Math.cos(ang(i)), cy + r * Math.sin(ang(i))]; };
  const mine = c.categories.map((k) => team.catAvg[k.id] ?? SC_MIN);
  const avg = c.categories.map((k) => { const v = c.teams.map((t) => t.catAvg[k.id]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : SC_MIN; });
  let g = '';
  [6, 8, 10].forEach((v) => {
    g += `<polygon points="${c.categories.map((_, i) => pt(i, v).join(',')).join(' ')}" fill="none" stroke="rgba(56,189,248,.18)"/><text x="${cx + 4}" y="${cy - R * (v - SC_MIN) / (SC_MAX - SC_MIN) - 2}" style="fill:#6f86a3">${v}</text>`;
  });
  c.categories.forEach((k, i) => {
    const [x, y] = pt(i, SC_MAX), lx = cx + (R + 18) * Math.cos(ang(i)), ly = cy + (R + 18) * Math.sin(ang(i)), co = Math.cos(ang(i));
    g += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="rgba(56,189,248,.18)"/><text x="${lx}" y="${ly + 4}" text-anchor="${Math.abs(co) < 0.2 ? 'middle' : co > 0 ? 'start' : 'end'}" class="ink">${esc(catLabel(k))}</text>`;
  });
  const poly = (a, col, dash) => `<polygon points="${a.map((v, i) => pt(i, v).join(',')).join(' ')}" fill="${col}" fill-opacity=".14" stroke="${col}" stroke-width="2" ${dash ? 'stroke-dasharray="6 4"' : ''}/>`;
  const dots = (a, col, name) => a.map((v, i) => { const [x, y] = pt(i, v); return `<circle cx="${x}" cy="${y}" r="4.5" fill="${col}" stroke="#0a1424" stroke-width="2" data-tip="${esc(name)} · ${esc(c.categories[i].name)}: ${f1(v)}"/>`; }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Gemiddelde score per categorie voor ${esc(team.name)} ten opzichte van het gemiddelde">${g}${poly(avg, '#fb923c', true)}${poly(mine, '#38bdf8')}${dots(avg, '#fb923c', 'Gemiddelde')}${dots(mine, '#38bdf8', team.name)}</svg>`;
}

export function heatmap(c) {
  const head = c.categories.map((k) => `<th class="c">${esc(catLabel(k))}</th>`).join('');
  const rows = c.teams.map((t) => `<tr><td style="white-space:nowrap">${t.rank}. ${esc(t.name)}</td>` + c.categories.map((k) => {
    const v = t.catAvg[k.id];
    if (v == null) return '<td class="c">–</td>';
    const p = Math.max(0, Math.min(100, (v - SC_MIN) / (SC_MAX - SC_MIN) * 100));
    return `<td style="background:color-mix(in srgb,#9ec5f4 ${p}%,#0d366b);color:${p > 55 ? '#04070d' : '#fff'}" data-tip="${esc(t.name)} · ${esc(k.name)}: ${f1(v)}">${f1(v)}</td>`;
  }).join('') + '</tr>').join('');
  return `<div class="scroll"><table class="heat"><thead><tr><th></th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function scatter(c) {
  const pts = c.teams.filter((t) => t.speelMs != null);
  if (!pts.length) return '<p class="hint">Nog geen tijden.</p>';
  const W = 520, H = 360, L = 52, R = 20, T = 16, B = 44;
  const xs = pts.map((t) => t.speelMs / 60000), ys = pts.map((t) => t.total);
  const x0 = Math.floor(Math.min(...xs)) - 1, x1 = Math.ceil(Math.max(...xs)) + 1;
  const y0 = Math.floor(Math.min(...ys) / 10) * 10 - 10, y1 = Math.ceil(Math.max(...ys) / 10) * 10 + 10;
  const sx = (v) => L + (W - L - R) * (v - x0) / (x1 - x0), sy = (v) => T + (H - T - B) * (1 - (v - y0) / (y1 - y0));
  let g = '';
  const ystep = Math.max(10, Math.ceil((y1 - y0) / 5 / 10) * 10);
  for (let v = y0; v <= y1; v += ystep) g += `<line x1="${L}" x2="${W - R}" y1="${sy(v)}" y2="${sy(v)}" stroke="rgba(56,189,248,.14)"/><text x="${L - 8}" y="${sy(v) + 4}" text-anchor="end">${v}</text>`;
  for (let v = x0; v <= x1; v += Math.max(1, Math.ceil((x1 - x0) / 8))) g += `<text x="${sx(v)}" y="${H - 24}" text-anchor="middle">${v}</text>`;
  g += `<text x="${(L + W - R) / 2}" y="${H - 6}" text-anchor="middle">Speeltijd (minuten)</text><text x="12" y="${(T + H - B) / 2}" text-anchor="middle" transform="rotate(-90 12 ${(T + H - B) / 2})">Totaalscore</text>`;
  c.teams.forEach((t) => {
    if (t.speelMs == null) return;
    const x = sx(t.speelMs / 60000), y = sy(t.total);
    g += `<circle cx="${x}" cy="${y}" r="11" fill="#38bdf8" stroke="#0a1424" stroke-width="2" data-tip="${esc(t.name)} · ${fmtN(t.total)} punten · ${fmtMs(t.speelMs)}"/><text x="${x}" y="${y + 4}" text-anchor="middle" style="fill:#04070d;font-weight:700;pointer-events:none">${t.rank}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Totaalscore uitgezet tegen speeltijd">${g}</svg>`;
}

export function awards(c) {
  const out = [];
  c.roles.forEach((r) => {
    let best = null;
    c.teams.forEach((t) => { const s = t.roleSum[r.id] || 0, n = t.roleHave[r.id] || 0; if (n && (!best || s > best.s)) best = { t, s, n }; });
    if (best) out.push(`<div class="award"><span>Beste ${esc(r.name)}</span><b>${esc(best.t.name)}</b><span>${best.s} punten (gem. ${f1(best.s / best.n)})</span></div>`);
  });
  const fr = c.teams.filter((t) => t.redMs != null).sort((a, b) => a.redMs - b.redMs)[0];
  const fs = c.teams.filter((t) => t.speelMs != null).sort((a, b) => a.speelMs - b.speelMs)[0];
  if (fr) out.push(`<div class="award"><span>Snelste redtijd</span><b>${esc(fr.name)}</b><span>${fmtMs(fr.redMs)}</span></div>`);
  if (fs) out.push(`<div class="award"><span>Snelste speeltijd</span><b>${esc(fs.name)}</b><span>${fmtMs(fs.speelMs)}</span></div>`);
  return `<div class="awards">${out.join('')}</div>`;
}

export function chartsHTML(c, radarTeam) {
  return `<div class="p" style="margin-bottom:14px"><h2><span>Prijzen per functie en tijd</span></h2>${awards(c)}</div>
   <div class="charts">
    <section class="p" style="grid-column:1/-1"><h2><span>Totaalscore per post</span></h2>${stackChart(c.teams)}</section>
    <section class="p"><h2><span>Profiel per categorie</span><select data-radar style="width:auto">${c.teams.map((t) => `<option ${t.name === (radarTeam || c.teams[0].name) ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></h2>
     <div class="legend"><span><i style="background:#38bdf8"></i>${esc(radarTeam || c.teams[0].name)}</span><span><i style="background:#fb923c"></i>Gemiddelde van alle posten</span></div>${radarChart(c, radarTeam)}</section>
    <section class="p"><h2><span>Scores per categorie</span></h2>${heatmap(c)}<p class="hint">Gemiddelde score (${SC_MIN}–${SC_MAX}); lichter is hoger.</p></section>
    <section class="p"><h2><span>Sneller is beter?</span></h2>${scatter(c)}<p class="hint">Elke bol is een post; het cijfer is de eindplek.</p></section>
   </div>`;
}
void dark;
