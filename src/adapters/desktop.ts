import fs from 'node:fs';
import path from 'node:path';
import type { Capability, Finding, TestResult } from '../core/types.js';
import type { Component } from '../detect/manifest.js';
import { cleanupScratch, newScratch, runProcess, type RunOutcome } from '../exec/run.js';
import { which } from '../exec/tools.js';
import { didCrash, findStackTrace } from './cli.js';
import { mkFinding, mkResult, statusFrom, tail } from './common.js';
import * as P from './parsers.js';
import type { AdapterOutcome, DetectionResult, ProjectContext, TestAdapter, TestPlan, PlannedTest } from './types.js';

interface Step { build?: string[]; run?: string[]; source: string; component: string }

/** Where do we get a build/run command from? Config first; otherwise a few well-known, conservative conventions. */
export function desktopSteps(ctx: ProjectContext): Step[] {
  const cfg = ctx.config.desktop;
  const out: Step[] = [];
  if (cfg?.build || cfg?.run) out.push({ build: cfg.build, run: cfg.run, source: 'fthisup.config.json desktop', component: ctx.manifest.components[0]?.id ?? 'root' });
  else {
    for (const c of ctx.manifest.components) {
      const dir = path.resolve(ctx.root, c.path);
      if (c.ecosystem === 'rust' && c.roles.includes('cli')) {
        const name = /^name\s*=\s*"([^"]+)"/m.exec(fs.readFileSync(path.join(dir, 'Cargo.toml'), 'utf8'))?.[1];
        if (name) out.push({ build: ['cargo', 'build'], run: [path.join(dir, 'target', 'debug', name)], source: 'Cargo binary', component: c.id });
      } else if (c.ecosystem === 'node' && c.frameworks.includes('electron')) {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
        out.push({ build: pkg.scripts?.build ? ['npm', 'run', 'build'] : undefined, run: ['npx', '--no-install', 'electron', '.'], source: 'Electron project', component: c.id });
      } else if (c.ecosystem === 'flutter' && c.roles.includes('desktop-app')) {
        const plat = process.platform === 'linux' ? 'linux' : process.platform === 'darwin' ? 'macos' : 'windows';
        if (c.notes.some((n) => n.includes(plat))) out.push({ build: ['flutter', 'build', plat, '--debug'], source: `Flutter ${plat} desktop (build only; no launcher path is assumed)`, component: c.id });
      }
    }
  }
  return out;
}

function displayWrap(ctx: ProjectContext, run: string[]): { file: string; args: string[]; note: string } | { error: string } {
  const mode = ctx.config.desktop?.display ?? 'auto';
  const hasDisplay = process.platform !== 'linux' || !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
  if (mode === 'none') return { file: run[0]!, args: run.slice(1), note: 'no display handling (desktop.display = "none")' };
  const xvfb = which('xvfb-run');
  if (process.platform === 'linux' && (mode === 'xvfb' || (mode === 'auto' && xvfb))) {
    if (!xvfb) return { error: 'desktop.display is "xvfb" but xvfb-run is not installed (sudo apt install xvfb)' };
    return { file: 'xvfb-run', args: ['-a', ...run], note: 'virtual display (xvfb-run): no window appears on your screen' };
  }
  if (!hasDisplay) return { error: 'no display available ($DISPLAY/$WAYLAND_DISPLAY unset) and xvfb-run is not installed (sudo apt install xvfb)' };
  return { file: run[0]!, args: run.slice(1), note: 'using your real display: the app window will appear on screen' };
}

