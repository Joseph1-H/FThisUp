import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { readJsonSafe, walkSources } from '../utils/files.js';

export interface ApiParam { name: string; in: 'path' | 'query' | 'header'; required: boolean; schema?: Schema }
export type Schema = { type?: string | string[]; format?: string; enum?: unknown[]; properties?: Record<string, Schema>; required?: string[]; items?: Schema; nullable?: boolean; example?: unknown; default?: unknown; minimum?: number; maximum?: number; $ref?: string; allOf?: Schema[]; oneOf?: Schema[]; anyOf?: Schema[]; additionalProperties?: boolean | Schema };
export interface ApiEndpoint {
  method: string;
  path: string;
  operationId?: string;
  summary?: string;
  params: ApiParam[];
  body?: { required: boolean; schema?: Schema };
  /** declared status codes -> response schema (JSON) */
  responses: Record<string, Schema | undefined>;
  /** the spec says this operation needs credentials */
  secured: boolean;
  source: string;
  certainty: 'confirmed' | 'inferred';
}
export interface ApiSpec { endpoints: ApiEndpoint[]; basePath: string; components: Record<string, Schema>; file?: string; notes: string[] }

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

export function resolveRef(doc: any, s: Schema | undefined, depth = 0): Schema | undefined {
  if (!s || depth > 8) return s;
  if (s.$ref && s.$ref.startsWith('#/')) {
    let cur: any = doc;
    for (const part of s.$ref.slice(2).split('/')) cur = cur?.[part.replace(/~1/g, '/').replace(/~0/g, '~')];
    return resolveRef(doc, cur, depth + 1);
  }
  if (s.allOf?.length) {
    const merged: Schema = { type: 'object', properties: {}, required: [] };
    for (const part of s.allOf) {
      const r = resolveRef(doc, part, depth + 1) ?? {};
      Object.assign(merged.properties!, r.properties ?? {});
      merged.required!.push(...(r.required ?? []));
      if (r.type) merged.type = r.type;
    }
    return merged;
  }
  return s;
}

export function parseOpenApi(doc: any, file: string): ApiSpec {
  const notes: string[] = [];
  const eps: ApiEndpoint[] = [];
  const isV3 = !!doc.openapi;
  let basePath = '';
  if (isV3 && Array.isArray(doc.servers) && doc.servers[0]?.url) {
    const u = String(doc.servers[0].url);
    try { basePath = u.startsWith('/') ? u : new URL(u).pathname; } catch { basePath = ''; }
  } else if (doc.basePath) basePath = String(doc.basePath);
  if (basePath === '/') basePath = '';
  const globalSecurity = Array.isArray(doc.security) && doc.security.length > 0;
  for (const [p, item] of Object.entries<any>(doc.paths ?? {})) {
    const common: any[] = item.parameters ?? [];
    for (const m of METHODS) {
      const op = item[m];
      if (!op) continue;
      const params: ApiParam[] = [...common, ...(op.parameters ?? [])].map((q: any) => resolveRef(doc, q) as any).filter((q: any) => q && ['path', 'query', 'header'].includes(q.in)).map((q: any) => ({ name: q.name, in: q.in, required: q.in === 'path' || !!q.required, schema: resolveRef(doc, q.schema ?? { type: q.type, format: q.format, enum: q.enum }) }));
      let body: ApiEndpoint['body'];
      if (isV3 && op.requestBody) {
        const rb = resolveRef(doc, op.requestBody as any) as any;
        const js = rb?.content?.['application/json'];
        if (js) body = { required: !!rb.required, schema: resolveRef(doc, js.schema) };
      } else if (!isV3) {
        const bp = params as any[];
        const raw = [...common, ...(op.parameters ?? [])].find((q: any) => q.in === 'body');
        if (raw) body = { required: !!raw.required, schema: resolveRef(doc, raw.schema) };
        void bp;
      }
      const responses: ApiEndpoint['responses'] = {};
      for (const [code, r] of Object.entries<any>(op.responses ?? {})) {
        const rr = resolveRef(doc, r) as any;
        responses[code] = resolveRef(doc, isV3 ? rr?.content?.['application/json']?.schema : rr?.schema);
      }
      const secured = Array.isArray(op.security) ? op.security.length > 0 : globalSecurity;
      eps.push({ method: m.toUpperCase(), path: p, operationId: op.operationId, summary: op.summary ?? op.description, params, body, responses, secured, source: path.basename(file), certainty: 'confirmed' });
    }
  }
  if (!eps.length) notes.push(`${file}: no operations found under "paths".`);
  return { endpoints: eps, basePath, components: doc.components?.schemas ?? doc.definitions ?? {}, file, notes };
}

