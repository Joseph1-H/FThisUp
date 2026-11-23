import fs from 'node:fs';
import path from 'node:path';
import type { Capability, Category, Finding, TestResult } from '../core/types.js';
import type { Component, Ecosystem, TestCommand } from '../detect/manifest.js';
import { cleanupScratch, newScratch, runProcess, type RunOutcome } from '../exec/run.js';
import { which } from '../exec/tools.js';
import { mkFinding, mkResult, slugify, statusFrom, tail } from './common.js';
import * as P from './parsers.js';
import type { AdapterOutcome, DetectionResult, ExecutionContext, PlannedTest, ProjectContext, TestAdapter, TestOptions, TestPlan } from './types.js';

export interface RunnerAdapterSpec {
  id: string;
  name: string;
  description: string;
  ecosystems: Ecosystem[];
  requirements: string[];
  /** extra step run after the existing tests (adversarial fuzzing etc.) */
  extra?: {
    capability: (ctx: ProjectContext, comp: Component) => Capability;
    plan: (ctx: ProjectContext, comp: Component) => PlannedTest[];
    run: (comp: Component, ctx: ExecutionContext, nextId: () => string) => Promise<{ results: TestResult[]; findings: Finding[]; notes: string[] }>;
  };
}

const MAX_RESULTS_PER_COMMAND = 2000;
const MAX_FINDINGS_PER_COMMAND = 25;

export const suiteTimeout = (ctx: ProjectContext) => Math.min(600_000, Math.max(120_000, ctx.config.timeout * 10));
const display = (tc: TestCommand) => [tc.file, ...tc.args].join(' ');
const compDir = (ctx: ProjectContext, c: Component) => path.resolve(ctx.root, c.path);

export interface CommandRun {
  out: RunOutcome;
  parsed: P.Parsed;
  /** all console output for classification */
  text: string;
  commands: string[];
  buildStepFailed?: string;
}

/** Run one detected test command and parse its structured output. Never installs anything. */
export async function runTestCommand(ctx: ProjectContext, comp: Component, tc: TestCommand, timeoutMs: number): Promise<CommandRun> {
  const cwd = compDir(ctx, comp);
  const scratch = newScratch(ctx.root);
  const commands: string[] = [];
  try {
    const base = { cwd, projectRoot: ctx.root, timeoutMs, limits: true, sandbox: 'off' as const };
    const finish = (out: RunOutcome, parsed: P.Parsed, extraText = ''): CommandRun => ({ out, parsed, text: `${extraText}${out.stdout}\n${out.stderr}`, commands });
    const run = async (file: string, args: string[], env?: Record<string, string>, t = timeoutMs) => {
      const out = await runProcess({ ...base, file, args, env, timeoutMs: t });
      commands.push(out.command);
      return out;
    };
    switch (tc.runner) {
      case 'pytest': {
        const xml = path.join(scratch, 'junit.xml');
        const out = await run(tc.file, [...tc.args, '-q', '--tb=short', '-p', 'no:cacheprovider', `--junitxml=${xml}`]);
        return finish(out, fs.existsSync(xml) ? P.parseJUnit(fs.readFileSync(xml, 'utf8')) : { tests: [], summarySeen: false });
      }
      case 'unittest': { const out = await run(tc.file, tc.args); return finish(out, P.parseUnittest(`${out.stdout}\n${out.stderr}`)); }
      case 'node-test': { const out = await run(tc.file, [...tc.args, '--test-reporter=tap']); return finish(out, P.parseTap(out.stdout)); }
      case 'vitest':
      case 'jest': {
        const f = path.join(scratch, 'out.json');
        const out = await run(tc.file, [...tc.args, tc.runner === 'vitest' ? '--reporter=json' : '--json', `--outputFile=${f}`]);
        return finish(out, fs.existsSync(f) ? P.parseJestJson(fs.readFileSync(f, 'utf8')) : { tests: [], summarySeen: false });
      }
      case 'mocha': { const out = await run(tc.file, [...tc.args, '--reporter', 'json']); return finish(out, parseMochaJson(out.stdout)); }
      case 'npm-test': {
        const out = await run(tc.file, tc.args);
        const text = `${out.stdout}\n${out.stderr}`;
        const tap = /^TAP version/m.test(text) ? P.parseTap(text) : { tests: [], summarySeen: false };
        return finish(out, tap);
      }
      case 'cargo': { const out = await run(tc.file, tc.args); return finish(out, P.parseCargo(`${out.stdout}\n${out.stderr}`)); }
      case 'go': { const out = await run(tc.file, tc.args); return finish(out, P.parseGoJson(out.stdout), out.stderr + '\n'); }
      case 'flutter':
      case 'dart': { const out = await run(tc.file, tc.args); return finish(out, P.parseDartJson(out.stdout), out.stderr + '\n'); }
      case 'swift': { const out = await run(tc.file, tc.args); return finish(out, P.parseSwift(`${out.stdout}\n${out.stderr}`)); }
      case 'maven':
      case 'gradle': {
        const started = Date.now() - 2000;
        const out = await run(tc.file, tc.args);
        const dirs = tc.runner === 'maven' ? ['target/surefire-reports'] : ['build/test-results/test', 'build/test-results'];
        const tests: P.ParsedTest[] = [];
        for (const d of dirs) {
          const abs = path.join(cwd, d);
          if (!fs.existsSync(abs)) continue;
          for (const f of fs.readdirSync(abs)) {
            const full = path.join(abs, f);
            if (/^TEST-.*\.xml$/.test(f) && fs.statSync(full).mtimeMs >= started) tests.push(...P.parseJUnit(fs.readFileSync(full, 'utf8')).tests);
          }
        }
        return finish(out, { tests, summarySeen: tests.length > 0 });
      }
      case 'ctest': {
        const build = path.join(scratch, 'build');
        const cfg = await run('cmake', ['-S', cwd, '-B', build]);
        if (cfg.exitCode !== 0) return { out: cfg, parsed: { tests: [], summarySeen: false }, text: `${cfg.stdout}\n${cfg.stderr}`, commands, buildStepFailed: 'configure' };
        const bld = await run('cmake', ['--build', build]);
        if (bld.exitCode !== 0) return { out: bld, parsed: { tests: [], summarySeen: false }, text: `${bld.stdout}\n${bld.stderr}`, commands, buildStepFailed: 'build' };
        const out = await run('ctest', ['--test-dir', build, '--output-on-failure', '--timeout', '60']);
        return finish(out, P.parseCtest(`${out.stdout}\n${out.stderr}`));
      }
      default: { const out = await run(tc.file, tc.args); return finish(out, { tests: [], summarySeen: false }); }
    }
  } finally { cleanupScratch(scratch); }
}

