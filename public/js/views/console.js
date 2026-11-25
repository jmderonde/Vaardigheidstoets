import { $, $$, api, ask, clockOf, clockSec, confirmBox, esc, f1, fail, fmtMs, fmtN, setOffset, snow, sse, toast, typing } from '../lib.js';
import * as P from '../panels.js';
import { go, requireLogin } from '../router.js';

const parseMs = (s) => {
  s = String(s || '').trim().replace(',', '.');
  if (!s) return null;
  const p = s.split(':');
  const v = p.length === 1 ? parseFloat(p[0]) : parseFloat(p[0]) * 60 + parseFloat(p[1]);
  return Number.isFinite(v) ? Math.round(v * 1000) : NaN;
};

/* De console van de jury: het kloppend hart van de wedstrijddag. */
export async function consoleView(root, [dayId, tabParam]) {
  const me = await requireLogin();
  if (!me) return;
  let S, sheet = null;
  let tab = ['regie', 'scoreblad', 'prijs', 'dag'].includes(tabParam) ? tabParam : 'regie';
  let edit = false, tv = false, online = true, sheetTeam = null;
  const load = async () => { S = await api('GET', `/days/${dayId}/state`); setOffset(S.now); };
  try { await load(); } catch (e) {
    root.innerHTML = `<div class="p" style="max-width:520px;margin:60px auto"><h2><span>Geen toegang</span></h2><p>${esc(e.message)}</p><a class="btn" href="/days" data-link>Terug</a></div>`;
    return;
  }

  const act = (fn) => async (...a) => { try { await fn(...a); } catch (e) { fail(e); } };
  const refresh = async () => { try { await load(); draw(); } catch (e) { if (e.status === 401) go('/login'); } };
  const team = (id) => S.teams.find((t) => t.id === +id);
  const nItems = (roleId) => S.categories.reduce((n, c) => n + c.items.filter((i) => i.roles.includes(roleId)).length, 0);

  /* ---------- opbouw ---------- */
  function draw() {
    const y = scrollY;
    document.body.classList.toggle('tv', tv);
    document.body.classList.toggle('noscores', tv && !S.day.show_scores);
    const tabs = [['regie', 'Dagregie'], ['scoreblad', 'Scorebladen'], ['prijs', 'Prijsuitreiking'], ['dag', 'Dag']];
    root.innerHTML = `
     <header class="top"><a class="brand" href="/days" data-link><span class="logo"></span><span><b>${esc(S.day.title)}</b><small>${esc(S.day.date || '')} ${esc(S.day.place || '')} · ${esc(S.me.name)}</small></span></a>
      <div class="clock" data-clock>--:--:--<small>SERVERTIJD</small></div>
      <div class="top-r"><span class="chip co"><i class="dot ${online ? '' : 'b'}"></i>${online ? 'VERBONDEN' : 'GEEN VERBINDING'}</span>
       <label class="sw ${S.day.show_scores ? 'on' : ''}" data-sw role="switch" aria-checked="${S.day.show_scores}" tabindex="0" title="Scores zichtbaar op het groot scherm"><i></i>Scores op groot scherm</label>
       <div class="seg"><button class="${tv ? '' : 'on'}" data-mode="co">Console</button><button class="${tv ? 'on' : ''}" data-mode="tv">Groot scherm</button></div>
       ${me.role === 'admin' ? `<a class="btn sm co" href="/admin/day/${dayId}" data-link>Inrichten</a>` : ''}<a class="btn sm co" href="/days" data-link>Dagen</a></div></header>
     ${S.day.phase === 'locked' ? '<div class="warn co">🔒 De uitslag is vergrendeld. Waarnemers kunnen geen scores meer invoeren; correcties zijn nog mogelijk met toelichting.</div>' : ''}
     <nav class="tabs co">${tabs.map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</nav>
     <div id="body">${{ regie, scoreblad: () => '<div id="sheetbox" class="p"><p class="mut">Laden…</p></div>', prijs, dag }[tab]()}</div>`;
    scrollTo(0, y);
    tickAll();
    if (tab === 'scoreblad') drawSheet();
  }

  /* ---------- dagregie ---------- */
  function warnFor(t, i) {
    const w = [];
    if (P.hmMin(t.meld) != null && P.hmMin(t.start) != null && P.hmMin(t.meld) >= P.hmMin(t.start)) w.push('meldtijd ligt niet vóór de starttijd');
    const prev = S.teams.slice(0, i).reverse().find((y) => y.status !== 'out');
    const gap = S.settings.maxSpeelMin + S.settings.wrapMin;
    if (P.isFuture(t) && prev && P.hmMin(t.start) != null && P.hmMin(prev.start) != null && P.hmMin(t.start) - P.hmMin(prev.start) < gap) w.push(`start minder dan ${gap} min na ${esc(prev.name)} (speel- plus afrondtijd)`);
    return w.map((x) => `<span class="wn">⚠ ${x}</span>`).join('');
  }

  function regie() {
    const a = team(S.activeTeamId);
    const next = S.teams.find(P.isFuture);
    const later = next ? S.teams.slice(S.teams.indexOf(next) + 1).filter(P.isFuture).slice(0, 3) : [];
    const outs = S.teams.filter((t) => t.status === 'out');
    const locked = S.day.phase === 'locked';
    const liveControls = a ? (a.status === 'run'
      ? `<div class="btns co"><button class="btn" data-a="rescued" data-tid="${a.id}" ${a.rescued_at ? 'disabled' : ''}>${a.rescued_at ? '✓ ' + (a.victims > 1 ? 'Alle slachtoffers gered ' : 'Slachtoffer gered ') + fmtMs(a.rescued_at - a.started_at) : a.victims > 1 ? `Slachtoffer gered (${a.rescued_n + 1} van ${a.victims})` : 'Slachtoffer gered'}</button>${a.rescued_n ? `<button class="btn sm" data-a="unrescue" data-tid="${a.id}" title="Laatste redding ongedaan maken">↶ Ongedaan</button>` : ''}<button class="btn dng" data-a="end" data-tid="${a.id}">■ Einde inzet</button><button class="btn" data-a="abort" data-tid="${a.id}">⚠ Afbreken</button></div>`
      : `<div class="btns co"><button class="btn" data-a="lock" data-tid="${a.id}">🔒 Beoordeling nu vergrendelen</button><button class="btn" data-a="abort" data-tid="${a.id}">⚠ Afbreken</button></div>`) : '';
    const nextControls = next ? `<div class="btns co" style="margin-top:10px">
      <button class="btn sm" data-a="gemeld" data-tid="${next.id}" data-on="${next.gemeld_at ? 0 : 1}">${next.gemeld_at ? '✓ Aanwezig' : 'Markeer aanwezig'}</button>
      <button class="btn sm" data-a="ready" data-tid="${next.id}" data-on="${next.ready_at ? 0 : 1}">${next.ready_at ? '✓ Ready' : '⚡ Markeer ready'}</button>
      <button class="btn pri" data-a="start" data-tid="${next.id}" ${a || locked ? 'disabled' : ''}>▶ Start inzet</button></div>
      ${a ? `<p class="hint co" style="margin:6px 0 0">Starten kan pas als ${esc(a.name)} klaar is, inclusief afrondtijd van de waarnemers.</p>` : ''}` : '';
    const prog = S.roles.map((r) => {
      const o = S.observers.find((x) => x.role_id === r.id && x.status === 'linked');
      const total = nItems(r.id);
      if (!o) return { role: r.name, done: 0, total, warn: true, note: '<span style="color:var(--bad)">niet gekoppeld</span>' };
      const p = o.progress;
      return { role: r.name, done: p ? p.done : 0, total: p ? p.total : total, finished: p && p.finished, warn: !o.online,
        note: `${esc(o.name)} · ${o.online ? 'online' : 'offline'}${p && p.notesMissing ? ` · ${p.notesMissing} toelichting ontbreekt` : ''}${p && p.finished ? ' · afgerond' : ''}` };
    });
    const doneN = S.teams.filter((t) => t.status === 'done').length, runN = a ? 1 : 0, goN = S.teams.filter(P.isFuture).length;
    const view = S.teams.map((t) => (t.status === 'done' ? t : { ...t, total: null, rank: null }));
    const pend = S.observers.filter((o) => o.status === 'pending');
    const roleOpts = (o) => [['', '— kies functie —'], ...S.roles.map((r) => [r.id, r.name]), ['C', 'Coördinator (aanwezig)'], ['B', 'Baanleider (inzet)']]
      .map(([v, l]) => `<option value="${v}" ${(o.staff === 'coordinator' ? 'C' : o.staff === 'baanleider' ? 'B' : o.role_id || '') == v ? 'selected' : ''}>${esc(l)}</option>`).join('');
    const obsRow = (o) => `<div class="wm ${o.status === 'pending' ? 'pend' : ''}"><div><b><i class="dot ${o.online ? '' : 'm'}" style="margin-right:6px"></i>${esc(o.name)}</b><small>${o.status === 'pending' ? 'wacht op koppeling' : o.online ? 'online' : 'offline'}</small></div>
      <div class="row" style="flex-wrap:nowrap"><select data-link="${o.id}" style="width:160px" aria-label="Functie van ${esc(o.name)}">${roleOpts(o)}</select><button class="btn sm" data-rej="${o.id}" title="Weigeren of verwijderen" aria-label="Weigeren">✕</button></div></div>`;
    return `<div class="grid">
     <section class="p c12"><h2><span>Dagplanning</span><span class="mono mut">speeltijd + ${S.settings.wrapMin} min afrondtijd per post</span></h2>${P.timeline(S.teams, S.settings)}</section>
     <section class="p c8"><h2><span>Live inzet</span><span class="mono mut">${a ? 'POST ' + (S.teams.indexOf(a) + 1) + ' VAN ' + S.teams.length : ''}</span></h2>${P.liveHTML(a, S.settings, liveControls)}
      <div style="margin-top:14px"><h2 style="margin-bottom:8px"><span>Voortgang waarnemers</span><span class="mono mut">${a ? esc(a.name) : 'geen inzet actief'}</span></h2>${P.progressCards(prog)}</div></section>
     <section class="p c4"><h2><span>Volgende ploeg</span><span class="mono mut">${next ? 'POST ' + (S.teams.indexOf(next) + 1) : ''}</span></h2>${P.nextHTML(next, later, outs, nextControls)}</section>
     <section class="p c8 plan"><h2><span>Planning en tussenstand</span><span style="display:flex;gap:12px;align-items:center"><span class="mono mut">${doneN} GESPEELD · ${runN} LOPEND · ${goN} TE GAAN${outs.length ? ' · ' + outs.length + ' VERVALLEN' : ''}</span><button class="btn sm co ${edit ? 'edit-on' : ''}" data-edit>${edit ? '✓ Klaar met bewerken' : '✎ Planning bewerken'}</button></span></h2>
      ${edit ? `<div class="edtools co"><b>Planningsmodus</b> Verschuif alle ploegen die nog niet gestart zijn: <button class="btn sm" data-shift="-5">−5</button><button class="btn sm" data-shift="5">+5</button><button class="btn sm" data-shift="10">+10</button><button class="btn sm" data-shift="15">+15 min</button>
       <span class="mut">Gespeelde en lopende ploegen zijn vergrendeld. Elke wijziging staat in het logboek.</span></div>` : ''}
      <div class="scroll"><table>${P.planningHead(edit)}<tbody>${P.planningRows(view, { edit, showScores: true, warn: warnFor })}</tbody></table></div>
      ${S.teams.some((t) => t.status === 'done') ? '<p class="hint">Gelijke stand: de minste speeltijd wint. Klik op het tabblad Scorebladen voor details en correcties.</p>' : ''}</section>
     <div class="c4 stack co">
      <section class="p"><h2><span>Waarnemers</span><span class="mono mut">${S.observers.filter((o) => o.status === 'linked').length} GEKOPPELD</span></h2>
       ${pend.length ? `<div class="warn" style="margin-bottom:6px">${pend.length} aanmelding(en) wachten op koppeling.</div>` : ''}
       ${S.observers.length ? [...S.observers].sort((x, y) => (x.status === 'pending' ? 0 : 1) - (y.status === 'pending' ? 0 : 1)).map(obsRow).join('') : '<p class="mut">Nog niemand aangemeld. Deel de code of QR-code.</p>'}
       <div class="row" style="margin-top:10px;align-items:center"><div class="code" style="font-size:30px">${esc(S.day.join_code)}</div><a class="btn sm" href="/console-qr" data-qr>QR tonen</a></div></section>
      <section class="p"><h2><span>Logboek</span><span class="mono mut">LIVE</span></h2><ul class="feed">${S.events.map((e) => `<li><time>${clockOf(e.at)}</time><span><span class="tag ${esc(e.tone)}">${esc(e.kind)}</span>${esc(e.text)}</span></li>`).join('') || '<li class="mut">Nog geen gebeurtenissen</li>'}</ul></section>
     </div></div>`;
  }

  /* ---------- scorebladen ---------- */
  async function drawSheet() {
    const box = $('#sheetbox', root);
    if (!box) return;
    if (!sheetTeam || !team(sheetTeam)) sheetTeam = (S.teams.find((t) => t.status === 'done') || S.teams[0] || {}).id;
    if (!sheetTeam) { box.innerHTML = '<p class="ink2">Er zijn nog geen ploegen.</p>'; return; }
    try { sheet = await api('GET', `/teams/${sheetTeam}/sheet`); } catch (e) { box.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
    const t = sheet.team, roles = sheet.roles;
    const sum = (r) => sheet.roleSum[r.id] || 0;
    const rows = sheet.categories.map((c) => {
      const items = c.items.filter((i) => i.roles.some((r) => roles.some((x) => x.id === r)));
      if (!items.length) return '';
      return `<tr class="cat"><td colspan="${roles.length + 2}"><b>${esc(c.name)}</b></td></tr>` + items.map((i) => {
        let tot = 0;
        const cells = roles.map((r) => {
          if (!i.roles.includes(r.id)) return '<td class="na"></td>';
          const e = sheet.cells[`${i.id}|${r.id}`];
          const was = sheet.corrections.some((k) => k.criterion_id === i.id && k.role_id === r.id);
          if (e) tot += e.value || 0;
          return `<td class="v ${e && e.value <= sheet.settings.noteBelow ? 'low' : ''}"><button class="cell ${was ? 'corr' : ''}" data-fix data-c="${i.id}" data-r="${r.id}" data-v="${e ? e.value : ''}" ${e && e.note ? `data-tip="${esc(e.note)}"` : 'data-tip="Klik om te corrigeren"'} aria-label="Corrigeer ${esc(i.name)} voor ${esc(r.name)}">${e ? e.value : '?'}${e && e.note ? '*' : ''}${was ? ' ✎' : ''}</button></td>`;
        }).join('');
        return `<tr><td>${esc(i.name)}</td>${cells}<td class="n mono">${tot}</td></tr>`;
      }).join('');
    }).join('');
    box.innerHTML = `<div class="row sp"><h2 style="margin:0"><span>Scoreblad</span></h2><div class="row">
      <select id="sheetSel" style="width:auto">${S.teams.map((x) => `<option value="${x.id}" ${x.id === sheetTeam ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
      <a class="btn sm" href="/report/${dayId}/${t.id}" target="_blank" rel="noopener">Rapport</a></div></div>
     <div class="meta" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr))"><div class="kv"><small>Status</small><b style="font-size:16px">${P.LAB[t.status]}</b></div><div class="kv"><small>Plek</small><b>${t.rank || '–'}</b></div>
      <div class="kv"><small>Criteria</small><b>${t.crit}</b></div><div class="kv"><small>Bonus redtijd</small><b class="g">+${fmtN(t.red)}</b></div><div class="kv"><small>Bonus speeltijd</small><b class="g">+${fmtN(t.sp)}</b></div><div class="kv"><small>Totaal</small><b class="c">${fmtN(t.total)}</b></div></div>
     <div class="row" style="margin-bottom:10px"><span class="mut">Speeltijd <b class="mono" style="color:var(--ink)">${fmtMs(t.speelMs)}</b> · redtijd <b class="mono" style="color:var(--ink)">${fmtMs(t.redMs)}</b></span>
      <button class="btn sm" data-fixtime ${t.started_at ? '' : 'disabled'}>Tijd corrigeren</button></div>
     <div class="scroll sheet"><table><thead><tr><th>Criterium</th>${roles.map((r) => `<th class="c">${esc(r.name)}${t.finishedRoles.includes(r.id) ? ' 🔒' : ''}</th>`).join('')}<th class="n">Totaal</th></tr></thead><tbody>${rows}
      <tr style="font-weight:700"><td>Totaal per functie</td>${roles.map((r) => `<td class="c mono">${sum(r)}</td>`).join('')}<td class="n mono">${t.crit}</td></tr></tbody></table></div>
     <p class="hint">* = met toelichting (beweeg erover) · ✎ = gecorrigeerd · klik op een score om te corrigeren (toelichting verplicht).</p>
     ${t.finishedRoles.length ? `<div class="row" style="margin-top:8px"><span class="mut">Afgeronde beoordelingen ontgrendelen:</span>${t.finishedRoles.map((rid) => `<button class="btn sm" data-unlock="${rid}">${esc((roles.find((r) => r.id === rid) || {}).name || '')}</button>`).join('')}</div>` : ''}
     ${sheet.corrections.length ? `<h3>Correcties</h3><table><tbody>${sheet.corrections.map((k) => `<tr><td class="mono mut">${clockOf(k.at)}</td><td>${esc(k.role || '')} · ${esc(k.criterion || '')}</td><td class="mono">${k.old_value ?? '–'} → ${k.new_value}</td><td>“${esc(k.reason)}” · ${esc(k.user || '')}</td></tr>`).join('')}</tbody></table>` : ''}`;
  }

  /* ---------- prijsuitreiking ---------- */
  function prijs() {
    const ranked = S.teams.filter((t) => t.status === 'done').sort((a, b) => a.rank - b.rank);
    const n = ranked.length, rev = S.day.reveal, on = S.day.ceremony;
    return `<section class="p"><h2><span>Prijsuitreiking</span><span class="mono mut">${n} GEKLASSEERD</span></h2>
      ${n === 0 ? '<p class="ink2">Er zijn nog geen afgeronde ploegen om uit te reiken.</p>' : ''}
      ${S.teams.some((t) => ['run', 'wrap', 'plan', 'ready'].includes(t.status)) ? '<div class="warn">Niet alle ploegen zijn al gespeeld. Start de prijsuitreiking pas als de uitslag definitief is.</div>' : ''}
      <div class="row">${on ? `<button class="btn" data-cer="prev" ${rev ? '' : 'disabled'}>◀ Terug</button><button class="btn pri" data-cer="next" ${rev >= n ? 'disabled' : ''}>Onthul plaats ${rev >= n ? '' : n - rev} ▶</button><button class="btn" data-cer="all" ${rev >= n ? 'disabled' : ''}>Alles tonen</button><button class="btn" data-cer="reset" ${rev ? '' : 'disabled'}>Opnieuw</button><button class="btn dng" data-cer="stop">Stoppen</button>`
        : `<button class="btn pri" data-cer="start" ${n ? '' : 'disabled'}>Prijsuitreiking starten</button>`}
       <a class="btn sm" href="/display/${esc(S.day.display_key)}" target="_blank" rel="noopener">Groot scherm openen</a></div>
      <p class="hint">${on ? 'Het groot scherm toont nu de prijsuitreiking. Toets: spatie of pijl-rechts voor de volgende plaats.' : 'Zodra je start, schakelt het groot scherm over naar de prijsuitreiking en blijven alle scores verborgen tot ze onthuld zijn.'}</p></section>
     <section class="p" style="margin-top:14px"><h2><span>Voorbeeld voor de jury</span><span class="mono mut">${on ? rev + ' VAN ' + n + ' ONTHULD' : ''}</span></h2><div class="board">${ranked.slice().reverse().map((t) => {
        const shown = on && t.rank > n - rev;
        return `<div class="r ${t.rank === 1 ? 'first' : ''}"><span class="p1">${t.rank}</span><span>${esc(t.name)}<small>criteria ${t.crit} · redtijd +${fmtN(t.red)} · speeltijd +${fmtN(t.sp)} · ${fmtMs(t.speelMs)}</small></span><span><b>${fmtN(t.total)}</b> <small>${on ? (shown ? 'onthuld' : 'nog verborgen') : ''}</small></span></div>`;
      }).join('') || '<div class="r"><span></span><span class="mut">Nog geen uitslag</span><span></span></div>'}</div></section>`;
  }

  /* ---------- dag ---------- */
  function dag() {
    const done = S.teams.filter((t) => t.status === 'done');
    return `<div class="grid"><section class="p c6"><h2><span>Waarnemers aanmelden</span></h2><div class="code">${esc(S.day.join_code)}</div>
      <div style="margin:12px 0"><span class="qr"><img src="/api/days/${dayId}/qr.svg?v=${esc(S.day.join_code)}" alt="QR-code om aan te melden"></span></div>
      <p class="hint">Waarnemers scannen de QR-code of gaan naar ${esc(location.host)}/join en vullen de code in.</p></section>
     <section class="p c6"><h2><span>Uitslag</span></h2>
      <p class="ink2" style="margin-top:0">${S.day.phase === 'locked' ? 'De uitslag is vergrendeld: waarnemers kunnen niets meer invoeren.' : 'Vergrendel de uitslag als alle beoordelingen binnen zijn. Daarna accepteert de server geen scores meer, ook geen offline wachtrij.'}</p>
      <div class="row">${S.day.phase === 'locked' ? '<button class="btn" data-phase="active">Uitslag ontgrendelen</button>' : '<button class="btn pri" data-phase="locked">🔒 Uitslag vergrendelen</button>'}<a class="btn" href="/api/days/${dayId}/export.csv">Exporteren (CSV)</a></div>
      <h3>Rapporten per ploeg</h3>${done.length ? done.map((t) => `<div class="row" style="margin-bottom:4px"><a href="/report/${dayId}/${t.id}" target="_blank" rel="noopener">${t.rank}. ${esc(t.name)}</a></div>`).join('') : '<p class="mut">Nog geen afgeronde ploegen.</p>'}</section></div>`;
  }

  /* ---------- live-tikken ---------- */
  let wrapFetched = false;
  function tickAll() {
    const now = snow();
    const c = $('[data-clock]', root);
    if (c) c.firstChild.nodeValue = clockSec(now);
    const a = team(S.activeTeamId);
    if (tab === 'regie') {
      P.tickTimeline(root, now); P.tickLive(root, a, S.settings, now); P.tickNext(root, now);
      const lt = $('[data-live-time]', root);
      if (lt && a) lt.textContent = fmtMs(now - a.started_at);
    }
    if (a && a.status === 'wrap' && a.wrap_end && now > a.wrap_end + 400 && !wrapFetched) { wrapFetched = true; refresh(); }
    if (!a || a.status !== 'wrap') wrapFetched = false;
  }

  /* ---------- gebeurtenissen ---------- */
  const post = (url, body = {}) => api('POST', url, body);
  const teamAction = async (id, action, extra = {}) => { await post(`/teams/${id}/action`, { action, ...extra }); await refresh(); };

  root.addEventListener('click', act(async (e) => {
    const t = e.target.closest('button,a,label');
    if (!t) return;
    if (t.dataset.tab) { tab = t.dataset.tab; history.replaceState(null, '', `/day/${dayId}/${tab === 'regie' ? '' : tab}`); draw(); return; }
    if (t.dataset.mode) { tv = t.dataset.mode === 'tv'; draw(); return; }
    if (t.dataset.sw !== undefined) { await post(`/days/${dayId}/show-scores`, { on: !S.day.show_scores }); await refresh(); return; }
    if (t.dataset.edit !== undefined) { edit = !edit; draw(); return; }
    if (t.dataset.shift) { await post(`/days/${dayId}/shift`, { minutes: +t.dataset.shift }); await refresh(); return; }
    if (t.dataset.qr !== undefined) { e.preventDefault(); tab = 'dag'; draw(); return; }
    if (t.dataset.rej) {
      if (!(await confirmBox('Waarnemer weigeren', 'Deze waarnemer kan daarna niet meer meedoen. Hij of zij kan zich opnieuw aanmelden.', 'Weigeren', true))) return;
      await post(`/observers/${t.dataset.rej}/reject`); await refresh(); return;
    }
    if (t.dataset.phase) {
      if (t.dataset.phase === 'locked' && !(await confirmBox('Uitslag vergrendelen', 'Waarnemers kunnen daarna niets meer invoeren. Je kunt het later weer ontgrendelen.', 'Vergrendelen'))) return;
      await post(`/days/${dayId}/phase`, { phase: t.dataset.phase }); await refresh(); return;
    }
    if (t.dataset.cer) { await post(`/days/${dayId}/ceremony`, { action: t.dataset.cer }); await refresh(); return; }
    if (t.dataset.fix !== undefined) {
      const v = await ask({ title: 'Score corrigeren', text: 'Een correctie vraagt altijd om een toelichting en komt in het logboek.', fields: [
        { name: 'value', label: 'Nieuwe score', type: 'select', value: t.dataset.v || 8, options: Object.entries(sheet.labels).sort((a, b) => b[0] - a[0]).map(([n, l]) => [n, `${n} · ${l}`]) },
        { name: 'reason', label: 'Toelichting (verplicht)', type: 'textarea', required: true, minLength: 3 }] });
      if (!v) return;
      await post(`/teams/${sheetTeam}/correct`, { criterion_id: +t.dataset.c, role_id: +t.dataset.r, value: +v.value, reason: v.reason }); toast('Correctie opgeslagen', 'ok'); await refresh(); return;
    }
    if (t.dataset.fixtime !== undefined) {
      const tm = sheet.team;
      const v = await ask({ title: 'Tijd corrigeren', text: 'Vul tijden in als mm:ss. Laat de redtijd leeg als het slachtoffer niet gered is.', fields: [
        { name: 'speel', label: 'Speeltijd (mm:ss)', value: tm.speelMs != null ? fmtMs(tm.speelMs) : '' },
        { name: 'red', label: 'Redtijd (mm:ss)', value: tm.redMs != null ? fmtMs(tm.redMs) : '' },
        { name: 'reason', label: 'Toelichting (verplicht)', type: 'textarea', required: true, minLength: 3 }] });
      if (!v) return;
      const sp = parseMs(v.speel), rd = parseMs(v.red);
      if (Number.isNaN(sp) || Number.isNaN(rd)) return toast('Gebruik mm:ss', 'bad');
      await post(`/teams/${sheetTeam}/correct-time`, { speel_s: sp == null ? undefined : sp / 1000, red_s: rd == null ? null : rd / 1000, reason: v.reason }); await refresh(); return;
    }
    if (t.dataset.unlock) {
      const v = await ask({ title: 'Beoordeling ontgrendelen', text: 'De waarnemer kan daarna weer scores aanpassen zolang het beoordelingsvenster open is.', fields: [{ name: 'reason', label: 'Toelichting (verplicht)', required: true, minLength: 3 }] });
      if (!v) return;
      await post(`/teams/${sheetTeam}/unlock-role`, { role_id: +t.dataset.unlock, reason: v.reason }); await refresh(); return;
    }
    const a = t.dataset.a;
    if (!a) return;
    const id = t.dataset.tid;
    const tm = team(id);
    if (a === 'up' || a === 'down') {
      const i = S.teams.indexOf(tm), j = i + (a === 'up' ? -1 : 1);
      await post(`/days/${dayId}/swap`, { a: tm.id, b: S.teams[j].id }); await refresh(); return;
    }
    if (a === 'out') {
      const v = await ask({ title: `${tm.name} laten vervallen`, text: 'De ploeg wordt uit de planning gehaald. Je kunt dit later ongedaan maken.', ok: 'Laten vervallen', danger: true, fields: [{ name: 'reason', label: 'Reden (verplicht)', required: true, minLength: 3 }] });
      if (!v) return;
      return teamAction(id, 'out', { reason: v.reason });
    }
    if (a === 'abort') {
      const v = await ask({ title: `Inzet ${tm.name} afbreken`, text: 'Tijden en alle scores van deze ploeg worden gewist. De ploeg komt weer klaar te staan om opnieuw te starten.', ok: 'Afbreken', danger: true, fields: [{ name: 'reason', label: 'Reden (verplicht)', required: true, minLength: 3 }] });
      if (!v) return;
      return teamAction(id, 'abort', { reason: v.reason });
    }
    if (a === 'end' && !(await confirmBox('Einde inzet', `De speeltijd stopt nu en de waarnemers krijgen ${S.settings.wrapMin} minuten om af te ronden.`, 'Einde inzet', true))) return;
    if (a === 'start' && !(await confirmBox(`Start ${tm.name}`, 'De klok loopt direct en de beoordeling opent voor alle waarnemers.', 'Start inzet'))) return;
    if (a === 'lock' && !(await confirmBox('Beoordeling vergrendelen', 'Waarnemers kunnen daarna niets meer wijzigen.', 'Vergrendelen'))) return;
    await teamAction(id, a, t.dataset.on !== undefined ? { on: t.dataset.on === '1' } : {});
  }));

  root.addEventListener('keydown', (e) => { if (e.target.dataset && e.target.dataset.sw !== undefined && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); e.target.click(); } });
  root.addEventListener('change', act(async (e) => {
    const el = e.target;
    if (el.dataset.link) {
      const v = el.value;
      try { await post(`/observers/${el.dataset.link}/link`, { role_id: ['', 'C', 'B'].includes(v) ? null : +v, staff: v === 'C' ? 'coordinator' : v === 'B' ? 'baanleider' : null }); } catch (err) { fail(err); }
      await refresh(); return;
    }
    if (el.id === 'sheetSel') { sheetTeam = +el.value; drawSheet(); return; }
    if (el.dataset.tid && el.dataset.f) {
      const m = /^(\d{1,2}):?(\d{2})$/.exec(el.value.trim().replace('.', ':'));
      if (!m || +m[1] > 23 || +m[2] > 59) { el.classList.add('bad'); el.title = 'Gebruik uu:mm'; return; }
      try { await api('PATCH', `/teams/${el.dataset.tid}`, { [el.dataset.f]: `${m[1].padStart(2, '0')}:${m[2]}` }); } catch (err) { fail(err); }
      await refresh();
    }
  }));
  const onKey = (e) => {
    if (tab !== 'prijs' || !S.day.ceremony || typing(root)) return;
    if (e.key === ' ' || e.key === 'ArrowRight') { e.preventDefault(); post(`/days/${dayId}/ceremony`, { action: 'next' }).then(refresh).catch(fail); }
    if (e.key === 'ArrowLeft') post(`/days/${dayId}/ceremony`, { action: 'prev' }).then(refresh).catch(fail);
  };
  document.addEventListener('keydown', onKey);

  /* ---------- realtime ---------- */
  let timer;
  const onChange = () => { clearTimeout(timer); timer = setTimeout(() => { if (typing(root)) return; refresh(); }, 120); };
  const closeSse = sse(`/api/days/${dayId}/stream`, onChange, (ok) => { if (ok !== online) { online = ok; const chip = $('.chip.co', root); if (chip) draw(); } });
  const tick = setInterval(tickAll, 250);
  const poll = setInterval(() => { if (!typing(root)) refresh(); }, 15000);

  draw();
  return () => { closeSse(); clearInterval(tick); clearInterval(poll); clearTimeout(timer); document.removeEventListener('keydown', onKey); };
}
void f1;
