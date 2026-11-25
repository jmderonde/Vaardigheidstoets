// Rooktest: doorloopt een complete wedstrijddag via de API met een tijdelijke database.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-'));
process.env.TURSO_DATABASE_URL = 'file:' + path.join(dir, 'test.db').replace(/\\/g, '/');
process.env.ADMIN_EMAIL = 'beheer@example.com';
process.env.ADMIN_PASSWORD = 'wachtwoord123';
process.env.SESSION_SECRET = 'test-secret';

const { createApp } = await import('../server.js');
const app = await createApp();
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}/api`;

let pass = 0;
const ok = (name) => { pass++; console.log('  ✓', name); };

class Client {
  constructor(token) { this.cookie = ''; this.token = token; }
  async req(method, url, body, expect = 200) {
    const res = await fetch(base + url, {
      method,
      headers: { 'content-type': 'application/json', ...(this.cookie ? { cookie: this.cookie } : {}), ...(this.token ? { 'x-observer-token': this.token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const sc = res.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    if (res.status !== expect) throw new Error(`${method} ${url} → ${res.status} (verwacht ${expect}): ${text.slice(0, 200)}`);
    return json;
  }
  get(u, e) { return this.req('GET', u, undefined, e); }
  post(u, b = {}, e) { return this.req('POST', u, b, e); }
  patch(u, b, e) { return this.req('PATCH', u, b, e); }
  put(u, b, e) { return this.req('PUT', u, b, e); }
  del(u, e) { return this.req('DELETE', u, undefined, e); }
}

const admin = new Client();
const jury = new Client();

console.log('Inloggen en toegang');
await admin.post('/login', { email: 'beheer@example.com', password: 'fout' }, 401);
await admin.post('/login', { email: 'beheer@example.com', password: 'wachtwoord123' });
ok('beheerder logt in; foutief wachtwoord wordt geweigerd');
await new Client().get('/days', 401);
ok('zonder login geen toegang');

console.log('Wedstrijddag inrichten');
const { id: dayId } = await admin.post('/days', { title: 'Testdag', date: '2026-11-28', place: 'Testpost' });
let cfg = await admin.get(`/days/${dayId}/config`);
assert.equal(cfg.roles.length, 4);
assert.equal(cfg.categories.flatMap((c) => c.items).length, 21);
assert.equal(cfg.categories.flatMap((c) => c.items.flatMap((i) => i.roles)).length, 53);
ok('standaardlijst: 4 functies, 21 criteria, 53 beoordelingen');

const teamIds = [];
for (let i = 1; i <= 3; i++) teamIds.push((await admin.post(`/days/${dayId}/teams`, { name: `Post ${i}`, meld: `0${8 + i}:00`, start: `0${8 + i}:20` })).id);
await admin.post(`/days/${dayId}/jury`, { email: 'jury@example.com', name: 'Jury Een', password: 'kort' }, 400);
await admin.post(`/days/${dayId}/jury`, { email: 'jury@example.com', name: 'Jury Een', password: 'langgenoeg1' });
await jury.post('/login', { email: 'jury@example.com', password: 'langgenoeg1' });
await jury.post('/days', { title: 'x' }, 403);
const other = await admin.post('/days', { title: 'Andere dag' });
await jury.get(`/days/${other.id}/state`, 403);
await jury.get(`/days/${dayId}/state`);
ok('jurylid ziet alleen de eigen dag en kan geen dagen aanmaken');
await admin.patch(`/days/${dayId}`, { settings: { maxSpeelMin: 30, maxRedMin: 20, bonusPerMin: 1, wrapMin: 5 } });

console.log('Waarnemers aanmelden en koppelen');
await new Client().post('/join', { code: 'XXXXXX', name: 'Kees' }, 404);
cfg = await admin.get(`/days/${dayId}/config`);
const code = cfg.day.join_code;
const roles = cfg.roles;
const names = ['Kees', 'Anouk', 'Mo', 'Sander', 'Roos', 'Piet'];
const obs = [];
for (const n of names) {
  const r = await new Client().post('/join', { code: code.toLowerCase(), name: n });
  obs.push({ name: n, c: new Client(r.token), id: r.observer.id });
}
let r0;
let st = await obs[0].c.get('/observer/state');
assert.equal(st.mode, 'pending');
ok('waarnemers melden zich aan met de dagcode en wachten op koppeling');
await new Client().get(`/days/${dayId}/qr.svg`, 401);
const qr = await fetch(`${base}/days/${dayId}/qr.svg`, { headers: { cookie: jury.cookie } });
assert.equal(qr.status, 200);
assert.ok((await qr.text()).includes('<svg'));
ok('QR-code wordt als SVG geleverd');

for (let i = 0; i < 4; i++) await jury.post(`/observers/${obs[i].id}/link`, { role_id: roles[i].id });
await jury.post(`/observers/${obs[4].id}/link`, { staff: 'coordinator' });
await jury.post(`/observers/${obs[5].id}/link`, { staff: 'baanleider' });
await jury.post(`/observers/${obs[4].id}/link`, { role_id: roles[0].id }, 409);
ok('functies gekoppeld; dezelfde functie twee keer wordt geweigerd');
st = await obs[0].c.get('/observer/state');
assert.equal(st.mode, 'wait');
assert.equal(st.criteria.flatMap((c) => c.items).length, 17);
assert.equal((await obs[1].c.get('/observer/state')).criteria.flatMap((c) => c.items).length, 12);
ok('waarnemer ziet alleen de criteria van de eigen functie (17 voor bevelvoerder, 12 voor 1 en 2)');
assert.equal((await obs[4].c.get('/observer/state')).mode, 'coordinator');
assert.equal((await obs[5].c.get('/observer/state')).mode, 'baan');
ok('coördinator en baanleider krijgen hun eigen scherm');

console.log('Inzet starten en beoordelen');
const t1 = teamIds[0];
const items0 = st.criteria.flatMap((c) => c.items);
await obs[0].c.put('/observer/score', { team_id: t1, criterion_id: items0[0].id, value: 8, ts: Date.now() }, 200)
  .then((r) => assert.equal(r.results[0].ok, false));
ok('vóór de start worden scores geweigerd');
await obs[4].c.post(`/observer/team/${t1}/mark`, { what: 'gemeld' });
await obs[4].c.post(`/observer/team/${t1}/mark`, { what: 'ready' }, 403);
await obs[4].c.post(`/observer/team/${t1}/action`, { action: 'start' }, 403);
await obs[0].c.post(`/observer/team/${t1}/mark`, { what: 'gemeld' }, 403);
ok('coördinator markeert aanwezig maar mag niet starten; gewone waarnemer mag niets markeren');
await obs[5].c.post(`/observer/team/${t1}/mark`, { what: 'ready' });
await obs[5].c.post(`/observer/team/${t1}/action`, { action: 'abort', reason: 'test' }, 403);
await obs[5].c.post(`/observer/team/${t1}/action`, { action: 'start' });
await jury.post(`/teams/${teamIds[1]}/action`, { action: 'start' }, 409);
ok('baanleider markeert ready en start de inzet; tweede inzet tegelijk wordt geweigerd; afbreken mag alleen de jury');

// iedere waarnemer vult alle criteria in (met een 5 bij de eerste van de chauffeur)
const scoreAll = async (o, teamId, val, ts) => {
  const s = await o.c.get('/observer/state');
  assert.equal(s.mode, 'scoring');
  let first = true;
  for (const c of s.criteria) for (const i of c.items) {
    const v = first && s.role.name === 'Chauffeur' ? 5 : val;
    const r = await o.c.put('/observer/score', { team_id: teamId, criterion_id: i.id, value: v, note: v <= 5 ? 'Toelichting' : '', ts });
    assert.equal(r.results[0].ok, true, JSON.stringify(r));
    first = false;
  }
};
for (let i = 0; i < 4; i++) await scoreAll(obs[i], t1, 8);
let js = await jury.get(`/days/${dayId}/state`);
assert.equal(js.activeTeamId, t1);
assert.deepEqual(js.observers.find((o) => o.name === 'Kees').progress, { done: 17, total: 17, notesMissing: 0, finished: false });
ok('alle 53 beoordelingen worden opgeslagen; jury ziet de voortgang');

const bs = await obs[5].c.get('/observer/state');
assert.equal(bs.baan.length, 4);
const chfRole = bs.baan.find((r) => r.name === 'Chauffeur');
assert.equal(chfRole.done, 12);
const chfItem = chfRole.criteria[0].items[0];
r0 = await obs[5].c.put('/observer/score', { team_id: t1, criterion_id: chfItem.id, role_id: chfRole.id, value: 7, note: '', ts: Date.now() });
assert.equal(r0.results[0].ok, true);
assert.ok((await jury.get(`/days/${dayId}/state`)).events.some((e) => e.kind === 'BAANLEIDER'));
r0 = await obs[5].c.post('/observer/finish', { team_id: t1, role_id: chfRole.id });
assert.equal(r0.results[0].ok, false);
await obs[0].c.put('/observer/score', { team_id: t1, criterion_id: items0[0].id, value: 8, ts: Date.now() });
ok('baanleider ziet alle functies en kan een beoordeling van een andere functie wijzigen (wordt gelogd)');

// 4 of 5 vraagt toelichting bij afronden
const chf = obs[3];
const sc = await chf.c.get('/observer/state');
const firstItem = sc.criteria[0].items[0];
await chf.c.put('/observer/score', { team_id: t1, criterion_id: firstItem.id, value: 4, note: '', ts: Date.now() });
let r = await chf.c.post('/observer/finish', { team_id: t1 });
assert.equal(r.results[0].reason, 'note_missing');
await chf.c.put('/observer/score', { team_id: t1, criterion_id: firstItem.id, value: 4, note: 'Veiligheid in het geding', ts: Date.now() });
r = await chf.c.post('/observer/finish', { team_id: t1 });
assert.equal(r.results[0].ok, true);
r = await chf.c.put('/observer/score', { team_id: t1, criterion_id: firstItem.id, value: 6, ts: Date.now() });
assert.equal(r.results[0].reason, 'finished');
ok('toelichting verplicht bij 4 of 5; na afronden is de beoordeling vergrendeld');

await new Promise((res) => setTimeout(res, 1200)); // speeltijd ≈ 1 s
await jury.post(`/teams/${t1}/action`, { action: 'rescued' });
await new Promise((res) => setTimeout(res, 300));
await jury.post(`/teams/${t1}/action`, { action: 'end' });
js = await jury.get(`/days/${dayId}/state`);
assert.equal(js.teams[0].status, 'wrap');
await jury.post(`/teams/${teamIds[1]}/action`, { action: 'start' }, 409);
ok('einde inzet start de afrondtijd; volgende start is geblokkeerd tot de afrondtijd voorbij is');

// scores binnen de afrondtijd worden nog geaccepteerd
const s2 = await obs[1].c.get('/observer/state');
r = await obs[1].c.put('/observer/score', { team_id: t1, criterion_id: s2.criteria[0].items[0].id, value: 9, ts: Date.now() });
assert.equal(r.results[0].ok, true);
ok('tijdens de afrondtijd kan de waarnemer nog wijzigen');

// offline-wachtrij: een score met een tijdstip in de afrondtijd wordt geaccepteerd, eentje vóór de start niet
r = await obs[1].c.post('/observer/sync', { items: [
  { type: 'score', team_id: t1, criterion_id: s2.criteria[0].items[0].id, value: 8, ts: Date.now() - 100 },
  { type: 'score', team_id: t1, criterion_id: s2.criteria[0].items[0].id, value: 4, ts: Date.now() - 3600e3 },
] });
assert.deepEqual(r.results.map((x) => x.ok), [true, false]);
ok('offline wachtrij: tijdstippen buiten het beoordelingsvenster worden afgewezen');

await jury.post(`/teams/${t1}/action`, { action: 'lock' });
r = await obs[1].c.put('/observer/score', { team_id: t1, criterion_id: s2.criteria[0].items[0].id, value: 7, ts: Date.now() });
assert.equal(r.results[0].reason, 'closed');
js = await jury.get(`/days/${dayId}/state`);
const T1 = js.teams[0];
assert.equal(T1.status, 'done');
assert.equal(T1.rank, 1);
// totaal: criteria + redbonus + speelbonus; speel ~1,5 s → 29 min over → floor(29,97)=29; red ~1,2 s → floor(19,98)=19
assert.equal(T1.red, 19);
assert.equal(T1.sp, 29);
assert.equal(T1.total, T1.crit + 19 + 29);
ok(`vergrendelen werkt; bonus 1 punt per resterende minuut klopt (totaal ${T1.total})`);

console.log('Correcties en planning');
await jury.post(`/teams/${t1}/correct`, { criterion_id: firstItem.id, role_id: roles[3].id, value: 6, reason: '' }, 400);
const before = T1.total;
await jury.post(`/teams/${t1}/correct`, { criterion_id: firstItem.id, role_id: roles[3].id, value: 6, reason: 'Verkeerde knop, bevestigd door waarnemer' });
js = await jury.get(`/days/${dayId}/state`);
assert.equal(js.teams[0].total, before + 2);
assert.ok(js.events.some((e) => e.kind === 'CORRECTIE'));
ok('correctie vraagt toelichting en werkt de score bij (4 → 6)');

const shiftRes = await jury.post(`/days/${dayId}/shift`, { minutes: 10 });
assert.equal(shiftRes.shifted, 2);
await jury.post(`/teams/${teamIds[2]}/action`, { action: 'out', reason: '' }, 400);
await jury.post(`/teams/${teamIds[2]}/action`, { action: 'out', reason: 'Uitgerukt voor echte melding' });
js = await jury.get(`/days/${dayId}/state`);
assert.equal(js.teams[2].status, 'out');
await jury.patch(`/teams/${teamIds[1]}`, { start: '13:00' });
await jury.patch(`/teams/${t1}`, { start: '13:00' }, 409);
ok('planning verschuiven, ploeg laten vervallen (met reden) en tijden aanpassen');

console.log('Tweede ploeg en prijsuitreiking');
const t2 = teamIds[1];
await jury.post(`/teams/${t2}/action`, { action: 'start' });
for (let i = 0; i < 4; i++) await scoreAll(obs[i], t2, 7);
await new Promise((res) => setTimeout(res, 400));
await jury.post(`/teams/${t2}/action`, { action: 'rescued' });
await jury.post(`/teams/${t2}/action`, { action: 'end' });
await jury.post(`/teams/${t2}/action`, { action: 'lock' });
js = await jury.get(`/days/${dayId}/state`);
assert.equal(js.teams.filter((t) => t.rank).length, 2);
assert.equal(js.teams[0].rank, 1);

// groot scherm: scores verbergen
const key = cfg.day.display_key;
const pub = new Client();
let ds = await pub.get(`/display/${key}/state`);
assert.ok(ds.teams[0].total > 0);
await jury.post(`/days/${dayId}/show-scores`, { on: false });
ds = await pub.get(`/display/${key}/state`);
assert.equal(ds.teams[0].total, undefined);
ok('groot scherm toont scores alleen als de jury dat toestaat');
await pub.get('/display/onbekend/state', 404);

await jury.post(`/days/${dayId}/ceremony`, { action: 'start' });
ds = await pub.get(`/display/${key}/state`);
assert.deepEqual(ds.board.map((b) => !!b.hidden), [true, true]);
assert.ok(!JSON.stringify(ds).includes('"total"'));
await jury.post(`/days/${dayId}/ceremony`, { action: 'next' });
ds = await pub.get(`/display/${key}/state`);
assert.equal(ds.board[1].hidden, undefined); // plek 2 onthuld
assert.equal(ds.board[0].hidden, true);
assert.equal(ds.charts, undefined);
await jury.post(`/days/${dayId}/ceremony`, { action: 'next' });
ds = await pub.get(`/display/${key}/state`);
assert.equal(ds.board[0].rank, 1);
assert.equal(ds.charts.teams.length, 2);
ok('prijsuitreiking onthult van laatste naar eerste; verborgen plekken lekken geen gegevens');

await jury.post(`/days/${dayId}/phase`, { phase: 'locked' });
await obs[0].c.put('/observer/score', { team_id: teamIds[1], criterion_id: items0[0].id, value: 9, ts: Date.now() })
  .then((x) => assert.equal(x.results[0].reason, 'day_locked'));
const csv = await fetch(`${base}/days/${dayId}/export.csv`, { headers: { cookie: jury.cookie } });
assert.equal(csv.status, 200);
assert.ok((await csv.text()).includes('Post 1'));
const sheet = await jury.get(`/teams/${t1}/sheet`);
assert.equal(sheet.corrections.length, 1);
ok('vergrendelde dag weigert scores; CSV-export en scoreblad werken');

console.log('Meerdere slachtoffers');
const d3 = await admin.post('/days', { title: 'Drie slachtoffers', victims: 3 });
assert.equal((await admin.get(`/days/${d3.id}/config`)).settings.victims, 3);
const tm3 = (await admin.post(`/days/${d3.id}/teams`, { name: 'Post A', meld: '09:00', start: '09:20' })).id;
await admin.patch(`/days/${d3.id}`, { settings: { victims: 2 } });
await admin.post(`/teams/${tm3}/action`, { action: 'start' });
await admin.patch(`/days/${d3.id}`, { settings: { victims: 1 } }, 409);
await admin.post(`/teams/${tm3}/action`, { action: 'rescued' });
let s3 = (await admin.get(`/days/${d3.id}/state`)).teams[0];
assert.equal(s3.rescued_n, 1);
assert.equal(s3.rescued_at, null);
await admin.post(`/teams/${tm3}/action`, { action: 'unrescue' });
await admin.post(`/teams/${tm3}/action`, { action: 'rescued' });
await admin.post(`/teams/${tm3}/action`, { action: 'rescued' });
await admin.post(`/teams/${tm3}/action`, { action: 'rescued' }, 409);
s3 = (await admin.get(`/days/${d3.id}/state`)).teams[0];
assert.equal(s3.rescued_n, 2);
assert.ok(s3.rescued_at);
assert.equal(s3.rescues.length, 2);
ok('meerdere slachtoffers: redtijd pas bepaald na het laatste slachtoffer; ongedaan maken werkt; aantal vergrendelt na de start');
await admin.del(`/days/${d3.id}`);

await admin.del(`/teams/${t1}`, 409);
await admin.del(`/days/${other.id}`);
ok('gestarte ploeg kan niet verwijderd worden; dag verwijderen werkt');

console.log(`\n${pass} controles geslaagd`);
server.close();
process.exit(0);
