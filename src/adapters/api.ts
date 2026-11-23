import path from 'node:path';
import type { Capability, ExpectationResult, FailureType, Finding, Severity, TestResult } from '../core/types.js';
import { probeUrl } from '../core/runner.js';
import { classifySensitivity } from '../safety/classify.js';
import { checkApproval, evaluateTarget, SafetyGuard } from '../safety/policy.js';
import { foreignPortChecker } from '../safety/scope.js';
import { validateApiScenarios, type ApiExpectation, type ApiScenario } from '../scenarios/api-schema.js';
import { mkFinding, mkResult, owningComponent, slugify, statusFrom, tail } from './common.js';
import { loadSection } from './cli.js';
import { discoverRoutesFromSource, exampleFromSchema, findSpecFile, loadSpecFile, parseOpenApi, validateValue, wrongTypeValue, type ApiEndpoint, type ApiParam, type ApiSpec, type Schema } from './openapi.js';
import type { AdapterOutcome, DetectionResult, PlannedTest, ProjectContext, TestAdapter, TestPlan } from './types.js';

// ------------------------------------------------------------------------------------------------ request model
interface Req { method: string; path: string; query?: Record<string, string>; headers?: Record<string, string>; body?: string; contentType?: string | null; auth?: 'none' | 'invalid' | 'valid'; parallel?: number }
interface Res { status: number | null; headers: Record<string, string>; body: string; json?: unknown; durationMs: number; error?: string }

type Exp =
  | ApiExpectation
  | { type: 'rejects4xx'; hard: boolean }
  | { type: 'declaredStatus' }
  | { type: 'matchesSchema'; schema?: Schema; hard: boolean }
  | { type: 'noConnectionError' }
  | { type: 'consistentUnderConcurrency' }
  | { type: 'authRejects'; hard: boolean }
  | { type: 'authAccepts' };

