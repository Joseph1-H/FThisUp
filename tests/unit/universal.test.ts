import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { configSchema } from '../../src/core/config.js';
import { detectProjectManifest } from '../../src/detect/manifest.js';
import { assertAllowed, cleanEnv, ExecBlockedError, newScratch, cleanupScratch, runProcess } from '../../src/exec/run.js';
import { sandboxInfo } from '../../src/exec/sandbox.js';
import { which } from '../../src/exec/tools.js';
import { checkApproval } from '../../src/safety/policy.js';
import { validateCliScenarios } from '../../src/scenarios/cli-schema.js';
import { validateApiScenarios } from '../../src/scenarios/api-schema.js';
import { exampleFromSchema, parseOpenApi, discoverRoutesFromSource, validateValue, wrongTypeValue, loadSpecFile } from '../../src/adapters/openapi.js';
import { generateProbes } from '../../src/adapters/api.js';
import { baseScenarios, findStackTrace, didCrash, helpDerived } from '../../src/adapters/cli.js';
import { flagFor, type Obs } from '../../src/adapters/fuzz.js';
import { validateGodotProject } from '../../src/adapters/godot.js';
import { planRun, UnknownAdapterError } from '../../src/core/orchestrator.js';
import { ADAPTERS } from '../../src/adapters/registry.js';
import { ROOT, bareDir, tmpDir } from '../helpers.js';

const write = (root: string, rel: string, content = '') => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); };
const P = (n: string) => path.join(ROOT, 'tests', 'fixtures', 'projects', n);

