import path from 'node:path';
import { ADAPTERS } from '../adapters/registry.js';
import { analyzeStatic } from '../analysis/static.js';
import { detectProjectManifest } from '../detect/manifest.js';
import { discoverProject } from '../discovery/project.js';
import { sandboxInfo } from '../exec/sandbox.js';
import { summarize } from './findings.js';
import { resolveTarget } from './target.js';
import { VERSION } from '../utils/version.js';
import { runDiscovery } from '../autonomous/pipeline.js';
export class UnknownAdapterError extends Error {
}
const TAG_COMPONENT = (m, file) => {
    const comps = [...m.components].sort((a, b) => b.path.length - a.path.length);
    return comps.find((c) => c.path === '.' || file === c.path || file.startsWith(`${c.path}/`))?.id;
};
export async function planRun(opts) {
    const { root, config } = opts;
    opts.onStage?.('Analyzing project...');
    const manifest = detectProjectManifest(root);
    const target = await resolveTarget(root, config, opts.explicitUrl);
    const ctx = { root, manifest, config, target, apiUrl: opts.apiUrl ?? config.api?.url ?? target.url };
    const options = {
        mode: config.mode, maxTests: config.maxTests, timeoutMs: config.timeout, explicit: false,
        scenariosFile: opts.scenariosFile, dryRun: opts.dryRun, skipStatic: opts.skipStatic, outDir: path.resolve(root, config.output),
    };
    const named = opts.adapters ?? [];
    for (const id of named)
        if (!ADAPTERS.some((a) => a.id === id))
            throw new UnknownAdapterError(`Unknown adapter "${id}". Available: ${ADAPTERS.map((a) => a.id).join(', ')}`);
    const selections = [];
    for (const adapter of ADAPTERS) {
        const explicit = named.includes(adapter.id);
        const cfgSwitch = config.adapters[adapter.id];
        const base = { adapter, explicit, components: [] };
        if (named.length && !explicit)
            continue;
        if (!explicit && cfgSwitch === false) {
            selections.push({ ...base, status: 'skipped', reason: 'disabled in configuration (adapters.' + adapter.id + ': false)' });
            continue;
        }
        if (!explicit && !config.autoDetect && cfgSwitch !== true)
            continue;
        const det = await adapter.detect(ctx);
        if (!det.applicable) {
            selections.push({ ...base, status: 'not-applicable', reason: det.reason, components: det.components });
            continue;
        }
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
    tail = Promise.resolve();
    run(fn) {
        const result = this.tail.then(fn, fn);
        this.tail = result.then(() => undefined, () => undefined);
        return result;
    }
}
export async function orchestrate(opts) {
    const started = Date.now();
    const startedAt = new Date().toISOString();
    const planned = await planRun(opts);
    const { ctx, options, selections } = planned;
    opts.onPlan?.(planned);
    const ready = selections.filter((s) => s.status === 'ran' && s.plan);
    const outcomes = new Map();
    const artifacts = {};
    const coverageErrors = [];
    if (!opts.dryRun) {
        const groups = new Map();
        const lock = (g) => groups.get(g) ?? groups.set(g, new Mutex()).get(g);
        const parallel = Math.max(1, opts.parallel ?? 2);
        const queue = ready.filter((s) => s.adapter.resourceGroup !== 'exclusive');
        const exclusive = ready.filter((s) => s.adapter.resourceGroup === 'exclusive');
        const runOne = async (s) => {
            const t0 = Date.now();
            try {
                const out = await s.adapter.execute(s.plan, { project: ctx, options: { ...options, explicit: s.explicit }, onProgress: (r) => opts.onProgress?.(s.adapter.id, r), onStage: opts.onStage });
                outcomes.set(s.adapter.id, { ...out, ms: Date.now() - t0 });
            }
            catch (e) {
                // v0.1 semantics: web errors for an explicit --url (blocked target / unreachable) abort the whole run
                if (s.adapter.id === 'web' && ctx.target.source === 'cli')
                    throw e;
                outcomes.set(s.adapter.id, { results: [], findings: [], notes: [], ms: Date.now() - t0, error: e.message });
            }
        };
        let next = 0;
        const worker = async () => {
            while (next < queue.length) {
                const s = queue[next++];
                await lock(s.adapter.resourceGroup).run(() => runOne(s));
            }
        };
        await Promise.all(Array.from({ length: Math.min(parallel, queue.length) }, worker));
        for (const s of exclusive)
            await runOne(s);
    }
    // ---- autonomous discovery (after the baseline so it never competes with it for CPU) --------------------
    let discovery;
    if (opts.discovery) {
        const baseline = [...new Set(selections.filter((x) => x.adapter.id === 'flutter').flatMap((x) => x.components))].map((cid) => {
            const rs = (outcomes.get('flutter')?.results ?? []).filter((r) => r.component === cid && r.category === 'unit-tests');
            return { component: cid, passed: rs.filter((r) => r.outcome === 'passed').length, failed: rs.filter((r) => r.outcome === 'failed').length };
        });
        try {
            discovery = await runDiscovery({ ctx, mode: ctx.config.mode, dryRun: opts.dryRun, outDir: options.outDir, adapters: opts.adapters, onStage: opts.onStage, baseline });
        }
        catch (e) {
            discovery = undefined;
            coverageErrors.push(`Autonomous discovery failed unexpectedly: ${e.message}`);
        }
    }
    // ---- aggregate -------------------------------------------------------------------------
    const allResults = [];
    const allFindings = [];
    const reports = [];
    const explicitProblems = [];
    const blocked = [];
    let seq = 0;
    const coverage = { routesDiscovered: 0, routesTested: 0, formsDiscovered: 0, formsTested: 0, notes: [] };
    let safety;
    let env = {};
    if (discovery) {
        const map = new Map();
        for (const f of discovery.findings) {
            const id = `F${String(++seq).padStart(3, '0')}`;
            map.set(f.id, id);
            allFindings.push({ ...f, id });
        }
        for (const r of discovery.results)
            allResults.push({ ...r, findingId: r.findingId ? map.get(r.findingId) ?? r.findingId : undefined });
        for (const rec of discovery.report.records)
            if (rec.findingId)
                rec.findingId = map.get(rec.findingId) ?? rec.findingId;
        for (const [k, v] of Object.entries(discovery.artifacts))
            artifacts[k] = v;
        coverage.notes.push(...discovery.notes, ...discovery.report.limitations.map((l) => `Discovery limit: ${l}`));
    }
    coverage.notes.push(...coverageErrors);
    for (const sel of selections) {
        const out = outcomes.get(sel.adapter.id);
        let status = sel.status;
        let reason = sel.reason;
        const notes = [...(sel.plan?.notes ?? [])];
        if (out) {
            const map = new Map();
            for (const f of out.findings) {
                const id = f.id.startsWith('W') ? f.id : `F${String(++seq).padStart(3, '0')}`;
                map.set(f.id, id);
                allFindings.push({ ...f, id, adapter: f.adapter ?? sel.adapter.id });
            }
            for (const r of out.results)
                allResults.push({ ...r, adapter: r.adapter ?? sel.adapter.id, findingId: r.findingId ? map.get(r.findingId) ?? r.findingId : undefined });
            notes.push(...out.notes);
            coverage.notes.push(...out.notes);
            if (out.coverage) {
                coverage.routesDiscovered += out.coverage.routesDiscovered ?? 0;
                coverage.routesTested += out.coverage.routesTested ?? 0;
                coverage.formsDiscovered += out.coverage.formsDiscovered ?? 0;
                coverage.formsTested += out.coverage.formsTested ?? 0;
            }
            if (out.safety && !safety)
                safety = out.safety;
            if (out.environment)
                env = { ...env, ...out.environment };
            for (const [k, v] of Object.entries(out.artifacts ?? {}))
                artifacts[k] = v;
            if (out.blocked) {
                status = 'blocked';
                reason = out.blocked;
                blocked.push({ id: sel.adapter.id, reason: out.blocked });
            }
            else if (out.error) {
                status = 'error';
                reason = out.error;
            }
            else if (out.results.length === 0 && !sel.plan?.tests.length) {
                status = 'ran';
            }
            if (out.error)
                notes.push(`Adapter error: ${out.error}`);
        }
        if (sel.explicit && ['unavailable', 'unsupported', 'not-applicable', 'error', 'blocked'].includes(status))
            explicitProblems.push({ id: sel.adapter.id, reason: reason ?? status });
        const rs = allResults.filter((r) => r.adapter === sel.adapter.id);
        if (status === 'ran' && opts.dryRun)
            status = 'ran';
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
    // where each check came from (existing project tests vs new generated tests vs built-in probes ...)
    for (const r of allResults) {
        if (r.kind)
            continue;
        r.kind = r.origin === 'agent' ? 'generated'
            : r.category === 'static-analysis' ? 'static'
                : r.category === 'unit-tests' || r.category === 'build' || r.category === 'startup' || r.category === 'project-validation' ? 'existing'
                    : ['api', 'cli', 'fuzzing'].includes(r.category) ? 'engine-adversarial' : 'runtime';
    }
    const components = ctx.manifest.components.map((c) => ({ id: c.id, path: c.path, kind: c.roles.join('+') || 'unknown', languages: c.languages, frameworks: c.frameworks, confidence: c.confidence }));
    const sb = sandboxInfo();
    coverage.notes.push('Passing tests do not prove the project is bug-free; they only show these specific checks did not fail.');
    const proj = discoverProject(ctx.root).name;
    const final = {
        schemaVersion: 1, tool: 'fthisup', project: proj, target: ctx.target.url ?? '(no network target)', mode: ctx.config.mode, startedAt, durationMs: Date.now() - started,
        environment: { fthisupVersion: VERSION, node: process.version, platform: `${process.platform} ${process.arch}`, browser: env.browser ?? 'n/a', browserVersion: env.browserVersion ?? '', headless: env.headless ?? true },
        safety: safety ?? { targetClass: ctx.target.url ? 'unknown' : 'none', environment: 'local', notes: ['No network target was tested.'] },
        summary: summarize(allResults, allFindings),
        results: allResults, findings: allFindings,
        coverage: { ...coverage, notes: [...new Set([...coverage.notes, ...(options.dryRun ? ['Dry run: nothing was executed.'] : [])])] },
        adapters: reports, components, ...(discovery ? { discovery: discovery.report } : {}),
        sandbox: { kind: sb.kind ?? 'none', note: sb.available ? 'bubblewrap: read-only filesystem, scratch dir writable, no network, for processes that run project code with hostile input.' : `No OS sandbox (${sb.reason}); process isolation is limited to allow-listed executables, sanitized environment, scratch working directory, timeouts and output caps.` },
    };
    return { results: final, planned, artifacts, explicitProblems, blocked, testFiles: discovery?.testFiles ?? {} };
}