function parseMochaJson(stdout: string): P.Parsed {
  const i = stdout.indexOf('{\n');
  try {
    const j = JSON.parse(stdout.slice(i)) as { passes?: any[]; failures?: any[]; pending?: any[] };
    const tests: P.ParsedTest[] = [
      ...(j.passes ?? []).map((t) => ({ name: t.fullTitle as string, status: 'passed' as const })),
      ...(j.failures ?? []).map((t) => ({ name: t.fullTitle as string, status: 'failed' as const, message: String(t.err?.message ?? 'failed').slice(0, 600) })),
      ...(j.pending ?? []).map((t) => ({ name: t.fullTitle as string, status: 'skipped' as const })),
    ];
    return { tests, summarySeen: true };
  } catch { return { tests: [], summarySeen: false }; }
}

const SEV = { assertion: 'medium', error: 'medium', build: 'high', hang: 'high', dep: 'medium' } as const;

/** Runs the command (with one reproduction re-run on failure) and turns it into results + findings. */
export async function executeCommand(adapterId: string, ctx: ProjectContext, comp: Component, tc: TestCommand, nextId: () => string, timeoutMs: number): Promise<{ results: TestResult[]; findings: Finding[]; notes: string[] }> {
  const results: TestResult[] = [];
  const findings: Finding[] = [];
  const notes: string[] = [];
  const first = await runTestCommand(ctx, comp, tc, timeoutMs);
  const prefix = `${adapterId}:${comp.path}:${tc.runner}`;
  const cmdText = display(tc);
  const steps = [`cd ${comp.path === '.' ? '<project root>' : comp.path}`, ...first.commands];

  if (first.out.spawnError) {
    results.push(mkResult({ scenarioId: `${prefix}:run`, name: `Run ${cmdText}`, category: 'unit-tests', outcome: 'skipped', reason: `could not start: ${first.out.spawnError}`, adapter: adapterId, component: comp.id }));
    return { results, findings, notes };
  }
  const failedTests = first.parsed.tests.filter((t) => t.status === 'failed' || t.status === 'errored');
  const commandFailed = first.out.exitCode !== 0 || first.out.timedOut;
  const infraKind = first.out.timedOut ? null : P.classifyBuildFailure(first.text);

  // ---- reproduction: one full re-run (bounded) ----
  let reproducedNames = new Set<string>();
  let reproducedInfra = false;
  let attempts = 1;
  if (commandFailed && first.out.durationMs <= 90_000) {
    const second = await runTestCommand(ctx, comp, tc, timeoutMs);
    attempts = 2;
    reproducedNames = new Set(second.parsed.tests.filter((t) => t.status === 'failed' || t.status === 'errored').map((t) => t.name));
    reproducedInfra = (second.out.exitCode !== 0 || second.out.timedOut) && failedTests.length === 0;
  } else if (commandFailed) notes.push(`${cmdText}: failure was not re-run because the suite took ${(first.out.durationMs / 1000).toFixed(0)}s.`);

  // ---- individual test results ----
  for (const t of first.parsed.tests.slice(0, MAX_RESULTS_PER_COMMAND)) {
    const failed = t.status === 'failed' || t.status === 'errored';
    const base = { scenarioId: `${prefix}:${slugify(t.name)}`, name: t.name, category: 'unit-tests' as Category, durationMs: t.durationMs ?? 0, adapter: adapterId, component: comp.id, target: comp.path };
    if (!failed) { results.push(mkResult({ ...base, outcome: t.status === 'skipped' ? 'skipped' : 'passed', reason: t.status === 'skipped' ? 'skipped by the project\'s own test runner' : undefined })); continue; }
    const reproduced = reproducedNames.has(t.name);
    const { status, confidence } = statusFrom(reproduced, attempts > 1, true);
    let finding: Finding | undefined;
    if (findings.length < MAX_FINDINGS_PER_COMMAND) {
      finding = mkFinding({
        id: nextId(), title: `Existing test fails: ${t.name}`, category: 'unit-tests', adapter: adapterId, component: comp.id, route: comp.path, status, severity: SEV[t.status === 'errored' ? 'error' : 'assertion'], confidence,
        failureType: t.status === 'errored' ? 'unhandled-exception' : 'regression', evidenceKind: 'failed-assertion', scenarioId: base.scenarioId,
        expected: `The project's own test "${t.name}" passes.`,
        actual: t.message ?? 'The test failed.',
        steps, attempts, reproduced, scope: `test ${t.name}`,
        fix: t.status === 'errored'
          ? 'The test raised an unexpected exception: read the stack trace in the evidence, find the code path that throws, and handle the case (or fix the test setup if the exception is intended).'
          : 'Compare expected vs actual in the evidence. Decide whether the production code regressed or the test is outdated, then fix whichever is wrong.',
        evidence: { logs: [tail(first.text, 40)], commands: first.commands, notes: ['This is the project\'s own test failing. It means a regression OR an outdated test: FThisUp cannot tell which, so review the assertion before changing code.'] },
      });
      findings.push(finding);
    }
    results.push(mkResult({ ...base, outcome: 'failed', reason: t.message, findingId: finding?.id }));
  }
  if (first.parsed.tests.length > MAX_RESULTS_PER_COMMAND) notes.push(`${cmdText}: only the first ${MAX_RESULTS_PER_COMMAND} of ${first.parsed.tests.length} test results were recorded.`);
  if (failedTests.length > MAX_FINDINGS_PER_COMMAND) notes.push(`${cmdText}: ${failedTests.length - MAX_FINDINGS_PER_COMMAND} more failing tests have no individual finding (see their results).`);

  // ---- command-level problems (build/dependency failure, hang, crash before tests) ----
  if (commandFailed && failedTests.length === 0) {
    const kind = first.out.timedOut ? 'hang' : infraKind ?? 'crash';
    const failureType = kind === 'hang' ? 'hang' : kind === 'dependency-failure' ? 'dependency-failure' : kind === 'build-failure' ? 'build-failure' : 'crash';
    const sev = kind === 'hang' || kind === 'build-failure' ? SEV.build : SEV.dep;
    const detail = first.out.timedOut ? `The test command did not finish within ${(timeoutMs / 1000).toFixed(0)}s and was killed.`
      : `${first.buildStepFailed ? `The ${first.buildStepFailed} step failed. ` : ''}The test command exited with code ${first.out.exitCode ?? first.out.signal} before reporting any individual test result.`;
    const { status, confidence } = statusFrom(reproducedInfra, attempts > 1, kind !== 'crash');
    const f = mkFinding({
      id: nextId(), title: kind === 'hang' ? `Test run hangs: ${cmdText}` : kind === 'dependency-failure' ? `Dependencies missing or broken: ${cmdText}` : kind === 'build-failure' ? `Build/compile failure: ${cmdText}` : `Test command failed without results: ${cmdText}`,
      category: kind === 'build-failure' || kind === 'dependency-failure' ? 'build' : 'unit-tests', adapter: adapterId, component: comp.id, route: comp.path, status, severity: sev, confidence,
      failureType, evidenceKind: 'observed-defect', expected: 'The project builds and its test command runs to completion.', actual: detail,
      steps, attempts, reproduced: reproducedInfra, scope: `command ${cmdText}`,
      fix: kind === 'dependency-failure' ? 'Install the project dependencies (e.g. npm install / pip install -r requirements.txt / flutter pub get) and make sure lockfiles are committed. FThisUp never installs dependencies for you.' : kind === 'build-failure' ? 'Fix the compile/syntax error shown in the evidence; the tests cannot run until the project builds.' : 'Run the command manually to see why it exits; check the output in the evidence.',
      evidence: { logs: [tail(first.text, 40)], commands: first.commands },
    });
    findings.push(f);
    results.push(mkResult({ scenarioId: `${prefix}:run`, name: `Run ${cmdText}`, category: f.category, outcome: 'failed', reason: detail, findingId: f.id, adapter: adapterId, component: comp.id, durationMs: first.out.durationMs }));
  } else if (!commandFailed && first.parsed.tests.length === 0) {
    results.push(mkResult({ scenarioId: `${prefix}:run`, name: `Run ${cmdText}`, category: 'unit-tests', outcome: 'skipped', reason: first.parsed.summarySeen ? 'the runner collected no tests' : 'exit code 0 but individual results could not be parsed for this runner command', adapter: adapterId, component: comp.id, durationMs: first.out.durationMs }));
  } else if (commandFailed && failedTests.length > 0 && first.out.timedOut) {
    notes.push(`${cmdText}: the run hit the ${(timeoutMs / 1000).toFixed(0)}s timeout; results above are partial.`);
  }
  return { results, findings, notes };
}

