import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import type { FThisUpConfig } from './config.js';
import { BrowserMissingError, SafetyEnforcementError, TargetBlockedError, TargetUnreachableError } from './errors.js';
import { buildFinding, summarize } from './findings.js';
import type { Finding, RunResults, TestResult } from './types.js';
import { discoverProject } from '../discovery/project.js';
import { discoverLive } from '../discovery/live.js';
import type { LiveDiscovery, Manifest, ProjectDiscovery } from '../discovery/types.js';
import { analyzeStatic } from '../analysis/static.js';
import { executeScenario, type ExecEnv, type TestAccount } from '../engines/playwright/executor.js';
import { evaluateTarget, SafetyGuard, type TargetDecision } from '../safety/policy.js';
import { foreignPortChecker } from '../safety/scope.js';
import { redactDeep } from '../safety/redact.js';
import { generateScenarios } from '../scenarios/generate.js';
import type { Scenario } from '../scenarios/schema.js';
import { MAX_SCENARIO_FILE_BYTES, validateScenarios, type Rejected } from '../scenarios/validate.js';
import { VERSION } from '../utils/version.js';

export interface Progress { index: number; total: number; result: TestResult }
export interface RunOptions {
  cwd: string;
  config: FThisUpConfig;
  url: string;
  scenariosFile?: string;
  dryRun?: boolean;
  skipStatic?: boolean;
  onStage?: (stage: string) => void;
  onProgress?: (p: Progress) => void;
}

export async function probeUrl(url: string, timeoutMs = 5000): Promise<{ ok: boolean; detail: string }> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const r = await fetch(url, { signal: ctl.signal, redirect: 'manual' });
    clearTimeout(t);
    return { ok: true, detail: `HTTP ${r.status}` };
  } catch (e) {
    const cause = (e as { cause?: { code?: string } }).cause;
    return { ok: false, detail: cause?.code ?? (e as Error).message };
  }
}

export async function launchBrowser(config: FThisUpConfig): Promise<Browser> {
  if (!config.browserChannel) {
    let exe = '';
    try { exe = chromium.executablePath(); } catch { /* ignore */ }
    if (!exe || !fs.existsSync(exe)) {
      throw new BrowserMissingError('Playwright Chromium is not installed. Run: npx playwright install chromium');
    }
  }
  try {
    return await chromium.launch({ headless: config.headless, channel: config.browserChannel });
  } catch (e) {
    const msg = (e as Error).message;
    if (/Host system is missing dependencies|error while loading shared libraries/i.test(msg)) {
      throw new BrowserMissingError('Chromium cannot start because system libraries are missing. On Linux run: npx playwright install-deps chromium');
    }
    throw new BrowserMissingError(`Could not launch the browser: ${msg.split('\n')[0]}`);
  }
}

export interface Plan {
  decision: TargetDecision;
  project: ProjectDiscovery;
  live: LiveDiscovery;
  scenarios: Scenario[];
  rejected: Rejected[];
  droppedByCap: number;
  staticFindings: Finding[];
}

export async function plan(opts: RunOptions, browser: Browser, decision: TargetDecision): Promise<Plan> {
  const { config } = opts;
  const guard = new SafetyGuard(decision, config, { isForeignPort: foreignPortChecker(opts.cwd) });
  opts.onStage?.('Discovering application...');
  const project = discoverProject(opts.cwd);
  const staticFindings = opts.skipStatic ? [] : analyzeStatic(opts.cwd).findings;
  const staticRoutes = project.routes.map((r) => r.value);
  const live = await discoverLive(browser, guard, {
    maxPages: config.maxPages, excludeRoutes: config.excludeRoutes, protectedRoutes: config.auth?.protectedRoutes,
    timeout: Math.min(config.timeout, 15000),
  });
  opts.onStage?.('Generating test scenarios...');
  let scenarios = generateScenarios({ live, staticRoutes, config });
  let rejected: Rejected[] = [];
  if (opts.scenariosFile) {
    let parsed: unknown;
    try {
      const f = path.resolve(opts.cwd, opts.scenariosFile);
      if (fs.statSync(f).size > MAX_SCENARIO_FILE_BYTES) throw new Error(`file exceeds ${MAX_SCENARIO_FILE_BYTES} bytes`);
      parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
    }
    catch (e) { throw new Error(`Cannot read scenarios file ${opts.scenariosFile}: ${(e as Error).message}`); }
    const v = validateScenarios(parsed, { forceOrigin: 'agent' });
    rejected = v.rejected;
    const have = new Set(scenarios.map((s) => s.id));
    scenarios = [...v.valid.filter((s) => !have.has(s.id)), ...scenarios];
  }
  const dropped = Math.max(0, scenarios.length - config.maxTests);
  return { decision, project, live, scenarios: scenarios.slice(0, config.maxTests), rejected, droppedByCap: dropped, staticFindings };
}

