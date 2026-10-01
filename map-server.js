'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname);
const host = '127.0.0.1';
const port = 8765;
const pidFile = path.join(root, '.map-server.pid');
const logFile = path.join(root, '.map-server.log');
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp','.ico':'image/x-icon'};
function log(message) { try { fs.appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`); } catch {} }
const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, `http://${host}:${port}`).pathname); }
  catch { res.writeHead(400); res.end('Bad request'); return; }
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.resolve(root, `.${pathname}`);
  if (filePath !== root && !filePath.startsWith(root + path.sep)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    const headers = {'Content-Type': types[path.extname(filePath).toLowerCase()] || 'application/octet-stream','X-Content-Type-Options':'nosniff'};
    if (path.basename(filePath).toLowerCase() === 'index.html') headers['Cache-Control'] = 'no-store';
    res.writeHead(200, headers);
    if (req.method === 'HEAD') { res.end(); return; }
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => { if (!res.headersSent) res.writeHead(500); res.end('Read error'); });
    stream.pipe(res);
  });
});
server.on('error', error => { log(`ERROR ${error.code || ''} ${error.message}`); console.error(`Map server error: ${error.message}`); process.exit(1); });
server.listen(port, host, () => { try { fs.writeFileSync(pidFile, String(process.pid)); } catch {} log(`Listening on http://${host}:${port}/`); console.log(`FILM.UZ is available at http://${host}:${port}/index.html`); console.log('Leave this window open while using the local map. Press Ctrl+C to stop.'); });
function shutdown() { server.close(() => { try { fs.unlinkSync(pidFile); } catch {} process.exit(0); }); setTimeout(() => process.exit(0), 1500).unref(); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);