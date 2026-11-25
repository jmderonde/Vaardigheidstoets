import { all, get, run, batch } from './db.js';
import { code, rid } from './util.js';

export const SC_MIN = 4;
export const SC_MAX = 10;
export const LABELS = {
  4: 'onveilig', 5: 'onvoldoende', 6: 'voldoende', 7: 'netjes', 8: 'goed',
  9: 'bijna optimaal, kleine schoonheidsfoutjes', 10: 'optimaal, kan niet beter',
};
export const DEFAULT_SETTINGS = {
  maxSpeelMin: 30, maxRedMin: 20, bonusPerMin: 1, rounding: 'floor', // floor | round | exact
  wrapMin: 5, noteBelow: 5, lateSyncMin: 30,
  victims: 1, // aantal slachtoffers; redtijd = tijd tot het laatste slachtoffer gered is
};
export const parseSettings = (day) => {
  let s = {};
  try { s = JSON.parse(day.settings || '{}'); } catch { /* standaard */ }
  return { ...DEFAULT_SETTINGS, ...s };
};

/* ---------- sjabloon: de lijst uit de laatste wedstrijd ---------- */
export const TEMPLATE = {
  roles: ['Bevelvoerder', '1 en 2', '3 en 4', 'Chauffeur'],
  cats: [
    ['Voorbereiding op de inzet → aanrijfase', 'Voorbereiding', [
      ['scenariodenken (real en escalatie)', [0, 1, 2, 3]], ['meedenken', [1, 2, 3]], ['rijgedrag', [3]]]],
    ['Verkenning', 'Verkenning', [['360 graden verkenning', [0, 1, 2]], ['gezamenlijke beeldvorming', [0, 1, 2, 3]]]],
    ['Inzet', 'Inzet', [
      ['opstelplaats', [0, 3]], ['er is een duidelijk plan gemaakt', [0, 1, 2]], ['er is veilig gewerkt', [0, 1, 2, 3]],
      ['er is technisch goed gewerkt', [0, 1, 2, 3]], ['er is tactisch goed gewerkt', [0, 1, 2, 3]]]],
    ['Afbouw en nazorg', 'Afbouw', [['zorg voor ploeg en betrokkenen', [0]], ['afhandeling incident', [0]]]],
    ['Human factors', 'Human factors', [['omgaan met omstanders', [0]], ['geeft duidelijke opdrachten', [0]], ['SO Redden', [1, 2]]]],
    ['Communicatie', 'Communicatie', [['met eigen ploegleden', [0, 1, 2, 3]], ['met centralist', [0]], ['met externe', [0, 3]]]],
    ['Algemeen', 'Algemeen', [['gebruik PBM\'s', [0, 1, 2]], ['gebruik materialen/gereedschappen/pomp', [1, 2, 3]], ['past FABCM toe', [0, 3]]]],
  ],
};

export async function createDay({ title, date, place, trophy, victims }) {
  const now = Date.now();
  const v = Math.max(1, Math.min(10, Math.round(Number(victims)) || 1));
  const r = await run(
    'INSERT INTO days(title,date,place,trophy,join_code,display_key,settings,created_at) VALUES(?,?,?,?,?,?,?,?)',
    [title, date || '', place || '', trophy || 'De wisselbeker', code(6), rid(24), JSON.stringify({ victims: v }), now]);
  const dayId = r.id;
  const roleIds = [];
  for (const [i, name] of TEMPLATE.roles.entries()) roleIds.push((await run('INSERT INTO roles(day_id,name,sort) VALUES(?,?,?)', [dayId, name, i])).id);
  for (const [ci, [name, short, items]] of TEMPLATE.cats.entries()) {
    const cid = (await run('INSERT INTO categories(day_id,name,short,sort) VALUES(?,?,?,?)', [dayId, name, short, ci])).id;
    for (const [ii, [iname, rs]] of items.entries()) {
      const id = (await run('INSERT INTO criteria(day_id,category_id,name,sort) VALUES(?,?,?,?)', [dayId, cid, iname, ii])).id;
      await batch(rs.map((ri) => ['INSERT INTO criterion_roles(criterion_id,role_id) VALUES(?,?)', [id, roleIds[ri]]]));
    }
  }
  return dayId;
}

/* ---------- laden ---------- */
export async function loadConfig(dayId) {
  const day = await get('SELECT * FROM days WHERE id=?', [dayId]);
  if (!day) return null;
  const [roles, cats, crit, cr, teams] = await Promise.all([
    all('SELECT id,name,sort FROM roles WHERE day_id=? ORDER BY sort,id', [dayId]),
    all('SELECT id,name,short,sort FROM categories WHERE day_id=? ORDER BY sort,id', [dayId]),
    all('SELECT id,category_id,name,sort FROM criteria WHERE day_id=? ORDER BY sort,id', [dayId]),
    all('SELECT cr.criterion_id,cr.role_id FROM criterion_roles cr JOIN criteria c ON c.id=cr.criterion_id WHERE c.day_id=?', [dayId]),
    all('SELECT * FROM teams WHERE day_id=? ORDER BY sort,id', [dayId]),
  ]);
  const roleSet = new Set(roles.map((r) => r.id));
  const map = {};
  cr.forEach((x) => { if (roleSet.has(x.role_id)) (map[x.criterion_id] ||= []).push(x.role_id); });
  const categories = cats.map((c) => ({
    ...c, items: crit.filter((i) => i.category_id === c.id).map((i) => ({ id: i.id, name: i.name, roles: map[i.id] || [] })),
  }));
  return { day, settings: parseSettings(day), roles, categories, teams };
}
export const loadScores = (dayId) =>
  all('SELECT s.* FROM scores s JOIN teams t ON t.id=s.team_id WHERE t.day_id=?', [dayId]);
