export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const f2 = (n) => String(n).padStart(2, '0');
export const fmtMs = (ms) => {
  if (ms == null || Number.isNaN(ms)) return '–';
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${f2(Math.floor(s / 60))}:${f2(s % 60)}`;
};
export const clockOf = (ms) => { const d = new Date(ms); return `${f2(d.getHours())}:${f2(d.getMinutes())}`; };
export const clockSec = (ms) => { const d = new Date(ms); return `${f2(d.getHours())}:${f2(d.getMinutes())}:${f2(d.getSeconds())}`; };
export const fmtN = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ','));
export const f1 = (n) => (n == null || Number.isNaN(n) ? '–' : n.toFixed(1).replace('.', ','));

/* ---------- API ---------- */
export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}
export async function api(method, url, body, headers = {}) {
  let res;
  try {
    res = await fetch('/api' + url, {
      method, headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin',
    });
  } catch {
    throw new ApiError('Geen verbinding met de server.', 0);
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* geen json */ }
  if (!res.ok) throw new ApiError((json && json.error) || `Fout ${res.status}`, res.status);
  return json;
}

/* Serverklok: alle schermen rekenen met de tijd van de server. */
let offset = 0;
export const setOffset = (serverNow) => { if (serverNow) offset = serverNow - Date.now(); };
export const snow = () => Date.now() + offset;

/* Realtime-meldingen (SSE). EventSource verbindt zelf opnieuw. */
export function sse(url, onChange, onStatus) {
  const es = new EventSource(url);
  es.addEventListener('change', () => onChange());
  es.addEventListener('hello', () => { onStatus && onStatus(true); onChange(); });
  es.onerror = () => onStatus && onStatus(false);
  return () => es.close();
}

/* ---------- UI-hulpjes ---------- */
export function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  t.setAttribute('role', 'status');
  document.body.append(t);
  setTimeout(() => t.remove(), 3800);
}
export const fail = (e) => toast(e && e.message ? e.message : String(e), 'bad');

/* Modal met invoervelden. Resolve met de waarden, of null bij annuleren. */
export function ask({ title, text = '', fields = [], ok = 'Opslaan', cancel = 'Annuleren', danger = false }) {
  return new Promise((resolve) => {
    const m = document.createElement('div');
    m.className = 'modal';
    const inputs = fields.map((f) => {
      const id = 'f_' + f.name;
      const val = f.value ?? '';
      let el;
      if (f.type === 'textarea') el = `<textarea id="${id}" rows="3" placeholder="${esc(f.placeholder || '')}">${esc(val)}</textarea>`;
      else if (f.type === 'select') el = `<select id="${id}">${f.options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
      else el = `<input id="${id}" type="${f.type || 'text'}" value="${esc(val)}" placeholder="${esc(f.placeholder || '')}" autocomplete="${f.type === 'password' ? 'new-password' : 'off'}" ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''}>`;
      return `<label class="f" style="margin-bottom:10px">${esc(f.label)}${el}</label>`;
    }).join('');
    m.innerHTML = `<form class="box" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h3>${esc(title)}</h3>${text ? `<p class="ink2" style="margin-top:0">${text}</p>` : ''}${inputs}<div class="err" id="mErr"></div>
      <div class="row" style="justify-content:flex-end;margin-top:12px"><button type="button" class="btn" data-x>${esc(cancel)}</button><button class="btn ${danger ? 'dng' : 'pri'}">${esc(ok)}</button></div></form>`;
    document.body.append(m);
    const close = (v) => { m.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);
    m.querySelector('[data-x]').onclick = () => close(null);
    m.addEventListener('mousedown', (e) => { if (e.target === m) close(null); });
    m.querySelector('form').onsubmit = (e) => {
      e.preventDefault();
      const out = {};
      for (const f of fields) {
        const v = m.querySelector('#f_' + f.name).value.trim();
        if (f.required && !v) return (m.querySelector('#mErr').textContent = `${f.label} is verplicht.`);
        if (f.minLength && v.length < f.minLength) return (m.querySelector('#mErr').textContent = `${f.label}: minimaal ${f.minLength} tekens.`);
        out[f.name] = v;
      }
      close(out);
    };
    const first = m.querySelector('input,textarea,select');
    (first || m.querySelector('.btn.pri,.btn.dng')).focus();
  });
}
export const confirmBox = (title, text, ok = 'Bevestigen', danger = false) => ask({ title, text, ok, danger }).then((v) => !!v);

/* Tooltips via data-tip. */
export function initTip() {
  const tip = $('#tip');
  document.addEventListener('mouseover', (e) => { const t = e.target.closest('[data-tip]'); if (t) { tip.textContent = t.dataset.tip; tip.style.display = 'block'; } });
  document.addEventListener('mousemove', (e) => { if (tip.style.display === 'block') { tip.style.left = Math.min(e.clientX + 14, innerWidth - 280) + 'px'; tip.style.top = e.clientY + 14 + 'px'; } });
  document.addEventListener('mouseout', (e) => { if (e.target.closest('[data-tip]')) tip.style.display = 'none'; });
}

/* Wacht op rust voordat er opnieuw getekend wordt. */
export const debounce = (fn, ms = 120) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const typing = (root) => { const a = document.activeElement; return !!(a && root.contains(a) && a.matches('input,textarea,select')); };
