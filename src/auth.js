import crypto from 'node:crypto';
import { get } from './db.js';
import { bad } from './util.js';

if (!process.env.SESSION_SECRET && process.env.NODE_ENV === 'production') {
  console.warn('[auth] SESSION_SECRET ontbreekt: sessies vervallen bij elke herstart. Stel de variabele in.');
}
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const COOKIE = 'vt_session';

export function hashPw(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `s1$${salt}$${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
export function checkPw(pw, stored) {
  const [v, salt, h] = String(stored || '').split('$');
  if (v !== 's1' || !salt || !h) return false;
  const a = crypto.scryptSync(String(pw), salt, 64);
  const b = Buffer.from(h, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const sign = (p) => crypto.createHmac('sha256', SECRET).update(p).digest('base64url');
export function makeToken(uid, days = 7) {
  const p = Buffer.from(JSON.stringify({ u: uid, e: Date.now() + days * 864e5 })).toString('base64url');
  return `${p}.${sign(p)}`;
}
function readToken(t) {
  const [p, s] = String(t || '').split('.');
  if (!p || !s) return null;
  const good = sign(p);
  if (s.length !== good.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(good))) return null;
  try {
    const o = JSON.parse(Buffer.from(p, 'base64url').toString());
    return o.e > Date.now() ? o : null;
  } catch {
    return null;
  }
}
function cookieOf(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
export function setSession(req, res, uid) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.append('Set-Cookie', `${COOKIE}=${makeToken(uid)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${7 * 86400}${secure ? '; Secure' : ''}`);
}
export function clearSession(res) {
  res.append('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

export async function attachUser(req, res, next) {
  try {
    const p = readToken(cookieOf(req, COOKIE));
    req.user = p ? (await get('SELECT id,email,name,role FROM users WHERE id=?', [p.u])) || null : null;
    next();
  } catch (e) {
    next(e);
  }
}
export const requireUser = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Niet ingelogd' }));
export const requireAdmin = (req, res, next) =>
  !req.user ? res.status(401).json({ error: 'Niet ingelogd' }) : req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Alleen voor de beheerder' });

// Controleert of de gebruiker bij de wedstrijddag hoort (beheerder of gekoppeld jurylid).
export async function canAccessDay(user, dayId) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return !!(await get('SELECT 1 AS x FROM day_jury WHERE day_id=? AND user_id=?', [dayId, user.id]));
}
export async function dayAccess(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ error: 'Niet ingelogd' });
    const id = Number(req.params.dayId);
    if (!Number.isInteger(id)) bad('Ongeldige wedstrijddag');
    if (!(await canAccessDay(req.user, id))) return res.status(403).json({ error: 'Geen toegang tot deze wedstrijddag' });
    req.dayId = id;
    next();
  } catch (e) {
    next(e);
  }
}

// Eenvoudige in-memory begrenzing tegen het raden van wachtwoorden en codes.
const hits = new Map();
export function limit(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    hits.set(key, arr);
    return false;
  }
  arr.push(now);
  hits.set(key, arr);
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (!v.some((t) => now - t < 3600e3)) hits.delete(k);
}, 600e3).unref();