export const desktopAdapter: TestAdapter = {
  id: 'desktop',
  name: 'Desktop application (build, startup, crash and log checks)',
  description: 'Builds your desktop app, launches it, checks it stays alive and shuts down cleanly, and inspects its logs. No GUI automation.',
  requirements: ['a build/run command (auto-detected for Cargo and Electron, or "desktop" in fthisup.config.json)', 'a display or xvfb-run for GUI apps'],
  categories: ['build', 'startup'],
  safety: ['opt-in: it builds and launches YOUR software (enable with --adapter desktop, --all, or adapters.desktop: true)', 'allow-listed build tools only; run commands must be inside the project or allow-listed', 'HOME is redirected to a scratch directory; secrets stripped from the environment', 'time-boxed; process group killed on exit', 'NOT sandboxed (GUI apps need display/GPU access)'],
  optIn: true,
  resourceGroup: 'exclusive',

  async detect(ctx): Promise<DetectionResult> {
    const steps = desktopSteps(ctx);
    const comps = ctx.manifest.components.filter((c) => c.roles.includes('desktop-app'));
    return { applicable: steps.length > 0 || comps.length > 0, confidence: steps.length ? 'high' : 'low', components: [...new Set([...steps.map((s) => s.component), ...comps.map((c) => c.id)])], reason: steps.length ? `${steps.length} build/run step(s) from ${steps[0]!.source}` : 'a desktop component was detected but no build/run command is known; set "desktop" in fthisup.config.json' };
  },

  async capabilities(ctx): Promise<Capability[]> {
    const steps = desktopSteps(ctx);
    const caps: Capability[] = [];
    for (const s of steps) {
      if (s.build) caps.push({ id: `build:${s.component}`, label: `build: ${s.build.join(' ')}`, available: !!which(s.build[0]!) || path.isAbsolute(s.build[0]!), reason: which(s.build[0]!) ? undefined : `${s.build[0]} not found`, setup: `install ${s.build[0]}` });
      if (s.run) {
        const w = displayWrap(ctx, s.run);
        caps.push({ id: `run:${s.component}`, label: `launch: ${s.run.map((a) => path.basename(a)).join(' ')}`, available: !('error' in w), reason: 'error' in w ? w.error : w.note, setup: 'error' in w ? 'sudo apt install xvfb   (or set desktop.display: "none" for non-GUI programs)' : undefined });
      }
    }
    if (!steps.length) caps.push({ id: 'steps', label: 'build/run command', available: false, reason: 'none configured or detected', setup: 'add "desktop": {"build": ["cargo","build"], "run": ["target/debug/myapp"]} to fthisup.config.json' });
    return caps;
  },

  async plan(ctx): Promise<TestPlan> {
    const caps = await this.capabilities(ctx);
    const steps = desktopSteps(ctx);
    const tests: PlannedTest[] = [];
    for (const s of steps) {
      if (s.build) tests.push({ id: `desktop:build:${s.component}`, name: `Build verification: ${s.build.join(' ')}`, category: 'build', component: s.component, risk: 'low' });
      if (s.run) tests.push({ id: `desktop:startup:${s.component}`, name: `Startup, liveness, shutdown and log inspection`, category: 'startup', component: s.component, risk: 'low' });
    }
    const missing = caps.filter((c) => !c.available).map((c) => ({ what: `${c.label}: ${c.reason}`, setup: c.setup }));
    const usable = tests.length > 0 && caps.some((c) => c.available);
    return { adapterId: 'desktop', status: usable ? 'ready' : 'unavailable', reason: usable ? undefined : missing.map((m) => m.what).join('; ') || 'nothing to run', missing, capabilities: caps, components: [...new Set(steps.map((s) => s.component))], tests, notes: ['Native GUI automation is not implemented: only build, startup, liveness, shutdown and log checks run.'], state: { steps } };
  },

  async execute(plan, exec): Promise<AdapterOutcome> {
    const ctx = exec.project;
    const steps = (plan.state as { steps: Step[] }).steps;
    const results: TestResult[] = []; const findings: Finding[] = []; const notes: string[] = [];
    let n = 0; const nextId = () => `D${++n}`;
    const startup = ctx.config.desktop?.startupSeconds ?? 8;
    for (const s of steps) {
      const comp = ctx.manifest.components.find((c) => c.id === s.component) as Component | undefined;
      const cwd = path.resolve(ctx.root, comp?.path ?? '.');
      let built = true;
      if (s.build) {
        exec.onStage?.(`Building: ${s.build.join(' ')}...`);
        const scratch = newScratch(ctx.root);
        try {
          const out = await runProcess({ file: s.build[0]!, args: s.build.slice(1), cwd, projectRoot: ctx.root, timeoutMs: 600_000, limits: true, scratch, env: { HOME: process.env.HOME ?? scratch } });
          const text = `${out.stdout}\n${out.stderr}`;
          const base = { scenarioId: `desktop:build:${s.component}`, name: `Build: ${s.build.join(' ')}`, category: 'build' as const, adapter: 'desktop', component: s.component, target: comp?.path ?? '.', durationMs: out.durationMs };
          if (out.spawnError) { results.push(mkResult({ ...base, outcome: 'skipped', reason: out.spawnError })); built = false; }
          else if (out.exitCode === 0 && !out.timedOut) results.push(mkResult({ ...base, outcome: 'passed' }));
          else {
            built = false;
            const kind = out.timedOut ? 'hang' : P.classifyBuildFailure(text) ?? 'build-failure';
            // reproduce with one more build (bounded: slow builds are not repeated)
            let attempts = 1, reproduced = false;
            if (out.durationMs < 60_000) {
              const again = await runProcess({ file: s.build[0]!, args: s.build.slice(1), cwd, projectRoot: ctx.root, timeoutMs: 120_000, limits: true, scratch, env: { HOME: process.env.HOME ?? scratch } });
              attempts = 2; reproduced = again.exitCode !== 0 || again.timedOut;
            }
            const { status, confidence } = statusFrom(reproduced, attempts > 1, true);
            const f = mkFinding({ id: nextId(), title: `Build fails: ${s.build.join(' ')}`, category: 'build', adapter: 'desktop', component: s.component, route: comp?.path ?? '.', status, severity: 'high', confidence,
              failureType: kind === 'hang' ? 'hang' : kind === 'dependency-failure' ? 'dependency-failure' : 'build-failure', evidenceKind: 'observed-defect', expected: 'The project builds from a clean checkout.', actual: out.timedOut ? 'The build did not finish within 10 minutes.' : `The build command exited with code ${out.exitCode ?? out.signal}.`,
              steps: [`cd ${comp?.path ?? '.'}`, out.command], attempts, reproduced, scope: `build ${s.build.join(' ')}`, fix: 'Fix the errors in the build log (compile/syntax errors or missing dependencies) so the app can be built and launched.', evidence: { logs: [tail(text, 40)], commands: [out.command], notes: attempts > 1 ? [] : ['Build was not re-run (it took over a minute).'] } });
            findings.push(f); results.push(mkResult({ ...base, outcome: 'failed', reason: f.actual, findingId: f.id }));
          }
        } finally { cleanupScratch(scratch); }
      }
      if (!s.run) continue;
      const base = { scenarioId: `desktop:startup:${s.component}`, name: `Startup and shutdown: ${s.run.map((a) => path.basename(a)).join(' ')}`, category: 'startup' as const, adapter: 'desktop', component: s.component, target: comp?.path ?? '.' };
      if (!built) { results.push(mkResult({ ...base, outcome: 'skipped', reason: 'the build step did not succeed' })); continue; }
      const w = displayWrap(ctx, s.run);
      if ('error' in w) { results.push(mkResult({ ...base, outcome: 'skipped', reason: w.error })); continue; }
      exec.onStage?.(`Launching ${path.basename(s.run[0]!)}...`);
      const attempt = async (): Promise<{ out: RunOutcome; early: boolean }> => {
        const scratch = newScratch(ctx.root);
        try {
          // phase 1: let it run for the startup window; phase 2 is the graceful stop (SIGTERM)
          const out = await runProcess({ file: w.file, args: w.args, cwd, projectRoot: ctx.root, timeoutMs: (startup + 6) * 1000, signalAfterMs: { ms: startup * 1000, signal: 'SIGTERM' }, keepStdinOpen: true, scratch, limits: true });
          return { out, early: out.durationMs < startup * 1000 - 400 };
        } finally { cleanupScratch(scratch); }
      };
      const first = await attempt();
      if (first.out.spawnError) { results.push(mkResult({ ...base, outcome: 'skipped', reason: first.out.spawnError })); continue; }
      const text = `${first.out.stdout}\n${first.out.stderr}`;
      const problems: Array<{ type: string; msg: string; ft: 'crash' | 'unhandled-exception' | 'hang' | 'dependency-failure'; hard: boolean }> = [];
      if (first.early && (first.out.exitCode ?? 0) !== 0) problems.push({ type: 'startup', msg: `The app terminated ${(first.out.durationMs / 1000).toFixed(1)}s after launch with ${first.out.signal ? `signal ${first.out.signal}` : `exit code ${first.out.exitCode}`}, before the ${startup}s startup window ended.`, ft: didCrash(first.out) ? 'crash' : 'unhandled-exception', hard: true });
      else if (first.early) problems.push({ type: 'exited-early', msg: `The app exited cleanly after only ${(first.out.durationMs / 1000).toFixed(1)}s (a desktop app is expected to keep running).`, ft: 'incorrect-output' as never, hard: false });
      else if (first.out.timedOut) problems.push({ type: 'shutdown', msg: `The app did not exit within 6s of SIGTERM and had to be killed (unclean shutdown).`, ft: 'hang', hard: false });
      const trace = findStackTrace(text);
      if (trace && !problems.some((p) => p.type === 'startup')) problems.push({ type: 'log-trace', msg: `The logs contain ${trace} (unhandled exception printed by the app).`, ft: 'unhandled-exception', hard: true });
      if (/error while loading shared libraries|cannot open display|Failed to load module|dlopen/i.test(text)) problems.push({ type: 'dependency', msg: 'The logs show a missing system library or display problem.', ft: 'dependency-failure', hard: false });
      if (!problems.length) { const r = mkResult({ ...base, outcome: 'passed', durationMs: first.out.durationMs, reason: `stayed up for ${startup}s and shut down on SIGTERM (${w.note})` }); results.push(r); exec.onProgress?.(r); continue; }
      const second = await attempt();
      const t2 = `${second.out.stdout}\n${second.out.stderr}`;
      const again = new Set<string>();
      if (second.early && (second.out.exitCode ?? 0) !== 0) again.add('startup'); if (second.early && (second.out.exitCode ?? 0) === 0) again.add('exited-early'); if (second.out.timedOut) again.add('shutdown'); if (findStackTrace(t2)) again.add('log-trace'); if (/error while loading shared libraries|cannot open display/i.test(t2)) again.add('dependency');
      const reproducedTypes = problems.filter((p) => again.has(p.type));
      const { status, confidence } = statusFrom(reproducedTypes.length > 0, true, reproducedTypes.some((p) => p.hard));
      const worst = problems.find((p) => p.hard) ?? problems[0]!;
      const f = mkFinding({ id: nextId(), title: worst.type === 'startup' ? 'App crashes during startup' : worst.type === 'exited-early' ? 'App exits immediately after launch' : worst.type === 'shutdown' ? 'App does not shut down on SIGTERM' : worst.type === 'dependency' ? 'App cannot find a system dependency' : 'Unhandled exception in app logs',
        category: 'startup', adapter: 'desktop', component: s.component, route: comp?.path ?? '.', status, severity: worst.hard ? 'high' : 'medium', confidence, failureType: worst.ft, evidenceKind: 'observed-defect',
        expected: `The app starts, stays alive for ${startup}s, logs no unhandled exceptions, and exits cleanly when asked to.`, actual: problems.map((p) => p.msg).join(' '),
        steps: [`cd ${comp?.path ?? '.'}`, `Launch: ${first.out.command}`, `Wait ${startup}s, then send SIGTERM`], attempts: 2, reproduced: reproducedTypes.length > 0, scope: `app ${s.run.map((a) => path.basename(a)).join(' ')}`,
        fix: 'Read the stack trace/log excerpt in the evidence and fix the failing initialization; install any missing system libraries; handle SIGTERM by closing resources and exiting.', evidence: { logs: [`exit=${first.out.exitCode ?? first.out.signal} after ${first.out.durationMs}ms (${w.note})`, tail(text, 40)], commands: [first.out.command] } });
      findings.push(f);
      const r = mkResult({ ...base, outcome: 'failed', reason: f.actual, findingId: f.id, durationMs: first.out.durationMs });
      results.push(r); exec.onProgress?.(r);
    }
    return { results, findings, notes };
  },
};
