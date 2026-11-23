// A correct API. FThisUp must not report confirmed findings here.
import http from 'node:http';
const users = [{ id: 1, name: 'Ada', age: 36 }, { id: 2, name: 'Linus', age: 54 }];
const stats = { deleteCalls: 0, posts: 0 };
const TOKEN = 'test-token';
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (code, body, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(code === 204 ? '' : JSON.stringify(body)); };
  const chunks = []; let size = 0, tooBig = false;
  req.on('data', (c) => { size += c.length; if (size > 100_000) { tooBig = true; return; } chunks.push(c); });
  req.on('end', () => {
    try {
      const p = url.pathname;
      if (tooBig) return send(413, { error: 'payload too large' });
      if (p === '/__stats') return send(200, stats);
      if (p === '/health') return req.method === 'GET' ? send(200, { status: 'ok' }) : send(405, { error: 'method not allowed' }, { allow: 'GET' });
      if (p === '/users') {
        if (req.method === 'GET') return send(200, users);
        if (req.method === 'POST') {
          if (!/^application\/json/.test(req.headers['content-type'] ?? '')) return send(415, { error: 'JSON required' });
          let b; try { b = JSON.parse(Buffer.concat(chunks).toString()); } catch { return send(400, { error: 'malformed JSON' }); }
          if (typeof b !== 'object' || b === null || typeof b.name !== 'string' || !b.name.trim()) return send(400, { error: 'name is required' });
          if (b.age !== undefined && !Number.isInteger(b.age)) return send(400, { error: 'age must be an integer' });
          stats.posts++; const u = { id: users.length + 1, name: b.name, age: b.age }; users.push(u); return send(201, u);
        }
        return send(405, { error: 'method not allowed' }, { allow: 'GET, POST' });
      }
      const m = /^\/users\/([^/]+)$/.exec(p);
      if (m) {
        if (!/^\d+$/.test(m[1])) return send(400, { error: 'id must be an integer' });
        if (req.method === 'GET') { const u = users.find((x) => x.id === Number(m[1])); return u ? send(200, u) : send(404, { error: 'not found' }); }
        if (req.method === 'DELETE') { stats.deleteCalls++; return send(204, ''); }
        return send(405, { error: 'method not allowed' }, { allow: 'GET, DELETE' });
      }
      if (p === '/search') {
        const q = url.searchParams.get('q');
        if (q === null || q === '') return send(400, { error: 'q is required' });
        return send(200, { results: users.filter((u) => u.name.toLowerCase().includes(q.slice(0, 200).toLowerCase())).map((u) => u.name) });
      }
      if (p === '/admin/stats') {
        if ((req.headers.authorization ?? '') !== `Bearer ${TOKEN}`) return send(401, { error: 'unauthorized' }, { 'www-authenticate': 'Bearer' });
        return send(200, { users: users.length });
      }
      return send(404, { error: 'not found' });
    } catch (e) { return send(500, { error: 'internal error' }); }
  });
}).listen(Number(process.env.PORT ?? 0), '127.0.0.1', function () { console.log(`LISTENING ${this.address().port}`); });
