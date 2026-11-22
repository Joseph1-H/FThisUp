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
import { launchBrowser, probeUrl, runTests } from '../core/runner.js';
import { startApp, type RunningApp } from '../core/app.js';
import { discoverProject } from '../discovery/project.js';
import { discoverLive } from '../discovery/live.js';
import { analyzeStatic } from '../analysis/static.js';
import { evaluateTarget, SafetyGuard } from '../safety/policy.js';
import { writeReport } from '../reporting/html.js';
import { readResults, writeManifest, writeResultsJson } from '../reporting/json.js';
import type { Manifest } from '../discovery/types.js';
import { detectLocalUrl } from '../utils/ports.js';
import { VERSION } from '../utils/version.js';
import { BANNER, CATEGORY_LABEL, c, clearProgress, printBanner, progressLine, tag } from './ui.js';

const EXIT = { OK: 0, BUGS: 1, BLOCKED: 2, UNREACHABLE: 3, ENV: 4 } as const;

interface TestOpts {
  url?: string; mode?: string; headless?: boolean; maxTests?: string; timeout?: string; report?: string; output?: string;
  config?: string; scenarios?: string; dryRun?: boolean; start?: boolean; static?: boolean; exitZero?: boolean; quiet?: boolean;
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

function handleKnown(e: unknown): never {
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

async function resolveUrl(cwd: string, config: FThisUpConfig, explicit?: string): Promise<string | null> {
  if (explicit) return explicit;
  if (config.url) return config.url;
  const project = discoverProject(cwd);
  return detectLocalUrl(project.likelyPort?.value);
}

async function testCommand(o: TestOpts) {
  const cwd = process.cwd();
  try {
    const { config: fileCfg } = loadConfig(cwd, o.config);
    const config = applyOverrides(fileCfg, o);
    const quiet = !!o.quiet;
    if (!quiet) printBanner();

    let app: RunningApp | undefined;
    let url = await resolveUrl(cwd, config, o.url);
    if (o.start) {
      if (!config.startCommand) fail(EXIT.BLOCKED, c.red('   --start needs "startCommand" in fthisup.config.json.'));
      if (!url) fail(EXIT.UNREACHABLE, c.red('   --start needs a target URL (--url or "url" in the config).'));
      const d = evaluateTarget(url, config);
      if (!d.allowed) throw new TargetBlockedError(d);
      console.log(`   Starting app: ${c.dim(config.startCommand)}`);
      app = await startApp(config.startCommand, cwd, url);
    }
    if (!url) {
      fail(EXIT.UNREACHABLE, c.red('   No running application found on common local ports.'), '   Start your dev server and re-run, or pass --url http://localhost:PORT.');
    }
    if (!quiet) console.log(`   Target: ${c.cyan(url)}\n`);
    process.on('SIGINT', () => { app?.stop(); process.exit(130); });

    let lastStage = '';
    try {
      const { results, manifest, plan } = await runTests({
        cwd, config, url, scenariosFile: o.scenarios, dryRun: o.dryRun, skipStatic: o.static === false,
        onStage: (s) => { if (!quiet && s !== lastStage) { lastStage = s; console.log(`   ${s}`); } },
        onProgress: (p) => { if (!quiet) progressLine(p.index, p.total, p.result.name, p.result.outcome); },
      });
      clearProgress();
      if (o.dryRun) {
        console.log(`\n   Dry run: ${plan.scenarios.length} scenario(s) would run (${plan.droppedByCap} dropped by --max-tests).`);
        for (const s of plan.scenarios) console.log(`   ${c.gray(s.category.padEnd(16))} ${s.id}${s.requiresApproval ? c.yellow('  [needs approval]') : ''}`);
        for (const r of plan.rejected) console.log(`   ${c.red('[REJECTED]')} ${r.id ?? `#${r.index}`}: ${r.errors.join('; ')}`);
        return;
      }
      const outDir = path.resolve(cwd, config.output);
      const jsonFile = writeResultsJson(outDir, results);
      writeManifest(outDir, manifest);
      let reportFile: string | undefined;
      if (config.report === 'html') reportFile = writeReport(outDir, results);
      printSummary(results, reportFile ?? jsonFile, plan.rejected.length);
      process.exitCode = results.summary.confirmed > 0 && !o.exitZero ? EXIT.BUGS : EXIT.OK;
    } finally {
      app?.stop();
    }
  } catch (e) {
    handleKnown(e);
  }
}

function printSummary(results: import('../core/types.js').RunResults, reportPath: string, rejected: number) {
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
    console.log(`   ${st} ${c.bold(f.severity.toUpperCase().padEnd(8))} ${f.title} ${c.gray(f.route)}`);
  }
  const warnings = issues.filter((f) => f.source === 'static-analysis').length;
  if (warnings) console.log(`\n   ${tag.warn()} ${warnings} static-analysis warning(s) (heuristic, unconfirmed) — see report`);
  if (S.skipped || S.blocked) console.log(`   ${tag.skip()} ${[S.skipped && `${S.skipped} skipped (could not be evaluated)`, S.blocked && `${S.blocked} blocked by safety policy`].filter(Boolean).join(', ')}`);
  if (rejected) console.log(`   ${tag.warn()} ${rejected} supplied scenario(s) rejected by validation`);
  console.log('');
  const n = S.confirmed;
  console.log(n > 0 ? `   ${c.red(c.bold(`${n} confirmed issue${n === 1 ? '' : 's'} discovered.`))}${S.suspected ? ` ${S.suspected} more suspected.` : ''}`
    : S.total === 0 ? `   ${c.yellow('No scenario could be executed.')}`
      : `   ${c.green('No confirmed issues in the checks that ran.')} ${c.gray('(That is not proof the app is bug-free.)')}`);
  console.log(`   ${S.total} executed · ${S.passed} passed · ${S.failed} failed · ${((results.durationMs) / 1000).toFixed(1)}s`);
  console.log(`\n   Report: ${reportPath}\n`);
}

const program = new Command();
program.name('fthisup').description('Your AI built it. Now let another AI try to destroy it.').version(VERSION, '-v, --version');

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
    const cwd = process.cwd();
    try {
      const { config } = loadConfig(cwd, o.config);
      const project = discoverProject(cwd);
      const warnings = analyzeStatic(cwd).findings;
      let live: Manifest['live'] = null;
      if (o.live) {
        const url = o.url ?? config.url ?? (await detectLocalUrl(project.likelyPort?.value));
        if (url) {
          const d = evaluateTarget(url, config);
          if (!d.allowed) throw new TargetBlockedError(d);
          const browser = await launchBrowser(config);
          try { live = await discoverLive(browser, new SafetyGuard(d, config), { maxPages: config.maxPages, excludeRoutes: config.excludeRoutes, timeout: Math.min(config.timeout, 15000) }); }
          finally { await browser.close(); }
        } else if (!o.json) console.log(c.gray('   No running app found; static analysis only (use --url to crawl a running app).'));
      }
      const manifest: Manifest = { schemaVersion: 1, generatedAt: new Date().toISOString(), project, live, warnings, legend: { confirmed: 'Read directly from a manifest/config file or observed in the running app.', inferred: 'Derived from naming conventions or regex heuristics; may be wrong.' } };
      const file = writeManifest(path.resolve(cwd, o.output), manifest);
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
      console.log(`\n   Manifest: ${file}\n`);
    } catch (e) { handleKnown(e); }
  });

