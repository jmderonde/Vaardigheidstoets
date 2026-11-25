import { api, clockOf, esc, f1, fmtMs, fmtN } from '../lib.js';
import { requireLogin } from '../router.js';

/* Rapport per ploeg: bedoeld om af te drukken of als PDF op te slaan. */
export async function reportView(root, [dayId, teamId]) {
  const me = await requireLogin();
  if (!me) return;
  let d;
  try { d = await api('GET', `/teams/${teamId}/sheet`); } catch (e) { root.innerHTML = `<div class="p" style="max-width:520px;margin:60px auto"><p>${esc(e.message)}</p></div>`; return; }
  const { team: t, roles, categories: cats } = d;
  const sum = (r) => d.roleSum[r.id] || 0;
  const rows = cats.map((c) => {
    const items = c.items.filter((i) => i.roles.some((r) => roles.some((x) => x.id === r)));
    if (!items.length) return '';
    return `<tr class="cat"><td colspan="${roles.length + 2}">${esc(c.name)}</td></tr>` + items.map((i) => {
      let tot = 0; const notes = [];
      const cells = roles.map((r) => {
        if (!i.roles.includes(r.id)) return '<td></td>';
        const e = d.cells[`${i.id}|${r.id}`];
        if (e) { tot += e.value || 0; if (e.note) notes.push(`${r.name}: ${e.note}`); }
        return `<td style="text-align:center"><b>${e ? e.value : '–'}</b></td>`;
      }).join('');
      return `<tr><td>${esc(i.name)}${notes.length ? `<div style="color:#555;font-size:12px">${notes.map(esc).join(' · ')}</div>` : ''}</td>${cells}<td style="text-align:right">${tot}</td></tr>`;
    }).join('');
  }).join('');
  const bars = cats.map((c) => {
    const mine = d.catAvg[c.id], all = d.allAvg[c.id];
    if (mine == null) return '';
    const pc = (v) => Math.max(0, Math.min(100, (v - 4) / 6 * 100));
    return `<tr><td style="width:34%">${esc(c.short || c.name)}</td><td><div class="barx"><i style="width:${pc(mine)}%"></i>${all != null ? `<u style="left:${pc(all)}%"></u>` : ''}</div></td><td style="width:90px;text-align:right">${f1(mine)}${all != null ? ` <span style="color:#777">(gem. ${f1(all)})</span>` : ''}</td></tr>`;
  }).join('');
  root.innerHTML = `<div class="noprint row" style="max-width:900px;margin:0 auto 12px"><a class="btn sm" href="/day/${dayId}/scoreblad" data-link>← Console</a><button class="btn pri sm" onclick="window.print()">Afdrukken / opslaan als PDF</button></div>
   <div class="report">
    <div style="color:#0e7490;font-weight:700;letter-spacing:.1em;text-transform:uppercase;font-size:12px">${esc(d.day.title)} · ${esc(d.day.date || '')} ${esc(d.day.place || '')}</div>
    <h1>${esc(t.name)}</h1>
    <div class="big3"><div><span>Plek</span><b>${t.rank ? t.rank + ' van ' + d.ranked : '–'}</b></div><div><span>Totaal</span><b>${fmtN(t.total)}</b></div><div><span>Criteria</span><b>${t.crit}</b></div><div><span>Bonus redtijd</span><b>+${fmtN(t.red)}</b></div><div><span>Bonus speeltijd</span><b>+${fmtN(t.sp)}</b></div></div>
    <p style="color:#555">Speeltijd ${fmtMs(t.speelMs)} · ${t.victims > 1 ? 'redtijden' : 'redtijd'} ${t.rescues && t.rescues.length ? t.rescues.map((ms, i) => (t.victims > 1 ? `slachtoffer ${i + 1}: ` : '') + fmtMs(ms)).join(' · ') : '–'}</p>
    <h2>Gemiddelde score per categorie</h2><p style="color:#555;font-size:12px;margin:0 0 6px">Balk = deze ploeg (schaal 4–10), oranje streep = gemiddelde van alle ploegen.</p><table>${bars}</table>
    <h2>Scores per functie</h2><table><thead><tr><th style="text-align:left">Criterium</th>${roles.map((r) => `<th>${esc(r.name)}</th>`).join('')}<th style="text-align:right">Totaal</th></tr></thead><tbody>${rows}
     <tr style="font-weight:700"><td>Totaal per functie</td>${roles.map((r) => `<td style="text-align:center">${sum(r)}</td>`).join('')}<td style="text-align:right">${t.crit}</td></tr></tbody></table>
    ${d.corrections.length ? `<h2>Correcties door de jury</h2><table>${d.corrections.map((k) => `<tr><td>${clockOf(k.at)}</td><td>${esc(k.role || '')} · ${esc(k.criterion || '')}</td><td>${k.old_value ?? '–'} → ${k.new_value}</td><td>${esc(k.reason)}</td></tr>`).join('')}</table>` : ''}
    <p style="color:#777;font-size:11px;margin-top:24px">Schaal: 4 onveilig · 5 onvoldoende · 6 voldoende · 7 netjes · 8 goed · 9 bijna optimaal · 10 optimaal.</p>
   </div>`;
}
