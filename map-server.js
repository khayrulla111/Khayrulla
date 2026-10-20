'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const https = require('node:https');
const root = path.resolve(__dirname);
function loadLocalEnv() {
  if (process.env.NODE_ENV === 'production') return;
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1] in process.env) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}
loadLocalEnv();
// Bind to all interfaces so local browsers and hosted platforms such as Render can reach the server.
const host = '0.0.0.0';
const port = Number(process.env.PORT) || 8765;
const pidFile = path.join(root, '.map-server.pid');
const logFile = path.join(root, '.map-server.log');
const clientIdFile = path.join(root, '.filmuz-google-client-id');
const usersFile = process.env.FILMUZ_USERS_FILE ? path.resolve(root, process.env.FILMUZ_USERS_FILE) : path.join(root, '.filmuz-users.json');
const configuredSessionSecret = process.env.FILMUZ_SESSION_SECRET || '';
const configuredGoogleClientSecret = process.env.FILMUZ_GOOGLE_CLIENT_SECRET || '';
if (process.env.NODE_ENV === 'production' && !process.env.FILMUZ_GOOGLE_CLIENT_ID) {
  console.error('Set FILMUZ_GOOGLE_CLIENT_ID to the Google Web client ID before starting in production.');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production' && !configuredGoogleClientSecret) {
  console.error('Set FILMUZ_GOOGLE_CLIENT_SECRET before starting in production.');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production' && Buffer.byteLength(configuredSessionSecret) < 32) {
  console.error('Set FILMUZ_SESSION_SECRET to a random value of at least 32 characters before starting in production.');
  process.exit(1);
}
const sessionSecret = configuredSessionSecret || crypto.randomBytes(48).toString('base64url');
const sessionCookie = 'filmuz_session';
const sessionLifetime = 7 * 24 * 60 * 60;
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp','.ico':'image/x-icon'};
let googleKeyCache = { keys: [], expiresAt: 0 };
function log(message) { try { fs.appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`); } catch {} }
function getClientId() { return (process.env.FILMUZ_GOOGLE_CLIENT_ID || (fs.existsSync(clientIdFile) ? fs.readFileSync(clientIdFile, 'utf8').trim() : '')).trim(); }
function readUsers() { try { const value = JSON.parse(fs.readFileSync(usersFile, 'utf8')); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; } }
function json(res, status, value, extra = {}) { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...extra}); res.end(JSON.stringify(value)); }
function parseCookies(header = '') { return Object.fromEntries(header.split(';').map(part => part.trim().split('=').map(decodeURIComponent)).filter(pair => pair.length === 2)); }
function sign(value) { return crypto.createHmac('sha256', sessionSecret).update(value).digest('base64url'); }
function sessionFor(sub) { const payload = Buffer.from(JSON.stringify({sub, exp:Math.floor(Date.now()/1000)+sessionLifetime})).toString('base64url'); return `${payload}.${sign(payload)}`; }
function currentUser(req) { try { const token = parseCookies(req.headers.cookie)[sessionCookie]; if (!token) return null; const [payload, signature] = token.split('.'); if (!payload || !signature) return null; const expected = Buffer.from(sign(payload)); const actual = Buffer.from(signature); if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null; const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); if (!session.sub || session.exp < Date.now()/1000) return null; const user = readUsers()[session.sub]; return user ? {id:user.sub,email:user.email,name:user.name,picture:user.picture,createdAt:user.createdAt} : null; } catch { return null; } }
function parseBody(req, maxBytes = 24000) { return new Promise((resolve, reject) => { let raw = ''; req.setEncoding('utf8'); req.on('data', chunk => { raw += chunk; if (Buffer.byteLength(raw) > maxBytes) { reject(new Error('Request too large')); req.destroy(); } }); req.on('end', () => { try { resolve(JSON.parse(raw)); } catch { reject(new Error('Invalid JSON')); } }); req.on('error', reject); }); }
function fetchGoogleKeys() { if (googleKeyCache.expiresAt > Date.now() && googleKeyCache.keys.length) return Promise.resolve(googleKeyCache.keys); return new Promise((resolve, reject) => { const request = https.get('https://www.googleapis.com/oauth2/v3/certs', response => { let body=''; response.setEncoding('utf8'); response.on('data', chunk => { body += chunk; if (body.length > 256000) request.destroy(new Error('Google key response too large')); }); response.on('end', () => { try { if (response.statusCode !== 200) throw new Error('Google key service unavailable'); const parsed = JSON.parse(body); if (!Array.isArray(parsed.keys)) throw new Error('Google keys unavailable'); const maxAge = Number((response.headers['cache-control'] || '').match(/max-age=(\d+)/i)?.[1] || 3600); googleKeyCache = {keys:parsed.keys, expiresAt:Date.now()+Math.max(60,Math.min(maxAge,86400))*1000}; resolve(googleKeyCache.keys); } catch (error) { reject(error); } }); }); request.setTimeout(5000, () => request.destroy(new Error('Google key request timed out'))); request.on('error', reject); }); }
async function verifyGoogleCredential(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || parts.some(part => part.length > 12000)) throw new Error('Invalid Google credential');
  let header, claims;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch { throw new Error('Invalid Google credential'); }
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Unsupported Google credential');
  const keyData = (await fetchGoogleKeys()).find(key => key.kid === header.kid && key.kty === 'RSA');
  if (!keyData) throw new Error('Google signing key not found');
  const publicKey = crypto.createPublicKey({key:keyData, format:'jwk'});
  const signature = Buffer.from(parts[2], 'base64url');
  if (!crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), publicKey, signature)) throw new Error('Invalid Google signature');
  const clientId = getClientId();
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!clientId || !audiences.includes(clientId) || (claims.azp && claims.azp !== clientId) || (audiences.length > 1 && claims.azp !== clientId)) throw new Error('Google audience mismatch');
  if (!['accounts.google.com','https://accounts.google.com'].includes(claims.iss)) throw new Error('Invalid Google issuer');
  const now = Math.floor(Date.now()/1000);
  if (!Number.isFinite(claims.exp) || claims.exp < now || !Number.isFinite(claims.iat) || claims.iat > now+60) throw new Error('Expired Google credential');
  if (!claims.sub || !claims.email || !(claims.email_verified === true || claims.email_verified === 'true')) throw new Error('Google email is not verified');
  return {sub:String(claims.sub),email:String(claims.email).toLowerCase(),name:String(claims.name || claims.given_name || claims.email),picture:/^https:\/\//i.test(String(claims.picture || '')) ? String(claims.picture) : ''};
}
function exchangeGoogleCode(code, redirectUri) {
  const form = new URLSearchParams({
    code,
    client_id:getClientId(),
    client_secret:configuredGoogleClientSecret,
    redirect_uri:redirectUri,
    grant_type:'authorization_code'
  }).toString();
  return new Promise((resolve, reject) => {
    const request = https.request({hostname:'oauth2.googleapis.com',path:'/token',method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(form)}}, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; if (body.length > 128000) request.destroy(new Error('Google response too large')); });
      response.on('end', () => {
        let data;
        try { data = JSON.parse(body); } catch { reject(new Error('Google returned an invalid token response')); return; }
        if (response.statusCode !== 200 || !data.id_token) {
          const providerError = /^[a-z_]{1,64}$/.test(String(data.error || '')) ? data.error : 'token_exchange_failed';
          const error = new Error(`Google token exchange failed: ${providerError}`);
          error.code = 'GOOGLE_CODE_REJECTED';
          error.providerCode = providerError;
          reject(error);
          return;
        }
        resolve(data);
      });
    });
    request.setTimeout(8000, () => request.destroy(new Error('Google token exchange timed out')));
    request.on('error', reject);
    request.end(form);
  });
}
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin || !req.headers.host) return false;
  try {
    const parsed = new URL(origin);
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.host === req.headers.host;
  } catch {
    return false;
  }
}
function sessionCookieHeader(req, value, maxAge = sessionLifetime) {
  const secure = process.env.NODE_ENV === 'production' || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  return `${sessionCookie}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
function writeUsers(users) {
  fs.mkdirSync(path.dirname(usersFile), {recursive:true});
  const temporaryFile = `${usersFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(users, null, 2), {encoding:'utf8',mode:0o600});
  fs.renameSync(temporaryFile, usersFile);
}
async function handleApi(req, res, pathname) {
  if (pathname === '/api/config' && req.method === 'GET') { json(res, 200, {clientId:getClientId(),authReady:Boolean(getClientId() && configuredGoogleClientSecret)}); return; }
  if (pathname === '/api/me' && req.method === 'GET') { json(res, 200, {user:currentUser(req)}); return; }
  if (pathname === '/api/logout' && req.method === 'POST') {
    if (!sameOrigin(req)) { json(res, 403, {error:'Запрос отклонён.'}); return; }
    json(res, 200, {ok:true}, {'Set-Cookie':sessionCookieHeader(req, '', 0)});
    return;
  }
  if (pathname === '/api/auth/google' && req.method === 'POST') {
    if (!sameOrigin(req) || req.headers['x-requested-with'] !== 'XmlHttpRequest') { json(res, 403, {error:'Запрос входа отклонён. Обновите страницу и попробуйте снова.'}); return; }
    if (!getClientId()) { json(res, 503, {error:'Google OAuth Client ID не настроен.'}); return; }
    if (!configuredGoogleClientSecret) { json(res, 503, {error:'На сервере не настроен Google OAuth Client Secret.'}); return; }
    try {
      const body = await parseBody(req);
      const code = typeof body.code === 'string' ? body.code : '';
      if (code.length < 20 || code.length > 4096) throw new Error('Invalid Google authorization code');
      const origin = req.headers.origin;
      const tokens = await exchangeGoogleCode(code, origin);
      const user = await verifyGoogleCredential(tokens.id_token);
      const users = readUsers();
      const previous = users[user.sub];
      const now = new Date().toISOString();
      const profile = {...previous,...user,createdAt:previous?.createdAt || now,lastLoginAt:now};
      users[user.sub] = profile;
      writeUsers(users);
      json(res, 200, {user:{id:profile.sub,email:profile.email,name:profile.name,picture:profile.picture,createdAt:profile.createdAt}}, {'Set-Cookie':sessionCookieHeader(req, sessionFor(user.sub))});
    } catch (error) {
      log(`Google sign-in failed: ${String(error.providerCode || error.code || error.message).replace(/[^A-Za-z0-9_ :.-]/g, '').slice(0, 120)}`);
      if (error.providerCode === 'invalid_client' || error.providerCode === 'unauthorized_client') json(res, 503, {error:'Google OAuth Client ID и Client Secret не совпадают. Проверьте, что это пара одного Web client.'});
      else if (error.code === 'GOOGLE_CODE_REJECTED') json(res, 401, {error:'Google не принял код входа. Закройте окно Google и попробуйте войти ещё раз.'});
      else if (/Google key service unavailable|timed out|network|ENOTFOUND|ECONN/i.test(error.message)) json(res, 503, {error:'Сервис Google временно недоступен. Проверьте соединение и попробуйте ещё раз.'});
      else if (/profile|EACCES|EROFS|ENOSPC/i.test(error.message)) json(res, 500, {error:'Вход подтверждён, но не удалось сохранить профиль. Проверьте хранилище профилей на сервере.'});
      else json(res, 401, {error:'Не удалось подтвердить Google аккаунт. Проверьте OAuth настройки и попробуйте ещё раз.'});
    }
    return;
  }
  json(res, 404, {error:'Not found'});
}
const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, `http://${host}:${port}`).pathname); }
  catch { res.writeHead(400); res.end('Bad request'); return; }
  if (pathname.startsWith('/api/')) { void handleApi(req, res, pathname); return; }
  if (pathname === '/') pathname = '/index.html';
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, {'Allow':'GET, HEAD'}); res.end('Method not allowed'); return; }
  if (pathname.split('/').some(part => part.startsWith('.'))) { res.writeHead(404); res.end('Not found'); return; }
  const filePath = path.resolve(root, `.${pathname}`);
  if (filePath !== root && !filePath.startsWith(root + path.sep)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    const headers = {'Content-Type': types[path.extname(filePath).toLowerCase()] || 'application/octet-stream','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'};
    if (path.basename(filePath).toLowerCase() === 'index.html') headers['Cache-Control'] = 'no-store';
    res.writeHead(200, headers);
    if (req.method === 'HEAD') { res.end(); return; }
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => { if (!res.headersSent) res.writeHead(500); res.end('Read error'); });
    stream.pipe(res);
  });
});
server.on('error', error => { log(`ERROR ${error.code || ''} ${error.message}`); console.error(`Map server error: ${error.message}`); process.exit(1); });
server.listen(port, host, () => { try { fs.writeFileSync(pidFile, String(process.pid)); } catch {} log(`Listening on ${host}:${port}`); console.log(`FILM.UZ is available locally at http://127.0.0.1:${port}/index.html`); console.log('Leave this window open while using the local map. Press Ctrl+C to stop.'); });
function shutdown() { server.close(() => { try { fs.unlinkSync(pidFile); } catch {} process.exit(0); }); setTimeout(() => process.exit(0), 1500).unref(); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
