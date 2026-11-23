import path from 'node:path';
import { ADAPTERS } from '../adapters/registry.js';
import type { AdapterOutcome, ProjectContext, TestAdapter, TestOptions, TestPlan } from '../adapters/types.js';
import { analyzeStatic } from '../analysis/static.js';
import { detectProjectManifest, type ProjectManifest } from '../detect/manifest.js';
import { discoverProject } from '../discovery/project.js';
import { sandboxInfo } from '../exec/sandbox.js';
import type { FThisUpConfig } from './config.js';
import { summarize } from './findings.js';
import { resolveTarget } from './target.js';
import type { AdapterReport, AdapterStatus, ComponentInfo, Finding, RunResults, TestResult } from './types.js';
import { VERSION } from '../utils/version.js';

export interface OrchestratorOptions {
  root: string;
  config: FThisUpConfig;
  explicitUrl?: string;
  apiUrl?: string;
  /** adapters named with --adapter (empty = automatic selection) */
  adapters?: string[];
  all?: boolean;
  scenariosFile?: string;
  dryRun?: boolean;
  skipStatic?: boolean;
  /** concurrency across adapters (default 2) */
  parallel?: number;
  onStage?: (s: string) => void;
  onProgress?: (adapterId: string, r: TestResult) => void;
  /** called once, after planning and before any execution */
  onPlan?: (p: PlannedRun) => void;
}

export interface Selection {
  adapter: TestAdapter;
  explicit: boolean;
  status: AdapterStatus;
  reason?: string;
  components: string[];
  plan?: TestPlan;
}

export class UnknownAdapterError extends Error {}

export interface PlannedRun {
  ctx: ProjectContext;
  options: TestOptions;
  selections: Selection[];
}

const TAG_COMPONENT = (m: ProjectManifest, file: string) => {
  const comps = [...m.components].sort((a, b) => b.path.length - a.path.length);
  return comps.find((c) => c.path === '.' || file === c.path || file.startsWith(`${c.path}/`))?.id;
};

export async function planRun(opts: OrchestratorOptions): Promise<PlannedRun> {
  const { root, config } = opts;
  opts.onStage?.('Analyzing project...');
  const manifest = detectProjectManifest(root);
  const target = await resolveTarget(root, config, opts.explicitUrl);
  const ctx: ProjectContext = { root, manifest, config, target, apiUrl: opts.apiUrl ?? config.api?.url ?? target.url };
  const options: TestOptions = {
    mode: config.mode, maxTests: config.maxTests, timeoutMs: config.timeout, explicit: false,
    scenariosFile: opts.scenariosFile, dryRun: opts.dryRun, skipStatic: opts.skipStatic, outDir: path.resolve(root, config.output),
  };
  const named = opts.adapters ?? [];
  for (const id of named) if (!ADAPTERS.some((a) => a.id === id)) throw new UnknownAdapterError(`Unknown adapter "${id}". Available: ${ADAPTERS.map((a) => a.id).join(', ')}`);

  const selections: Selection[] = [];
  for (const adapter of ADAPTERS) {
    const explicit = named.includes(adapter.id);
    const cfgSwitch = config.adapters[adapter.id as keyof typeof config.adapters];
    const base = { adapter, explicit, components: [] as string[] };
    if (named.length && !explicit) continue;
    if (!explicit && cfgSwitch === false) { selections.push({ ...base, status: 'skipped', reason: 'disabled in configuration (adapters.' + adapter.id + ': false)' }); continue; }
    if (!explicit && !config.autoDetect && cfgSwitch !== true) continue;
    const det = await adapter.detect(ctx);
    if (!det.applicable) { selections.push({ ...base, status: 'not-applicable', reason: det.reason, components: det.components }); continue; }
    if (adapter.optIn && !explicit && cfgSwitch !== true && !opts.all) {
      selections.push({ ...base, status: 'skipped', reason: `opt-in adapter: it builds/launches your software. Enable with --adapter ${adapter.id}, --all, or adapters.${adapter.id}: true`, components: det.components });
      continue;
    }
    opts.onStage?.(`Planning ${adapter.name}...`);
    const plan = await adapter.plan(ctx, { ...options, explicit });
    selections.push({ ...base, status: plan.status === 'ready' ? 'ran' : plan.status, reason: plan.reason, components: plan.components.length ? plan.components : det.components, plan });
  }
  return { ctx, options, selections };
}