describe('project detection (monorepo, many ecosystems)', () => {
  const root = bareDir();
  write(root, 'web/package.json', JSON.stringify({ name: 'web', dependencies: { next: '14', react: '18', '@supabase/supabase-js': '2' }, devDependencies: { typescript: '5', vitest: '1' }, scripts: { test: 'vitest run' } }));
  write(root, 'web/tsconfig.json', '{}');
  write(root, 'api/pyproject.toml', '[project]\nname="api"\ndependencies=["fastapi","pytest"]\n[project.scripts]\napi="api.main:run"');
  write(root, 'api/tests/test_a.py', 'import pytest\ndef test_a(): pass');
  write(root, 'core/Cargo.toml', '[package]\nname="core"\n[dependencies]\naxum="0.7"');
  write(root, 'core/src/main.rs', 'fn main(){}');
  write(root, 'svc/go.mod', 'module x\nrequire github.com/gin-gonic/gin v1');
  write(root, 'svc/a_test.go', 'package x');
  write(root, 'mobile/pubspec.yaml', 'name: m\ndependencies:\n  flutter:\n    sdk: flutter\n  supabase_flutter: ^2.0.0\n');
  write(root, 'mobile/android/build.gradle', '');
  write(root, 'mobile/ios/Podfile', '');
  write(root, 'mobile/test/a_test.dart', 'void main(){}');
  write(root, 'jvm/pom.xml', '<project><dependencies><dependency>spring-boot-starter</dependency></dependencies></project>');
  write(root, 'jvm/src/test/java/A.java', '');
  write(root, 'native/CMakeLists.txt', 'project(x)\nenable_testing()\nadd_executable(x x.c)\nadd_test(NAME t COMMAND x)');
  write(root, 'pkg/Package.swift', '// swift-tools-version:5.9\n.executableTarget(name: "x")');
  write(root, 'pkg/Tests/XTests.swift', '');
  write(root, 'game/project.godot', 'config_version=5\n[application]\nrun/main_scene="res://m.tscn"\nconfig/features=PackedStringArray("4.2")');
  write(root, 'legacy/App.csproj', '<Project/>');
  const m = detectProjectManifest(root);
  const by = (id: string) => m.components.find((c) => c.id === id)!;

  it('finds one independent component per ecosystem and directory', () => {
    expect(m.components.map((c) => c.id).sort()).toEqual(['cpp:native', 'dotnet:legacy', 'flutter:mobile', 'go:svc', 'godot:game', 'java:jvm', 'node:web', 'python:api', 'rust:core', 'swift:pkg']);
  });
  it('identifies languages, frameworks, roles and integrations', () => {
    expect(by('node:web')).toMatchObject({ languages: ['TypeScript'], roles: expect.arrayContaining(['web-app', 'api']), integrations: ['Supabase'] });
    expect(by('node:web').frameworks).toContain('next');
    expect(by('python:api')).toMatchObject({ roles: expect.arrayContaining(['api', 'cli']), testFrameworks: expect.arrayContaining(['pytest']) });
    expect(by('rust:core').roles).toEqual(expect.arrayContaining(['api', 'cli']));
    expect(by('go:svc').frameworks).toContain('gin');
    expect(by('flutter:mobile')).toMatchObject({ roles: ['mobile-app'], frameworks: ['Flutter'], integrations: ['Supabase'] });
    expect(by('java:jvm')).toMatchObject({ frameworks: ['Spring Boot'], buildSystems: ['maven'] });
    expect(by('swift:pkg').testFrameworks).toContain('XCTest');
    expect(by('godot:game')).toMatchObject({ roles: ['game'], entryPoints: ['res://m.tscn'], frameworks: ['Godot 4.2'] });
    expect(by('dotnet:legacy').notes.join()).toMatch(/not supported/);
  });
  it('NEVER assumes a config file means the tool exists: availability is checked against PATH', () => {
    const expectTool = (id: string, tool: string) => {
      const cmds = by(id).testCommands;
      expect(cmds.length, id).toBeGreaterThan(0);
      for (const c of cmds) {
        if (c.runner === 'ctest') continue;
        expect(c.available, `${id} ${c.file}`).toBe(!!which(tool) && !c.reason);
        if (!c.available) expect(c.reason).toBeTruthy();
      }
    };
    expectTool('rust:core', 'cargo'); expectTool('go:svc', 'go'); expectTool('flutter:mobile', 'flutter'); expectTool('swift:pkg', 'swift');
  });
  it('reports missing dependencies instead of pretending a JS test command can run', () => {
    const cmd = by('node:web').testCommands[0]!;
    expect(cmd.available).toBe(false);
    expect(cmd.reason).toMatch(/dependencies are not installed/);
    expect(cmd.setup).toBe('npm install');
  });
  it('records candidate adapters, never claims availability', () => {
    expect(by('node:web').adapters).toEqual(expect.arrayContaining(['web', 'api', 'javascript']));
    expect(by('godot:game').adapters).toContain('godot');
  });
  it('handles an empty directory gracefully', () => {
    expect(detectProjectManifest(bareDir()).components.map((c) => c.id)).toEqual([]);
  });
});

