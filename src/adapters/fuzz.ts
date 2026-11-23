import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Capability, Finding, Severity, FailureType, TestResult } from '../core/types.js';
import type { Component } from '../detect/manifest.js';
import { cleanupScratch, newScratch, runProcess } from '../exec/run.js';
import { sandboxInfo } from '../exec/sandbox.js';
import { pythonExe } from '../exec/tools.js';
import { mkFinding, mkResult, slugify, statusFrom } from './common.js';
import type { ExecutionContext, PlannedTest, ProjectContext } from './types.js';
import type { RunnerAdapterSpec } from './runners.js';

type Lang = 'node' | 'python';
const HARNESS = fileURLToPath(new URL('./harness/', import.meta.url));

export interface Obs { fn: string; key: string; desc: string; edge: boolean; size: number; outcome: 'returned' | 'threw' | 'hang' | 'crash'; name?: string; message?: string }
export interface HarnessRun { obs: Obs[]; functions: string[]; skipped: Array<{ fn: string; reason: string }>; loadErrors: string[]; restarts: number; calls: number; sandboxed: boolean; command: string }

export type Kind = 'crash' | 'hang' | 'resource' | 'boundary-error';
export interface Flag { kind: Kind; hard: boolean; obs: Obs }

const PY_BOUNDARY = new Set(['IndexError', 'ZeroDivisionError', 'UnicodeEncodeError', 'UnicodeDecodeError', 'OverflowError']);

/** Which observations count as findings. Throwing on type-confused input (None, wrong types) is NOT a finding: that is a type-contract question. */
export function flagFor(lang: Lang, o: Obs): Flag | null {
  if (o.outcome === 'crash') return { kind: 'crash', hard: true, obs: o };
  if (o.outcome === 'hang') return { kind: 'hang', hard: o.size <= 1000, obs: o };
  if (o.outcome !== 'threw') return null;
  const name = o.name ?? '';
  const msg = o.message ?? '';
  if (name === 'RecursionError' || name === 'MemoryError' || (name === 'RangeError' && /call stack/i.test(msg))) return { kind: 'resource', hard: false, obs: o };
  if (!o.edge) return null;
  if (lang === 'python' && PY_BOUNDARY.has(name)) return { kind: 'boundary-error', hard: false, obs: o };
  if (lang === 'node' && name === 'RangeError' && /invalid (array|string) length|out of range/i.test(msg)) return { kind: 'boundary-error', hard: false, obs: o };
  return null;
}

export function fuzzAllowed(ctx: ProjectContext): { ok: boolean; reason: string; sandboxed: boolean } {
  const sb = sandboxInfo();
  const mode = ctx.config.safety.sandbox;
  if (sb.available && mode !== 'off') return { ok: true, reason: 'OS sandbox available', sandboxed: true };
  if (ctx.config.safety.allowUnsandboxedFuzzing) return { ok: true, reason: 'unsandboxed fuzzing explicitly allowed (safety.allowUnsandboxedFuzzing)', sandboxed: false };
  return { ok: false, reason: `function-level fuzzing executes your code with hostile input and requires an OS sandbox (${mode === 'off' ? 'safety.sandbox is "off"' : sb.reason})`, sandboxed: false };
}

function nodeEntry(ctx: ProjectContext, comp: Component): string | null {
  const dir = path.resolve(ctx.root, comp.path);
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as { main?: string; exports?: unknown; type?: string };
    const main = typeof pkg.exports === 'string' ? pkg.exports : pkg.main ?? 'index.js';
    const abs = path.resolve(dir, main);
    return /\.(c|m)?js$/.test(abs) && fs.existsSync(abs) ? abs : null;
  } catch { return null; }
}

function pythonModules(ctx: ProjectContext, comp: Component): string[] {
  const dir = path.resolve(ctx.root, comp.path);
  const bad = /^(test_.*|.*_test|conftest|setup|__main__|manage|wsgi|asgi)\.py$/;
  const found: string[] = [];
  const scan = (d: string, depth: number) => {
    let ents: fs.Dirent[] = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isFile() && e.name.endsWith('.py') && !bad.test(e.name) && e.name !== '__init__.py') found.push(path.join(d, e.name));
      else if (e.isDirectory() && depth < 1 && !/^(tests?|venv|\.venv|env|node_modules|build|dist|\.|__pycache__|docs?|examples?|migrations)/.test(e.name) && !e.name.startsWith('.')) scan(path.join(d, e.name), depth + 1);
    }
  };
  scan(dir, 0);
  return found.slice(0, 8);
}

