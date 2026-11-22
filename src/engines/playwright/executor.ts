import type { Browser, Locator } from 'playwright';
import type { FThisUpConfig } from '../../core/config.js';
import type { Evidence, ExpectationResult } from '../../core/types.js';
import { isLoopbackHost, resolveSameOrigin, type SafetyGuard } from '../../safety/policy.js';
import type { Action, Scenario } from '../../scenarios/schema.js';
import { createSession, settle, type Session } from './session.js';
import { evaluateExpectation, type EvalState } from './expectations.js';

export class SkipScenario extends Error {}
export class SafetyViolation extends Error {}

export interface TestAccount { username: string; password: string }
export interface ExecEnv {
  browser: Browser;
  guard: SafetyGuard;
  config: FThisUpConfig;
  account?: TestAccount;
}
export interface ExecOutcome {
  skipped?: string;
  violation?: string;
  expectations: ExpectationResult[];
  evidence: Evidence;
  screenshot?: Buffer;
  durationMs: number;
}

const VALUES = {
  long: 'A'.repeat(10000),
  special: `'"<>&%$#{}[]\\;-- \${7*7} {{7*7}} ../../etc/passwd`,
  unicode: 'Ünïcödé 日本語 العربية עברית 🚀🔥 👨‍👩‍👧‍👦 Z̷a̷l̷g̷o̷',
  xss: '<img src=x onerror="window.__fthisupXss&&window.__fthisupXss()">',
};

type Kind = Extract<Action, { action: 'fillAll' }>['kind'];

function valueFor(kind: Kind, type: string, min?: string | null, max?: string | null): string | null {
  const email = 'fthisup-test@example.invalid';
  switch (type) {
    case 'email': return kind === 'long' ? `${'a'.repeat(300)}@example.invalid` : email;
    case 'number': {
      if (kind === 'long') return '99999999999999999999';
      const lo = min !== null && min !== undefined && min !== '' ? Number(min) : NaN;
      const hi = max !== null && max !== undefined && max !== '' ? Number(max) : NaN;
      return String(Number.isFinite(lo) ? lo : Number.isFinite(hi) ? Math.min(1, hi) : 1);
    }
    case 'tel': return kind === 'long' ? '1'.repeat(200) : '5550100';
    case 'url': return kind === 'long' ? `https://example.invalid/${'a'.repeat(2000)}` : 'https://example.invalid/';
    case 'date': return '2024-01-15';
    case 'time': return '12:00';
    case 'datetime-local': return '2024-01-15T12:00';
    case 'month': return '2024-01';
    case 'week': return '2024-W03';
    case 'hidden': case 'submit': case 'button': case 'reset': case 'image': case 'file': case 'password': case 'color': case 'range':
      return null;
    default:
      switch (kind) {
        case 'long': return VALUES.long;
        case 'special': return VALUES.special;
        case 'unicode': return VALUES.unicode;
        case 'xss-marker': return VALUES.xss;
        default: return 'FThisUp test';
      }
  }
}

async function fillAll(session: Session, scope: string | undefined, kind: Kind, timeout: number) {
  if (kind === 'empty') return;
  const controls = session.page.locator(`${scope ?? 'body'} >> :is(input,textarea,select)`);
  const n = await controls.count();
  for (let i = 0; i < n; i++) {
    const el = controls.nth(i);
    const info = await el.evaluate((e) => {
      const x = e as HTMLInputElement;
      return { tag: x.tagName.toLowerCase(), type: (x.getAttribute('type') || (x.tagName === 'TEXTAREA' ? 'textarea' : x.tagName === 'SELECT' ? 'select' : 'text')).toLowerCase(), min: x.getAttribute('min'), max: x.getAttribute('max'), options: x.tagName === 'SELECT' ? (x as unknown as HTMLSelectElement).options.length : 0 };
    }).catch(() => null);
    if (!info) continue;
    if (!(await el.isVisible().catch(() => false)) || !(await el.isEditable().catch(() => false)) && info.type !== 'checkbox' && info.type !== 'radio' && info.tag !== 'select') continue;
    try {
      if (info.type === 'checkbox' || info.type === 'radio') await el.check({ timeout, force: true });
      else if (info.tag === 'select') await el.selectOption({ index: info.options > 1 ? 1 : 0 }, { timeout });
      else {
        const v = valueFor(kind, info.type, info.min, info.max);
        if (v !== null) await el.fill(v, { timeout });
      }
    } catch { /* control rejected our value (type mismatch): that is the browser doing validation, not a bug */ }
  }
}

