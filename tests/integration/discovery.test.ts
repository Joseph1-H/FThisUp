import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, copyFixture, readJson, runCli } from '../helpers.js';
import { treeHash } from '../../src/autonomous/flutter/execute.js';
import { which } from '../../src/exec/tools.js';

const FLUTTER = !!which('flutter');
const d = describe.skipIf(!FLUTTER);

/** Ground truth of the planted defects. NONE of them is covered by the fixture's own (passing) tests. */
const PLANTED = [
  { id: 'duplicate submit (Save stays enabled)', found: (f: any) => f.discovery?.scenarioId === 'double-save' },
  { id: 'negative weight accepted', found: (f: any) => f.discovery?.scenarioId === 'negative-weight' },
  { id: 'empty exercise name accepted', found: (f: any) => f.discovery?.scenarioId === 'empty-name' },
  { id: 'layout overflow with long names', found: (f: any) => /overflow/i.test(f.actual) },
  { id: 'setState after dispose (leave mid-save)', found: (f: any) => /setState\(\) called after dispose/.test(f.actual) },
];

const R = (read: string, quote: string) => ({ file: read, quote });
const field = (k: string, text: unknown) => ({ do: 'enterText', target: { by: 'key', value: k }, text });
const tapSave = { do: 'tap', target: { by: 'key', value: 'save_button' } };
const fillValid = [field('exercise_name', 'Squat'), field('weight', '100'), field('reps', '5')];
const agentFile = {
  version: 1, adapter: 'flutter',
  scenarios: [
    { id: 'double-save', name: 'Tap Save twice quickly', feature: 'Workout logging', risk: 'duplicate submission creates two records', priority: 'high',
      expectation: { statement: 'Save is disabled while a save is in progress', basis: 'documented', reference: R('README.md', 'While a save is in progress the Save button is disabled') },
      screen: { widget: 'WorkoutScreen' }, steps: [...fillValid, tapSave, { do: 'pump', ms: 50 }, { do: 'expect', assert: { kind: 'buttonEnabled', target: { by: 'key', value: 'save_button' }, enabled: false } }, tapSave, { do: 'pump', ms: 600 }],
      assertions: [{ kind: 'absent', target: { by: 'key', value: 'entry_1' } }] },
    { id: 'negative-weight', name: 'Negative weight', feature: 'Workout logging', risk: 'invalid weight is stored',
      expectation: { statement: 'Negative weights are rejected', basis: 'documented', reference: R('README.md', 'Zero or negative weights are rejected') },
      screen: { widget: 'WorkoutScreen' }, steps: [field('exercise_name', 'Squat'), field('weight', { preset: 'negative' }), field('reps', '5'), tapSave, { do: 'pump', ms: 600 }], assertions: [{ kind: 'absent', target: { by: 'key', value: 'entry_0' } }] },
    { id: 'empty-name', name: 'Empty exercise name', feature: 'Workout logging', risk: 'nameless workout',
      expectation: { statement: 'An empty name is rejected', basis: 'documented', reference: R('README.md', 'An empty name must be rejected') },
      screen: { widget: 'WorkoutScreen' }, steps: [field('weight', '50'), field('reps', '5'), tapSave, { do: 'pump', ms: 600 }], assertions: [{ kind: 'absent', target: { by: 'key', value: 'entry_0' } }] },
    // ---- controls: scenarios that must NOT become confirmed bugs ----------------------------------------
    { id: 'assumed-text', name: 'Assumption only', feature: 'Workout logging', risk: 'unsupported expectation', expectation: { statement: 'Error text says kilograms', basis: 'assumption' },
      screen: { widget: 'WorkoutScreen' }, steps: [tapSave, { do: 'pump', ms: 100 }], assertions: [{ kind: 'visible', target: { by: 'text', value: 'kilograms required' } }] },
    { id: 'fake-quote', name: 'Hallucinated requirement', feature: 'Workout logging', risk: 'made-up requirement', expectation: { statement: 'Weight is capped', basis: 'documented', reference: R('README.md', 'Weight must never exceed 500 kilograms') },
      screen: { widget: 'WorkoutScreen' }, steps: [field('exercise_name', 'x'), field('weight', '900'), field('reps', '5'), tapSave, { do: 'pump', ms: 600 }], assertions: [{ kind: 'absent', target: { by: 'key', value: 'entry_0' } }] },
    { id: 'wrong-target', name: 'Taps a missing button', feature: 'Workout logging', risk: 'the test itself is wrong', expectation: { statement: 'not applicable here', basis: 'assumption' },
      screen: { widget: 'WorkoutScreen' }, steps: [{ do: 'tap', target: { by: 'text', value: 'Nonexistent' } }] },
    { id: 'ghost-key', name: 'Unknown key', feature: 'Workout logging', risk: 'hallucinated widget', expectation: { statement: 'not applicable here', basis: 'assumption' },
      screen: { widget: 'WorkoutScreen' }, steps: [{ do: 'tap', target: { by: 'key', value: 'no_such_key' } }] },
  ],
};