describe('execution safety (exec layer)', () => {
  const root = tmpDir();
  it('never runs shells, and only allow-listed tools or binaries inside the project', () => {
    for (const sh of ['sh', 'bash', '/bin/sh', 'cmd.exe', 'powershell', 'zsh']) expect(() => assertAllowed(sh, root), sh).toThrow(ExecBlockedError);
    expect(() => assertAllowed('/usr/bin/curl', root)).toThrow(/not an allow-listed tool/);
    expect(() => assertAllowed('/bin/ls', root)).toThrow(ExecBlockedError);
    expect(() => assertAllowed('node', root)).not.toThrow();
    expect(() => assertAllowed(path.join(root, 'target/debug/app'), root)).not.toThrow();
    expect(() => assertAllowed('../outside/app', root)).toThrow(ExecBlockedError);
  });
  it('strips secrets from the child environment', () => {
    process.env.FT_TEST_API_KEY = 'x'; process.env.AWS_ACCESS_KEY_ID = 'y'; process.env.ANTHROPIC_API_KEY = 'z'; process.env.MY_PASSWORD = 'p'; process.env.PLAIN_VAR = 'ok'; process.env.FTHISUP_TEST_PASSWORD = 'q';
    const env = cleanEnv();
    for (const k of ['FT_TEST_API_KEY', 'AWS_ACCESS_KEY_ID', 'ANTHROPIC_API_KEY', 'MY_PASSWORD', 'FTHISUP_TEST_PASSWORD']) expect(env[k], k).toBeUndefined();
    expect(env.PLAIN_VAR).toBe('ok');
  });
  it('refuses a disallowed executable or a working directory outside the project, without spawning', async () => {
    const a = await runProcess({ file: 'sh', args: ['-c', 'echo hi'], cwd: root, projectRoot: root, timeoutMs: 2000 });
    expect(a.spawnError).toMatch(/shell/); expect(a.stdout).toBe('');
    const b = await runProcess({ file: 'node', args: ['-v'], cwd: '/', projectRoot: root, timeoutMs: 2000 });
    expect(b.spawnError).toMatch(/outside the project/);
  });
  it('kills runaway processes at the timeout and caps output', async () => {
    const t = await runProcess({ file: 'node', args: ['-e', 'for(;;){}'], cwd: root, projectRoot: root, timeoutMs: 700 });
    expect(t.timedOut).toBe(true); expect(t.durationMs).toBeLessThan(4000);
    const big = await runProcess({ file: 'node', args: ['-e', 'process.stdout.write("x".repeat(5e6))'], cwd: root, projectRoot: root, timeoutMs: 5000, maxOutputBytes: 10_000 });
    expect(big.truncated).toBe(true); expect(big.stdout.length).toBeLessThanOrEqual(10_000);
  });
  it('does not leak the parent secrets to children', async () => {
    process.env.SOME_TOKEN = 'leak-me';
    const r = await runProcess({ file: 'node', args: ['-e', 'console.log(process.env.SOME_TOKEN ?? "absent")'], cwd: root, projectRoot: root, timeoutMs: 5000 });
    expect(r.stdout.trim()).toBe('absent');
  });
  it.skipIf(!sandboxInfo().available)('sandbox: filesystem is read-only except scratch, and there is no network', async () => {
    const scratch = newScratch(root);
    try {
      const script = `const fs=require('fs');const r={};try{fs.writeFileSync('/etc/fthisup-x','1');r.etc='WROTE'}catch(e){r.etc=e.code}try{fs.writeFileSync(process.argv[1]+'/ok.txt','1');r.scratch='ok'}catch(e){r.scratch=e.code}try{fs.writeFileSync(${JSON.stringify(root)}+'/proj.txt','1');r.project='WROTE'}catch(e){r.project=e.code}
      require('net').connect(80,'93.184.216.34').on('error',e=>{r.net=e.code;console.log(JSON.stringify(r))}).setTimeout(1500,function(){r.net='timeout';console.log(JSON.stringify(r));process.exit()})`;
      const res = await runProcess({ file: 'node', args: ['-e', script, scratch], cwd: scratch, projectRoot: root, timeoutMs: 8000, sandbox: 'require', scratch });
      expect(res.sandboxed).toBe(true);
      const r = JSON.parse(res.stdout.trim());
      expect(r.etc).toBe('EROFS'); expect(r.project).toBe('EROFS'); expect(r.scratch).toBe('ok');
      expect(['ENETUNREACH', 'timeout', 'ECONNREFUSED']).toContain(r.net);
    } finally { cleanupScratch(scratch); }
  });
  it('sandbox "require" fails closed when unavailable', async () => {
    if (sandboxInfo().available) return;
    const r = await runProcess({ file: 'node', args: ['-v'], cwd: root, projectRoot: root, timeoutMs: 2000, sandbox: 'require', scratch: root });
    expect(r.spawnError).toMatch(/sandbox required/);
  });
});

