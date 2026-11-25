import { Router } from 'express';
import { get } from '../db.js';
import { checkPw, clearSession, limit, requireUser, setSession } from '../auth.js';
import { ah, bad, str } from '../util.js';

export const authRouter = Router();

authRouter.post('/login', ah(async (req, res) => {
  const email = str(req.body.email, 120).toLowerCase();
  const password = String(req.body.password || '');
  if (!limit(`login:${req.ip}:${email}`, 8, 15 * 60e3)) bad('Te veel pogingen. Probeer het over een kwartier opnieuw.', 429);
  const u = await get('SELECT * FROM users WHERE email=?', [email]);
  if (!u || !checkPw(password, u.pw)) bad('E-mailadres of wachtwoord klopt niet.', 401);
  setSession(req, res, u.id);
  res.json({ user: { id: u.id, email: u.email, name: u.name, role: u.role } });
}));

authRouter.post('/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

authRouter.get('/me', (req, res) => res.json({ user: req.user || null }));

authRouter.post('/password', requireUser, ah(async (req, res) => {
  const { hashPw } = await import('../auth.js');
  const { run } = await import('../db.js');
  const u = await get('SELECT * FROM users WHERE id=?', [req.user.id]);
  if (!checkPw(String(req.body.current || ''), u.pw)) bad('Huidig wachtwoord klopt niet.', 401);
  const next = String(req.body.next || '');
  if (next.length < 8) bad('Het nieuwe wachtwoord moet minimaal 8 tekens hebben.');
  await run('UPDATE users SET pw=? WHERE id=?', [hashPw(next), u.id]);
  res.json({ ok: true });
}));
