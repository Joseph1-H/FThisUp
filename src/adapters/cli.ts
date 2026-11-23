import fs from 'node:fs';
import path from 'node:path';
import type { Capability, ExpectationResult, Finding, Severity, TestResult, FailureType } from '../core/types.js';
import type { Component } from '../detect/manifest.js';
import { cleanupScratch, newScratch, runProcess, type RunOutcome } from '../exec/run.js';
import { sandboxInfo } from '../exec/sandbox.js';
import { pythonExe, which } from '../exec/tools.js';
import { classifySensitivity } from '../safety/classify.js';
import { checkApproval } from '../safety/policy.js';
import { validateCliScenarios, type CliExpectation, type CliScenario } from '../scenarios/cli-schema.js';
import { mkFinding, mkResult, slugify, statusFrom, tail } from './common.js';
import type { AdapterOutcome, DetectionResult, ExecutionContext, PlannedTest, ProjectContext, TestAdapter, TestPlan } from './types.js';
import fsx from 'node:fs';

export interface CliTarget { name: string; file: string; args: string[]; component: string; source: string }

export function discoverCliTargets(ctx: ProjectContext): { targets: CliTarget[]; notes: string[] } {
  const targets: CliTarget[] = [];
  const notes: string[] = [];
  const rootComp = ctx.manifest.components[0]?.id ?? 'root';
  for (const c of ctx.config.cli?.commands ?? []) {
    const comp = ctx.manifest.components.find((x) => x.path === (c.cwd ?? '.')) ?? ctx.manifest.components[0];
    targets.push({ name: c.name, file: c.command[0]!, args: c.command.slice(1), component: comp?.id ?? rootComp, source: 'fthisup.config.json cli.commands' });
  }
  for (const comp of ctx.manifest.components) {
    if (!comp.roles.includes('cli')) continue;
    const dir = path.resolve(ctx.root, comp.path);
    if (comp.ecosystem === 'node') {
      for (const ep of comp.entryPoints.filter((e) => e.startsWith('bin: '))) {
        const rel = ep.slice(5);
        const abs = path.resolve(dir, rel);
        if (!fs.existsSync(abs)) { notes.push(`${comp.id}: bin entry ${rel} does not exist.`); continue; }
        if (!targets.some((t) => t.args[0] === abs)) targets.push({ name: path.basename(rel).replace(/\.[cm]?js$/, ''), file: 'node', args: [abs], component: comp.id, source: `package.json bin (${rel})` });
      }
    } else if (comp.ecosystem === 'python') {
      const py = pythonExe();
      if (py && fs.existsSync(path.join(dir, '__main__.py'))) targets.push({ name: path.basename(dir === ctx.root ? ctx.root : dir), file: py, args: [dir], component: comp.id, source: '__main__.py' });
      else if (py && fs.existsSync(path.join(dir, 'main.py')) && /argparse|click|typer/.test(fs.readFileSync(path.join(dir, 'main.py'), 'utf8'))) targets.push({ name: 'main', file: py, args: [path.join(dir, 'main.py')], component: comp.id, source: 'main.py (argparse/click/typer)' });
      else if (!py) notes.push(`${comp.id}: Python is not installed.`);
    } else if (comp.ecosystem === 'rust') {
      const name = /^name\s*=\s*"([^"]+)"/m.exec(fs.readFileSync(path.join(dir, 'Cargo.toml'), 'utf8'))?.[1];
      const bin = name ? path.join(dir, 'target', 'debug', name) : '';
      if (name && fs.existsSync(bin)) targets.push({ name, file: bin, args: [], component: comp.id, source: 'existing cargo debug build (run `cargo build` to refresh)' });
      else notes.push(`${comp.id}: no built binary found at target/debug/${name ?? '<name>'}; FThisUp does not build CLIs. Run \`cargo build\` or declare "cli.commands" in the config.`);
    } else if (comp.ecosystem === 'go' || comp.ecosystem === 'cpp') notes.push(`${comp.id}: compiled CLI; declare the built binary in "cli.commands" in fthisup.config.json to test it.`);
  }
  return { targets, notes };
}

