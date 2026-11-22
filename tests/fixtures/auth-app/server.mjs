// Demo app with login. BROKEN=1 serves the dashboard to anyone (no server-side auth) and shows the admin panel.
import http from 'node:http';
import crypto from 'node:crypto';
const BROKEN = process.env.BROKEN === '1';
const sessions = new Set();
const USER = 'test@example.invalid', PASS = 'Correct-Horse-1';

const layout = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link rel="icon" href="data:,"></head><body><nav><a href="/">Home</a> <a href="/login">Login</a> <a href="/dashboard">Dashboard</a></nav>${body}</body></html>`;
const login = layout('Login', `<h1>Login</h1><form id="f"><label>Email <input name="email" type="email" required></label><br><label>Password <input name="password" type="password" required></label><br><button type="submit">Sign in</button></form><p id="err" role="alert"></p>
<script>document.getElementById('f').addEventListener('submit',async e=>{e.preventDefault();const r=await fetch('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});if(r.ok)location.href='/dashboard';else document.getElementById('err').textContent='Invalid email or password';});</script>`);
const dash = layout('Dashboard', `<h1>Dashboard</h1><p>Secret account data: balance 1234</p><button id="logout" type="button">Log out</button>${BROKEN ? '<div id="admin-panel">Admin panel</div>' : ''}
<script>document.getElementById('logout').onclick=async()=>{await fetch('/api/logout',{method:'POST'});location.href='/login';};</script>`);

const sid = (req) => /(?:^|; )sid=([a-f0-9]+)/.exec(req.headers.cookie ?? '')?.[1];
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (code, type, body, h = {}) => { res.writeHead(code, { 'content-type': type, ...h }); res.end(body); };
  if (url.pathname === '/') return send(200, 'text/html', layout('Home', '<h1>Auth demo</h1><p>Public page.</p>'));
  if (url.pathname === '/login') return send(200, 'text/html', login);
  if (url.pathname === '/dashboard') {
    if (!BROKEN && !sessions.has(sid(req))) return send(302, 'text/plain', '', { location: '/login', 'cache-control': 'no-store' });
    return send(200, 'text/html', dash, { 'cache-control': 'no-store' });
  }
  if (url.pathname === '/api/login' && req.method === 'POST') {
    let raw = ''; req.on('data', (c) => (raw += c)); req.on('end', () => {
      let b = {}; try { b = JSON.parse(raw); } catch {}
      if (b.email === USER && b.password === PASS) { const id = crypto.randomBytes(16).toString('hex'); sessions.add(id); return send(200, 'application/json', '{"ok":true}', { 'set-cookie': `sid=${id}; Path=/; HttpOnly` }); }
      send(401, 'application/json', '{"error":"invalid"}');
    }); return;
  }
  if (url.pathname === '/api/logout' && req.method === 'POST') { sessions.delete(sid(req)); return send(200, 'application/json', '{"ok":true}', { 'set-cookie': 'sid=; Path=/; Max-Age=0' }); }
  send(404, 'text/plain', 'not found');
}).listen(Number(process.env.PORT ?? 0), '127.0.0.1', function () { console.log(`LISTENING ${this.address().port}`); });
