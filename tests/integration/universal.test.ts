import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { bareDir, copyFixture, readJson, ROOT, runCli, startServerIn, tmpDir, type Fixture } from '../helpers.js';
import { which } from '../../src/exec/tools.js';
import { sandboxInfo } from '../../src/exec/sandbox.js';
import type { RunResults } from '../../src/core/types.js';

const results = (proj: string): RunResults => readJson(proj, 'fthisup-results', 'results.json');
const finding = (r: RunResults, re: RegExp) => r.findings.find((f) => re.test(f.title));
const exec = (proj: string, args: string[], env: NodeJS.ProcessEnv = {}) => runCli(['test', '--no-static', ...args], { cwd: proj, env });
const confirmed = (r: RunResults) => r.findings.filter((f) => f.status === 'confirmed');
const hasSandbox = sandboxInfo().available;

/** buggy vs clean runner fixtures: the buggy one must produce CONFIRMED findings with the right component/evidence, the clean one none. */
describe.each([
  ['python (unittest)', 'py-buggy', 'py-clean', 'python', ['Existing test fails: test_calc.TestCalc.test_add', 'Existing test fails: test_calc.TestCalc.test_div_zero'], 'python3'],
  ['javascript (node:test)', 'node-buggy', 'node-clean', 'javascript', ['Existing test fails: sum adds'], 'node'],
  ['rust (cargo test)', 'rust-buggy', 'rust-clean', 'rust', ['Existing test fails: tests::adds', 'Existing test fails: tests::first_of_empty'], 'cargo'],
  ['c/c++ (cmake + ctest)', 'cpp-buggy', 'cpp-clean', 'cpp', ['Existing test fails: bug_test'], 'ctest'],
  ['flutter (flutter test + analyze)', 'flutter-buggy', 'flutter-clean', 'flutter', ['Existing test fails: increments', 'Existing test fails: throws'], 'flutter'],
] as const)('existing-test-runner adapter: %s', (_label, buggy, clean, adapter, titles, tool) => {
  const skip = !which(tool);
  let b: RunResults, c: RunResults, bcode: number | null, ccode: number | null;
  beforeAll(async () => {
    if (skip) return;
    const pb = copyFixture(buggy), pc = copyFixture(clean);
    [bcode, ccode] = [(await exec(pb, [])).code, (await exec(pc, [])).code];
    b = results(pb); c = results(pc);
  });

  it.skipIf(skip)('confirms the failing tests with their real error text and re-run evidence', () => {
    expect(bcode).toBe(1);
    for (const t of titles) {
      const f = b.findings.find((x) => x.title === t)!;
      expect(f, t).toBeDefined();
      expect(f).toMatchObject({ status: 'confirmed', confidence: 'high', adapter, category: 'unit-tests', source: 'execution', evidenceKind: 'failed-assertion' });
      expect(f.reproduction).toMatchObject({ attempted: true, reproduced: true });
      expect(f.actual.length).toBeGreaterThan(5);
      expect(f.evidence.commands!.length).toBeGreaterThan(0);
      expect(f.evidence.logs!.join('\n').length).toBeGreaterThan(20);
      expect(f.evidence.notes.join()).toMatch(/regression OR an outdated test/);
      expect(['regression', 'unhandled-exception']).toContain(f.failureType);
      expect(f.component).toMatch(new RegExp(`^${adapter === 'javascript' ? 'node' : adapter}:`));
    }
    expect(b.results.some((r) => r.outcome === 'passed' && r.adapter === adapter)).toBe(true); // passing tests are still reported as passing
  });
  it.skipIf(skip)('does NOT invent failures for the clean project', () => {
    expect(ccode).toBe(0);
    expect(c.findings.filter((f) => f.source === 'execution')).toEqual([]);
    expect(c.summary.confirmed).toBe(0);
    expect(c.summary.passed).toBeGreaterThan(0);
  });
  it.skipIf(skip)('records adapter + component metadata for the report', () => {
    const a = b.adapters!.find((x) => x.id === adapter)!;
    expect(a).toMatchObject({ status: 'ran' }); expect(a.failed).toBeGreaterThan(0);
    expect(a.capabilities.length).toBeGreaterThan(0);
    expect(b.components!.length).toBeGreaterThan(0);
  });
});

