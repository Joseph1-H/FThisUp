#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Command } from 'commander';
import { chromium } from 'playwright';
import { loadConfig, ConfigError, CONFIG_FILE, configSchema, type FThisUpConfig } from '../core/config.js';
import { BrowserMissingError, SafetyEnforcementError, TargetBlockedError, TargetUnreachableError } from '../core/errors.js';
import { launchBrowser, probeUrl } from '../core/runner.js';
import { orchestrate, UnknownAdapterError, type PlannedRun } from '../core/orchestrator.js';
import { detectProjectManifest } from '../detect/manifest.js';
import { startApp, type RunningApp } from '../core/app.js';
import { discoverProject } from '../discovery/project.js';
import { discoverLive } from '../discovery/live.js';
import { analyzeStatic } from '../analysis/static.js';
import { evaluateTarget, SafetyGuard } from '../safety/policy.js';
import { writeReport } from '../reporting/html.js';
import { readResults, writeJsonFile, writeManifest, writeResultsJson } from '../reporting/json.js';
import type { Manifest } from '../discovery/types.js';
import { detectLocalUrl } from '../utils/ports.js';
import { confine, findProjectRoot, ProjectScopeError } from '../utils/project-root.js';
import { checkTargetOwnership, foreignPortChecker } from '../safety/scope.js';
import { VERSION } from '../utils/version.js';
import { findInstalls, selfRoot, updateCheckout, REPO_URL } from './update.js';
import { BANNER, CATEGORY_LABEL, c, clearProgress, printBanner, progressLine, tag } from './ui.js';

const EXIT = { OK: 0, BUGS: 1, BLOCKED: 2, UNREACHABLE: 3, ENV: 4 } as const;

interface TestOpts {
  url?: string; mode?: string; headless?: boolean; maxTests?: string; timeout?: string; report?: string; output?: string;
  config?: string; scenarios?: string; adapter?: string[]; all?: boolean; apiUrl?: string; dryRun?: boolean; start?: boolean; static?: boolean; exitZero?: boolean; quiet?: boolean;
}

function applyOverrides(base: FThisUpConfig, o: TestOpts): FThisUpConfig {
  const next = { ...base };
  if (o.mode) next.mode = o.mode as FThisUpConfig['mode'];
  if (o.headless !== undefined) next.headless = o.headless;
  if (o.maxTests) next.maxTests = Number(o.maxTests);
  if (o.timeout) next.timeout = Number(o.timeout);
  if (o.report) next.report = o.report as FThisUpConfig['report'];
  if (o.output) next.output = o.output;
  if (o.url) next.url = o.url;
  const parsed = configSchema.safeParse(next);
  if (!parsed.success) {
    throw new ConfigError(`Invalid option value(s):\n${parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')}`);
  }
  return parsed.data;
}

function fail(code: number, ...lines: string[]): never {
  clearProgress();
  for (const l of lines) console.error(l);
  process.exit(code);
}

/** FThisUp only ever works on the project it is run in. */
function requireProject(): string {
  try { return findProjectRoot(process.cwd()); }
  catch (e) { fail(EXIT.BLOCKED, c.red(`\n   ${(e as Error).message}`)); }
}

function scoped(root: string, p: string, label: string): string {
  try { return confine(root, p, label); }
  catch (e) { fail(EXIT.BLOCKED, c.red(`\n   ${(e as Error).message}`)); }
}

function assertOwnTarget(url: string, root: string, source: 'cli' | 'config' | 'auto') {
  if (source === 'config') return; // declared inside the project's own config: explicit statement of ownership
  const o = checkTargetOwnership(url, root);
  if (!o.ok) {
    fail(EXIT.BLOCKED, c.red(`\n   Blocked: ${url} does not look like this project's app: ${o.reason}`),
      '   FThisUp only tests the project it is run in. If this really is your app (e.g. it runs in Docker or from another folder),',
      '   declare it explicitly: put "url" in fthisup.config.json inside this project.');
  }
}

