import { $, $$, api, ask, confirmBox, esc, fail, toast } from '../lib.js';
import { go, header, requireLogin, wireLogout } from '../router.js';

/* Beheer van één wedstrijddag: algemeen, ploegen, juryleden, criteria en toegang voor waarnemers. */
export async function setupView(root, [dayId]) {
  const me = await requireLogin();
  if (!me) return;
  if (me.role !== 'admin') { go(`/day/${dayId}`, true); return; }
  let cfg = await api('GET', `/days/${dayId}/config`);
  let tab = sessionStorage.getItem('vt_setup_tab') || 'algemeen';
  const started = () => cfg.teams.some((t) => t.started);
  const reload = async () => { cfg = await api('GET', `/days/${dayId}/config`); draw(); };
  const act = (fn) => async (...a) => { try { await fn(...a); } catch (e) { fail(e); } };

  const tabs = [['algemeen', 'Algemeen'], ['ploegen', 'Ploegen'], ['jury', 'Juryleden'], ['criteria', 'Criteria'], ['toegang', 'Toegang']];

  function draw() {
    const body = { algemeen, ploegen, jury, criteria, toegang }[tab]();
    root.innerHTML = `${header(me, `<a class="btn sm pri" href="/day/${dayId}" data-link>Naar de console</a>`)}
     <div style="max-width:1000px;margin:0 auto"><h1 style="font-size:22px;margin:0 0 4px">${esc(cfg.day.title)}</h1><p class="hint" style="margin-top:0">${esc(cfg.day.date || '')} ${esc(cfg.day.place || '')}</p>
     <nav class="tabs">${tabs.map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</nav>${body}</div>`;
    wireLogout(root);
    $$('[data-tab]', root).forEach((b) => (b.onclick = () => { tab = b.dataset.tab; sessionStorage.setItem('vt_setup_tab', tab); draw(); }));
    wire[tab] && wire[tab]();
  }

  /* ----- algemeen ----- */
  const algemeen = () => {
    const s = cfg.settings;
    return `<section class="p"><h2><span>Wedstrijddag</span></h2><form id="gf"><div class="fg">
      <label class="f">Naam<input name="title" value="${esc(cfg.day.title)}" required></label><label class="f">Datum<input name="date" type="date" value="${esc(cfg.day.date || '')}"></label>
      <label class="f">Organiserende post<input name="place" value="${esc(cfg.day.place || '')}"></label><label class="f">Wisselbeker<input name="trophy" value="${esc(cfg.day.trophy || '')}"></label></div>
      <h3>Tijd en bonuspunten</h3><div class="fg">
      <label class="f">Maximale speeltijd (min)<input name="maxSpeelMin" type="number" min="1" step="0.5" value="${s.maxSpeelMin}"></label>
      <label class="f">Maximale redtijd (min)<input name="maxRedMin" type="number" min="1" step="0.5" value="${s.maxRedMin}"></label>
      <label class="f">Punten per resterende minuut<input name="bonusPerMin" type="number" min="0" step="0.5" value="${s.bonusPerMin}"></label>
      <label class="f">Afronding resterende tijd<select name="rounding"><option value="floor" ${s.rounding === 'floor' ? 'selected' : ''}>Hele minuten (naar beneden)</option><option value="round" ${s.rounding === 'round' ? 'selected' : ''}>Hele minuten (afronden)</option><option value="exact" ${s.rounding === 'exact' ? 'selected' : ''}>Exact (2 decimalen)</option></select></label>
      <label class="f">Aantal slachtoffers<input name="victims" type="number" min="1" max="10" value="${s.victims || 1}" ${started() ? 'disabled' : ''}></label>
      <label class="f">Afrondtijd waarnemers (min)<input name="wrapMin" type="number" min="0" max="60" value="${s.wrapMin}"></label>
      <label class="f">Toelichting verplicht bij score t/m<input name="noteBelow" type="number" min="0" max="10" value="${s.noteBelow}"></label></div>
      <p class="hint">Meerdere slachtoffers: de redtijd wordt <b>per slachtoffer</b> vastgelegd en elk slachtoffer levert een eigen bonus op (resterende minuten van de maximale redtijd). Het aantal staat vast zodra de eerste inzet start. Bonus = resterende minuten × punten per minuut, nooit lager dan 0. Bij gelijke stand wint de minste speeltijd. Een volgende inzet kan pas starten als de afrondtijd van de vorige voorbij is.</p>
      <button class="btn pri">Opslaan</button></form></section>
     <section class="p" style="margin-top:14px"><h2><span>Gevaarlijke zone</span></h2><button class="btn dng" id="del">Wedstrijddag verwijderen</button><p class="hint">Verwijdert ook alle ploegen, scores en aanmeldingen. Dit kan niet ongedaan gemaakt worden.</p></section>`;
  };

  /* ----- ploegen ----- */
  const ploegen = () => `<section class="p"><h2><span>Ploegen (${cfg.teams.length}/10)</span></h2>
    <p class="hint" style="margin-top:0">De volgorde is de speelvolgorde. Meld- en starttijd als uu:mm. Tijden zijn later ook in de console aan te passen.</p>
    <table><thead><tr><th>#</th><th>Naam</th><th>Meldtijd</th><th>Starttijd</th><th></th></tr></thead><tbody>${cfg.teams.map((t, i) => `<tr>
      <td class="mono mut">${i + 1}</td><td><input data-t="${t.id}" data-f="name" value="${esc(t.name)}" aria-label="Naam"></td>
      <td><input class="tm" data-t="${t.id}" data-f="meld" value="${esc(t.meld)}" ${t.started ? 'disabled' : ''} aria-label="Meldtijd"></td>
      <td><input class="tm" data-t="${t.id}" data-f="start" value="${esc(t.start)}" ${t.started ? 'disabled' : ''} aria-label="Starttijd"></td>
      <td class="n" style="white-space:nowrap"><button class="btn sm" data-up="${t.id}" ${i === 0 || t.started || cfg.teams[i - 1].started ? 'disabled' : ''} aria-label="Eerder">↑</button> <button class="btn sm" data-down="${t.id}" ${i === cfg.teams.length - 1 || t.started || cfg.teams[i + 1].started ? 'disabled' : ''} aria-label="Later">↓</button> <button class="btn sm dng" data-del="${t.id}" ${t.started ? 'disabled' : ''} aria-label="Verwijder">✕</button></td></tr>`).join('')}</tbody></table>
    ${cfg.teams.length < 10 ? `<form id="tf" class="row" style="margin-top:12px"><input name="name" placeholder="Naam van de post" required style="max-width:260px"><input class="tm" name="meld" placeholder="meld" maxlength="5"><input class="tm" name="start" placeholder="start" maxlength="5"><button class="btn pri">+ Ploeg toevoegen</button></form>` : '<p class="hint">Het maximum van 10 ploegen is bereikt.</p>'}</section>`;

  /* ----- juryleden ----- */
  const jury = () => `<section class="p"><h2><span>Juryleden van deze dag</span></h2>
    ${cfg.jury.length ? `<table><tbody>${cfg.jury.map((u) => `<tr><td><b>${esc(u.name || '')}</b><div class="hint">${esc(u.email)}</div></td><td class="n"><button class="btn sm" data-pw="${u.id}" data-mail="${esc(u.email)}">Wachtwoord instellen</button> <button class="btn sm dng" data-rm="${u.id}">Verwijderen</button></td></tr>`).join('')}</tbody></table>` : '<p class="ink2">Nog geen juryleden gekoppeld.</p>'}
    <h3>Jurylid toevoegen</h3><form id="jf" class="fg"><label class="f">Naam<input name="name"></label><label class="f">E-mailadres<input name="email" type="email" required></label>
     <label class="f">Wachtwoord (min. 8 tekens)<input name="password" type="text" autocomplete="off"></label><div style="align-self:end"><button class="btn pri">Toevoegen</button></div></form>
    <p class="hint">Heeft iemand al een account (van een andere wedstrijddag), laat het wachtwoord dan leeg. Juryleden kunnen tegelijk in de console werken.</p></section>`;

  /* ----- criteria ----- */
  const criteria = () => `${started() ? '<div class="warn">De wedstrijd is begonnen: de opzet van functies en criteria is vergrendeld. Je kunt namen nog wel aanpassen.</div>' : ''}
    <section class="p"><h2><span>Functies (partijen)</span></h2>${cfg.roles.map((r) => `<div class="row" style="margin-bottom:6px"><input data-role="${r.id}" value="${esc(r.name)}" style="max-width:300px" aria-label="Functie"><button class="btn sm dng" data-delrole="${r.id}" ${started() ? 'disabled' : ''}>✕</button></div>`).join('')}
     <button class="btn sm" id="addrole" ${started() ? 'disabled' : ''}>+ functie</button><p class="hint">Elke functie krijgt één eigen waarnemer. Het ploegtotaal is de som van alle functies.</p></section>
    <section class="p" style="margin-top:14px"><h2><span>Beoordelingscriteria</span></h2>
    <p class="hint" style="margin-top:0">Vink aan voor welke functies een criterium geldt. Scores lopen van 4 t/m 10.</p>
    <div class="scroll"><table class="matrix"><thead><tr><th>Criterium</th>${cfg.roles.map((r) => `<th class="c">${esc(r.name)}</th>`).join('')}<th></th></tr></thead><tbody>
    ${cfg.categories.map((c) => `<tr class="cat"><td colspan="${cfg.roles.length + 2}"><div class="row"><input data-cat="${c.id}" data-f="name" value="${esc(c.name)}" style="flex:2;min-width:180px" aria-label="Categorie"><input data-cat="${c.id}" data-f="short" value="${esc(c.short || '')}" placeholder="korte naam" style="flex:1;min-width:110px" aria-label="Korte naam"><button class="btn sm dng" data-delcat="${c.id}" ${started() ? 'disabled' : ''}>Categorie verwijderen</button></div></td></tr>` +
      c.items.map((i) => `<tr><td><input data-crit="${i.id}" value="${esc(i.name)}" aria-label="Criterium"></td>${cfg.roles.map((r) => `<td class="c"><input type="checkbox" data-cr="${i.id}:${r.id}" ${i.roles.includes(r.id) ? 'checked' : ''} ${started() ? 'disabled' : ''} aria-label="${esc(i.name)} voor ${esc(r.name)}"></td>`).join('')}<td><button class="btn sm dng" data-delcrit="${i.id}" ${started() ? 'disabled' : ''}>✕</button></td></tr>`).join('') +
      `<tr><td colspan="${cfg.roles.length + 2}"><button class="btn sm" data-addcrit="${c.id}" ${started() ? 'disabled' : ''}>+ criterium</button></td></tr>`).join('')}
    </tbody></table></div><div style="margin-top:12px"><button class="btn sm" id="addcat" ${started() ? 'disabled' : ''}>+ categorie</button></div></section>`;

  /* ----- toegang ----- */
  const toegang = () => `<div class="grid"><section class="p c6"><h2><span>Waarnemers aanmelden</span></h2>
     <p class="ink2" style="margin-top:0">Waarnemers, de coördinator (aanwezigheid op de basislocatie) en de baanleider (inzet bedienen) gaan op hun telefoon naar <b>${esc(location.host)}/join</b> en vullen de code in, of scannen de QR-code. Daarna koppelt de jury ze aan een functie.</p>
     <div class="code" id="jc">${esc(cfg.day.join_code)}</div>
     <div style="margin:14px 0"><span class="qr"><img src="/api/days/${dayId}/qr.svg?v=${esc(cfg.day.join_code)}" alt="QR-code om aan te melden"></span></div>
     <div class="row"><button class="btn sm" id="cpj">Link kopiëren</button><button class="btn sm" id="prn">Afdrukken</button><button class="btn sm dng" id="rgn">Nieuwe code</button></div>
     <p class="hint">${esc(cfg.joinUrl)}</p></section>
    <section class="p c6"><h2><span>Groot scherm</span></h2><p class="ink2" style="margin-top:0">Open deze link op het scherm in de zaal. Er is geen login nodig; wie de link kent kan meekijken. Scores zijn alleen zichtbaar als de jury dat toestaat.</p>
     <div class="note mono" style="word-break:break-all">${esc(cfg.displayUrl)}</div>
     <div class="row"><a class="btn sm pri" href="${esc(cfg.displayUrl)}" target="_blank" rel="noopener">Openen</a><button class="btn sm" id="cpd">Link kopiëren</button><button class="btn sm dng" id="rgd">Nieuwe link</button></div></section></div>`;

  /* ----- koppelingen per tab ----- */
  const wire = {
    algemeen() {
      $('#gf', root).onsubmit = act(async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        await api('PATCH', `/days/${dayId}`, { title: f.title, date: f.date, place: f.place, trophy: f.trophy,
          settings: { maxSpeelMin: f.maxSpeelMin, maxRedMin: f.maxRedMin, bonusPerMin: f.bonusPerMin, rounding: f.rounding, wrapMin: f.wrapMin, noteBelow: f.noteBelow, victims: f.victims } });
        toast('Opgeslagen', 'ok'); await reload();
      });
      $('#del', root).onclick = act(async () => {
        const v = await ask({ title: 'Wedstrijddag verwijderen', text: `Typ <b>${esc(cfg.day.title)}</b> om te bevestigen.`, ok: 'Definitief verwijderen', danger: true, fields: [{ name: 'naam', label: 'Naam van de wedstrijddag', required: true }] });
        if (!v) return;
        if (v.naam !== cfg.day.title) return toast('De naam komt niet overeen', 'bad');
        await api('DELETE', `/days/${dayId}`); go('/days');
      });
    },
    ploegen() {
      $$('[data-t]', root).forEach((i) => (i.onchange = act(async () => {
        try { await api('PATCH', `/teams/${i.dataset.t}`, { [i.dataset.f]: i.value }); toast('Opgeslagen', 'ok'); } catch (e) { fail(e); } await reload();
      })));
      const swap = (id, d) => act(async () => {
        const i = cfg.teams.findIndex((t) => t.id === +id), j = i + d;
        await api('POST', `/days/${dayId}/swap`, { a: cfg.teams[i].id, b: cfg.teams[j].id }); await reload();
      });
      $$('[data-up]', root).forEach((b) => (b.onclick = swap(b.dataset.up, -1)));
      $$('[data-down]', root).forEach((b) => (b.onclick = swap(b.dataset.down, 1)));
      $$('[data-del]', root).forEach((b) => (b.onclick = act(async () => {
        if (!(await confirmBox('Ploeg verwijderen', 'Weet je het zeker?', 'Verwijderen', true))) return;
        await api('DELETE', `/teams/${b.dataset.del}`); await reload();
      })));
      const tf = $('#tf', root);
      if (tf) tf.onsubmit = act(async (e) => { e.preventDefault(); await api('POST', `/days/${dayId}/teams`, Object.fromEntries(new FormData(tf))); await reload(); });
    },
    jury() {
      $('#jf', root).onsubmit = act(async (e) => { e.preventDefault(); await api('POST', `/days/${dayId}/jury`, Object.fromEntries(new FormData(e.target))); toast('Jurylid opgeslagen', 'ok'); await reload(); });
      $$('[data-rm]', root).forEach((b) => (b.onclick = act(async () => {
        if (!(await confirmBox('Jurylid verwijderen', 'Dit jurylid heeft daarna geen toegang meer tot deze wedstrijddag.', 'Verwijderen', true))) return;
        await api('DELETE', `/days/${dayId}/jury/${b.dataset.rm}`); await reload();
      })));
      $$('[data-pw]', root).forEach((b) => (b.onclick = act(async () => {
        const v = await ask({ title: 'Nieuw wachtwoord', text: esc(b.dataset.mail), fields: [{ name: 'password', label: 'Wachtwoord (minimaal 8 tekens)', required: true, minLength: 8 }] });
        if (!v) return;
        await api('POST', `/days/${dayId}/jury`, { email: b.dataset.mail, password: v.password }); toast('Wachtwoord ingesteld', 'ok');
      })));
    },
    criteria() {
      const patch = (url, body) => act(async () => { await api('PATCH', url, body); });
      $$('[data-role]', root).forEach((i) => (i.onchange = act(async () => { await api('PATCH', `/roles/${i.dataset.role}`, { name: i.value }); await reload(); })));
      $$('[data-cat]', root).forEach((i) => (i.onchange = act(async () => { await api('PATCH', `/categories/${i.dataset.cat}`, { [i.dataset.f]: i.value }); await reload(); })));
      $$('[data-crit]', root).forEach((i) => (i.onchange = act(async () => { await api('PATCH', `/criteria/${i.dataset.crit}`, { name: i.value }); await reload(); })));
      $$('[data-cr]', root).forEach((i) => (i.onchange = act(async () => {
        const [cid] = i.dataset.cr.split(':');
        const roles = $$(`[data-cr^="${cid}:"]`, root).filter((x) => x.checked).map((x) => +x.dataset.cr.split(':')[1]);
        await api('PATCH', `/criteria/${cid}`, { roles }); await reload();
      })));
      const del = (path, what) => act(async (id) => {
        if (!(await confirmBox(`${what} verwijderen`, 'Weet je het zeker?', 'Verwijderen', true))) return;
        await api('DELETE', `${path}/${id}`); await reload();
      });
      $$('[data-delrole]', root).forEach((b) => (b.onclick = () => del('/roles', 'Functie')(b.dataset.delrole)));
      $$('[data-delcat]', root).forEach((b) => (b.onclick = () => del('/categories', 'Categorie')(b.dataset.delcat)));
      $$('[data-delcrit]', root).forEach((b) => (b.onclick = () => del('/criteria', 'Criterium')(b.dataset.delcrit)));
      $$('[data-addcrit]', root).forEach((b) => (b.onclick = act(async () => {
        const v = await ask({ title: 'Nieuw criterium', fields: [{ name: 'name', label: 'Omschrijving', required: true }] });
        if (!v) return;
        await api('POST', `/categories/${b.dataset.addcrit}/criteria`, { name: v.name, roles: cfg.roles.map((r) => r.id) }); await reload();
      })));
      $('#addrole', root).onclick = act(async () => {
        const v = await ask({ title: 'Nieuwe functie', fields: [{ name: 'name', label: 'Naam', required: true }] });
        if (!v) return; await api('POST', `/days/${dayId}/roles`, { name: v.name }); await reload();
      });
      $('#addcat', root).onclick = act(async () => {
        const v = await ask({ title: 'Nieuwe categorie', fields: [{ name: 'name', label: 'Naam', required: true }, { name: 'short', label: 'Korte naam (voor grafieken)' }] });
        if (!v) return; await api('POST', `/days/${dayId}/categories`, v); await reload();
      });
      void patch;
    },
    toegang() {
      const copy = (txt) => navigator.clipboard.writeText(txt).then(() => toast('Gekopieerd', 'ok'), () => toast(txt));
      $('#cpj', root).onclick = () => copy(cfg.joinUrl);
      $('#cpd', root).onclick = () => copy(cfg.displayUrl);
      $('#prn', root).onclick = () => window.print();
      $('#rgn', root).onclick = act(async () => {
        if (!(await confirmBox('Nieuwe dagcode', 'De oude code en QR-code werken daarna niet meer. Al aangemelde waarnemers blijven aangemeld.', 'Nieuwe code'))) return;
        await api('POST', `/days/${dayId}/regen`, {}); await reload();
      });
      $('#rgd', root).onclick = act(async () => {
        if (!(await confirmBox('Nieuwe schermlink', 'De oude link naar het groot scherm werkt daarna niet meer.', 'Nieuwe link'))) return;
        await api('POST', `/days/${dayId}/regen`, { which: 'display' }); await reload();
      });
    },
  };
  draw();
}