function readAccount(config: FThisUpConfig): TestAccount | undefined {
  if (!config.auth) return undefined;
  const username = process.env[config.auth.usernameEnv];
  const password = process.env[config.auth.passwordEnv];
  return username && password ? { username, password } : undefined;
}

function failingTypes(o: { expectations: { type: string; passed: boolean }[] }): Set<string> {
  return new Set(o.expectations.filter((e) => !e.passed).map((e) => e.type));
}

export async function runTests(opts: RunOptions): Promise<{ results: RunResults; manifest: Manifest; plan: Plan }> {
  const { config } = opts;
  const started = Date.now();
  const startedAt = new Date().toISOString();
  const decision = evaluateTarget(opts.url, config);
  if (!decision.allowed) throw new TargetBlockedError(decision);
  const probe = await probeUrl(opts.url);
  if (!probe.ok) throw new TargetUnreachableError(opts.url, probe.detail);

  const browser = await launchBrowser(config);
  try {
    const p = await plan(opts, browser, decision);
    const manifest: Manifest = {
      schemaVersion: 1, generatedAt: new Date().toISOString(), project: p.project, live: p.live, warnings: p.staticFindings,
      legend: { confirmed: 'Read directly from a manifest/config file or observed in the running app.', inferred: 'Derived from naming conventions or regex heuristics; may be wrong.' },
    };
    if (opts.dryRun) {
      return { results: emptyResults(opts, decision, browser, startedAt, started, p), manifest, plan: p };
    }

    const guard = new SafetyGuard(decision, config, { isForeignPort: foreignPortChecker(opts.cwd) });
    const account = readAccount(config);
    const env: ExecEnv = { browser, guard, config, account };
    const secrets = account ? [account.username, account.password] : [];
    const outDir = path.resolve(opts.cwd, config.output);
    fs.mkdirSync(path.join(outDir, 'screenshots'), { recursive: true });

    opts.onStage?.('Attempting to break things...');
    const results: TestResult[] = [];
    const findings: Finding[] = [];
    let seq = 0;

    for (const [i, s] of p.scenarios.entries()) {
      const base = { scenarioId: s.id, name: s.name, category: s.category, risk: s.risk, target: s.target, origin: s.origin, expectations: [] as TestResult['expectations'] };
      let result: TestResult;
      {
        let first;
        try { first = await executeScenario(s, env, { screenshot: true }); }
        catch (e) { throw new SafetyEnforcementError(`Aborting: safety boundaries could not be enforced (${(e as Error).message.split('\n')[0]})`); }
        if (first.violation) result = { ...base, outcome: 'blocked', durationMs: first.durationMs, reason: first.violation };
        else if (first.skipped) result = { ...base, outcome: 'skipped', durationMs: first.durationMs, reason: first.skipped };
        else {
          const failing = first.expectations.filter((e) => !e.passed);
          if (failing.length === 0) result = { ...base, outcome: 'passed', durationMs: first.durationMs, expectations: first.expectations };
          else {
            const noRepro = s.steps.some((st) => st.action === 'loginWithBadPassword');
            let attempts = 1;
            let reproducedTypes = new Set<string>();
            let totalMs = first.durationMs;
            if (!noRepro) {
              const second = await executeScenario(s, env, { screenshot: false });
              attempts = 2;
              totalMs += second.durationMs;
              if (!second.skipped && !second.violation) {
                const a = failingTypes(first);
                reproducedTypes = new Set([...failingTypes(second)].filter((t) => a.has(t)));
              }
            }
            let shot: string | undefined;
            if (first.screenshot) {
              shot = `screenshots/${s.id}.png`;
              fs.writeFileSync(path.join(outDir, shot), first.screenshot);
            }
            const reproduced = reproducedTypes.size > 0;
            const f = buildFinding({
              scenario: s, origin: decision.origin!, failing, evidence: first.evidence, screenshot: shot, attempts, reproduced,
              reproducedTypes, seq: ++seq,
              reproductionSkipped: noRepro ? 'Reproduction deliberately not attempted: repeating a failed login could lock the test account.' : undefined,
            });
            findings.push(f);
            result = { ...base, outcome: 'failed', durationMs: totalMs, expectations: first.expectations, findingId: f.id };
          }
        }
      }
      results.push(result);
      opts.onProgress?.({ index: i + 1, total: p.scenarios.length, result });
    }

    // static-analysis warnings: never counted as executed tests
    const allFindings = [...findings, ...p.staticFindings.map((f, i) => ({ ...f, id: `W${String(i + 1).padStart(3, '0')}` }))];
    const summary = summarize(results, allFindings);
    const formsDiscovered = p.live.pages.reduce((n, pg) => n + pg.forms.length, 0);
    const formsTested = new Set(
      results.filter((r) => r.scenarioId.startsWith('form-') && (r.outcome === 'passed' || r.outcome === 'failed'))
        .map((r) => r.scenarioId.match(/^form-(.+?)-(empty-submit|invalid-|long-text|special-chars|unicode|xss|duplicate)/)?.[1]).filter(Boolean),
    ).size;
    const notes: string[] = [];
    if (p.droppedByCap) notes.push(`${p.droppedByCap} generated scenario(s) were not run because of --max-tests ${config.maxTests}.`);
    if (p.live.truncated) notes.push(`Crawl stopped at ${config.maxPages} pages; more routes may exist.`);
    if (p.rejected.length) notes.push(`${p.rejected.length} supplied scenario(s) were rejected by validation and never executed.`);
    notes.push('Passing tests do not prove the application is bug-free; they only show these specific checks did not fail.');
    if (p.live.skippedRoutes.length) notes.push(`${p.live.skippedRoutes.length} route(s) were not visited (excluded or sensitive).`);

    const out: RunResults = {
      schemaVersion: 1, tool: 'fthisup', project: p.project.name, target: opts.url, mode: config.mode, startedAt, durationMs: Date.now() - started,
      environment: { fthisupVersion: VERSION, node: process.version, platform: `${process.platform} ${process.arch}`, browser: 'chromium', browserVersion: browser.version(), headless: config.headless },
      safety: { targetClass: decision.targetClass, environment: decision.environment, notes: [decision.reason, ...decision.notes] },
      summary, results, findings: allFindings,
      coverage: { routesDiscovered: p.live.pages.length, routesTested: results.filter((r) => r.category === 'navigation' && r.outcome !== 'blocked').length, formsDiscovered, formsTested, notes },
    };
    return { results: redactDeep(out, secrets), manifest, plan: p };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

function emptyResults(opts: RunOptions, d: TargetDecision, browser: Browser, startedAt: string, started: number, p: Plan): RunResults {
  return {
    schemaVersion: 1, tool: 'fthisup', project: p.project.name, target: opts.url, mode: opts.config.mode, startedAt, durationMs: Date.now() - started,
    environment: { fthisupVersion: VERSION, node: process.version, platform: `${process.platform} ${process.arch}`, browser: 'chromium', browserVersion: browser.version(), headless: opts.config.headless },
    safety: { targetClass: d.targetClass, environment: d.environment, notes: [d.reason, ...d.notes] },
    summary: summarize([], []), results: [], findings: [],
    coverage: { routesDiscovered: p.live.pages.length, routesTested: 0, formsDiscovered: 0, formsTested: 0, notes: ['Dry run: nothing was executed.'] },
  };
}