// ----------------------------------------------------------------------------- observation helpers
const CRASH_SIGNALS = new Set(['SIGSEGV', 'SIGABRT', 'SIGBUS', 'SIGILL', 'SIGFPE', 'SIGSYS']);
const CRASH_CODES = new Set([132, 134, 135, 136, 139]);
const TRACE_RES: Array<[RegExp, string]> = [
  [/Traceback \(most recent call last\):/, 'Python traceback'],
  [/\b\w*(Error|Exception): .*\n(\s+at .+\n?){1,}/, 'JavaScript/Java stack trace'],
  [/^\s+at .+\(.+:\d+:\d+\)\s*$/m, 'JavaScript stack trace'],
  [/node:internal\/|Uncaught \w*Error/, 'Node.js internal stack'],
  [/Exception in thread "/, 'Java exception'],
  [/thread '[^']*' panicked at/, 'Rust panic'],
  [/^panic: .*\n[\s\S]*goroutine \d+/m, 'Go panic'],
  [/Unhandled exception\./, '.NET unhandled exception'],
  [/Segmentation fault|core dumped/, 'segmentation fault'],
];
export function findStackTrace(text: string): string | null {
  for (const [re, label] of TRACE_RES) if (re.test(text)) return label;
  return null;
}
/** The program could not even be started (missing entry file, bad interpreter): an environment problem, never a finding. */
export function launchFailure(out: RunOutcome, t: CliTarget): string | null {
  if (out.spawnError) return `could not start: ${out.spawnError}`;
  const text = `${out.stderr}\n${out.stdout}`;
  const entry = t.args.find((a) => path.isAbsolute(a)) ?? (path.isAbsolute(t.file) ? t.file : undefined);
  if (entry && (out.exitCode ?? 0) !== 0 && text.includes(entry) && /Cannot find module|can't open file|No such file or directory|not found/i.test(text) && !/at .*:\d+:\d+\)?\s*$/m.test(text.replace(/node:internal[^\n]*\n/g, ''))) {
    return `the entry point ${entry} could not be loaded in the test environment (${(text.split('\n').find((l) => /Cannot find module|can't open file|No such file/i.test(l)) ?? '').trim().slice(0, 140)}); not reported as a bug`;
  }
  return null;
}

export function didCrash(out: RunOutcome): boolean {
  return (!!out.signal && CRASH_SIGNALS.has(out.signal)) || (out.exitCode !== null && CRASH_CODES.has(out.exitCode));
}

type Exp = CliExpectation & { hard?: boolean };
interface Spec {
  id: string; name: string; argv: string[]; stdin?: CliScenario['stdin']; signal?: CliScenario['signal']; timeoutMs?: number;
  expect: Exp[]; risk: 'low' | 'medium' | 'high'; requiresApproval?: boolean; sensitivity?: CliScenario['sensitivity']; origin: 'heuristic' | 'agent';
  /** scratch files to create before the run: name → content (relative to scratch) */
  files?: Record<string, string>;
  description?: string;
  /** args that reference a scratch file by name are rewritten to absolute scratch paths */
  scratchArgs?: boolean;
}

function stdinBuffer(s: CliScenario['stdin'] | undefined): Buffer | string | null {
  if (!s || s.kind === 'empty') return null;
  if (s.kind === 'text') return s.text;
  if (s.kind === 'unicode') return 'Ünïcödé 日本語 العربية 🚀🔥 👨‍👩‍👧‍👦 \u0000 ‮ rtl\n'.repeat(20);
  if (s.kind === 'binary') { const b = Buffer.alloc(s.bytes); for (let i = 0; i < b.length; i++) b[i] = (i * 31 + 7) % 256; return b; }
  return Buffer.from('lorem ipsum dolor sit amet\n'.repeat(Math.ceil(s.bytes / 27))).subarray(0, s.bytes);
}

function evalExp(e: Exp, out: RunOutcome): ExpectationResult {
  const R = (passed: boolean, hard: boolean, severity: Severity, message: string): ExpectationResult => ({ type: e.type, passed, hard, severity, message });
  const all = `${out.stderr}\n${out.stdout}`;
  switch (e.type) {
    case 'noCrash': { const c = didCrash(out); return R(!c, true, 'high', c ? `The process crashed (${out.signal ?? `exit code ${out.exitCode}`}).` : 'No crash.'); }
    case 'noStackTrace': { const t = findStackTrace(all); return R(!t, e.hard ?? true, 'medium', t ? `An unhandled exception escaped to the user (${t}) instead of a clean error message.` : 'No stack trace.'); }
    case 'terminates': return R(!out.timedOut, e.hard ?? true, 'high', out.timedOut ? 'The process did not exit before the timeout and had to be killed (hang).' : 'Process exited.');
    case 'exitCode': return R(out.exitCode !== null && e.oneOf.includes(out.exitCode), false, 'medium', `Exit code ${out.exitCode ?? out.signal}; expected one of ${e.oneOf.join(', ')}.`);
    case 'nonZeroExit': return R(out.exitCode !== 0, false, 'low', out.exitCode === 0 ? 'Invalid input was accepted: the command exited 0 as if nothing was wrong.' : 'Non-zero exit.');
    case 'stderrEmpty': return R(out.stderr.trim() === '', false, 'low', out.stderr.trim() ? `Unexpected stderr output: ${out.stderr.trim().slice(0, 120)}` : 'stderr empty.');
    case 'stdoutContains': return R(out.stdout.includes(e.text), false, 'medium', out.stdout.includes(e.text) ? 'ok' : `stdout does not contain "${e.text}".`);
    case 'stderrContains': return R(out.stderr.includes(e.text), false, 'medium', out.stderr.includes(e.text) ? 'ok' : `stderr does not contain "${e.text}".`);
    case 'exitsWithinMs': return R(out.durationMs <= e.ms && !out.timedOut, false, 'medium', `Took ${out.durationMs}ms (limit ${e.ms}ms).`);
  }
}

const FAILURE_FOR: Record<CliExpectation['type'], FailureType> = {
  noCrash: 'crash', noStackTrace: 'unhandled-exception', terminates: 'hang', exitCode: 'incorrect-output', nonZeroExit: 'input-validation',
  stderrEmpty: 'incorrect-output', stdoutContains: 'incorrect-output', stderrContains: 'incorrect-output', exitsWithinMs: 'resource-usage',
};
const FIX_FOR: Record<CliExpectation['type'], string> = {
  noCrash: 'A native crash means memory-unsafe code or an abort(). Reproduce with the exact command in the evidence under a debugger/sanitizer and guard the failing input.',
  noStackTrace: 'Catch the exception at the CLI entry point, print a one-line error to stderr and exit with a non-zero status instead of dumping a stack trace.',
  terminates: 'Make the command exit (or time out cleanly) on EOF/invalid input and respond to SIGINT/SIGTERM; avoid unbounded loops and blocking reads without a timeout.',
  exitCode: 'Return the documented exit code for this situation.',
  nonZeroExit: 'Validate arguments and inputs; exit non-zero with a helpful message for invalid input and unknown flags.',
  stderrEmpty: 'Do not write diagnostics to stderr on success.',
  stdoutContains: 'Check the command output against the documented behaviour.',
  stderrContains: 'Check the error message against the documented behaviour.',
  exitsWithinMs: 'Look for work proportional to input size that should be bounded.',
};

const display = (t: CliTarget, argv: string[]) => [path.basename(t.file), ...t.args.map((a) => (path.isAbsolute(a) ? path.basename(a) : a)), ...argv.map((a) => (a.length > 60 ? `${a.slice(0, 60)}…(${a.length} chars)` : a))].map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ');

/** Deterministic adversarial scenarios. Help-derived ones are appended after probing --help. */
export function baseScenarios(): Spec[] {
  const clean: Exp[] = [{ type: 'noCrash' }, { type: 'noStackTrace' }, { type: 'terminates', hard: false }];
  const cleanStrictHang: Exp[] = [{ type: 'noCrash' }, { type: 'noStackTrace' }, { type: 'terminates' }];
  const S = (s: Omit<Spec, 'origin' | 'risk'> & { risk?: Spec['risk'] }): Spec => ({ origin: 'heuristic', risk: 'low', ...s });
  return [
    S({ id: 'help', name: 'Print help (--help)', argv: ['--help'], expect: [...cleanStrictHang, { type: 'exitCode', oneOf: [0] }] }),
    S({ id: 'no-args', name: 'Run with no arguments and empty stdin', argv: [], expect: clean }),
    S({ id: 'unknown-flag', name: 'Unknown flag', argv: ['--fthisup-unknown-flag'], expect: [...cleanStrictHang, { type: 'nonZeroExit' }] }),
    S({ id: 'empty-arg', name: 'Empty-string argument', argv: [''], expect: clean }),
    S({ id: 'long-arg', name: 'Extremely long argument (30,000 chars)', argv: ['A'.repeat(30_000)], expect: clean }),
    S({ id: 'unicode-args', name: 'Unicode and emoji arguments', argv: ['日本語', '🚀🔥', 'Ünïcödé', '‮'], expect: clean }),
    S({ id: 'nonexistent-path', name: 'Nonexistent file path', argv: ['/nonexistent/fthisup/missing-file.txt'], expect: cleanStrictHang }),
    S({ id: 'stdin-dash-empty', name: 'Read stdin ("-") with empty input', argv: ['-'], stdin: { kind: 'empty' }, expect: clean }),
    S({ id: 'long-stdin', name: 'Very large stdin (2 MB)', argv: [], stdin: { kind: 'long', bytes: 2_000_000 }, expect: clean }),
    S({ id: 'unicode-stdin', name: 'Unicode, NUL and RTL characters on stdin', argv: [], stdin: { kind: 'unicode' }, expect: clean }),
    S({ id: 'binary-stdin', name: 'Binary garbage on stdin', argv: [], stdin: { kind: 'binary', bytes: 200_000 }, expect: clean }),
    ...(process.platform === 'win32' ? [] : [
      S({ id: 'interrupt', name: 'Interrupt (SIGINT) while waiting for input', argv: [], signal: { afterMs: 500, name: 'SIGINT' }, timeoutMs: 4500, expect: [{ type: 'noCrash' }, { type: 'terminates', hard: false }, { type: 'noStackTrace', hard: false }] }),
      S({ id: 'terminate', name: 'Terminate (SIGTERM) while waiting for input', argv: [], signal: { afterMs: 500, name: 'SIGTERM' }, timeoutMs: 4500, expect: [{ type: 'noCrash' }, { type: 'terminates', hard: false }] }),
    ]),
  ];
}

/** Derive extra scenarios from the program's own --help text (flags that take values / config files). */
export function helpDerived(help: string): Spec[] {
  const out: Spec[] = [];
  const clean: Exp[] = [{ type: 'noCrash' }, { type: 'noStackTrace' }, { type: 'terminates' }];
  const valueFlags = new Set<string>();
  for (const m of help.matchAll(/(--[a-z][\w-]*)(?:[ =]<[\w-]+>|=[A-Za-z_]+| [A-Z_]{2,}\b)/g)) valueFlags.add(m[1]!);
  const skip = /^--(help|version)$/;
  [...valueFlags].filter((f) => !skip.test(f) && !/(delete|remove|force|purge|drop|destroy|yes|overwrite)/i.test(f)).slice(0, 4).forEach((flag) => {
    out.push({ id: `invalid-value${flag}`, name: `Invalid value for ${flag}`, argv: [flag, 'not-a-valid-value-\u0001-zz'], expect: clean, origin: 'heuristic', risk: 'low' });
    out.push({ id: `empty-value${flag}`, name: `Empty value for ${flag}`, argv: [flag, ''], expect: clean, origin: 'heuristic', risk: 'low' });
    out.push({ id: `huge-number${flag}`, name: `Huge numeric value for ${flag}`, argv: [flag, '9'.repeat(40)], expect: clean, origin: 'heuristic', risk: 'low' });
  });
  if (/--config\b/.test(help)) {
    out.push({ id: 'malformed-config', name: 'Malformed configuration file (--config)', argv: ['--config', '@bad.json'], files: { 'bad.json': '{"unterminated": [1, 2,' }, scratchArgs: true, expect: clean, origin: 'heuristic', risk: 'low' });
    out.push({ id: 'binary-config', name: 'Binary garbage as configuration file', argv: ['--config', '@bin.cfg'], files: { 'bin.cfg': '\u0000\u0001\u0002�'.repeat(500) }, scratchArgs: true, expect: clean, origin: 'heuristic', risk: 'low' });
  }
  return out;
}

export interface CliRun { out: RunOutcome; command: string; sandboxed: boolean }

async function runSpec(ctx: ProjectContext, t: CliTarget, sc: Spec, timeoutMs: number): Promise<CliRun> {
  const scratch = newScratch(ctx.root);
  try {
    for (const [name, content] of Object.entries(sc.files ?? {})) fsx.writeFileSync(path.join(scratch, name), content);
    const argv = sc.argv.map((a) => (sc.scratchArgs && a.startsWith('@') ? path.join(scratch, a.slice(1)) : a));
    // Signals sent to a bubblewrap'd process hit the sandbox wrapper, not the program (it would mask a program that ignores SIGINT),
    // so signal scenarios run without the sandbox. They use no hostile input. With sandbox "require" they are not run at all.
    if (sc.signal && ctx.config.safety.sandbox === 'require') {
      return { out: { exitCode: null, signal: null, stdout: '', stderr: '', timedOut: false, truncated: false, durationMs: 0, sandboxed: false, command: display(t, sc.argv), spawnError: 'signal scenarios cannot run inside the sandbox and safety.sandbox is "require"' }, command: display(t, sc.argv), sandboxed: false };
    }
    const out = await runProcess({
      file: t.file, args: [...t.args, ...argv], cwd: scratch, projectRoot: ctx.root, timeoutMs: sc.timeoutMs ?? timeoutMs, stdin: stdinBuffer(sc.stdin),
      signalAfterMs: sc.signal ? { ms: sc.signal.afterMs, signal: sc.signal.name } : undefined, keepStdinOpen: !!sc.signal, sandbox: sc.signal ? 'off' : ctx.config.safety.sandbox, scratch, limits: true,
    });
    return { out, command: display(t, sc.argv), sandboxed: out.sandboxed };
  } finally { cleanupScratch(scratch); }
}

const HARD_HANG_NOTE = 'Hang';

export const cliAdapter: TestAdapter = {
  id: 'cli',
  name: 'Command-line application',
  description: 'Runs your CLI as an isolated subprocess with hostile arguments, stdin and signals: crashes, stack traces, hangs, bad exit codes.',
  requirements: ['a runnable CLI entry point (package.json "bin", __main__.py, an existing cargo debug build, or "cli.commands" in the config)'],
  categories: ['cli'],
  safety: ['argv arrays only: no shell, AI scenarios cannot choose the executable', 'executable allow-list (interpreters or binaries inside the project)', 'bubblewrap sandbox when available: read-only filesystem, scratch dir only, no network', 'sanitized environment (no secrets), HOME = scratch dir', 'per-run timeout, output cap, CPU/file-size limits, process-group kill', 'targets that look destructive need approval when unsandboxed'],
  resourceGroup: 'cpu',

  async detect(ctx): Promise<DetectionResult> {
    const { targets } = discoverCliTargets(ctx);
    return { applicable: targets.length > 0 || ctx.manifest.components.some((c) => c.roles.includes('cli')), confidence: targets.length ? 'high' : 'low', components: [...new Set(targets.map((t) => t.component))], reason: targets.length ? `${targets.length} CLI target(s): ${targets.map((t) => t.name).join(', ')}` : 'a CLI component was detected but no runnable entry point could be determined' };
  },

  async capabilities(ctx): Promise<Capability[]> {
    const { targets, notes } = discoverCliTargets(ctx);
    const sb = sandboxInfo();
    const caps: Capability[] = [];
    for (const t of targets) {
      const exe = path.isAbsolute(t.file) ? fs.existsSync(t.file) : !!which(t.file);
      caps.push({ id: `target:${t.name}`, label: `CLI "${t.name}" (${t.source})`, available: exe, reason: exe ? undefined : `${t.file} not found` });
    }
    if (!targets.length) caps.push({ id: 'targets', label: 'runnable CLI entry point', available: false, reason: notes.join(' ') || 'none found', setup: 'declare "cli": {"commands": [{"name": "mytool", "command": ["node", "bin/mytool.js"]}]} in fthisup.config.json' });
    caps.push({ id: 'sandbox', label: 'OS sandbox (bubblewrap)', available: sb.available, reason: sb.available ? 'read-only filesystem, no network' : sb.reason, setup: sb.available ? undefined : process.platform === 'linux' ? 'sudo apt install bubblewrap   (optional but recommended)' : undefined });
    return caps;
  },

  async plan(ctx, options): Promise<TestPlan> {
    const caps = await this.capabilities(ctx);
    const { targets, notes } = discoverCliTargets(ctx);
    const usable = targets.filter((t) => caps.find((c) => c.id === `target:${t.name}`)?.available);
    const missing = caps.filter((c) => !c.available && c.id !== 'sandbox').map((c) => ({ what: `${c.label}: ${c.reason ?? ''}`, setup: c.setup }));
    const base = { adapterId: 'cli', capabilities: caps, components: [...new Set(usable.map((t) => t.component))], notes: [...notes] };
    if (!usable.length) return { ...base, status: 'unavailable', reason: missing.map((m) => m.what).join('; ') || 'no CLI target', missing, tests: [] };
    const tests: PlannedTest[] = [];
    for (const t of usable) for (const s of baseScenarios()) tests.push({ id: `cli:${t.name}:${s.id}`, name: `${t.name}: ${s.name}`, category: 'cli', component: t.component, risk: s.risk });
    let rejected: Array<{ id?: string; errors: string[] }> = [];
    let agent: CliScenario[] = [];
    if (options.scenariosFile) {
      const raw = loadSection(ctx, options.scenariosFile, 'cliScenarios');
      const v = validateCliScenarios(raw, usable.map((t) => t.name));
      agent = v.valid; rejected = v.rejected;
      for (const s of agent) tests.unshift({ id: `cli:${s.target}:${s.id}`, name: `${s.target}: ${s.name} (agent)`, category: 'cli', component: usable.find((t) => t.name === s.target)!.component, risk: s.risk, requiresApproval: s.requiresApproval });
    }
    notes.push('Flag-specific scenarios (invalid values, malformed --config) are generated after probing --help.');
    const sb = sandboxInfo();
    if (!sb.available) base.notes.push(`Not sandboxed (${sb.reason}): hostile input reaches your CLI with the user's normal permissions.`);
    return { ...base, status: 'ready', missing, tests: tests.slice(0, options.maxTests), droppedByCap: Math.max(0, tests.length - options.maxTests), state: { usable, agent, rejected } };
  },

  async execute(plan, exec): Promise<AdapterOutcome> {
    const ctx = exec.project;
    const { usable, agent, rejected } = plan.state as { usable: CliTarget[]; agent: CliScenario[]; rejected: unknown[] };
    const results: TestResult[] = [];
    const findings: Finding[] = [];
    const notes: string[] = [];
    let n = 0;
    const nextId = () => `C${++n}`;
    const timeoutMs = Math.min(ctx.config.timeout, 10_000);
    const sandboxed = sandboxInfo().available && ctx.config.safety.sandbox !== 'off';
    let budget = exec.options.maxTests;

    for (const t of usable) {
      exec.onStage?.(`Probing CLI ${t.name}...`);
      const comp = t.component;
      // baseline: --help (also used to derive flag scenarios and to classify how risky running this CLI is)
      const helpRun = await runSpec(ctx, t, baseScenarios()[0]!, timeoutMs);
      const launchProblem = launchFailure(helpRun.out, t);
      if (launchProblem) {
        const r = mkResult({ scenarioId: `cli:${t.name}:launch`, name: `${t.name}: start the program`, category: 'cli', adapter: 'cli', component: comp, target: t.name, outcome: 'skipped', reason: launchProblem });
        results.push(r); exec.onProgress?.(r); notes.push(`${t.name}: ${launchProblem}`);
        continue;
      }
      const helpText = `${helpRun.out.stdout}\n${helpRun.out.stderr}`;
      // classify by name and by destructive FLAGS only (help prose like "show this help message" is far too noisy)
      const sens = classifySensitivity(t.name) ?? (/--(delete|remove|destroy|purge|wipe|drop|truncate|uninstall)\b/i.test(helpText) ? ('deletion' as const) : undefined);
      const specs: Spec[] = [...baseScenarios(), ...helpDerived(helpText)];
      for (const a of agent.filter((x) => x.target === t.name)) specs.unshift({ id: a.id, name: `${a.name} (agent)`, argv: a.argv, stdin: a.stdin, signal: a.signal, timeoutMs: a.timeoutMs, expect: a.expect.map((e) => ({ ...e, hard: ['noCrash', 'noStackTrace', 'terminates'].includes(e.type) })), risk: a.risk, requiresApproval: a.requiresApproval, sensitivity: a.sensitivity, origin: 'agent', description: a.description });
      for (const sc of specs) {
        if (budget-- <= 0) { notes.push(`CLI scenario cap (--max-tests ${exec.options.maxTests}) reached; remaining scenarios were not run.`); break; }
        const scenarioId = `cli:${t.name}:${sc.id}`;
        const base = { scenarioId, name: `${t.name}: ${sc.name}`, category: 'cli' as const, adapter: 'cli', component: comp, target: t.name, origin: sc.origin, risk: sc.risk };
        const needsApproval = sc.requiresApproval || ((!sandboxed || !!sc.signal) && !!sens);
        const gate = checkApproval(ctx.config, { requiresApproval: needsApproval, sensitivity: sc.sensitivity ?? sens, risk: sc.risk });
        if (!gate.allowed) { const r = mkResult({ ...base, outcome: 'blocked', reason: gate.reason }); results.push(r); exec.onProgress?.(r); continue; }
        const first = sc.id === 'help' && sc.origin === 'heuristic' ? helpRun : await runSpec(ctx, t, sc, timeoutMs);
        if (first.out.spawnError) { const r = mkResult({ ...base, outcome: 'skipped', reason: first.out.spawnError }); results.push(r); exec.onProgress?.(r); continue; }
        const exps = sc.expect.map((e) => evalExp(e, first.out));
        const failing = exps.filter((e) => !e.passed);
        if (!failing.length) { const r = mkResult({ ...base, outcome: 'passed', expectations: exps, durationMs: first.out.durationMs }); results.push(r); exec.onProgress?.(r); continue; }

        // reproduction in a fresh subprocess + scratch dir
        const second = await runSpec(ctx, t, sc, timeoutMs);
        const failing2 = new Set(sc.expect.map((e) => evalExp(e, second.out)).filter((e) => !e.passed).map((e) => e.type));
        const reproducedTypes = new Set(failing.filter((f) => failing2.has(f.type as CliExpectation['type'])).map((f) => f.type));
        const reproduced = reproducedTypes.size > 0;
        const hard = failing.some((f) => f.hard && reproducedTypes.has(f.type));
        const { status, confidence } = statusFrom(reproduced, true, hard);
        const worst = [...failing].sort((a, b) => (b.hard ? 1 : 0) - (a.hard ? 1 : 0) || ['info', 'low', 'medium', 'high', 'critical'].indexOf(b.severity) - ['info', 'low', 'medium', 'high', 'critical'].indexOf(a.severity))[0]!;
        const sev = failing.reduce<Severity>((m, f) => (['info', 'low', 'medium', 'high', 'critical'].indexOf(f.severity) > ['info', 'low', 'medium', 'high', 'critical'].indexOf(m) ? f.severity : m), 'info');
        const stdinNote = sc.stdin ? `, with ${sc.stdin.kind} stdin${'bytes' in sc.stdin ? ` (${sc.stdin.bytes} bytes)` : ''}` : '';
        const f = mkFinding({
          id: nextId(), title: `${t.name}: ${sc.name}`, category: 'cli', adapter: 'cli', component: comp, route: t.name, status, severity: sev, confidence,
          failureType: FAILURE_FOR[worst.type as CliExpectation['type']], evidenceKind: 'observed-defect', scenarioId,
          expected: [...new Set(sc.expect.filter((e) => failing.some((f2) => f2.type === e.type)).map((e) => ({ noCrash: 'The program never crashes on unusual input.', noStackTrace: 'Errors are reported as clean messages, never raw stack traces.', terminates: 'The program terminates on its own (or when interrupted).', exitCode: 'The program exits with the expected status code.', nonZeroExit: 'Invalid input is rejected with a non-zero exit code.', stderrEmpty: 'Nothing unexpected is printed to stderr.', stdoutContains: 'The output has the expected content.', stderrContains: 'The error message has the expected content.', exitsWithinMs: 'The program finishes within the expected time.' } as const)[e.type]))].join(' '),
          actual: failing.map((e) => e.message).join(' '),
          steps: [`Run: ${first.command}${stdinNote}${sc.signal ? `, then send ${sc.signal.name} after ${sc.signal.afterMs}ms` : ''}`, `Check the exit status${first.out.signal ? ` (killed by ${first.out.signal})` : ` (${first.out.exitCode})`} and the output.`],
          attempts: 2, reproduced, scope: `cli ${first.command}`, fix: [...new Set(failing.map((e) => FIX_FOR[e.type as CliExpectation['type']]))].join(' '),
          evidence: { logs: [`exit=${first.out.exitCode ?? first.out.signal} duration=${first.out.durationMs}ms${first.out.truncated ? ' (output truncated)' : ''}${first.sandboxed ? ' [sandboxed]' : ' [not sandboxed]'}`, `stderr:\n${tail(first.out.stderr, 25)}`, `stdout:\n${tail(first.out.stdout, 10)}`], commands: [first.command], notes: sc.description ? [sc.description] : [] },
        });
        findings.push(f);
        const r = mkResult({ ...base, outcome: 'failed', expectations: exps, reason: failing[0]!.message, findingId: f.id, durationMs: first.out.durationMs });
        results.push(r); exec.onProgress?.(r);
      }
    }
    if ((rejected as unknown[]).length) notes.push(`${(rejected as unknown[]).length} supplied CLI scenario(s) were rejected by validation and never executed.`);
    void HARD_HANG_NOTE;
    return { results, findings, notes, artifacts: { 'rejected-cli-scenarios': (rejected as unknown[]).length } };
  },
};

export function loadSection(ctx: ProjectContext, file: string, key: 'cliScenarios' | 'apiScenarios'): unknown {
  try {
    const j = JSON.parse(fs.readFileSync(path.resolve(ctx.root, file), 'utf8')) as Record<string, unknown>;
    return j[key];
  } catch { return undefined; }
}
export type { Component };
