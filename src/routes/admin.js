import { Router } from 'express';
import QRCode from 'qrcode';
import { all, get, run } from '../db.js';
import { canAccessDay, dayAccess, hashPw, requireAdmin, requireUser } from '../auth.js';
import { ah, bad, code, int, normHM, rid, str } from '../util.js';
import { createDay, DEFAULT_SETTINGS, loadConfig, logEvent, parseSettings } from '../logic.js';
import { emit } from '../hub.js';

export const adminRouter = Router();
export const baseUrl = (req) => process.env.BASE_URL || `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}`;

/* ---------- wedstrijddagen ---------- */
adminRouter.get('/days', requireUser, ah(async (req, res) => {
  const base = 'SELECT d.id,d.title,d.date,d.place,d.phase,(SELECT COUNT(*) FROM teams t WHERE t.day_id=d.id) AS teams FROM days d';
  const rows = req.user.role === 'admin'
    ? await all(`${base} ORDER BY d.id DESC`)
    : await all(`${base} JOIN day_jury j ON j.day_id=d.id WHERE j.user_id=? ORDER BY d.id DESC`, [req.user.id]);
  res.json({ days: rows });
}));

adminRouter.post('/days', requireAdmin, ah(async (req, res) => {
  const title = str(req.body.title, 120);
  if (!title) bad('Geef de wedstrijddag een naam.');
  const id = await createDay({ title, date: str(req.body.date, 20), place: str(req.body.place, 120), trophy: str(req.body.trophy, 120), victims: req.body.victims });
  res.json({ id });
}));

adminRouter.get('/days/:dayId/config', dayAccess, ah(async (req, res) => {
  const cfg = await loadConfig(req.dayId);
  const jury = await all('SELECT u.id,u.email,u.name FROM users u JOIN day_jury j ON j.user_id=u.id WHERE j.day_id=? ORDER BY u.name,u.email', [req.dayId]);
  const base = baseUrl(req);
  const { day } = cfg;
  res.json({
    day: { id: day.id, title: day.title, date: day.date, place: day.place, trophy: day.trophy, phase: day.phase, join_code: day.join_code, display_key: day.display_key, show_scores: !!day.show_scores },
    settings: cfg.settings, defaults: DEFAULT_SETTINGS,
    roles: cfg.roles, categories: cfg.categories,
    teams: cfg.teams.map((t) => ({ id: t.id, name: t.name, sort: t.sort, meld: t.meld, start: t.start, started: !!t.started_at, out: !!t.out })),
    jury, joinUrl: `${base}/join?code=${day.join_code}`, displayUrl: `${base}/display/${day.display_key}`,
  });
}));

adminRouter.patch('/days/:dayId', requireAdmin, dayAccess, ah(async (req, res) => {
  const d = await get('SELECT * FROM days WHERE id=?', [req.dayId]);
  const b = req.body;
  const settings = parseSettings(d);
  if (b.settings && typeof b.settings === 'object') {
    const s = b.settings;
    const num = (v, min, max, def) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? n : def; };
    settings.maxSpeelMin = num(s.maxSpeelMin, 1, 240, settings.maxSpeelMin);
    settings.maxRedMin = num(s.maxRedMin, 1, 240, settings.maxRedMin);
    settings.bonusPerMin = num(s.bonusPerMin, 0, 100, settings.bonusPerMin);
    settings.wrapMin = num(s.wrapMin, 0, 60, settings.wrapMin);
    settings.noteBelow = num(s.noteBelow, 0, 10, settings.noteBelow);
    if (['floor', 'round', 'exact'].includes(s.rounding)) settings.rounding = s.rounding;
    if (s.victims !== undefined) {
      const v = Math.max(1, Math.min(10, Math.round(Number(s.victims)) || 1));
      if (v !== settings.victims) {
        const begun = await get('SELECT COUNT(*) AS n FROM teams WHERE day_id=? AND started_at IS NOT NULL', [req.dayId]);
        if (begun.n) bad('Het aantal slachtoffers kan niet meer gewijzigd worden: de wedstrijd is al begonnen.', 409);
        settings.victims = v;
      }
    }
  }
  await run('UPDATE days SET title=?,date=?,place=?,trophy=?,settings=? WHERE id=?', [
    b.title !== undefined ? str(b.title, 120) || d.title : d.title,
    b.date !== undefined ? str(b.date, 20) : d.date,
    b.place !== undefined ? str(b.place, 120) : d.place,
    b.trophy !== undefined ? str(b.trophy, 120) : d.trophy,
    JSON.stringify(settings), req.dayId]);
  emit(req.dayId);
  res.json({ ok: true });
}));

