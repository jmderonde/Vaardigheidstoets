// Acties op een ploeg (aanwezig, ready, start, slachtoffers gered, einde, ...). Gedeeld door jury en baanleider.
import { all, run } from './db.js';
import { bad } from './util.js';
import { loadConfig, logEvent, teamStatus } from './logic.js';

export const fmtMs = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/* Welke acties mag de baanleider doen? De jury mag alles. */
export const BAAN_ACTIONS = ['gemeld', 'ready', 'start', 'rescued', 'unrescue', 'end'];

export async function performTeamAction(t, action, { reason = '', on = true } = {}, actor, allowed = null) {
  if (allowed && !allowed.includes(action)) bad('Deze actie is niet toegestaan voor jouw rol.', 403);
  const cfg = await loadConfig(t.day_id);
  const s = cfg.settings;
  const now = Date.now();
  const st = teamStatus(t, now, s);
  const log = (kind, tone, text) => logEvent(t.day_id, kind, tone, `${text} · ${actor}`);
  if (cfg.day.phase === 'locked' && action !== 'restore') bad('De uitslag is vergrendeld. Ontgrendel eerst de wedstrijddag.', 409);
  const victims = s.victims || 1;
  const rescues = await all('SELECT seq,at FROM rescues WHERE team_id=? ORDER BY seq', [t.id]);
  const rescuedN = rescues.length || (t.rescued_at ? victims : 0);

  switch (action) {
    case 'gemeld': {
      if (!['plan', 'ready'].includes(st)) bad('Deze ploeg kan niet meer als aanwezig gemarkeerd worden.', 409);
      await run('UPDATE teams SET gemeld_at=? WHERE id=?', [on ? now : null, t.id]);
      await log('AANWEZIG', 'i', on ? `${t.name} is aanwezig` : `${t.name}: aanwezigheid ingetrokken`);
      break;
    }
    case 'ready': {
      if (!['plan', 'ready'].includes(st)) bad('Deze ploeg kan niet meer op ready gezet worden.', 409);
      await run('UPDATE teams SET ready_at=?,ready_by=?,gemeld_at=COALESCE(gemeld_at,?) WHERE id=?', [on ? now : null, on ? actor : null, on ? now : null, t.id]);
      await log('READY', 'i', on ? `${t.name} klaar om te starten` : `${t.name}: ready ingetrokken`);
      break;
    }
    case 'start': {
      if (!['plan', 'ready'].includes(st)) bad('Deze ploeg kan niet gestart worden.', 409);
      const other = cfg.teams.find((x) => x.id !== t.id && ['run', 'wrap'].includes(teamStatus(x, now, s)));
      if (other) {
        const os = teamStatus(other, now, s);
        bad(os === 'run' ? `${other.name} is nog bezig.` : `De waarnemers van ${other.name} hebben nog afrondtijd tot ${new Date(other.ended_at + s.wrapMin * 60000).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Amsterdam' })}.`, 409);
      }
      await run('UPDATE teams SET started_at=?,rescued_at=NULL,ended_at=NULL,locked=0 WHERE id=?', [now, t.id]);
      await run('DELETE FROM rescues WHERE team_id=?', [t.id]);
      if (cfg.day.phase === 'prep') await run('UPDATE days SET phase=\'active\' WHERE id=?', [t.day_id]);
      await log('START', 'i', `Inzet ${t.name} gestart`);
      break;
    }
    case 'rescued': {
      if (st !== 'run') bad('De inzet loopt niet.', 409);
      if (rescuedN >= victims) bad(victims > 1 ? 'Alle slachtoffers zijn al gered.' : 'Het slachtoffer is al als gered gemarkeerd.', 409);
      const seq = rescuedN + 1;
      await run('INSERT OR REPLACE INTO rescues(team_id,seq,at) VALUES(?,?,?)', [t.id, seq, now]);
      if (seq >= victims) await run('UPDATE teams SET rescued_at=? WHERE id=?', [now, t.id]);
      await log('GERED', 'o', victims > 1
        ? `Slachtoffer ${seq} van ${victims} gered · ${fmtMs(now - t.started_at)}`
        : `Slachtoffer gered · redtijd ${fmtMs(now - t.started_at)}`);
      break;
    }
    case 'unrescue': {
      if (st !== 'run') bad('De inzet loopt niet.', 409);
      if (!rescuedN) bad('Er is nog geen slachtoffer als gered gemarkeerd.', 409);
      await run('DELETE FROM rescues WHERE team_id=? AND seq=?', [t.id, rescuedN]);
      await run('UPDATE teams SET rescued_at=NULL WHERE id=?', [t.id]);
      await log('GERED', 'w', `Laatste redding ongedaan gemaakt (${rescuedN - 1} van ${victims} gered)`);
      break;
    }
    case 'end': {
      if (st !== 'run') bad('De inzet loopt niet.', 409);
      await run('UPDATE teams SET ended_at=? WHERE id=?', [now, t.id]);
      await log('EINDE', 'i', `Einde inzet ${t.name} · speeltijd ${fmtMs(now - t.started_at)} · ${s.wrapMin} min afrondtijd${rescuedN >= victims ? '' : ` · ${rescuedN} van ${victims} slachtoffers als gered gemarkeerd`}`);
      break;
    }
    case 'lock': {
      if (st !== 'wrap') bad('Alleen een ploeg in afrondtijd kan voortijdig vergrendeld worden.', 409);
      await run('UPDATE teams SET locked=1 WHERE id=?', [t.id]);
      await log('SLOT', 'o', `Beoordeling ${t.name} vergrendeld`);
      break;
    }
    case 'abort': {
      if (!['run', 'wrap', 'done'].includes(st)) bad('Er is niets af te breken.', 409);
      if (String(reason).length < 3) bad('Geef een reden voor het afbreken.');
      await run('DELETE FROM scores WHERE team_id=?', [t.id]);
      await run('DELETE FROM finals WHERE team_id=?', [t.id]);
      await run('DELETE FROM rescues WHERE team_id=?', [t.id]);
      await run('UPDATE teams SET started_at=NULL,rescued_at=NULL,ended_at=NULL,locked=0 WHERE id=?', [t.id]);
      await log('AFGEBROKEN', 'x', `Inzet ${t.name} afgebroken, tijden en scores gewist · “${reason}”`);
      break;
    }
    case 'out': {
      if (!['plan', 'ready'].includes(st)) bad('Alleen een ploeg die nog niet gestart is kan vervallen.', 409);
      if (String(reason).length < 3) bad('Geef een reden waarom de ploeg vervalt.');
      await run('UPDATE teams SET out=1,out_reason=?,ready_at=NULL WHERE id=?', [reason, t.id]);
      await log('VERVALLEN', 'x', `${t.name} vervalt · “${reason}”`);
      break;
    }
    case 'restore': {
      if (st !== 'out') bad('Deze ploeg is niet vervallen.', 409);
      await run('UPDATE teams SET out=0,out_reason=NULL WHERE id=?', [t.id]);
      await log('PLANNING', 'v', `${t.name} weer in de planning opgenomen`);
      break;
    }
    default: bad('Onbekende actie');
  }
}
