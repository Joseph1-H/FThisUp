import { describe, expect, it } from 'vitest';
import { configSchema } from '../../src/core/config.js';
import { evaluateTarget, SafetyGuard, resolveSameOrigin } from '../../src/safety/policy.js';
import { classifySensitivity } from '../../src/safety/classify.js';
import { redactDeep, redactString } from '../../src/safety/redact.js';
import { scenarioSchema, type Scenario } from '../../src/scenarios/schema.js';

const cfg = (safety: Record<string, unknown> = {}) => configSchema.parse({ safety });

describe('evaluateTarget', () => {
  it.each(['http://localhost:3000', 'http://127.0.0.1:8080/app', 'http://[::1]:3000', 'http://app.localhost:5173', 'https://localhost'])('allows loopback %s by default', (u) => {
    const d = evaluateTarget(u, cfg());
    expect(d.allowed).toBe(true);
    expect(d.environment).toBe('local');
    expect(d.readOnly).toBe(false);
  });

  it.each(['https://example.com', 'http://192.168.1.20:3000', 'http://10.0.0.5', 'http://myapp.internal'])('blocks non-local %s by default', (u) => {
    const d = evaluateTarget(u, cfg());
    expect(d.allowed).toBe(false);
    expect(d.hint).toMatch(/allowedHosts/);
  });

  it('blocks cloud metadata/link-local even if allow-listed', () => {
    const d = evaluateTarget('http://169.254.169.254/latest', cfg({ allowedHosts: ['169.254.169.254'], authorized: true, environment: 'staging' }));
    expect(d.allowed).toBe(false);
  });

  it('requires BOTH allow-list and explicit authorization', () => {
    expect(evaluateTarget('https://staging.example.com', cfg({ allowedHosts: ['staging.example.com'], environment: 'staging' })).allowed).toBe(false);
    expect(evaluateTarget('https://staging.example.com', cfg({ authorized: true, environment: 'staging' })).allowed).toBe(false);
  });

  it('requires the real environment to be declared for remote targets', () => {
    const d = evaluateTarget('https://staging.example.com', cfg({ allowedHosts: ['staging.example.com'], authorized: true }));
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/environment/);
  });

  it('allows an authorized staging target; production is read-only', () => {
    const base = { allowedHosts: ['staging.example.com'], authorized: true };
    const staging = evaluateTarget('https://staging.example.com', cfg({ ...base, environment: 'staging' }));
    expect(staging).toMatchObject({ allowed: true, readOnly: false, environment: 'staging' });
    const prod = evaluateTarget('https://staging.example.com', cfg({ ...base, environment: 'production' }));
    expect(prod).toMatchObject({ allowed: true, readOnly: true });
  });

  it.each(['ftp://localhost', 'file:///etc/passwd', 'javascript:alert(1)', 'not a url', 'http://user:pw@localhost'])('refuses %s', (u) => {
    expect(evaluateTarget(u, cfg()).allowed).toBe(false);
  });

  it('does not treat lookalike hostnames as loopback', () => {
    expect(evaluateTarget('http://localhost.evil.com', cfg()).allowed).toBe(false);
    expect(evaluateTarget('http://127.0.0.1.evil.com', cfg()).allowed).toBe(false);
  });
});

describe('resolveSameOrigin', () => {
  it('keeps paths on the origin and rejects escapes', () => {
    const o = 'http://localhost:3000';
    expect(resolveSameOrigin(o, '/a?b=1')).toBe('http://localhost:3000/a?b=1');
    expect(resolveSameOrigin(o, 'relative')).toBe('http://localhost:3000/relative');
    expect(resolveSameOrigin(o, 'https://evil.com/')).toBeNull();
    expect(resolveSameOrigin(o, '//evil.com/x')).toBeNull();
    expect(resolveSameOrigin(o, 'javascript:alert(1)')).toBeNull();
    expect(resolveSameOrigin(o, 'http://localhost:3001/')).toBeNull();
  });
});

const scenario = (over: Partial<Scenario> = {}): Scenario => scenarioSchema.parse({
  id: 's1', name: 'x', category: 'form-validation', risk: 'low', target: '/', steps: [{ action: 'goto', path: '/' }], expected: [{ type: 'noUncaughtExceptions' }], ...over,
});

describe('SafetyGuard.checkScenario', () => {
  const local = (safety = {}) => new SafetyGuard(evaluateTarget('http://localhost:3000', cfg(safety)), cfg(safety));

  it('allows plain low-risk scenarios', () => expect(local().checkScenario(scenario()).allowed).toBe(true));

  it('blocks off-origin targets and steps', () => {
    expect(local().checkScenario(scenario({ target: 'https://evil.com/' })).allowed).toBe(false);
    expect(local().checkScenario(scenario({ steps: [{ action: 'goto', path: 'http://evil.com' }] })).allowed).toBe(false);
  });

  it('blocks destructive scenarios until the exact action is approved', () => {
    const s = scenario({ risk: 'high', requiresApproval: true, sensitivity: 'deletion' });
    expect(local().checkScenario(s)).toMatchObject({ allowed: false });
    expect(local({ approvedActions: ['purchase'] }).checkScenario(s).allowed).toBe(false);
    expect(local({ approvedActions: ['deletion'] }).checkScenario(s).allowed).toBe(true);
  });

  it('blocks high-risk scenarios without "irreversible" approval', () => {
    expect(local().checkScenario(scenario({ risk: 'high' })).allowed).toBe(false);
    expect(local({ approvedActions: ['irreversible'] }).checkScenario(scenario({ risk: 'high' })).allowed).toBe(true);
  });

  it('blocks form-submitting scenarios on remote targets unless explicitly enabled', () => {
    const s = scenario({ steps: [{ action: 'goto', path: '/' }, { action: 'submit', selector: 'button' }] });
    const remote = { allowedHosts: ['stg.example.com'], authorized: true, environment: 'staging' };
    const mk = (extra = {}) => { const c = cfg({ ...remote, ...extra }); return new SafetyGuard(evaluateTarget('https://stg.example.com', c), c); };
    expect(mk().checkScenario(s).allowed).toBe(false);
    expect(mk({ allowFormSubmission: true }).checkScenario(s).allowed).toBe(true);
    const prod = cfg({ ...remote, environment: 'production', allowFormSubmission: true });
    const g = new SafetyGuard(evaluateTarget('https://stg.example.com', prod), prod);
    expect(g.checkScenario(s)).toMatchObject({ allowed: false });
    expect(g.mutationsAllowed).toBe(false);
  });
});