describe('approval gate (non-web adapters)', () => {
  const cfg = (approved: string[] = []) => configSchema.parse({ safety: { approvedActions: approved } });
  it('blocks sensitive and high-risk work until the exact action is approved', () => {
    expect(checkApproval(cfg(), { requiresApproval: true, sensitivity: 'deletion' }).allowed).toBe(false);
    expect(checkApproval(cfg(['purchase']), { requiresApproval: true, sensitivity: 'deletion' }).allowed).toBe(false);
    expect(checkApproval(cfg(['deletion']), { requiresApproval: true, sensitivity: 'deletion' }).allowed).toBe(true);
    expect(checkApproval(cfg(), { risk: 'high' }).allowed).toBe(false);
    expect(checkApproval(cfg(['irreversible']), { risk: 'high' }).allowed).toBe(true);
    expect(checkApproval(cfg(), { risk: 'medium' }).allowed).toBe(true);
  });
});

describe('universal configuration', () => {
  it('accepts the documented shape, aliases and per-adapter switches', () => {
    const c = configSchema.parse({ mode: 'safe', autoDetect: true, maxTests: 100, timeoutMs: 12000, adapters: { web: true, api: true, cli: true, python: false, flutter: true, desktop: true, godot: true }, report: { html: true, json: true } });
    expect(c.timeout).toBe(12000); expect(c.report).toBe('html'); expect(c.adapters.python).toBe(false);
    expect(configSchema.parse({ report: { html: false, json: true } }).report).toBe('json');
  });
  it('rejects unknown adapters, unknown keys, shell strings and out-of-range values', () => {
    expect(configSchema.safeParse({ adapters: { cobol: true } }).success).toBe(false);
    expect(configSchema.safeParse({ cli: { commands: [{ name: 'x', command: 'ls -la; rm -rf /' }] } }).success).toBe(false);
    expect(configSchema.safeParse({ api: { concurrency: 500 } }).success).toBe(false);
    expect(configSchema.safeParse({ fuzz: { maxCallsPerFunction: 1e9 } }).success).toBe(false);
    expect(configSchema.safeParse({ nonsense: 1 }).success).toBe(false);
  });
  it('enabling an adapter does not make it available (selection is a separate, checked step)', async () => {
    const root = tmpDir();
    const cfg = configSchema.parse({ adapters: { flutter: true, rust: true } });
    const pr = await planRun({ root, config: cfg });
    expect(pr.selections.find((s) => s.adapter.id === 'flutter')!.status).toBe('not-applicable');
  });
});

describe('adapter selection', () => {
  it('lists every adapter and gives each a safety statement, categories and requirements', () => {
    expect(ADAPTERS.map((a) => a.id)).toEqual(['web', 'api', 'cli', 'python', 'javascript', 'flutter', 'rust', 'go', 'java', 'cpp', 'swift', 'desktop', 'godot']);
    for (const a of ADAPTERS) { expect(a.safety.length, a.id).toBeGreaterThan(0); expect(a.requirements.length, a.id).toBeGreaterThan(0); expect(a.categories.length, a.id).toBeGreaterThan(0); }
  });
  it('rejects unknown adapter names', async () => {
    await expect(planRun({ root: tmpDir(), config: configSchema.parse({}), adapters: ['cobol'] })).rejects.toBeInstanceOf(UnknownAdapterError);
  });
  it('keeps opt-in adapters off unless asked, and honours disabled adapters', async () => {
    const root = tmpDir();
    write(root, 'fthisup.config.json', '{}');
    write(root, 'Cargo.toml', '[package]\nname="x"'); write(root, 'src/main.rs', 'fn main(){}');
    const base = configSchema.parse({ desktop: { run: ['node', 'a.js'], display: 'none' }, adapters: { rust: false } });
    const pr = await planRun({ root, config: base });
    const st = (id: string) => pr.selections.find((s) => s.adapter.id === id)!;
    expect(st('desktop')).toMatchObject({ status: 'skipped' }); expect(st('desktop').reason).toMatch(/opt-in/);
    expect(st('rust')).toMatchObject({ status: 'skipped' }); expect(st('rust').reason).toMatch(/disabled/);
    const all = await planRun({ root, config: base, all: true });
    expect(all.selections.find((s) => s.adapter.id === 'desktop')!.status).toBe('ran');
    const only = await planRun({ root, config: base, adapters: ['desktop'] });
    expect(only.selections.map((s) => s.adapter.id)).toEqual(['desktop']);
  });
  it('plans real adapters for a real fixture (python unittest)', async () => {
    const root = tmpDir(); fs.cpSync(P('py-buggy'), root, { recursive: true });
    const pr = await planRun({ root, config: configSchema.parse({}) });
    const py = pr.selections.find((s) => s.adapter.id === 'python')!;
    expect(py.status).toBe('ran');
    expect(py.plan!.tests.map((t) => t.name).join()).toMatch(/unittest/);
  });
});

