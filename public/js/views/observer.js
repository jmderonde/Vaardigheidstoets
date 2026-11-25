import { $, api, clockOf, confirmBox, debounce, esc, fail, fmtMs, setOffset, snow, sse, toast, typing } from '../lib.js';
import { go } from '../router.js';
import { getObserver, setObserver } from './access.js';

const QK = 'vt_obs_queue', SK = 'vt_obs_state';
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* geen opslag */ } };
const STAFF = { coordinator: 'coördinator', baanleider: 'baanleider' };

/* Scherm voor waarnemers, coördinator en baanleider. Scoren werkt ook zonder verbinding (wachtrij met tijdstempels). */
export async function observerView(root) {
  const me = getObserver();
  if (!me) { go('/join', true); return; }
  const H = { 'x-observer-token': me.token };
  let S = null, online = true, queue = read(QK, []), flushing = false;
  let mode = sessionStorage.getItem('vt_obs_mode') || 'card';
  let idx = null, baanRole = null;

  /* ---------- gegevens ---------- */
  const baanRoles = () => (S && S.baan) || [];
  const applyQueue = () => {
    if (!S || !S.team) return;
    for (const it of queue) {
      if (it.team_id !== S.team.id) continue;
      if (S.mode === 'scoring') {
        if (it.type === 'score') S.scores[it.criterion_id] = { value: it.value, note: it.note || '' };
        if (it.type === 'finish') S.finished = true;
      } else if (S.mode === 'baan' && it.type === 'score') {
        const r = baanRoles().find((x) => x.id === it.role_id);
        if (r) r.scores[it.criterion_id] = { value: it.value, note: it.note || '' };
      }
    }
  };
  async function load() {
    try {
      const s = await api('GET', '/observer/state', undefined, H);
      setOffset(s.now);
      S = s; online = true;
      write(SK, s);
      applyQueue();
      if (queue.length) flush();
    } catch (e) {
      if (e.status === 401) { setObserver(null); go('/join', true); return; }
      online = false;
      if (!S) { S = read(SK, null); if (S) applyQueue(); }
      if (!S) { root.innerHTML = '<div class="p" style="max-width:480px;margin:60px auto"><h2><span>Geen verbinding</span></h2><p>Open de app één keer met internet om te starten.</p></div>'; return; }
    }
    draw();
  }
  async function flush() {
    if (flushing || !queue.length) return;
    flushing = true;
    try {
      while (queue.length) {
        const batch = queue.slice(0, 100);
        const r = await api('POST', '/observer/sync', { items: batch }, H);
        queue = queue.slice(batch.length);
        write(QK, queue);
        const rejected = r.results.map((x, i) => ({ x, it: batch[i] })).filter((z) => !z.x.ok);
        const closed = rejected.filter((z) => ['closed', 'day_locked', 'finished', 'not_linked'].includes(z.x.reason));
        if (closed.length) toast(`${closed.length} wijziging(en) konden niet meer verwerkt worden: het beoordelingsvenster was al gesloten.`, 'bad');
        const other = rejected.filter((z) => !closed.includes(z));
        if (other.length) toast(other[0].x.reason === 'note_missing' ? 'Afronden mislukt: vul eerst alle toelichtingen in.' : other[0].x.reason === 'incomplete' ? 'Afronden mislukt: nog niet alle criteria zijn beoordeeld.' : 'Een wijziging is geweigerd.', 'bad');
      }
      online = true;
      const s = await api('GET', '/observer/state', undefined, H);
      setOffset(s.now); S = s; write(SK, s); applyQueue(); draw();
    } catch (e) {
      if (e.status === 401) { setObserver(null); go('/join', true); return; }
      online = false; draw();
    } finally { flushing = false; }
  }
  const enqueue = (item) => { queue.push({ ...item, ts: snow() }); write(QK, queue); flush(); };

  /* ---------- context: eigen functie, of (baanleider) de gekozen functie ---------- */
  const curRole = () => (S.mode === 'baan' ? baanRoles().find((r) => r.id === baanRole) || baanRoles()[0] : null);
  const curScores = () => (S.mode === 'baan' ? (curRole() ? curRole().scores : {}) : S.scores);
  const curCriteria = () => (S.mode === 'baan' ? (curRole() ? curRole().criteria : []) : S.criteria || []);
  const items = () => curCriteria().flatMap((c) => c.items.map((i) => ({ ...i, cat: c.name })));
  const val = (id) => (curScores()[id] ? curScores()[id].value : null);
  const needsNote = (id) => { const e = curScores()[id]; return !!(e && e.value && e.value <= S.settings.noteBelow); };
  const noteOk = (id) => !needsNote(id) || !!(curScores()[id].note || '').trim();
  const stat = () => {
    const it = items();
    return { total: it.length, done: it.filter((i) => val(i.id)).length, miss: it.filter((i) => val(i.id) && !noteOk(i.id)).length };
  };
  const windowOpen = () => {
    if (!S.team || S.day.phase === 'locked') return false;
    const inWindow = S.team.status === 'run' || (S.team.status === 'wrap' && snow() < S.team.wrap_end);
    if (S.mode === 'baan') return inWindow;
    return S.mode === 'scoring' && !S.finished && inWindow;
  };

  /* ---------- tekenen ---------- */
  const head = () => `<header class="top"><a class="brand" href="/obs" data-link><span class="logo"></span><span><b>${esc(S.day.title)}</b><small>${esc(S.observer.name)}${S.role ? ' · ' + esc(S.role.name) : ''}${S.observer.staff ? ' · ' + STAFF[S.observer.staff] : ''}</small></span></a>
    <button class="btn sm" data-leave>Afmelden</button></header>
    ${!online ? `<div class="offline">⚠ Geen verbinding. ${S.mode === 'baan' ? 'Beoordelingen worden bewaard en verstuurd zodra je weer online bent; de knoppen voor de inzet werken alleen met verbinding.' : 'Je scores worden bewaard en automatisch verstuurd zodra je weer online bent'}${queue.length ? ` (${queue.length} in de wachtrij)` : ''}.</div>`
      : queue.length ? `<div class="note">${queue.length} wijziging(en) worden verstuurd…</div>` : ''}`;

  function draw() {
    if (!S) return;
    const y = scrollY;
    let body = '';
    if (S.mode === 'pending') body = pending();
    else if (S.mode === 'rejected') body = rejected();
    else if (S.mode === 'coordinator') body = coordinator();
    else if (S.mode === 'baan') body = baan();
    else body = S.mode === 'scoring' ? scoring() : waiting();
    root.innerHTML = `<div class="obsapp">${head()}${body}</div>${S.mode === 'scoring' ? footer() : ''}`;
    scrollTo(0, y);
    tick();
  }

  const pending = () => `<section class="p center" style="margin-top:20px"><h2 style="justify-content:center"><span>Aangemeld</span></h2>
    <div class="state idle pulse" style="margin:10px 0">WACHT OP KOPPELING</div>
    <p class="ink2">Hoi <b>${esc(S.observer.name)}</b>. De jury koppelt je zo meteen aan een functie. Dit scherm werkt vanzelf bij.</p>
    <p class="hint">${esc(S.day.place || '')} ${esc(S.day.date || '')}</p></section>`;
  const rejected = () => `<section class="p center" style="margin-top:20px"><h2 style="justify-content:center"><span>Niet toegelaten</span></h2><p class="ink2">De jury heeft deze aanmelding niet geaccepteerd.</p><button class="btn pri" data-leave>Opnieuw aanmelden</button></section>`;

  const waiting = () => {
    const n = S.next, last = S.day.phase === 'locked';
    return `<section class="p center" style="margin-top:14px"><h2 style="justify-content:center"><span>${last ? 'Wedstrijddag afgesloten' : 'Wachten op de start'}</span></h2>
      ${last ? '<p class="ink2">De uitslag is vergrendeld. Bedankt voor het waarnemen!</p>' : n ? `<div class="biglabel">Volgende ploeg</div><div class="nm" style="margin:4px 0">${esc(n.name)}</div>
        <div class="cd" data-cdn="${esc(n.start || '')}">--:--</div><div class="cdl">tot geplande start ${esc(n.start || '')}</div>
        <p class="ink2" style="margin-top:16px">Zodra de inzet start, verschijnt je beoordelingslijst vanzelf${S.role ? ` voor <b>${esc(S.role.name)}</b>` : ''}.</p>` : '<p class="ink2">Er komen geen ploegen meer.</p>'}</section>`;
  };

  /* ----- coördinator: ploegen aanwezig markeren op de basislocatie ----- */
  const coordinator = () => `<section class="p" style="margin:14px 0"><h2><span>Aanwezigheid ploegen</span></h2>
    <p class="hint" style="margin-top:0">Markeer een ploeg als aanwezig zodra die zich meldt op de basislocatie.</p>
    ${S.teams.map((t) => {
      const f = ['plan', 'ready'].includes(t.status);
      const st = t.status === 'run' ? 'speelt nu' : t.status === 'wrap' ? 'afronden' : t.status === 'done' ? 'gespeeld' : t.ready_at ? 'aanwezig · klaar op de baan' : t.gemeld_at ? 'aanwezig' : 'nog niet aanwezig';
      return `<div class="wm"><div><b>${esc(t.name)}</b><small>meld ${esc(t.meld || '–')} · start ${esc(t.start || '–')} · ${st}</small></div>
        ${f ? `<button class="btn ${t.gemeld_at ? 'ok' : 'pri'}" data-mark="gemeld" data-tid="${t.id}" data-on="${t.gemeld_at ? 0 : 1}">${t.gemeld_at ? '✓ Aanwezig' : 'Markeer aanwezig'}</button>` : ''}</div>`;
    }).join('') || '<p class="mut">Geen ploegen.</p>'}</section>`;

  /* ----- baanleider: inzet bedienen en beoordelingen van alle functies aanpassen ----- */
  function baan() {
    const t = S.team, n = S.next, V = S.settings.victims || 1;
    let card;
    if (t) {
      const run = t.status === 'run', rn = t.rescued_n || 0, all = rn >= V;
      card = `<section class="p" style="margin-top:14px"><div class="row sp"><div><div class="biglabel">${run ? 'Inzet loopt' : 'Afrondtijd waarnemers'}</div><div class="nm" style="font-size:24px">${esc(t.name)}</div></div>
        <div class="center"><div class="biglabel" data-tlabel></div><div class="mono" style="font-size:34px;color:var(--cy)" data-obs-timer>--:--</div></div></div>
        <div class="steps" style="margin-top:10px"><div class="ok">✓ Start</div><div class="${all ? 'ok' : 'cur'}">${all ? '✓ ' : ''}Slachtoffer${V > 1 ? 's' : ''} ${V > 1 ? rn + '/' + V : ''}</div><div class="${run ? '' : 'ok'}">${run ? '' : '✓ '}Einde</div></div>
        ${run ? `<button class="btn pri big" data-bact="rescued" data-tid="${t.id}" ${all ? 'disabled' : ''}>${all ? '✓ ' + (V > 1 ? 'Alle slachtoffers bevrijd' : 'Slachtoffer bevrijd') : V > 1 ? `Slachtoffer bevrijd (${rn + 1} van ${V})` : 'Slachtoffer bevrijd'}</button>
          <button class="btn dng big" data-bact="end" data-tid="${t.id}">■ Einde inzet</button>
          ${rn ? `<button class="btn sm" data-bact="unrescue" data-tid="${t.id}" style="margin-top:8px">Laatste bevrijding ongedaan maken</button>` : ''}`
          : '<p class="ink2">De inzet is afgelopen. Beoordelingen kunnen nog aangepast worden zolang de afrondtijd loopt.</p>'}</section>`;
    } else if (n) {
      card = `<section class="p center" style="margin-top:14px"><h2 style="justify-content:center"><span>Volgende ploeg</span></h2><div class="nm">${esc(n.name)}</div>
        <div class="row" style="justify-content:center;margin:8px 0"><span class="chip"><i class="dot ${n.gemeld_at ? '' : 'm'}"></i>${n.gemeld_at ? 'Aanwezig' : 'Nog niet aanwezig'}</span><span class="chip"><i class="dot ${n.ready_at ? 'w' : 'm'}"></i>${n.ready_at ? 'Klaar' : 'Niet klaar'}</span></div>
        <div class="cd" data-cdn="${esc(n.start || '')}">--:--</div><div class="cdl">tot geplande start ${esc(n.start || '')}</div>
        <button class="btn big ${n.ready_at ? 'ok' : ''}" data-mark="ready" data-tid="${n.id}" data-on="${n.ready_at ? 0 : 1}" style="margin-top:14px">${n.ready_at ? '✓ Ploeg is klaar op de baan' : '⚡ Ploeg is klaar op de baan'}</button>
        <button class="btn pri big" data-bact="start" data-tid="${n.id}" data-aanwezig="${n.gemeld_at ? 1 : 0}" ${S.day.phase === 'locked' ? 'disabled' : ''}>▶ Start inzet</button></section>`;
    } else {
      card = '<section class="p center" style="margin-top:14px"><h2 style="justify-content:center"><span>Geen ploegen meer</span></h2><p class="ink2">Alle ploegen zijn gespeeld of vervallen.</p></section>';
    }
    if (!t || !S.baan.length) return card;
    if (baanRole == null || !S.baan.some((r) => r.id === baanRole)) baanRole = S.baan[0].id;
    const r = curRole();
    return `${card}<section class="p" style="margin-top:14px"><h2><span>Beoordelingen aanpassen</span></h2>
      <p class="hint" style="margin-top:0">Je kunt de beoordelingen van alle functies van de lopende ploeg wijzigen, bijvoorbeeld als een waarnemer problemen heeft. Wijzigingen worden gelogd.</p>
      <div class="seg" style="width:100%">${S.baan.map((x) => `<button class="${x.id === r.id ? 'on' : ''}" data-brole="${x.id}">${esc(x.name)} <span class="mono">${x.done}/${x.total}</span></button>`).join('')}</div>
      <div class="hint" style="margin:8px 0 0">${r.observer ? `<i class="dot ${r.observer.online ? '' : 'm'}" style="margin-right:6px"></i>${esc(r.observer.name)} · ${r.observer.online ? 'online' : 'offline'}` : '<span style="color:var(--bad)">Geen waarnemer gekoppeld aan deze functie</span>'}${r.finished ? ' · afgerond door waarnemer' : ''}</div></section>${list(windowOpen())}`;
  }

  /* ----- waarnemer ----- */
  function scoring() {
    const t = S.team, st = stat(), open = windowOpen();
    const its = items();
    if (idx == null) { const f = its.findIndex((i) => !val(i.id)); idx = f < 0 ? its.length : f; }
    idx = Math.min(idx, its.length);
    const dots = its.map((i, n) => `<button class="dotb ${!val(i.id) ? '' : noteOk(i.id) ? 'ok' : 'miss'} ${n === idx ? 'cur' : ''}" data-go="${n}" aria-label="Criterium ${n + 1}: ${esc(i.name)}"></button>`).join('');
    const banner = `<section class="p" style="margin-top:14px"><div class="row sp"><div><div class="biglabel">Nu aan de beurt</div><div class="nm" style="font-size:24px">${esc(t.name)}</div></div>
      <div class="center"><div class="biglabel" data-tlabel></div><div class="mono" style="font-size:30px;color:var(--cy)" data-obs-timer>--:--</div></div></div>
      ${S.finished ? '<div class="note" style="margin-top:10px">✓ Je beoordeling is afgerond en vergrendeld.</div>' : !open ? '<div class="warn" style="margin-top:10px">Het beoordelingsvenster is gesloten. Wijzigingen zijn niet meer mogelijk.</div>' : ''}
      <div class="seg" style="margin-top:10px"><button class="${mode === 'card' ? 'on' : ''}" data-m="card">Één per scherm</button><button class="${mode === 'list' ? 'on' : ''}" data-m="list">Alles in lijst</button></div>
      ${mode === 'card' ? `<div class="dots">${dots}<button class="dotb sum ${idx === its.length ? 'cur' : ''}" data-go="${its.length}" aria-label="Overzicht">Σ</button></div>` : ''}</section>`;
    void st;
    if (mode === 'list') return banner + list(open);
    if (idx === its.length) return banner + summary(its, open);
    return banner + card(its[idx], open, its.length);
  }

  const scaleBtns = (id, open, big) => {
    const [lo, hi] = S.scale, v = val(id);
    let h = '';
    for (let n = hi; n >= lo; n--) {
      h += big
        ? `<button class="opt ${v === n ? 'on' : ''} ${n <= S.settings.noteBelow ? 'low' : ''}" data-sc="${id}" data-v="${n}" ${open ? '' : 'disabled'} aria-pressed="${v === n}"><b>${n}</b><span>${esc(S.labels[n] || '')}</span></button>`
        : `<button class="opt ${v === n ? 'on' : ''} ${n <= S.settings.noteBelow ? 'low' : ''}" style="flex:1;min-width:0;min-height:48px;margin:0;justify-content:center;padding:0" data-sc="${id}" data-v="${n}" ${open ? '' : 'disabled'} aria-label="${n}, ${esc(S.labels[n] || '')}" aria-pressed="${v === n}"><b style="width:auto;font-size:18px">${n}</b></button>`;
    }
    return h;
  };
  const noteBox = (id, open) => {
    const e = curScores()[id];
    if (!e || !e.value) return '';
    const need = needsNote(id);
    if (!need && !(e.note || '') && !e._open) return open ? `<button class="btn sm" data-addnote="${id}" style="margin-top:6px">+ opmerking</button>` : '';
    return `<textarea data-note="${id}" class="${need && !(e.note || '').trim() ? 'bad' : ''}" rows="2" style="margin-top:6px" placeholder="${need ? 'Toelichting (verplicht bij ' + e.value + ')' : 'Opmerking (optioneel)'}" ${open ? '' : 'disabled'}>${esc(e.note || '')}</textarea>`;
  };

  function card(it, open, total) {
    const id = it.id, v = val(id);
    const blocked = needsNote(id) && !noteOk(id);
    return `<section class="p" style="margin-top:14px"><div class="hint">${esc(it.cat)} · ${idx + 1} van ${total}</div><h2 style="font-size:22px;margin:4px 0 12px;letter-spacing:normal;text-transform:none;color:var(--ink)">${esc(it.name)}</h2>
      ${scaleBtns(id, open, true)}${noteBox(id, open)}
      <div class="row sp" style="margin-top:12px"><button class="btn" data-nav="-1" ${idx === 0 ? 'disabled' : ''}>← Vorige</button>
       <button class="btn pri" data-nav="1" ${v && !blocked ? '' : 'disabled'}>${idx === total - 1 ? 'Overzicht →' : 'Volgende →'}</button></div></section>`;
  }
  function summary(its, open) {
    const first = its.findIndex((i) => !val(i.id) || !noteOk(i.id));
    return `<section class="p" style="margin-top:14px"><h2><span>Overzicht</span></h2><div class="scroll"><table><tbody>${its.map((i, n) => `<tr style="cursor:pointer" data-go="${n}"><td class="mono mut">${n + 1}</td><td>${esc(i.name)}<div class="hint">${esc(i.cat)}</div></td><td class="n mono"><b>${val(i.id) ?? '–'}</b></td><td>${!val(i.id) ? '⚠ open' : noteOk(i.id) ? '✓' : '⚠ toelichting'}</td></tr>`).join('')}</tbody></table></div>
      ${first >= 0 && open ? `<button class="btn pri" style="margin-top:12px" data-go="${first}">Naar eerstvolgende open criterium</button>` : ''}
      <p class="hint">Tik op een regel om een score te wijzigen.</p></section>`;
  }
  function list(open) {
    return curCriteria().map((c) => `<section class="p" style="margin-top:14px"><h2><span>${esc(c.name)}</span></h2>${c.items.map((i) => {
      const v = val(i.id);
      return `<div style="padding:10px 0;border-top:1px solid var(--line2)"><div style="font-weight:600;margin-bottom:6px">${esc(i.name)}</div><div class="row" style="gap:4px;flex-wrap:nowrap">${scaleBtns(i.id, open, false)}</div>
        <div class="hint" style="margin-top:4px">${v ? `<b>${v}</b> · ${esc(S.labels[v] || '')}` : 'nog niet beoordeeld'}</div>${noteBox(i.id, open)}</div>`;
    }).join('')}</section>`).join('');
  }

  function footer() {
    const st = stat(), open = windowOpen();
    const ok = open && st.done === st.total && st.miss === 0 && st.total > 0;
    return `<div class="obsfoot"><div style="flex:1;min-width:0"><div class="row" style="flex-wrap:nowrap"><div class="bar" style="flex:1"><i class="${st.done === st.total ? 'ok' : ''}" style="width:${st.total ? st.done / st.total * 100 : 0}%"></i></div><span class="mono">${st.done}/${st.total}</span></div>
      <div class="hint">${S.finished ? 'Afgerond' : !open ? 'Venster gesloten' : st.miss ? `${st.miss} toelichting(en) ontbreken` : st.done < st.total ? 'Nog niet alles beoordeeld' : 'Klaar om af te ronden'}</div></div>
      ${S.finished ? '<span class="chip"><i class="dot"></i>Afgerond</span>' : `<button class="btn pri" data-finish ${ok ? '' : 'disabled'}>Afronden</button>`}</div>`;
  }

  /* ---------- tikken ---------- */
  function tick() {
    const now = snow();
    const t = S && S.team;
    const tm = $('[data-obs-timer]', root);
    if (tm && t) {
      const lbl = $('[data-tlabel]', root);
      if (t.status === 'wrap' || (t.ended_at && now > t.ended_at)) { tm.textContent = fmtMs(Math.max(0, t.wrap_end - now)); lbl.textContent = 'afrondtijd'; if (now > t.wrap_end && windowOpen()) draw(); }
      else { tm.textContent = fmtMs(now - t.started_at); lbl.textContent = 'speeltijd'; }
    }
    const cd = $('[data-cdn]', root);
    if (cd && cd.dataset.cdn) {
      const [h, m] = cd.dataset.cdn.split(':').map(Number);
      const d = new Date(now); d.setHours(h, m, 0, 0);
      const diff = d - now, a = Math.abs(diff);
      cd.textContent = (diff < 0 ? '+' : '') + fmtMs(a);
      cd.classList.toggle('late', diff < 0);
    }
  }

  /* ---------- bediening ---------- */
  const sendNote = debounce((id) => {
    const e = curScores()[id];
    if (e && e.value && windowOpen()) enqueue({ type: 'score', team_id: S.team.id, criterion_id: +id, value: e.value, note: e.note || '', ...(S.mode === 'baan' ? { role_id: curRole().id } : {}) });
  }, 700);
  const baanAct = async (id, action) => { await api('POST', `/observer/team/${id}/action`, { action }, H); await load(); };

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button,tr[data-go]');
    if (!b) return;
    const d = b.dataset;
    try {
      if (d.leave !== undefined) {
        if (!(await confirmBox('Afmelden', 'Je wordt afgemeld op dit toestel.', 'Afmelden', true))) return;
        try { await api('POST', '/observer/leave', {}, H); } catch { /* al weg */ }
        setObserver(null); write(QK, []); go('/join'); return;
      }
      if (d.m) { mode = d.m; sessionStorage.setItem('vt_obs_mode', mode); draw(); return; }
      if (d.go !== undefined) { idx = +d.go; draw(); scrollTo(0, 0); return; }
      if (d.nav) { idx = (idx || 0) + +d.nav; draw(); scrollTo(0, 0); return; }
      if (d.brole) { baanRole = +d.brole; draw(); return; }
      if (d.sc) {
        if (!windowOpen()) return;
        const id = +d.sc, v = +d.v, sc = curScores(), cur = sc[id] || { note: '' };
        sc[id] = { value: v, note: cur.note || '' };
        enqueue({ type: 'score', team_id: S.team.id, criterion_id: id, value: v, note: cur.note || '', ...(S.mode === 'baan' ? { role_id: curRole().id } : {}) });
        try { navigator.vibrate && navigator.vibrate(15); } catch { /* niet ondersteund */ }
        draw();
        if (S.mode === 'scoring' && mode === 'card' && v > S.settings.noteBelow) { const at = idx; setTimeout(() => { if (idx === at && !typing(root)) { idx = at + 1; draw(); scrollTo(0, 0); } }, 320); }
        return;
      }
      if (d.addnote) { curScores()[+d.addnote]._open = true; draw(); const ta = $(`[data-note="${d.addnote}"]`, root); if (ta) ta.focus(); return; }
      if (d.finish !== undefined) {
        if (!(await confirmBox('Beoordeling afronden', 'Na afronden kun je je scores niet meer wijzigen.', 'Afronden'))) return;
        S.finished = true; enqueue({ type: 'finish', team_id: S.team.id }); draw(); return;
      }
      if (d.mark) {
        await api('POST', `/observer/team/${d.tid}/mark`, { what: d.mark, on: d.on === '1' }, H); await load(); return;
      }
      if (d.bact) {
        const a = d.bact;
        if (a === 'start') {
          const warn = d.aanwezig === '0' ? ' Let op: deze ploeg is nog niet als aanwezig gemarkeerd.' : '';
          if (!(await confirmBox('Start inzet', `De klok loopt direct en de beoordeling opent voor alle waarnemers.${warn}`, 'Start inzet'))) return;
        }
        if (a === 'end' && !(await confirmBox('Einde inzet', `De speeltijd stopt nu en de waarnemers krijgen ${S.settings.wrapMin} minuten om af te ronden.`, 'Einde inzet', true))) return;
        if (a === 'unrescue' && !(await confirmBox('Ongedaan maken', 'De laatste bevrijding wordt teruggedraaid.', 'Ongedaan maken'))) return;
        await baanAct(d.tid, a);
        try { navigator.vibrate && navigator.vibrate(30); } catch { /* niet ondersteund */ }
        return;
      }
    } catch (err) { fail(err); }
  });
  root.addEventListener('input', (e) => {
    const ta = e.target.closest('[data-note]');
    if (!ta) return;
    const id = +ta.dataset.note, sc = curScores();
    if (!sc[id]) return;
    sc[id].note = ta.value;
    ta.classList.toggle('bad', needsNote(id) && !ta.value.trim());
    sendNote(id);
    if (S.mode === 'scoring') { const f = $('.obsfoot', root); if (f) f.outerHTML = footer(); }
    const nb = root.querySelector('[data-nav="1"]'); if (nb) nb.disabled = !(val(id) && noteOk(id));
  });

  /* ---------- realtime ---------- */
  const reload = debounce(() => { if (!typing(root)) load(); }, 150);
  const closeSse = sse(`/api/observer/stream?token=${encodeURIComponent(me.token)}`, reload, (ok) => { if (!ok) { online = false; if (S) draw(); } });
  const timers = [setInterval(tick, 250), setInterval(() => { if (!typing(root)) load(); }, 10000)];
  const onOnline = () => { load(); };
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', () => { online = false; if (S) draw(); });

  await load();
  void clockOf;
  return () => { closeSse(); timers.forEach(clearInterval); window.removeEventListener('online', onOnline); };
}
