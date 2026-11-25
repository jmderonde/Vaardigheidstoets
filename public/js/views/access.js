import { $, api, ask, confirmBox, esc, fail } from '../lib.js';
import { getMe, go, header, requireLogin, wireLogout } from '../router.js';

const OBS_KEY = 'vt_observer';
export const getObserver = () => { try { return JSON.parse(localStorage.getItem(OBS_KEY)); } catch { return null; } };
export const setObserver = (o) => { try { o ? localStorage.setItem(OBS_KEY, JSON.stringify(o)) : localStorage.removeItem(OBS_KEY); } catch { /* geen opslag */ } };

/* Startpagina: inloggen voor jury en beheer, aanmelden voor waarnemers. */
export async function loginView(root) {
  const me = await getMe(true);
  if (me) { go('/days', true); return; }
  const obs = getObserver();
  root.innerHTML = `${header(null)}
   <div class="grid" style="max-width:980px;margin:30px auto 0">
    <section class="p c6"><h2><span>Jury en beheer</span></h2>
     <form id="lf"><label class="f">E-mailadres<input name="email" type="email" autocomplete="username" required></label>
      <label class="f" style="margin-top:10px">Wachtwoord<input name="password" type="password" autocomplete="current-password" required></label>
      <div class="err" id="le" style="margin-top:8px"></div><button class="btn pri" style="margin-top:6px">Inloggen</button></form></section>
    <section class="p c6"><h2><span>Waarnemer</span></h2>
     ${obs ? `<div class="note">Je bent al aangemeld als <b>${esc(obs.name)}</b>.</div><a class="btn pri" href="/obs" data-link>Verder als ${esc(obs.name)}</a>
       <p class="hint">Een andere naam? <a href="/join" data-link>Opnieuw aanmelden</a></p>` : joinFormHTML('')}
    </section></div>`;
  $('#lf', root).onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api('POST', '/login', { email: f.get('email'), password: f.get('password') });
      await getMe(true);
      go('/days');
    } catch (err) { $('#le', root).textContent = err.message; }
  };
  wireJoin(root);
}

export const joinFormHTML = (code) => `<form id="jf"><p class="ink2" style="margin-top:0">Vul de code in van de jury, of scan de QR-code.</p>
  <label class="f">Dagcode<input name="code" value="${esc(code)}" maxlength="8" autocapitalize="characters" autocomplete="off" required style="font:700 26px var(--mono);letter-spacing:.2em;text-transform:uppercase"></label>
  <label class="f" style="margin-top:10px">Jouw naam<input name="name" maxlength="40" autocomplete="name" required></label>
  <div class="err" id="je" style="margin-top:8px"></div><button class="btn pri" style="margin-top:6px">Aanmelden</button></form>`;

function wireJoin(root) {
  const f = $('#jf', root);
  if (!f) return;
  f.onsubmit = async (e) => {
    e.preventDefault();
    const d = new FormData(f);
    try {
      const r = await api('POST', '/join', { code: d.get('code'), name: d.get('name') });
      setObserver({ token: r.token, name: r.observer.name });
      go('/obs');
    } catch (err) { $('#je', root).textContent = err.message; }
  };
}

/* /join?code=ABC123 — de pagina achter de QR-code. */
export async function joinView(root, _p, q) {
  const obs = getObserver();
  root.innerHTML = `${header(null)}<div style="max-width:460px;margin:30px auto"><section class="p"><h2><span>Aanmelden als waarnemer</span></h2>
   ${obs ? `<div class="note">Je bent op dit toestel al aangemeld als <b>${esc(obs.name)}</b>. <a href="/obs" data-link>Verder gaan</a> of meld je hieronder opnieuw aan.</div>` : ''}
   ${joinFormHTML(q.get('code') || '')}</section></div>`;
  wireJoin(root);
}

/* Overzicht van wedstrijddagen. */
export async function daysView(root) {
  const me = await requireLogin();
  if (!me) return;
  const { days } = await api('GET', '/days');
  if (me.role !== 'admin' && days.length === 1) { go(`/day/${days[0].id}`, true); return; }
  const phase = { prep: 'In voorbereiding', active: 'Bezig', locked: 'Afgesloten' };
  const draw = () => {
    root.innerHTML = `${header(me)}<div style="max-width:900px;margin:0 auto">
     ${me.role === 'admin' ? `<section class="p" style="margin-bottom:14px"><h2><span>Nieuwe wedstrijddag</span></h2>
       <form id="nf" class="fg"><label class="f">Naam<input name="title" required placeholder="Vaardigheidstoets 2026"></label><label class="f">Datum<input name="date" type="date"></label>
       <label class="f">Organiserende post<input name="place"></label><label class="f">Aantal slachtoffers<input name="victims" type="number" min="1" max="10" value="1"></label><div style="align-self:end"><button class="btn pri">Aanmaken</button></div></form></section>` : ''}
     <section class="p"><h2><span>Wedstrijddagen</span></h2>
      ${days.length ? `<table><thead><tr><th>Naam</th><th>Datum</th><th>Ploegen</th><th>Status</th><th></th></tr></thead><tbody>${days.map((d) => `<tr>
        <td><b>${esc(d.title)}</b><div class="hint">${esc(d.place || '')}</div></td><td class="mono">${esc(d.date || '–')}</td><td class="mono">${d.teams}</td><td>${phase[d.phase] || d.phase}</td>
        <td class="n"><a class="btn sm pri" href="/day/${d.id}" data-link>Console</a>${me.role === 'admin' ? ` <a class="btn sm" href="/admin/day/${d.id}" data-link>Inrichten</a>` : ''}</td></tr>`).join('')}</tbody></table>`
       : `<p class="ink2">${me.role === 'admin' ? 'Maak hierboven je eerste wedstrijddag aan.' : 'Je bent nog niet aan een wedstrijddag gekoppeld. Vraag de beheerder om je toe te voegen.'}</p>`}</section>
     <section class="p" style="margin-top:14px"><h2><span>Account</span></h2><button class="btn sm" id="pw">Wachtwoord wijzigen</button></section></div>`;
    wireLogout(root);
    const nf = $('#nf', root);
    if (nf) nf.onsubmit = async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(nf));
      try { const r = await api('POST', '/days', f); go(`/admin/day/${r.id}`); } catch (err) { fail(err); }
    };
    $('#pw', root).onclick = async () => {
      const v = await ask({ title: 'Wachtwoord wijzigen', fields: [
        { name: 'current', label: 'Huidig wachtwoord', type: 'password', required: true },
        { name: 'next', label: 'Nieuw wachtwoord (minimaal 8 tekens)', type: 'password', required: true, minLength: 8 }] });
      if (!v) return;
      try { await api('POST', '/password', v); const { toast } = await import('../lib.js'); toast('Wachtwoord gewijzigd', 'ok'); } catch (err) { fail(err); }
    };
  };
  draw();
}
void confirmBox;