class Mutex {
  private tail: Promise<void> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

export interface OrchestrationResult {
  results: RunResults;
  planned: PlannedRun;
  artifacts: Record<string, unknown>;
  /** an explicitly requested adapter could not run (exit code 4) */
  explicitProblems: Array<{ id: string; reason: string }>;
  blocked: Array<{ id: string; reason: string }>;
}

export async function orchestrate(opts: OrchestratorOptions): Promise<OrchestrationResult> {
  const started = Date.now();
  const startedAt = new Date().toISOString();
  const planned = await planRun(opts);
  const { ctx, options, selections } = planned;
  opts.onPlan?.(planned);
  const ready = selections.filter((s) => s.status === 'ran' && s.plan);

  const outcomes = new Map<string, AdapterOutcome & { ms: number; error?: string }>();
  const artifacts: Record<string, unknown> = {};

  if (!opts.dryRun) {
    const groups = new Map<string, Mutex>();
    const lock = (g: string) => groups.get(g) ?? groups.set(g, new Mutex()).get(g)!;
    const parallel = Math.max(1, opts.parallel ?? 2);
    const queue = ready.filter((s) => s.adapter.resourceGroup !== 'exclusive');
    const exclusive = ready.filter((s) => s.adapter.resourceGroup === 'exclusive');
    const runOne = async (s: Selection) => {
      const t0 = Date.now();
      try {
        const out = await s.adapter.execute(s.plan!, { project: ctx, options: { ...options, explicit: s.explicit }, onProgress: (r) => opts.onProgress?.(s.adapter.id, r), onStage: opts.onStage });
        outcomes.set(s.adapter.id, { ...out, ms: Date.now() - t0 });
      } catch (e) {
        // v0.1 semantics: web errors for an explicit --url (blocked target / unreachable) abort the whole run
        if (s.adapter.id === 'web' && ctx.target.source === 'cli') throw e;
        outcomes.set(s.adapter.id, { results: [], findings: [], notes: [], ms: Date.now() - t0, error: (e as Error).message });
      }
    };
    let next = 0;
    const worker = async () => {
      while (next < queue.length) {
        const s = queue[next++]!;
        await lock(s.adapter.resourceGroup).run(() => runOne(s));
      }
    };
    await Promise.all(Array.from({ length: Math.min(parallel, queue.length) }, worker));
    for (const s of exclusive) await runOne(s);
  }

  // ---- aggregate -------------------------------------------------------------------------
  const allResults: TestResult[] = [];
  const allFindings: Finding[] = [];
  const reports: AdapterReport[] = [];
  const explicitProblems: Array<{ id: string; reason: string }> = [];
  const blocked: Array<{ id: string; reason: string }> = [];
  let seq = 0;
  const coverage = { routesDiscovered: 0, routesTested: 0, formsDiscovered: 0, formsTested: 0, notes: [] as string[] };
  let safety: RunResults['safety'] | undefined;
  let env: { browser?: string; browserVersion?: string; headless?: boolean } = {};

  for (const sel of selections) {
    const out = outcomes.get(sel.adapter.id);
    let status: AdapterStatus = sel.status;
    let reason = sel.reason;
    const notes: string[] = [...(sel.plan?.notes ?? [])];
    if (out) {
      const map = new Map<string, string>();
      for (const f of out.findings) {
        const id = f.id.startsWith('W') ? f.id : `F${String(++seq).padStart(3, '0')}`;
        map.set(f.id, id);
        allFindings.push({ ...f, id, adapter: f.adapter ?? sel.adapter.id });
      }
      for (const r of out.results) allResults.push({ ...r, adapter: r.adapter ?? sel.adapter.id, findingId: r.findingId ? map.get(r.findingId) ?? r.findingId : undefined });
      notes.push(...out.notes);
      coverage.notes.push(...out.notes);
      if (out.coverage) {
        coverage.routesDiscovered += out.coverage.routesDiscovered ?? 0; coverage.routesTested += out.coverage.routesTested ?? 0;
        coverage.formsDiscovered += out.coverage.formsDiscovered ?? 0; coverage.formsTested += out.coverage.formsTested ?? 0;
      }
      if (out.safety && !safety) safety = out.safety;
      if (out.environment) env = { ...env, ...out.environment };
      for (const [k, v] of Object.entries(out.artifacts ?? {})) artifacts[k] = v;
      if (out.blocked) { status = 'blocked'; reason = out.blocked; blocked.push({ id: sel.adapter.id, reason: out.blocked }); }
      else if (out.error) { status = 'error'; reason = out.error; }
      else if (out.results.length === 0 && !sel.plan?.tests.length) { status = 'ran'; }
      if (out.error) notes.push(`Adapter error: ${out.error}`);
    }
    if (sel.explicit && ['unavailable', 'unsupported', 'not-applicable', 'error', 'blocked'].includes(status)) explicitProblems.push({ id: sel.adapter.id, reason: reason ?? status });
    const rs = allResults.filter((r) => r.adapter === sel.adapter.id);
    if (status === 'ran' && opts.dryRun) status = 'ran';
    reports.push({
      id: sel.adapter.id, name: sel.adapter.name, status, reason, components: sel.components,
      capabilities: sel.plan?.capabilities ?? [], missing: sel.plan?.missing ?? [],
      executed: rs.filter((r) => r.outcome === 'passed' || r.outcome === 'failed').length,
      passed: rs.filter((r) => r.outcome === 'passed').length, failed: rs.filter((r) => r.outcome === 'failed').length,
      skipped: rs.filter((r) => r.outcome === 'skipped').length, blocked: rs.filter((r) => r.outcome === 'blocked').length,
      durationMs: out?.ms ?? 0, notes,
    });
  }

  // ---- static analysis warnings (project-wide, heuristic, never counted as executed tests) -------
  if (!opts.skipStatic && !opts.dryRun) {
    const { findings } = analyzeStatic(ctx.root);
    findings.forEach((f, i) => allFindings.push({
      ...f, id: `W${String(i + 1).padStart(3, '0')}`, adapter: 'static-analysis', component: TAG_COMPONENT(ctx.manifest, f.file ?? ''),
      failureType: 'incomplete-functionality', evidenceKind: 'static-heuristic', scope: `source ${f.file ?? ''}${f.line ? `:${f.line}` : ''}`,
    }));
  }

  const components: ComponentInfo[] = ctx.manifest.components.map((c) => ({ id: c.id, path: c.path, kind: c.roles.join('+') || 'unknown', languages: c.languages, frameworks: c.frameworks, confidence: c.confidence }));
  const sb = sandboxInfo();
  coverage.notes.push('Passing tests do not prove the project is bug-free; they only show these specific checks did not fail.');
  const proj = discoverProject(ctx.root).name;
  const final: RunResults = {
    schemaVersion: 1, tool: 'fthisup', project: proj, target: ctx.target.url ?? '(no network target)', mode: ctx.config.mode, startedAt, durationMs: Date.now() - started,
    environment: { fthisupVersion: VERSION, node: process.version, platform: `${process.platform} ${process.arch}`, browser: env.browser ?? 'n/a', browserVersion: env.browserVersion ?? '', headless: env.headless ?? true },
    safety: safety ?? { targetClass: ctx.target.url ? 'unknown' : 'none', environment: 'local', notes: ['No network target was tested.'] },
    summary: summarize(allResults, allFindings),
    results: allResults, findings: allFindings,
    coverage: { ...coverage, notes: [...new Set([...coverage.notes, ...(options.dryRun ? ['Dry run: nothing was executed.'] : [])])] },
    adapters: reports, components,
    sandbox: { kind: sb.kind ?? 'none', note: sb.available ? 'bubblewrap: read-only filesystem, scratch dir writable, no network, for processes that run project code with hostile input.' : `No OS sandbox (${sb.reason}); process isolation is limited to allow-listed executables, sanitized environment, scratch working directory, timeouts and output caps.` },
  };
  return { results: final, planned, artifacts, explicitProblems, blocked };
}
