import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { walkSources } from '../utils/files.js';
const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
export function resolveRef(doc, s, depth = 0) {
    if (!s || depth > 8)
        return s;
    if (s.$ref && s.$ref.startsWith('#/')) {
        let cur = doc;
        for (const part of s.$ref.slice(2).split('/'))
            cur = cur?.[part.replace(/~1/g, '/').replace(/~0/g, '~')];
        return resolveRef(doc, cur, depth + 1);
    }
    if (s.allOf?.length) {
        const merged = { type: 'object', properties: {}, required: [] };
        for (const part of s.allOf) {
            const r = resolveRef(doc, part, depth + 1) ?? {};
            Object.assign(merged.properties, r.properties ?? {});
            merged.required.push(...(r.required ?? []));
            if (r.type)
                merged.type = r.type;
        }
        return merged;
    }
    return s;
}
export function parseOpenApi(doc, file) {
    const notes = [];
    const eps = [];
    const isV3 = !!doc.openapi;
    let basePath = '';
    if (isV3 && Array.isArray(doc.servers) && doc.servers[0]?.url) {
        const u = String(doc.servers[0].url);
        try {
            basePath = u.startsWith('/') ? u : new URL(u).pathname;
        }
        catch {
            basePath = '';
        }
    }
    else if (doc.basePath)
        basePath = String(doc.basePath);
    if (basePath === '/')
        basePath = '';
    const globalSecurity = Array.isArray(doc.security) && doc.security.length > 0;
    for (const [p, item] of Object.entries(doc.paths ?? {})) {
        const common = item.parameters ?? [];
        for (const m of METHODS) {
            const op = item[m];
            if (!op)
                continue;
            const params = [...common, ...(op.parameters ?? [])].map((q) => resolveRef(doc, q)).filter((q) => q && ['path', 'query', 'header'].includes(q.in)).map((q) => ({ name: q.name, in: q.in, required: q.in === 'path' || !!q.required, schema: resolveRef(doc, q.schema ?? { type: q.type, format: q.format, enum: q.enum }) }));
            let body;
            if (isV3 && op.requestBody) {
                const rb = resolveRef(doc, op.requestBody);
                const js = rb?.content?.['application/json'];
                if (js)
                    body = { required: !!rb.required, schema: resolveRef(doc, js.schema) };
            }
            else if (!isV3) {
                const bp = params;
                const raw = [...common, ...(op.parameters ?? [])].find((q) => q.in === 'body');
                if (raw)
                    body = { required: !!raw.required, schema: resolveRef(doc, raw.schema) };
                void bp;
            }
            const responses = {};
            for (const [code, r] of Object.entries(op.responses ?? {})) {
                const rr = resolveRef(doc, r);
                responses[code] = resolveRef(doc, isV3 ? rr?.content?.['application/json']?.schema : rr?.schema);
            }
            const secured = Array.isArray(op.security) ? op.security.length > 0 : globalSecurity;
            eps.push({ method: m.toUpperCase(), path: p, operationId: op.operationId, summary: op.summary ?? op.description, params, body, responses, secured, source: path.basename(file), certainty: 'confirmed' });
        }
    }
    if (!eps.length)
        notes.push(`${file}: no operations found under "paths".`);
    return { endpoints: eps, basePath, components: doc.components?.schemas ?? doc.definitions ?? {}, file, notes };
}
/** Find an OpenAPI/Swagger file inside the project (never outside). */
export function findSpecFile(root, explicit) {
    if (explicit) {
        const p = path.resolve(root, explicit);
        return fs.existsSync(p) ? p : null;
    }
    const names = /^(openapi|swagger)\.(json|ya?ml)$/i;
    const visit = (dir, d) => {
        if (d > 3)
            return null;
        let ents = [];
        try {
            ents = fs.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return null;
        }
        for (const e of ents)
            if (e.isFile() && names.test(e.name))
                return path.join(dir, e.name);
        for (const e of ents)
            if (e.isDirectory() && !['node_modules', '.git', 'dist', 'build', 'target', 'venv', '.venv', '.fthisup-tmp', 'fthisup-results'].includes(e.name) && !e.name.startsWith('.')) {
                const r = visit(path.join(dir, e.name), d + 1);
                if (r)
                    return r;
            }
        return null;
    };
    return visit(root, 0);
}
export function loadSpecFile(file) {
    try {
        const text = fs.readFileSync(file, 'utf8');
        const doc = file.endsWith('.json') ? JSON.parse(text) : parseYaml(text);
        if (!doc || typeof doc !== 'object' || !doc.paths)
            return null;
        return parseOpenApi(doc, file);
    }
    catch {
        return null;
    }
}
/** Route definitions found in source (framework conventions). Inferred only: no schemas. */
export function discoverRoutesFromSource(root) {
    const out = [];
    const seen = new Set();
    const push = (method, p, src) => {
        const norm = p.replace(/\{(\w+)\}|:(\w+)/g, (_m, a, b) => `{${a ?? b}}`);
        const k = `${method} ${norm}`;
        if (seen.has(k) || !norm.startsWith('/'))
            return;
        seen.add(k);
        const params = [...norm.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: 'path', required: true }));
        out.push({ method: method.toUpperCase(), path: norm, params, responses: {}, secured: false, source: src, certainty: 'inferred' });
    };
    const { files } = walkSources(root, { maxFiles: 1500 });
    for (const f of files) {
        if (/(^|\/)(tests?|__tests__|spec|node_modules|fixtures)\//i.test(f.rel) || /\.(test|spec)\./.test(f.rel))
            continue;
        if (/\.(py)$/.test(f.rel)) {
            for (const m of f.text.matchAll(/@\w+\.(get|post|put|patch|delete)\(\s*["'](\/[^"']*)["']/g))
                push(m[1], m[2], f.rel);
            for (const m of f.text.matchAll(/@\w+\.route\(\s*["'](\/[^"']*)["'](?:\s*,\s*methods\s*=\s*\[([^\]]*)\])?/g)) {
                const methods = (m[2] ?? '"GET"').match(/[A-Za-z]+/g) ?? ['GET'];
                for (const me of methods)
                    push(me, m[1].replace(/<(?:\w+:)?(\w+)>/g, '{$1}'), f.rel);
            }
        }
        else if (/\.(jsx?|tsx?|mjs|cjs)$/.test(f.rel)) {
            for (const m of f.text.matchAll(/\b(?:app|router|server|fastify|api)\.(get|post|put|patch|delete)\(\s*["'`](\/[^"'`]*)["'`]/g))
                push(m[1], m[2], f.rel);
        }
    }
    return out;
}
// ------------------------------------------------------------------ values & validation
export function exampleFromSchema(doc, s, depth = 0) {
    const wrap = { components: { schemas: doc.components } };
    const r = resolveRef(wrap, s) ?? {};
    if (r.example !== undefined)
        return r.example;
    if (r.default !== undefined)
        return r.default;
    if (r.enum?.length)
        return r.enum[0];
    const t = Array.isArray(r.type) ? r.type.find((x) => x !== 'null') : r.type;
    if (depth > 3)
        return null;
    switch (t) {
        case 'integer': return Math.max(1, Math.ceil(r.minimum ?? 1));
        case 'number': return Math.max(1.5, r.minimum ?? 1.5);
        case 'boolean': return true;
        case 'array': return [exampleFromSchema(doc, r.items, depth + 1)];
        case 'object': {
            const o = {};
            for (const [k, v] of Object.entries(r.properties ?? {}))
                o[k] = exampleFromSchema(doc, v, depth + 1);
            return o;
        }
        default: return r.format === 'email' ? 'fthisup-test@example.invalid' : r.format === 'date' ? '2024-01-15' : r.format === 'date-time' ? '2024-01-15T12:00:00Z' : r.format === 'uuid' ? '00000000-0000-4000-8000-000000000000' : r.format === 'uri' ? 'https://example.invalid/' : 'fthisup-test';
    }
}
export function wrongTypeValue(doc, s) {
    const r = resolveRef({ components: { schemas: doc.components } }, s) ?? {};
    const t = Array.isArray(r.type) ? r.type.find((x) => x !== 'null') : r.type;
    if (t === 'integer' || t === 'number')
        return 'not-a-number';
    if (t === 'boolean')
        return 'maybe';
    if (t === 'array')
        return { not: 'an array' };
    if (t === 'object')
        return 'not-an-object';
    return { nested: ['not', 'a', 'string'] };
}
export function validateValue(doc, value, s, at = '$', depth = 0) {
    const r = resolveRef({ components: { schemas: doc.components } }, s);
    if (!r || depth > 6)
        return [];
    const errs = [];
    if (r.oneOf?.length || r.anyOf?.length) {
        const alts = (r.oneOf ?? r.anyOf);
        return alts.some((a) => validateValue(doc, value, a, at, depth + 1).length === 0) ? [] : [`${at}: matches none of the allowed alternatives`];
    }
    const types = Array.isArray(r.type) ? r.type : r.type ? [r.type] : [];
    if (value === null)
        return r.nullable || types.includes('null') || types.length === 0 ? [] : [`${at}: is null but the schema says ${types.join('|')}`];
    const actual = Array.isArray(value) ? 'array' : typeof value === 'number' ? (Number.isInteger(value) ? 'integer' : 'number') : typeof value;
    if (types.length && !types.some((t) => t === actual || (t === 'number' && actual === 'integer')))
        return [`${at}: is ${actual} but the schema says ${types.join('|')}`];
    if (r.enum && !r.enum.some((e) => JSON.stringify(e) === JSON.stringify(value)))
        errs.push(`${at}: ${JSON.stringify(value)} is not one of ${JSON.stringify(r.enum)}`);
    if (actual === 'object' && value && typeof value === 'object') {
        for (const req of r.required ?? [])
            if (!(req in value))
                errs.push(`${at}: missing required property "${req}"`);
        for (const [k, sub] of Object.entries(r.properties ?? {}))
            if (k in value)
                errs.push(...validateValue(doc, value[k], sub, `${at}.${k}`, depth + 1));
    }
    if (actual === 'array' && r.items)
        value.slice(0, 5).forEach((v, i) => errs.push(...validateValue(doc, v, r.items, `${at}[${i}]`, depth + 1)));
    return errs.slice(0, 5);
}
