// Samenstellen van de momentopnames die de schermen ophalen.
import { all, get } from './db.js';
import { activeTeam, computeResults, loadConfig, loadFinals, loadRescues, loadScores, progressFor, teamStatus, wrapEnd, LABELS, SC_MAX, SC_MIN, teamTimes } from './logic.js';

const ONLINE_MS = 30000;

const teamView = (t, r, s, rs = []) => ({
  victims: s.victims, rescued_n: rs.length || (t.rescued_at ? s.victims : 0), rescues: rs.map((x) => x.at - t.started_at),
  id: t.id, name: t.name, sort: t.sort, meld: t.meld, start: t.start, status: r.status,
  out: !!t.out, out_reason: t.out_reason, gemeld_at: t.gemeld_at, ready_at: t.ready_at, ready_by: t.ready_by,
  started_at: t.started_at, rescued_at: t.rescued_at, ended_at: t.ended_at, locked: !!t.locked, wrap_end: wrapEnd(t, s),
  crit: r.crit, have: r.have, need: r.need, red: r.red, sp: r.sp, total: r.total, speelMs: r.speelMs, redMs: r.redMs,
  rank: r.rank || null, complete: r.complete, finishedRoles: r.finishedRoles,
});

export async function juryState(dayId, user) {
  const now = Date.now();
  const cfg = await loadConfig(dayId);
  if (!cfg) return null;
  const [scores, finals, resc, obs, events] = await Promise.all([
    loadScores(dayId), loadFinals(dayId), loadRescues(dayId),
    all('SELECT id,name,role_id,staff,status,last_seen,created_at FROM observers WHERE day_id=? AND status!=\'rejected\' ORDER BY id', [dayId]),
    all('SELECT id,at,kind,tone,text FROM events WHERE day_id=? ORDER BY id DESC LIMIT 80', [dayId]),
  ]);
  const results = computeResults(cfg, scores, finals, now, resc);
  const byId = Object.fromEntries(results.map((r) => [r.id, r]));
  const act = activeTeam(cfg, now);
  const { day, settings: s } = cfg;
  return {
    now, me: user ? { id: user.id, name: user.name || user.email, role: user.role } : null,
    day: { id: day.id, title: day.title, date: day.date, place: day.place, trophy: day.trophy, phase: day.phase, show_scores: !!day.show_scores, ceremony: !!day.ceremony, reveal: day.reveal, join_code: day.join_code, display_key: day.display_key },
    settings: s, labels: LABELS, scale: [SC_MIN, SC_MAX],
    roles: cfg.roles, categories: cfg.categories,
    teams: cfg.teams.map((t) => teamView(t, byId[t.id], s, resc.filter((x) => x.team_id === t.id))),
    activeTeamId: act ? act.id : null,
    observers: obs.map((o) => ({
      id: o.id, name: o.name, role_id: o.role_id, staff: o.staff || null, status: o.status,
      online: !!o.last_seen && now - o.last_seen < ONLINE_MS,
      progress: act && o.role_id ? progressFor(cfg, scores, finals, act.id, o.role_id, s.noteBelow) : null,
    })),
    events,
  };
}

/* Scoreblad van één ploeg: waarden, toelichtingen en correcties. */
export async function teamSheet(teamId) {
  const t = await get('SELECT * FROM teams WHERE id=?', [teamId]);
  const cfg = await loadConfig(t.day_id);
  const now = Date.now();
  const [scores, finals, resc] = await Promise.all([loadScores(t.day_id), loadFinals(t.day_id), loadRescues(t.day_id)]);
  const results = computeResults(cfg, scores, finals, now, resc);
  const r = results.find((x) => x.id === teamId);
  const mine = {};
  scores.filter((x) => x.team_id === teamId).forEach((x) => { mine[`${x.criterion_id}|${x.role_id}`] = { value: x.value, note: x.note }; });
  const corrections = await all(
    `SELECT c.*, k.name AS criterion, ro.name AS role FROM corrections c
     LEFT JOIN criteria k ON k.id=c.criterion_id LEFT JOIN roles ro ON ro.id=c.role_id WHERE c.team_id=? ORDER BY c.id`, [teamId]);
  // gemiddelde per categorie van alle afgeronde ploegen, voor vergelijking
  const done = results.filter((x) => x.status === 'done');
  const avg = {};
  cfg.categories.forEach((c) => {
    const v = done.map((x) => x.catAvg[c.id]).filter((x) => x != null);
    avg[c.id] = v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  });
  return {
    team: teamView(t, r, cfg.settings, resc.filter((x) => x.team_id === t.id)), day: { title: cfg.day.title, date: cfg.day.date, place: cfg.day.place },
    settings: cfg.settings, roles: cfg.roles, categories: cfg.categories, cells: mine, roleSum: r.roleSum,
    catAvg: r.catAvg, allAvg: avg, corrections, ranked: done.length, labels: LABELS,
  };
}

