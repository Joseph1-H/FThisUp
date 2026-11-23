import fs from 'node:fs';
import path from 'node:path';
export function headlineFor(r) {
    const executed = r.summary.total;
    if (r.summary.confirmed > 0) {
        return { headline: 'FTHISUP — YOUR APP GOT FUCKED UP.', tone: 'bad', sub: `${r.summary.confirmed} confirmed issue${r.summary.confirmed === 1 ? '' : 's'}${r.summary.suspected ? `, ${r.summary.suspected} more suspected` : ''}. Each one was reproduced.` };
    }
    if (executed === 0)
        return { headline: 'FTHISUP — NOTHING RAN.', tone: 'idle', sub: 'No scenario could be executed. See the skipped/blocked list below for why.' };
    return {
        headline: 'FTHISUP — NOTHING BROKE. YET.', tone: 'ok',
        sub: r.summary.suspected ? `No confirmed failures, but ${r.summary.suspected} suspected issue${r.summary.suspected === 1 ? '' : 's'} deserve a look. Passing checks do not prove the project is bug-free.` : 'No confirmed failures in the checks that ran. Passing checks do not prove the project is bug-free.',
    };
}
function safeJson(v) {
    return JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
export function renderReport(results, resultsDir) {
    const shots = {};
    let budget = 12 * 1024 * 1024; // keep the single-file report reasonably small
    for (const f of results.findings) {
        const rel = f.evidence.screenshot;
        if (!rel)
            continue;
        try {
            const buf = fs.readFileSync(path.join(resultsDir, rel));
            if (buf.length > budget)
                continue;
            budget -= buf.length;
            shots[rel] = `data:image/png;base64,${buf.toString('base64')}`;
        }
        catch { /* screenshot missing: report simply omits it */ }
    }
    const { headline, sub, tone } = headlineFor(results);
    const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="FThisUp ${esc(results.environment.fthisupVersion)}">
<title>FThisUp report — ${esc(results.project)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
<header class="hero ${tone}">
  <div class="brand">FTHISUP <span>· Your code works? Prove it.</span></div>
  <h1 id="headline">${esc(headline)}</h1>
  <p class="sub" id="sub">${esc(sub)}</p>
  <dl class="meta" id="meta"></dl>
</header>
<section class="stats" id="stats" aria-label="Summary"></section>
<section class="charts">
  <div class="card"><h2>Severity distribution</h2><div id="sev"></div></div>
  <div class="card"><h2>Test categories</h2><div id="cats"></div></div>
</section>
<section class="card" id="detected"><h2>Detected project</h2><div id="components"></div></section>
<section class="card" id="sourcebox"><h2>Where the checks came from</h2><div id="sources"></div></section>
<section class="card" id="discoverybox" hidden><h2>Autonomous discovery <span class="badge new">new in v0.3</span></h2><div id="discovery"></div></section>
<section class="card" id="adapterbox"><h2>Adapters</h2><div class="tablewrap"><table id="adapters"><thead><tr><th>Adapter</th><th>Status</th><th>Components</th><th>Tests</th><th>Why / what is missing</th></tr></thead><tbody></tbody></table></div></section>
<section>
  <h2 class="section">Issues</h2>
  <div class="toolbar">
    <input id="q" type="search" placeholder="Search issues, routes, errors…" aria-label="Search issues">
    <select id="fstatus" aria-label="Filter by status"><option value="">All statuses</option><option>confirmed</option><option>suspected</option><option>not-reproducible</option></select>
    <select id="fsev" aria-label="Filter by severity"><option value="">All severities</option><option>critical</option><option>high</option><option>medium</option><option>low</option><option>info</option></select>
    <select id="fcat" aria-label="Filter by category"><option value="">All categories</option></select>
    <select id="fcomp" aria-label="Filter by component"><option value="">All components</option></select>
    <select id="fadapter" aria-label="Filter by adapter"><option value="">All adapters</option></select>
    <button id="expand" type="button">Expand all</button>
  </div>
  <p class="count" id="count" role="status"></p>
  <div id="issues"></div>
</section>
<section>
  <h2 class="section">All scenarios</h2>
  <div class="toolbar"><input id="q2" type="search" placeholder="Filter scenarios…" aria-label="Filter scenarios"><select id="fout" aria-label="Filter by outcome"><option value="">All outcomes</option><option>passed</option><option>failed</option><option>skipped</option><option>blocked</option></select></div>
  <div class="tablewrap"><table id="tbl"><thead><tr><th>Outcome</th><th>Scenario</th><th>Adapter</th><th>Category</th><th>Target</th><th>Detail</th></tr></thead><tbody></tbody></table></div>
</section>
<section class="card" id="notes"></section>
<footer>Generated locally by FThisUp ${esc(results.environment.fthisupVersion)}. No data left your machine. A clean report is not a guarantee of correctness or security.</footer>
</main>
<div id="lightbox" hidden><img alt="Screenshot (enlarged)"></div>
<script type="application/json" id="data">${safeJson({ results, shots })}</script>
<script>${JS}</script>
</body>
</html>
`;
}
const CSS = `
:root{--bg:#0a0a0c;--panel:#121215;--panel2:#18181c;--line:#26262c;--text:#ececf0;--muted:#8d8d98;--red:#ff3b3b;--red2:#c92a2a;--amber:#e8a33d;--green:#3fb27f;--blue:#6c8cbf;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
*{box-sizing:border-box}
[hidden]{display:none!important}
html{color-scheme:dark}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 48px}
.hero{border:1px solid var(--line);border-left:4px solid var(--red);background:linear-gradient(180deg,#15090b,var(--panel));padding:24px;border-radius:10px}
.hero.ok{border-left-color:var(--green);background:linear-gradient(180deg,#0b130f,var(--panel))}
.hero.idle{border-left-color:var(--muted);background:var(--panel)}
.brand{font:600 12px var(--mono);letter-spacing:.12em;color:var(--red)}
.hero.ok .brand{color:var(--green)}.hero.idle .brand{color:var(--muted)}
.brand span{color:var(--muted);letter-spacing:0;font-weight:400}
h1{margin:10px 0 6px;font-size:clamp(22px,4.5vw,38px);line-height:1.15;letter-spacing:-.01em}
.sub{margin:0 0 16px;color:var(--muted);max-width:70ch}
.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px 24px;margin:0}
.meta div{min-width:0}.meta dt{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
.meta dd{margin:0;font-family:var(--mono);font-size:12.5px;overflow-wrap:anywhere}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin:16px 0}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px 14px}
.stat b{display:block;font-size:26px;font-variant-numeric:tabular-nums}.stat span{font-size:12px;color:var(--muted)}
.stat.red b{color:var(--red)}.stat.amber b{color:var(--amber)}.stat.green b{color:var(--green)}
.charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:0 0 12px}
h2.section{margin:28px 0 10px}
.bar{display:grid;grid-template-columns:110px 1fr 56px;gap:10px;align-items:center;margin:7px 0;font-size:12.5px}
.track{height:10px;background:var(--panel2);border-radius:5px;overflow:hidden;display:flex}
.track i{display:block;height:100%}
.bar em{font-style:normal;text-align:right;color:var(--muted);font-variant-numeric:tabular-nums}
.toolbar{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px}
input[type=search],select,button{background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:6px;padding:8px 10px;font:inherit}
input[type=search]{flex:1 1 220px;min-width:0}
button{cursor:pointer}button:hover,select:hover{border-color:#3a3a42}
:focus-visible{outline:2px solid var(--red);outline-offset:2px}
.count{color:var(--muted);font-size:12.5px;margin:4px 0 8px}
details.issue{background:var(--panel);border:1px solid var(--line);border-radius:8px;margin:8px 0;overflow:hidden}
details.issue[open]{border-color:#3a2024}
details.issue>summary{list-style:none;cursor:pointer;padding:12px 14px;display:flex;flex-wrap:wrap;gap:8px 10px;align-items:center}
details.issue>summary::-webkit-details-marker{display:none}
details.issue>summary::before{content:"▸";color:var(--muted)}details.issue[open]>summary::before{content:"▾"}
.title{font-weight:600;flex:1 1 280px;min-width:0;overflow-wrap:anywhere}
.badge{font:600 11px var(--mono);text-transform:uppercase;letter-spacing:.04em;padding:2px 7px;border-radius:4px;border:1px solid var(--line);color:var(--muted)}
.sev-critical{background:#4a0d12;color:#ff8f94;border-color:#7a1a21}.sev-high{background:#3a1410;color:#ff9a7a;border-color:#6a2a20}
.sev-medium{background:#33270d;color:#f0c070;border-color:#5a4619}.sev-low{background:#16212e;color:#8fb2de;border-color:#27384d}.sev-info{background:#1a1a1f;color:var(--muted)}
.st-confirmed{background:var(--red2);color:#fff;border-color:var(--red2)}.st-suspected{color:var(--amber);border-color:#5a4619}.st-not-reproducible{color:var(--muted)}
.body{padding:2px 16px 16px;border-top:1px solid var(--line)}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin:12px 0}
.body h3{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:14px 0 6px}
.body p{margin:0;overflow-wrap:anywhere}
.body ol{margin:0;padding-left:20px}
pre,code{font-family:var(--mono);font-size:12px}
pre{background:#0d0d10;border:1px solid var(--line);border-radius:6px;padding:8px 10px;margin:4px 0;overflow-x:auto;white-space:pre-wrap;overflow-wrap:anywhere}
.shot{max-width:100%;border:1px solid var(--line);border-radius:6px;cursor:zoom-in;display:block;margin-top:6px}
.fix{border-left:3px solid var(--green);padding-left:10px}
.tablewrap{overflow-x:auto;border:1px solid var(--line);border-radius:8px}
table{border-collapse:collapse;width:100%;font-size:12.5px}
th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:500;background:var(--panel)}
td.o-passed{color:var(--green)}td.o-failed{color:var(--red)}td.o-skipped,td.o-blocked{color:var(--amber)}
#notes ul{margin:0;padding-left:18px;color:var(--muted)}
footer{margin-top:28px;color:var(--muted);font-size:12px}
#lightbox{position:fixed;inset:0;background:rgba(0,0,0,.88);display:flex;align-items:center;justify-content:center;padding:16px;z-index:10;cursor:zoom-out}
#lightbox img{max-width:100%;max-height:100%}
.empty{padding:24px;text-align:center;color:var(--muted);border:1px dashed var(--line);border-radius:8px}
.card#detected,.card#adapterbox{margin:12px 0}
.comp{display:flex;flex-wrap:wrap;gap:6px 14px;padding:7px 0;border-bottom:1px solid var(--line);font-size:13px}.comp:last-child{border-bottom:0}.comp b{font-family:var(--mono);font-weight:500}.comp span{color:var(--muted)}
.badge.new{background:#10331f;color:#7be0a8;border-color:#1f5a3a}.ds-confirmed{color:#ff8f94}.ds-suspected{color:var(--amber)}.ds-passed{color:var(--green)}.ds-invalid,.ds-environment,.ds-rejected,.ds-skipped,.ds-not-reproducible{color:var(--muted)}
.chip{font:11px var(--mono);padding:1px 7px;border-radius:10px;border:1px solid var(--line);color:var(--muted)}
.st-ran{color:var(--green)}.st-skipped,.st-unavailable,.st-unsupported,.st-blocked,.st-error{color:var(--amber)}.st-not-applicable{color:var(--muted)}
.ek-failed-assertion{border-color:#2d3b52;color:#8fb2de}.ek-observed-defect{border-color:#5a2226;color:#ff9a9a}.ek-static-heuristic{color:var(--muted)}
@media (max-width:520px){.bar{grid-template-columns:80px 1fr 44px}}
`;
const JS = `
(function(){
var D=JSON.parse(document.getElementById('data').textContent),R=D.results,SH=D.shots;
function h(t,a){var e=document.createElement(t);if(a)for(var k in a){if(k==='class')e.className=a[k];else e.setAttribute(k,a[k]);}
 (function add(list){for(var i=0;i<list.length;i++){var c=list[i];if(c==null||c===false)continue;if(Array.isArray(c)){add(c);continue;}e.appendChild(typeof c==='object'?c:document.createTextNode(String(c)));}})(Array.prototype.slice.call(arguments,2));return e;}
function $(id){return document.getElementById(id)}
var S=R.summary,E=R.environment;
var meta=[['Project',R.project],['Application URL',R.target],['Executed',new Date(R.startedAt).toLocaleString()],['Duration',(R.durationMs/1000).toFixed(1)+'s'],['Mode',R.mode+' · '+R.safety.environment+' target'],['Browser',E.browser+' '+E.browserVersion+(E.headless?' (headless)':'')],['Platform',E.platform+' · node '+E.node],['FThisUp','v'+E.fthisupVersion]];
meta.forEach(function(m){$('meta').appendChild(h('div',null,h('dt',null,m[0]),h('dd',null,m[1])))});
[['Executed',S.total,''],['Passed',S.passed,'green'],['Failed',S.failed,S.failed?'red':''],['Skipped',S.skipped,''],['Blocked by safety',S.blocked,S.blocked?'amber':''],['Confirmed bugs',S.confirmed,S.confirmed?'red':''],['Suspected',S.suspected,S.suspected?'amber':'']].forEach(function(s){
 $('stats').appendChild(h('div',{class:'stat '+s[2]},h('b',null,s[1]),h('span',null,s[0])))});
var sevColor={critical:'#ff3b3b',high:'#e5603f',medium:'#e8a33d',low:'#6c8cbf',info:'#6b6b75'};
var maxSev=Math.max(1,Math.max.apply(null,Object.keys(S.bySeverity).map(function(k){return S.bySeverity[k]})));
Object.keys(sevColor).forEach(function(k){var n=S.bySeverity[k]||0;var t=h('div',{class:'track'},h('i',{style:'width:'+(n/maxSev*100)+'%;background:'+sevColor[k]}));$('sev').appendChild(h('div',{class:'bar'},h('span',null,k),t,h('em',null,n)))});
var cats=Object.keys(S.byCategory);
cats.forEach(function(k){var c=S.byCategory[k];if(!c.total)return;var t=h('div',{class:'track',title:c.passed+' passed, '+c.failed+' failed'},
 h('i',{style:'width:'+(c.total?c.passed/c.total*100:0)+'%;background:#3fb27f'}),h('i',{style:'width:'+(c.total?c.failed/c.total*100:0)+'%;background:#ff3b3b'}));
 $('cats').appendChild(h('div',{class:'bar'},h('span',null,k),t,h('em',null,c.passed+'/'+c.total)))});
if(R.findings.some(function(f){return f.category==='code-analysis'}))$('cats').appendChild(h('p',{class:'count'},'Static-analysis warnings are listed under Issues but are not executed tests.'));
(R.components||[]).forEach(function(c){$('components').appendChild(h('div',{class:'comp'},h('b',null,c.id),h('span',null,c.kind),h('span',null,(c.languages||[]).join('/')),h('span',null,(c.frameworks||[]).join(', ')),h('span',{class:'chip'},'confidence: '+c.confidence)))});
if(!(R.components||[]).length){$('components').appendChild(h('p',{class:'count'},'No components recorded (results written by an older FThisUp).'))}
if(!(R.adapters||[]).length)$('adapterbox').hidden=true;
(function(){var K={existing:'Existing project tests / build',generated:'NEW generated tests (this run)','engine-adversarial':'Built-in adversarial probes (fuzz, API, CLI)',runtime:'Runtime interaction (real browser)',static:'Static analysis'},cnt={};
 R.results.forEach(function(r){var k=r.kind||'runtime';var c=cnt[k]=cnt[k]||{t:0,p:0,f:0,s:0};if(r.outcome==='passed'){c.t++;c.p++}else if(r.outcome==='failed'){c.t++;c.f++}else c.s++});
 var tb=h('table',null,h('thead',null,h('tr',null,h('th',null,'Source'),h('th',null,'Executed'),h('th',null,'Passed'),h('th',null,'Failed'),h('th',null,'Skipped / not evaluable'))),h('tbody'));
 Object.keys(K).forEach(function(k){var c=cnt[k];if(!c)return;tb.lastChild.appendChild(h('tr',null,h('td',null,K[k]),h('td',null,c.t),h('td',{class:'o-passed'},c.p),h('td',{class:c.f?'o-failed':''},c.f),h('td',null,c.s)))});
 $('sources').appendChild(h('div',{class:'tablewrap'},tb));
 var inv=R.findings.filter(function(f){return f.discovery&&f.status==='confirmed'}).length;
 $('sources').appendChild(h('p',{class:'count'},inv+' confirmed bug(s) were found by newly generated tests that the project\u2019s own tests did not catch. Findings marked NEW below come from those.'))})();
if(R.discovery){var Dv=R.discovery,k=Dv.counts,box=$('discoverybox');box.hidden=false;var dv=$('discovery');
 (Dv.appMap||[]).forEach(function(m){var t=m.summary;dv.appendChild(h('p',null,'Application map ('+m.component+'): '+t.screens+' screens, '+t.forms+' forms, '+t.inputFields+' input fields, '+t.persistenceWorkflows+' persistence workflows, '+t.gestureInteractions+' gesture interactions; '+t.uncoveredWidgets+' interactive widgets no existing test mentions.'))});
 dv.appendChild(h('p',null,[['generated',k.generated],['validated',k.validated],['rejected',k.rejected],['executed',k.executed],['skipped',k.skipped],['passed',k.passed],['confirmed',k.confirmed],['suspected',k.suspected],['not reproducible',k.notReproducible],['invalid tests',k.invalid],['environment limits',k.environment]].map(function(x){return h('span',{class:'chip',style:'margin-right:6px'},x[0]+': '+x[1])})));
 dv.appendChild(h('p',{class:'count'},'\u201cExecuted\u201d counts only scenarios the test framework actually ran. Rejected and skipped scenarios are listed but never counted as executed. Invalid tests (wrong setup/target) and environment limits prove nothing about your app and are never reported as bugs.'));
 var rows2=(Dv.records||[]).map(function(r){return h('tr',null,h('td',{class:'ds-'+r.status},r.status),h('td',null,r.name,h('br'),h('span',{class:'count'},r.id+' · '+r.method)),h('td',null,r.feature),h('td',null,r.risk),h('td',null,r.expectation.statement,h('br'),h('span',{class:'count'},'basis: '+r.expectation.effectiveBasis+(r.expectation.effectiveBasis!==r.expectation.basis?' (claimed '+r.expectation.basis+')':'')+(r.expectation.reference?' · '+r.expectation.reference+(r.expectation.referenceVerified?' ✓ verified':' ✗ not verified'):''))),h('td',null,r.executed?'yes':'no'),h('td',null,r.reproduction?r.reproduction.reproduced+'/'+r.reproduction.attempts:''),h('td',null,r.confidence||''),h('td',null,(r.reason||'')+((r.evidence&&r.evidence.observed&&r.evidence.observed.length)?' \u2014 '+r.evidence.observed[0]:'').slice(0,400)))});
 if(rows2.length)dv.appendChild(h('div',{class:'tablewrap'},h('table',null,h('thead',null,h('tr',null,['Result','Scenario','Feature','Risk addressed','Expected behaviour & its source','Ran','Repro','Confidence','Evidence / reason'].map(function(x){return h('th',null,x)}))),h('tbody',null,rows2))));
 if(Dv.isolation)dv.appendChild(h('p',{class:'count'},'Isolation: '+Dv.isolation.workspace+'. Project files modified: '+(Dv.isolation.sourceModified?'YES (see limits)':'no')+'. Network blocked: '+Dv.isolation.networkBlocked+(Dv.isolation.networkAttempts.length?' (attempts: '+Dv.isolation.networkAttempts.join(', ')+')':'')+'. Workspace deleted: '+Dv.isolation.cleanedUp+'. '+Dv.isolation.sandbox));
 if((Dv.limitations||[]).length){dv.appendChild(h('h3',null,'Limits of this discovery run'));dv.appendChild(h('ul',null,Dv.limitations.map(function(l){return h('li',{class:'count'},l)})))}}
(R.adapters||[]).filter(function(a){return a.status!=='not-applicable'}).forEach(function(a){var why=(a.reason||'');var miss=(a.missing||[]).map(function(m){return m.what+(m.setup?'  →  '+m.setup:'')});var tr=h('tr',null,h('td',null,a.id),h('td',{class:'st-'+a.status},a.status),h('td',null,(a.components||[]).join(', ')),h('td',null,a.executed?(a.passed+' passed / '+a.failed+' failed'+(a.skipped?' / '+a.skipped+' skipped':'')+(a.blocked?' / '+a.blocked+' blocked':'')):'—'),h('td',null,[why].concat(miss).filter(Boolean).map(function(t){return h('div',null,t)})));$('adapters').tBodies[0].appendChild(tr);var caps=(a.capabilities||[]).filter(function(c){return !c.available});});
var adapterIds=[];R.findings.forEach(function(f){if(f.adapter&&adapterIds.indexOf(f.adapter)<0)adapterIds.push(f.adapter)});adapterIds.forEach(function(a){$('fadapter').appendChild(h('option',null,a))});
var compIds=[];R.findings.forEach(function(f){if(f.component&&compIds.indexOf(f.component)<0)compIds.push(f.component)});compIds.forEach(function(a){$('fcomp').appendChild(h('option',null,a))});
cats.concat(['code-analysis']).filter(function(v,i,a){return a.indexOf(v)===i}).forEach(function(c){$('fcat').appendChild(h('option',null,c))});

function list(label,items,fmt){if(!items||!items.length)return null;return h('div',null,h('h3',null,label+' ('+items.length+')'),items.slice(0,10).map?items.slice(0,10).map(function(i){return h('pre',null,fmt(i))}):null)}
function render(f){
 var b=h('div',{class:'body'});
 b.appendChild(h('div',{class:'cols'},h('div',null,h('h3',null,'Expected'),h('p',null,f.expected)),h('div',null,h('h3',null,'Actual'),h('p',null,f.actual))));
 b.appendChild(h('h3',null,'Reproduction steps'));
 b.appendChild(h('ol',null,f.reproductionSteps.map(function(s){return h('li',null,s)})));
 var rp=f.reproduction;
 if(f.evidenceKind){b.appendChild(h('p',{class:'count'},h('span',{class:'chip ek-'+f.evidenceKind},f.evidenceKind==='failed-assertion'?'failed assertion in the project’s own tests (a bug OR an outdated test)':f.evidenceKind==='observed-defect'?'defect observed by FThisUp':'static heuristic (unconfirmed)'),f.scope?'  '+f.scope:''))}
 b.appendChild(h('p',{class:'count'},f.source==='execution'?(rp.attempted?'Reproduced on '+(rp.reproduced?'re-run':'0 of 1 re-runs')+' ('+rp.attempts+' attempts total). ':'Not re-run. ')+'Confidence: '+f.confidence+'. Route: '+f.route:'Static heuristic · confidence '+f.confidence+(f.file?' · '+f.file+(f.line?':'+f.line:''):'')));
 var sh=f.evidence.screenshot&&SH[f.evidence.screenshot];
 if(sh){var img=h('img',{class:'shot',src:sh,alt:'Screenshot at failure: '+f.title,loading:'lazy'});img.addEventListener('click',function(){var lb=$('lightbox');lb.querySelector('img').src=sh;lb.hidden=false});b.appendChild(h('h3',null,'Screenshot'));b.appendChild(img);}
 var ev=f.evidence;
 [['Uncaught page errors',ev.pageErrors,function(x){return x}],['Browser console errors',ev.consoleErrors,function(x){return x.text}],['Network failures',ev.networkFailures,function(x){return x.method+' '+x.url+' → '+(x.status||x.failure)}],['Mutating requests observed',ev.mutatingRequests,function(x){return x.method+' '+x.url+(x.failure?' ('+x.failure+')':'')}],['Requests blocked by safety policy',ev.blockedRequests,function(x){return x.method+' '+x.url+' — '+x.failure}],['Command output',ev.logs,function(x){return x}],['Commands executed',ev.commands,function(x){return x}],['Notes',ev.notes,function(x){return x}]].forEach(function(l){var n=list(l[0],l[1],l[2]);if(n)b.appendChild(n)});
 b.appendChild(h('h3',null,'Suggested fix'));b.appendChild(h('p',{class:'fix'},f.suggestedFix));
 var d=h('details',{class:'issue','data-s':[f.title,f.route,f.actual,f.expected,f.category,f.file||'',f.component||'',f.adapter||'',f.failureType||'',f.scope||''].concat(ev.pageErrors).join(' ').toLowerCase()},
  h('summary',null,h('span',{class:'badge sev-'+f.severity},f.severity),h('span',{class:'badge st-'+f.status},f.status),h('span',{class:'title'},f.title),f.discovery?h('span',{class:'badge new',title:'Found by a newly generated test, not by the project\u2019s own tests'},'NEW \u00b7 '+f.discovery.method):null,f.component?h('span',{class:'chip'},f.component):null,f.failureType?h('span',{class:'chip'},f.failureType):null,h('span',{class:'badge'},f.category)),b);
 d._f=f;return d}
var nodes=R.findings.slice().sort(function(a,b){var o={confirmed:0,suspected:1,'not-reproducible':2},s={critical:0,high:1,medium:2,low:3,info:4};return (o[a.status]-o[b.status])||(s[a.severity]-s[b.severity])}).map(render);
nodes.forEach(function(n){$('issues').appendChild(n)});
var none=h('div',{class:'empty',hidden:''},R.findings.length?'No issues match the current filters.':(S.total?'No issues found by the checks that ran.':'Nothing was executed.'));$('issues').appendChild(none);
function applyFilters(){var q=$('q').value.toLowerCase(),st=$('fstatus').value,sv=$('fsev').value,ct=$('fcat').value,n=0;
 nodes.forEach(function(d){var f=d._f;var ok=(!q||d.getAttribute('data-s').indexOf(q)>-1)&&(!st||f.status===st)&&(!sv||f.severity===sv)&&(!ct||f.category===ct)&&(!$('fcomp').value||f.component===$('fcomp').value)&&(!$('fadapter').value||f.adapter===$('fadapter').value);d.hidden=!ok;if(ok)n++});
 none.hidden=n>0;$('count').textContent=n+' of '+nodes.length+' issues shown'}
['q','fstatus','fsev','fcat','fcomp','fadapter'].forEach(function(id){$(id).addEventListener('input',applyFilters)});
var open=false;$('expand').addEventListener('click',function(){open=!open;nodes.forEach(function(d){if(!d.hidden)d.open=open});$('expand').textContent=open?'Collapse all':'Expand all'});
applyFilters();
var rows=R.results.map(function(r){var det=r.reason||(r.expectations.filter(function(e){return !e.passed}).map(function(e){return e.message}).join(' ')||'');
 var tr=h('tr',{'data-o':r.outcome,'data-s':(r.name+' '+r.category+' '+(r.adapter||'')+' '+r.target+' '+det).toLowerCase()},h('td',{class:'o-'+r.outcome},r.outcome),h('td',null,r.name),h('td',null,r.adapter||''),h('td',null,r.category),h('td',null,r.target),h('td',null,det));$('tbl').tBodies[0].appendChild(tr);return tr});
function f2(){var q=$('q2').value.toLowerCase(),o=$('fout').value;rows.forEach(function(tr){tr.hidden=!((!q||tr.getAttribute('data-s').indexOf(q)>-1)&&(!o||tr.getAttribute('data-o')===o))})}
$('q2').addEventListener('input',f2);$('fout').addEventListener('input',f2);
var notes=$('notes');notes.appendChild(h('h2',null,'Coverage & honesty notes'));
var C=R.coverage;var ul=h('ul');if(R.sandbox)ul.appendChild(h('li',null,'Isolation: '+R.sandbox.kind+' — '+R.sandbox.note));[ 'Routes discovered: '+C.routesDiscovered+' · navigation checks run: '+C.routesTested,'Forms discovered: '+C.formsDiscovered+' · forms exercised: '+C.formsTested].concat(C.notes).concat(R.safety.notes).forEach(function(n){ul.appendChild(h('li',null,n))});notes.appendChild(ul);
$('lightbox').addEventListener('click',function(){this.hidden=true});
document.addEventListener('keydown',function(e){if(e.key==='Escape')$('lightbox').hidden=true});
})();
`;
export function writeReport(resultsDir, results) {
    const file = path.join(resultsDir, 'report.html');
    fs.mkdirSync(resultsDir, { recursive: true });
    fs.writeFileSync(file, renderReport(results, resultsDir), 'utf8');
    return file;
}
