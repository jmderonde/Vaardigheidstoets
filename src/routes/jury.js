import { Router } from 'express';
import { all, get, run } from '../db.js';
import { dayAccess, requireUser } from '../auth.js';
import { ah, bad, int, normHM, hm, toHM, str } from '../util.js';
import { cellsOf, computeResults, loadConfig, loadFinals, loadScores, logEvent, SC_MAX, SC_MIN, teamStatus } from '../logic.js';
import { emit, subscribe } from '../hub.js';
import { juryState, teamSheet } from '../state.js';
import { loadTeam } from './admin.js';
import { fmtMs, performTeamAction } from '../actions.js';

export const juryRouter = Router();
const who = (req) => req.user.name || req.user.email;

juryRouter.get('/days/:dayId/state', dayAccess, ah(async (req, res) => {
  const st = await juryState(req.dayId, req.user);
  if (!st) bad('Wedstrijddag niet gevonden', 404);
  res.json(st);
}));
juryRouter.get('/days/:dayId/stream', dayAccess, (req, res) => subscribe(req.dayId, req, res));

/* ---------- regie van de inzet ---------- */
juryRouter.post('/teams/:id/action', requireUser, loadTeam, ah(async (req, res) => {
  const t = req.team;
  await performTeamAction(t, String(req.body.action || ''), { reason: str(req.body.reason, 300), on: req.body.on !== false }, who(req));
  emit(t.day_id);
  res.json({ ok: true });
}));

/* ---------- planning ---------- */
juryRouter.post('/days/:dayId/shift', dayAccess, ah(async (req, res) => {
  const d = int(req.body.minutes);
  if (d == null || Math.abs(d) > 240 || d === 0) bad('Geef een aantal minuten tussen -240 en 240.');
  const cfg = await loadConfig(req.dayId);
  const now = Date.now();
  let n = 0;
  for (const t of cfg.teams) {
    if (!['plan', 'ready'].includes(teamStatus(t, now, cfg.settings))) continue;
    await run('UPDATE teams SET meld=?,start=? WHERE id=?', [
      hm(t.meld) != null ? toHM(hm(t.meld) + d) : t.meld, hm(t.start) != null ? toHM(hm(t.start) + d) : t.start, t.id]);
    n++;
  }
  await logEvent(req.dayId, 'PLANNING', 'v', `Resterende planning ${d > 0 ? '+' : ''}${d} min verschoven (${n} ploegen) · ${who(req)}`);
  emit(req.dayId);
  res.json({ ok: true, shifted: n });
}));

juryRouter.post('/days/:dayId/swap', dayAccess, ah(async (req, res) => {
  const cfg = await loadConfig(req.dayId);
  const now = Date.now();
  const a = cfg.teams.find((t) => t.id === int(req.body.a)), b = cfg.teams.find((t) => t.id === int(req.body.b));
  if (!a || !b || a.id === b.id) bad('Kies twee verschillende ploegen.');
  for (const t of [a, b]) if (!['plan', 'ready'].includes(teamStatus(t, now, cfg.settings))) bad(`${t.name} kan niet meer verplaatst worden.`, 409);
  await run('UPDATE teams SET sort=?,meld=?,start=? WHERE id=?', [b.sort, b.meld, b.start, a.id]);
  await run('UPDATE teams SET sort=?,meld=?,start=? WHERE id=?', [a.sort, a.meld, a.start, b.id]);
  await logEvent(req.dayId, 'PLANNING', 'v', `${a.name} en ${b.name} gewisseld van plek · ${who(req)}`);
  emit(req.dayId);
  res.json({ ok: true });
}));

/* ---------- waarnemers koppelen ---------- */
async function loadObserver(req, res, next) {
  try {
    const o = await get('SELECT * FROM observers WHERE id=?', [Number(req.params.id)]);
    if (!o) return res.status(404).json({ error: 'Waarnemer niet gevonden' });
    const { canAccessDay } = await import('../auth.js');
    if (!(await canAccessDay(req.user, o.day_id))) return res.status(req.user ? 403 : 401).json({ error: 'Geen toegang' });
    req.obs = o;
    next();
  } catch (e) { next(e); }
}
juryRouter.post('/observers/:id/link', requireUser, loadObserver, ah(async (req, res) => {
  const o = req.obs;
  const roleId = req.body.role_id == null || req.body.role_id === '' ? null : int(req.body.role_id);
  let staff = req.body.staff || (req.body.timekeeper ? 'coordinator' : null);
  if (staff && !['coordinator', 'baanleider'].includes(staff)) bad('Onbekende rol');
  if (roleId != null) staff = null; // een functie of een staffrol, niet beide
  if (roleId != null) {
    const role = await get('SELECT * FROM roles WHERE id=? AND day_id=?', [roleId, o.day_id]);
    if (!role) bad('Onbekende functie');
    const other = await get('SELECT name FROM observers WHERE day_id=? AND role_id=? AND id!=? AND status=\'linked\'', [o.day_id, roleId, o.id]);
    if (other) bad(`De functie ${role.name} is al gekoppeld aan ${other.name}. Ontkoppel die waarnemer eerst.`, 409);
  }
  const linked = roleId != null || !!staff;
  await run('UPDATE observers SET role_id=?,staff=?,timekeeper=0,status=? WHERE id=?', [roleId, staff, linked ? 'linked' : 'pending', o.id]);
  let label = 'ontkoppeld';
  if (roleId != null) label = `gekoppeld aan ${(await get('SELECT name FROM roles WHERE id=?', [roleId])).name}`;
  if (staff) label = `gekoppeld als ${staff === 'coordinator' ? 'coördinator' : 'baanleider'}`;
  await logEvent(o.day_id, 'KOPPELING', 'i', `${o.name} ${label} · ${who(req)}`);
  emit(o.day_id);
  res.json({ ok: true });
}));
juryRouter.post('/observers/:id/reject', requireUser, loadObserver, ah(async (req, res) => {
  await run('UPDATE observers SET status=\'rejected\',role_id=NULL,timekeeper=0,staff=NULL WHERE id=?', [req.obs.id]);
  await logEvent(req.obs.day_id, 'AANMELDING', 'w', `${req.obs.name} geweigerd · ${who(req)}`);
  emit(req.obs.day_id);
  res.json({ ok: true });
}));