interface Probe {
  id: string; name: string; kind: string; ep?: ApiEndpoint; req: Req; expect: Exp[]; risk: 'low' | 'medium' | 'high';
  mutating: boolean; sensitivity?: ApiScenario['sensitivity']; origin: 'heuristic' | 'agent'; priority: number; declared?: string[];
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
const MAX_BODY = 4000;
const PAYLOADS = ["'; DROP TABLE users;--", '<script>alert(1)</script>', '../../../../etc/passwd', '%00%0d%0a', 'A'.repeat(8000), '日本語🚀', '${7*7}{{7*7}}'];

function fillPath(ep: ApiEndpoint, spec: ApiSpec | null, override?: Record<string, string>): string {
  return ep.path.replace(/\{(\w+)\}/g, (_m, name: string) => {
    if (override && name in override) return encodeURIComponent(override[name]!);
    const prm = ep.params.find((p) => p.name === name);
    const ex = prm?.schema ? exampleFromSchema({ components: spec?.components ?? {} }, prm.schema) : undefined;
    return encodeURIComponent(String(ex ?? 'fthisup-1'));
  });
}

function requiredQuery(ep: ApiEndpoint, spec: ApiSpec | null): Record<string, string> {
  const q: Record<string, string> = {};
  for (const p of ep.params.filter((x) => x.in === 'query' && x.required)) q[p.name] = String(exampleFromSchema({ components: spec?.components ?? {} }, p.schema) ?? 'fthisup');
  return q;
}

const isStringParam = (p: ApiParam) => !p.schema?.type || p.schema.type === 'string';

export function generateProbes(spec: ApiSpec | null, endpoints: ApiEndpoint[], opts: { protectedPaths: string[]; concurrency: number; allowMutations: boolean }): Probe[] {
  const out: Probe[] = [];
  const doc = { components: spec?.components ?? {} };
  const add = (p: Omit<Probe, 'origin'>) => out.push({ origin: 'heuristic', ...p });
  const byPath = new Map<string, ApiEndpoint[]>();
  for (const ep of endpoints) byPath.set(ep.path, [...(byPath.get(ep.path) ?? []), ep]);

  for (const ep of endpoints) {
    const sens = classifySensitivity(ep.path, ep.summary, ep.operationId);
    const mutating = !SAFE.has(ep.method);
    const del = ep.method === 'DELETE';
    const tag = `api:${ep.method}:${slugify(ep.path)}`;
    const base = { ep, mutating, sensitivity: del ? ('deletion' as const) : sens, risk: (del || sens ? 'high' : mutating ? 'medium' : 'low') as Probe['risk'] };
    const declared = Object.keys(ep.responses);
    const fp = fillPath(ep, spec);
    const rq = requiredQuery(ep, spec);
    const secureReq = ep.secured || opts.protectedPaths.some((g) => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`).test(ep.path));
    const bodyOk = ep.body?.schema ? exampleFromSchema(doc, ep.body.schema) : {};
    const bodyReq = (b: string | undefined, ct: string | null = 'application/json'): Req => ({ method: ep.method, path: fp, query: rq, body: b, contentType: ct });
    const schemaForOk = (() => { const k = declared.find((c) => /^2\d\d$/.test(c)); return k ? ep.responses[k] : undefined; })();

    if (!mutating) {
      add({ ...base, id: `${tag}:baseline`, name: `${ep.method} ${ep.path}: valid request`, kind: 'baseline', req: { method: ep.method, path: fp, query: rq }, priority: 0, declared,
        expect: [{ type: 'no5xx' }, { type: 'noConnectionError' }, { type: 'respondsWithinMs', ms: 5000 }, ...(declared.length ? [{ type: 'declaredStatus' } as Exp] : []), { type: 'matchesSchema', schema: schemaForOk, hard: ep.certainty === 'confirmed' }] });
      const strParams = ep.params.filter((p) => p.in !== 'header' && isStringParam(p)).slice(0, 2);
      strParams.forEach((p, i) => {
        const payload = PAYLOADS[(i * 3) % PAYLOADS.length]!;
        const all = PAYLOADS.slice(0, 4);
        void payload;
        add({ ...base, id: `${tag}:special-${p.name}`, name: `${ep.method} ${ep.path}: hostile characters in ${p.in} param "${p.name}"`, kind: 'special-chars', priority: 3,
          req: p.in === 'path' ? { method: ep.method, path: fillPath(ep, spec, { [p.name]: all[0]! + all[1]! }), query: rq } : { method: ep.method, path: fp, query: { ...rq, [p.name]: all[0]! + all[1]! + 'é' } },
          expect: [{ type: 'no5xx' }, { type: 'noConnectionError' }] });
      });
      const intParams = ep.params.filter((p) => p.in !== 'header' && (p.schema?.type === 'integer' || p.schema?.type === 'number')).slice(0, 2);
      intParams.forEach((p) => add({ ...base, id: `${tag}:wrong-type-${p.name}`, name: `${ep.method} ${ep.path}: non-numeric value for "${p.name}"`, kind: 'wrong-type', priority: 2,
        req: p.in === 'path' ? { method: ep.method, path: fillPath(ep, spec, { [p.name]: 'not-a-number' }), query: rq } : { method: ep.method, path: fp, query: { ...rq, [p.name]: 'not-a-number' } },
        expect: [{ type: 'no5xx' }, { type: 'noConnectionError' }, { type: 'rejects4xx', hard: ep.certainty === 'confirmed' && p.in === 'path' ? false : ep.certainty === 'confirmed' }] }));
      const missing = ep.params.filter((p) => p.in === 'query' && p.required);
      if (missing.length) add({ ...base, id: `${tag}:missing-required-query`, name: `${ep.method} ${ep.path}: missing required query parameter(s) ${missing.map((m) => m.name).join(', ')}`, kind: 'missing-param', priority: 1,
        req: { method: ep.method, path: fp }, expect: [{ type: 'no5xx' }, { type: 'noConnectionError' }, { type: 'rejects4xx', hard: true }] });
      if (ep.method === 'GET' && opts.concurrency > 1) add({ ...base, id: `${tag}:concurrency`, name: `${ep.method} ${ep.path}: ${opts.concurrency} simultaneous requests`, kind: 'concurrency', priority: 4,
        req: { method: 'GET', path: fp, query: rq, parallel: opts.concurrency }, expect: [{ type: 'consistentUnderConcurrency' }, { type: 'noConnectionError' }] });
    } else if (['POST', 'PUT', 'PATCH'].includes(ep.method)) {
      add({ ...base, id: `${tag}:malformed-json`, name: `${ep.method} ${ep.path}: malformed JSON body`, kind: 'malformed-json', priority: 0,
        req: bodyReq('{"fthisup": [1, 2,'), expect: [{ type: 'no5xx' }, { type: 'noConnectionError' }, { type: 'rejects4xx', hard: false }] });
      const props = Object.keys(resolveProps(spec, ep.body?.schema));
      const required = resolveRequired(spec, ep.body?.schema);
      if (required.length || ep.body?.required) add({ ...base, id: `${tag}:missing-required`, name: `${ep.method} ${ep.path}: ${required.length ? `body without required field(s) ${required.join(', ')}` : 'empty body'}`, kind: 'missing-required', priority: 1,
        req: bodyReq(required.length ? '{}' : undefined), expect: [{ type: 'no5xx' }, { type: 'noConnectionError' }, { type: 'rejects4xx', hard: ep.certainty === 'confirmed' }] });
      if (props.length) props.slice(0, 2).forEach((prop) => {
        const sch = resolveProps(spec, ep.body?.schema)[prop];
        const bad = { ...(typeof bodyOk === 'object' && bodyOk ? (bodyOk as object) : {}), [prop]: wrongTypeValue(doc, sch) };
        add({ ...base, id: `${tag}:wrong-type-${slugify(prop)}`, name: `${ep.method} ${ep.path}: wrong type for body field "${prop}"`, kind: 'wrong-type', priority: 2,
          req: bodyReq(JSON.stringify(bad)), expect: [{ type: 'no5xx' }, { type: 'noConnectionError' }, { type: 'rejects4xx', hard: ep.certainty === 'confirmed' }] });
      });
      add({ ...base, id: `${tag}:wrong-content-type`, name: `${ep.method} ${ep.path}: JSON sent as text/plain`, kind: 'content-type', priority: 3,
        req: bodyReq(JSON.stringify(bodyOk), 'text/plain'), expect: [{ type: 'no5xx' }, { type: 'noConnectionError' }] });
      add({ ...base, id: `${tag}:oversized`, name: `${ep.method} ${ep.path}: 1 MB request body`, kind: 'oversized', priority: 4,
        req: bodyReq(JSON.stringify({ fthisup: 'A'.repeat(1_000_000) })), expect: [{ type: 'no5xx' }, { type: 'noConnectionError' }] });
    } else if (del) {
      add({ ...base, id: `${tag}:invalid-id`, name: `DELETE ${ep.path}: invalid identifier`, kind: 'wrong-type', priority: 5,
        req: { method: 'DELETE', path: fillPath(ep, spec, Object.fromEntries(ep.params.filter((p) => p.in === 'path').map((p) => [p.name, 'not-a-number'])) ), query: rq }, expect: [{ type: 'no5xx' }, { type: 'noConnectionError' }] });
    }
    if (secureReq) {
      add({ ...base, mutating: false, risk: 'low', sensitivity: undefined, id: `${tag}:auth-none`, name: `${ep.method} ${ep.path}: rejects anonymous access`, kind: 'auth', priority: 1,
        req: { method: ep.method === 'POST' || ep.method === 'PUT' || ep.method === 'PATCH' ? ep.method : 'GET', path: fp, query: rq, auth: 'none', body: ep.method === 'GET' ? undefined : '{}', contentType: ep.method === 'GET' ? null : 'application/json' },
        expect: [{ type: 'noConnectionError' }, { type: 'authRejects', hard: true }, { type: 'no5xx' }] });
      add({ ...base, mutating: false, risk: 'low', sensitivity: undefined, id: `${tag}:auth-invalid`, name: `${ep.method} ${ep.path}: rejects an invalid token`, kind: 'auth', priority: 2,
        req: { method: ep.method === 'POST' || ep.method === 'PUT' || ep.method === 'PATCH' ? ep.method : 'GET', path: fp, query: rq, auth: 'invalid', body: ep.method === 'GET' ? undefined : '{}', contentType: ep.method === 'GET' ? null : 'application/json' },
        expect: [{ type: 'noConnectionError' }, { type: 'authRejects', hard: true }, { type: 'no5xx' }] });
    }
  }
  // undeclared HTTP method, once per path (only a safe GET, or PATCH when the path has no sensitive operations and mutations are allowed)
  for (const [p, eps] of byPath) {
    const declared = new Set(eps.map((e) => e.method));
    const ep = eps[0]!;
    const method = !declared.has('GET') ? 'GET' : opts.allowMutations && !declared.has('PATCH') && !eps.some((e) => classifySensitivity(e.path, e.summary)) ? 'PATCH' : null;
    if (!method || eps.some((e) => e.secured)) continue;
    add({ ep, mutating: method !== 'GET', sensitivity: undefined, risk: method === 'GET' ? 'low' : 'medium', id: `api:${method}:${slugify(p)}:unsupported-method`, name: `${method} ${p}: method not declared for this path`, kind: 'unsupported-method', priority: 3,
      req: { method, path: fillPath(ep, spec), contentType: method === 'GET' ? null : 'application/json', body: method === 'GET' ? undefined : '{}' }, expect: [{ type: 'no5xx' }, { type: 'noConnectionError' }, { type: 'statusIn', codes: [400, 401, 403, 404, 405, 415, 501] }] });
  }
  return out;
}

function resolveProps(spec: ApiSpec | null, s: Schema | undefined): Record<string, Schema> {
  return (exampleResolve(spec, s)?.properties ?? {}) as Record<string, Schema>;
}
function resolveRequired(spec: ApiSpec | null, s: Schema | undefined): string[] { return exampleResolve(spec, s)?.required ?? []; }
function exampleResolve(spec: ApiSpec | null, s: Schema | undefined): Schema | undefined {
  let cur: Schema | undefined = s;
  for (let i = 0; i < 6 && cur?.$ref; i++) cur = spec?.components?.[cur.$ref.split('/').pop()!];
  return cur;
}

// ------------------------------------------------------------------------------------------------ http client
async function send(guard: SafetyGuard, base: string, req: Req, token: string | undefined, authCfg: { header: string; scheme: string } | undefined, timeoutMs: number): Promise<Res> {
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/$/, '')}${req.path}`.replace(/\/{2,}/g, '/');
  for (const [k, v] of Object.entries(req.query ?? {})) url.searchParams.set(k, v);
  const verdict = await guard.checkRequest(url.toString(), req.method, 'fetch');
  if (!verdict.allow) return { status: null, headers: {}, body: '', durationMs: 0, error: `blocked by safety policy: ${verdict.reason}` };
  const headers: Record<string, string> = { accept: 'application/json, */*;q=0.5', 'user-agent': 'fthisup' };
  if (req.body !== undefined && req.contentType !== null) headers['content-type'] = req.contentType ?? 'application/json';
  if (req.auth === 'invalid') headers[authCfg?.header ?? 'Authorization'] = `${authCfg?.scheme ?? 'Bearer'} fthisup-invalid-token`.trim();
  else if (req.auth === 'valid' && token) headers[authCfg?.header ?? 'Authorization'] = `${authCfg?.scheme ?? 'Bearer'} ${token}`.trim();
  Object.assign(headers, req.headers ?? {});
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method: req.method, headers, body: req.body, redirect: 'manual', signal: ctl.signal });
    const buf = Buffer.from(await r.arrayBuffer()).subarray(0, 200_000).toString('utf8');
    let json: unknown;
    if (/json/i.test(r.headers.get('content-type') ?? '')) { try { json = JSON.parse(buf); } catch { json = undefined; } }
    const hdrs: Record<string, string> = {}; r.headers.forEach((v, k) => { hdrs[k] = v; });
    return { status: r.status, headers: hdrs, body: buf, json, durationMs: Date.now() - t0 };
  } catch (e) {
    const aborted = (e as Error).name === 'AbortError';
    const cause = (e as { cause?: { code?: string } }).cause?.code;
    return { status: null, headers: {}, body: '', durationMs: Date.now() - t0, error: aborted ? 'timeout' : cause ?? (e as Error).message };
  } finally { clearTimeout(timer); }
}