/** Static analyzers (flutter analyze, tsc, clippy, go vet). Only objective ERRORS become findings. */
export async function executeAnalyzer(adapterId: string, ctx: ProjectContext, comp: Component, tc: TestCommand, nextId: () => string, timeoutMs: number): Promise<{ results: TestResult[]; findings: Finding[]; notes: string[] }> {
  const scratch = newScratch(ctx.root);
  try {
    const out = await runProcess({ file: tc.file, args: tc.args, cwd: compDir(ctx, comp), projectRoot: ctx.root, timeoutMs, limits: true });
    const text = `${out.stdout}\n${out.stderr}`;
    const name = `Static analysis: ${display(tc)}`;
    const base = { scenarioId: `${adapterId}:${comp.path}:analyze:${slugify(display(tc))}`, name, category: 'static-analysis' as Category, adapter: adapterId, component: comp.id, durationMs: out.durationMs };
    if (out.spawnError) return { results: [mkResult({ ...base, outcome: 'skipped', reason: out.spawnError })], findings: [], notes: [] };
    const diag = /dart|flutter/.test(tc.file) ? P.parseDartAnalyze(text) : /tsc/.test(tc.args.join(' ')) ? P.parseTsc(text) : tc.file === 'cargo' ? P.parseCargoDiag(text) : tc.file === 'go' ? P.parseGoVet(text) : { errors: [], warnings: 0, infos: 0 };
    if (out.timedOut) return { results: [mkResult({ ...base, outcome: 'skipped', reason: 'analyzer timed out' })], findings: [], notes: [] };
    if (diag.errors.length === 0) {
      const notes = diag.warnings || diag.infos ? [`${display(tc)}: ${diag.warnings} warning(s), ${diag.infos} info message(s) (not counted as failures).`] : [];
      if (out.exitCode !== 0 && !diag.errors.length && P.classifyBuildFailure(text) === 'dependency-failure') return { results: [mkResult({ ...base, outcome: 'skipped', reason: 'dependencies are not installed' })], findings: [], notes };
      return { results: [mkResult({ ...base, outcome: 'passed' })], findings: [], notes };
    }
    const f = mkFinding({
      id: nextId(), title: `${diag.errors.length} analyzer error(s): ${display(tc)}`, category: 'static-analysis', adapter: adapterId, component: comp.id, route: comp.path,
      status: 'confirmed', severity: 'high', confidence: 'high', failureType: 'build-failure', evidenceKind: 'observed-defect', scenarioId: base.scenarioId,
      expected: 'The analyzer reports no errors.', actual: diag.errors.slice(0, 5).join(' | '), steps: [`cd ${comp.path}`, out.command], attempts: 1, reproduced: true, scope: `analyzer ${display(tc)}`,
      fix: 'Fix the reported errors; they are compile/type errors the language tooling itself flags.', evidence: { logs: [tail(text, 40)], commands: [out.command], notes: ['Deterministic analyzer output; not re-run.'] },
    });
    return { results: [mkResult({ ...base, outcome: 'failed', reason: diag.errors[0], findingId: f.id })], findings: [f], notes: [] };
  } finally { cleanupScratch(scratch); }
}