export async function runHarness(ctx: ProjectContext, lang: Lang, targets: string[], only?: string[], skipInit: string[] = []): Promise<HarnessRun> {
  const cfg = ctx.config.fuzz;
  const allow = fuzzAllowed(ctx);
  const result: HarnessRun = { obs: [], functions: [], skipped: [], loadErrors: [], restarts: 0, calls: 0, sandboxed: allow.sandboxed, command: '' };
  const skip = [...skipInit];
  const py = pythonExe();
  for (let attempt = 0; attempt < 8; attempt++) {
    const scratch = newScratch(ctx.root);
    try {
      const hcfg = { timeoutMs: cfg.perCallTimeoutMs, maxCalls: cfg.maxCallsPerFunction, maxFunctions: cfg.maxFunctions, skip, only };
      const [file, args] = lang === 'node'
        ? ['node', ['--max-old-space-size=512', path.join(HARNESS, 'fuzz-node.mjs'), targets[0]!, JSON.stringify(hcfg)]] as const
        : [py!, [path.join(HARNESS, 'fuzz-py.py'), JSON.stringify({ ...hcfg, modules: targets })]] as const;
      const out = await runProcess({ file, args: [...args], cwd: scratch, projectRoot: ctx.root, timeoutMs: 120_000, sandbox: allow.sandboxed ? 'require' : 'off', scratch, limits: true, maxOutputBytes: 4_000_000 });
      result.command = `${lang === 'node' ? 'node' : 'python3'} <fuzz harness> ${targets.map((t) => path.relative(ctx.root, t)).join(' ')}`;
      result.sandboxed = out.sandboxed;
      if (out.spawnError) { result.loadErrors.push(out.spawnError); return result; }
      let lastStart: Obs | null = null;
      let done = false;
      for (const line of out.stdout.split('\n')) {
        if (!line.startsWith('{')) continue;
        let e: any; try { e = JSON.parse(line); } catch { continue; }
        if (e.t === 'functions') result.functions.push(...e.names.map((n: string) => (e.module ? `${path.basename(e.module)}:${n}` : n)));
        else if (e.t === 'skip-fn') result.skipped.push({ fn: e.fn, reason: e.reason });
        else if (e.t === 'load-error') result.loadErrors.push(`${path.basename(String(e.module ?? targets[0]))}: ${e.name}: ${e.message}`);
        else if (e.t === 'start') lastStart = { fn: e.fn, key: e.key, desc: e.desc, edge: !!e.edge, size: e.size ?? 0, outcome: 'returned' };
        else if (e.t === 'end') { const ls: Obs | null = lastStart; const same = !!ls && ls.key === e.key; result.calls++; result.obs.push({ fn: e.fn, key: e.key, desc: same ? ls!.desc : '', edge: same ? ls!.edge : false, size: same ? ls!.size : 0, outcome: e.outcome, name: e.name, message: e.message }); lastStart = null; }
        else if (e.t === 'done') done = true;
      }
      if (done && !lastStart) return result;
      if (lastStart) {
        // the process died (or had to be killed) in the middle of a call: attribute it to that exact call
        result.obs.push({ ...lastStart, outcome: out.timedOut ? 'hang' : 'crash', message: out.timedOut ? 'the process stopped responding inside this call and was killed' : `process terminated (${out.signal ?? `exit code ${out.exitCode}`})${/heap|memory/i.test(out.stderr) ? ': out of memory' : ''}` });
        skip.push(lastStart.key);
        result.restarts++;
        continue;
      }
      // exited without 'done' and without a pending call: the harness itself failed. Never report that as a clean run.
      result.loadErrors.push(`the fuzz harness exited abnormally (exit ${out.exitCode ?? out.signal}): ${out.stderr.trim().split('\n').slice(-3).join(' | ').slice(0, 300) || 'no output'}`);
      return result;
    } finally { cleanupScratch(scratch); }
  }
  return result;
}

