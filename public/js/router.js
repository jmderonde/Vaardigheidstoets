import { api } from './lib.js';

const routes = [];
let cleanup = null;
let me;
export const root = () => document.getElementById('app');
export const register = (re, view) => routes.push([re, view]);

export async function getMe(force = false) {
  if (me === undefined || force) {
    try { me = (await api('GET', '/me')).user; } catch { me = null; }
  }
  return me;
}
export async function requireLogin() {
  const u = await getMe(true);
  if (!u) { await go('/login', true); return null; }
  return u;
}

export async function go(path, replace = false) {
  history[replace ? 'replaceState' : 'pushState'](null, '', path);
  await render();
}

let seq = 0;
export async function render() {
  const mine = ++seq;
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  document.body.className = '';
  // Een vers element per scherm, zodat eventlisteners van het vorige scherm vervallen.
  const old = root();
  const r = old.cloneNode(false);
  old.replaceWith(r);
  for (const [re, view] of routes) {
    const m = re.exec(location.pathname);
    if (!m) continue;
    try {
      const c = await view(r, m.slice(1), new URLSearchParams(location.search));
      if (mine !== seq) { if (c) c(); return; }
      cleanup = c || null;
    } catch (e) {
      r.innerHTML = `<div class="p" style="max-width:520px;margin:60px auto"><h2><span>Er ging iets mis</span></h2><p>${(e && e.message) || e}</p><a class="btn" href="/" data-link>Naar het begin</a></div>`;
    }
    return;
  }
  r.innerHTML = '<div class="p" style="max-width:520px;margin:60px auto"><h2><span>Pagina niet gevonden</span></h2><a class="btn" href="/" data-link>Naar het begin</a></div>';
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (a && !e.metaKey && !e.ctrlKey && !e.shiftKey && a.target !== '_blank') { e.preventDefault(); go(a.getAttribute('href')); }
});
window.addEventListener('popstate', render);

export const header = (user, extra = '') => `
 <header class="top">
  <a class="brand" href="/" data-link><span class="logo"></span><span><b>Vaardigheidstoets</b><small>${user ? (user.role === 'admin' ? 'Beheerder' : 'Jury') + ' · ' + (user.name || user.email) : 'Brandweer'}</small></span></a>
  <div class="top-r">${extra}${user ? '<a class="btn sm" href="/days" data-link>Wedstrijddagen</a><button class="btn sm" data-logout>Uitloggen</button>' : ''}</div>
 </header>`;

export function wireLogout(el) {
  const b = el.querySelector('[data-logout]');
  if (b) b.onclick = async () => { await api('POST', '/logout', {}); await getMe(true); go('/login'); };
}