/* Wat een waarnemer ziet. Geen scores van anderen, alleen eigen functie. Coördinator en baanleider hebben eigen schermen. */
export async function observerState(obs) {
  const now = Date.now();
  const cfg = await loadConfig(obs.day_id);
  const { day, settings: s } = cfg;
  const base = {
    now, observer: { id: obs.id, name: obs.name, status: obs.status, staff: obs.staff || null },
    day: { title: day.title, date: day.date, place: day.place, phase: day.phase },
    settings: { noteBelow: s.noteBelow, wrapMin: s.wrapMin, victims: s.victims, maxSpeelMin: s.maxSpeelMin }, labels: LABELS, scale: [SC_MIN, SC_MAX],
  };
  if (obs.status === 'rejected') return { ...base, mode: 'rejected' };
  if (obs.status !== 'linked' || (!obs.role_id && !obs.staff)) return { ...base, mode: 'pending' };
  const act = activeTeam(cfg, now);
  const future = cfg.teams.filter((t) => ['plan', 'ready'].includes(teamStatus(t, now, s)));
  const resc = await loadRescues(obs.day_id);
  const lite = (t) => t && ({
    id: t.id, name: t.name, meld: t.meld, start: t.start, status: teamStatus(t, now, s), gemeld_at: t.gemeld_at, ready_at: t.ready_at,
    started_at: t.started_at, ended_at: t.ended_at, rescued_at: t.rescued_at, wrap_end: wrapEnd(t, s),
    victims: s.victims, rescued_n: resc.filter((x) => x.team_id === t.id).length || (t.rescued_at ? s.victims : 0),
  });
  const out = { ...base, team: lite(act), next: lite(future[0]) };

  if (obs.staff === 'coordinator') {
    return { ...out, mode: 'coordinator', teams: cfg.teams.filter((t) => !t.out).map(lite) };
  }

  if (obs.staff === 'baanleider') {
    out.mode = 'baan';
    out.baan = [];
    if (act && day.phase !== 'locked') {
      const [sc, fin, linked] = await Promise.all([
        all('SELECT role_id,criterion_id,value,note FROM scores WHERE team_id=?', [act.id]),
        all('SELECT role_id FROM finals WHERE team_id=?', [act.id]),
        all("SELECT name,role_id,last_seen FROM observers WHERE day_id=? AND status='linked' AND role_id IS NOT NULL", [obs.day_id]),
      ]);
      out.baan = cfg.roles.map((role) => {
        const criteria = cfg.categories
          .map((c) => ({ id: c.id, name: c.name, items: c.items.filter((i) => i.roles.includes(role.id)).map((i) => ({ id: i.id, name: i.name })) }))
          .filter((c) => c.items.length);
        const mine = sc.filter((x) => x.role_id === role.id);
        const o = linked.find((x) => x.role_id === role.id);
        return {
          id: role.id, name: role.name, observer: o ? { name: o.name, online: !!o.last_seen && now - o.last_seen < ONLINE_MS } : null,
          done: mine.filter((x) => x.value).length, total: criteria.reduce((n, c) => n + c.items.length, 0),
          finished: fin.some((f) => f.role_id === role.id), criteria,
          scores: Object.fromEntries(mine.map((x) => [x.criterion_id, { value: x.value, note: x.note || '' }])),
        };
      });
    }
    return out;
  }

  const role = cfg.roles.find((r) => r.id === obs.role_id);
  out.role = role ? { id: role.id, name: role.name } : null;
  out.criteria = cfg.categories
    .map((c) => ({ id: c.id, name: c.name, items: c.items.filter((i) => i.roles.includes(obs.role_id)).map((i) => ({ id: i.id, name: i.name })) }))
    .filter((c) => c.items.length);
  if (!act || day.phase === 'locked') return { ...out, mode: 'wait', scores: {}, finished: false };
  const [sc, fin] = await Promise.all([
    all('SELECT criterion_id,value,note FROM scores WHERE team_id=? AND role_id=?', [act.id, obs.role_id]),
    get('SELECT 1 AS x FROM finals WHERE team_id=? AND role_id=?', [act.id, obs.role_id]),
  ]);
  out.scores = Object.fromEntries(sc.map((x) => [x.criterion_id, { value: x.value, note: x.note || '' }]));
  out.finished = !!fin;
  return { ...out, mode: 'scoring' };
}