// ------------------------------------------------------------------------------------------------ evaluation
interface Eval { r: ExpectationResult; failureType: FailureType }

function evaluate(p: Probe, res: Res[], spec: ApiSpec | null, hasToken: boolean): Eval[] {
  const first = res[0]!;
  const E = (type: string, passed: boolean, hard: boolean, severity: Severity, message: string, failureType: FailureType): Eval => ({ r: { type, passed, hard, severity, message }, failureType });
  const out: Eval[] = [];
  const st = first.status;
  const where = `${p.req.method} ${p.req.path}`;
  for (const e of p.expect) {
    switch (e.type) {
      case 'no5xx': {
        const bad = res.find((x) => (x.status ?? 0) >= 500);
        out.push(E('no5xx', !bad, true, p.kind === 'baseline' ? 'high' : 'medium', bad ? `${where} returned HTTP ${bad.status}${p.kind === 'baseline' ? ' for a VALID request' : ' for unusual input (should be a handled 4xx)'}.` : 'No 5xx.', p.kind === 'baseline' ? 'unhandled-exception' : 'input-validation'));
        break;
      }
      case 'noConnectionError': {
        const bad = res.find((x) => x.error && x.error !== 'timeout' && !x.error.startsWith('blocked'));
        out.push(E('noConnectionError', !bad, true, 'critical', bad ? `The connection failed (${bad.error}) — the server dropped the request or crashed.` : 'Connection ok.', 'crash'));
        break;
      }
      case 'respondsWithinMs': {
        const slow = res.find((x) => x.error === 'timeout' || x.durationMs > e.ms);
        out.push(E('respondsWithinMs', !slow, false, 'medium', slow ? `No complete response within ${e.ms}ms (${slow.error === 'timeout' ? 'timed out' : `${slow.durationMs}ms`}).` : 'Timely.', 'hang'));
        break;
      }
      case 'rejects4xx': {
        const ok = st !== null && st >= 400 && st < 500;
        const accepted = st !== null && st >= 200 && st < 300;
        out.push(E('rejects4xx', ok || (st !== null && st >= 500) || st === null, e.hard, 'medium', accepted ? `${where} accepted invalid input with HTTP ${st} instead of rejecting it with a 4xx.` : 'Rejected.', 'input-validation'));
        break;
      }
      case 'statusIn': {
        out.push(E('statusIn', st === null || e.codes.includes(st) || st >= 500, false, 'low', `${where} answered HTTP ${st}; expected one of ${e.codes.join(', ')}.`, 'incorrect-output'));
        break;
      }
      case 'declaredStatus': {
        const ok = st === null || p.declared!.includes(String(st)) || p.declared!.includes('default') || (st >= 500 ? true : false);
        out.push(E('declaredStatus', ok, false, 'low', `${where} answered HTTP ${st}, which is not documented in the API spec (${p.declared!.join(', ')}).`, 'incorrect-output'));
        break;
      }
      case 'matchesSchema': {
        if (!e.schema || st === null || st < 200 || st >= 300 || res[0]!.json === undefined) { out.push(E('matchesSchema', true, e.hard, 'medium', 'n/a', 'incorrect-output')); break; }
        const errs = validateValue({ components: spec?.components ?? {} }, first.json, e.schema);
        out.push(E('matchesSchema', errs.length === 0, e.hard, 'medium', `The response of ${where} does not match its documented schema: ${errs.slice(0, 3).join('; ')}`, 'incorrect-output'));
        break;
      }
      case 'consistentUnderConcurrency': {
        const classes = new Set(res.map((x) => (x.status === null ? 'err' : Math.floor(x.status / 100))));
        const any5 = res.some((x) => (x.status ?? 0) >= 500);
        out.push(E('consistentUnderConcurrency', classes.size === 1 && !any5, true, 'medium', any5 && classes.size === 1 ? `${res.length} simultaneous identical requests all failed with a server error (${res.map((x) => x.status ?? x.error).join(', ')}); a request that works alone fails under load or after earlier requests changed state.` : `${res.length} simultaneous identical requests produced different outcomes (${res.map((x) => x.status ?? x.error).join(', ')}).`, 'invalid-state-transition'));
        break;
      }
      case 'authRejects': {
        const ok = st === null || st === 401 || st === 403 || st >= 500 /* reported separately */ || st === 404 || st === 405;
        out.push(E('authRejects', ok, e.hard, 'critical', `${where} responded HTTP ${st} to a request WITHOUT valid credentials; a protected endpoint must answer 401/403.`, 'auth-error'));
        break;
      }
      case 'authAccepts': out.push(E('authAccepts', !hasToken || (st !== 401 && st !== 403), false, 'medium', `${where} rejected the supplied test credentials (HTTP ${st}).`, 'auth-error')); break;
      case 'jsonBody': out.push(E('jsonBody', first.json !== undefined, false, 'low', `${where} did not return a JSON body.`, 'incorrect-output')); break;
      case 'bodyContains': out.push(E('bodyContains', first.body.includes(e.text), false, 'medium', `The body does not contain "${e.text}".`, 'incorrect-output')); break;
    }
  }
  return out;
}