adminRouter.delete('/days/:dayId', requireAdmin, dayAccess, ah(async (req, res) => {
  const id = req.dayId;
  const T = '(SELECT id FROM teams WHERE day_id=?)';
  await run(`DELETE FROM scores WHERE team_id IN ${T}`, [id]);
  await run(`DELETE FROM finals WHERE team_id IN ${T}`, [id]);
  await run(`DELETE FROM rescues WHERE team_id IN ${T}`, [id]);
  await run(`DELETE FROM corrections WHERE team_id IN ${T}`, [id]);
  await run('DELETE FROM criterion_roles WHERE criterion_id IN (SELECT id FROM criteria WHERE day_id=?)', [id]);
  for (const t of ['criteria', 'categories', 'roles', 'observers', 'events', 'teams']) await run(`DELETE FROM ${t} WHERE day_id=?`, [id]);
  await run('DELETE FROM day_jury WHERE day_id=?', [id]);
  await run('DELETE FROM days WHERE id=?', [id]);
  res.json({ ok: true });
}));

adminRouter.post('/days/:dayId/regen', requireAdmin, dayAccess, ah(async (req, res) => {
  if (req.body.which === 'display') await run('UPDATE days SET display_key=? WHERE id=?', [rid(24), req.dayId]);
  else await run('UPDATE days SET join_code=? WHERE id=?', [code(6), req.dayId]);
  res.json({ ok: true });
}));

adminRouter.get('/days/:dayId/qr.svg', dayAccess, ah(async (req, res) => {
  const d = await get('SELECT join_code FROM days WHERE id=?', [req.dayId]);
  const svg = await QRCode.toString(`${baseUrl(req)}/join?code=${d.join_code}`, { type: 'svg', margin: 1, color: { dark: '#04070d', light: '#ffffff' } });
  res.type('image/svg+xml').send(svg);
}));

/* ---------- ploegen ---------- */
adminRouter.post('/days/:dayId/teams', requireAdmin, dayAccess, ah(async (req, res) => {
  const name = str(req.body.name, 80);
  if (!name) bad('Geef de ploeg een naam.');
  const count = (await get('SELECT COUNT(*) AS n, COALESCE(MAX(sort),-1) AS m FROM teams WHERE day_id=?', [req.dayId]));
  if (count.n >= 10) bad('Er kunnen maximaal 10 ploegen meedoen.');
  const r = await run('INSERT INTO teams(day_id,name,sort,meld,start) VALUES(?,?,?,?,?)', [
    req.dayId, name, count.m + 1, normHM(req.body.meld) || '', normHM(req.body.start) || '']);
  emit(req.dayId);
  res.json({ id: r.id });
}));

async function loadTeam(req, res, next) {
  try {
    const t = await get('SELECT * FROM teams WHERE id=?', [Number(req.params.id)]);
    if (!t) return res.status(404).json({ error: 'Ploeg niet gevonden' });
    if (!(await canAccessDay(req.user, t.day_id))) return res.status(req.user ? 403 : 401).json({ error: 'Geen toegang' });
    req.team = t;
    next();
  } catch (e) { next(e); }
}
export { loadTeam };