/** Find an OpenAPI/Swagger file inside the project (never outside). */
export function findSpecFile(root: string, explicit?: string): string | null {
  if (explicit) { const p = path.resolve(root, explicit); return fs.existsSync(p) ? p : null; }
  const names = /^(openapi|swagger)\.(json|ya?ml)$/i;
  const stack = [root];
  let depth = 0;
  void depth;
  const visit = (dir: string, d: number): string | null => {
    if (d > 3) return null;
    let ents: fs.Dirent[] = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
    for (const e of ents) if (e.isFile() && names.test(e.name)) return path.join(dir, e.name);
    for (const e of ents) if (e.isDirectory() && !['node_modules', '.git', 'dist', 'build', 'target', 'venv', '.venv', '.fthisup-tmp', 'fthisup-results'].includes(e.name) && !e.name.startsWith('.')) { const r = visit(path.join(dir, e.name), d + 1); if (r) return r; }
    return null;
  };
  void stack;
  return visit(root, 0);
}

export function loadSpecFile(file: string): ApiSpec | null {
  try {
    const text = fs.readFileSync(file, 'utf8');
    const doc = file.endsWith('.json') ? JSON.parse(text) : parseYaml(text);
    if (!doc || typeof doc !== 'object' || !(doc as any).paths) return null;
    return parseOpenApi(doc, file);
  } catch { return null; }
}

