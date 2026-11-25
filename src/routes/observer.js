import { Router } from 'express';
import { all, get, run } from '../db.js';
import { limit } from '../auth.js';
import { ah, bad, int, rid, str } from '../util.js';
import { loadConfig, logEvent, parseSettings, SC_MAX, SC_MIN, teamStatus } from '../logic.js';
import { emit, subscribe } from '../hub.js';
import { observerState } from '../state.js';

export const observerRouter = Router();

observerRouter.get('/time', (req, res) => res.json({ now: Date.now() }));

/* Aanmelden met dagcode (of via de QR-code); de jury koppelt daarna een functie. */
observerRouter.post('/join', ah(async (req, res) => {
  if (!limit(`join:${req.ip}`, 30, 10 * 60e3)) bad('Te veel pogingen. Wacht even en probeer het opnieuw.', 429);
  const name = str(req.body.name, 40);
  const codeIn = str(req.body.code, 12).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (name.length < 2) bad('Vul je naam in (minimaal 2 tekens).');
  const day = await get('SELECT * FROM days WHERE join_code=?', [codeIn]);
  if (!day) bad('Deze code klopt niet. Controleer de code of scan de QR-code opnieuw.', 404);
  if (day.phase === 'locked') bad('Deze wedstrijddag is afgesloten.', 409);
  const n = await get('SELECT COUNT(*) AS n FROM observers WHERE day_id=?', [day.id]);
  if (n.n >= 80) bad('Er zijn te veel aanmeldingen voor deze dag. Neem contact op met de jury.', 409);
  const token = rid(32);
  const r = await run('INSERT INTO observers(day_id,name,token,status,last_seen,created_at) VALUES(?,?,?,\'pending\',?,?)', [day.id, name, token, Date.now(), Date.now()]);
  await logEvent(day.id, 'AANMELDING', 'w', `${name} meldt zich aan en wacht op koppeling`);
  emit(day.id);
  res.json({ token, observer: { id: r.id, name } });
}));

async function obsAuth(req, res, next) {
  try {
    const token = req.headers['x-observer-token'] || req.query.token;
    if (!token) return res.status(401).json({ error: 'Niet aangemeld' });
    const o = await get('SELECT * FROM observers WHERE token=?', [String(token)]);
    if (!o) return res.status(401).json({ error: 'Deze aanmelding is niet meer geldig' });
    if (!o.last_seen || Date.now() - o.last_seen > 5000) await run('UPDATE observers SET last_seen=? WHERE id=?', [Date.now(), o.id]);
    req.obs = o;
    next();
  } catch (e) { next(e); }
}

observerRouter.get('/observer/state', obsAuth, ah(async (req, res) => {
  const fresh = await get('SELECT * FROM observers WHERE id=?', [req.obs.id]);
  res.json(await observerState(fresh));
}));
observerRouter.get('/observer/stream', obsAuth, (req, res) => subscribe(req.obs.day_id, req, res));
observerRouter.post('/observer/leave', obsAuth, ah(async (req, res) => {
  await run('UPDATE observers SET status=\'rejected\',role_id=NULL,timekeeper=0 WHERE id=?', [req.obs.id]);
  await logEvent(req.obs.day_id, 'AANMELDING', 'w', `${req.obs.name} heeft zich afgemeld`);
  emit(req.obs.day_id);
  res.json({ ok: true });
}));

/* ---------- scores schrijven (ook vanuit de offline-wachtrij) ---------- */
function windowOpen(t, s, ts, now) {
  if (!t.started_at || t.out || t.locked) return false;
  const when = Math.min(ts || now, now);
  if (when < t.started_at - 2000) return false;
  const end = t.ended_at ? t.ended_at + s.wrapMin * 60000 : Infinity;
  if (when > end) return false;
  if (t.ended_at && now > end + s.lateSyncMin * 60000) return false; // te laat gesynchroniseerd
  return true;
}

