import fs from 'node:fs';
import path from 'node:path';
import type { Capability, Finding, TestResult } from '../core/types.js';
import { cleanupScratch, newScratch, runProcess } from '../exec/run.js';
import { which } from '../exec/tools.js';
import { mkFinding, mkResult, tail } from './common.js';
import { findStackTrace } from './cli.js';
import type { AdapterOutcome, DetectionResult, PlannedTest, TestAdapter, TestPlan } from './types.js';

const GODOT_BINS = ['godot4', 'godot', 'godot-headless'];
const godotBin = () => GODOT_BINS.find((b) => which(b));

export interface GodotIssue { kind: 'missing-main-scene' | 'missing-autoload' | 'missing-resource' | 'missing-script' | 'no-main-scene'; message: string; file: string }

const resPath = (dir: string, p: string) => path.join(dir, p.replace(/^res:\/\//, ''));

/** Real, static checks of a Godot project: everything the project references must exist. Verifiable without the engine. */
export function validateGodotProject(dir: string): { issues: GodotIssue[]; scenes: number; scripts: number } {
  const issues: GodotIssue[] = [];
  const text = fs.readFileSync(path.join(dir, 'project.godot'), 'utf8');
  const main = /run\/main_scene="([^"]+)"/.exec(text)?.[1];
  if (!main) issues.push({ kind: 'no-main-scene', message: 'project.godot defines no run/main_scene, so the project cannot start from the editor or export.', file: 'project.godot' });
  else if (!fs.existsSync(resPath(dir, main))) issues.push({ kind: 'missing-main-scene', message: `run/main_scene points to ${main}, which does not exist.`, file: 'project.godot' });
  const auto = /\[autoload\]([\s\S]*?)(?=\n\[|$)/.exec(text)?.[1] ?? '';
  for (const m of auto.matchAll(/^(\w+)="\*?(res:\/\/[^"]+)"/gm)) if (!fs.existsSync(resPath(dir, m[2]!))) issues.push({ kind: 'missing-autoload', message: `Autoload "${m[1]}" points to ${m[2]}, which does not exist.`, file: 'project.godot' });
  let scenes = 0, scripts = 0;
  const walk = (d: string, depth: number) => {
    if (depth > 8) return;
    let ents: fs.Dirent[] = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name.startsWith('.') || e.name === 'addons') continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) { walk(full, depth + 1); continue; }
      const rel = path.relative(dir, full).split(path.sep).join('/');
      if (/\.(tscn|tres)$/.test(e.name)) {
        scenes++;
        for (const m of fs.readFileSync(full, 'utf8').matchAll(/\[ext_resource[^\]]*path="(res:\/\/[^"]+)"/g)) if (!fs.existsSync(resPath(dir, m[1]!))) issues.push({ kind: /\.gd"?$/.test(m[1]!) ? 'missing-script' : 'missing-resource', message: `${rel} references ${m[1]}, which does not exist.`, file: rel });
      } else if (e.name.endsWith('.gd')) {
        scripts++;
        for (const m of fs.readFileSync(full, 'utf8').matchAll(/\b(?:preload|load)\(\s*"(res:\/\/[^"]+)"\s*\)/g)) if (!fs.existsSync(resPath(dir, m[1]!))) issues.push({ kind: 'missing-resource', message: `${rel} loads ${m[1]}, which does not exist.`, file: rel });
      }
    }
  };
  walk(dir, 0);
  return { issues, scenes, scripts };
}

