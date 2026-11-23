// FThisUp function-level fuzz harness (Node). Runs INSIDE the OS sandbox when available.
// usage: node fuzz-node.mjs <absolute module path> '<json config>'
import fs from 'node:fs';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';

const [, , modPath, cfgJson] = process.argv;
const cfg = JSON.parse(cfgJson);
const out = (o) => fs.writeSync(1, JSON.stringify(o) + '\n');
const DESTRUCTIVE = /(delete|remove|drop|kill|exit|reset|clear|write|save|send|publish|deploy|unlink|rmdir|destroy|truncate|format|install|exec|spawn|fetch|request|post|upload)/i;

process.on('uncaughtException', (e) => out({ t: 'async-error', name: e && e.name, message: String(e && e.message).slice(0, 200) }));
process.on('unhandledRejection', (e) => out({ t: 'async-error', name: e && e.name, message: String(e && e.message).slice(0, 200) }));

let ns;
try { ns = await import(pathToFileURL(modPath).href); } catch (e) { out({ t: 'load-error', name: e && e.name, message: String(e && e.message).slice(0, 300) }); process.exit(0); }

const fns = [];
const add = (name, f) => { if (typeof f === 'function' && !/^class\s/.test(Function.prototype.toString.call(f)) && f !== Object) fns.push([name, f]); };
for (const [k, v] of Object.entries(ns)) { if (k === 'default') { if (typeof v === 'function') add('default', v); else if (v && typeof v === 'object') for (const [k2, v2] of Object.entries(v)) add(k2, v2); } else add(k, v); }
const seen = new Set();
const selected = fns.filter(([n]) => !seen.has(n) && seen.add(n));
out({ t: 'functions', names: selected.map(([n]) => n) });

// ---- adversarial pool: edge=true means "well-typed boundary value", edge=false means "type confusion" ----
const nested = (d) => { let o = []; for (let i = 0; i < d; i++) o = [o]; return o; };
const circ = { a: 1 }; circ.self = circ;
const POOL = [
  ['empty string', '', true, 0], ['single space', ' ', true, 1], ['long string (100k)', 'A'.repeat(100000), true, 100000], ['unicode/emoji', 'Ünïcödé 日本語 🚀🔥 👨‍👩‍👧‍👦', true, 20], ['NUL and control chars', 'a\u0000b\u0001\u001f', true, 5],
  ['zero', 0, true, 0], ['negative one', -1, true, 0], ['MAX_SAFE_INTEGER+1', 2 ** 53, true, 0], ['1e308', 1e308, true, 0], ['NaN', NaN, true, 0], ['Infinity', Infinity, true, 0], ['-0', -0, true, 0],
  ['undefined', undefined, false, 0], ['null', null, false, 0], ['true', true, false, 0], ['empty array', [], false, 0], ['array [null]', [null], false, 1], ['empty object', {}, false, 0], ['object {a:1}', { a: 1 }, false, 1],
  ['huge array (50k)', Array.from({ length: 50000 }, (_, i) => i), false, 50000], ['deeply nested array (30000)', nested(30000), false, 30000], ['circular object', circ, false, 1], ['__proto__ payload', JSON.parse('{"__proto__":{"x":1}}'), false, 1],
  ['function', () => 1, false, 0], ['Invalid Date', new Date('x'), false, 0], ['Symbol', Symbol('s'), false, 0],
];

function* callsFor(arity) {
  const k = Math.max(1, Math.min(arity, 3));
  for (let i = 0; i < k; i++) for (let p = 0; p < POOL.length; p++) {
    const args = Array.from({ length: k }, () => 1);
    args[i] = POOL[p][1];
    yield { args, desc: k > 1 ? `arg${i + 1}=${POOL[p][0]}` : POOL[p][0], edge: POOL[p][2], size: POOL[p][3] };
  }
  if (k > 1) for (let p = 0; p < POOL.length; p++) yield { args: Array.from({ length: k }, () => POOL[p][1]), desc: `all args=${POOL[p][0]}`, edge: POOL[p][2], size: POOL[p][3] };
}

const only = cfg.only ? new Set(cfg.only) : null;
const skip = new Set(cfg.skip ?? []);
let total = 0;
for (const [name, f] of selected.slice(0, cfg.maxFunctions)) {
  if (only && !only.has(name)) continue;
  if (DESTRUCTIVE.test(name)) { out({ t: 'skip-fn', fn: name, reason: 'name suggests side effects (not fuzzed)' }); continue; }
  let i = 0;
  const all = [...callsFor(f.length)];
  const stride = Math.max(1, Math.ceil(all.length / cfg.maxCalls));
  for (let c = 0; c < all.length; c += stride) {
    const call = all[c]; i++;
    const key = name + '#' + c;
    if (skip.has(key)) continue;
    out({ t: 'start', fn: name, key, desc: call.desc, edge: call.edge, size: call.size });
    let outcome = 'returned', errName, errMsg;
    try {
      const ctx = vm.createContext({ f, args: call.args });
      let r = vm.runInContext('f.apply(undefined, args)', ctx, { timeout: cfg.timeoutMs });
      if (r && typeof r.then === 'function') {
        r = await Promise.race([r, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('promise did not settle'), { code: 'FT_UNSETTLED' })), cfg.timeoutMs).unref())]);
      }
    } catch (e) {
      const code = e && e.code;
      if (code === 'ERR_SCRIPT_EXECUTION_TIMEOUT' || code === 'FT_UNSETTLED') outcome = 'hang';
      else { outcome = 'threw'; errName = e && e.name ? String(e.name) : typeof e; errMsg = String(e && e.message !== undefined ? e.message : e).slice(0, 240); }
    }
    total++;
    out({ t: 'end', fn: name, key, outcome, name: errName, message: errMsg });
  }
}
out({ t: 'done', calls: total });