const FIX: Record<FailureType, string> = {
  'unhandled-exception': 'Handle the failing code path: validate input first and return a 4xx; add a global error handler so exceptions never surface as HTTP 500.',
  'input-validation': 'Validate request bodies, parameters and types at the boundary (schema validation) and answer 400/422 for invalid input; never let bad input reach business logic.',
  crash: 'The server dropped the connection or died: check its logs for the exception; guard parsing and body-size limits.',
  hang: 'Add timeouts and make the handler bounded; avoid blocking work in the request path.',
  'auth-error': 'Enforce authentication on the server for this route (middleware/dependency) and return 401/403 for missing or invalid credentials.',
  'incorrect-output': 'Align the implementation with the documented contract (status codes and response schema), or update the spec if the implementation is right.',
  'invalid-state-transition': 'Make the handler safe for concurrent requests (idempotent reads, no shared mutable state without locking).',
  'resource-usage': 'Bound request size and processing cost.',
} as unknown as Record<FailureType, string>;

// ------------------------------------------------------------------------------------------------ adapter
async function loadSpec(ctx: ProjectContext, url: string | null): Promise<{ spec: ApiSpec | null; endpoints: ApiEndpoint[]; notes: string[]; source: string }> {
  const notes: string[] = [];
  const file = findSpecFile(ctx.root, ctx.config.api?.spec);
  let spec = file ? loadSpecFile(file) : null;
  let source = file ? `OpenAPI file ${path.relative(ctx.root, file)}` : '';
  if (!spec && url) {
    for (const p of ['/openapi.json', '/swagger.json', '/v3/api-docs']) {
      try {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 3000);
        const r = await fetch(new URL(p, url), { signal: ctl.signal, redirect: 'manual' }); clearTimeout(t);
        if (r.ok && /json/.test(r.headers.get('content-type') ?? '')) { const doc = await r.json(); if ((doc as any)?.paths) { spec = parseOpenApi(doc, p); source = `live ${p}`; break; } }
      } catch { /* not served */ }
    }
  }
  let endpoints = spec?.endpoints ?? [];
  if (file && !spec) notes.push(`${path.relative(ctx.root, file)} could not be parsed as OpenAPI.`);
  if (!endpoints.length) { endpoints = discoverRoutesFromSource(ctx.root); if (endpoints.length) source = 'route definitions in source (inferred, no schemas)'; }
  else {
    const inferred = discoverRoutesFromSource(ctx.root).filter((r) => !endpoints.some((e) => e.method === r.method && e.path === r.path));
    if (inferred.length) notes.push(`${inferred.length} route(s) found in source but missing from the spec: ${inferred.slice(0, 5).map((r) => `${r.method} ${r.path}`).join(', ')}.`);
  }
  return { spec, endpoints, notes, source };
}