/* ---------- correcties (alleen jury, altijd met toelichting) ---------- */
juryRouter.post('/teams/:id/correct', requireUser, loadTeam, ah(async (req, res) => {
  const t = req.team;
  const cfg = await loadConfig(t.day_id);
  const criterionId = int(req.body.criterion_id), roleId = int(req.body.role_id), value = int(req.body.value);
  const reason = str(req.body.reason, 300);
  if (reason.length < 3) bad('Een correctie vraagt om een toelichting.');
  if (value == null || value < SC_MIN || value > SC_MAX) bad(`De score moet tussen ${SC_MIN} en ${SC_MAX} liggen.`);
  const cell = cellsOf(cfg).find((c) => c.crit.id === criterionId && c.role === roleId);
  if (!cell) bad('Dit criterium geldt niet voor deze functie.');
  const old = await get('SELECT value,note FROM scores WHERE team_id=? AND criterion_id=? AND role_id=?', [t.id, criterionId, roleId]);
  await run(
    `INSERT INTO scores(team_id,criterion_id,role_id,value,note,observer_id,updated_at) VALUES(?,?,?,?,?,NULL,?)
     ON CONFLICT(team_id,criterion_id,role_id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,
    [t.id, criterionId, roleId, value, old ? old.note : '', Date.now()]);
  await run('INSERT INTO corrections(team_id,criterion_id,role_id,old_value,new_value,reason,user,at) VALUES(?,?,?,?,?,?,?,?)',
    [t.id, criterionId, roleId, old ? old.value : null, value, reason, who(req), Date.now()]);
  const role = cfg.roles.find((r) => r.id === roleId);
  await logEvent(t.day_id, 'CORRECTIE', 'v', `${t.name} · ${role.name} · ${cell.crit.name}: ${old ? old.value : '–'} → ${value} · “${reason}” · ${who(req)}`);
  emit(t.day_id);
  res.json({ ok: true });
}));

juryRouter.post('/teams/:id/correct-time', requireUser, loadTeam, ah(async (req, res) => {
  const t = req.team;
  const reason = str(req.body.reason, 300);
  if (reason.length < 3) bad('Een correctie vraagt om een toelichting.');
  if (!t.started_at) bad('Deze ploeg is nog niet gestart.', 409);
  const sec = (v) => { const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > 6 * 3600) bad('Geef een tijd in seconden.'); return Math.round(n * 1000); };
  const patch = {};
  if (req.body.speel_s !== undefined && req.body.speel_s !== null && req.body.speel_s !== '') patch.ended_at = t.started_at + sec(req.body.speel_s);
  if (req.body.red_s !== undefined) patch.rescued_at = req.body.red_s === null || req.body.red_s === '' ? null : t.started_at + sec(req.body.red_s);
  if (!Object.keys(patch).length) bad('Niets om te wijzigen.');
  const ended = patch.ended_at ?? t.ended_at;
  const rescued = 'rescued_at' in patch ? patch.rescued_at : t.rescued_at;
  if (ended && rescued && rescued > ended) bad('De redtijd kan niet langer zijn dan de speeltijd.');
  await run('UPDATE teams SET ended_at=?,rescued_at=? WHERE id=?', [ended, rescued, t.id]);
  await logEvent(t.day_id, 'CORRECTIE', 'v', `${t.name} · tijd aangepast (speeltijd ${ended ? fmtMs(ended - t.started_at) : '–'}, redtijd ${rescued ? fmtMs(rescued - t.started_at) : '–'}) · “${reason}” · ${who(req)}`);
  emit(t.day_id);
  res.json({ ok: true });
}));

juryRouter.post('/teams/:id/unlock-role', requireUser, loadTeam, ah(async (req, res) => {
  const roleId = int(req.body.role_id);
  const reason = str(req.body.reason, 300);
  if (reason.length < 3) bad('Geef een toelichting.');
  await run('DELETE FROM finals WHERE team_id=? AND role_id=?', [req.team.id, roleId]);
  const role = await get('SELECT name FROM roles WHERE id=?', [roleId]);
  await logEvent(req.team.day_id, 'ONTGRENDELD', 'w', `Beoordeling ${role ? role.name : ''} van ${req.team.name} ontgrendeld · “${reason}” · ${who(req)}`);
  emit(req.team.day_id);
  res.json({ ok: true });
}));

juryRouter.get('/teams/:id/sheet', requireUser, loadTeam, ah(async (req, res) => {
  res.json(await teamSheet(req.team.id));
}));

/* ---------- dagfase, scores tonen, prijsuitreiking ---------- */
juryRouter.post('/days/:dayId/phase', dayAccess, ah(async (req, res) => {
  const phase = req.body.phase;
  if (!['active', 'locked'].includes(phase)) bad('Onbekende fase');
  const cfg = await loadConfig(req.dayId);
  const now = Date.now();
  if (phase === 'locked') {
    const busy = cfg.teams.find((t) => ['run', 'wrap'].includes(teamStatus(t, now, cfg.settings)));
    if (busy) bad(`${busy.name} is nog bezig; vergrendelen kan pas als alle beoordelingen klaar zijn.`, 409);
  }
  await run('UPDATE days SET phase=? WHERE id=?', [phase, req.dayId]);
  await logEvent(req.dayId, 'UITSLAG', phase === 'locked' ? 'o' : 'w', phase === 'locked' ? `Uitslag vergrendeld · ${who(req)}` : `Uitslag ontgrendeld · ${who(req)}`);
  emit(req.dayId);
  res.json({ ok: true });
}));

juryRouter.post('/days/:dayId/show-scores', dayAccess, ah(async (req, res) => {
  await run('UPDATE days SET show_scores=? WHERE id=?', [req.body.on ? 1 : 0, req.dayId]);
  emit(req.dayId);
  res.json({ ok: true });
}));

juryRouter.post('/days/:dayId/ceremony', dayAccess, ah(async (req, res) => {
  const cfg = await loadConfig(req.dayId);
  const now = Date.now();
  const n = cfg.teams.filter((t) => teamStatus(t, now, cfg.settings) === 'done').length;
  const d = cfg.day;
  let { ceremony, reveal } = d;
  switch (req.body.action) {
    case 'start': ceremony = 1; reveal = 0; break;
    case 'stop': ceremony = 0; reveal = 0; break;
    case 'next': reveal = Math.min(n, reveal + 1); break;
    case 'prev': reveal = Math.max(0, reveal - 1); break;
    case 'all': reveal = n; break;
    case 'reset': reveal = 0; break;
    default: bad('Onbekende actie');
  }
  await run('UPDATE days SET ceremony=?,reveal=? WHERE id=?', [ceremony, reveal, req.dayId]);
  if (req.body.action === 'start') await logEvent(req.dayId, 'PRIJSUITREIKING', 'v', `Prijsuitreiking gestart · ${who(req)}`);
  emit(req.dayId);
  res.json({ ok: true, ceremony, reveal, n });
}));

/* ---------- export en rapport ---------- */
juryRouter.get('/days/:dayId/export.csv', dayAccess, ah(async (req, res) => {
  const cfg = await loadConfig(req.dayId);
  const [scores, finals] = await Promise.all([loadScores(req.dayId), loadFinals(req.dayId)]);
  const results = computeResults(cfg, scores, finals, Date.now());
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const mmss = (ms) => (ms == null ? '' : fmtMs(ms));
  const head = ['Plek', 'Post', 'Status', 'Punten criteria', 'Bonus redtijd', 'Bonus speeltijd', 'Totaal', 'Speeltijd', 'Redtijd', ...cfg.roles.map((r) => `Totaal ${r.name}`)];
  const rows = [...results].sort((a, b) => (a.rank || 99) - (b.rank || 99) || a.id - b.id).map((r) => {
    const t = cfg.teams.find((x) => x.id === r.id);
    return [r.rank || '', t.name, r.status, r.crit, r.red, r.sp, r.total, mmss(r.speelMs), mmss(r.redMs), ...cfg.roles.map((ro) => r.roleSum[ro.id] || 0)];
  });
  // detailregels
  const detail = [['Post', 'Functie', 'Categorie', 'Criterium', 'Score', 'Toelichting']];
  const nameOf = Object.fromEntries(cfg.teams.map((t) => [t.id, t.name]));
  cellsOf(cfg).forEach((c) => scores.filter((s) => s.criterion_id === c.crit.id && s.role_id === c.role).forEach((s) => {
    detail.push([nameOf[s.team_id], cfg.roles.find((r) => r.id === c.role).name, c.cat.name, c.crit.name, s.value, s.note || '']);
  }));
  const csv = '﻿' + [head, ...rows, [], ...detail].map((r) => r.map(q).join(';')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="uitslag-${req.dayId}.csv"`);
  res.send(csv);
}));
