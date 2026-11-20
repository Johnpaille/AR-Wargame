// Minimal static server: node serve.js [port]
const http = require('http'), fs = require('fs'), path = require('path');
const root = __dirname, port = Number(process.env.PORT || process.argv[2]) || 8000;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  if (!file.startsWith(root)) return res.writeHead(403).end();
  fs.readFile(file, (err, data) => {
    if (err) return res.writeHead(404).end('not found');
    // no-store: the phone always gets the latest files after an edit
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(data);
  });
}).listen(port, () => console.log(`http://localhost:${port}`));