const FIX: Record<Kind, string> = {
  crash: 'The process died while handling this input. Bound sizes and recursion depth, validate input before use, and avoid unbounded allocation.',
  hang: 'The call did not finish. Look for loops or recursion whose termination depends on the input (empty/zero/huge values) and add explicit bounds.',
  resource: 'The call exhausted the stack or memory. Replace deep recursion with iteration or set a depth limit; reject oversized input early.',
  'boundary-error': 'A boundary value (empty string, zero, very large number, Unicode) raised an internal error. Handle the edge case explicitly or validate input and raise a clear error.',
};
const KIND_FAILURE: Record<Kind, FailureType> = { crash: 'crash', hang: 'hang', resource: 'resource-usage', 'boundary-error': 'unhandled-exception' };
const KIND_SEVERITY: Record<Kind, Severity> = { crash: 'high', hang: 'high', resource: 'low', 'boundary-error': 'low' };

function suggestion(lang: Lang, fn: string): string {
  if (lang !== 'python') return '';
  const name = fn.split(':').pop()!;
  return ` Property-test suggestion (not executed by FThisUp): with Hypothesis, add \`@given(st.text()) def test_${name}_never_crashes(s): ${name}(s)\` and adapt the strategy to the parameter types.`;
}

export function fuzzExtra(lang: Lang): NonNullable<RunnerAdapterSpec['extra']> {
  const targetsFor = (ctx: ProjectContext, comp: Component): string[] => (lang === 'node' ? [nodeEntry(ctx, comp)].filter((x): x is string => !!x) : pythonModules(ctx, comp));
  const wanted = (comp: Component) => comp.roles.includes('library') || comp.roles.includes('cli') || comp.roles.includes('api');
  return {
    capability(ctx, comp): Capability {
      const allow = fuzzAllowed(ctx);
      const targets = targetsFor(ctx, comp);
      const lib = wanted(comp);
      const ok = ctx.config.fuzz.enabled && allow.ok && targets.length > 0 && lib && (lang === 'node' || !!pythonExe());
      return {
        id: `${comp.id}:fuzz`, label: `adversarial function fuzzing (${comp.path})`, available: ok,
        reason: !ctx.config.fuzz.enabled ? 'disabled (fuzz.enabled: false)' : !lib ? 'component is not a library/CLI' : !targets.length ? (lang === 'node' ? 'no plain-JS entry point (package.json main must be a built .js file)' : 'no importable Python modules found') : !allow.ok ? allow.reason : allow.reason,
        setup: !allow.ok ? 'install bubblewrap (Linux: sudo apt install bubblewrap) or set safety.allowUnsandboxedFuzzing: true to accept the risk' : undefined,
      };
    },
    plan(ctx, comp): PlannedTest[] {
      const cap = this.capability(ctx, comp);
      return cap.available ? [{ id: `fuzz:${lang}:${comp.path}`, name: `Adversarial inputs for exported functions (${comp.path})`, category: 'fuzzing', component: comp.id, risk: 'low', description: 'Calls exported functions with edge cases and hostile values inside the sandbox; bounded by calls, time and memory.' }] : [];
    },
    async run(comp, exec: ExecutionContext, nextId) {
      const ctx = exec.project;
      const results: TestResult[] = []; const findings: Finding[] = []; const notes: string[] = [];
      const cap = this.capability(ctx, comp);
      if (!cap.available) return { results, findings, notes };
      exec.onStage?.(`Fuzzing exported functions (${comp.path})...`);
      const targets = targetsFor(ctx, comp);
      const first = await runHarness(ctx, lang, targets);
      for (const e of first.loadErrors) notes.push(`fuzz ${comp.path}: ${e}`);
      if (!first.obs.length && !first.functions.length) {
        const r = mkResult({ scenarioId: `fuzz:${lang}:${comp.path}`, name: `Adversarial inputs (${comp.path})`, category: 'fuzzing', outcome: 'skipped', reason: first.loadErrors[0] ?? 'no exported/public functions were found to fuzz', adapter: lang === 'node' ? 'javascript' : 'python', component: comp.id, target: comp.path });
        exec.onProgress?.(r);
        return { results: [r], findings, notes };
      }
      for (const s of first.skipped) notes.push(`fuzz: ${s.fn} skipped (${s.reason}).`);
      if (first.restarts) notes.push(`fuzz ${comp.path}: the harness process died ${first.restarts} time(s); each crash was attributed to its exact call and the run continued.`);
      const byFn = new Map<string, Obs[]>();
      for (const o of first.obs) byFn.set(o.fn, [...(byFn.get(o.fn) ?? []), o]);
      for (const fn of first.functions) if (!byFn.has(fn) && !first.skipped.some((s) => s.fn === fn)) byFn.set(fn, []);
      for (const [fn, obs] of byFn) {
        const flags = obs.map((o) => flagFor(lang, o)).filter((f): f is Flag => !!f);
        const base = { scenarioId: `fuzz:${lang}:${comp.path}:${slugify(fn)}`, name: `Adversarial inputs: ${fn}`, category: 'fuzzing' as const, adapter: lang === 'node' ? 'javascript' : 'python', component: comp.id, target: comp.path };
        if (!flags.length) { const r = mkResult({ ...base, outcome: 'passed', reason: `${obs.length} bounded call(s), nothing crashed, hung or hit a boundary error` }); results.push(r); continue; }
        // reproduce: re-run only this function; same kind of problem must recur
        const second = await runHarness(ctx, lang, targets, [fn]);
        const kinds2 = new Set(second.obs.map((o) => flagFor(lang, o)?.kind).filter(Boolean));
        const rank: Kind[] = ['crash', 'hang', 'resource', 'boundary-error'];
        const worst = rank.map((k) => flags.find((f) => f.kind === k)).find(Boolean)!;
        const reproduced = flags.some((f) => kinds2.has(f.kind));
        const hard = flags.some((f) => f.hard && kinds2.has(f.kind));
        const { status, confidence } = statusFrom(reproduced, true, hard);
        const examples = flags.slice(0, 6).map((f) => `${f.obs.desc} → ${f.obs.outcome === 'threw' ? `${f.obs.name}: ${f.obs.message}` : f.obs.outcome}${f.obs.message && f.obs.outcome !== 'threw' ? ` (${f.obs.message})` : ''}`);
        const f = mkFinding({
          id: nextId(), title: `${worst.kind === 'boundary-error' ? 'Edge-case error' : worst.kind === 'resource' ? 'Resource exhaustion' : worst.kind === 'hang' ? 'Hang' : 'Crash'} on adversarial input: ${fn}`, category: 'fuzzing', adapter: base.adapter, component: comp.id, route: comp.path,
          status, severity: KIND_SEVERITY[worst.kind], confidence, failureType: KIND_FAILURE[worst.kind], evidenceKind: 'observed-defect', scenarioId: base.scenarioId,
          expected: 'The function handles empty, huge, Unicode and boundary inputs without crashing, hanging, exhausting resources, or leaking internal errors.',
          actual: `${flags.length} problem call(s). Examples: ${examples.slice(0, 3).join(' | ')}`,
          steps: [`Import ${fn.split(':')[0]} in the project and call ${fn.split(':').pop()} with: ${[...new Set(flags.map((x) => x.obs.desc))].slice(0, 4).join('; ')}`, `FThisUp ran this in ${first.sandboxed ? 'a sandbox (read-only filesystem, no network)' : 'an UNSANDBOXED process'}: ${first.command}`],
          attempts: 2, reproduced, scope: `function ${fn}`, fix: `${FIX[worst.kind]}${suggestion(lang, fn)}`,
          evidence: { logs: examples, commands: [first.command], notes: [`Only well-typed boundary values count as findings; throwing on type-confused input (None/null, wrong types) is not reported.`] },
        });
        findings.push(f);
        results.push(mkResult({ ...base, outcome: 'failed', reason: examples[0], findingId: f.id }));
      }
      results.forEach((r) => exec.onProgress?.(r));
      return { results, findings, notes };
    },
  };
}
