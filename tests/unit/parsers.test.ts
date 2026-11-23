import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as P from '../../src/adapters/parsers.js';
import { ROOT } from '../helpers.js';

const sample = (f: string) => fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'samples', f), 'utf8');
const by = (tests: P.ParsedTest[]) => Object.fromEntries(tests.map((t) => [t.name, t]));

// The samples below are REAL output captured from the real tools (node 22, python 3.12, cargo 1.99, ctest 3.28, flutter 3.44).
describe('parsers against real tool output', () => {
  it('node:test TAP', () => {
    const r = P.parseTap(sample('node.tap'));
    const t = by(r.tests);
    expect(r.summarySeen).toBe(true);
    expect(Object.keys(t)).toEqual(['sum adds', 'title capitalizes', 'skipped one']);
    expect(t['sum adds']).toMatchObject({ status: 'failed' });
    expect(t['sum adds']!.message).toMatch(/6 !== 5/);
    expect(t['title capitalizes']!.status).toBe('passed');
    expect(t['skipped one']!.status).toBe('skipped');
  });

  it('node:test TAP: nested suites are not counted as tests', () => {
    const tap = ['TAP version 13', '# Subtest: leaf1', '    ok 1 - leaf1', '    ---', '    duration_ms: 1', '    ...', '# Subtest: leaf2', '    not ok 2 - leaf2', '    ---', "    error: 'boom'", '    ...', 'not ok 1 - suite', '1..1', '# tests 2', '# pass 1'].join('\n');
    const r = P.parseTap(tap);
    expect(r.tests.map((t) => t.name)).toEqual(['leaf1', 'leaf2']);
    expect(r.tests[1]).toMatchObject({ status: 'failed', message: expect.stringContaining('boom') });
  });

  it('python unittest -v', () => {
    const r = P.parseUnittest(sample('unittest.txt'));
    const t = by(r.tests);
    expect(r.summarySeen).toBe(true);
    expect(Object.keys(t)).toHaveLength(4);
    expect(t['test_calc.TestCalc.test_add']).toMatchObject({ status: 'failed', message: expect.stringContaining('-1 != 5') });
    expect(t['test_calc.TestCalc.test_div_zero']).toMatchObject({ status: 'errored', message: expect.stringContaining('ZeroDivisionError') });
    expect(t['test_calc.TestCalc.test_div']!.status).toBe('passed');
  });

  it('cargo test', () => {
    const r = P.parseCargo(sample('cargo.txt'));
    const t = by(r.tests);
    expect(r.summarySeen).toBe(true);
    expect(t['tests::adds']).toMatchObject({ status: 'failed', message: expect.stringContaining('left: -1') });
    expect(t['tests::first_of_empty']!.message).toMatch(/index out of bounds/);
    expect(t['tests::ok_test']!.status).toBe('passed');
  });

  it('ctest', () => {
    const r = P.parseCtest(sample('ctest.txt'));
    const t = by(r.tests);
    expect(r.summarySeen).toBe(true);
    expect(t['ok_test']!.status).toBe('passed');
    expect(t['bug_test']).toMatchObject({ status: 'failed', message: expect.stringContaining('assertion failed: 2+2 != 5') });
  });

  it('flutter test --reporter json', () => {
    const r = P.parseDartJson(sample('flutter.json'));
    const t = by(r.tests);
    expect(r.summarySeen).toBe(true);
    expect(Object.keys(t).sort()).toEqual(['increments', 'ok', 'throws']);
    expect(t['increments']).toMatchObject({ status: 'failed', message: expect.stringContaining('Expected: <1>') });
    expect(t['throws']).toMatchObject({ status: 'errored', message: expect.stringContaining('boom') });
    expect(t['ok']!.status).toBe('passed');
  });
});

