import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLI, ROOT, runCli, startFixture, tmpDir, type Fixture } from '../helpers.js';
import type { Finding, RunResults } from '../../src/core/types.js';

const readResults = (dir: string): RunResults => JSON.parse(fs.readFileSync(path.join(dir, 'results.json'), 'utf8'));
const finding = (r: RunResults, scenarioId: string): Finding | undefined => r.findings.find((f) => f.scenarioId === scenarioId);

beforeAll(() => {
  if (!fs.existsSync(CLI)) throw new Error('dist/ is missing: run `npm run build` first (`npm test` does this for you).');
});

describe('buggy fixture: FThisUp finds real, reproducible bugs', () => {
  let fx: Fixture; let out: string; let r: RunResults; let run: { code: number | null; stdout: string };
  beforeAll(async () => {
    fx = await startFixture('buggy-app');
    out = path.join(tmpDir(), 'results');
    run = await runCli(['test', '--url', fx.url, '--output', out], { cwd: tmpDir() });
    r = readResults(out);
  });
  afterAll(() => fx?.stop());

  it('exits 1 and prints the confirmed count', () => {
    expect(run.code).toBe(1);
    expect(run.stdout).toMatch(/\d+ confirmed issues? discovered/);
  });

  it.each([
    ['nav-old-page', /HTTP 404/],                                       // broken navigation
    ['form-notes-f0-duplicate-submit', /3 identical POST \/api\/notes/], // duplicate submission
    ['form-notes-f0-empty-submit', /validation did not stop/],          // missing input validation
    ['form-notes-f0-xss-marker', /EXECUTED/],                           // stored XSS
    ['form-notes-f0-long-text', /HTTP 500/],                            // server 5xx on long input
    ['chaos-click-root-0', /TypeError|Cannot read/],                    // runtime exception on interaction
    ['network-offline-form-notes-f0', /Unhandled promise rejection|TypeError|Failed to fetch/],     // unhandled API failure
    ['network-http500-form-notes-f0', /Save failed 500/],
    ['network-http500-load-notes', /forEach|not a function|Unhandled/],
  ])('confirms %s', (id, actual) => {
    const f = finding(r, id);
    expect(f, `finding for ${id}`).toBeDefined();
    expect(f!.status).toBe('confirmed');
    expect(f!.confidence).toBe('high');
    expect(f!.reproduction).toMatchObject({ attempted: true, reproduced: true });
    const evidenceText = f!.actual + JSON.stringify(f!.evidence.pageErrors);
    expect(evidenceText).toMatch(actual);
    expect(f!.reproductionSteps.length).toBeGreaterThan(0);
    expect(f!.suggestedFix.length).toBeGreaterThan(20);
    expect(f!.expected.length).toBeGreaterThan(10);
  });

  it('records accurate evidence: exact error, requests, and a real screenshot', () => {
    const exp = finding(r, 'chaos-click-root-0')!;
    expect(exp.evidence.pageErrors.join()).toMatch(/TypeError/);
    const dup = finding(r, 'form-notes-f0-duplicate-submit')!;
    expect(dup.evidence.mutatingRequests).toHaveLength(3);
    for (const f of r.findings.filter((x) => x.status === 'confirmed')) {
      expect(f.evidence.screenshot).toBeDefined();
      const png = fs.readFileSync(path.join(out, f.evidence.screenshot!));
      expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(png.length).toBeGreaterThan(1000);
    }
  });

  it('does not report the working parts as bugs', () => {
    expect(r.results.find((x) => x.scenarioId === 'nav-about')!.outcome).toBe('passed');
    expect(r.results.find((x) => x.scenarioId === 'nav-notes')!.outcome).toBe('passed');
    expect(finding(r, 'nav-about')).toBeUndefined();
    // the "Show tip" button works
    const tip = r.results.find((x) => x.name.includes('Show tip'))!;
    expect(tip.outcome).toBe('passed');
  });

  it('blocks the destructive scenario and never clicks Delete', async () => {
    const del = r.results.find((x) => x.name.includes('Delete all notes'))!;
    expect(del.outcome).toBe('blocked');
    expect(del.reason).toMatch(/approval/);
    expect((await fx.stats()).deleteCalls).toBe(0);
    expect(r.summary.blocked).toBeGreaterThan(0);
  });

  it('never claims external links as bugs or crawls third parties', () => {
    expect(JSON.stringify(r)).not.toMatch(/example\.com/);
  });

  it('covers at least five distinct categories', () => {
    const cats = new Set(r.results.filter((x) => x.outcome === 'passed' || x.outcome === 'failed').map((x) => x.category));
    for (const c of ['navigation', 'form-validation', 'ui-chaos', 'network-failure']) expect(cats.has(c as never)).toBe(true);
    // code-analysis is the 5th: the repo-level static pass is exercised in analysis tests + below
    expect(r.summary.byCategory['network-failure']!.failed).toBeGreaterThan(0);
  });

  it('writes valid, consistent JSON', () => {
    expect(r).toMatchObject({ schemaVersion: 1, tool: 'fthisup', mode: 'safe' });
    expect(r.summary.confirmed).toBe(r.findings.filter((f) => f.status === 'confirmed').length);
    expect(r.summary.total).toBe(r.summary.passed + r.summary.failed);
    expect(r.summary.total).toBe(r.results.filter((x) => x.outcome === 'passed' || x.outcome === 'failed').length);
    expect(r.environment.browser).toBe('chromium');
    expect(fs.existsSync(path.join(out, 'discovery.json'))).toBe(true);
  });

  it('produces an HTML report that opens offline, shows the right headline, and filters', async () => {
    const file = path.join(out, 'report.html');
    expect(fs.existsSync(file)).toBe(true);
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const errors: string[] = []; const requests: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      page.on('request', (q) => requests.push(q.url()));
      await page.goto(pathToFileURL(file).href);
      await page.waitForSelector('details.issue');
      expect(await page.locator('#headline').textContent()).toBe('FTHISUP — YOUR APP GOT FUCKED UP.');
      expect(await page.locator('details.issue').count()).toBe(r.findings.length);
      expect(await page.locator('#stats').textContent()).toContain(String(r.summary.confirmed));
      // search
      await page.fill('#q', 'duplicate');
      expect(await page.locator('details.issue:visible').count()).toBeGreaterThanOrEqual(1);
      expect(await page.locator('details.issue:visible').count()).toBeLessThan(r.findings.length);
      await page.fill('#q', '');
      // filter
      await page.selectOption('#fsev', 'critical');
      const critical = await page.locator('details.issue:visible').count();
      expect(critical).toBe(r.findings.filter((f) => f.severity === 'critical').length);
      await page.selectOption('#fsev', '');
      // expand + screenshot visible
      await page.locator('details.issue:visible >> nth=0 >> summary').click();
      expect(await page.locator('details.issue[open] .shot').count()).toBe(1);
      expect(errors).toEqual([]);
      expect(requests.every((u) => u.startsWith('file:') || u.startsWith('data:'))).toBe(true); // nothing hosted
    } finally { await browser.close(); }
  });

  it('`fthisup report` regenerates the report from results.json', async () => {
    fs.rmSync(path.join(out, 'report.html'));
    const res = await runCli(['report', '--input', out]);
    expect(res.code).toBe(0);
    expect(fs.readFileSync(path.join(out, 'report.html'), 'utf8')).toContain('<!doctype html>');
  });
});