describe('unavailable prerequisites are reported, not faked', () => {
  it('a project whose tests need uninstalled dependencies is reported as a dependency problem, not as passing', async () => {
    const proj = tmpDir();
    fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'vitest run' }, devDependencies: { vitest: '1' } }));
    const res = await exec(proj, []);
    const r = results(proj);
    const js = r.adapters!.find((a) => a.id === 'javascript')!;
    expect(js.status).toBe('unavailable');
    expect(js.missing.map((m) => `${m.what} ${m.setup}`).join()).toMatch(/dependencies are not installed.*npm install/);
    expect(r.summary.total).toBe(0);
    expect(res.stdout).toMatch(/unavailable/);
    expect(res.stdout).not.toMatch(/No confirmed issues/);
  });
  it.skipIf(!!which('go'))('Go: tests are NOT run when go is missing; the adapter says so and offers a setup hint', async () => {
    const proj = tmpDir();
    fs.writeFileSync(path.join(proj, 'go.mod'), 'module x'); fs.writeFileSync(path.join(proj, 'a_test.go'), 'package x');
    const res = await exec(proj, ['--adapter', 'go']);
    expect(res.code).toBe(4);
    expect(res.stderr).toMatch(/Adapter "go" could not run: .*go is not installed/);
    const g = results(proj).adapters!.find((a) => a.id === 'go')!;
    expect(g.status).toBe('unavailable'); expect(g.missing[0]!.setup).toMatch(/go\.dev/);
    expect(results(proj).summary.total).toBe(0);
  });
  it('explicitly selecting an adapter that does not apply fails gracefully (exit 4, no stack trace)', async () => {
    const proj = copyFixture('py-clean');
    const res = await exec(proj, ['--adapter', 'flutter']);
    expect(res.code).toBe(4);
    expect(res.stderr).toMatch(/Adapter "flutter" could not run/);
    expect(res.stderr + res.stdout).not.toMatch(/\n\s+at /);
  });
  it('unknown adapter names are rejected up front', async () => {
    const res = await exec(copyFixture('py-clean'), ['--adapter', 'cobol']);
    expect(res.code).toBe(2); expect(res.stderr).toMatch(/Unknown adapter "cobol"/);
  });
  it('unsupported project types are detected and described, never claimed as tested', async () => {
    const proj = bareDir();
    fs.writeFileSync(path.join(proj, 'App.csproj'), '<Project/>'); fs.writeFileSync(path.join(proj, 'Gemfile'), '');
    const scan = await runCli(['scan', '--no-live'], { cwd: proj });
    expect(scan.code).toBe(0);
    expect(scan.stdout).toMatch(/dotnet:\./); expect(scan.stdout).toMatch(/not supported by any FThisUp adapter/);
    const res = await exec(proj, []);
    expect(res.code).toBe(3);
    expect(res.stdout).toMatch(/No scenario could be executed/);
  });
});

describe('CLI adapter', () => {
  let bn: RunResults, cn: RunResults, bp: RunResults, cp: RunResults;
  beforeAll(async () => {
    const dirs = ['cli-node-buggy', 'cli-node-clean', 'cli-py-buggy', 'cli-py-clean'].map((n) => copyFixture(n));
    for (const d of dirs) await exec(d, ['--adapter', 'cli']);
    const rs = dirs.map(results);
    bn = rs[0]!; cn = rs[1]!; bp = rs[2]!; cp = rs[3]!;
  });
  it('confirms crashes/stack traces for invalid input in the buggy Node CLI, with the exact command', () => {
    for (const re of [/Unknown flag/, /Nonexistent file path/, /no arguments and empty stdin/]) {
      const f = finding(bn, re)!;
      expect(f, String(re)).toBeDefined();
      expect(f).toMatchObject({ status: 'confirmed', adapter: 'cli', category: 'cli', failureType: 'unhandled-exception', evidenceKind: 'observed-defect', confidence: 'high' });
      expect(f.actual).toMatch(/stack trace|unhandled exception/i);
      expect(f.reproductionSteps.join()).toMatch(/Run: .*linecount/);
      expect(f.evidence.logs!.join('\n')).toMatch(/stderr:[\s\S]*(Error|at )/);
      expect(f.reproduction.reproduced).toBe(true);
    }
  });
  it('reports a hang as SUSPECTED (a daemon-like program is indistinguishable from a hang), and an ignored SIGINT as suspected', () => {
    const hang = finding(bn, /Extremely long argument/)!;
    expect(hang).toMatchObject({ status: 'suspected', failureType: 'hang' });
    const sig = finding(bn, /Interrupt \(SIGINT\)/)!;
    expect(sig).toMatchObject({ status: 'suspected' });
  });
  it('catches the Python CLI traceback on a malformed config file (derived from --help)', () => {
    const f = finding(bp, /Malformed configuration file/)!;
    expect(f).toMatchObject({ status: 'confirmed', failureType: 'unhandled-exception' });
    expect(f.evidence.logs!.join('\n')).toMatch(/Traceback/);
  });
  it('does not invent failures for correct CLIs', () => {
    for (const r of [cn, cp]) { expect(r.summary.failed).toBe(0); expect(r.findings.filter((f) => f.source === 'execution')).toEqual([]); expect(r.summary.passed).toBeGreaterThanOrEqual(13); }
  });
  it.skipIf(!hasSandbox)('runs in the OS sandbox', () => {
    expect(finding(bn, /Unknown flag/)!.evidence.logs!.join()).toMatch(/\[sandboxed\]/);
    expect(bn.sandbox!.kind).toBe('bwrap');
  });
});