/* Openbaar scherm (groot scherm). Scores alleen als de jury dat toestaat; tijdens de prijsuitreiking alleen onthulde plekken. */
export async function displayState(day) {
  const now = Date.now();
  const cfg = await loadConfig(day.id);
  const [scores, finals, resc] = await Promise.all([loadScores(day.id), loadFinals(day.id), loadRescues(day.id)]);
  const results = computeResults(cfg, scores, finals, now, resc);
  const s = cfg.settings;
  const act = activeTeam(cfg, now);
  const ranked = results.filter((r) => r.status === 'done').sort((a, b) => a.rank - b.rank);
  const n = ranked.length;
  const ceremony = !!day.ceremony;
  const reveal = Math.max(0, Math.min(n, day.reveal || 0));
  const showScores = ceremony ? null : !!day.show_scores;
  const revealed = (rank) => rank > n - reveal;
  const nameOf = Object.fromEntries(cfg.teams.map((t) => [t.id, t.name]));
  const pub = (r, t, withScore) => ({
    id: t.id, name: t.name, meld: t.meld, start: t.start, status: r.status, out_reason: t.out ? t.out_reason : null,
    gemeld: !!t.gemeld_at, ready: !!t.ready_at, victims: s.victims, rescued_n: resc.filter((x) => x.team_id === t.id).length || (t.rescued_at ? s.victims : 0), rescues: resc.filter((x) => x.team_id === t.id).map((x) => x.at - t.started_at), started_at: t.started_at, ended_at: t.ended_at, rescued_at: t.rescued_at, wrap_end: wrapEnd(t, s),
    speelMs: r.speelMs, redMs: r.redMs,
    ...(withScore ? { rank: r.rank || null, crit: r.crit, red: r.red, sp: r.sp, total: r.total } : {}),
  });
  const teams = cfg.teams.map((t) => {
    const r = results.find((x) => x.id === t.id);
    const withScore = ceremony ? !!(r.rank && revealed(r.rank)) : !!showScores && r.status === 'done';
    return pub(r, t, withScore);
  });
  const out = {
    now, day: { title: day.title, date: day.date, place: day.place, trophy: day.trophy, phase: day.phase },
    settings: { maxSpeelMin: s.maxSpeelMin, maxRedMin: s.maxRedMin, bonusPerMin: s.bonusPerMin, wrapMin: s.wrapMin, rounding: s.rounding, victims: s.victims },
    teams, activeTeamId: act ? act.id : null, showScores: ceremony ? true : showScores,
    ceremony: { on: ceremony, reveal, n },
  };
  if (act) {
    out.progress = cfg.roles.map((role) => {
      const total = cfg.categories.flatMap((c) => c.items).filter((i) => i.roles.includes(role.id)).length;
      const p = progressFor(cfg, scores, finals, act.id, role.id, s.noteBelow);
      return { role: role.name, done: p.done, total, finished: p.finished };
    });
  }
  // Prijsuitreiking: de rij per plek (verborgen plekken bevatten geen gegevens).
  if (ceremony) {
    out.board = ranked.map((r) => (revealed(r.rank)
      ? { rank: r.rank, name: nameOf[r.id], crit: r.crit, red: r.red, sp: r.sp, total: r.total, speelMs: r.speelMs }
      : { rank: r.rank, hidden: true }));
    if (n > 0 && reveal >= n) {
      out.charts = {
        categories: cfg.categories.map((c) => ({ id: c.id, name: c.name, short: c.short })),
        roles: cfg.roles.map((r) => ({ id: r.id, name: r.name })),
        teams: ranked.map((r) => ({
          name: nameOf[r.id], rank: r.rank, crit: r.crit, red: r.red, sp: r.sp, total: r.total,
          speelMs: r.speelMs, redMs: r.redMs, catAvg: r.catAvg, roleSum: r.roleSum, roleHave: r.roleHave,
        })),
      };
    }
  }
  return out;
}
export { teamTimes };