adminRouter.patch('/teams/:id', requireUser, loadTeam, ah(async (req, res) => {
  const t = req.team;
  const isAdmin = req.user.role === 'admin';
  const name = isAdmin && req.body.name !== undefined ? str(req.body.name, 80) || t.name : t.name;
  let { meld, start } = t;
  if (req.body.meld !== undefined || req.body.start !== undefined) {
    if (t.started_at || t.out) bad('Deze ploeg is al gestart of vervallen; tijden zijn niet meer aan te passen.', 409);
    if (req.body.meld !== undefined) { meld = normHM(req.body.meld); if (!meld) bad('Meldtijd moet uu:mm zijn.'); }
    if (req.body.start !== undefined) { start = normHM(req.body.start); if (!start) bad('Starttijd moet uu:mm zijn.'); }
  }
  await run('UPDATE teams SET name=?,meld=?,start=? WHERE id=?', [name, meld, start, t.id]);
  if (meld !== t.meld || start !== t.start) await logEvent(t.day_id, 'PLANNING', 'v', `${name}: meld ${t.meld || '–'} → ${meld}, start ${t.start || '–'} → ${start} · ${req.user.name || req.user.email}`);
  emit(t.day_id);
  res.json({ ok: true });
}));

adminRouter.delete('/teams/:id', requireAdmin, loadTeam, ah(async (req, res) => {
  if (req.team.started_at) bad('Een ploeg die al gestart is kan niet verwijderd worden. Laat de ploeg anders vervallen.', 409);
  await run('DELETE FROM teams WHERE id=?', [req.team.id]);
  emit(req.team.day_id);
  res.json({ ok: true });
}));