describe('parsers against documented formats (NOT verified against a real toolchain here: go, maven/gradle, swift)', () => {
  it('go test -json, including a build failure', () => {
    const lines = [
      { Action: 'run', Package: 'x/p', Test: 'TestA' }, { Action: 'output', Package: 'x/p', Test: 'TestA', Output: '    a_test.go:9: got 1 want 2\n' },
      { Action: 'fail', Package: 'x/p', Test: 'TestA', Elapsed: 0.01 }, { Action: 'run', Package: 'x/p', Test: 'TestB' }, { Action: 'pass', Package: 'x/p', Test: 'TestB', Elapsed: 0 },
      { Action: 'fail', Package: 'x/p', Elapsed: 0.02 },
      { Action: 'output', Package: 'x/q', Output: 'FAIL\tx/q [build failed]\n' }, { Action: 'fail', Package: 'x/q', Elapsed: 0 },
    ].map((e) => JSON.stringify(e)).join('\n');
    const r = P.parseGoJson(lines);
    const t = by(r.tests);
    expect(t['x/p/TestA']).toMatchObject({ status: 'failed', message: expect.stringContaining('got 1 want 2') });
    expect(t['x/p/TestB']!.status).toBe('passed');
    expect(t['x/q']).toMatchObject({ status: 'errored' });
  });
  it('JUnit XML (pytest/maven/gradle)', () => {
    const xml = `<testsuite name="s" tests="3"><testcase classname="a.B" name="ok" time="0.01"/><testcase classname="a.B" name="bad" time="0.2"><failure message="expected 1 &amp; got 2">trace</failure></testcase><testcase classname="a.B" name="sk"><skipped message="x"/></testcase><testcase classname="a.B" name="err"><error message="NPE"/></testcase></testsuite>`;
    const t = by(P.parseJUnit(xml).tests);
    expect(t['a.B::ok']!.status).toBe('passed');
    expect(t['a.B::bad']).toMatchObject({ status: 'failed', message: 'expected 1 & got 2' });
    expect(t['a.B::sk']!.status).toBe('skipped');
    expect(t['a.B::err']!.status).toBe('errored');
  });
  it('jest/vitest JSON', () => {
    const j = JSON.stringify({ testResults: [{ name: 'a.test.ts', assertionResults: [{ fullName: 'x works', status: 'passed', duration: 3 }, { fullName: 'y fails', status: 'failed', failureMessages: ['Error: expected 1'] }, { fullName: 'z', status: 'pending' }] }, { name: 'broken.test.ts', message: 'SyntaxError', assertionResults: [] }] });
    const t = by(P.parseJestJson(j).tests);
    expect(t['x works']!.status).toBe('passed');
    expect(t['y fails']).toMatchObject({ status: 'failed', message: expect.stringContaining('expected 1') });
    expect(t['z']!.status).toBe('skipped');
    expect(t['broken.test.ts']!.status).toBe('errored');
  });
  it('swift test', () => {
    const out = "Test Case 'CalcTests.testAdd' started.\nCalcTests.swift:9: error: CalcTests.testAdd : XCTAssertEqual failed\nTest Case 'CalcTests.testAdd' failed (0.001 seconds).\nTest Case 'CalcTests.testOk' passed (0.000 seconds).\nExecuted 2 tests, with 1 failure";
    const t = by(P.parseSwift(out).tests);
    expect(t['CalcTests.testAdd']!.status).toBe('failed');
    expect(t['CalcTests.testOk']!.status).toBe('passed');
  });
});

describe('failure classification and analyzers', () => {
  it.each([
    ['error[E0425]: cannot find value `x`\nerror: could not compile `a`', 'build-failure'],
    ['ModuleNotFoundError: No module named \'requests\'', 'dependency-failure'],
    ['Error: Cannot find module \'left-pad\'', 'dependency-failure'],
    ['FAIL x/q [build failed]', 'build-failure'],
    ['all good', null],
  ])('%s', (out, kind) => expect(P.classifyBuildFailure(out)).toBe(kind));
  it('dart analyze / tsc / cargo / go vet diagnostics', () => {
    expect(P.parseDartAnalyze('  error • The name \'x\' isn\'t defined • lib/a.dart:3:5 • undefined_identifier\n  info • Use const • lib/a.dart:1:1 • prefer_const').errors).toHaveLength(1);
    expect(P.parseTsc("src/a.ts(1,1): error TS2304: Cannot find name 'x'.").errors).toHaveLength(1);
    expect(P.parseCargoDiag('error[E0308]: mismatched types\nerror: could not compile `a`\nwarning: unused').errors).toHaveLength(1);
    expect(P.parseGoVet('./a.go:3:2: unreachable code').errors).toHaveLength(1);
  });
});
