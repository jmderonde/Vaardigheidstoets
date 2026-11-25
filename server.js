import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { get, migrate, run } from './src/db.js';
import { attachUser, hashPw } from './src/auth.js';
import { HttpError } from './src/util.js';
import { authRouter } from './src/routes/auth.js';
import { adminRouter } from './src/routes/admin.js';
import { juryRouter } from './src/routes/jury.js';
import { observerRouter } from './src/routes/observer.js';
import { displayRouter } from './src/routes/display.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function createApp() {
  await migrate();
  await ensureAdmin();

  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });
  app.use(express.json({ limit: '300kb' }));
  app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
  }));

  app.get('/healthz', (req, res) => res.json({ ok: true }));

  app.use('/api', attachUser, (req, res, next) => {
    // Alleen JSON-verzoeken voor wijzigingen (extra bescherming naast SameSite-cookies).
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['content-length'] > 0 && !String(req.headers['content-type'] || '').includes('json')) {
      return res.status(415).json({ error: 'Alleen JSON' });
    }
    next();
  });
  app.use('/api', authRouter, adminRouter, juryRouter, observerRouter, displayRouter);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Niet gevonden' }));

  // Alle andere paden: de single-page app.
  app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Ongeldige invoer' });
    console.error(err);
    res.status(500).json({ error: 'Er ging iets mis op de server.' });
  });
  return app;
}

async function ensureAdmin() {
  const admin = await get('SELECT id FROM users WHERE role=\'admin\' LIMIT 1');
  if (admin) return;
  let email = process.env.ADMIN_EMAIL;
  let pw = process.env.ADMIN_PASSWORD;
  if (!email || !pw) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[start] Er is nog geen beheerder. Stel ADMIN_EMAIL en ADMIN_PASSWORD in en herstart.');
      return;
    }
    email = 'admin@example.com';
    pw = 'admin12345';
    console.warn(`[start] Ontwikkelmodus: beheerder ${email} met wachtwoord ${pw}`);
  }
  await run('INSERT INTO users(email,name,pw,role,created_at) VALUES(?,?,?,\'admin\',?)', [email.toLowerCase(), 'Beheerder', hashPw(pw), Date.now()]);
  console.log(`[start] Beheerder aangemaakt: ${email}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const port = Number(process.env.PORT) || 3000;
  createApp().then((app) => app.listen(port, () => console.log(`Vaardigheidstoets draait op http://localhost:${port}`)));
}