function handleKnown(e: unknown): never {
  if (e instanceof UnknownAdapterError) fail(EXIT.BLOCKED, c.red(`\n   ${e.message}`));
  if (e instanceof ProjectScopeError) fail(EXIT.BLOCKED, c.red(`\n   ${e.message}`));
  if (e instanceof ConfigError) fail(EXIT.BLOCKED, c.red(`Configuration error: ${e.message}`));
  if (e instanceof TargetBlockedError) {
    fail(EXIT.BLOCKED, c.red(`\n   Blocked by safety policy: ${e.decision.reason}`), ...(e.decision.hint ? [`   ${e.decision.hint}`] : []), '   Nothing was tested.');
  }
  if (e instanceof TargetUnreachableError) {
    fail(EXIT.UNREACHABLE, c.red(`\n   ${e.message}`), '   Start your app first (or pass --start with a configured "startCommand"), then re-run.', '   Run `npx fthisup doctor` for a full environment check.');
  }
  if (e instanceof BrowserMissingError) fail(EXIT.ENV, c.red(`\n   ${e.message}`), '   Run `npx fthisup doctor` for details.');
  if (e instanceof SafetyEnforcementError) fail(EXIT.BLOCKED, c.red(`\n   ${e.message}`));
  fail(EXIT.ENV, c.red(`\n   Unexpected error: ${(e as Error).stack ?? e}`));
}

