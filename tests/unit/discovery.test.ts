import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, tmpDir } from '../helpers.js';
import { dartString, generateDartTest, resolveText } from '../../src/autonomous/flutter/codegen.js';
import { flutterScenarioSchema, type FlutterScenario } from '../../src/autonomous/flutter/schema.js';
import { buildFlutterMap } from '../../src/autonomous/flutter/map.js';
import { seedScenarios } from '../../src/autonomous/flutter/seed.js';
import { validateFlutterScenarios, verifyReference } from '../../src/autonomous/flutter/validate.js';
import { judge, classifyFailure } from '../../src/autonomous/classify.js';
import { parseGenerated, type RawRun } from '../../src/autonomous/flutter/execute.js';

const BUGGY = path.join(ROOT, 'tests', 'fixtures', 'projects', 'flutter-app-buggy');
const map = buildFlutterMap(BUGGY, '.', 'test');

const base = (over: Record<string, unknown> = {}) => ({
  id: 'a-scenario', name: 'A scenario', feature: 'Workout logging', risk: 'something could go wrong here',
  expectation: { statement: 'Nothing throws at all', basis: 'invariant' },
  screen: { widget: 'WorkoutScreen' },
  steps: [{ do: 'tap', target: { by: 'key', value: 'save_button' } }],
  ...over,
});

describe('typed scenarios never carry code', () => {
  it('rejects any field that could hold code, commands or URLs', () => {
    for (const extra of [{ code: 'Process.run("x")' }, { shell: 'rm -rf /' }, { url: 'http://evil' }]) expect(flutterScenarioSchema.safeParse(base(extra)).success).toBe(false);
    expect(flutterScenarioSchema.safeParse(base({ steps: [{ do: 'runDart', code: 'x' }] })).success).toBe(false);
    expect(flutterScenarioSchema.safeParse(base({ steps: [{ do: 'tap', target: { by: 'key', value: 'k' }, onTap: 'x' }] })).success).toBe(false);
    expect(flutterScenarioSchema.safeParse(base()).success).toBe(true);
  });
  it('escapes hostile text so it can only ever be a Dart string literal', () => {
    expect(dartString("a'b$c\\d\ne")).toBe("'a\\'b\\$c\\\\d\\u{a}e'");
    const evil = "x'); Process.run('rm', ['-rf', '/']); //";
    const sc = flutterScenarioSchema.parse(base({ steps: [{ do: 'enterText', target: { by: 'key', value: 'weight' }, text: evil }] })) as FlutterScenario;
    const src = generateDartTest(sc, { pkg: 'workout_log', classFiles: { WorkoutScreen: 'workout_screen.dart' }, usesSharedPreferences: false });
    expect(src).toContain("x\\'); Process.run(\\'rm\\'");
    expect(src.split('\n').some((l) => /^\s*Process\.run/.test(l))).toBe(false);
    expect(src).toContain("import 'package:workout_log/workout_screen.dart';");
    expect(src).toContain('HttpOverrides.global');
  });
  it('resolves presets and repeats deterministically', () => {
    expect(resolveText({ preset: 'long' }).length).toBe(300);
    expect(resolveText({ repeat: { unit: 'ab', times: 3 } })).toBe('ababab');
    expect(() => flutterScenarioSchema.parse(base({ steps: [{ do: 'enterText', target: { by: 'key', value: 'x' }, text: { repeat: { unit: 'a', times: 10_000_000 } } }] }))).toThrow();
  });
});