export function makeRunnerAdapter(spec: RunnerAdapterSpec): TestAdapter {
  const comps = (ctx: ProjectContext) => ctx.manifest.components.filter((c) => spec.ecosystems.includes(c.ecosystem));
  const relevant = (c: Component) => c.testCommands.length > 0 || c.testFiles > 0 || c.analyzers.length > 0 || (spec.extra && c.roles.some((r) => r === 'library' || r === 'cli'));

  return {
    id: spec.id, name: spec.name, description: spec.description, requirements: spec.requirements,
    categories: ['unit-tests', 'static-analysis', ...(spec.extra ? (['fuzzing'] as Category[]) : [])],
    safety: ['runs ONLY the project\'s own test/analyzer commands (never shell strings, never AI-supplied commands)', 'executable allow-list; secrets stripped from the child environment', 'timeouts, output caps, CPU/file-size limits', 'never installs dependencies or SDKs', ...(spec.extra ? ['function-level fuzzing runs inside the OS sandbox (read-only FS, no network)'] : [])],
    resourceGroup: 'cpu',

    async detect(ctx): Promise<DetectionResult> {
      const cs = comps(ctx).filter(relevant);
      return { applicable: cs.length > 0, confidence: cs.length ? 'high' : 'low', components: cs.map((c) => c.id), reason: cs.length ? `${cs.length} ${spec.id} component(s) with tests or analyzers` : `no ${spec.id} component with tests found` };
    },

    async capabilities(ctx): Promise<Capability[]> {
      const caps: Capability[] = [];
      for (const c of comps(ctx).filter(relevant)) {
        for (const tc of c.testCommands) caps.push({ id: `${c.id}:${tc.runner}`, label: `${display(tc)} (${c.path})`, available: tc.available, reason: tc.reason, setup: tc.setup });
        if (!c.testCommands.length) caps.push({ id: `${c.id}:tests`, label: `existing tests (${c.path})`, available: false, reason: c.testFiles ? 'test files found but no runnable test command could be determined' : 'no existing tests found', setup: undefined });
        for (const an of c.analyzers) caps.push({ id: `${c.id}:analyze:${an.file}`, label: `${display(an)} (${c.path})`, available: an.available, reason: an.reason, setup: an.setup });
        if (spec.extra) caps.push(spec.extra.capability(ctx, c));
      }
      return caps;
    },

    async plan(ctx, _options: TestOptions): Promise<TestPlan> {
      const cs = comps(ctx).filter(relevant);
      const caps = await this.capabilities(ctx);
      const tests: PlannedTest[] = [];
      const notes: string[] = [];
      for (const c of cs) {
        for (const tc of c.testCommands.filter((t) => t.available)) tests.push({ id: `${spec.id}:${c.path}:${tc.runner}`, name: `Run existing tests: ${display(tc)}`, category: 'unit-tests', component: c.id, risk: 'low' });
        for (const an of c.analyzers.filter((t) => t.available)) tests.push({ id: `${spec.id}:${c.path}:analyze:${an.file}`, name: `Static analysis: ${display(an)}`, category: 'static-analysis', component: c.id, risk: 'low' });
        if (spec.extra) tests.push(...spec.extra.plan(ctx, c));
        notes.push(...c.notes);
      }
      const missing = caps.filter((c) => !c.available).map((c) => ({ what: `${c.label}: ${c.reason ?? 'unavailable'}`, setup: c.setup }));
      if (!tests.length) return { adapterId: spec.id, status: 'unavailable', reason: missing.map((m) => m.what).join('; ') || 'nothing to run', missing, capabilities: caps, components: cs.map((c) => c.id), tests, notes };
      return { adapterId: spec.id, status: 'ready', missing, capabilities: caps, components: cs.map((c) => c.id), tests, notes };
    },

    async execute(plan, exec): Promise<AdapterOutcome> {
      const ctx = exec.project;
      const results: TestResult[] = [];
      const findings: Finding[] = [];
      const notes: string[] = [];
      let n = 0;
      const nextId = () => `T${++n}`;
      const timeoutMs = suiteTimeout(ctx);
      for (const c of comps(ctx).filter((x) => plan.components.includes(x.id))) {
        for (const tc of c.testCommands.filter((t) => t.available)) {
          exec.onStage?.(`Running ${display(tc)} (${c.path})...`);
          const r = await executeCommand(spec.id, ctx, c, tc, nextId, timeoutMs);
          results.push(...r.results); findings.push(...r.findings); notes.push(...r.notes);
          r.results.forEach((x) => exec.onProgress?.(x));
        }
        for (const an of c.analyzers.filter((t) => t.available)) {
          exec.onStage?.(`Running ${display(an)} (${c.path})...`);
          const r = await executeAnalyzer(spec.id, ctx, c, an, nextId, timeoutMs);
          results.push(...r.results); findings.push(...r.findings); notes.push(...r.notes);
          r.results.forEach((x) => exec.onProgress?.(x));
        }
        if (spec.extra && ctx.config.fuzz.enabled) {
          const r = await spec.extra.run(c, exec, nextId);
          results.push(...r.results); findings.push(...r.findings); notes.push(...r.notes);
          r.results.forEach((x) => exec.onProgress?.(x));
        }
      }
      return { results, findings, notes };
    },
  };
}

