import type { Page } from 'playwright';
import type { Recorder } from './session.js';
import type { ExpectationResult, Severity } from '../../core/types.js';
import type { Expectation, Scenario } from '../../scenarios/schema.js';

export interface EvalState {
  page: Page;
  recorder: Recorder;
  scenario: Scenario;
  origin: string;
  requestedPath: string;
  finalStatus: number | null;
  navError: string | null;
  textBefore: string | null;
  urlBefore: string | null;
  protectedRoutes: string[];
}

const res = (type: string, passed: boolean, hard: boolean, severity: Severity, message: string): ExpectationResult => ({ type, passed, hard, severity, message });
const timeoutP = <T>(ms: number, v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms));

const SEVERITY_RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
export const maxSeverity = (a: Severity, b: Severity): Severity => (SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b);

export async function evaluateExpectation(ex: Expectation, st: EvalState): Promise<ExpectationResult> {
  const { page, recorder: rec } = st;
  switch (ex.type) {
    case 'noUncaughtExceptions': {
      const errs = [...new Set(rec.pageErrors)];
      const nav = st.scenario.category === 'navigation';
      return res(ex.type, errs.length === 0, true, nav ? 'high' : 'medium',
        errs.length ? `${errs.length} uncaught exception(s) in the page: ${errs[0]}` : 'No uncaught exceptions or unhandled rejections.');
    }
    case 'noBlankPage': {
      if (st.navError) return res(ex.type, true, true, 'high', 'Skipped: navigation failed (reported by another check).');
      const blank = await page.evaluate(() => {
        const b = document.body;
        if (!b) return true;
        return b.innerText.trim().length === 0 && b.querySelectorAll('img,canvas,svg,video,iframe,input,button,a,textarea,select').length === 0;
      }).catch(() => false);
      return res(ex.type, !blank, true, 'high', blank ? 'The page rendered no visible content (blank page).' : 'Page has visible content.');
    }
    case 'pageStatusOk': {
      if (st.navError) return res(ex.type, false, ex.hard, 'high', `Navigation to ${st.requestedPath} failed: ${st.navError}`);
      const ok = st.finalStatus === null || st.finalStatus < 400;
      return res(ex.type, ok, ex.hard, st.finalStatus !== null && st.finalStatus >= 500 ? 'high' : 'medium',
        ok ? `HTTP ${st.finalStatus ?? 'n/a'}` : `${st.requestedPath} responded with HTTP ${st.finalStatus}.`);
    }
    case 'noRedirectLoop': {
      const loop = rec.redirectLoop || rec.navigations.length > 25;
      return res(ex.type, !loop, true, 'high', loop ? 'The browser gave up after too many redirects (redirect loop).' : 'No redirect loop.');
    }
    case 'noMissingResources': {
      const missing = rec.failures.filter((f) => !f.injected && new URL(f.url).origin === st.origin && (f.status === 404 || f.status === 410) && ['script', 'stylesheet', 'image', 'font', 'media'].includes(f.resourceType ?? ''));
      const critical = missing.some((m) => m.resourceType === 'script' || m.resourceType === 'stylesheet');
      return res(ex.type, missing.length === 0, true, critical ? 'medium' : 'low',
        missing.length ? `${missing.length} same-origin resource(s) returned 404: ${missing.slice(0, 3).map((m) => new URL(m.url).pathname).join(', ')}` : 'No missing same-origin resources.');
    }
    case 'noServerErrors': {
      const errs = rec.responses.filter((r) => !r.injected && (r.status ?? 0) >= 500 && new URL(r.url).origin === st.origin);
      return res(ex.type, errs.length === 0, true, 'medium',
        errs.length ? `Server returned HTTP ${errs[0]!.status} for ${errs[0]!.method} ${new URL(errs[0]!.url).pathname} in response to unusual input (should be a handled 4xx).` : 'No 5xx responses.');
    }
    case 'noHorizontalOverflow': {
      const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })).catch(() => ({ sw: 0, iw: 0 }));
      const over = r.sw > r.iw + 2;
      return res(ex.type, !over, false, 'low', over ? `Page content is ${r.sw}px wide in a ${r.iw}px viewport (horizontal scrolling / clipped layout).` : 'No horizontal overflow.');
    }
    case 'noScriptInjection':
      return res(ex.type, !rec.xssTriggered, true, 'critical',
        rec.xssTriggered ? 'A harmless marker payload (<img onerror>) submitted as input EXECUTED in the page: user input is rendered as HTML without escaping (XSS).' : 'Marker payload was not executed.');
    case 'noUnexpectedAuthRedirect': {
      const u = new URL(page.url());
      const redirected = /(^|\/)(log-?in|sign-?in|auth)(\/|$)/i.test(u.pathname) && !/(^|\/)(log-?in|sign-?in|auth)(\/|$)/i.test(st.requestedPath) && !st.protectedRoutes.includes(st.requestedPath);
      return res(ex.type, !redirected, false, 'info', redirected ? `${st.requestedPath} redirected to ${u.pathname} although it is not a configured protected route.` : 'No unexpected auth redirect.');
    }
    case 'maxMutatingRequests': {
      const groups = new Map<string, number>();
      for (const m of rec.mutating) { const k = `${m.method} ${new URL(m.url).pathname}`; groups.set(k, (groups.get(k) ?? 0) + 1); }
      const [worstKey, worst] = [...groups.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
      return res(ex.type, worst <= ex.max, true, 'high',
        worst > ex.max ? `${worst} identical ${worstKey} requests were sent for rapid repeated clicks (expected at most ${ex.max}): duplicate submission is not prevented.` : `At most ${worst} mutating request(s) sent.`);
    }
    case 'noRequestWhenInvalid': {
      const n = rec.mutating.length;
      return res(ex.type, n === 0, ex.hard, 'medium',
        n > 0 ? `The form sent ${n} ${rec.mutating[0]!.method} request(s) to ${new URL(rec.mutating[0]!.url).pathname} even though the input was invalid/incomplete — validation did not stop the submission.` : 'Invalid input was stopped before any request was sent.');
    }
    case 'visibleFeedbackOnFailure': {
      const after = await page.evaluate(() => {
        const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
        const sel = '[role=alert],[aria-live],[class*=error i],[class*=toast i],[class*=alert i],[class*=invalid i],[class*=message i],[class*=status i],[data-error]';
        return {
          text: document.body?.innerText ?? '',
          alerts: Array.from(document.querySelectorAll(sel)).filter((e) => vis(e) && (e.textContent ?? '').trim().length > 0).length,
          invalid: document.querySelectorAll(':invalid').length,
          url: location.href,
        };
      }).catch(() => null);
      if (!after) return res(ex.type, true, false, 'low', 'Page not inspectable.');
      const changed = st.textBefore !== null && after.text !== st.textBefore;
      const urlChanged = st.urlBefore !== null && after.url !== st.urlBefore;
      const ok = after.alerts > 0 || after.invalid > 0 || changed || urlChanged;
      return res(ex.type, ok, false, 'low', ok ? 'The UI gave the user visible feedback.' : 'After the failing action nothing visible changed: the user gets no error, validation message, or status (silent failure).');
    }
    case 'stillInteractive': {
      const alive = await Promise.race([page.evaluate(() => document.readyState).then(() => true).catch(() => false), timeoutP(3000, false)]);
      return res(ex.type, alive, true, 'high', alive ? 'Page remains responsive.' : 'Page became unresponsive or crashed.');
    }
    case 'urlNotMatches': {
      const m = new RegExp(ex.pattern).test(page.url());
      return res(ex.type, !m, true, 'medium', m ? `URL ${page.url()} unexpectedly matches /${ex.pattern}/.` : 'URL OK.');
    }
    case 'gatedContent': {
      const u = new URL(page.url());
      const onLogin = new RegExp(ex.loginPathPattern, 'i').test(u.pathname);
      const status = st.finalStatus ?? 200;
      const gate = await page.evaluate(() => {
        const t = (document.body?.innerText ?? '').slice(0, 5000);
        return { pw: !!document.querySelector('input[type=password]'), denied: /\b(unauthori[sz]ed|forbidden|access denied|not authori[sz]ed|please authenticate|you (must|need to) (be )?(signed|logged) ?in|(please )?(sign|log) ?in to (continue|view|access))\b/i.test(t) };
      }).catch(() => ({ pw: false, denied: false }));
      const gated = onLogin || status === 401 || status === 403 || gate.pw || gate.denied;
      return res(ex.type, gated, ex.hard, 'critical', gated ? 'Access was gated (login redirect / denied / login form shown).' : `Protected route ${st.requestedPath} rendered content without authentication (URL ${u.pathname}, HTTP ${status}).`);
    }
    case 'selectorNotVisible': {
      const visible = await page.locator(ex.selector).first().isVisible().catch(() => false);
      return res(ex.type, !visible, true, 'high', visible ? `Restricted element "${ex.selector}" is visible to the test account.` : `"${ex.selector}" is hidden.`);
    }
    case 'selectorVisible': {
      const visible = await page.locator(ex.selector).first().isVisible().catch(() => false);
      return res(ex.type, visible, true, 'medium', visible ? `"${ex.selector}" is visible.` : `Expected element "${ex.selector}" is not visible.`);
    }
    case 'loginFormVisible': {
      const v = await page.locator('input[type=password]').first().isVisible().catch(() => false);
      return res(ex.type, v, false, 'medium', v ? 'Login form is shown.' : 'Login form not shown.');
    }
  }
}