function classifyPlaywrightError(e: unknown, what: string): never {
  const msg = (e as Error).message ?? String(e);
  if (/ERR_TOO_MANY_REDIRECTS/.test(msg)) throw e;
  if ((e as Error).name === 'TimeoutError' || /Timeout .*exceeded|waiting for locator|not (visible|enabled|stable|attached)|strict mode violation|Unexpected token|selector/i.test(msg)) {
    throw new SkipScenario(`${what}: element not found or not actionable (${msg.split('\n')[0]!.slice(0, 120)})`);
  }
  throw new SkipScenario(`${what}: ${msg.split('\n')[0]!.slice(0, 160)}`);
}

export async function executeScenario(s: Scenario, env: ExecEnv, opts: { screenshot: boolean }): Promise<ExecOutcome> {
  const { guard, config } = env;
  const started = Date.now();
  // Enforced here (not only in the runner) so no caller can execute an unapproved scenario.
  const gate = guard.checkScenario(s);
  if (!gate.allowed) {
    return { violation: gate.reason, expectations: [], evidence: { consoleErrors: [], pageErrors: [], networkFailures: [], mutatingRequests: [], blockedRequests: [], notes: [] }, durationMs: 0 };
  }
  guard.beginScenario();
  const session = await createSession(env.browser, guard);
  const { page, recorder } = session;
  const actionTimeout = Math.min(config.timeout, 6000);
  page.setDefaultTimeout(actionTimeout);
  page.setDefaultNavigationTimeout(config.timeout);
  const st: EvalState = {
    page, recorder, scenario: s, origin: guard.origin, requestedPath: s.target, finalStatus: null, navError: null,
    textBefore: null, urlBefore: null, protectedRoutes: config.auth?.protectedRoutes ?? [],
  };

  const snapshot = async () => {
    st.textBefore = await page.evaluate(() => document.body?.innerText ?? '').catch(() => null);
    st.urlBefore = page.url();
  };
  const goto = async (p: string) => {
    const abs = resolveSameOrigin(guard.origin, p);
    if (!abs) throw new SafetyViolation(`navigation to "${p}" leaves the authorized origin`);
    st.requestedPath = p;
    try {
      const resp = await page.goto(abs, { waitUntil: 'load', timeout: config.timeout });
      st.finalStatus = resp?.status() ?? null;
      st.navError = null;
    } catch (e) {
      const msg = (e as Error).message ?? '';
      if (/ERR_TOO_MANY_REDIRECTS/.test(msg)) { recorder.redirectLoop = true; st.navError = 'too many redirects'; }
      else if (/ERR_CONNECTION_REFUSED|ERR_EMPTY_RESPONSE|ERR_CONNECTION_RESET/.test(msg)) { st.navError = `application unreachable (${msg.match(/net::\w+/)?.[0]})`; }
      else if (/ERR_INTERNET_DISCONNECTED|ERR_BLOCKED_BY_CLIENT/.test(msg)) { st.navError = msg.match(/net::\w+/)?.[0] ?? 'blocked'; }
      else if ((e as Error).name === 'TimeoutError') { st.navError = `page did not finish loading within ${config.timeout}ms`; }
      else throw new SkipScenario(`navigation error: ${msg.split('\n')[0]}`);
      return;
    }
    await settle(page);
    const here = new URL(page.url());
    if (/^https?:$/.test(here.protocol) && here.origin !== guard.origin && !(guard.decision.targetClass === 'loopback' && isLoopbackHost(here.hostname))) {
      throw new SafetyViolation(`navigation ended on foreign origin ${here.origin}`);
    }
  };

  const loc = (sel: string): Locator => page.locator(sel).first();
  const requireAccount = () => {
    if (!config.auth) throw new SkipScenario('authentication is not configured (add "auth" to fthisup.config.json)');
    if (!env.account) throw new SkipScenario(`test credentials missing: set $${config.auth.usernameEnv} and $${config.auth.passwordEnv}`);
    return { auth: config.auth, account: env.account };
  };
  const loggedIn = async (): Promise<boolean> => {
    const a = config.auth!;
    if (a.loggedInSelector) return loc(a.loggedInSelector).isVisible().catch(() => false);
    const pwVisible = await page.locator('input[type=password]').first().isVisible().catch(() => false);
    return !pwVisible;
  };

  const runStep = async (step: Action): Promise<void> => {
    try {
      switch (step.action) {
        case 'goto': await goto(step.path); return;
        case 'click': await snapshot(); await loc(step.selector).click({ timeout: actionTimeout }); await settle(page, 300); return;
        case 'submit': await snapshot(); await loc(step.selector).click({ timeout: actionTimeout }); await settle(page, 500); return;
        case 'repeatClick': {
          await snapshot();
          const l = loc(step.selector);
          for (let i = 0; i < step.times; i++) {
            try { await l.click({ force: true, noWaitAfter: true, timeout: i === 0 ? actionTimeout : 1500 }); }
            catch (e) { if (i === 0) throw e; }
            if (step.delayMs) await page.waitForTimeout(step.delayMs);
          }
          await settle(page, 800);
          return;
        }
        case 'fill': await loc(step.selector).fill(step.value, { timeout: actionTimeout }); return;
        case 'fillAll': await fillAll(session, step.scope, step.kind, actionTimeout); return;
        case 'press': await snapshot(); await page.keyboard.press(step.key); await settle(page, 300); return;
        case 'reload':
          try { await page.reload({ waitUntil: 'load', timeout: config.timeout }); } catch (e) { if (/ERR_TOO_MANY_REDIRECTS/.test((e as Error).message)) recorder.redirectLoop = true; else throw e; }
          await settle(page); return;
        case 'goBack': await page.goBack({ waitUntil: 'load', timeout: 8000 }).catch(() => null); await settle(page, 150); return;
        case 'goForward': await page.goForward({ waitUntil: 'load', timeout: 8000 }).catch(() => null); await settle(page, 150); return;
        case 'setViewport': await page.setViewportSize({ width: step.width, height: step.height }); return;
        case 'setNetwork': await session.setNetwork(step.mode, step.delayMs); return;
        case 'clearNetwork': await session.clearNetwork(); return;
        case 'wait': await page.waitForTimeout(step.ms); return;
        case 'login': {
          const { auth, account } = requireAccount();
          await goto(auth.loginUrl);
          await loc(auth.usernameSelector).fill(account.username, { timeout: actionTimeout });
          await loc(auth.passwordSelector).fill(account.password, { timeout: actionTimeout });
          await loc(auth.submitSelector).click({ timeout: actionTimeout });
          await settle(page, 600);
          if (!(await loggedIn())) throw new SkipScenario('login did not succeed with the supplied test account, so this scenario cannot be evaluated');
          return;
        }
        case 'loginWithBadPassword': {
          const { auth, account } = requireAccount();
          await goto(auth.loginUrl);
          await loc(auth.usernameSelector).fill(account.username, { timeout: actionTimeout });
          await loc(auth.passwordSelector).fill('fthisup-intentionally-wrong-password', { timeout: actionTimeout });
          await snapshot();
          await loc(auth.submitSelector).click({ timeout: actionTimeout });
          await settle(page, 600);
          return;
        }
        case 'logout': {
          const { auth } = requireAccount();
          if (!auth.logoutSelector) throw new SkipScenario('auth.logoutSelector is not configured');
          await loc(auth.logoutSelector).click({ timeout: actionTimeout });
          await settle(page, 500);
          return;
        }
        case 'expireSession':
          await session.context.clearCookies();
          await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* ignore */ } }).catch(() => undefined);
          return;
      }
    } catch (e) {
      if (e instanceof SkipScenario || e instanceof SafetyViolation) throw e;
      if (/ERR_TOO_MANY_REDIRECTS/.test((e as Error).message ?? '')) { recorder.redirectLoop = true; return; }
      classifyPlaywrightError(e, `step "${step.action}"`);
    }
  };

  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new SkipScenario(`scenario exceeded the ${config.timeout}ms timeout`)), config.timeout * 2); });
  try {
    await Promise.race([
      (async () => {
        if (s.steps.length === 0 || s.steps[0]!.action !== 'goto' && !s.steps.some((x) => x.action === 'goto' || x.action === 'login' || x.action === 'loginWithBadPassword')) await goto(s.target);
        for (const step of s.steps) {
          await runStep(step);
          if (recorder.budgetExceeded) throw new SafetyViolation(`request budget (${config.safety.maxRequestsPerScenario}) exceeded; scenario stopped`);
        }
      })(),
      deadline,
    ]);
    if (s.category === 'network-failure' && recorder.injectedHits === 0) {
      throw new SkipScenario('the app made no same-origin fetch/XHR request in this flow, so there was no API call to fail');
    }
    const expectations: ExpectationResult[] = [];
    for (const ex of s.expected) expectations.push(await evaluateExpectation(ex, st));
    let screenshot: Buffer | undefined;
    if (opts.screenshot && expectations.some((e) => !e.passed)) screenshot = await page.screenshot({ type: 'png', timeout: 5000 }).catch(() => undefined);
    return { expectations, evidence: recorder.toEvidence(), screenshot, durationMs: Date.now() - started };
  } catch (e) {
    const evidence = recorder.toEvidence();
    if (e instanceof SafetyViolation) return { violation: e.message, expectations: [], evidence, durationMs: Date.now() - started };
    if (e instanceof SkipScenario) return { skipped: e.message, expectations: [], evidence, durationMs: Date.now() - started };
    return { skipped: `unexpected executor error: ${(e as Error).message.split('\n')[0]}`, expectations: [], evidence, durationMs: Date.now() - started };
  } finally {
    if (timer) clearTimeout(timer);
    await session.close();
  }
}