describe('typed scenarios for CLI and API (agent-proposed)', () => {
  const okCli = { id: 'c1', name: 'x', target: 'tool', argv: ['--help'], expect: [{ type: 'noCrash' }] };
  it('CLI: valid ones pass; executables, shells, unknown targets and extra fields are rejected', () => {
    expect(validateCliScenarios([okCli], ['tool']).valid).toHaveLength(1);
    for (const bad of [
      { ...okCli, executable: '/bin/sh' }, { ...okCli, command: 'rm -rf /' }, { ...okCli, target: 'other' }, { ...okCli, argv: Array(100).fill('x') },
      { ...okCli, stdin: { kind: 'long', bytes: 1e9 } }, { ...okCli, expect: [{ type: 'runScript', code: '1' }] }, { ...okCli, argv: ['a\0b'] }, { ...okCli, signal: { afterMs: 10, name: 'SIGKILL' } },
    ]) expect(validateCliScenarios([bad], ['tool']).valid, JSON.stringify(bad).slice(0, 60)).toHaveLength(0);
  });
  const okApi = { id: 'a1', name: 'x', method: 'GET', path: '/users', expect: [{ type: 'no5xx' }] };
  it('API: only paths on the authorized host; no host/credential headers; no absolute URLs', () => {
    expect(validateApiScenarios([okApi]).valid).toHaveLength(1);
    for (const bad of [
      { ...okApi, path: 'http://evil.com/x' }, { ...okApi, path: '//evil.com/x' }, { ...okApi, path: 'users' }, { ...okApi, headers: { Host: 'evil.com' } }, { ...okApi, headers: { Authorization: 'Bearer x' } },
      { ...okApi, url: 'http://evil.com' }, { ...okApi, method: 'CONNECT' }, { ...okApi, json: {}, rawBody: '{}' }, { ...okApi, expect: [{ type: 'eval', code: '1' }] },
    ]) expect(validateApiScenarios([bad]).valid, JSON.stringify(bad).slice(0, 60)).toHaveLength(0);
  });
});

describe('CLI adapter heuristics', () => {
  it('detects stack traces and crashes from several runtimes', () => {
    expect(findStackTrace('Traceback (most recent call last):\n  File "x.py"')).toBe('Python traceback');
    expect(findStackTrace('TypeError: x is not a function\n    at Object.<anonymous> (/a/b.js:1:2)\n    at Module._compile (node:internal/modules/cjs/loader:1:1)')).toMatch(/stack/i);
    expect(findStackTrace("thread 'main' panicked at src/main.rs:2:5")).toBe('Rust panic');
    expect(findStackTrace('usage: tool [FILE]\ntool: error: unknown option')).toBeNull();
    const base = { stdout: '', stderr: '', timedOut: false, truncated: false, durationMs: 1, sandboxed: false, command: '' };
    expect(didCrash({ ...base, exitCode: null, signal: 'SIGSEGV' })).toBe(true);
    expect(didCrash({ ...base, exitCode: 139, signal: null })).toBe(true);
    expect(didCrash({ ...base, exitCode: 1, signal: null })).toBe(false);
  });
  it('generates a bounded deterministic scenario set (+ help-derived ones) covering the required cases', () => {
    const ids = baseScenarios().map((s) => s.id);
    for (const id of ['help', 'no-args', 'unknown-flag', 'long-arg', 'unicode-args', 'nonexistent-path', 'stdin-dash-empty', 'long-stdin', 'binary-stdin']) expect(ids).toContain(id);
    const d = helpDerived('usage: t [--config FILE] [--port <PORT>] [--force] [--delete-all <X>]');
    expect(d.map((x) => x.id)).toEqual(expect.arrayContaining(['malformed-config', 'invalid-value--port']));
    expect(d.some((x) => /delete/.test(x.id))).toBe(false); // destructive-looking flags are never fuzzed
  });
});