describe('CLI adapter safety', () => {
  it('refuses shells and executables outside the project, even when written in the config', async () => {
    const proj = tmpDir();
    fs.writeFileSync(path.join(proj, 'fthisup.config.json'), JSON.stringify({ cli: { commands: [{ name: 'sh', command: ['sh', '-c', 'echo pwned > /tmp/pwned'] }, { name: 'ls', command: ['/bin/ls'] }] } }));
    await exec(proj, ['--adapter', 'cli']);
    const r = results(proj);
    expect(fs.existsSync('/tmp/pwned')).toBe(false);
    const msgs = r.results.map((x) => x.reason ?? '').join('\n') + r.adapters!.map((a) => a.notes.join()).join();
    expect(msgs).toMatch(/shell/); expect(msgs).toMatch(/not an allow-listed tool|not inside the project/);
    expect(r.summary.confirmed).toBe(0);
  });
  it('agent-proposed CLI scenarios cannot choose an executable and are validated before running', async () => {
    const proj = copyFixture('cli-node-clean');
    fs.writeFileSync(path.join(proj, 'agent.json'), JSON.stringify({ cliScenarios: [
      { id: 'agent-ok', name: 'weird flag', target: 'linecount', argv: ['--x'], expect: [{ type: 'noCrash' }, { type: 'noStackTrace' }] },
      { id: 'agent-evil', name: 'evil', target: 'linecount', executable: '/bin/sh', argv: ['-c', 'id'], expect: [{ type: 'noCrash' }] },
      { id: 'agent-other', name: 'other target', target: '/bin/sh', argv: [], expect: [{ type: 'noCrash' }] },
    ] }));
    const res = await exec(proj, ['--adapter', 'cli', '--scenarios', 'agent.json']);
    expect(res.stdout).toMatch(/\[PASS\] Command line/);
    const r = results(proj);
    expect(r.results.find((x) => x.scenarioId === 'cli:linecount:agent-ok')).toMatchObject({ origin: 'agent', outcome: 'passed' });
    expect(r.results.some((x) => /agent-evil|agent-other/.test(x.scenarioId))).toBe(false);
    expect(r.adapters!.find((a) => a.id === 'cli')!.notes.join()).toMatch(/2 supplied CLI scenario\(s\) were rejected/);
  });
});

