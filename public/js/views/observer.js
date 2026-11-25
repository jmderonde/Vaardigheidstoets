import { $, api, ask, clockOf, confirmBox, debounce, esc, fail, fmtMs, setOffset, snow, sse, toast, typing } from '../lib.js';
import { go } from '../router.js';
import { getObserver, setObserver } from './access.js';

const QK = 'vt_obs_queue', SK = 'vt_obs_state';
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* geen opslag */ } };

/* Het scherm van de waarnemer: werkt ook zonder verbinding (wachtrij met tijdstempels). */
export async function observerView(root) {
  const me = getObserver();
  if (!me) { go('/join', true); return; }
  const H = { 'x-observer-token': me.token };
  let S = null, online = true, queue = read(QK, []), flushing = false;
  let mode = sessionStorage.getItem('vt_obs_mode') || 'card';
  let idx = null;

  /* ---------- gegevens ---------- */
  const applyQueue = () => {
    if (!S || !S.team || S.mode !== 'scoring') return;
    for (const it of queue) {
      if (it.team_id !== S.team.id) continue;
      if (it.type === 'score') S.scores[it.criterion_id] = { value: it.value, note: it.note || '' };
      if (it.type === 'finish') S.finished = true;
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

  /* ---------- afgeleide waarden ---------- */
  const items = () => (S.criteria || []).flatMap((c) => c.items.map((i) => ({ ...i, cat: c.name })));
  const val = (id) => (S.scores[id] ? S.scores[id].value : null);
  const needsNote = (id) => { const e = S.scores[id]; return !!(e && e.value && e.value <= S.settings.noteBelow); };
  const noteOk = (id) => !needsNote(id) || !!(S.scores[id].note || '').trim();
  const stat = () => {
    const it = items();
    return { total: it.length, done: it.filter((i) => val(i.id)).length, miss: it.filter((i) => val(i.id) && !noteOk(i.id)).length };
  };
  const windowOpen = () => {
    if (S.mode !== 'scoring' || !S.team || S.finished || S.day.phase === 'locked') return false;
    if (S.team.status === 'run') return true;
    if (S.team.status === 'wrap') return snow() < S.team.wrap_end;
    return false;
  };

  /* ---------- tekenen ---------- */
  const head = () => `<header class="top"><a class="brand" href="/obs" data-link><span class="logo"></span><span><b>${esc(S.day.title)}</b><small>${esc(S.observer.name)}${S.role ? ' · ' + esc(S.role.name) : ''}${S.observer.timekeeper ? ' · tijdwaarnemer' : ''}</small></span></a>
    <button class="btn sm" data-leave>Afmelden</button></header>
    ${!online ? `<div class="offline">⚠ Geen verbinding. Je scores worden bewaard en automatisch verstuurd zodra je weer online bent${queue.length ? ` (${queue.length} in de wachtrij)` : ''}.</div>`
      : queue.length ? `<div class="note">${queue.length} wijziging(en) worden verstuurd…</div>` : ''}`;

  function draw() {
    if (!S) return;
    const y = scrollY;
    let body = '';
    if (S.mode === 'pending') body = pending();
    else if (S.mode === 'rejected') body = rejected();
    else {
      body = (S.timekeeper ? timekeeper() : '') + (S.mode === 'timekeeper' ? '' : S.mode === 'scoring' ? scoring() : waiting());
    }
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
        <p class="ink2" style="margin-top:16px">Zodra de jury de inzet start, verschijnt je beoordelingslijst vanzelf${S.role ? ` voor <b>${esc(S.role.name)}</b>` : ''}.</p>` : '<p class="ink2">Er komen geen ploegen meer.</p>'}</section>`;
  };

  const timekeeper = () => {
    const T = S.timekeeper.teams;
    return `<section class="p" style="margin:14px 0"><h2><span>Tijdwaarnemer</span></h2>
     ${T.map((t) => {
       const f = ['plan', 'ready'].includes(t.status);
       return `<div class="wm"><div><b>${esc(t.name)}</b><small>meld ${esc(t.meld || '–')} · start ${esc(t.start || '–')} · ${t.status === 'run' ? 'loopt' : t.status === 'wrap' ? 'afronden' : t.status === 'done' ? 'gespeeld' : t.ready_at ? 'klaar om te starten' : t.gemeld_at ? 'gemeld' : 'gepland'}</small></div>
        ${f ? `<div class="row" style="flex-wrap:nowrap"><button class="btn sm ${t.gemeld_at ? 'ok' : ''}" data-mark="gemeld" data-tid="${t.id}" data-on="${t.gemeld_at ? 0 : 1}">${t.gemeld_at ? '✓ Gemeld' : 'Gemeld'}</button><button class="btn sm ${t.ready_at ? 'pri' : ''}" data-mark="ready" data-tid="${t.id}" data-on="${t.ready_at ? 0 : 1}">${t.ready_at ? '✓ Ready' : '⚡ Ready'}</button></div>` : ''}</div>`;
     }).join('') || '<p class="mut">Geen ploegen.</p>'}</section>`;
  };

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
    const e = S.scores[id];
    if (!e || !e.value) return '';
    const need = needsNote(id);
    if (!need && !(e.note || '') && !e._open) return open ? `<button class="btn sm" data-addnote="${id}" style="margin-top:6px">+ opmerking</button>` : '';
    return `<textarea data-note="${id}" class="${need && !(e.note || '').trim() ? 'bad' : ''}" rows="2" style="margin-top:6px" placeholder="${need ? 'Toelichting (verplicht bij ' + e.value + ')' : 'Opmerking (optioneel)'}" ${open ? '' : 'disabled'}>${esc(e.note || '')}</textarea>`;
  };

  function card(it, open, total) {
    const id = it.id, v = val(id);
    const need = needsNote(id), blocked = need && !noteOk(id);
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
    return (S.criteria || []).map((c) => `<section class="p" style="margin-top:14px"><h2><span>${esc(c.name)}</span></h2>${c.items.map((i) => {
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
  const sendNote = debounce((id) => { const e = S.scores[id]; if (e && e.value && windowOpen()) enqueue({ type: 'score', team_id: S.team.id, criterion_id: +id, value: e.value, note: e.note || '' }); }, 700);
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button,tr[data-go]');
    if (!b) return;
    const d = b.dataset;
    try {
      if (d.leave !== undefined) {
        if (!(await confirmBox('Afmelden', 'Je wordt afgemeld als waarnemer op dit toestel.', 'Afmelden', true))) return;
        try { await api('POST', '/observer/leave', {}, H); } catch { /* al weg */ }
        setObserver(null); write(QK, []); go('/join'); return;
      }
      if (d.m) { mode = d.m; sessionStorage.setItem('vt_obs_mode', mode); draw(); return; }
      if (d.go !== undefined) { idx = +d.go; draw(); scrollTo(0, 0); return; }
      if (d.nav) { idx = (idx || 0) + +d.nav; draw(); scrollTo(0, 0); return; }
      if (d.sc) {
        if (!windowOpen()) return;
        const id = +d.sc, v = +d.v, cur = S.scores[id] || { note: '' };
        S.scores[id] = { value: v, note: cur.note || '' };
        enqueue({ type: 'score', team_id: S.team.id, criterion_id: id, value: v, note: cur.note || '' });
        try { navigator.vibrate && navigator.vibrate(15); } catch { /* niet ondersteund */ }
        draw();
        if (mode === 'card' && v > S.settings.noteBelow) { const at = idx; setTimeout(() => { if (idx === at && !typing(root)) { idx = at + 1; draw(); scrollTo(0, 0); } }, 320); }
        return;
      }
      if (d.addnote) { S.scores[+d.addnote]._open = true; draw(); const ta = $(`[data-note="${d.addnote}"]`, root); if (ta) ta.focus(); return; }
      if (d.finish !== undefined) {
        if (!(await confirmBox('Beoordeling afronden', 'Na afronden kun je je scores niet meer wijzigen.', 'Afronden'))) return;
        S.finished = true; enqueue({ type: 'finish', team_id: S.team.id }); draw(); return;
      }
      if (d.mark) {
        await api('POST', `/observer/team/${d.tid}/mark`, { what: d.mark, on: d.on === '1' }, H); await load(); return;
      }
    } catch (err) { fail(err); }
  });
  root.addEventListener('input', (e) => {
    const ta = e.target.closest('[data-note]');
    if (!ta) return;
    const id = +ta.dataset.note;
    if (!S.scores[id]) return;
    S.scores[id].note = ta.value;
    ta.classList.toggle('bad', needsNote(id) && !ta.value.trim());
    sendNote(id);
    const f = $('.obsfoot', root); if (f) f.outerHTML = footer();
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
  void ask; void clockOf;
  return () => { closeSse(); timers.forEach(clearInterval); window.removeEventListener('online', onOnline); };
}
