// Static server + game-state relay: node serve.js [port]
// Relay: GET /events?room=x (Server-Sent Events) receives every state posted to POST /state?room=x.
// shortcut: no auth, anyone who can reach this port can read/post a room; LAN/dev use only.
const http = require('http'), fs = require('fs'), path = require('path');
const root = __dirname, port = Number(process.env.PORT || process.argv[2]) || 8000;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const MAX_BODY = 1 << 20; // 1 MB
const rooms = new Map(); // room -> { clients: Set<res>, last: string | null }
const roomOf = (url) => {
  const name = (url.searchParams.get('room') || '').slice(0, 64);
  if (!/^[\w-]+$/.test(name)) return null;
  if (!rooms.has(name)) rooms.set(name, { clients: new Set(), last: null });
  return rooms.get(name);
};

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');

  if (url.pathname === '/events') {
    const room = roomOf(url);
    if (!room) return res.writeHead(400).end('bad room');
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(': hi\n\n');
    if (room.last) res.write(`data: ${room.last}\n\n`); // late joiner gets the current game
    room.clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); room.clients.delete(res); });
    return;
  }

  if (url.pathname === '/state' && req.method === 'POST') {
    const room = roomOf(url);
    if (!room) return res.writeHead(400).end('bad room');
    let body = '', size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { res.writeHead(413).end('too big'); req.destroy(); return; }
      body += c;
    });
    req.on('end', () => {
      if (size > MAX_BODY) return;
      let msg;
      try { msg = JSON.parse(body); } catch { return res.writeHead(400).end('bad json'); }
      if (typeof msg?.from !== 'string' || !Array.isArray(msg?.state?.units)) return res.writeHead(400).end('bad state');
      room.last = JSON.stringify(msg); // re-serialised: one line, safe for SSE framing
      for (const c of room.clients) c.write(`data: ${room.last}\n\n`);
      res.writeHead(204).end();
    });
    return;
  }

  const file = path.join(root, decodeURIComponent(url.pathname).replace(/\/$/, '/index.html'));
  // stay inside the app folder and never serve dot-folders (.git, .claude) to the LAN
  if (!file.startsWith(root + path.sep) || file.slice(root.length).split(path.sep).some((s) => s.startsWith('.'))) return res.writeHead(403).end();
  fs.readFile(file, (err, data) => {
    if (err) return res.writeHead(404).end('not found');
    // no-store: the phone always gets the latest files after an edit
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(data);
  });
}).listen(port, () => console.log(`http://localhost:${port}`));