describe('API adapter', () => {
  let bs: Fixture, cs: Fixture, bp: string, cp: string, b: RunResults, c: RunResults;
  beforeAll(async () => {
    bp = copyFixture('api-buggy'); cp = copyFixture('api-clean');
    bs = await startServerIn(bp); cs = await startServerIn(cp);
    await exec(bp, ['--adapter', 'api', '--url', bs.url]); await exec(cp, ['--adapter', 'api', '--url', cs.url]);
    b = results(bp); c = results(cp);
  });
  afterAll(() => { bs?.stop(); cs?.stop(); });

  it.each([
    [/GET \/health: valid request/, 'incorrect-output', /does not match its documented schema.*status/],
    [/POST \/users: malformed JSON body/, 'input-validation', /HTTP 500/],
    [/GET \/admin\/stats: rejects anonymous access/, 'auth-error', /WITHOUT valid credentials/],
    [/GET \/admin\/stats: rejects an invalid token/, 'auth-error', /HTTP 200/],
    [/GET \/search: hostile characters/, 'input-validation', /HTTP 500/],
    [/GET \/users\/\{id\}: non-numeric/, 'input-validation', /HTTP 500/],
    [/POST \/users: body without required field/, 'input-validation', /accepted invalid input with HTTP 201/],
    [/PATCH \/users: method not declared/, 'input-validation', /HTTP 500/],
  ])('confirms %s', (re, failureType, actual) => {
    const f = finding(b, re)!;
    expect(f, String(re)).toBeDefined();
    expect(f).toMatchObject({ status: 'confirmed', adapter: 'api', category: 'api', failureType, confidence: 'high', evidenceKind: 'observed-defect' });
    expect(f.actual).toMatch(actual);
    expect(f.evidence.commands![0]).toMatch(/^curl -i -X /);
    expect(f.reproduction).toMatchObject({ attempted: true, reproduced: true });
    expect(f.component).toBe('node:.');
  });
  it('treats an unauthenticated admin endpoint as critical', () => {
    expect(finding(b, /rejects anonymous access/)!.severity).toBe('critical');
  });
  it('never calls DELETE without approval', async () => {
    expect((await bs.stats()).deleteCalls).toBe(0);
    expect(b.results.find((r) => /DELETE/.test(r.name))).toMatchObject({ outcome: 'blocked' });
    expect(b.results.find((r) => /DELETE/.test(r.name))!.reason).toMatch(/needs approval/);
  });
  it('is quiet on a correct API (no confirmed, no suspected)', async () => {
    expect(c.findings.filter((f) => f.source === 'execution')).toEqual([]);
    expect(c.summary.passed).toBeGreaterThanOrEqual(20); expect(c.summary.failed).toBe(0);
    expect((await cs.stats()).posts).toBe(0); // invalid input never created anything
  });
  it('approving "deletion" lets the (still invalid-id) DELETE probe run', async () => {
    const proj = copyFixture('api-buggy', { 'fthisup.config.json': JSON.stringify({ safety: { approvedActions: ['deletion'] } }) });
    const s = await startServerIn(proj);
    try {
      await exec(proj, ['--adapter', 'api', '--url', s.url]);
      expect((await s.stats()).deleteCalls).toBeGreaterThan(0);
      expect(results(proj).results.find((r) => /DELETE/.test(r.name))!.outcome).not.toBe('blocked');
    } finally { s.stop(); }
  });
  it('respects the global request caps (max-tests)', async () => {
    const proj = copyFixture('api-clean'); const s = await startServerIn(proj);
    try { await exec(proj, ['--adapter', 'api', '--url', s.url, '--max-tests', '5']); expect(results(proj).results.length).toBeLessThanOrEqual(5); } finally { s.stop(); }
  });
  it('refuses non-local API targets unless authorized, and never sends the request', async () => {
    const proj = copyFixture('api-clean');
    const res = await exec(proj, ['--adapter', 'api', '--api-url', 'https://api.example.com']);
    expect(res.code).toBe(4);
    expect(res.stderr + res.stdout).toMatch(/blocked by the safety policy/);
    expect(res.stderr + res.stdout).toMatch(/nothing was contacted/);
    expect(results(proj).summary.total).toBe(0);
  });
  it('API targets that belong to another project are refused (project scope)', async () => {
    const other = copyFixture('api-clean'); const mine = copyFixture('api-clean');
    const s = await startServerIn(other);
    try { const r = await exec(mine, ['--adapter', 'api', '--url', s.url]); expect([2, 4]).toContain(r.code); expect(r.stderr).toMatch(/does not look like this project's app|Blocked/); } finally { s.stop(); }
  });
  it('agent API scenarios: valid ones run through the same guard, off-host/credential ones are rejected', async () => {
    const proj = copyFixture('api-clean'); const s = await startServerIn(proj);
    try {
      fs.writeFileSync(path.join(proj, 'agent.json'), JSON.stringify({ apiScenarios: [
        { id: 'ok', name: 'search with empty q', method: 'GET', path: '/search', query: { q: '' }, expect: [{ type: 'no5xx' }, { type: 'statusIn', codes: [400] }] },
        { id: 'evil', name: 'other host', method: 'GET', path: 'http://evil.example/x', expect: [{ type: 'no5xx' }] },
        { id: 'cred', name: 'forge auth', method: 'GET', path: '/admin/stats', headers: { Authorization: 'Bearer test-token' }, expect: [{ type: 'no5xx' }] },
      ] }));
      const res = await exec(proj, ['--adapter', 'api', '--url', s.url, '--scenarios', 'agent.json']);
      const r = results(proj);
      expect(r.results.find((x) => x.scenarioId === 'api:agent:ok')).toMatchObject({ origin: 'agent', outcome: 'passed' });
      expect(r.results.some((x) => /agent:(evil|cred)/.test(x.scenarioId))).toBe(false);
      expect(r.adapters!.find((a) => a.id === 'api')!.notes.join()).toMatch(/2 supplied API scenario\(s\) were rejected/);
      expect(res.code).toBe(0);
    } finally { s.stop(); }
  });
});

describe.skipIf(!hasSandbox)('adversarial function fuzzing (sandboxed)', () => {
  const r: Record<string, RunResults> = {};
  beforeAll(async () => {
    for (const n of ['fuzz-py-buggy', 'fuzz-py-clean', 'fuzz-node-buggy', 'fuzz-node-clean']) { const p = copyFixture(n); await exec(p, []); r[n] = results(p); }
  });
  it.each([
    ['fuzz-py-buggy', /Hang on adversarial input: textutil\.py:collatz_steps/, 'hang'],
    ['fuzz-py-buggy', /Crash on adversarial input: textutil\.py:normalize/, 'crash'],
    ['fuzz-node-buggy', /Hang on adversarial input: spin/, 'hang'],
    ['fuzz-node-buggy', /Crash on adversarial input: normalize/, 'crash'],
  ])('%s: confirms %s', (name, re, failureType) => {
    const f = finding(r[name]!, re)!;
    expect(f, String(re)).toBeDefined();
    expect(f).toMatchObject({ status: 'confirmed', category: 'fuzzing', failureType, confidence: 'high' });
    expect(f.reproduction.reproduced).toBe(true);
    expect(f.reproductionSteps.join()).toMatch(/sandbox/);
  });
  it('reports heuristic observations only as SUSPECTED (boundary errors, recursion)', () => {
    for (const [name, re] of [['fuzz-py-buggy', /first_word/], ['fuzz-py-buggy', /depth/], ['fuzz-node-buggy', /makeArray/]] as const) {
      expect(finding(r[name]!, re), `${name} ${re}`).toMatchObject({ status: 'suspected', severity: 'low' });
    }
  });
  it('is quiet on correct libraries', () => {
    for (const n of ['fuzz-py-clean', 'fuzz-node-clean']) { expect(r[n]!.findings.filter((f) => f.source === 'execution')).toEqual([]); expect(r[n]!.summary.passed).toBe(5); }
  });
  it('Python findings include a (non-executed) property-test suggestion', () => {
    expect(finding(r['fuzz-py-buggy']!, /first_word/)!.suggestedFix).toMatch(/Hypothesis/);
  });
});

describe('fuzzing safety gates', () => {
  it.skipIf(!hasSandbox)('"safety.sandbox: off" disables function fuzzing (fail closed) with an explanation', async () => {
    const proj = copyFixture('fuzz-node-buggy', { 'fthisup.config.json': JSON.stringify({ safety: { sandbox: 'off' } }) });
    const res = await exec(proj, []);
    const r = results(proj);
    expect(r.findings.filter((f) => f.category === 'fuzzing')).toEqual([]);
    const js = r.adapters!.find((a) => a.id === 'javascript')!;
    expect(js.missing.map((m) => m.what).join()).toMatch(/requires an OS sandbox/);
    expect(res.code).not.toBe(1);
  });
  it('fuzz.enabled: false turns it off', async () => {
    const proj = copyFixture('fuzz-node-buggy', { 'fthisup.config.json': JSON.stringify({ fuzz: { enabled: false } }) });
    await exec(proj, []);
    expect(results(proj).findings).toEqual([]);
  });
});

describe('desktop adapter (opt-in: build, startup, crash and log checks)', () => {
  it('is NOT run by default; --adapter desktop / --all enable it', async () => {
    const proj = copyFixture('desktop-crash');
    const res = await exec(proj, []);
    expect(res.stdout).toMatch(/opt-in adapter/);
    expect(results(proj).summary.total).toBe(0);
  });
  it('confirms an app that crashes during startup, with log evidence', async () => {
    const proj = copyFixture('desktop-crash');
    const res = await exec(proj, ['--adapter', 'desktop']);
    const r = results(proj);
    expect(res.code).toBe(1);
    expect(r.results.find((x) => x.category === 'build')!.outcome).toBe('passed');
    const f = finding(r, /App crashes during startup/)!;
    expect(f).toMatchObject({ status: 'confirmed', category: 'startup', adapter: 'desktop', failureType: expect.stringMatching(/crash|unhandled-exception/) });
    expect(f.evidence.logs!.join('\n')).toMatch(/TypeError/);
  });
  it('confirms a failing build and skips startup instead of launching a stale binary', async () => {
    const proj = copyFixture('desktop-buildfail');
    await exec(proj, ['--adapter', 'desktop']);
    const r = results(proj);
    expect(finding(r, /Build fails/)).toMatchObject({ status: 'confirmed', failureType: 'build-failure', severity: 'high' });
    expect(r.results.find((x) => x.category === 'startup')).toMatchObject({ outcome: 'skipped', reason: expect.stringMatching(/build step did not succeed/) });
  });
  it('passes a well-behaved app (stays up, exits cleanly on SIGTERM)', async () => {
    const proj = copyFixture('desktop-clean');
    const res = await exec(proj, ['--all']);
    expect(res.code).toBe(0);
    const r = results(proj);
    expect(r.summary.failed).toBe(0); expect(r.summary.passed).toBe(2);
  });
  it('says so when no display is available for a GUI app (no fake pass)', async () => {
    const proj = copyFixture('desktop-clean', { 'fthisup.config.json': JSON.stringify({ desktop: { run: ['node', 'app.js'], display: 'xvfb' } }) });
    if (which('xvfb-run') || process.platform !== 'linux') return;
    const res = await exec(proj, ['--adapter', 'desktop']);
    expect(res.code).toBe(4);
    expect(results(proj).adapters!.find((a) => a.id === 'desktop')!.missing.map((m) => m.what).join()).toMatch(/xvfb/);
  });
});

describe('godot adapter', () => {
  it('confirms missing main scene / autoloads / resources; passes a consistent project; engine checks are skipped with a reason when Godot is absent', async () => {
    const bug = copyFixture('godot-buggy'), ok = copyFixture('godot-clean');
    const rb = await exec(bug, []); await exec(ok, []);
    const b = results(bug), c = results(ok);
    expect(rb.code).toBe(1);
    const f = finding(b, /references 4 missing file/)!;
    expect(f).toMatchObject({ status: 'confirmed', category: 'project-validation', adapter: 'godot', component: 'godot:.' });
    expect(f.actual).toMatch(/main\.tscn/);
    expect(c.findings).toEqual([]);
    if (!which('godot') && !which('godot4')) {
      expect(c.results.find((x) => x.category === 'startup')).toMatchObject({ outcome: 'skipped', reason: expect.stringMatching(/no Godot binary/) });
    }
  });
});

describe('multi-adapter monorepo (one run, one report)', () => {
  let proj: string, srv: Fixture, run: { code: number | null; stdout: string; stderr: string }, r: RunResults;
  beforeAll(async () => {
    proj = bareDir();
    fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'mono', private: true }));
    const put = (name: string, to: string) => fs.cpSync(path.join(ROOT, 'tests', 'fixtures', 'projects', name), path.join(proj, to), { recursive: true });
    put('api-buggy', 'services/api'); put('cli-node-buggy', 'tools/cli'); put('py-buggy', 'libs/pylib'); put('rust-clean', 'libs/rustlib');
    if (which('flutter')) put('flutter-clean', 'mobile/app');
    srv = await startServerIn(path.join(proj, 'services/api'));
    run = await runCli(['test', '--no-static', '--url', srv.url], { cwd: proj });
    r = results(proj);
  });
  afterAll(() => srv?.stop());

  it('detects every component independently', () => {
    const ids = r.components!.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['node:services/api', 'node:tools/cli', 'python:libs/pylib', 'rust:libs/rustlib']));
    expect(run.stdout).toMatch(/Project detected:/);
  });
  it('selects the applicable adapters automatically and skips web (the root serves JSON, not HTML)', () => {
    const status = Object.fromEntries(r.adapters!.map((a) => [a.id, a.status]));
    expect(status).toMatchObject({ api: 'ran', cli: 'ran', python: 'ran', rust: 'ran' });
    expect(status.web).toBe('not-applicable');
    if (which('flutter')) expect(status.flutter).toBe('ran');
  });
  it('attributes every finding to the component it affects', () => {
    expect(finding(r, /POST \/users: malformed JSON/)!.component).toBe('node:services/api');
    expect(finding(r, /Unknown flag/)!.component).toBe('node:tools/cli');
    expect(finding(r, /Existing test fails: test_calc\.TestCalc\.test_add/)!.component).toBe('python:libs/pylib');
    expect(r.findings.filter((f) => f.component === 'rust:libs/rustlib')).toEqual([]);
    expect(r.findings.every((f) => f.component)).toBe(true);
  });
  it('aggregates into one coherent summary and one report', async () => {
    expect(r.summary.total).toBe(r.summary.passed + r.summary.failed);
    expect(r.summary.confirmed).toBe(confirmed(r).length);
    expect(new Set(r.findings.map((f) => f.id)).size).toBe(r.findings.length); // ids unique across adapters
    expect(run.code).toBe(1);
    const html = fs.readFileSync(path.join(proj, 'fthisup-results', 'report.html'), 'utf8');
    expect(html).toContain('Detected project'); expect(html).toContain('Your code works? Prove it.');
    const { chromium } = await import('playwright');
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage(); const errs: string[] = [];
      page.on('pageerror', (e) => errs.push(e.message));
      await page.goto('file://' + path.join(proj, 'fthisup-results', 'report.html'));
      await page.waitForSelector('details.issue');
      expect(await page.locator('.comp').count()).toBeGreaterThanOrEqual(4);
      expect(await page.locator('#adapters tbody tr').count()).toBeGreaterThanOrEqual(4);
      await page.selectOption('#fcomp', 'python:libs/pylib');
      const shown = await page.locator('details.issue:visible').count();
      expect(shown).toBe(r.findings.filter((f) => f.component === 'python:libs/pylib').length);
      expect(shown).toBeGreaterThan(0);
      await page.selectOption('#fcomp', ''); await page.selectOption('#fadapter', 'api');
      expect(await page.locator('details.issue:visible').count()).toBe(r.findings.filter((f) => f.adapter === 'api').length);
      expect(errs).toEqual([]);
    } finally { await browser.close(); }
  });
  it('writes the machine-readable project manifest too', () => {
    const m = readJson(proj, 'fthisup-results', 'project.json');
    expect(m.components.length).toBeGreaterThanOrEqual(4);
    expect(m.components.every((c: any) => ['high', 'medium', 'low'].includes(c.confidence))).toBe(true);
  });
  it('does not claim complete coverage', () => {
    expect(r.coverage.notes.join()).toMatch(/do not prove/);
  });
});

describe('--dry-run is side-effect free and lists adapter scenarios', () => {
  it('lists planned tests for several adapters without executing any (no crash/finding, no process side effects)', async () => {
    const proj = bareDir();
    fs.writeFileSync(path.join(proj, 'package.json'), '{"name":"m"}');
    fs.cpSync(path.join(ROOT, 'tests', 'fixtures', 'projects', 'py-buggy'), path.join(proj, 'py'), { recursive: true });
    fs.cpSync(path.join(ROOT, 'tests', 'fixtures', 'projects', 'rust-buggy'), path.join(proj, 'rs'), { recursive: true });
    const res = await exec(proj, ['--dry-run']);
    expect(res.code).toBe(0);
    expect(res.stdout).toMatch(/Dry run: \d+ scenario/);
    expect(res.stdout).toMatch(/unit-tests\s+python:py:unittest/);
    expect(res.stdout).toMatch(/rust\/unit-tests/);
    expect(fs.existsSync(path.join(proj, 'fthisup-results', 'results.json'))).toBe(false);
    expect(fs.existsSync(path.join(proj, 'rs', 'target'))).toBe(false); // nothing was built
  });
});