describe('API discovery, probes and schema validation', () => {
  const spec = loadSpecFile(path.join(P('api-clean'), 'openapi.json'))!;
  it('parses OpenAPI: operations, params, bodies, responses, security', () => {
    const get = (m: string, p: string) => spec.endpoints.find((e) => e.method === m && e.path === p)!;
    expect(spec.endpoints).toHaveLength(7);
    expect(get('GET', '/users/{id}').params[0]).toMatchObject({ name: 'id', in: 'path', required: true });
    expect(get('POST', '/users').body).toMatchObject({ required: true });
    expect(get('GET', '/admin/stats').secured).toBe(true);
    expect(get('GET', '/search').params.find((p) => p.name === 'q')!.required).toBe(true);
    expect(Object.keys(get('GET', '/users/{id}').responses)).toEqual(['200', '400', '404']);
  });
  it('validates values against schemas ($ref aware)', () => {
    const doc = { components: spec.components };
    const user = spec.endpoints.find((e) => e.method === 'GET' && e.path === '/users/{id}')!.responses['200'];
    expect(validateValue(doc, { id: 1, name: 'a' }, user)).toEqual([]);
    expect(validateValue(doc, { id: '1', name: 'a' }, user).join()).toMatch(/id: is string but the schema says integer/);
    expect(validateValue(doc, { name: 'a' }, user).join()).toMatch(/missing required property "id"/);
    expect(exampleFromSchema(doc, spec.components.NewUser)).toEqual({ name: 'fthisup-test', age: 1 });
    expect(wrongTypeValue(doc, spec.components.User!.properties!.id)).toBe('not-a-number');
  });
  it('generates safe, bounded probes and marks dangerous ones', () => {
    const probes = generateProbes(spec, spec.endpoints, { protectedPaths: [], concurrency: 3, allowMutations: true });
    const kinds = new Set(probes.map((p) => p.kind));
    for (const k of ['baseline', 'malformed-json', 'missing-required', 'wrong-type', 'oversized', 'special-chars', 'auth', 'unsupported-method', 'concurrency', 'missing-param']) expect(kinds.has(k), k).toBe(true);
    const del = probes.filter((p) => p.req.method === 'DELETE');
    expect(del.length).toBeGreaterThan(0);
    for (const d of del) { expect(d.mutating).toBe(true); expect(d.sensitivity).toBe('deletion'); expect(d.req.path).toContain('not-a-number'); } // never a real id
    expect(probes.every((p) => (p.req.parallel ?? 1) <= 5)).toBe(true);
    const noMut = generateProbes(spec, spec.endpoints, { protectedPaths: [], concurrency: 3, allowMutations: false });
    expect(noMut.some((p) => p.id.includes('unsupported-method') && p.req.method !== 'GET')).toBe(false);
  });
  it('discovers framework routes from source (inferred only)', () => {
    const root = tmpDir();
    write(root, 'app.py', '@app.get("/items/{item_id}")\ndef a(): pass\n@app.route("/legacy", methods=["POST","GET"])\ndef b(): pass');
    write(root, 'server.js', "app.post('/api/login', h); router.delete('/api/users/:id', h);");
    const eps = discoverRoutesFromSource(root);
    expect(eps.map((e) => `${e.method} ${e.path}`).sort()).toEqual(['DELETE /api/users/{id}', 'GET /items/{item_id}', 'GET /legacy', 'POST /api/login', 'POST /legacy']);
    expect(eps.every((e) => e.certainty === 'inferred')).toBe(true);
  });
  it('parseOpenApi supports Swagger 2 bodies and basePath', () => {
    const s = parseOpenApi({ swagger: '2.0', basePath: '/v1', paths: { '/a': { post: { parameters: [{ in: 'body', required: true, schema: { type: 'object', required: ['x'], properties: { x: { type: 'integer' } } } }], responses: { 200: { schema: { type: 'object' } } } } } } }, 'swagger.json');
    expect(s.basePath).toBe('/v1'); expect(s.endpoints[0]!.body).toMatchObject({ required: true });
  });
});