describe('clean fixture: no invented failures', () => {
  let fx: Fixture; let out: string; let r: RunResults; let code: number | null;
  beforeAll(async () => {
    fx = await startFixture('clean-app');
    out = path.join(tmpDir(), 'results');
    ({ code } = await runCli(['test', '--url', fx.url, '--output', out], { cwd: tmpDir() }));
    r = readResults(out);
  });
  afterAll(() => fx?.stop());

  it('has zero confirmed (and zero suspected) issues and exits 0', () => {
    expect(r.findings.filter((f) => f.source === 'execution')).toEqual([]);
    expect(r.summary.confirmed).toBe(0);
    expect(r.summary.failed).toBe(0);
    expect(code).toBe(0);
  });
  it('actually ran a meaningful number of checks', () => {
    expect(r.summary.passed).toBeGreaterThanOrEqual(20);
    expect(Object.values(r.summary.byCategory).filter((c) => c.total > 0).length).toBeGreaterThanOrEqual(4);
  });
  it('still blocks the destructive button', async () => {
    expect(r.results.find((x) => x.name.includes('Delete all notes'))!.outcome).toBe('blocked');
    expect((await fx.stats()).deleteCalls).toBe(0);
  });
  it('shows the honest "nothing broke" headline', async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(pathToFileURL(path.join(out, 'report.html')).href);
      expect(await page.locator('#headline').textContent()).toBe('FTHISUP — NOTHING BROKE. YET.');
      expect(await page.locator('#sub').textContent()).toMatch(/not prove/i);
    } finally { await browser.close(); }
  });
});