async function testCommand(o: TestOpts) {
  const cwd = requireProject();
  try {
    if (o.config) scoped(cwd, o.config, '--config');
    if (o.scenarios) scoped(cwd, o.scenarios, '--scenarios');
    const { config: fileCfg } = loadConfig(cwd, o.config);
    const config = applyOverrides(fileCfg, o);
    scoped(cwd, config.output, 'output directory');
    const quiet = !!o.quiet;
    if (!quiet) printBanner();
    const adapters = (o.adapter ?? []).flatMap((a) => a.split(',')).map((a) => a.trim()).filter(Boolean);

    let app: RunningApp | undefined;
    if (o.url) assertOwnTarget(o.url, cwd, 'cli');
    if (o.apiUrl) assertOwnTarget(o.apiUrl, cwd, 'cli');
    if (o.start) {
      const url = o.url ?? config.url;
      if (!config.startCommand) fail(EXIT.BLOCKED, c.red('   --start needs "startCommand" in fthisup.config.json.'));
      if (!url) fail(EXIT.UNREACHABLE, c.red('   --start needs a target URL (--url or "url" in the config).'));
      const d = evaluateTarget(url, config);
      if (!d.allowed) throw new TargetBlockedError(d);
      console.log(`   Starting app: ${c.dim(config.startCommand)}`);
      app = await startApp(config.startCommand, cwd, url);
    }
    process.on('SIGINT', () => { app?.stop(); process.exit(130); });

    let lastStage = '';
    let done = 0;
    let planned: PlannedRun | undefined;
    try {
      const orch = await orchestrate({
        root: cwd, config, explicitUrl: o.url, apiUrl: o.apiUrl, adapters, all: o.all, scenariosFile: o.scenarios, dryRun: o.dryRun, skipStatic: o.static === false,
        onStage: (s) => { if (!quiet && s !== lastStage && /^(Discovering|Generating|Attempting)/.test(s)) { lastStage = s; console.log(`   ${s}`); } },
        onPlan: (p) => { planned = p; if (!quiet) printPlan(p); },
        onProgress: (_a, r) => { if (!quiet) progressLine(++done, 0, `${r.adapter ?? ''} ${r.name}`.trim(), r.outcome); },
      });
      clearProgress();
      const { results, planned: pl } = orch;
      if (o.dryRun) {
        const tests = pl.selections.flatMap((s) => (s.plan?.tests ?? []).map((t) => ({ ...t, adapter: s.adapter.id })));
        const dropped = pl.selections.reduce((n, s) => n + (s.plan?.droppedByCap ?? 0), 0);
        console.log(`\n   Dry run: ${tests.length} scenario(s) would run (${dropped} dropped by --max-tests).`);
        for (const t of tests) console.log(`   ${c.gray(`${t.adapter}/${t.category}`.padEnd(26))} ${t.id}${t.requiresApproval ? c.yellow('  [needs approval]') : ''}`);
        for (const s of pl.selections) {
          const rej = (s.plan?.state as { rejected?: Array<{ id?: string; index: number; errors: string[] }> } | undefined)?.rejected ?? [];
          for (const r of rej) console.log(`   ${c.red('[REJECTED]')} ${r.id ?? `#${r.index}`}: ${r.errors.join('; ')}`);
        }
        return;
      }
      const outDir = path.resolve(cwd, config.output);
      const jsonFile = writeResultsJson(outDir, results);
      for (const [name, data] of Object.entries(orch.artifacts)) if (name.endsWith('.json')) writeJsonFile(outDir, name, data);
      writeJsonFile(outDir, 'project.json', planned?.ctx.manifest ?? {});
      let reportFile: string | undefined;
      if (config.report === 'html') reportFile = writeReport(outDir, results);
      printSummary(results, reportFile ?? jsonFile, Number(orch.artifacts['rejected-scenarios'] ?? 0), orch.blocked);
      const problems = orch.explicitProblems;
      if (problems.length) {
        for (const p of problems) console.error(c.red(`   Adapter "${p.id}" could not run: ${p.reason}`));
        process.exitCode = EXIT.ENV;
      } else if (orch.blocked.length && results.summary.total === 0 && o.url) process.exitCode = EXIT.BLOCKED;
      else if (results.summary.total === 0 && results.summary.blocked === 0 && !results.adapters?.some((a) => a.status === 'ran')) process.exitCode = EXIT.UNREACHABLE;
      else process.exitCode = results.summary.confirmed > 0 && !o.exitZero ? EXIT.BUGS : EXIT.OK;
    } finally {
      app?.stop();
    }
  } catch (e) {
    handleKnown(e);
  }
}

function printPlan(p: PlannedRun) {
  const m = p.ctx.manifest;
  if (p.ctx.target.url) console.log(`   Target: ${c.cyan(p.ctx.target.url)}\n`);
  console.log(`   ${c.bold('Project detected:')}`);
  if (!m.components.length) console.log(`     ${c.gray('no recognizable project files')}`);
  for (const comp of m.components) {
    const what = [comp.frameworks.slice(0, 3).join(', '), comp.roles.join('+')].filter(Boolean).join(' · ');
    console.log(`     ${comp.languages.join('/') || comp.ecosystem} ${c.gray(`(${what || 'unknown'}) @ ${comp.path}`)}${comp.integrations.length ? c.gray(` · ${comp.integrations.join(', ')}`) : ''}`);
  }
  console.log(`   ${c.bold('Testing:')}`);
  for (const s of p.selections) {
    if (s.status === 'not-applicable' && !s.explicit) continue;
    const name = s.adapter.id.padEnd(11);
    if (s.status === 'ran') console.log(`     ${c.green('✓')} ${name} ${s.adapter.name}`);
    else {
      console.log(`     ${c.yellow('-')} ${name} ${c.gray(`${s.status}: ${s.reason ?? ''}`)}`);
      for (const mi of s.plan?.missing ?? []) if (mi.setup) console.log(`         ${c.gray('→ ' + mi.setup)}`);
    }
  }
  console.log('');
}

function printSummary(results: import('../core/types.js').RunResults, reportPath: string, rejected: number, blocked: Array<{ id: string; reason: string }> = []) {
  const S = results.summary;
  console.log('');
  for (const [cat, v] of Object.entries(S.byCategory)) {
    if (!v.total) continue;
    const label = (CATEGORY_LABEL[cat] ?? cat).padEnd(24);
    console.log(`   ${v.failed ? tag.fail() : tag.pass()} ${label} ${c.gray(`${v.passed}/${v.total} passed`)}`);
  }
  const issues = results.findings.filter((f) => f.status === 'confirmed' || f.status === 'suspected' || f.status === 'not-reproducible');
  const exec = issues.filter((f) => f.source === 'execution');
  if (exec.length) console.log('');
  for (const f of exec) {
    const st = f.status === 'confirmed' ? c.red('CONFIRMED') : f.status === 'suspected' ? c.yellow('SUSPECTED') : c.gray('NOT-REPRODUCIBLE');
    const where = f.component && (results.components?.length ?? 0) > 1 ? c.gray(` [${f.component}]`) : '';
    console.log(`   ${st} ${c.bold(f.severity.toUpperCase().padEnd(8))} ${f.title} ${c.gray(f.route)}${where}`);
  }
  const warnings = issues.filter((f) => f.source === 'static-analysis').length;
  if (warnings) console.log(`\n   ${tag.warn()} ${warnings} static-analysis warning(s) (heuristic, unconfirmed) — see report`);
  if (S.skipped || S.blocked) console.log(`   ${tag.skip()} ${[S.skipped && `${S.skipped} skipped (not evaluable, or skipped by the project's own runner)`, S.blocked && `${S.blocked} blocked by safety policy`].filter(Boolean).join(', ')}`);
  for (const a of results.adapters ?? []) {
    if (['unavailable', 'unsupported', 'error', 'blocked'].includes(a.status)) console.log(`   ${tag.skip()} ${a.id}: ${a.status} — ${a.reason ?? ''}`);
    else if (a.status === 'skipped') console.log(`   ${tag.skip()} ${a.id}: ${a.reason ?? 'skipped'}`);
  }
  for (const b of blocked) console.log(`   ${tag.fail()} ${b.id} blocked: ${b.reason}`);
  if (rejected) console.log(`   ${tag.warn()} ${rejected} supplied scenario(s) rejected by validation`);
  console.log('');
  const n = S.confirmed;
  console.log(n > 0 ? `   ${c.red(c.bold(`${n} confirmed issue${n === 1 ? '' : 's'} discovered.`))}${S.suspected ? ` ${S.suspected} more suspected.` : ''}`
    : S.total === 0 ? `   ${c.yellow('No scenario could be executed.')}`
      : `   ${c.green('No confirmed issues in the checks that ran.')} ${c.gray('(That is not proof the project is bug-free.)')}`);
  console.log(`   ${S.total} executed · ${S.passed} passed · ${S.failed} failed · ${((results.durationMs) / 1000).toFixed(1)}s`);
  console.log(`\n   Report: ${reportPath}\n`);
}

const program = new Command();
program.name('fthisup').description('Your code works? Prove it. Attempts to break web apps, APIs, CLIs and libraries with real execution.').version(VERSION, '-v, --version');

const addTestOptions = (cmd: Command) => cmd
  .option('--url <url>', 'target application URL (default: config "url", or auto-detected on localhost)')
  .option('--mode <mode>', 'safe | thorough (default: safe)')
  .option('--headless', 'run the browser headless (default)')
  .option('--no-headless', 'show the browser window')
  .option('--max-tests <n>', 'maximum scenarios to run (default 100)')
  .option('--timeout <ms>', 'per-scenario timeout in ms (default 30000)')
  .option('--report <format>', 'html | json | none (default html)')
  .option('--output <dir>', 'results directory (default ./fthisup-results)')
  .option('--config <file>', `config file (default ${CONFIG_FILE})`)
  .option('--adapter <ids...>', 'only run these adapters (web, api, cli, python, javascript, flutter, rust, go, java, cpp, swift, desktop, godot)')
  .option('--all', 'run every applicable adapter, including opt-in ones (desktop builds/launches your app)')
  .option('--api-url <url>', 'base URL of the API under test (default: --url)')
  .option('--scenarios <file>', 'additional scenarios (JSON) proposed by an AI agent; validated before running')
  .option('--dry-run', 'discover + generate + validate scenarios, but do not execute them')
  .option('--start', 'start the app using "startCommand" from the config, and stop it afterwards')
  .option('--no-static', 'skip static code analysis warnings')
  .option('--exit-zero', 'exit 0 even when confirmed issues are found')
  .option('--quiet', 'minimal output');

addTestOptions(program.command('test', { isDefault: true }).description('Run real tests against a running, authorized application')).action(testCommand);

program.command('scan').description('Analyze the project and write a discovery manifest (confirmed vs inferred)')
  .option('--url <url>', 'also crawl this running app').option('--no-live', 'static analysis only').option('--output <dir>', 'output directory', './fthisup-results')
  .option('--config <file>').option('--json', 'print the manifest to stdout').action(async (o: { url?: string; live: boolean; output: string; config?: string; json?: boolean }) => {
    const cwd = requireProject();
    try {
      if (o.config) scoped(cwd, o.config, '--config');
      scoped(cwd, o.output, 'output directory');
      const { config } = loadConfig(cwd, o.config);
      const project = discoverProject(cwd);
      const warnings = analyzeStatic(cwd).findings;
      let live: Manifest['live'] = null;
      if (o.live) {
        const foreign = foreignPortChecker(cwd);
        const url = o.url ?? config.url ?? (await detectLocalUrl(project.likelyPort?.value, (port) => !foreign(port)));
        if (url) {
          const d = evaluateTarget(url, config);
          if (!d.allowed) throw new TargetBlockedError(d);
          assertOwnTarget(url, cwd, o.url ? 'cli' : config.url ? 'config' : 'auto');
          const browser = await launchBrowser(config);
          try { live = await discoverLive(browser, new SafetyGuard(d, config, { isForeignPort: foreignPortChecker(cwd) }), { maxPages: config.maxPages, excludeRoutes: config.excludeRoutes, timeout: Math.min(config.timeout, 15000) }); }
          finally { await browser.close(); }
        } else if (!o.json) console.log(c.gray('   No running app found; static analysis only (use --url to crawl a running app).'));
      }
      const manifest: Manifest = { schemaVersion: 1, generatedAt: new Date().toISOString(), project, live, warnings, legend: { confirmed: 'Read directly from a manifest/config file or observed in the running app.', inferred: 'Derived from naming conventions or regex heuristics; may be wrong.' } };
      const file = writeManifest(path.resolve(cwd, o.output), manifest);
      const detected = detectProjectManifest(cwd);
      writeJsonFile(path.resolve(cwd, o.output), 'project.json', detected);
      if (o.json) { console.log(JSON.stringify(manifest, null, 2)); return; }
      printBanner();
      const row = (k: string, v: string) => console.log(`   ${c.gray(k.padEnd(18))} ${v}`);
      const tagc = (i: { certainty: string }) => (i.certainty === 'confirmed' ? c.green('confirmed') : c.yellow('inferred'));
      row('Project', project.name);
      row('Framework', project.framework ? `${project.framework.value} (${tagc(project.framework)})` : c.gray('not detected'));
      row('Language', project.language.map((l) => `${l.value} (${tagc(l)})`).join(', ') || c.gray('unknown'));
      row('Test frameworks', project.testFrameworks.map((t) => t.value).join(', ') || c.gray('none found'));
      row('Start commands', project.startCommands.map((s) => s.value).join(', ') || c.gray('none found'));
      row('Routes (static)', `${project.routes.length} ${c.yellow('inferred')}${live ? `, ${live.pages.length} ${c.green('confirmed live')}` : ''}`);
      row('Forms (static)', `${project.forms.length} ${c.yellow('inferred')}${live ? `, ${live.pages.reduce((n, p) => n + p.forms.length, 0)} ${c.green('confirmed live')}` : ''}`);
      row('Auth signals', String(project.authSignals.length));
      row('API integrations', String(project.apiIntegrations.length));
      row('Warnings', `${warnings.length} static heuristic ${c.gray('(unconfirmed)')}`);
      for (const n of project.notes) console.log(`   ${tag.warn()} ${n}`);
      console.log(`\n   ${c.bold('Components')} ${c.gray('(candidate adapters; an adapter still has to confirm its prerequisites)')}`);
      for (const comp of detected.components) {
        console.log(`   ${comp.id.padEnd(22)} ${comp.languages.join('/')} · ${comp.roles.join('+') || 'unknown'}${comp.frameworks.length ? ` · ${comp.frameworks.slice(0, 3).join(', ')}` : ''}  ${c.gray(`→ ${comp.adapters.join(', ') || 'no adapter'}`)}`);
        const tcs = [...comp.testCommands, ...comp.analyzers];
        for (const tc of tcs) console.log(`     ${tc.available ? c.green('✓') : c.yellow('✗')} ${[tc.file, ...tc.args].join(' ')}${tc.available ? '' : c.gray(`  (${tc.reason})`)}`);
        for (const nt of comp.notes) console.log(`     ${c.gray(nt)}`);
      }
      if (!detected.components.length) console.log(`   ${c.gray('no recognizable project files')}`);
      console.log(`\n   Manifest: ${file}\n   Project:  ${path.join(path.resolve(cwd, o.output), 'project.json')}\n`);
    } catch (e) { handleKnown(e); }
  });

program.command('report').description('Generate the HTML report from previously collected results')
  .option('--input <dir>', 'results directory', './fthisup-results').option('--output <dir>', 'where to write report.html (default: same as input)')
  .action((o: { input: string; output?: string }) => {
    try {
      const root = requireProject();
      const inDir = scoped(root, o.input, '--input');
      const results = readResults(inDir);
      const file = writeReport(scoped(root, o.output ?? o.input, '--output'), results);
      console.log(`Report written: ${file}`);
    } catch (e) { fail(EXIT.BLOCKED, c.red((e as Error).message)); }
  });

program.command('init').description(`Create ${CONFIG_FILE} with detected project settings`).option('--force', 'overwrite an existing file').action((o: { force?: boolean }) => {
  const cwd = requireProject();
  const file = path.join(cwd, CONFIG_FILE);
  if (fs.existsSync(file) && !o.force) fail(EXIT.BLOCKED, c.red(`${CONFIG_FILE} already exists. Use --force to overwrite.`));
  const p = discoverProject(cwd);
  const cfg: Record<string, unknown> = {
    url: `http://localhost:${p.likelyPort?.value ?? 3000}`,
    ...(p.startCommands[0] ? { startCommand: p.startCommands[0].value } : {}),
    mode: 'safe', maxTests: 100, timeout: 30000, output: './fthisup-results', excludeRoutes: [], autoDetect: true,
    safety: { environment: 'local', authorized: false, allowedHosts: [], approvedActions: [] },
  };
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`Created ${CONFIG_FILE}`);
  console.log(`  framework: ${p.framework?.value ?? 'not detected'} · start: ${p.startCommands[0]?.value ?? 'not detected'}`);
  console.log('  Review "url" and "startCommand". Non-local targets stay blocked until you edit "safety".');
});

program.command('doctor').description('Check Node, Playwright browsers, configuration and target accessibility')
  .option('--install', 'run `npx playwright install chromium` (explicit opt-in)').option('--url <url>').option('--config <file>')
  .action(async (o: { install?: boolean; url?: string; config?: string }) => {
    let bad = 0;
    const ok = (m: string) => console.log(`   ${tag.pass()} ${m}`);
    const no = (m: string, fix: string) => { bad++; console.log(`   ${tag.fail()} ${m}\n          ${c.yellow('→')} ${fix}`); };
    const warn = (m: string) => console.log(`   ${tag.warn()} ${m}`);
    console.log(c.red(BANNER.split('\n').slice(0, 1).join('')) + `  ${c.bold('doctor')}\n`);
    const major = Number(process.versions.node.split('.')[0]);
    major >= 20 ? ok(`Node.js ${process.version}`) : no(`Node.js ${process.version} is too old`, 'Install Node.js 20 or newer.');
    let root = process.cwd();
    try { root = findProjectRoot(process.cwd()); ok(`Project root: ${root}`); }
    catch (e) { no('Not inside a project', (e as Error).message); }
    let exe = '';
    try { exe = chromium.executablePath(); } catch { /* ignore */ }
    if (!exe || !fs.existsSync(exe)) {
      if (o.install) {
        console.log('   Installing Chromium via Playwright (you asked for --install)...');
        const r = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['playwright', 'install', 'chromium'], { stdio: 'inherit' });
        if (r.status !== 0) no('Chromium installation failed', 'Run `npx playwright install chromium` manually and check your network/proxy.');
      } else no('Playwright Chromium is not installed', 'Run: npx playwright install chromium   (or: npx fthisup doctor --install)');
    }
    let cfg: FThisUpConfig | null = null;
    try {
      const l = loadConfig(root, o.config);
      cfg = l.config;
      ok(l.path ? `Config ${path.relative(root, l.path)} is valid` : `No ${CONFIG_FILE} (defaults in use; run \`npx fthisup init\` to create one)`);
    } catch (e) { no((e as Error).message.split('\n')[0]!, `Fix ${CONFIG_FILE} (see docs/configuration.md).`); }
    if (exe && fs.existsSync(exe) && cfg) {
      try { const b = await launchBrowser(cfg); ok(`Chromium ${b.version()} launches`); await b.close(); }
      catch (e) { no((e as Error).message, process.platform === 'linux' ? 'Run: npx playwright install-deps chromium (may need sudo)' : 'Reinstall: npx playwright install chromium'); }
    }
    const foreign = foreignPortChecker(root);
    const url = o.url ?? cfg?.url ?? (await detectLocalUrl(undefined, (port) => !foreign(port)));
    if (url && cfg) {
      const d = evaluateTarget(url, cfg);
      if (!d.allowed) warn(`Target ${url} is blocked by the safety policy: ${d.reason}`);
      else {
        const own = checkTargetOwnership(url, root);
        if (!own.ok) warn(`${url} does not look like this project's app: ${own.reason} FThisUp will refuse it unless "url" is set in ${CONFIG_FILE}.`);
        const p = await probeUrl(url, 4000);
        p.ok ? ok(`Application reachable at ${url} (${p.detail})`) : warn(`Application not reachable at ${url} (${p.detail}). Start it before running tests.`);
      }
    } else warn('No target URL configured or detected on common local ports (start your dev server or pass --url).');
    try {
      const out = confine(root, cfg?.output ?? './fthisup-results', 'output directory');
      fs.mkdirSync(out, { recursive: true });
      fs.accessSync(out, fs.constants.W_OK);
      ok(`Output directory writable (${path.relative(root, out) || '.'})`);
    } catch (e) { no((e as Error) instanceof ProjectScopeError ? (e as Error).message : 'Output directory is not writable', 'Use a directory inside the project (--output / "output" in the config).'); }
    if (cfg) {
      try {
        const { planRun } = await import('../core/orchestrator.js');
        const pr = await planRun({ root, config: cfg, adapters: [], explicitUrl: o.url });
        console.log(`\n   ${c.bold('Adapters')} ${c.gray('(what FThisUp can test in this project, right now)')}`);
        for (const s of pr.selections) {
          if (s.status === 'not-applicable') continue;
          const mark = s.status === 'ran' ? c.green('ready      ') : s.status === 'skipped' ? c.gray('opt-in     ') : c.yellow(s.status.padEnd(11));
          console.log(`     ${mark} ${s.adapter.id.padEnd(11)} ${c.gray(s.status === 'ran' ? s.adapter.name : s.reason ?? '')}`);
          for (const m of s.plan?.missing ?? []) console.log(`                 ${c.gray('· ' + m.what)}${m.setup ? c.gray('  → ' + m.setup) : ''}`);
        }
        const { sandboxInfo } = await import('../exec/sandbox.js');
        const sb = sandboxInfo();
        console.log(`     ${sb.available ? c.green('sandbox    ') : c.yellow('no sandbox ')} ${c.gray(sb.available ? 'bubblewrap: CLI probing and function fuzzing are isolated' : `${sb.reason}; function fuzzing stays disabled unless safety.allowUnsandboxedFuzzing is true`)}`);
      } catch (e) { warn(`could not plan adapters: ${(e as Error).message.split('\n')[0]}`); }
    }
    if (cfg?.auth) {
      const u = !!process.env[cfg.auth.usernameEnv], pw = !!process.env[cfg.auth.passwordEnv];
      u && pw ? ok('Auth test credentials found in environment') : warn(`Auth is configured but $${cfg.auth.usernameEnv} / $${cfg.auth.passwordEnv} are not both set; auth scenarios will be skipped.`);
    }
    console.log(bad ? `\n   ${c.red(`${bad} problem(s) found.`)}\n` : `\n   ${c.green('All required checks passed.')}\n`);
    process.exitCode = bad ? EXIT.ENV : EXIT.OK;
  });

program.command('install-skill').description('Copy the FThisUp Agent Skill into your coding agents\' skills directories (explicit, never automatic)')
  .option('--agent <agent>', 'claude | codex | cursor | all (default: auto-detect the agents you use)')
  .option('--global', 'install for your user account instead of this project')
  .option('--dir <path>', 'custom skills directory (overrides --agent location)')
  .option('--force', 'overwrite an existing install')
  .action((o: { agent?: string; global?: boolean; dir?: string; force?: boolean }) => {
    const rel: Record<string, string> = { claude: '.claude/skills', codex: '.agents/skills', cursor: '.cursor/skills' };
    const markers: Record<string, string[]> = { claude: ['.claude'], codex: ['.codex', '.agents'], cursor: ['.cursor'] };
    const home = os.homedir();
    let agents: string[];
    if (o.dir) agents = ['custom'];
    else if (o.agent === 'all') agents = Object.keys(rel);
    else if (o.agent) {
      if (!rel[o.agent]) fail(EXIT.BLOCKED, c.red('--agent must be one of: claude, codex, cursor, all'));
      agents = [o.agent];
    } else {
      agents = Object.keys(rel).filter((a) => markers[a]!.some((m) => fs.existsSync(path.join(process.cwd(), m)) || fs.existsSync(path.join(home, m))));
      if (!agents.length) fail(EXIT.BLOCKED, c.red('No coding agent detected (.claude, .codex/.agents, .cursor).'), '   Choose one explicitly: fthisup install-skill --agent claude|codex|cursor|all');
      console.log(`Detected: ${agents.join(', ')}`);
    }
    const src = fileURLToPath(new URL('../../skills/fthisup', import.meta.url));
    if (!fs.existsSync(path.join(src, 'SKILL.md'))) fail(EXIT.ENV, c.red(`Skill files not found at ${src}`));
    const how: Record<string, string> = { claude: 'Claude Code: type /fthisup (or /fthisup fix)', codex: 'Codex: mention $fthisup or pick it from /skills', cursor: 'Cursor: type / in Agent chat and choose fthisup', custom: 'Load it with your agent\'s skill mechanism' };
    let failed = false;
    for (const agent of agents) {
      const base = o.dir ? path.resolve(o.dir) : path.join(o.global ? home : process.cwd(), rel[agent]!);
      const dest = path.join(base, 'fthisup');
      if (fs.existsSync(dest) && !o.force) { console.error(c.yellow(`Skipped ${agent}: ${dest} already exists (use --force to overwrite).`)); failed = true; continue; }
      fs.mkdirSync(base, { recursive: true });
      fs.cpSync(src, dest, { recursive: true });
      console.log(`Installed to ${dest}\n   ${how[agent]}`);
    }
    console.log('Restart the agent session if the skill does not appear.');
    if (failed) process.exitCode = EXIT.BLOCKED;
  });

program.command('update').description('Update FThisUp to the latest version from GitHub (says so if you are already up to date)')
  .option('--check', 'only check whether a newer version exists; change nothing')
  .action((o: { check?: boolean }) => {
    const { checkouts, copies } = findInstalls({ selfRoot: selfRoot(), cwd: process.cwd() });
    console.log(`\n   FThisUp ${VERSION}: checking ${REPO_URL} ...\n`);
    let bad = false, changed = false, available = false;
    for (const dir of checkouts) {
      const r = updateCheckout(dir, { checkOnly: o.check });
      const icon = r.state === 'up-to-date' ? c.green('✓') : r.state === 'updated' ? c.green('↑') : r.state === 'available' ? c.yellow('↑') : r.state === 'skipped' ? c.yellow('•') : c.red('✗');
      console.log(`   ${icon} ${dir}\n     ${r.message}`);
      if (r.state === 'error') bad = true;
      if (r.state === 'updated') changed = true;
      if (r.state === 'available') available = true;
    }
    for (const dir of copies) console.log(`   ${c.yellow('•')} ${dir}\n     copied install (not a git clone): refresh with "fthisup install-skill --global --force"`);
    if (!checkouts.length) {
      console.log(`   ${c.yellow('•')} This copy of FThisUp is not a git checkout (e.g. a temporary npx cache), so it cannot update itself.`);
      console.log('     Run it through npx to always get the newest version: npx --yes github:Joseph1-H/FThisUp@latest <command>');
      console.log(`     Or install a permanent copy: git clone ${REPO_URL} && cd FThisUp && npm install && npm link`);
    }
    if (changed) console.log('\n   Restart your agent session so it picks up the new skill.');
    else if (!bad && !available && checkouts.length) console.log(`\n   ${c.green('No new version. You are on the latest.')}`);
    if (available) console.log('\n   Run "fthisup update" to install it.');
    console.log('');
    process.exitCode = bad ? EXIT.ENV : EXIT.OK;
  });

program.parseAsync(process.argv).catch(handleKnown);