describe('application map (Flutter)', () => {
  it('finds the screen, its fields, actions, handlers and hazards', () => {
    const s = map.screens.find((x) => x.class === 'WorkoutScreen')!;
    expect(s.constructor.pumpable).toBe(true);
    expect(s.fields.map((f) => f.key)).toEqual(['exercise_name', 'weight', 'reps']);
    const save = s.actions.find((a) => a.key === 'save_button')!;
    expect(save.handler).toBe('_save');
    expect(save.guardedWhilePending).toBe(false);
    const h = s.handlers.find((x) => x.name === '_save')!;
    expect(h).toMatchObject({ async: true, setStateAfterAwait: true, checksMounted: false });
    expect(s.persistence.length).toBeGreaterThan(0);
    expect(s.riskReasons.join(' ')).toMatch(/pending-state guard/);
    expect(map.keysInSource).toContain('save_button');
    expect(map.existingTests.testCount).toBe(3);
  });
  it('notices the guard in the clean version and required constructor args', () => {
    const clean = buildFlutterMap(path.join(ROOT, 'tests', 'fixtures', 'projects', 'flutter-app-clean'), '.', 't');
    expect(clean.screens[0]!.actions.find((a) => a.key === 'save_button')!.guardedWhilePending).toBe(true);
    const d = tmpDir();
    fs.mkdirSync(path.join(d, 'lib'));
    fs.writeFileSync(path.join(d, 'pubspec.yaml'), 'name: x\ndependencies:\n  flutter:\n    sdk: flutter\n');
    fs.writeFileSync(path.join(d, 'lib', 'p.dart'), "import 'package:flutter/material.dart';\nclass P extends StatelessWidget {\n  const P({super.key, required this.id, this.n = 1});\n  final String id;\n  final int n;\n  @override\n  Widget build(BuildContext c) => Scaffold(body: TextButton(onPressed: () { Supabase.instance.client.from('t').insert({}); }, child: Text('Go')));\n}\n");
    const m = buildFlutterMap(d, '.', 't');
    expect(m.screens[0]!.constructor).toMatchObject({ pumpable: false });
    expect(m.screens[0]!.constructor.namedParams.find((p) => p.name === 'id')).toMatchObject({ required: true, type: 'String' });
    expect(m.screens[0]!.dependsOn).toContain('Supabase');
    expect(m.supabase.used).toBe(true);
  });
});

describe('seeds and validation', () => {
  it('seeds only invariant scenarios and they all validate', () => {
    const seeds = seedScenarios(map);
    expect(seeds.scenarios.length).toBeGreaterThanOrEqual(5);
    expect(seeds.scenarios.every((s) => s.expectation.basis === 'invariant' && s.method === 'engine-heuristic')).toBe(true);
    const v = validateFlutterScenarios(seeds.scenarios, map, BUGGY, 'engine-heuristic');
    expect(v.rejected).toEqual([]);
    expect(v.valid.length).toBe(seeds.scenarios.length);
  });
  it('rejects hallucinated widgets, keys, args and duplicate ids', () => {
    const r = validateFlutterScenarios([
      base({ id: 'ghost-widget', screen: { widget: 'NoSuchScreen' } }),
      base({ id: 'ghost-key', steps: [{ do: 'tap', target: { by: 'key', value: 'nope' } }] }),
      base({ id: 'ghost-arg', screen: { widget: 'WorkoutScreen', args: { nope: 1 } } }),
      base({ id: 'ok-one' }), base({ id: 'ok-one' }),
      base({ id: 'ghost-type', steps: [{ do: 'tap', target: { by: 'type', value: 'MadeUpWidget' } }] }),
    ], map, BUGGY, 'agent');
    expect(r.rejected.map((x) => x.id).sort()).toEqual(['ghost-arg', 'ghost-key', 'ghost-type', 'ghost-widget', 'ok-one']);
    expect(r.valid.map((x) => x.scenario.id)).toEqual(['ok-one']);
  });
  it('allows interpolated keys such as entry_$i', () => {
    const r = validateFlutterScenarios([base({ id: 'dyn', steps: [{ do: 'tap', target: { by: 'key', value: 'entry_3' } }] })], map, BUGGY, 'agent');
    expect(r.rejected).toEqual([]);
  });
});

describe('expectation support (false-positive prevention)', () => {
  it('verifies references against the real file and downgrades unverifiable ones to assumptions', () => {
    expect(verifyReference(BUGGY, { file: 'README.md', quote: 'Weight must be a positive number' }).ok).toBe(true);
    expect(verifyReference(BUGGY, { file: 'README.md', quote: 'Weight must never exceed 500 kilograms' }).ok).toBe(false);
    expect(verifyReference(BUGGY, { file: 'NOPE.md', quote: 'whatever quote' }).ok).toBe(false);
    expect(verifyReference(BUGGY, { file: '../../../../etc/passwd', quote: 'root:x:0:0' }).ok).toBe(false);
    expect(verifyReference(BUGGY, { file: 'README.md', line: 9999, quote: 'Weight must be a positive number' }).ok).toBe(false);
    const ref = (quote: string) => ({ statement: 'Weight must be positive', basis: 'documented', reference: { file: 'README.md', quote } });
    const r = validateFlutterScenarios([
      base({ id: 'good', expectation: ref('Weight must be a positive number') }),
      base({ id: 'fake', expectation: ref('Weight must never exceed 500 kilograms') }),
      base({ id: 'noref', expectation: { statement: 'Something is documented', basis: 'documented' } }),
      base({ id: 'inv-assert', assertions: [{ kind: 'visible', target: { by: 'text', value: 'x' } }] }),
    ], map, BUGGY, 'agent');
    const by = Object.fromEntries(r.valid.map((v) => [v.scenario.id, v]));
    expect(by.good!.effectiveBasis).toBe('documented');
    expect(by.good!.referenceVerified).toBe(true);
    expect(by.fake!.effectiveBasis).toBe('assumption');
    expect(by.noref!.effectiveBasis).toBe('assumption');
    expect(by['inv-assert']!.effectiveBasis).toBe('assumption');
  });
});

