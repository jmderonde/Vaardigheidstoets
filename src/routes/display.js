import { Router } from 'express';
import { get } from '../db.js';
import { ah, bad } from '../util.js';
import { subscribe } from '../hub.js';
import { displayState } from '../state.js';

export const displayRouter = Router();

async function byKey(req, res, next) {
  try {
    const day = await get('SELECT * FROM days WHERE display_key=?', [String(req.params.key)]);
    if (!day) return res.status(404).json({ error: 'Onbekend scherm' });
    req.day = day;
    next();
  } catch (e) { next(e); }
}
displayRouter.get('/display/:key/state', byKey, ah(async (req, res) => res.json(await displayState(req.day))));
displayRouter.get('/display/:key/stream', byKey, (req, res) => subscribe(req.day.id, req, res));
export { bad };
