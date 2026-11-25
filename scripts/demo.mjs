// Maakt een demo-wedstrijddag "halverwege de dag" in de database waar de app nu naar wijst.
// Lokaal (standaard): data/local.db. LET OP: met TURSO_DATABASE_URL gezet schrijft dit naar je echte database.
//   node scripts/demo.mjs --yes
import { migrate, run, get } from '../src/db.js';
import { createDay, loadConfig, cellsOf } from '../src/logic.js';
import { hashPw } from '../src/auth.js';

if (!process.argv.includes('--yes')) {
  console.log('Dit maakt een demo-wedstrijddag aan in', process.env.TURSO_DATABASE_URL || 'data/local.db', '\nHerhaal met --yes om door te gaan.');
  process.exit(0);
}
await migrate();
const MIN = 60000;
const now = Date.now();
const hm = (ms) => new Intl.DateTimeFormat('nl-NL', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Amsterdam' }).format(ms);
let seed = 20261128;
const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const dayId = await createDay({ title: 'Vaardigheidstoets (demo)', date: new Date(now).toISOString().slice(0, 10), place: 'Organiserende post', trophy: 'De wisselbeker' });
let u = await get('SELECT id FROM users WHERE email=?', ['jury@example.com']);
if (!u) u = { id: (await run('INSERT INTO users(email,name,pw,role,created_at) VALUES(?,?,?,?,?)', ['jury@example.com', 'Demo Jurylid', hashPw('jury12345'), 'jury', now])).id };
await run('INSERT OR IGNORE INTO day_jury(day_id,user_id) VALUES(?,?)', [dayId, u.id]);

const names = ['Nieuwegein-Noord', 'Voorbeeldpost 2', 'Voorbeeldpost 3', 'Voorbeeldpost 4', 'Voorbeeldpost 5', 'Voorbeeldpost 6', 'Voorbeeldpost 7', 'Voorbeeldpost 8', 'Voorbeeldpost 9', 'Voorbeeldpost 10'];
const slot = 40 * MIN, anchor = now - 21 * MIN; // ploeg 6 start 21 minuten geleden
const ids = [];
for (let i = 0; i < 10; i++) {
  const start = anchor + (i - 5) * slot;
  ids.push((await run('INSERT INTO teams(day_id,name,sort,meld,start) VALUES(?,?,?,?,?)', [dayId, names[i], i, hm(start - 20 * MIN), hm(start)])).id);
}
let cfg = await loadConfig(dayId);
const cells = cellsOf(cfg);
const role = (name) => cfg.roles.find((r) => r.name === name).id;

async function play(i, skill, speelMin, redMin, running = false, partial = 1) {
  const start = anchor + (i - 5) * slot, id = ids[i];
  const ended = running ? null : start + Math.round(speelMin * MIN);
  await run('UPDATE teams SET gemeld_at=?,ready_at=?,ready_by=?,started_at=?,rescued_at=?,ended_at=? WHERE id=?', [start - 15 * MIN, start - 5 * MIN, 'Demo Tijdwaarnemer (tijdwaarnemer)', start, start + Math.round(redMin * MIN), ended, id]);
  let n = 0;
  for (const c of cells) {
    n++;
    if (partial < 1 && n > cells.length * partial) continue;
    let v = Math.max(4, Math.min(10, Math.round(skill + (rnd() - 0.5) * 3)));
    await run('INSERT INTO scores(team_id,criterion_id,role_id,value,note,observer_id,updated_at) VALUES(?,?,?,?,?,NULL,?)', [id, c.crit.id, c.role, v, v <= 5 ? 'Voorbeeldtoelichting.' : '', start + 10 * MIN]);
  }
  if (!running) for (const r of cfg.roles) await run('INSERT OR IGNORE INTO finals(team_id,role_id,at) VALUES(?,?,?)', [id, r.id, ended + MIN]);
}
const sk = [8.0, 7.6, 7.2, 6.9, 8.3];
const sp = [21, 24.6, 19.7, 26.2, 17.9], rd = [2, 6.4, 4.1, 9.5, 3.3];
for (let i = 0; i < 5; i++) await play(i, sk[i], sp[i], rd[i]);
await play(5, 7.7, 0, 5.2, true, 0.8);
await run('UPDATE teams SET gemeld_at=?,ready_at=?,ready_by=? WHERE id=?', [now - 3 * MIN, now - 1 * MIN, 'Demo Tijdwaarnemer (tijdwaarnemer)', ids[6]]);

// waarnemers (vaste tokens, zodat je ze lokaal kunt uitproberen)
const obs = [['Kees Jansen', 'Bevelvoerder'], ['Anouk Bakker', '1 en 2'], ['Mo El Idrissi', '3 en 4'], ['Sander Visser', 'Chauffeur']];
for (const [i, [name, r]] of obs.entries()) await run('INSERT INTO observers(day_id,name,token,role_id,status,last_seen,created_at) VALUES(?,?,?,?,\'linked\',?,?)', [dayId, name, `demo-obs-${i + 1}`, role(r), i === 2 ? now - 120000 : now, now]);
await run('INSERT INTO observers(day_id,name,token,timekeeper,status,last_seen,created_at) VALUES(?,?,?,1,\'linked\',?,?)', [dayId, 'Roos Smit', 'demo-obs-tijd', now, now]);
await run('INSERT INTO observers(day_id,name,token,status,last_seen,created_at) VALUES(?,?,?,\'pending\',?,?)', [dayId, 'Lotte Smit', 'demo-obs-wacht', now, now]);
const ev = (m, kind, tone, text) => run('INSERT INTO events(day_id,at,kind,tone,text) VALUES(?,?,?,?,?)', [dayId, now - m * MIN, kind, tone, text]);
await ev(1, 'READY', 'i', `${names[6]} klaar om te starten · Roos Smit (tijdwaarnemer)`);
await ev(3, 'GEMELD', 'i', `${names[6]} heeft zich gemeld`);
await ev(5, 'AANMELDING', 'w', 'Lotte Smit meldt zich aan en wacht op koppeling');
await ev(16, 'GERED', 'o', 'Slachtoffer gered · redtijd 05:12');
await ev(21, 'START', 'i', `Inzet ${names[5]} gestart · Demo Jurylid`);
await ev(45, 'SLOT', 'o', `Beoordeling ${names[4]} vergrendeld`);
console.log(`Demo-dag ${dayId} aangemaakt.\n  jury:  jury@example.com / jury12345\n  waarnemer-tokens: demo-obs-1 … demo-obs-4, demo-obs-tijd`);
process.exit(0);