describe('fuzz observation classification', () => {
  const o = (x: Partial<Obs>): Obs => ({ fn: 'f', key: 'k', desc: 'd', edge: true, size: 0, outcome: 'threw', ...x });
  it('flags crashes and hangs; hangs on tiny input are hard, on huge input soft', () => {
    expect(flagFor('node', o({ outcome: 'crash' }))).toMatchObject({ kind: 'crash', hard: true });
    expect(flagFor('python', o({ outcome: 'hang', size: 0 }))).toMatchObject({ kind: 'hang', hard: true });
    expect(flagFor('python', o({ outcome: 'hang', size: 100000 }))).toMatchObject({ kind: 'hang', hard: false });
  });
  it('flags boundary errors only for well-typed edge values, never for type confusion', () => {
    expect(flagFor('python', o({ name: 'IndexError', edge: true }))).toMatchObject({ kind: 'boundary-error', hard: false });
    expect(flagFor('python', o({ name: 'ZeroDivisionError', edge: true }))).not.toBeNull();
    expect(flagFor('python', o({ name: 'TypeError', edge: true }))).toBeNull();
    expect(flagFor('python', o({ name: 'AttributeError', edge: false, message: "'NoneType' object has no attribute 'x'" }))).toBeNull();
    expect(flagFor('node', o({ name: 'TypeError', edge: false, message: 'Cannot read properties of undefined' }))).toBeNull();
    expect(flagFor('node', o({ name: 'RangeError', edge: true, message: 'Invalid array length' }))).toMatchObject({ kind: 'boundary-error' });
    expect(flagFor('python', o({ name: 'ValueError', edge: true }))).toBeNull();
    expect(flagFor('python', o({ outcome: 'returned' }))).toBeNull();
  });
  it('resource exhaustion is always soft, and only when the PROJECT code recurses (not the engine\'s own toString/JSON)', () => {
    expect(flagFor('python', o({ name: 'RecursionError', edge: false, recursion: true }))).toMatchObject({ kind: 'resource', hard: false });
    expect(flagFor('python', o({ name: 'RecursionError', edge: false, recursion: false }))).toBeNull();
    expect(flagFor('node', o({ name: 'RangeError', message: 'Maximum call stack size exceeded', edge: false, recursion: false }))).toBeNull();
    expect(flagFor('node', o({ name: 'RangeError', message: 'Maximum call stack size exceeded', edge: false, recursion: true }))).toMatchObject({ kind: 'resource' });
  });
});

describe('Godot project validation (real static checks)', () => {
  it('finds missing main scene, autoloads and referenced resources; passes a consistent project', () => {
    const bad = validateGodotProject(P('godot-buggy'));
    expect(bad.issues.map((i) => i.kind).sort()).toEqual(['missing-autoload', 'missing-main-scene', 'missing-resource', 'missing-resource']);
    expect(validateGodotProject(P('godot-clean')).issues).toEqual([]);
  });
});