/* ---------- juryleden ---------- */
adminRouter.post('/days/:dayId/jury', requireAdmin, dayAccess, ah(async (req, res) => {
  const email = str(req.body.email, 120).toLowerCase();
  const name = str(req.body.name, 80);
  const password = String(req.body.password || '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) bad('Vul een geldig e-mailadres in.');
  let u = await get('SELECT * FROM users WHERE email=?', [email]);
  if (u && u.role === 'admin') bad('Dit e-mailadres is van een beheerder en heeft al toegang.');
  if (!u) {
    if (password.length < 8) bad('Geef een wachtwoord van minimaal 8 tekens.');
    const r = await run('INSERT INTO users(email,name,pw,role,created_at) VALUES(?,?,?,?,?)', [email, name || email, hashPw(password), 'jury', Date.now()]);
    u = { id: r.id };
  } else if (password) {
    if (password.length < 8) bad('Het wachtwoord moet minimaal 8 tekens hebben.');
    await run('UPDATE users SET pw=?,name=COALESCE(NULLIF(?,\'\'),name) WHERE id=?', [hashPw(password), name, u.id]);
  }
  await run('INSERT OR IGNORE INTO day_jury(day_id,user_id) VALUES(?,?)', [req.dayId, u.id]);
  res.json({ ok: true });
}));

adminRouter.delete('/days/:dayId/jury/:userId', requireAdmin, dayAccess, ah(async (req, res) => {
  await run('DELETE FROM day_jury WHERE day_id=? AND user_id=?', [req.dayId, Number(req.params.userId)]);
  res.json({ ok: true });
}));

/* ---------- criteria, categorieën, functies ---------- */
async function structureOpen(dayId) {
  const r = await get('SELECT COUNT(*) AS n FROM teams WHERE day_id=? AND started_at IS NOT NULL', [dayId]);
  if (r.n) bad('De wedstrijd is al begonnen; de opzet van criteria en functies is vergrendeld. Namen kun je nog wel wijzigen.', 409);
}
async function owned(table, id, req) {
  const row = await get(`SELECT * FROM ${table} WHERE id=?`, [Number(id)]);
  if (!row) bad('Niet gevonden', 404);
  if (!(await canAccessDay(req.user, row.day_id))) bad('Geen toegang', 403);
  return row;
}
const roleIdsOf = async (dayId, ids) => {
  const valid = new Set((await all('SELECT id FROM roles WHERE day_id=?', [dayId])).map((r) => r.id));
  return [...new Set((Array.isArray(ids) ? ids : []).map(Number))].filter((x) => valid.has(x));
};
const setCritRoles = async (critId, ids) => {
  await run('DELETE FROM criterion_roles WHERE criterion_id=?', [critId]);
  for (const r of ids) await run('INSERT INTO criterion_roles(criterion_id,role_id) VALUES(?,?)', [critId, r]);
};

adminRouter.post('/days/:dayId/roles', requireAdmin, dayAccess, ah(async (req, res) => {
  await structureOpen(req.dayId);
  const name = str(req.body.name, 60); if (!name) bad('Geef de functie een naam.');
  const m = await get('SELECT COALESCE(MAX(sort),-1) AS m FROM roles WHERE day_id=?', [req.dayId]);
  res.json({ id: (await run('INSERT INTO roles(day_id,name,sort) VALUES(?,?,?)', [req.dayId, name, m.m + 1])).id });
}));
adminRouter.patch('/roles/:id', requireAdmin, ah(async (req, res) => {
  const r = await owned('roles', req.params.id, req);
  await run('UPDATE roles SET name=? WHERE id=?', [str(req.body.name, 60) || r.name, r.id]);
  emit(r.day_id); res.json({ ok: true });
}));
adminRouter.delete('/roles/:id', requireAdmin, ah(async (req, res) => {
  const r = await owned('roles', req.params.id, req);
  await structureOpen(r.day_id);
  await run('DELETE FROM criterion_roles WHERE role_id=?', [r.id]);
  await run('UPDATE observers SET role_id=NULL,status=\'pending\' WHERE role_id=?', [r.id]);
  await run('DELETE FROM roles WHERE id=?', [r.id]);
  res.json({ ok: true });
}));

adminRouter.post('/days/:dayId/categories', requireAdmin, dayAccess, ah(async (req, res) => {
  await structureOpen(req.dayId);
  const name = str(req.body.name, 100); if (!name) bad('Geef de categorie een naam.');
  const m = await get('SELECT COALESCE(MAX(sort),-1) AS m FROM categories WHERE day_id=?', [req.dayId]);
  res.json({ id: (await run('INSERT INTO categories(day_id,name,short,sort) VALUES(?,?,?,?)', [req.dayId, name, str(req.body.short, 24), m.m + 1])).id });
}));
adminRouter.patch('/categories/:id', requireAdmin, ah(async (req, res) => {
  const c = await owned('categories', req.params.id, req);
  await run('UPDATE categories SET name=?,short=? WHERE id=?', [str(req.body.name, 100) || c.name, req.body.short !== undefined ? str(req.body.short, 24) : c.short, c.id]);
  res.json({ ok: true });
}));
adminRouter.delete('/categories/:id', requireAdmin, ah(async (req, res) => {
  const c = await owned('categories', req.params.id, req);
  await structureOpen(c.day_id);
  await run('DELETE FROM criterion_roles WHERE criterion_id IN (SELECT id FROM criteria WHERE category_id=?)', [c.id]);
  await run('DELETE FROM criteria WHERE category_id=?', [c.id]);
  await run('DELETE FROM categories WHERE id=?', [c.id]);
  res.json({ ok: true });
}));

adminRouter.post('/categories/:id/criteria', requireAdmin, ah(async (req, res) => {
  const c = await owned('categories', req.params.id, req);
  await structureOpen(c.day_id);
  const name = str(req.body.name, 160); if (!name) bad('Geef het criterium een naam.');
  const m = await get('SELECT COALESCE(MAX(sort),-1) AS m FROM criteria WHERE category_id=?', [c.id]);
  const id = (await run('INSERT INTO criteria(day_id,category_id,name,sort) VALUES(?,?,?,?)', [c.day_id, c.id, name, m.m + 1])).id;
  await setCritRoles(id, await roleIdsOf(c.day_id, req.body.roles));
  res.json({ id });
}));
adminRouter.patch('/criteria/:id', requireAdmin, ah(async (req, res) => {
  const c = await owned('criteria', req.params.id, req);
  await run('UPDATE criteria SET name=? WHERE id=?', [str(req.body.name, 160) || c.name, c.id]);
  if (req.body.roles !== undefined) {
    await structureOpen(c.day_id);
    await setCritRoles(c.id, await roleIdsOf(c.day_id, req.body.roles));
  }
  res.json({ ok: true });
}));
adminRouter.delete('/criteria/:id', requireAdmin, ah(async (req, res) => {
  const c = await owned('criteria', req.params.id, req);
  await structureOpen(c.day_id);
  await run('DELETE FROM criterion_roles WHERE criterion_id=?', [c.id]);
  await run('DELETE FROM criteria WHERE id=?', [c.id]);
  res.json({ ok: true });
}));