export const loadRescues = (dayId) =>
  all('SELECT r.* FROM rescues r JOIN teams t ON t.id=r.team_id WHERE t.day_id=? ORDER BY r.team_id,r.seq', [dayId]);
export const loadFinals = (dayId) =>
  all('SELECT f.* FROM finals f JOIN teams t ON t.id=f.team_id WHERE t.day_id=?', [dayId]);

/* ---------- tijd en status ---------- */
export function teamStatus(t, now, s) {
  if (t.out) return 'out';
  if (!t.started_at) return t.ready_at ? 'ready' : 'plan';
  if (!t.ended_at) return 'run';
  if (t.locked || now > t.ended_at + s.wrapMin * 60000) return 'done';
  return 'wrap';
}
export const wrapEnd = (t, s) => (t.ended_at ? t.ended_at + s.wrapMin * 60000 : null);
export function teamTimes(t, now) {
  return {
    speelLive: t.started_at ? (t.ended_at || now) - t.started_at : null,
    speel: t.started_at && t.ended_at ? t.ended_at - t.started_at : null,
    red: t.started_at && t.rescued_at ? t.rescued_at - t.started_at : null,
  };
}
export function bonus(ms, maxMin, s) {
  if (ms == null) return 0;
  const rem = (maxMin * 60000 - ms) / 60000;
  if (rem <= 0) return 0;
  const m = s.rounding === 'floor' ? Math.floor(rem) : s.rounding === 'round' ? Math.round(rem) : Math.round(rem * 100) / 100;
  return m * s.bonusPerMin;
}

export function cellsOf(cfg) {
  const roleSet = new Set(cfg.roles.map((r) => r.id));
  const cells = [];
  cfg.categories.forEach((c) => c.items.forEach((i) => i.roles.forEach((r) => { if (roleSet.has(r)) cells.push({ cat: c, crit: i, role: r }); })));
  return cells;
}

/* Resultaten per ploeg. Rangschikking alleen onder afgeronde ploegen (status "done"). */
export function computeResults(cfg, scores, finals, now) {
  const s = cfg.settings;
  const cells = cellsOf(cfg);
  const byTeam = {};
  scores.forEach((x) => { (byTeam[x.team_id] ||= {})[`${x.criterion_id}|${x.role_id}`] = x; });
  const fin = {};
  finals.forEach((f) => { (fin[f.team_id] ||= new Set()).add(f.role_id); });
  const res = cfg.teams.map((t) => {
    const sc = byTeam[t.id] || {};
    let crit = 0, have = 0;
    const roleSum = {}, roleHave = {}, catAgg = {};
    cells.forEach(({ cat, crit: c, role }) => {
      const e = sc[`${c.id}|${role}`];
      if (e && e.value) {
        crit += e.value; have++;
        roleSum[role] = (roleSum[role] || 0) + e.value;
        roleHave[role] = (roleHave[role] || 0) + 1;
        const a = (catAgg[cat.id] ||= { s: 0, n: 0 }); a.s += e.value; a.n++;
      }
    });
    const status = teamStatus(t, now, s);
    const tm = teamTimes(t, now);
    const red = bonus(tm.red, s.maxRedMin, s);
    const sp = bonus(tm.speel, s.maxSpeelMin, s);
    return {
      id: t.id, status, crit, have, need: cells.length, red, sp, total: crit + red + sp,
      speelMs: tm.speel, redMs: tm.red, roleSum, roleHave,
      catAvg: Object.fromEntries(Object.entries(catAgg).map(([k, a]) => [k, a.s / a.n])),
      finishedRoles: [...(fin[t.id] || [])],
      complete: have === cells.length && tm.speel != null && tm.red != null,
    };
  });
  const ranked = res.filter((r) => r.status === 'done')
    .sort((a, b) => b.total - a.total || (a.speelMs ?? 1e15) - (b.speelMs ?? 1e15));
  ranked.forEach((r, i) => { r.rank = i + 1; });
  return res;
}

export async function logEvent(dayId, kind, tone, text) {
  await run('INSERT INTO events(day_id,at,kind,tone,text) VALUES(?,?,?,?,?)', [dayId, Date.now(), kind, tone, text]);
}

/* Voortgang van één waarnemer op de actuele ploeg. */
export function progressFor(cfg, scores, finals, teamId, roleId, noteBelow) {
  const items = cfg.categories.flatMap((c) => c.items.filter((i) => i.roles.includes(roleId)));
  const mine = new Map(scores.filter((x) => x.team_id === teamId && x.role_id === roleId).map((x) => [x.criterion_id, x]));
  let done = 0, notesMissing = 0;
  items.forEach((i) => {
    const e = mine.get(i.id);
    if (e && e.value) { done++; if (e.value <= noteBelow && !(e.note || '').trim()) notesMissing++; }
  });
  return { done, total: items.length, notesMissing, finished: finals.some((f) => f.team_id === teamId && f.role_id === roleId) };
}

/* De ploeg waar nu beoordeeld wordt (lopend of in afrondtijd). */
export function activeTeam(cfg, now) {
  return cfg.teams.find((t) => { const st = teamStatus(t, now, cfg.settings); return st === 'run' || st === 'wrap'; }) || null;
}