/** Route definitions found in source (framework conventions). Inferred only: no schemas. */
export function discoverRoutesFromSource(root: string): ApiEndpoint[] {
  const out: ApiEndpoint[] = [];
  const seen = new Set<string>();
  const push = (method: string, p: string, src: string) => {
    const norm = p.replace(/\{(\w+)\}|:(\w+)/g, (_m, a, b) => `{${a ?? b}}`);
    const k = `${method} ${norm}`;
    if (seen.has(k) || !norm.startsWith('/')) return;
    seen.add(k);
    const params: ApiParam[] = [...norm.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1]!, in: 'path' as const, required: true }));
    out.push({ method: method.toUpperCase(), path: norm, params, responses: {}, secured: false, source: src, certainty: 'inferred' });
  };
  const { files } = walkSources(root, { maxFiles: 1500 });
  for (const f of files) {
    if (/(^|\/)(tests?|__tests__|spec|node_modules|fixtures)\//i.test(f.rel) || /\.(test|spec)\./.test(f.rel)) continue;
    if (/\.(py)$/.test(f.rel)) {
      for (const m of f.text.matchAll(/@\w+\.(get|post|put|patch|delete)\(\s*["'](\/[^"']*)["']/g)) push(m[1]!, m[2]!, f.rel);
      for (const m of f.text.matchAll(/@\w+\.route\(\s*["'](\/[^"']*)["'](?:\s*,\s*methods\s*=\s*\[([^\]]*)\])?/g)) {
        const methods = (m[2] ?? '"GET"').match(/[A-Za-z]+/g) ?? ['GET'];
        for (const me of methods) push(me, m[1]!.replace(/<(?:\w+:)?(\w+)>/g, '{$1}'), f.rel);
      }
    } else if (/\.(jsx?|tsx?|mjs|cjs)$/.test(f.rel)) {
      for (const m of f.text.matchAll(/\b(?:app|router|server|fastify|api)\.(get|post|put|patch|delete)\(\s*["'`](\/[^"'`]*)["'`]/g)) push(m[1]!, m[2]!, f.rel);
    }
  }
  return out;
}

// ------------------------------------------------------------------ values & validation
export function exampleFromSchema(doc: { components: Record<string, Schema> }, s: Schema | undefined, depth = 0): unknown {
  const wrap = { components: { schemas: doc.components } };
  const r = resolveRef(wrap, s) ?? {};
  if (r.example !== undefined) return r.example;
  if (r.default !== undefined) return r.default;
  if (r.enum?.length) return r.enum[0];
  const t = Array.isArray(r.type) ? r.type.find((x) => x !== 'null') : r.type;
  if (depth > 3) return null;
  switch (t) {
    case 'integer': return Math.max(1, Math.ceil(r.minimum ?? 1));
    case 'number': return Math.max(1.5, r.minimum ?? 1.5);
    case 'boolean': return true;
    case 'array': return [exampleFromSchema(doc, r.items, depth + 1)];
    case 'object': { const o: Record<string, unknown> = {}; for (const [k, v] of Object.entries(r.properties ?? {})) o[k] = exampleFromSchema(doc, v, depth + 1); return o; }
    default: return r.format === 'email' ? 'fthisup-test@example.invalid' : r.format === 'date' ? '2024-01-15' : r.format === 'date-time' ? '2024-01-15T12:00:00Z' : r.format === 'uuid' ? '00000000-0000-4000-8000-000000000000' : r.format === 'uri' ? 'https://example.invalid/' : 'fthisup-test';
  }
}

export function wrongTypeValue(doc: { components: Record<string, Schema> }, s: Schema | undefined): unknown {
  const r = resolveRef({ components: { schemas: doc.components } }, s) ?? {};
  const t = Array.isArray(r.type) ? r.type.find((x) => x !== 'null') : r.type;
  if (t === 'integer' || t === 'number') return 'not-a-number';
  if (t === 'boolean') return 'maybe';
  if (t === 'array') return { not: 'an array' };
  if (t === 'object') return 'not-an-object';
  return { nested: ['not', 'a', 'string'] };
}

export function validateValue(doc: { components: Record<string, Schema> }, value: unknown, s: Schema | undefined, at = '$', depth = 0): string[] {
  const r = resolveRef({ components: { schemas: doc.components } }, s);
  if (!r || depth > 6) return [];
  const errs: string[] = [];
  if (r.oneOf?.length || r.anyOf?.length) {
    const alts = (r.oneOf ?? r.anyOf)!;
    return alts.some((a) => validateValue(doc, value, a, at, depth + 1).length === 0) ? [] : [`${at}: matches none of the allowed alternatives`];
  }
  const types = Array.isArray(r.type) ? r.type : r.type ? [r.type] : [];
  if (value === null) return r.nullable || types.includes('null') || types.length === 0 ? [] : [`${at}: is null but the schema says ${types.join('|')}`];
  const actual = Array.isArray(value) ? 'array' : typeof value === 'number' ? (Number.isInteger(value) ? 'integer' : 'number') : typeof value;
  if (types.length && !types.some((t) => t === actual || (t === 'number' && actual === 'integer'))) return [`${at}: is ${actual} but the schema says ${types.join('|')}`];
  if (r.enum && !r.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) errs.push(`${at}: ${JSON.stringify(value)} is not one of ${JSON.stringify(r.enum)}`);
  if (actual === 'object' && value && typeof value === 'object') {
    for (const req of r.required ?? []) if (!(req in (value as object))) errs.push(`${at}: missing required property "${req}"`);
    for (const [k, sub] of Object.entries(r.properties ?? {})) if (k in (value as object)) errs.push(...validateValue(doc, (value as any)[k], sub, `${at}.${k}`, depth + 1));
  }
  if (actual === 'array' && r.items) (value as unknown[]).slice(0, 5).forEach((v, i) => errs.push(...validateValue(doc, v, r.items, `${at}[${i}]`, depth + 1)));
  return errs.slice(0, 5);
}
void readJsonSafe;
