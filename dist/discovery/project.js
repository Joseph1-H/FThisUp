import fs from 'node:fs';
import path from 'node:path';
import { readJsonSafe, walkSources, lineOf } from '../utils/files.js';
const FRAMEWORKS = [
    { dep: 'next', name: 'Next.js', port: 3000 },
    { dep: 'nuxt', name: 'Nuxt', port: 3000 },
    { dep: '@sveltejs/kit', name: 'SvelteKit', port: 5173 },
    { dep: '@remix-run/react', name: 'Remix', port: 3000 },
    { dep: 'astro', name: 'Astro', port: 4321 },
    { dep: '@angular/core', name: 'Angular', port: 4200 },
    { dep: 'react-scripts', name: 'Create React App', port: 3000 },
    { dep: 'vite', name: 'Vite', port: 5173 },
    { dep: 'vue', name: 'Vue', port: 5173 },
    { dep: 'svelte', name: 'Svelte', port: 5173 },
    { dep: 'react', name: 'React', port: 3000 },
    { dep: 'express', name: 'Express', port: 3000 },
    { dep: 'fastify', name: 'Fastify', port: 3000 },
    { dep: 'koa', name: 'Koa', port: 3000 },
    { dep: 'hono', name: 'Hono', port: 3000 },
];
const TEST_FRAMEWORKS = ['vitest', 'jest', 'mocha', '@playwright/test', 'cypress', 'puppeteer', '@testing-library/react', 'ava', 'jasmine', 'karma'];
const AUTH_DEPS = ['next-auth', '@auth/core', '@clerk/nextjs', '@clerk/clerk-react', 'passport', '@auth0/auth0-react', 'lucia', 'jsonwebtoken', 'bcrypt', 'bcryptjs', '@supabase/supabase-js', 'firebase', 'better-auth', 'express-session', 'iron-session'];
const API_DEPS = ['axios', 'swr', '@tanstack/react-query', '@trpc/client', 'graphql', '@apollo/client', 'ky', 'got', 'urql', 'openai', '@anthropic-ai/sdk', 'stripe'];
function add(arr, value, certainty, source) {
    if (!arr.some((i) => i.value === value))
        arr.push({ value, certainty, source });
}
export function discoverProject(root) {
    const pkgPath = path.join(root, 'package.json');
    const pkg = readJsonSafe(pkgPath);
    const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
    const has = (d) => d in deps;
    const out = {
        root, name: pkg?.name ?? path.basename(root), framework: null, language: [], testFrameworks: [], startCommands: [],
        likelyPort: null, routes: [], forms: [], authSignals: [], apiIntegrations: [], unsupportedPlatforms: [], notes: [], filesScanned: 0,
    };
    // --- confirmed: read directly from manifests ---
    if (pkg) {
        const fw = FRAMEWORKS.find((f) => has(f.dep));
        if (fw) {
            out.framework = { value: fw.name, certainty: 'confirmed', source: `package.json dependency "${fw.dep}"` };
            out.likelyPort = { value: fw.port, certainty: 'inferred', source: `default dev port for ${fw.name}` };
        }
        for (const t of TEST_FRAMEWORKS)
            if (has(t))
                add(out.testFrameworks, t, 'confirmed', 'package.json');
        for (const a of AUTH_DEPS)
            if (has(a))
                add(out.authSignals, `dependency: ${a}`, 'confirmed', 'package.json');
        for (const a of API_DEPS)
            if (has(a))
                add(out.apiIntegrations, `dependency: ${a}`, 'confirmed', 'package.json');
        const pm = fs.existsSync(path.join(root, 'pnpm-lock.yaml')) ? 'pnpm' : fs.existsSync(path.join(root, 'yarn.lock')) ? 'yarn' : fs.existsSync(path.join(root, 'bun.lockb')) || fs.existsSync(path.join(root, 'bun.lock')) ? 'bun' : 'npm';
        for (const s of ['dev', 'start', 'serve', 'preview']) {
            const script = pkg.scripts?.[s];
            if (script)
                add(out.startCommands, `${pm} run ${s}`, 'confirmed', `package.json scripts.${s} = "${script}"`);
            const port = script?.match(/(?:--port[= ]|-p[= ]|PORT=)(\d{4,5})/)?.[1];
            if (port)
                out.likelyPort = { value: Number(port), certainty: 'confirmed', source: `package.json scripts.${s}` };
        }
        out.language.push(fs.existsSync(path.join(root, 'tsconfig.json')) || has('typescript')
            ? { value: 'TypeScript', certainty: 'confirmed', source: 'tsconfig.json / typescript dependency' }
            : { value: 'JavaScript', certainty: 'inferred', source: 'package.json present, no TypeScript found' });
        if (has('react-native') || has('expo'))
            add(out.unsupportedPlatforms, 'React Native', 'confirmed', 'package.json');
    }
    if (fs.existsSync(path.join(root, 'pubspec.yaml')))
        add(out.unsupportedPlatforms, 'Flutter', 'confirmed', 'pubspec.yaml');
    if (fs.existsSync(path.join(root, 'android', 'build.gradle')) || fs.existsSync(path.join(root, 'app', 'build.gradle')))
        add(out.unsupportedPlatforms, 'Android', 'confirmed', 'build.gradle');
    if (fs.existsSync(path.join(root, 'ios')) && fs.readdirSync(path.join(root, 'ios')).some((f) => f.endsWith('.xcodeproj') || f === 'Podfile'))
        add(out.unsupportedPlatforms, 'iOS', 'confirmed', 'ios/');
    for (const pyFile of ['requirements.txt', 'pyproject.toml']) {
        const p = path.join(root, pyFile);
        if (!fs.existsSync(p))
            continue;
        const txt = fs.readFileSync(p, 'utf8').toLowerCase();
        out.language.push({ value: 'Python', certainty: 'confirmed', source: pyFile });
        for (const [k, name, port] of [['flask', 'Flask', 5000], ['django', 'Django', 8000], ['fastapi', 'FastAPI', 8000]]) {
            if (txt.includes(k) && !out.framework) {
                out.framework = { value: name, certainty: 'confirmed', source: pyFile };
                out.likelyPort = { value: port, certainty: 'inferred', source: `default port for ${name}` };
            }
        }
    }
    if (out.unsupportedPlatforms.length) {
        out.notes.push(`Detected ${out.unsupportedPlatforms.map((p) => p.value).join(', ')}: FThisUp ${'v0.1'} tests browser-based apps only. Mobile/Flutter testing is planned, not implemented.`);
    }
    // --- inferred: pattern scanning of source ---
    const { files, truncated } = walkSources(root);
    out.filesScanned = files.length;
    if (truncated)
        out.notes.push('Source scan stopped at 3000 files; results may be incomplete.');
    scanRoutes(files, out);
    scanForms(files, out);
    scanAuthAndApi(files, out);
    if (!pkg && !out.framework && files.some((f) => f.rel.endsWith('.html'))) {
        out.framework = { value: 'Static HTML', certainty: 'inferred', source: '*.html files, no package.json' };
    }
    return out;
}
function routeFromFile(rel) {
    const strip = (p) => '/' + p.replace(/\/?(index|page|\+page|route)$/, '').replace(/^\/+/, '');
    let m;
    if ((m = rel.match(/^(?:src\/)?app\/(.*?)\/?page\.(?:tsx|jsx|ts|js)$/)))
        return '/' + m[1].replace(/\([^)]*\)\/?/g, '');
    if (/^(?:src\/)?app\/page\.(tsx|jsx|ts|js)$/.test(rel))
        return '/';
    if ((m = rel.match(/^(?:src\/)?pages\/(.*)\.(?:tsx|jsx|ts|js|vue|astro|md|mdx)$/))) {
        if (/^(_|api\/)/.test(m[1]) || m[1].startsWith('_'))
            return null;
        return strip(m[1]);
    }
    if ((m = rel.match(/^src\/routes\/(.*?)\/?\+page\.(?:svelte|ts|js)$/)))
        return '/' + m[1].replace(/\([^)]*\)\/?/g, '');
    if (/^src\/routes\/\+page\.(svelte|ts|js)$/.test(rel))
        return '/';
    if ((m = rel.match(/^(?:public\/|static\/)?([^/]*(?:\/[^/]*)*)\.html?$/)) && !rel.includes('/fixtures/') && !/^(dist|build)\//.test(rel)) {
        const p = m[1].replace(/^(public|static)\//, '');
        return strip(p) === '/' ? '/' : strip(p) + '.html';
    }
    return null;
}
function scanRoutes(files, out) {
    const seen = new Set();
    const push = (route, source) => {
        if (seen.has(route))
            return;
        seen.add(route);
        out.routes.push({ value: route, certainty: 'inferred', source });
    };
    for (const f of files) {
        const fileRoute = routeFromFile(f.rel);
        if (fileRoute !== null)
            push(fileRoute, `${f.rel} (file-based routing convention)`);
        if (!/\.(jsx?|tsx?|vue|mjs|cjs)$/.test(f.rel))
            continue;
        const reRoute = /(?:<Route[^>]*\spath=|path:\s*)["'`](\/[^"'`\s]*)["'`]/g;
        for (let m; (m = reRoute.exec(f.text));)
            push(m[1], `${f.rel}:${lineOf(f.text, m.index)} (router definition)`);
        const reExpress = /\b(?:app|router)\.(get|post|put|patch|delete)\(\s*["'`](\/[^"'`\s]*)["'`]/g;
        for (let m; (m = reExpress.exec(f.text));) {
            if (m[1] === 'get' && !m[2].startsWith('/api'))
                push(m[2], `${f.rel}:${lineOf(f.text, m.index)} (server route)`);
            else
                add(out.apiIntegrations, `${m[1].toUpperCase()} ${m[2]} (server endpoint)`, 'inferred', `${f.rel}:${lineOf(f.text, m.index)}`);
        }
    }
}
function scanForms(files, out) {
    for (const f of files) {
        if (!/\.(jsx|tsx|vue|svelte|astro|html?|js|ts)$/.test(f.rel))
            continue;
        const re = /<form\b[^>]*>/gi;
        for (let m; (m = re.exec(f.text)) && out.forms.length < 200;) {
            out.forms.push({ value: `<form> in ${f.rel}`, certainty: 'inferred', source: `${f.rel}:${lineOf(f.text, m.index)}`, line: lineOf(f.text, m.index) });
        }
    }
}
function scanAuthAndApi(files, out) {
    for (const f of files) {
        if (/(^|\/)(login|signin|sign-in|signup|sign-up|register|auth)[^/]*\.(jsx?|tsx?|vue|svelte|html?|py)$/i.test(f.rel) || /\/(login|signin|signup|register|auth)\//i.test(f.rel)) {
            add(out.authSignals, `auth-related file: ${f.rel}`, 'inferred', f.rel);
        }
        if (!/\.(jsx?|tsx?|vue|svelte|astro|mjs|html?)$/.test(f.rel))
            continue;
        if (/type=["']password["']/i.test(f.text))
            add(out.authSignals, `password field in ${f.rel}`, 'inferred', f.rel);
        const reFetch = /\b(?:fetch|axios(?:\.(?:get|post|put|patch|delete))?)\(\s*[`"']([^`"']{2,160})[`"']/g;
        for (let m; (m = reFetch.exec(f.text)) && out.apiIntegrations.length < 100;) {
            add(out.apiIntegrations, `call to ${m[1]}`, 'inferred', `${f.rel}:${lineOf(f.text, m.index)}`);
        }
    }
}
