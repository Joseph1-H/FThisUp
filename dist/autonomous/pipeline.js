import fs from 'node:fs';
import path from 'node:path';
import { mkFinding } from '../adapters/common.js';
import { which } from '../exec/tools.js';
import { VERSION } from '../utils/version.js';
import { classifyFailure, judge } from './classify.js';
import { humanSteps } from './flutter/codegen.js';
import { createWorkspace, destroyWorkspace, flutterPubGet, parseGenerated, runGeneratedTests, treeHash, writeScenarioTests } from './flutter/execute.js';
import { buildFlutterMap } from './flutter/map.js';
import { flutterScenarioFileSchema } from './flutter/schema.js';
import { seedScenarios } from './flutter/seed.js';
import { validateFlutterScenarios } from './flutter/validate.js';
import { emptyCounts } from './types.js';
const isFlutterApp = (root, c) => {
    try {
        return /^\s*flutter:\s*$/m.test(fs.readFileSync(path.join(root, c.path, 'pubspec.yaml'), 'utf8')) && /sdk:\s*flutter/.test(fs.readFileSync(path.join(root, c.path, 'pubspec.yaml'), 'utf8'));
    }
    catch {
        return false;
    }
};
/** What autonomous discovery can and cannot do for each detected component. Never claims more than is implemented. */
export function supportMatrix(ctx) {
    const out = [];
    for (const c of ctx.manifest.components) {
        if (c.ecosystem === 'flutter') {
            if (isFlutterApp(ctx.root, c))
                out.push({ adapter: 'flutter', component: c.id, implemented: true, supported: !!which('flutter'), reason: which('flutter') ? 'app map + typed widget-test generation + isolated execution + reproduction' : 'Flutter SDK not found on PATH (install Flutter; FThisUp never installs SDKs)' });
            else
                out.push({ adapter: 'flutter', component: c.id, implemented: false, supported: false, reason: 'plain Dart package (no Flutter widgets): autonomous widget test generation is not implemented for it; existing tests and the analyzer still run' });
        }
        else if (c.roles.includes('web-app') || c.frameworks.some((f) => /react|next|vue|svelte|angular/i.test(f))) {
            out.push({ adapter: 'web', component: c.id, implemented: false, supported: false, reason: 'no engine-side app map or seeding yet; the agent can supply typed browser scenarios with --scenarios and they run in a real browser, tagged as generated' });
        }
        else if (c.roles.includes('api')) {
            out.push({ adapter: 'api', component: c.id, implemented: false, supported: false, reason: 'schema-aware probes are built in (OpenAPI); agent-written typed API scenarios run via --scenarios, tagged as generated; no engine-side state-transition generation yet' });
        }
        else if (c.roles.includes('cli')) {
            out.push({ adapter: 'cli', component: c.id, implemented: false, supported: false, reason: 'agent-written typed CLI scenarios run via --scenarios (sandboxed), tagged as generated; no engine-side generation yet' });
        }
        else if (['python', 'node'].includes(c.ecosystem)) {
            out.push({ adapter: c.ecosystem === 'python' ? 'python' : 'javascript', component: c.id, implemented: false, supported: false, reason: 'bounded function fuzzing exists (engine-generated edge values); agent-generated property/boundary tests are not implemented' });
        }
        else {
            out.push({ adapter: c.ecosystem, component: c.id, implemented: false, supported: false, reason: 'existing tests and analyzers only; autonomous test generation is not implemented for this ecosystem' });
        }
    }
    return out;
}
export function buildMaps(ctx) {
    return ctx.manifest.components.filter((c) => c.ecosystem === 'flutter' && isFlutterApp(ctx.root, c)).map((c) => buildFlutterMap(ctx.root, c.path, VERSION));
}
export function loadAgentFiles(ctx) {
    const dir = path.resolve(ctx.root, ctx.config.discovery.scenariosDir);
    const errors = [];
    const files = [];
    const flutter = [];
    if (!(dir === ctx.root || dir.startsWith(ctx.root + path.sep)))
        return { files, flutter, errors: [`discovery.scenariosDir ${ctx.config.discovery.scenariosDir} is outside the project`] };
    if (!fs.existsSync(dir))
        return { files, flutter, errors };
    for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort().slice(0, 20)) {
        const f = path.join(dir, name);
        let raw;
        try {
            if (fs.statSync(f).size > 2_000_000) {
                errors.push(`${name}: larger than 2 MB, ignored`);
                continue;
            }
            raw = JSON.parse(fs.readFileSync(f, 'utf8'));
        }
        catch (e) {
            errors.push(`${name}: not valid JSON (${e.message})`);
            continue;
        }
        if (!raw || typeof raw !== 'object' || raw.adapter !== 'flutter')
            continue; // other adapters' files
        files.push(name);
        const p = flutterScenarioFileSchema.safeParse(raw);
        if (!p.success) {
            errors.push(`${name}: ${p.error.issues.slice(0, 4).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
            continue;
        }
        flutter.push({ file: name, component: p.data.component, scenarios: p.data.scenarios });
    }
    return { files, flutter, errors };
}
const rank = { high: 0, medium: 1, low: 2 };
const scale = (n, mode) => (mode === 'thorough' ? Math.min(300, n * 3) : n);
export async function runDiscovery(opts) {
    const started = Date.now();
    const { ctx } = opts;
    const cfg = ctx.config.discovery;
    const budget = { maxScenarios: scale(cfg.maxScenarios, opts.mode), maxExecuted: scale(cfg.maxExecuted, opts.mode), reproAttempts: cfg.reproAttempts, testTimeoutSeconds: cfg.testTimeoutSeconds, mode: opts.mode };
    const counts = emptyCounts();
    const records = [];
    const results = [];
    const findings = [];
    const artifacts = {};
    const notes = [];
    const testFiles = {};
    const limitations = [];
    const support = supportMatrix(ctx);
    const appMaps = [];
    const networkAttempts = new Set();
    const agent = loadAgentFiles(ctx);
    for (const e of agent.errors)
        limitations.push(`scenario file problem: ${e}`);
    let isolation;
    const named = opts.adapters ?? [];
    const flutterComps = ctx.manifest.components.filter((c) => c.ecosystem === 'flutter' && isFlutterApp(ctx.root, c));
    const finish = () => ({
        report: { requested: true, support, counts, records, appMap: appMaps, existingTests: opts.baseline, budget, isolation, limitations, durationMs: Date.now() - started, agentScenarioFiles: agent.files },
        results, findings, artifacts, notes, testFiles,
    });
    if (!flutterComps.length) {
        limitations.push(support.some((s) => s.implemented) ? 'No Flutter application found.' : 'Autonomous scenario generation is implemented for Flutter apps only; no Flutter application was detected in this project. Existing tests and built-in adversarial probes still ran; see "support" for each component.');
        if (agent.files.length)
            limitations.push(`Agent scenario file(s) ${agent.files.join(', ')} target Flutter but this project has no Flutter app.`);
        return finish();
    }
    if (named.length && !named.includes('flutter')) {
        limitations.push('Flutter discovery skipped: --adapter did not include "flutter".');
        return finish();
    }
    if (!which('flutter')) {
        limitations.push('Flutter SDK was not found on PATH, so generated Flutter tests cannot run. Install Flutter and re-run; FThisUp never installs SDKs.');
        return finish();
    }
    let seq = 0;
    for (const comp of flutterComps) {
        opts.onStage?.(`Discovering ${comp.path === '.' ? 'Flutter app' : comp.path} (building application map)...`);
        const compDir = path.resolve(ctx.root, comp.path);
        const map = buildFlutterMap(ctx.root, comp.path, VERSION);
        artifacts[flutterComps.length === 1 ? 'app-map.json' : `app-map-${comp.path.replace(/[^\w]+/g, '-')}.json`] = map;
        appMaps.push({ adapter: 'flutter', component: comp.id, summary: { ...map.totals, package: map.package, integrations: map.integrations.join(', ') || 'none' } });
        for (const l of map.limitations)
            limitations.push(`${comp.id}: ${l}`);
        if (map.supabase.used)
            limitations.push(`${comp.id}: Supabase is used. Generated tests run with the network blocked and no credentials, so they can never reach a Supabase project; code paths that need a live backend are reported as environment limits.`);
        if (map.supabase.hardCodedEndpoints.length)
            limitations.push(`${comp.id}: source contains hard-coded Supabase endpoint(s) (${map.supabase.hardCodedEndpoints.slice(0, 2).join(', ')}); FThisUp never contacts them.`);
        if (map.runtime.integrationTestDir || map.runtime.integrationTestDependency)
            limitations.push(`${comp.id}: the project has integration_test support, but FThisUp does not start emulators or devices; on-device runtime interaction tests were NOT run.`);
        else
            limitations.push(`${comp.id}: runtime UI testing on an emulator/simulator is not available (no integration_test setup) and FThisUp never launches devices; widget-level tests only.`);
        // ---- gather -------------------------------------------------------------------------------
        const mine = agent.flutter.filter((f) => !f.component || path.resolve(ctx.root, f.component) === compDir || (f.component === '.' && comp.path === '.'));
        if (agent.flutter.some((f) => !f.component) && flutterComps.length > 1)
            limitations.push('Several Flutter components exist: set "component" in the scenario file so scenarios are not applied to the wrong app.');
        const rawAgent = mine.flatMap((f) => f.scenarios);
        const vAgent = validateFlutterScenarios(rawAgent, map, ctx.root, 'agent');
        const seeded = cfg.seed ? seedScenarios(map, 60) : { scenarios: [], skipped: [] };
        const vSeed = validateFlutterScenarios(seeded.scenarios, map, ctx.root, 'engine-heuristic');
        const agentIds = new Set(vAgent.valid.map((v) => v.scenario.id));
        const validAll = [...vAgent.valid, ...vSeed.valid.filter((v) => !agentIds.has(v.scenario.id))];
        counts.generated += rawAgent.length + seeded.scenarios.length;
        counts.rejected += vAgent.rejected.length + vSeed.rejected.length;
        const mkRec = (id, name, status, reason, sc, v, method) => ({
            id, name, adapter: 'flutter', component: comp.id, feature: sc?.feature ?? '(unknown)', risk: sc?.risk ?? '(unknown)',
            expectation: { statement: sc?.expectation.statement ?? '', basis: sc?.expectation.basis ?? 'assumption', effectiveBasis: v?.effectiveBasis ?? sc?.expectation.basis ?? 'assumption', referenceVerified: v?.referenceVerified, reference: v?.referenceText },
            method: method ?? v?.method ?? 'agent', status, reason, executed: false,
        });
        for (const r of vAgent.rejected)
            records.push(mkRec(r.id ?? `agent-scenario-${r.index + 1}`, r.id ?? `agent scenario #${r.index + 1}`, 'rejected', `failed validation: ${r.errors.join('; ')}`, undefined, undefined, 'agent'));
        for (const r of vSeed.rejected)
            records.push(mkRec(r.id ?? `seed-${r.index + 1}`, r.id ?? `seed #${r.index + 1}`, 'rejected', `failed validation: ${r.errors.join('; ')}`, undefined, undefined, 'engine-heuristic'));
        for (const s of [...vAgent.skipped, ...vSeed.skipped]) {
            counts.skipped++;
            counts.validated++;
            records.push(mkRec(s.id, s.name, 'skipped', s.reason, s.scenario));
        }
        for (const s of seeded.skipped)
            limitations.push(`${comp.id}: no engine-seeded scenarios for ${s.screen}: ${s.reason}`);
        // ---- budget -------------------------------------------------------------------------------
        counts.validated += validAll.length;
        validAll.sort((a, b) => (a.method === b.method ? 0 : a.method === 'agent' ? -1 : 1) || rank[a.scenario.priority] - rank[b.scenario.priority]);
        const considered = validAll.slice(0, budget.maxScenarios);
        const selected = considered.slice(0, budget.maxExecuted);
        for (const v of validAll.filter((x) => !selected.includes(x))) {
            counts.skipped++;
            records.push({ ...mkRec(v.scenario.id, v.scenario.name, 'skipped', considered.includes(v) ? `over the execution budget (maxExecuted=${budget.maxExecuted}); lower-priority scenario` : `over the scenario budget (maxScenarios=${budget.maxScenarios})`, v.scenario, v), });
        }
        if (opts.dryRun) {
            for (const v of selected) {
                counts.skipped++;
                records.push(mkRec(v.scenario.id, v.scenario.name, 'skipped', 'dry run: validated and ready, not executed', v.scenario, v));
            }
            limitations.push('Dry run: nothing was executed.');
            continue;
        }
        if (!selected.length) {
            limitations.push(`${comp.id}: no executable scenario (${rawAgent.length ? 'all supplied scenarios were rejected or skipped' : 'no agent scenarios supplied and no pumpable screen with inputs/actions to seed from'}).`);
            continue;
        }
        // ---- isolated execution ------------------------------------------------------------------------
        opts.onStage?.(`Generating ${selected.length} Flutter widget test(s) in an isolated copy...`);
        const before = treeHash(compDir, () => true);
        const ws = createWorkspace(compDir);
        const classFiles = Object.fromEntries(map.screens.map((s) => [s.class, s.file.replace(/^lib\//, '')]));
        const pubspec = fs.readFileSync(path.join(compDir, 'pubspec.yaml'), 'utf8');
        const written = writeScenarioTests(ws, selected.map((v) => v.scenario), { pkg: map.package, classFiles, usesSharedPreferences: /^\s*shared_preferences\s*:/m.test(pubspec) });
        for (const w of written)
            testFiles[`generated-tests/${comp.path === '.' ? '' : `${comp.path.replace(/[^\w]+/g, '-')}-`}${w.file}`] = w.source;
        const testPathFor = (id) => `generated-tests/${comp.path === '.' ? '' : `${comp.path.replace(/[^\w]+/g, '-')}-`}${id}_test.dart`;
        const verdicts = new Map();
        const repro = new Map();
        const durations = new Map();
        const totalMs = cfg.totalTimeoutSeconds * 1000;
        const deadline = Date.now() + totalMs;
        let envFailure;
        try {
            opts.onStage?.('Resolving packages offline in the isolated copy...');
            const pg = await flutterPubGet(ws, 180_000);
            if (pg.spawnError || pg.exitCode !== 0)
                envFailure = `could not resolve packages in the isolated copy (flutter pub get --offline): ${(pg.stderr || pg.stdout || pg.spawnError || '').trim().split('\n').slice(-3).join(' | ')}. Dependencies must already be in the local pub cache; FThisUp never downloads packages.`;
            else {
                opts.onStage?.('Executing generated Flutter tests...');
                const run1 = await runGeneratedTests(ws, written.map((w) => w.file), budget.testTimeoutSeconds, Math.max(30_000, deadline - Date.now()));
                if (run1.spawnError)
                    envFailure = run1.spawnError;
                const parsed = parseGenerated(run1.stdout, written.map((w) => w.id));
                const perTest = run1.durationMs / Math.max(1, written.length);
                for (const w of written) {
                    const raw = parsed.get(w.id);
                    if (raw?.payload?.network?.length)
                        raw.payload.network.forEach((h) => networkAttempts.add(h));
                    verdicts.set(w.id, judge(raw, run1.timedOut));
                    durations.set(w.id, Math.round(perTest));
                }
                // reproduction: re-run only the failing tests, in fresh processes, N more times
                const failing = () => written.filter((w) => verdicts.get(w.id)?.kind === 'fail');
                for (let a = 0; a < budget.reproAttempts && failing().length && Date.now() < deadline; a++) {
                    opts.onStage?.(`Reproducing ${failing().length} failure(s) (attempt ${a + 1}/${budget.reproAttempts})...`);
                    const rerun = await runGeneratedTests(ws, failing().map((w) => w.file), budget.testTimeoutSeconds, Math.max(30_000, deadline - Date.now()));
                    const p2 = parseGenerated(rerun.stdout, written.map((w) => w.id));
                    for (const w of failing()) {
                        const first = verdicts.get(w.id);
                        const again = judge(p2.get(w.id), rerun.timedOut);
                        const r = repro.get(w.id) ?? { attempts: 0, reproduced: 0 };
                        r.attempts++;
                        if (again.kind === 'fail' && again.sig === first.sig)
                            r.reproduced++;
                        repro.set(w.id, r);
                    }
                }
            }
        }
        finally {
            const cleaned = destroyWorkspace(ws);
            const after = treeHash(compDir, () => true);
            isolation = {
                workspace: 'temporary copy of the project (lib, assets, pubspec; platform folders and your test/ excluded), deleted after the run',
                sourceModified: before !== after, networkBlocked: true, networkAttempts: [...networkAttempts],
                sandbox: 'isolated temporary copy + typed (non-code) scenario input + generated tests run with dart:io HTTP blocked; no OS sandbox: the Flutter SDK needs a writable cache, so your own app code runs with the normal permissions of this user (as your own tests do)',
                cleanedUp: cleaned, files: written.map((w) => w.file),
            };
            if (before !== after)
                limitations.push('WARNING: the project files changed during the run. FThisUp never writes to your project, so something else modified it; results may be unreliable.');
        }
        // ---- build records / results / findings ------------------------------------------------------------
        for (const v of selected) {
            const sc = v.scenario;
            const id = sc.id;
            const verdict = verdicts.get(id);
            const base = mkRec(id, sc.name, 'passed', undefined, sc, v);
            const tf = testPathFor(id);
            let status = 'passed';
            let reason;
            let finding;
            let confidence;
            let observed = [];
            let fileRefs = [];
            const rp = repro.get(id);
            if (envFailure || !verdict) {
                status = 'environment';
                reason = envFailure ?? 'no result';
            }
            else if (verdict.kind === 'invalid') {
                status = 'invalid';
                reason = verdict.reason;
            }
            else if (verdict.kind === 'environment') {
                status = 'environment';
                reason = verdict.reason;
            }
            else if (verdict.kind === 'fail') {
                observed = verdict.items.slice(0, 8);
                fileRefs = [...new Set(verdict.payload?.observed.flatMap((o) => o.stack).map((l) => new RegExp(`package:${map.package}/([^\\s:]+):(\\d+)`).exec(l)).filter((m) => !!m).map((m) => `lib/${m[1]}:${m[2]}`) ?? [])].slice(0, 4).map((s) => ({ file: s.split(':')[0], line: Number(s.split(':')[1]) }));
                const attempts = rp?.attempts ?? 0, got = rp?.reproduced ?? 0;
                const allReproduced = attempts > 0 && got === attempts;
                const supported = v.effectiveBasis !== 'assumption';
                if (got === 0 && attempts > 0) {
                    status = 'not-reproducible';
                    reason = `failed once, did not fail in ${attempts} independent re-run(s); treated as flaky, not as a bug`;
                    confidence = 'low';
                }
                else if (attempts === 0) {
                    status = 'suspected';
                    reason = 'failed but could not be re-run within the time budget';
                    confidence = 'low';
                }
                else if (!allReproduced) {
                    status = 'suspected';
                    reason = `inconsistent: reproduced ${got}/${attempts} re-runs`;
                    confidence = 'low';
                }
                else if (!verdict.hard) {
                    status = 'suspected';
                    reason = 'reproduced, but the failure came from the test framework rather than an observed assertion/exception record';
                    confidence = 'medium';
                }
                else if (!supported) {
                    status = 'suspected';
                    reason = `reproduced ${got}/${attempts}, but the expected behaviour is only an assumption (${v.notes.join('; ') || 'no verified requirement'})`;
                    confidence = 'medium';
                }
                else {
                    status = 'confirmed';
                    reason = `reproduced ${got}/${attempts} independent re-runs; expectation supported by ${v.effectiveBasis}${v.referenceText ? ` (${v.referenceText}, verified)` : ''}`;
                    confidence = 'high';
                }
                const cls = classifyFailure(observed, `${sc.feature} ${sc.risk} ${sc.name}`);
                finding = mkFinding({
                    id: `G${String(++seq).padStart(3, '0')}`, title: `${sc.name}: ${observed[0]?.replace(/^\[[^\]]*\]\s*/, '').slice(0, 110) ?? 'generated test failed'}`, category: 'autonomous-discovery', adapter: 'flutter', component: comp.id, route: sc.screen.widget,
                    status: status === 'confirmed' ? 'confirmed' : status === 'not-reproducible' ? 'not-reproducible' : 'suspected', severity: cls.severity, confidence: confidence ?? 'low', failureType: cls.failureType,
                    evidenceKind: 'observed-defect', expected: sc.expectation.statement, actual: observed.join(' || ').slice(0, 900),
                    steps: [`Pump ${sc.screen.widget}${Object.keys(sc.screen.args).length ? ` with ${JSON.stringify(sc.screen.args)}` : ''} in a ${sc.screen.viewport.width}x${sc.screen.viewport.height} viewport`, ...humanSteps(sc.steps), ...sc.assertions.map((a, i) => `Check ${i + 1}: ${a.kind} ${a.target.by} "${a.target.value}"`), `To re-run: copy ${tf} into your project's test/ folder and run \`flutter test\` on it (FThisUp ran it in an isolated copy)`],
                    attempts: 1 + attempts, reproduced: got === attempts && attempts > 0, scope: `flutter generated widget test: ${sc.screen.widget}`, scenarioId: id,
                    fix: `${cls.failureType === 'layout-defect' ? 'Make the overflowing widget flexible (Expanded/Flexible/ellipsis or a scrollable) so long content cannot overflow.' : cls.failureType === 'invalid-state-transition' ? 'Guard async work: disable the trigger while pending, check `mounted` before setState/navigation after an await, cancel timers in dispose().' : cls.failureType === 'input-validation' ? 'Validate this input before accepting it (see the documented requirement referenced in the evidence).' : 'Inspect the stack trace in the evidence and handle the failing case.'}${sc.hypothesis ? ` Agent hypothesis (UNVERIFIED): ${sc.hypothesis}` : ''}`,
                    evidence: { logs: observed, commands: [`flutter test --reporter json test/fthisup_generated/${id}_test.dart  (isolated copy)`], notes: [`basis: ${v.effectiveBasis}${v.referenceVerified ? ` (reference verified: ${v.referenceText})` : ''}`, `generation: ${v.method}`, ...v.notes, `reproduction: ${got}/${attempts} independent re-runs failed the same way`, ...(fileRefs.length ? [`stack frames in project code: ${fileRefs.map((f) => `${f.file}:${f.line}`).join(', ')}`] : []), 'no mocks were used; the network was blocked'] },
                });
                if (fileRefs[0]) {
                    finding.file = fileRefs[0].file;
                    finding.line = fileRefs[0].line;
                }
                else if (v.referenceVerified && sc.expectation.reference) {
                    finding.file = sc.expectation.reference.file;
                    finding.line = sc.expectation.reference.line;
                }
                finding.discovery = { scenarioId: id, method: v.method, basis: v.effectiveBasis, feature: sc.feature, testFile: tf };
                findings.push(finding);
            }
            const rec = { ...base, status, reason, executed: true, confidence: status === 'passed' ? 'high' : confidence, reproduction: rp, evidence: { observed, files: fileRefs, testFile: tf, durationMs: durations.get(id) }, findingId: finding?.id };
            if (status === 'passed')
                rec.reason = undefined;
            records.push(rec);
            counts.executed += 1;
            if (status === 'passed')
                counts.passed++;
            else if (status === 'confirmed')
                counts.confirmed++;
            else if (status === 'suspected')
                counts.suspected++;
            else if (status === 'not-reproducible')
                counts.notReproducible++;
            else if (status === 'invalid')
                counts.invalid++;
            else if (status === 'environment')
                counts.environment++;
        }
    }
    // ---- results (executed = passed/failed only; everything else is skipped with the reason) -----------------
    for (const r of records) {
        const outcome = r.status === 'passed' ? 'passed' : ['confirmed', 'suspected', 'not-reproducible'].includes(r.status) ? 'failed' : 'skipped';
        const label = r.status === 'invalid' ? 'INVALID generated test' : r.status === 'environment' ? 'environment limit' : r.status === 'rejected' ? 'rejected scenario' : '';
        results.push({
            scenarioId: `flutter:generated:${r.id}`, name: `Generated: ${r.name}`, category: 'autonomous-discovery', risk: 'medium', target: r.component, outcome, durationMs: r.evidence?.durationMs ?? 0,
            reason: outcome === 'skipped' ? `${label ? `${label}: ` : ''}${r.reason ?? ''}` : r.reason, expectations: [], findingId: r.findingId, origin: r.method === 'agent' ? 'agent' : 'heuristic',
            adapter: 'flutter', component: r.component, kind: 'generated', generatedId: r.id,
        });
    }
    notes.push(`Autonomous discovery: ${counts.generated} scenario(s) generated, ${counts.validated} validated, ${counts.executed} executed, ${counts.confirmed} confirmed new bug(s), ${counts.suspected} suspected.`);
    return finish();
}