export const hasTool = (t: string) => !!which(t);

export const pythonAdapter = makeRunnerAdapter({ id: 'python', name: 'Python (pytest / unittest)', description: 'Runs the project\'s existing pytest/unittest suites with structured results and reproduction.', ecosystems: ['python'], requirements: ['Python 3', 'pytest (only if the project uses it)'] });
export const javascriptAdapter = makeRunnerAdapter({ id: 'javascript', name: 'JavaScript / TypeScript (node:test, Vitest, Jest, Mocha)', description: 'Runs the project\'s existing JS/TS test runner and type-check.', ecosystems: ['node'], requirements: ['Node.js 20+', 'installed project dependencies (node_modules)'] });
export const rustAdapter = makeRunnerAdapter({ id: 'rust', name: 'Rust (cargo test)', description: 'Runs cargo test (and clippy when installed).', ecosystems: ['rust'], requirements: ['Rust toolchain (cargo)'] });
export const goAdapter = makeRunnerAdapter({ id: 'go', name: 'Go (go test)', description: 'Runs go test -json and go vet. Parser verified against documented output only.', ecosystems: ['go'], requirements: ['Go toolchain'] });
export const flutterAdapter = makeRunnerAdapter({ id: 'flutter', name: 'Flutter / Dart (flutter test, dart test, analyzer)', description: 'Runs existing flutter/dart tests and the analyzer. Device/emulator integration tests are NOT run.', ecosystems: ['flutter'], requirements: ['Flutter SDK (flutter apps) or Dart SDK (dart packages)', 'no emulator is started or required'] });
export const javaAdapter = makeRunnerAdapter({ id: 'java', name: 'Java / Kotlin (Maven, Gradle)', description: 'Runs mvn test / gradle test (wrappers preferred) and reads JUnit XML reports. Verified against documented formats only.', ecosystems: ['java'], requirements: ['JDK', 'Maven/Gradle or their wrappers'] });
export const cppAdapter = makeRunnerAdapter({ id: 'cpp', name: 'C / C++ (CMake + CTest, make test)', description: 'Configures, builds (out-of-source, in a scratch dir) and runs CTest.', ecosystems: ['cpp'], requirements: ['cmake, ctest and a C/C++ compiler'] });
export const swiftAdapter = makeRunnerAdapter({ id: 'swift', name: 'Swift (swift test)', description: 'Runs swift test for Swift packages. Verified against documented output only.', ecosystems: ['swift'], requirements: ['Swift toolchain'] });