async function applyItem(obs, item, ctx) {
  const now = Date.now();
  const teamId = int(item.team_id);
  const t = await get('SELECT * FROM teams WHERE id=? AND day_id=?', [teamId, obs.day_id]);
  if (!t) return { ok: false, reason: 'unknown_team' };
  const day = ctx.day;
  if (day.phase === 'locked') return { ok: false, reason: 'day_locked' };
  if (obs.status !== 'linked' || !obs.role_id) return { ok: false, reason: 'not_linked' };
  if (!windowOpen(t, ctx.settings, Number(item.ts) || now, now)) return { ok: false, reason: 'closed' };
  const fin = await get('SELECT 1 AS x FROM finals WHERE team_id=? AND role_id=?', [t.id, obs.role_id]);

  if (item.type === 'finish') {
    if (fin) return { ok: true, already: true };
    const items = ctx.cfg.categories.flatMap((c) => c.items.filter((i) => i.roles.includes(obs.role_id)));
    const mine = await all('SELECT criterion_id,value,note FROM scores WHERE team_id=? AND role_id=?', [t.id, obs.role_id]);
    const m = new Map(mine.map((x) => [x.criterion_id, x]));
    for (const i of items) {
      const e = m.get(i.id);
      if (!e || !e.value) return { ok: false, reason: 'incomplete' };
      if (e.value <= ctx.settings.noteBelow && !(e.note || '').trim()) return { ok: false, reason: 'note_missing' };
    }
    await run('INSERT OR IGNORE INTO finals(team_id,role_id,at) VALUES(?,?,?)', [t.id, obs.role_id, now]);
    return { ok: true, finished: true };
  }

  if (fin) return { ok: false, reason: 'finished' };
  const criterionId = int(item.criterion_id), value = int(item.value);
  if (value == null || value < SC_MIN || value > SC_MAX) return { ok: false, reason: 'bad_value' };
  const applies = ctx.cfg.categories.some((c) => c.items.some((i) => i.id === criterionId && i.roles.includes(obs.role_id)));
  if (!applies) return { ok: false, reason: 'not_applicable' };
  await run(
    `INSERT INTO scores(team_id,criterion_id,role_id,value,note,observer_id,updated_at) VALUES(?,?,?,?,?,?,?)
     ON CONFLICT(team_id,criterion_id,role_id) DO UPDATE SET value=excluded.value,note=excluded.note,observer_id=excluded.observer_id,updated_at=excluded.updated_at`,
    [t.id, criterionId, obs.role_id, value, str(item.note, 500), obs.id, now]);
  return { ok: true };
}

async function handleItems(req, res, items) {
  const cfg = await loadConfig(req.obs.day_id);
  const ctx = { cfg, day: cfg.day, settings: parseSettings(cfg.day) };
  const results = [];
  for (const it of items.slice(0, 300)) results.push(await applyItem(req.obs, it, ctx));
  if (results.some((r) => r.ok)) emit(req.obs.day_id);
  const late = items.some((it, i) => results[i].ok && Date.now() - (Number(it.ts) || Date.now()) > 60000);
  if (late) await logEvent(req.obs.day_id, 'SYNC', 'i', `${req.obs.name}: offline scores gesynchroniseerd`);
  res.json({ results });
}

observerRouter.put('/observer/score', obsAuth, ah(async (req, res) => {
  await handleItems(req, res, [{ ...req.body, type: 'score' }]);
}));
observerRouter.post('/observer/finish', obsAuth, ah(async (req, res) => {
  await handleItems(req, res, [{ ...req.body, type: 'finish' }]);
}));
observerRouter.post('/observer/sync', obsAuth, ah(async (req, res) => {
  if (!Array.isArray(req.body.items)) bad('Geen items');
  await handleItems(req, res, req.body.items);
}));

/* ---------- tijdwaarnemer: gemeld / klaar om te starten ---------- */
observerRouter.post('/observer/team/:id/mark', obsAuth, ah(async (req, res) => {
  if (!req.obs.timekeeper || req.obs.status !== 'linked') bad('Alleen de tijdwaarnemer mag dit.', 403);
  const t = await get('SELECT * FROM teams WHERE id=? AND day_id=?', [int(req.params.id), req.obs.day_id]);
  if (!t) bad('Ploeg niet gevonden', 404);
  const cfg = await loadConfig(req.obs.day_id);
  if (!['plan', 'ready'].includes(teamStatus(t, Date.now(), cfg.settings))) bad('Deze ploeg kan niet meer gemarkeerd worden.', 409);
  const on = req.body.on !== false;
  if (req.body.what === 'gemeld') {
    await run('UPDATE teams SET gemeld_at=? WHERE id=?', [on ? Date.now() : null, t.id]);
    await logEvent(t.day_id, 'GEMELD', 'i', on ? `${t.name} heeft zich gemeld · ${req.obs.name} (tijdwaarnemer)` : `${t.name}: melding ingetrokken · ${req.obs.name}`);
  } else if (req.body.what === 'ready') {
    await run('UPDATE teams SET ready_at=?,ready_by=?,gemeld_at=COALESCE(gemeld_at,?) WHERE id=?', [on ? Date.now() : null, on ? `${req.obs.name} (tijdwaarnemer)` : null, on ? Date.now() : null, t.id]);
    await logEvent(t.day_id, 'READY', 'i', on ? `${t.name} klaar om te starten · ${req.obs.name} (tijdwaarnemer)` : `${t.name}: ready ingetrokken · ${req.obs.name}`);
  } else bad('Onbekende actie');
  emit(t.day_id);
  res.json({ ok: true });
}));