export const apiAdapter: TestAdapter = {
  id: 'api',
  name: 'HTTP API / backend',
  description: 'Discovers endpoints (OpenAPI or framework routes) and probes a RUNNING API with malformed, invalid and hostile requests, auth checks and bounded concurrency.',
  requirements: ['a running API on localhost (or an authorized target)', 'OpenAPI spec (file or served) or recognizable route definitions'],
  categories: ['api'],
  safety: ['same SafetyGuard as the browser: loopback default, allow-listed remote targets, third parties never contacted', 'mutating requests only when allowed; DELETE and sensitive endpoints need approval', 'token-bucket rate limit and request budget; concurrency hard-capped at 5', 'auth tests use only the supplied test token and never retry credentials (no brute force)', 'production targets are read-only'],
  resourceGroup: 'network',

  async detect(ctx): Promise<DetectionResult> {
    const url = ctx.apiUrl;
    const file = findSpecFile(ctx.root, ctx.config.api?.spec);
    const routes = file ? [] : discoverRoutesFromSource(ctx.root);
    const owner = file ? owningComponent(ctx, file) : routes[0] ? owningComponent(ctx, routes[0].source) : undefined;
    const apiComps = owner ? [owner] : ctx.manifest.components.filter((c) => c.roles.includes('api')).map((c) => c.id);
    let live = false;
    if (!file && !routes.length && url && apiComps.length && evaluateTarget(url, ctx.config).allowed) live = !!(await loadSpec(ctx, url)).spec;
    const applicable = !!file || routes.length > 0 || live || !!ctx.config.api?.spec;
    return { applicable, confidence: file || live ? 'high' : 'medium', components: apiComps.length ? apiComps : ctx.manifest.components.slice(0, 1).map((c) => c.id), reason: file ? `OpenAPI spec ${path.relative(ctx.root, file)}` : live ? 'OpenAPI spec served by the running API' : routes.length ? `${routes.length} route definition(s) found in source` : 'no API definitions found' };
  },

  async capabilities(ctx): Promise<Capability[]> {
    const url = ctx.apiUrl;
    const caps: Capability[] = [];
    // policy first: an unauthorized host is never contacted, not even to check that it is reachable
    const policy = url ? evaluateTarget(url, ctx.config) : null;
    if (policy && !policy.allowed) {
      caps.push({ id: 'target-policy', label: 'Authorized API target', available: false, reason: `target blocked by the safety policy: ${policy.reason} (nothing was contacted)`, setup: policy.hint });
      return caps;
    }
    const reach = url ? await probeUrl(url, 3000) : { ok: false, detail: 'no URL' };
    caps.push({ id: 'running-api', label: 'Running API', available: !!url && reach.ok, reason: url ? (reach.ok ? url : `${url} is not reachable (${reach.detail})`) : 'no URL given and nothing found on common local ports', setup: 'start your API, then pass --url / --api-url or set "api.url" in fthisup.config.json' });
    const { endpoints, source } = await loadSpec(ctx, reach.ok ? url : null);
    caps.push({ id: 'endpoints', label: 'Endpoint discovery', available: endpoints.length > 0, reason: endpoints.length ? `${endpoints.length} endpoint(s) from ${source}` : 'no OpenAPI spec or route definitions found', setup: 'add an openapi.json/yaml to the project or set "api.spec" in fthisup.config.json' });
    const authCfg = ctx.config.api?.auth;
    if (authCfg) caps.push({ id: 'auth-token', label: 'Test API token', available: !!process.env[authCfg.tokenEnv], reason: process.env[authCfg.tokenEnv] ? `$${authCfg.tokenEnv} is set` : `$${authCfg.tokenEnv} is not set: only anonymous/invalid-token checks will run`, setup: `export ${authCfg.tokenEnv}=<a TEST account token>` });
    return caps;
  },

  async plan(ctx, options): Promise<TestPlan> {
    const caps = await this.capabilities(ctx);
    const missing = caps.filter((c) => !c.available && c.id !== 'auth-token').map((c) => ({ what: `${c.label}: ${c.reason}`, setup: c.setup }));
    const base = { adapterId: 'api', capabilities: caps, components: (await this.detect(ctx)).components, notes: [] as string[] };
    if (missing.length) return { ...base, status: 'unavailable', reason: missing.map((m) => m.what).join('; '), missing, tests: [] };
    const url = ctx.apiUrl!;
    const { spec, endpoints, notes } = await loadSpec(ctx, url);
    const decision = evaluateTarget(url, ctx.config);
    if (!decision.allowed) return { ...base, status: 'unavailable', reason: `target blocked by the safety policy: ${decision.reason}`, missing: [{ what: decision.reason, setup: decision.hint }], tests: [] };
    const guard = new SafetyGuard(decision, ctx.config, { isForeignPort: foreignPortChecker(ctx.root) });
    const eps = endpoints.slice(0, ctx.config.api?.maxEndpoints ?? 40);
    const probes = generateProbes(spec, eps, { protectedPaths: ctx.config.api?.auth?.protectedPaths ?? [], concurrency: ctx.config.api?.concurrency ?? 3, allowMutations: guard.mutationsAllowed });
    let agent: ApiScenario[] = []; let rejected: Array<{ id?: string; errors: string[] }> = [];
    if (options.scenariosFile) { const v = validateApiScenarios(loadSection(ctx, options.scenariosFile, 'apiScenarios')); agent = v.valid; rejected = v.rejected; }
    const all = [...agent.map(agentProbe), ...probes.sort((a, b) => a.priority - b.priority)];
    const capped = all.slice(0, options.maxTests);
    const tests: PlannedTest[] = capped.map((p) => ({ id: p.id, name: p.name, category: 'api', component: base.components[0] ?? '', risk: p.risk, requiresApproval: p.mutating && p.risk === 'high' }));
    return { ...base, status: 'ready', missing: [], notes: [...notes, `Endpoints: ${endpoints.length} (${eps.length} tested) from ${endpoints[0]?.certainty === 'confirmed' ? 'the OpenAPI spec' : 'source route definitions'}.`, ...(endpoints.length > eps.length ? [`api.maxEndpoints (${ctx.config.api?.maxEndpoints ?? 40}) limited the endpoints tested.`] : [])], tests, droppedByCap: Math.max(0, all.length - capped.length), state: { probes: capped, spec, rejected } };
  },

  async execute(plan, exec): Promise<AdapterOutcome> {
    const ctx = exec.project;
    const { probes, spec, rejected } = plan.state as { probes: Probe[]; spec: ApiSpec | null; rejected: unknown[] };
    const url = ctx.apiUrl!;
    const decision = evaluateTarget(url, ctx.config);
    if (!decision.allowed) return { results: [], findings: [], notes: [], blocked: decision.reason };
    const guard = new SafetyGuard(decision, ctx.config, { isForeignPort: foreignPortChecker(ctx.root) });
    const authCfg = ctx.config.api?.auth;
    const token = authCfg ? process.env[authCfg.tokenEnv] : undefined;
    const timeout = Math.min(ctx.config.timeout, 10_000);
    const basePath = spec?.basePath ?? '';
    const baseUrl = basePath ? new URL(basePath, url).toString() : url;
    const results: TestResult[] = []; const findings: Finding[] = []; const notes: string[] = [];
    let n = 0; const nextId = () => `A${++n}`;
    const comp = plan.components[0] ?? '';
    exec.onStage?.('Probing the API...');

    for (const p of probes) {
      guard.beginScenario();
      const base = { scenarioId: p.id, name: p.name, category: 'api' as const, adapter: 'api', component: comp, target: p.req.path, risk: p.risk, origin: p.origin };
      const push = (r: TestResult) => { results.push(r); exec.onProgress?.(r); };
      if (p.mutating && !guard.mutationsAllowed) { push(mkResult({ ...base, outcome: 'blocked', reason: decision.readOnly ? 'production targets are read-only; mutating requests are blocked' : 'mutating requests are disabled for this target (set safety.allowFormSubmission: true to allow)' })); continue; }
      const gate = checkApproval(ctx.config, { requiresApproval: p.mutating && !!p.sensitivity, sensitivity: p.sensitivity, risk: p.risk === 'high' && !p.sensitivity ? 'high' : 'low' });
      if (!gate.allowed) { push(mkResult({ ...base, outcome: 'blocked', reason: gate.reason })); continue; }
      const doSend = async (): Promise<Res[]> => p.req.parallel ? Promise.all(Array.from({ length: p.req.parallel }, () => send(guard, baseUrl, p.req, token, authCfg, timeout))) : [await send(guard, baseUrl, p.req, token, authCfg, timeout)];
      const first = await doSend();
      if (first.every((r) => r.error?.startsWith('blocked'))) { push(mkResult({ ...base, outcome: 'blocked', reason: first[0]!.error })); continue; }
      const ev = evaluate(p, first, spec, !!token);
      const failing = ev.filter((e) => !e.r.passed);
      if (!failing.length) { push(mkResult({ ...base, outcome: 'passed', durationMs: first[0]!.durationMs, expectations: ev.map((e) => e.r) })); continue; }

      const second = await doSend();
      const f2 = new Set(evaluate(p, second, spec, !!token).filter((e) => !e.r.passed).map((e) => e.r.type));
      const reproducedTypes = new Set(failing.filter((f) => f2.has(f.r.type)).map((f) => f.r.type));
      const reproduced = reproducedTypes.size > 0;
      const hard = failing.some((f) => f.r.hard && reproducedTypes.has(f.r.type));
      const { status, confidence } = statusFrom(reproduced, true, hard);
      const rank = ['info', 'low', 'medium', 'high', 'critical'];
      const worst = [...failing].sort((a, b) => rank.indexOf(b.r.severity) - rank.indexOf(a.r.severity))[0]!;
      const r0 = first[0]!;
      const curl = `curl -i -X ${p.req.method} '${new URL(p.req.path, baseUrl).toString()}${p.req.query && Object.keys(p.req.query).length ? '?' + new URLSearchParams(p.req.query).toString() : ''}'${p.req.body !== undefined ? ` -H 'content-type: ${p.req.contentType ?? 'application/json'}' --data '${p.req.body.length > 200 ? p.req.body.slice(0, 200) + '…' : p.req.body}'` : ''}`;
      const f = mkFinding({
        id: nextId(), title: p.name, category: 'api', adapter: 'api', component: comp, route: `${p.req.method} ${p.ep?.path ?? p.req.path}`, status, severity: worst.r.severity, confidence, failureType: worst.failureType,
        evidenceKind: 'observed-defect', scenarioId: p.id, expected: expectedText(p), actual: failing.map((e) => e.r.message).join(' '),
        steps: [`Start the API at ${url}`, `Send: ${curl}`, `Observe the response: HTTP ${r0.status ?? r0.error}${p.req.parallel ? ` (and ${p.req.parallel - 1} more simultaneous)` : ''}.`],
        attempts: 2, reproduced, scope: `api ${p.req.method} ${p.ep?.path ?? p.req.path}`, fix: [...new Set(failing.map((e) => FIX[e.failureType] ?? ''))].filter(Boolean).join(' '),
        evidence: { logs: [`HTTP ${r0.status ?? r0.error} in ${r0.durationMs}ms`, `response body:\n${tail(r0.body, 8, MAX_BODY)}`], commands: [curl], notes: p.ep?.certainty === 'inferred' ? ['Endpoint discovered from source (no schema): expectations are limited to server-error and connection checks.'] : [] },
      });
      findings.push(f);
      push(mkResult({ ...base, outcome: 'failed', durationMs: r0.durationMs, expectations: ev.map((e) => e.r), reason: failing[0]!.r.message, findingId: f.id }));
    }
    if ((rejected as unknown[]).length) notes.push(`${(rejected as unknown[]).length} supplied API scenario(s) were rejected by validation and never executed.`);
    return { results, findings, notes, safety: { targetClass: decision.targetClass, environment: decision.environment, notes: [decision.reason, ...decision.notes] } };
  },
};