export const godotAdapter: TestAdapter = {
  id: 'godot',
  name: 'Godot project (static validation, headless import/startup when the engine is installed)',
  description: 'Verifies that every resource a Godot project references exists, and, when a Godot binary is available, imports and starts the project headless and watches for script errors and crashes. No automatic gameplay testing.',
  requirements: ['project.godot', 'a Godot 4 binary on PATH (godot4/godot) for headless import/startup (optional; static checks always run)'],
  categories: ['project-validation', 'startup'],
  safety: ['static checks only read project files', 'engine runs headless with a time limit, HOME redirected to a scratch dir, secrets stripped', 'no gameplay automation, no editor GUI'],
  resourceGroup: 'cpu',

  async detect(ctx): Promise<DetectionResult> {
    const cs = ctx.manifest.components.filter((c) => c.ecosystem === 'godot');
    return { applicable: cs.length > 0, confidence: 'high', components: cs.map((c) => c.id), reason: cs.length ? `${cs.length} Godot project(s)` : 'no project.godot found' };
  },

  async capabilities(ctx): Promise<Capability[]> {
    const bin = godotBin();
    const caps: Capability[] = [{ id: 'static', label: 'static project validation', available: true, reason: 'reads project.godot, scenes and scripts' }];
    caps.push({ id: 'engine', label: 'headless import + startup (Godot binary)', available: !!bin, reason: bin ? `${bin} on PATH` : 'no godot/godot4 binary on PATH', setup: 'install Godot 4 and make `godot` available on PATH (https://godotengine.org/download)' });
    const withTests = ctx.manifest.components.filter((c) => c.ecosystem === 'godot' && c.testFrameworks.length);
    if (withTests.length) caps.push({ id: 'tests', label: `existing ${withTests[0]!.testFrameworks.join('/')} tests`, available: !!bin, reason: bin ? 'will be run via the Godot binary' : 'needs the Godot binary', setup: 'install Godot 4' });
    return caps;
  },

  async plan(ctx): Promise<TestPlan> {
    const caps = await this.capabilities(ctx);
    const cs = ctx.manifest.components.filter((c) => c.ecosystem === 'godot');
    const tests: PlannedTest[] = [];
    for (const c of cs) {
      tests.push({ id: `godot:validate:${c.path}`, name: `Validate project resources (${c.path})`, category: 'project-validation', component: c.id, risk: 'low' });
      if (godotBin()) tests.push({ id: `godot:startup:${c.path}`, name: `Headless import and startup (${c.path})`, category: 'startup', component: c.id, risk: 'low' });
    }
    return { adapterId: 'godot', status: 'ready', missing: caps.filter((c) => !c.available).map((c) => ({ what: `${c.label}: ${c.reason}`, setup: c.setup })), capabilities: caps, components: cs.map((c) => c.id), tests, notes: ['Gameplay is not tested automatically: that needs a game-specific harness.'] };
  },

  async execute(plan, exec): Promise<AdapterOutcome> {
    const ctx = exec.project;
    const results: TestResult[] = []; const findings: Finding[] = []; const notes: string[] = [];
    let n = 0; const nextId = () => `G${++n}`;
    for (const c of ctx.manifest.components.filter((x) => plan.components.includes(x.id))) {
      const dir = path.resolve(ctx.root, c.path);
      const v = validateGodotProject(dir);
      const base = { scenarioId: `godot:validate:${c.path}`, name: `Validate project resources (${c.path})`, category: 'project-validation' as const, adapter: 'godot', component: c.id, target: c.path };
      if (!v.issues.length) { const r = mkResult({ ...base, outcome: 'passed', reason: `${v.scenes} scene/resource file(s) and ${v.scripts} script(s) checked` }); results.push(r); exec.onProgress?.(r); }
      else {
        const crit = v.issues.some((i) => i.kind === 'missing-main-scene' || i.kind === 'missing-autoload' || i.kind === 'no-main-scene');
        const f = mkFinding({ id: nextId(), title: `Godot project references ${v.issues.length} missing file(s)`, category: 'project-validation', adapter: 'godot', component: c.id, route: c.path, status: 'confirmed', severity: crit ? 'high' : 'medium', confidence: 'high',
          failureType: crit ? 'build-failure' : 'dependency-failure', evidenceKind: 'observed-defect', expected: 'Every scene, script and resource the project references exists.', actual: v.issues.slice(0, 5).map((i) => i.message).join(' '),
          steps: [`Open ${path.posix.join(c.path, 'project.godot')} and the files named in the evidence`, 'Check each referenced res:// path on disk'], attempts: 1, reproduced: true, scope: `godot project ${c.path}`, fix: 'Restore or re-point the missing files (check for renamed/moved/ignored-by-git assets), or remove the stale references.',
          evidence: { logs: v.issues.slice(0, 15).map((i) => `${i.file}: ${i.message}`), notes: ['Deterministic static check (file existence); not re-run.'] } });
        findings.push(f); const r = mkResult({ ...base, outcome: 'failed', reason: f.actual, findingId: f.id }); results.push(r); exec.onProgress?.(r);
      }
      const bin = godotBin();
      if (!bin) { results.push(mkResult({ scenarioId: `godot:startup:${c.path}`, name: `Headless import and startup (${c.path})`, category: 'startup', outcome: 'skipped', reason: 'no Godot binary on PATH (install Godot 4 to enable this check)', adapter: 'godot', component: c.id, target: c.path })); continue; }
      // ---- engine checks (written against Godot 4's documented CLI; not verified in every environment) ----
      const scratch = newScratch(ctx.root);
      try {
        exec.onStage?.(`Godot headless import/startup (${c.path})...`);
        const out = await runProcess({ file: bin, args: ['--headless', '--path', dir, '--quit-after', '120'], cwd: dir, projectRoot: ctx.root, timeoutMs: 120_000, scratch, limits: true });
        const text = `${out.stdout}\n${out.stderr}`;
        const errLines = text.split('\n').filter((l) => /^(SCRIPT ERROR|ERROR|Parse Error)/i.test(l.trim()));
        const bad = out.timedOut || (out.exitCode ?? 0) !== 0 || errLines.length > 0 || !!findStackTrace(text);
        const sb = { scenarioId: `godot:startup:${c.path}`, name: `Headless import and startup (${c.path})`, category: 'startup' as const, adapter: 'godot', component: c.id, target: c.path, durationMs: out.durationMs };
        if (out.spawnError) results.push(mkResult({ ...sb, outcome: 'skipped', reason: out.spawnError }));
        else if (!bad) results.push(mkResult({ ...sb, outcome: 'passed' }));
        else {
          const f = mkFinding({ id: nextId(), title: out.timedOut ? 'Godot project hangs on headless startup' : errLines.length ? `Godot reports ${errLines.length} script/engine error(s) on startup` : `Godot exits with code ${out.exitCode}`, category: 'startup', adapter: 'godot', component: c.id, route: c.path,
            status: 'suspected', severity: 'medium', confidence: 'medium', failureType: out.timedOut ? 'hang' : 'unhandled-exception', evidenceKind: 'observed-defect', expected: 'The project imports and runs its main scene headless without errors.', actual: (errLines[0] ?? `exit code ${out.exitCode ?? out.signal}`).slice(0, 300),
            steps: [out.command], attempts: 1, reproduced: false, scope: `godot startup ${c.path}`, fix: 'Open the project in the editor and fix the reported script/parse errors.', evidence: { logs: [tail(text, 40)], commands: [out.command], notes: ['Not re-run; the headless engine output is heuristic (marked suspected).'] } });
          findings.push(f); results.push(mkResult({ ...sb, outcome: 'failed', reason: f.actual, findingId: f.id }));
        }
      } finally { cleanupScratch(scratch); }
    }
    return { results, findings, notes };
  },
};