describe('verdicts', () => {
  const run = (over: Partial<RawRun> & { payload?: RawRun['payload'] }): RawRun => ({ frameworkErrors: [], ran: true, ...over });
  const payload = (status: string, observed: any[] = [], failed: any[] = [], extra?: unknown) => ({ status, observed, failed, network: [], extra }) as any;
  const obs = (message: string, type = 'FlutterError') => ({ where: 'steps', type, message, stack: [] });
  it('wrong tests are invalid, never bugs', () => {
    expect(judge(run({ payload: payload('setup', [], [], 'step 1: nothing matches text "x"') }), false).kind).toBe('invalid');
    expect(judge(run({ ran: false, loadError: 'Error: compile failed' }), false).kind).toBe('invalid');
    expect(judge(undefined, false).kind).toBe('invalid');
  });
  it('environment limits are never bugs', () => {
    for (const m of ['You must initialize the supabase instance before calling Supabase.instance', 'SocketException: FTHISUP_NETWORK_BLOCKED: x', 'MissingPluginException(No implementation found for method getAll)', 'Error: Could not find the correct Provider<Foo>', 'No MediaQuery widget ancestor found']) {
      expect(judge(run({ payload: payload('failed', [obs(m)]) }), false).kind, m).toBe('environment');
    }
    expect(judge(run({ payload: payload('baseline', [obs('boom while building')]) }), false).kind).toBe('environment');
    expect(judge(undefined, true).kind).toBe('environment');
    expect(judge(run({ ran: false }), true).kind).toBe('environment');
  });
  it('passes, and fails with a stable signature', () => {
    expect(judge(run({ payload: payload('ok') }), false).kind).toBe('pass');
    const a = judge(run({ payload: payload('failed', [obs('A RenderFlex overflowed by 4088 pixels on the right.')]) }), false);
    const b = judge(run({ payload: payload('failed', [obs('A RenderFlex overflowed by 4088 pixels on the right.')]) }), false);
    const c = judge(run({ payload: payload('failed', [obs('Null check operator used on a null value')]) }), false);
    expect(a.kind).toBe('fail');
    expect((a as any).sig).toBe((b as any).sig);
    expect((a as any).sig).not.toBe((c as any).sig);
    expect((a as any).hard).toBe(true);
  });
  it('framework-only failures are soft (suspected at most)', () => {
    const v = judge(run({ payload: undefined, frameworkErrors: ['A Timer is still pending even after the widget tree was disposed.'] }), false);
    expect(v).toMatchObject({ kind: 'fail', hard: false });
  });
  it('maps failures to the shared taxonomy', () => {
    expect(classifyFailure(['A RenderFlex overflowed'], '').failureType).toBe('layout-defect');
    expect(classifyFailure(['setState() called after dispose()'], '').failureType).toBe('invalid-state-transition');
    expect(classifyFailure(['Null check operator used on a null value'], '').failureType).toBe('unhandled-exception');
  });
});

describe('flutter json output parsing', () => {
  it('attributes print and error events to the right scenario', () => {
    const ev = (o: unknown) => JSON.stringify(o);
    const out = [
      ev({ type: 'testStart', test: { id: 1, name: 'loading /p/test/fthisup_generated/broken_test.dart' } }),
      ev({ type: 'error', testID: 1, error: 'Error: Expected ; after statement', stackTrace: '' }),
      ev({ type: 'testStart', test: { id: 2, name: 'FTHISUP::good' } }),
      ev({ type: 'print', testID: 2, message: `FTHISUP_RESULT ${JSON.stringify({ status: 'ok', observed: [], failed: [], network: [] })}` }),
      ev({ type: 'testDone', testID: 2, result: 'success' }),
    ].join('\n');
    const p = parseGenerated(out, ['broken', 'good', 'never']);
    expect(p.get('broken')!.loadError).toMatch(/Expected/);
    expect(p.get('good')!.payload!.status).toBe('ok');
    expect(p.get('never')!.ran).toBe(false);
  });
});
