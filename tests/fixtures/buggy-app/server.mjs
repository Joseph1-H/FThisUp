// INTENTIONALLY BUGGY demo app used to test FThisUp. Do not copy these patterns.
// Planted bugs:
//  1. /notes: submitting twice quickly creates duplicate notes (button never disabled)
//  2. /notes: API failures are unhandled (uncaught rejection on load + on save)
//  3. / links to /old-page which 404s (broken navigation)
//  4. /notes: form has `novalidate` and no JS checks (empty/invalid input is sent to the server)
//  5. /: "Export notes" button throws a TypeError
//  6. /notes: notes are rendered with innerHTML (stored XSS)
//  7. API returns 500 for very long titles
import http from 'node:http';

const notes = [];
const stats = { deleteCalls: 0, posts: 0 };

const layout = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link rel="icon" href="data:,">
<style>body{font-family:system-ui;margin:0;padding:16px;max-width:640px}nav a{margin-right:12px}input,button,textarea{font:inherit;margin:4px 0;max-width:100%}li{overflow-wrap:anywhere}</style></head>
<body><nav><a href="/">Home</a><a href="/notes">Notes</a><a href="/about">About</a><a href="/old-page">Old page</a><a href="https://example.com/">External</a></nav>${body}</body></html>`;

const pages = {
  '/': layout('Home', `<h1>Buggy Notes</h1><p>Welcome.</p>
<button id="export" type="button">Export notes</button>
<button id="tip" type="button">Show tip</button><p id="tipout"></p>
<script>
document.getElementById('tip').onclick=()=>{document.getElementById('tipout').textContent='Tip: write things down.'};
document.getElementById('export').onclick=()=>{const data=undefined;console.log(data.length);};
</script>`),
  '/about': layout('About', '<h1>About</h1><p>A deliberately buggy demo app.</p>'),
  '/notes': layout('Notes', `<h1>Notes</h1>
<form id="f" novalidate>
  <label>Title <input name="title" required></label><br>
  <label>Email <input name="email" type="email" required></label><br>
  <label>Age <input name="age" type="number" min="0" max="120"></label><br>
  <button type="submit">Add note</button>
</form>
<ul id="list"></ul>
<button id="delete-all" type="button">Delete all notes</button>
<script>
const list=document.getElementById('list');
function render(items){list.innerHTML='';items.forEach(n=>{list.innerHTML+='<li>'+n.title+'</li>'});}
fetch('/api/notes').then(r=>r.json()).then(data=>{render(data)}); // BUG: no error handling, data.forEach explodes on error bodies
document.getElementById('f').addEventListener('submit',async(e)=>{
  e.preventDefault();
  const fd=Object.fromEntries(new FormData(e.target));
  const res=await fetch('/api/notes',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(fd)});
  if(!res.ok) throw new Error('Save failed '+res.status); // BUG: never caught
  const n=await res.json();
  list.innerHTML+='<li>'+n.title+'</li>'; // BUG: XSS
});
document.getElementById('delete-all').onclick=()=>fetch('/api/notes',{method:'DELETE'}).then(()=>{list.innerHTML=''});
</script>`),
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (code, type, body) => { res.writeHead(code, { 'content-type': type }); res.end(body); };
  if (url.pathname === '/__stats') return send(200, 'application/json', JSON.stringify({ ...stats, notes: notes.length }));
  if (url.pathname === '/api/notes') {
    if (req.method === 'GET') return send(200, 'application/json', JSON.stringify(notes));
    if (req.method === 'DELETE') { stats.deleteCalls++; notes.length = 0; return send(200, 'application/json', '{"ok":true}'); }
    if (req.method === 'POST') {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        stats.posts++;
        const body = JSON.parse(raw || '{}');
        if (String(body.title ?? '').length > 9000) { res.writeHead(500); return res.end('Internal Server Error'); } // BUG
        const n = { id: notes.length + 1, title: body.title, email: body.email };
        notes.push(n);
        setTimeout(() => send(201, 'application/json', JSON.stringify(n)), 0);
      });
      return;
    }
  }
  if (pages[url.pathname]) return send(200, 'text/html', pages[url.pathname]);
  return send(404, 'text/html', layout('Not found', '<h1>404</h1><p>Page not found.</p>'));
});
server.listen(Number(process.env.PORT ?? 0), '127.0.0.1', () => console.log(`LISTENING ${server.address().port}`));
