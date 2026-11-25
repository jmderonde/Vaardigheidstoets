import crypto from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const bad = (message, status = 400) => {
  throw new HttpError(status, message);
};
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
export const rid = (n = 24) => crypto.randomBytes(n).toString('base64url').slice(0, n);
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // geen 0/O/1/I
export const code = (n = 6) => {
  const b = crypto.randomBytes(n);
  let s = '';
  for (let i = 0; i < n; i++) s += ALPH[b[i] % ALPH.length];
  return s;
};
export const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
export const int = (v, def = null) => (Number.isInteger(Number(v)) && v !== '' && v !== null ? Number(v) : def);
export const hm = (s) => {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(s ?? ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
export const toHM = (min) => {
  min = Math.max(0, Math.min(1439, min));
  return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
};
export const normHM = (s) => (hm(s) == null ? null : toHM(hm(s)));
