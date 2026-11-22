// A correct demo app. FThisUp must NOT report confirmed failures here.
import http from 'node:http';

const notes = [];
const stats = { deleteCalls: 0, posts: 0 };

const layout = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link rel="icon" href="data:,">
<style>*{box-sizing:border-box}body{font-family:system-ui;margin:0;padding:16px;max-width:640px}nav a{margin-right:12px;display:inline-block}input,button,textarea{font:inherit;margin:4px 0;max-width:100%}li{overflow-wrap:anywhere}.err{color:#b00020}</style></head>
<body><nav><a href="/">Home</a><a href="/notes">Notes</a><a href="/about">About</a></nav>${body}</body></html>`;

const pages = {
  '/': layout('Home', `<h1>Clean Notes</h1><p>Welcome.</p>
<button id="tip" type="button">Show tip</button><p id="tipout" role="status"></p>
<script>document.getElementById('tip').onclick=()=>{document.getElementById('tipout').textContent='Tip: write things down.'};</script>`),
  '/about': layout('About', '<h1>About</h1><p>A correct demo app.</p>'),
  '/notes': layout('Notes', `<h1>Notes</h1>
<form id="f">
  <label>Title <input name="title" required maxlength="200"></label><br>
  <label>Email <input name="email" type="email" required></label><br>
  <label>Age <input name="age" type="number" min="0" max="120"></label><br>
  <button type="submit" id="submit">Add note</button>
</form>
<p id="msg" class="err" role="alert"></p>
<ul id="list"></ul>
<button id="clear-all" type="button">Delete all notes</button>
<script>
const list=document.getElementById('list'), msg=document.getElementById('msg'), btn=document.getElementById('submit');
function add(n){const li=document.createElement('li');li.textContent=n.title;list.appendChild(li);}
async function load(){try{const r=await fetch('/api/notes');if(!r.ok)throw new Error('HTTP '+r.status);(await r.json()).forEach(add);}catch(e){msg.textContent='Could not load notes. Please try again.';}}
load();
document.getElementById('f').addEventListener('submit',async(e)=>{
  e.preventDefault();
  if(btn.disabled)return;
  btn.disabled=true; msg.textContent='Saving...';
  try{
    const res=await fetch('/api/notes',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});
    if(!res.ok){const b=await res.json().catch(()=>({}));throw new Error(b.error||('HTTP '+res.status));}
    add(await res.json()); msg.textContent='Saved.';
  }catch(err){ msg.textContent='Could not save: '+(err&&err.message?err.message:'network error'); }
  finally{ btn.disabled=false; }
});
document.getElementById('clear-all').onclick=async()=>{try{await fetch('/api/notes',{method:'DELETE'});list.innerHTML='';}catch(e){msg.textContent='Delete failed';}};
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
      req.on('data', (c) => { raw += c; if (raw.length > 100_000) req.destroy(); });
      req.on('end', () => {
        let body; try { body = JSON.parse(raw || '{}'); } catch { return send(400, 'application/json', '{"error":"Invalid JSON"}'); }
        const title = String(body.title ?? '').trim();
        if (!title) return send(400, 'application/json', '{"error":"Title is required"}');
        if (title.length > 200) return send(413, 'application/json', '{"error":"Title too long"}');
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(body.email ?? ''))) return send(400, 'application/json', '{"error":"Invalid email"}');
        const age = body.age === '' || body.age === undefined ? null : Number(body.age);
        if (age !== null && (!Number.isFinite(age) || age < 0 || age > 120)) return send(400, 'application/json', '{"error":"Invalid age"}');
        stats.posts++;
        const n = { id: notes.length + 1, title };
        notes.push(n);
        send(201, 'application/json', JSON.stringify(n));
      });
      return;
    }
  }
  if (pages[url.pathname]) return send(200, 'text/html', pages[url.pathname]);
  return send(404, 'text/html', layout('Not found', '<h1>404</h1><p>Page not found.</p>'));
});
server.listen(Number(process.env.PORT ?? 0), '127.0.0.1', () => console.log(`LISTENING ${server.address().port}`));