function expectedText(p: Probe): string {
  const parts = new Set<string>();
  for (const e of p.expect) parts.add(({
    no5xx: p.kind === 'baseline' ? 'A valid request never produces a server error.' : 'Unusual or invalid input is rejected with a handled 4xx, never a 5xx.',
    noConnectionError: 'The server keeps serving requests (no dropped connections or crashes).', respondsWithinMs: 'The API responds in a reasonable time.',
    rejects4xx: 'Invalid input is rejected with a 4xx status.', statusIn: 'The API answers with a sensible error status.', declaredStatus: 'Responses use status codes documented in the spec.',
    matchesSchema: 'The response body matches the documented schema.', consistentUnderConcurrency: 'Simultaneous identical requests get consistent answers.', authRejects: 'Protected endpoints reject anonymous or invalid credentials with 401/403.',
    authAccepts: 'Valid test credentials are accepted.', jsonBody: 'The API returns JSON.', bodyContains: 'The response contains the expected content.',
  } as Record<string, string>)[e.type] ?? e.type);
  return [...parts].join(' ');
}

function agentProbe(a: ApiScenario): Probe {
  const body = a.rawBody ?? (a.json !== undefined ? JSON.stringify(a.json) : undefined);
  const mutating = !SAFE.has(a.method);
  return {
    id: `api:agent:${a.id}`, name: `${a.name} (agent)`, kind: 'agent', req: { method: a.method, path: a.path, query: a.query, headers: a.headers, body, contentType: body !== undefined ? a.contentType ?? 'application/json' : null },
    expect: a.expect.map((e) => (e.type === 'rejects' ? ({ type: 'rejects4xx', hard: false } as Exp) : e)), risk: a.risk, mutating, sensitivity: a.sensitivity ?? (a.method === 'DELETE' ? 'deletion' : undefined), origin: 'agent', priority: -1,
  };
}