interface Run { code: number | null; results: any; project: string; ms: number; stdout: string }
async function run(fixture: string, args: string[], scenarios?: unknown): Promise<Run> {
  const proj = copyFixture(fixture);
  if (scenarios) { fs.mkdirSync(path.join(proj, 'fthisup-scenarios')); fs.writeFileSync(path.join(proj, 'fthisup-scenarios', 'flutter.json'), JSON.stringify(scenarios)); }
  const t0 = Date.now();
  const r = await runCli(args, { cwd: proj, timeoutMs: 280_000 });
  const f = path.join(proj, 'fthisup-results', 'results.json');
  return { code: r.code, results: fs.existsSync(f) ? readJson(f) : undefined, project: proj, ms: Date.now() - t0, stdout: r.stdout };
}

d('autonomous discovery: Flutter benchmark (defects the existing tests do not cover)', () => {
  let buggy: Run, clean: Run;
  const wsBefore = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('fthisup-ws-')).length;
  let ws0 = 0;
  let hashBefore = '';
  beforeAll(async () => {
    ws0 = wsBefore();
    buggy = await run('flutter-app-buggy', ['test', '--discovery'], agentFile);
    clean = await run('flutter-app-clean', ['test', '--discovery'], agentFile);
    hashBefore = treeHash(path.join(ROOT, 'tests', 'fixtures', 'projects', 'flutter-app-buggy'), (rel) => /^(lib|test)\//.test(rel) || rel === 'pubspec.yaml');
  }, 600_000);

  it('baseline: the existing tests of BOTH fixtures pass (they cover none of the planted bugs)', () => {
    for (const r of [buggy, clean]) {
      const existing = r.results.results.filter((x: any) => x.kind === 'existing');
      expect(existing.length).toBeGreaterThan(0);
      expect(existing.every((x: any) => x.outcome === 'passed')).toBe(true);
      expect(r.results.discovery.existingTests[0].passed).toBe(3);
    }
  });

  it('independently discovers every planted bug in the buggy app, with evidence and reproduction', () => {
    const confirmed = buggy.results.findings.filter((f: any) => f.discovery && f.status === 'confirmed');
    const missed = PLANTED.filter((p) => !confirmed.some(p.found));
    expect(missed.map((m) => m.id)).toEqual([]);
    for (const f of confirmed) {
      expect(f.reproduction.reproduced).toBe(true);
      expect(f.reproduction.attempts).toBeGreaterThanOrEqual(2);
      expect(f.evidence.logs.length).toBeGreaterThan(0);
      expect(f.category).toBe('autonomous-discovery');
      expect(f.discovery.basis).not.toBe('assumption');
    }
    expect(buggy.code).toBe(1);
    expect(buggy.stdout).toMatch(/confirmed issues? discovered/);
  });

  it('finds some bugs with NO agent input at all (engine-seeded invariants)', async () => {
    const seeded = buggy.results.findings.filter((f: any) => f.discovery?.method === 'engine-heuristic' && f.status === 'confirmed');
    expect(seeded.some((f: any) => /overflow/i.test(f.actual))).toBe(true);
    expect(seeded.some((f: any) => /setState\(\) called after dispose/.test(f.actual))).toBe(true);
  });

  it('never confirms a bug from an assumption, a hallucinated quote, a wrong test or an unknown key', () => {
    const rec = (r: Run, id: string) => r.results.discovery.records.find((x: any) => x.id === id);
    for (const r of [buggy, clean]) {
      expect(rec(r, 'assumed-text').status).toBe('suspected');
      expect(rec(r, 'fake-quote').status).toBe('suspected');
      expect(rec(r, 'fake-quote').expectation.effectiveBasis).toBe('assumption');
      expect(rec(r, 'fake-quote').expectation.referenceVerified).toBe(false);
      expect(rec(r, 'wrong-target').status).toBe('invalid');
      expect(rec(r, 'ghost-key').status).toBe('rejected');
      expect(rec(r, 'ghost-key').executed).toBe(false);
    }
  });

  it('zero false positives on the clean app: nothing confirmed, every real scenario passes', () => {
    expect(clean.results.findings.filter((f: any) => f.status === 'confirmed')).toEqual([]);
    expect(clean.code).toBe(0);
    const real = clean.results.discovery.records.filter((x: any) => !['assumed-text', 'fake-quote', 'wrong-target', 'ghost-key'].includes(x.id));
    expect(real.length).toBeGreaterThan(6);
    expect(real.every((x: any) => x.status === 'passed')).toBe(true);
  });

  it('counts are honest: skipped/rejected are never "executed"', () => {
    for (const r of [buggy, clean]) {
      const k = r.results.discovery.counts;
      const recs = r.results.discovery.records;
      expect(k.executed).toBe(recs.filter((x: any) => x.executed).length);
      expect(k.executed).toBe(k.passed + k.confirmed + k.suspected + k.notReproducible + k.invalid + k.environment);
      expect(k.generated).toBe(recs.length);
      const gen = r.results.results.filter((x: any) => x.kind === 'generated');
      expect(gen.filter((x: any) => x.outcome !== 'skipped').length).toBe(k.passed + k.confirmed + k.suspected + k.notReproducible);
      expect(r.results.summary.total).toBe(r.results.results.filter((x: any) => x.outcome === 'passed' || x.outcome === 'failed').length);
    }
  });

  it('reports generated vs existing separately, with the required per-test fields', () => {
    const rec = buggy.results.discovery.records.find((x: any) => x.id === 'double-save');
    for (const k of ['name', 'feature', 'risk', 'expectation', 'method', 'status', 'reproduction', 'confidence', 'evidence']) expect(rec, k).toHaveProperty(k);
    expect(rec.expectation).toMatchObject({ basis: 'documented', referenceVerified: true });
    const html = fs.readFileSync(path.join(buggy.project, 'fthisup-results', 'report.html'), 'utf8');
    expect(html).toContain('Autonomous discovery');
    expect(html).toContain('NEW');
    expect(fs.existsSync(path.join(buggy.project, 'fthisup-results', 'app-map.json'))).toBe(true);
    expect(fs.existsSync(path.join(buggy.project, 'fthisup-results', 'generated-tests', 'double-save_test.dart'))).toBe(true);
  });

  it('is isolated: the project is untouched, the temp workspace is deleted, the network was blocked', () => {
    for (const r of [buggy, clean]) {
      const iso = r.results.discovery.isolation;
      expect(iso.sourceModified).toBe(false);
      expect(iso.cleanedUp).toBe(true);
      expect(iso.networkBlocked).toBe(true);
      expect(fs.existsSync(path.join(r.project, 'test', 'fthisup_generated'))).toBe(false);
      expect(fs.existsSync(path.join(r.project, 'lib', 'fthisup_generated'))).toBe(false);
    }
    expect(wsBefore()).toBe(ws0);
    const after = treeHash(path.join(ROOT, 'tests', 'fixtures', 'projects', 'flutter-app-buggy'), (rel) => /^(lib|test)\//.test(rel) || rel === 'pubspec.yaml');
    expect(after).toBe(hashBefore);
  });

  it('prints the benchmark (measured, not asserted against a target)', () => {
    const m = (r: Run) => { const k = r.results.discovery.counts; const f = r.results.findings.filter((x: any) => x.discovery); const reproOk = f.filter((x: any) => x.status === 'confirmed' && x.reproduction.reproduced).length; return { generated: k.generated, valid: k.validated, rejected: k.rejected, executed: k.executed, confirmed: k.confirmed, suspected: k.suspected, invalidTests: k.invalid, environment: k.environment, reproducedConfirmed: `${reproOk}/${k.confirmed}`, seconds: Math.round(r.ms / 1000) }; };
    const planted = PLANTED.filter((p) => buggy.results.findings.some((f: any) => f.discovery && f.status === 'confirmed' && p.found(f))).length;
    console.log(`\nFThisUp discovery benchmark (flutter-app fixtures)\n  planted bugs independently found: ${planted}/${PLANTED.length}\n  buggy: ${JSON.stringify(m(buggy))}\n  clean: ${JSON.stringify(m(clean))}  (false positives = confirmed on clean = ${clean.results.findings.filter((f: any) => f.status === 'confirmed').length})`);
    expect(planted).toBe(PLANTED.length);
  });
});

d('autonomous discovery: modes and compatibility', () => {
  it('without --discovery nothing is generated (v0.2 behaviour is unchanged)', async () => {
    const r = await run('flutter-app-buggy', ['test']);
    expect(r.results.discovery).toBeUndefined();
    expect(r.results.results.some((x: any) => x.kind === 'generated')).toBe(false);
    expect(r.code).toBe(0);
  }, 120_000);

  it('--dry-run --discovery validates scenarios but executes nothing and reports them as not executed', async () => {
    const r = await run('flutter-app-buggy', ['test', '--discovery', '--dry-run'], agentFile);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/Autonomous Discovery/);
    expect(r.stdout).toMatch(/validated only/);
    expect(fs.existsSync(path.join(r.project, 'fthisup-results', 'results.json'))).toBe(false);
  }, 120_000);

  it('the old v0.2 flutter fixture still reports its planted regression (backward compatibility)', async () => {
    const r = await run('flutter-buggy', ['test', '--adapter', 'flutter']);
    expect(r.code).toBe(1);
    expect(r.results.findings.some((f: any) => f.status === 'confirmed' && /increments|throws/.test(f.title))).toBe(true);
  }, 120_000);

  it('a project without Flutter says plainly that autonomous generation is not available, and still runs', async () => {
    const r = await run('node-clean', ['test', '--discovery', '--adapter', 'javascript']);
    expect(r.code).toBe(0);
    expect(r.results.discovery.counts.generated).toBe(0);
    expect(r.results.discovery.limitations.join(' ')).toMatch(/implemented for Flutter apps only/);
    expect(r.results.discovery.support[0].implemented).toBe(false);
  }, 120_000);

  it('`fthisup discover` writes the application map and `--example` prints a valid scenario', async () => {
    const proj = copyFixture('flutter-app-buggy');
    const r = await runCli(['discover', '--example'], { cwd: proj });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/Riskiest widgets/);
    const m = readJson(proj, 'fthisup-results', 'app-map.json');
    expect(m.screens[0].class).toBe('WorkoutScreen');
    const ex = JSON.parse(r.stdout.slice(r.stdout.indexOf('{\n  "version"'), r.stdout.indexOf('\n\n', r.stdout.indexOf('{\n  "version"'))));
    const { flutterScenarioFileSchema } = await import('../../src/autonomous/flutter/schema.js');
    const { validateFlutterScenarios } = await import('../../src/autonomous/flutter/validate.js');
    expect(flutterScenarioFileSchema.safeParse(ex).success).toBe(true);
    expect(validateFlutterScenarios(ex.scenarios, m, proj, 'agent').rejected).toEqual([]);
  }, 120_000);

  it('budgets are honoured: scenarios over maxExecuted are skipped, not run', async () => {
    const proj = copyFixture('flutter-app-buggy', { 'fthisup.config.json': JSON.stringify({ discovery: { maxExecuted: 2, reproAttempts: 1 } }) });
    const r = await runCli(['test', '--discovery'], { cwd: proj, timeoutMs: 200_000 });
    const res = readJson(proj, 'fthisup-results', 'results.json');
    expect(res.discovery.counts.executed).toBe(2);
    expect(res.discovery.records.some((x: any) => x.status === 'skipped' && /budget/.test(x.reason))).toBe(true);
    expect(r.code === 0 || r.code === 1).toBe(true);
  }, 240_000);
});