program.command('report').description('Generate the HTML report from previously collected results')
  .option('--input <dir>', 'results directory', './fthisup-results').option('--output <dir>', 'where to write report.html (default: same as input)')
  .action((o: { input: string; output?: string }) => {
    try {
      const inDir = path.resolve(process.cwd(), o.input);
      const results = readResults(inDir);
      const file = writeReport(path.resolve(process.cwd(), o.output ?? o.input), results);
      console.log(`Report written: ${file}`);
    } catch (e) { fail(EXIT.BLOCKED, c.red((e as Error).message)); }
  });

program.command('init').description(`Create ${CONFIG_FILE} with detected project settings`).option('--force', 'overwrite an existing file').action((o: { force?: boolean }) => {
  const cwd = process.cwd();
  const file = path.join(cwd, CONFIG_FILE);
  if (fs.existsSync(file) && !o.force) fail(EXIT.BLOCKED, c.red(`${CONFIG_FILE} already exists. Use --force to overwrite.`));
  const p = discoverProject(cwd);
  const cfg: Record<string, unknown> = {
    url: `http://localhost:${p.likelyPort?.value ?? 3000}`,
    ...(p.startCommands[0] ? { startCommand: p.startCommands[0].value } : {}),
    mode: 'safe', maxTests: 100, timeout: 30000, output: './fthisup-results', excludeRoutes: [],
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
      const l = loadConfig(process.cwd(), o.config);
      cfg = l.config;
      ok(l.path ? `Config ${path.relative(process.cwd(), l.path)} is valid` : `No ${CONFIG_FILE} (defaults in use; run \`npx fthisup init\` to create one)`);
    } catch (e) { no((e as Error).message.split('\n')[0]!, `Fix ${CONFIG_FILE} (see docs/configuration.md).`); }
    if (exe && fs.existsSync(exe) && cfg) {
      try { const b = await launchBrowser(cfg); ok(`Chromium ${b.version()} launches`); await b.close(); }
      catch (e) { no((e as Error).message, process.platform === 'linux' ? 'Run: npx playwright install-deps chromium (may need sudo)' : 'Reinstall: npx playwright install chromium'); }
    }
    const url = o.url ?? cfg?.url ?? (await detectLocalUrl());
    if (url && cfg) {
      const d = evaluateTarget(url, cfg);
      if (!d.allowed) warn(`Target ${url} is blocked by the safety policy: ${d.reason}`);
      else {
        const p = await probeUrl(url, 4000);
        p.ok ? ok(`Application reachable at ${url} (${p.detail})`) : warn(`Application not reachable at ${url} (${p.detail}). Start it before running tests.`);
      }
    } else warn('No target URL configured or detected on common local ports (start your dev server or pass --url).');
    try {
      const out = path.resolve(process.cwd(), cfg?.output ?? './fthisup-results');
      fs.mkdirSync(out, { recursive: true });
      fs.accessSync(out, fs.constants.W_OK);
      ok(`Output directory writable (${path.relative(process.cwd(), out) || '.'})`);
    } catch { no('Output directory is not writable', 'Choose another directory with --output.'); }
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

program.parseAsync(process.argv).catch(handleKnown);
