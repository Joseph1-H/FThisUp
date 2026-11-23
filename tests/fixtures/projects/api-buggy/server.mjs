// INTENTIONALLY BUGGY API used to test FThisUp.
import http from 'node:http';
const users = [{ id: 1, name: 'Ada', age: 36 }, { id: 2, name: 'Linus', age: 54 }];
const stats = { deleteCalls: 0, posts: 0 };
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    try {
      const p = url.pathname;
      if (p === '/__stats') return send(200, stats);
      if (p === '/health') { if (req.method !== 'GET') throw new Error('unsupported'); return send(200, { status: 1 }); }                 // BUG: status is a number (schema says string)
      if (p === '/users') {
        if (req.method === 'GET') return send(200, users);
        if (req.method === 'POST') { const b = JSON.parse(raw); stats.posts++; const u = { id: users.length + 1, name: b.name, age: b.age }; users.push(u); return send(201, u); } // BUG: malformed JSON -> 500; no validation
        throw new Error('method not allowed handled badly');                                                                           // BUG: other methods -> 500
      }
      const m = /^\/users\/([^/]+)$/.exec(p);
      if (m) {
        if (req.method === 'GET') return send(200, { id: users[m[1]].id, name: users[m[1] - 1].name });                               // BUG: non-numeric id -> TypeError -> 500
        if (req.method === 'DELETE') { stats.deleteCalls++; return send(204, ''); }
      }
      if (p === '/search') {
        const q = url.searchParams.get('q');
        if (q === null) return send(400, { error: 'q is required' });
        if (q.includes("'")) throw new Error('SQL syntax error near ' + q);                                                            // BUG: quote breaks the "query"
        return send(200, { results: users.filter((u) => u.name.toLowerCase().includes(q.toLowerCase())).map((u) => u.name) });
      }
      if (p === '/admin/stats') return send(200, { users: users.length });                                                             // BUG: no authentication
      return send(404, { error: 'not found' });
    } catch (e) { return send(500, { error: String(e.message) }); }
  });
}).listen(Number(process.env.PORT ?? 0), '127.0.0.1', function () { console.log(`LISTENING ${this.address().port}`); });
