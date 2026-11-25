import { $, api, clockSec, esc, fmtMs, fmtN, setOffset, snow, sse } from '../lib.js';
import * as P from '../panels.js';
import { chartsHTML } from '../charts.js';

/* Groot scherm voor in de zaal: live status, planning en prijsuitreiking. Geen login; de link is geheim. */
export async function displayView(root, [key]) {
  let S, radarTeam = null, prevReveal = 0, online = true;
  const load = async () => { S = await api('GET', `/display/${encodeURIComponent(key)}/state`); setOffset(S.now); };
  try { await load(); } catch (e) {
    root.innerHTML = `<div class="p" style="max-width:520px;margin:80px auto"><h2><span>Scherm niet gevonden</span></h2><p>${esc(e.message)}</p></div>`;
    return;
  }
  document.body.classList.add('tv');

  const head = () => `<header class="top"><div class="brand"><span class="logo"></span><span><b>${esc(S.day.title)}</b><small>${esc(S.day.date || '')} ${esc(S.day.place || '')}</small></span></div>
    <div class="clock" data-clock>--:--:--<small>LOKALE TIJD</small></div>
    <div class="top-r"><span class="chip"><i class="dot ${online ? '' : 'b'}"></i>${online ? 'LIVE' : 'GEEN VERBINDING'}</span><button class="btn sm" data-full>Volledig scherm</button></div></header>`;

  function draw() {
    root.innerHTML = head() + (S.ceremony.on ? ceremony() : dashboard());
    tick();
  }

  function dashboard() {
    const a = S.teams.find((t) => t.id === S.activeTeamId);
    const next = S.teams.find(P.isFuture);
    const later = next ? S.teams.slice(S.teams.indexOf(next) + 1).filter(P.isFuture).slice(0, 3) : [];
    const outs = S.teams.filter((t) => t.status === 'out');
    const doneN = S.teams.filter((t) => t.status === 'done').length, goN = S.teams.filter(P.isFuture).length;
    const prog = (S.progress || []).map((p) => ({ role: p.role, done: p.done, total: p.total, finished: p.finished, note: p.finished ? 'afgerond' : '' }));
    return `<div class="grid">
     <section class="p c12"><h2><span>Dagplanning</span></h2>${P.timeline(S.teams, S.settings)}</section>
     <section class="p c8"><h2><span>Live inzet</span></h2>${P.liveHTML(a, S.settings)}
      ${a ? `<div style="margin-top:14px"><h2 style="margin-bottom:8px"><span>Voortgang waarnemers</span></h2>${P.progressCards(prog)}</div>` : ''}</section>
     <section class="p c4"><h2><span>Volgende ploeg</span></h2>${P.nextHTML(next, later, outs)}</section>
     <section class="p c12 plan"><h2><span>${S.showScores ? 'Planning en tussenstand' : 'Planning'}</span><span class="mono mut">${doneN} GESPEELD · ${a ? 1 : 0} LOPEND · ${goN} TE GAAN${outs.length ? ' · ' + outs.length + ' VERVALLEN' : ''}</span></h2>
      <div class="scroll"><table>${P.planningHead(false)}<tbody>${P.planningRows(S.teams, { showScores: S.showScores })}</tbody></table></div></section></div>`;
  }

  function ceremony() {
    const { reveal, n } = S.ceremony;
    const done = n > 0 && reveal >= n;
    const rows = (S.board || []).map((r) => {
      const fresh = !r.hidden && r.rank === n - reveal + 1 && reveal > prevReveal;
      return r.hidden
        ? `<div class="r hid"><span class="p1">${r.rank}</span><span>• • •</span><span></span></div>`
        : `<div class="r ${r.rank === 1 ? 'first' : ''} ${fresh ? 'reveal-in' : ''}"><span class="p1">${r.rank}</span><span>${esc(r.name)}<small>criteria ${r.crit} · redtijd +${fmtN(r.red)} · speeltijd +${fmtN(r.sp)} · ${fmtMs(r.speelMs)}</small></span><b>${fmtN(r.total)}</b></div>`;
    }).join('');
    prevReveal = reveal;
    const w = done && S.board.find((r) => r.rank === 1);
    return `<section class="p"><h2><span>Prijsuitreiking</span><span class="mono mut">${reveal} VAN ${n}</span></h2><div class="board">${rows || '<div class="r"><span></span><span class="mut">Zo meteen de uitslag…</span><span></span></div>'}</div></section>
     ${w ? `<div class="winner reveal-in">🏆 ${esc(S.day.trophy || 'De wisselbeker')} gaat naar<strong>${esc(w.name)}</strong>met ${fmtN(w.total)} punten</div>` : ''}
     ${done && S.charts ? chartsHTML(S.charts, radarTeam) : ''}`;
  }

  function tick() {
    const now = snow();
    const c = $('[data-clock]', root);
    if (c) c.firstChild.nodeValue = clockSec(now);
    if (S.ceremony.on) return;
    const a = S.teams.find((t) => t.id === S.activeTeamId);
    P.tickTimeline(root, now); P.tickLive(root, a, S.settings, now); P.tickNext(root, now);
    const lt = $('[data-live-time]', root);
    if (lt && a) lt.textContent = fmtMs(now - a.started_at);
    if (a && a.status === 'wrap' && a.wrap_end && now > a.wrap_end + 400 && !tick.f) { tick.f = true; refresh(); }
    if (!a || a.status !== 'wrap') tick.f = false;
  }

  const refresh = async () => { try { await load(); online = true; draw(); } catch { online = false; } };
  root.addEventListener('click', (e) => { if (e.target.closest('[data-full]')) (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {}); });
  root.addEventListener('change', (e) => { if (e.target.matches('[data-radar]')) { radarTeam = e.target.value; draw(); } });
  const closeSse = sse(`/api/display/${encodeURIComponent(key)}/stream`, () => refresh(), (ok) => { online = ok; });
  const timers = [setInterval(tick, 250), setInterval(refresh, 15000)];
  draw();
  return () => { closeSse(); timers.forEach(clearInterval); document.body.classList.remove('tv'); };
}