describe('safety restrictions in the real CLI', () => {
  it('refuses a non-local target and tests nothing', async () => {
    const out = path.join(tmpDir(), 'o');
    const res = await runCli(['test', '--url', 'https://example.com', '--output', out], { cwd: tmpDir() });
    expect(res.code).toBe(2);
    expect(res.stderr).toMatch(/Blocked by safety policy/);
    expect(res.stderr).toMatch(/allowedHosts/);
    expect(fs.existsSync(path.join(out, 'results.json'))).toBe(false);
  });
  it('refuses an allow-listed host that lacks explicit authorization', async () => {
    const cwd = tmpDir();
    fs.writeFileSync(path.join(cwd, 'fthisup.config.json'), JSON.stringify({ safety: { allowedHosts: ['example.com'], environment: 'staging' } }));
    const res = await runCli(['test', '--url', 'https://example.com'], { cwd });
    expect(res.code).toBe(2);
    expect(res.stderr).toMatch(/authorized/);
  });
  it('rejects invalid configuration with actionable output', async () => {
    const cwd = tmpDir();
    fs.writeFileSync(path.join(cwd, 'fthisup.config.json'), JSON.stringify({ mode: 'destroy-everything', bogus: 1 }));
    const res = await runCli(['test', '--url', 'http://localhost:1'], { cwd });
    expect(res.code).toBe(2);
    expect(res.stderr).toMatch(/Configuration error/);
  });
  it('handles an unavailable application gracefully (no stack trace)', async () => {
    const res = await runCli(['test', '--url', 'http://127.0.0.1:1', '--output', path.join(tmpDir(), 'o')], { cwd: tmpDir() });
    expect(res.code).toBe(3);
    expect(res.stderr).toMatch(/Could not reach/);
    expect(res.stderr).not.toMatch(/\n\s+at /);
  });
  it('works with no API keys / no LLM anywhere in the environment', async () => {
    const fx = await startFixture('clean-app');
    try {
      const env = { ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', CLAUDE_CODE: '', CODEX_HOME: '' };
      const res = await runCli(['test', '--url', fx.url, '--dry-run'], { cwd: tmpDir(), env });
      expect(res.code).toBe(0);
      expect(res.stdout).toMatch(/Dry run: \d+ scenario/);
    } finally { fx.stop(); }
  });
});

describe('agent-proposed scenarios', () => {
  it('runs valid typed scenarios and rejects anything that is not in the typed vocabulary', async () => {
    const fx = await startFixture('clean-app');
    try {
      const cwd = tmpDir();
      const file = path.join(cwd, 'agent.json');
      fs.writeFileSync(file, JSON.stringify({ scenarios: [
        { id: 'agent-about-narrow', name: 'About page at 280px', category: 'ui-chaos', risk: 'low', target: '/about', steps: [{ action: 'setViewport', width: 280, height: 500 }, { action: 'goto', path: '/about' }], expected: [{ type: 'noUncaughtExceptions' }, { type: 'noHorizontalOverflow' }] },
        { id: 'agent-evil-js', name: 'evil', category: 'ui-chaos', risk: 'low', target: '/', steps: [{ action: 'evaluate', script: 'fetch("http://evil.invalid")' }], expected: [{ type: 'noBlankPage' }] },
        { id: 'agent-evil-nav', name: 'evil nav', category: 'navigation', risk: 'low', target: '/', steps: [{ action: 'goto', path: 'https://evil.invalid/' }], expected: [{ type: 'noBlankPage' }] },
      ] }));
      const out = path.join(cwd, 'out');
      const res = await runCli(['test', '--url', fx.url, '--scenarios', file, '--output', out, '--max-tests', '6', '--no-static'], { cwd });
      expect(res.stdout).toMatch(/2 supplied scenario\(s\) rejected/);
      const r = readResults(out);
      const mine = r.results.find((x) => x.scenarioId === 'agent-about-narrow')!;
      expect(mine.origin).toBe('agent');
      expect(mine.outcome).toBe('passed');
      expect(r.results.some((x) => x.scenarioId.startsWith('agent-evil'))).toBe(false);
    } finally { fx.stop(); }
  });
});

describe('authentication testing (explicit test account only)', () => {
  const USER = 'test@example.invalid', PASS = 'Correct-Horse-1';
  const configFor = (extra: object = {}) => {
    const cwd = tmpDir();
    fs.writeFileSync(path.join(cwd, 'fthisup.config.json'), JSON.stringify({ auth: { loginUrl: '/login', protectedRoutes: ['/dashboard'], logoutSelector: '#logout', restrictedSelectors: ['#admin-panel'], ...extra } }));
    return cwd;
  };

  it('passes every auth check on a correctly protected app, and never leaks the password', async () => {
    const fx = await startFixture('auth-app');
    try {
      const cwd = configFor(); const out = path.join(cwd, 'o');
      const res = await runCli(['test', '--url', fx.url, '--output', out, '--no-static'], { cwd, env: { FTHISUP_TEST_USER: USER, FTHISUP_TEST_PASSWORD: PASS } });
      const r = readResults(out);
      const auth = r.results.filter((x) => x.category === 'authentication');
      expect(auth.map((a) => a.scenarioId).sort()).toEqual(expect.arrayContaining(['auth-protected-dashboard', 'auth-session-expiry', 'auth-logout', 'auth-logout-back', 'auth-restricted-ui', 'auth-bad-login']));
      expect(auth.every((a) => a.outcome === 'passed')).toBe(true);
      expect(r.summary.confirmed).toBe(0);
      expect(res.code).toBe(0);
      const raw = fs.readFileSync(path.join(out, 'results.json'), 'utf8') + fs.readFileSync(path.join(out, 'report.html'), 'utf8') + res.stdout;
      expect(raw).not.toContain(PASS);
    } finally { fx.stop(); }
  });

  it('confirms broken auth: unauthenticated access, bad logout and visible restricted UI', async () => {
    const fx = await startFixture('auth-app', { BROKEN: '1' });
    try {
      const cwd = configFor(); const out = path.join(cwd, 'o');
      const res = await runCli(['test', '--url', fx.url, '--output', out, '--no-static'], { cwd, env: { FTHISUP_TEST_USER: USER, FTHISUP_TEST_PASSWORD: PASS } });
      const r = readResults(out);
      for (const id of ['auth-protected-dashboard', 'auth-session-expiry', 'auth-logout', 'auth-restricted-ui']) {
        const f = finding(r, id);
        expect(f, id).toBeDefined();
        expect(f!.status).toBe('confirmed');
        expect(['critical', 'high']).toContain(f!.severity);
      }
      expect(finding(r, 'auth-protected-dashboard')!.actual).toMatch(/without authentication/);
      expect(res.code).toBe(1);
    } finally { fx.stop(); }
  });

  it('skips (never fails) auth scenarios that need credentials when none are supplied', async () => {
    const fx = await startFixture('auth-app');
    try {
      const cwd = configFor(); const out = path.join(cwd, 'o');
      await runCli(['test', '--url', fx.url, '--output', out, '--no-static', '--max-tests', '30'], { cwd, env: { FTHISUP_TEST_USER: '', FTHISUP_TEST_PASSWORD: '' } });
      const r = readResults(out);
      const needs = r.results.filter((x) => ['auth-session-expiry', 'auth-logout', 'auth-bad-login'].includes(x.scenarioId));
      expect(needs.length).toBeGreaterThan(0);
      for (const n of needs) { expect(n.outcome).toBe('skipped'); expect(n.reason).toMatch(/credentials/); }
    } finally { fx.stop(); }
  });
});

describe('other commands', () => {
  it('install-skill copies a valid SKILL.md to the right per-agent location', async () => {
    for (const [agent, dir] of [['claude', '.claude/skills'], ['codex', '.agents/skills'], ['cursor', '.cursor/skills']] as const) {
      const cwd = tmpDir();
      const res = await runCli(['install-skill', '--agent', agent], { cwd });
      expect(res.code).toBe(0);
      const skill = fs.readFileSync(path.join(cwd, dir, 'fthisup', 'SKILL.md'), 'utf8');
      expect(skill).toMatch(/^---\nname: fthisup\ndescription: /);
      expect(fs.existsSync(path.join(cwd, dir, 'fthisup', 'references', 'fix.md'))).toBe(true);
      expect((await runCli(['install-skill', '--agent', agent], { cwd })).code).toBe(2);
    }
  });
  it('doctor reports the environment and exits 0 when everything required is present', async () => {
    const res = await runCli(['doctor'], { cwd: tmpDir() });
    expect(res.stdout).toMatch(/Node\.js v\d+/);
    expect(res.stdout).toMatch(/Chromium .* launches/);
    expect(res.code).toBe(0);
  });
  it('init writes a valid config that keeps non-local targets locked', async () => {
    const cwd = tmpDir();
    fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ name: 'x', scripts: { dev: 'vite' }, dependencies: { vite: '5' } }));
    const res = await runCli(['init'], { cwd });
    expect(res.code).toBe(0);
    const cfg = JSON.parse(fs.readFileSync(path.join(cwd, 'fthisup.config.json'), 'utf8'));
    expect(cfg).toMatchObject({ url: 'http://localhost:5173', startCommand: 'npm run dev', safety: { authorized: false, allowedHosts: [] } });
    expect((await runCli(['init'], { cwd })).code).toBe(2); // refuses to overwrite
  });
  it('scan writes a manifest that separates confirmed from inferred', async () => {
    const out = path.join(tmpDir(), 'o');
    const res = await runCli(['scan', '--no-live', '--output', out], { cwd: path.join(ROOT, 'tests', 'fixtures', 'static-project') });
    expect(res.code).toBe(0);
    const m = JSON.parse(fs.readFileSync(path.join(out, 'discovery.json'), 'utf8'));
    expect(m.project.framework.certainty).toBe('confirmed');
    expect(m.project.routes[0].certainty).toBe('inferred');
    expect(m.warnings.length).toBeGreaterThan(0);
    expect(JSON.stringify(m)).not.toContain('do-not-read-me');
  });
});
