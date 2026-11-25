import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';

// Lokaal: een SQLite-bestand. Productie: Turso (TURSO_DATABASE_URL + TURSO_AUTH_TOKEN).
const url = process.env.TURSO_DATABASE_URL || 'file:data/local.db';
if (url.startsWith('file:')) fs.mkdirSync(path.dirname(url.slice(5)) || '.', { recursive: true });

export const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN || undefined });

const plain = (r) => {
  const o = {};
  for (const k of Object.keys(r)) if (Number.isNaN(Number(k))) o[k] = typeof r[k] === 'bigint' ? Number(r[k]) : r[k];
  return o;
};
export async function all(sql, args = []) {
  const r = await db.execute({ sql, args });
  return r.rows.map(plain);
}
export async function get(sql, args = []) {
  return (await all(sql, args))[0];
}
export async function run(sql, args = []) {
  const r = await db.execute({ sql, args });
  return { changes: r.rowsAffected, id: r.lastInsertRowid == null ? null : Number(r.lastInsertRowid) };
}
export const batch = (stmts) => db.batch(stmts.map(([sql, args]) => ({ sql, args: args || [] })), 'write');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, name TEXT, pw TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'jury', created_at INTEGER);
CREATE TABLE IF NOT EXISTS days(
  id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, date TEXT, place TEXT, trophy TEXT,
  join_code TEXT UNIQUE, display_key TEXT UNIQUE, settings TEXT, phase TEXT DEFAULT 'prep',
  show_scores INTEGER DEFAULT 1, ceremony INTEGER DEFAULT 0, reveal INTEGER DEFAULT 0, created_at INTEGER);
CREATE TABLE IF NOT EXISTS day_jury(day_id INTEGER, user_id INTEGER, PRIMARY KEY(day_id,user_id));
CREATE TABLE IF NOT EXISTS roles(id INTEGER PRIMARY KEY AUTOINCREMENT, day_id INTEGER, name TEXT, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS categories(id INTEGER PRIMARY KEY AUTOINCREMENT, day_id INTEGER, name TEXT, short TEXT, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS criteria(id INTEGER PRIMARY KEY AUTOINCREMENT, day_id INTEGER, category_id INTEGER, name TEXT, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS criterion_roles(criterion_id INTEGER, role_id INTEGER, PRIMARY KEY(criterion_id,role_id));
CREATE TABLE IF NOT EXISTS teams(
  id INTEGER PRIMARY KEY AUTOINCREMENT, day_id INTEGER, name TEXT, sort INTEGER DEFAULT 0,
  meld TEXT, start TEXT, out INTEGER DEFAULT 0, out_reason TEXT,
  gemeld_at INTEGER, ready_at INTEGER, ready_by TEXT,
  started_at INTEGER, rescued_at INTEGER, ended_at INTEGER, locked INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS observers(
  id INTEGER PRIMARY KEY AUTOINCREMENT, day_id INTEGER, name TEXT, token TEXT UNIQUE,
  role_id INTEGER, timekeeper INTEGER DEFAULT 0, status TEXT DEFAULT 'pending', last_seen INTEGER, created_at INTEGER);
CREATE TABLE IF NOT EXISTS scores(
  team_id INTEGER, criterion_id INTEGER, role_id INTEGER, value INTEGER, note TEXT,
  observer_id INTEGER, updated_at INTEGER, PRIMARY KEY(team_id,criterion_id,role_id));
CREATE TABLE IF NOT EXISTS finals(team_id INTEGER, role_id INTEGER, at INTEGER, PRIMARY KEY(team_id,role_id));
CREATE TABLE IF NOT EXISTS corrections(
  id INTEGER PRIMARY KEY AUTOINCREMENT, team_id INTEGER, criterion_id INTEGER, role_id INTEGER,
  old_value INTEGER, new_value INTEGER, reason TEXT, user TEXT, at INTEGER);
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, day_id INTEGER, at INTEGER, kind TEXT, tone TEXT, text TEXT);
CREATE INDEX IF NOT EXISTS idx_teams_day ON teams(day_id);
CREATE INDEX IF NOT EXISTS idx_obs_day ON observers(day_id);
CREATE INDEX IF NOT EXISTS idx_events_day ON events(day_id,id);
`;

export async function migrate() {
  await db.executeMultiple(SCHEMA);
}