describe('SafetyGuard.checkRequest', () => {
  const c = cfg({ maxRequestsPerScenario: 10 });
  const g = () => { const x = new SafetyGuard(evaluateTarget('http://localhost:3000', c), c); x.beginScenario(); return x; };

  it('allows same-origin and other loopback origins (local API ports)', async () => {
    expect((await g().checkRequest('http://localhost:3000/api', 'GET', 'fetch')).allow).toBe(true);
    expect((await g().checkRequest('http://127.0.0.1:8000/api', 'POST', 'fetch')).allow).toBe(true);
  });

  it('never contacts third parties, even for GETs', async () => {
    for (const u of ['https://analytics.example.com/t', 'https://cdn.jsdelivr.net/x.js', 'http://169.254.169.254/']) {
      expect(await g().checkRequest(u, 'GET', 'script')).toMatchObject({ allow: false, kind: 'external' });
    }
  });

  it('can allow third-party static assets only when configured, and never mutations', async () => {
    const c2 = cfg({ allowThirdPartyAssets: true });
    const x = new SafetyGuard(evaluateTarget('http://localhost:3000', c2), c2);
    expect((await x.checkRequest('https://cdn.example.com/a.js', 'GET', 'script')).allow).toBe(true);
    expect((await x.checkRequest('https://cdn.example.com/a', 'POST', 'fetch')).allow).toBe(false);
    expect((await x.checkRequest('https://cdn.example.com/a', 'GET', 'fetch')).allow).toBe(false);
  });

  it('aborts mutating requests on read-only targets', async () => {
    const pc = cfg({ allowedHosts: ['prod.example.com'], authorized: true, environment: 'production' });
    const x = new SafetyGuard(evaluateTarget('https://prod.example.com', pc), pc);
    expect(await x.checkRequest('https://prod.example.com/api', 'POST', 'fetch')).toMatchObject({ allow: false, kind: 'mutation' });
    expect((await x.checkRequest('https://prod.example.com/', 'GET', 'document')).allow).toBe(true);
  });

  it('enforces a per-scenario request budget', async () => {
    const x = g();
    let blocked = 0;
    for (let i = 0; i < 15; i++) if (!(await x.checkRequest('http://localhost:3000/x', 'GET', 'fetch')).allow) blocked++;
    expect(blocked).toBe(5);
    expect(x.budgetExceeded).toBe(true);
  });

  it('rate-limits requests per second', async () => {
    const c3 = cfg({ maxRequestsPerSecond: 5, maxRequestsPerScenario: 100 });
    const x = new SafetyGuard(evaluateTarget('http://localhost:3000', c3), c3);
    x.beginScenario();
    const t = Date.now();
    for (let i = 0; i < 10; i++) await x.checkRequest('http://localhost:3000/x', 'GET', 'fetch');
    expect(Date.now() - t).toBeGreaterThanOrEqual(800); // 5 burst + 5 more at 5/s
  });
});

describe('classifySensitivity', () => {
  it.each([
    ['Delete account', 'deletion'], ['Buy now', 'purchase'], ['Sign up', 'account-creation'], ['Send message', 'messaging'], ['Upload file', 'upload'], ['Reset password', 'irreversible'],
  ])('%s → %s', (t, k) => expect(classifySensitivity(t)).toBe(k));
  it.each(['Add note', 'Save', 'Show tip', 'Search'])('%s is not sensitive', (t) => expect(classifySensitivity(t)).toBeUndefined());
});

describe('redaction', () => {
  it('redacts tokens, passwords, emails, cards and supplied secrets', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk';
    const out = redactString(`Authorization: Bearer abc123def456ghi789 token=${jwt} {"password":"hunter2hunter2"} mail bob@corp.com card 4111 1111 1111 1111 s3cr3tvalue`, ['s3cr3tvalue']);
    expect(out).not.toMatch(/abc123def456|eyJhbGci|hunter2|bob@corp|4111 1111|s3cr3tvalue/);
    expect(out).toContain('[REDACTED');
  });
  it('keeps FThisUp synthetic data and ordinary numbers readable', () => {
    expect(redactString('fthisup-test@example.invalid')).toContain('fthisup-test@example.invalid');
    expect(redactString('timestamp 1700000000000')).toContain('1700000000000');
  });
  it('deep-redacts and truncates', () => {
    const o = redactDeep({ a: ['x@y.com', { b: 'A'.repeat(5000) }] });
    expect(JSON.stringify(o)).not.toContain('x@y.com');
    expect(JSON.stringify(o).length).toBeLessThan(1000);
  });
});
