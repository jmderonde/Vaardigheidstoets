// Eenvoudige realtime-hub (Server-Sent Events). Eén instantie volstaat voor één Render-service.
const subs = new Map(); // dayId -> Set<res>

export function subscribe(dayId, req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  res.write(`event: hello\ndata: {"t":${Date.now()}}\n\n`);
  let set = subs.get(dayId);
  if (!set) subs.set(dayId, (set = new Set()));
  set.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => {
    clearInterval(ping);
    set.delete(res);
    if (!set.size) subs.delete(dayId);
  });
}

let pending = new Map();
// Bundel snelle opeenvolgende wijzigingen tot één melding.
export function emit(dayId) {
  if (pending.has(dayId)) return;
  pending.set(dayId, setTimeout(() => {
    pending.delete(dayId);
    const set = subs.get(dayId);
    if (!set) return;
    const msg = `event: change\ndata: {"t":${Date.now()}}\n\n`;
    for (const res of set) res.write(msg);
  }, 80));
}
