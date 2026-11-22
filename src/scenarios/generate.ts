import type { FThisUpConfig } from '../core/config.js';
import type { Category } from '../core/types.js';
import type { FormInfo, LiveDiscovery, PageInfo } from '../discovery/types.js';
import { classifySensitivity } from '../safety/classify.js';
import { isExcluded } from '../discovery/live.js';
import type { Action, Expectation, Scenario } from './schema.js';

const slug = (p: string) => (p.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'root').slice(0, 60).toLowerCase();

export interface GenInput {
  live: LiveDiscovery;
  staticRoutes: string[];
  config: FThisUpConfig;
}

interface Ranked { s: Scenario; priority: number }

const BASE_EXPECT: Expectation[] = [{ type: 'noUncaughtExceptions' }, { type: 'noBlankPage' }];

export function generateScenarios(input: GenInput): Scenario[] {
  const { live, config } = input;
  const thorough = config.mode === 'thorough';
  const protectedRoutes = config.auth?.protectedRoutes ?? [];
  const pages = live.pages.filter((p) => p.status !== null && p.status < 400 && !protectedRoutes.includes(p.path.split('?')[0]!));
  const out: Ranked[] = [];
  const add = (s: Omit<Scenario, 'origin' | 'requiresApproval'> & { requiresApproval?: boolean }, priority: number) =>
    out.push({ s: { origin: 'heuristic', requiresApproval: false, ...s } as Scenario, priority });

  // ---------- Navigation ----------
  const livePaths = new Set(live.pages.map((p) => p.path));
  for (const p of live.pages) {
    if (protectedRoutes.includes(p.path.split('?')[0]!)) continue;
    add({
      id: `nav-${slug(p.path)}`, name: `Load ${p.path}`, category: 'navigation', risk: 'low', target: p.path,
      description: p.linkedFrom ? `Reached from a link on ${p.linkedFrom}.` : 'Application entry point.',
      component: p.path, steps: [{ action: 'goto', path: p.path }],
      expected: [{ type: 'pageStatusOk', hard: true }, ...BASE_EXPECT, { type: 'noRedirectLoop' }, { type: 'noMissingResources' }, { type: 'noUnexpectedAuthRedirect' }],
    }, p.path === '/' ? 0 : 1);
  }
  let seedCount = 0;
  for (const r of input.staticRoutes) {
    if (seedCount >= 15) break;
    if (livePaths.has(r) || /[[\]:*{}<>]/.test(r) || r.startsWith('/api') || isExcluded(r, config.excludeRoutes) || protectedRoutes.includes(r)) continue;
    seedCount++;
    add({
      id: `nav-declared-${slug(r)}`, name: `Load declared route ${r}`, category: 'navigation', risk: 'low', target: r,
      description: 'Route declared in source code but not linked from any page FThisUp could reach (inferred, so failures are reported as suspected).',
      component: r, steps: [{ action: 'goto', path: r }],
      expected: [{ type: 'pageStatusOk', hard: false }, ...BASE_EXPECT, { type: 'noRedirectLoop' }],
    }, 4);
  }

  // ---------- UI chaos: navigation stress ----------
  const navPages = pages.slice(0, thorough ? 8 : 4);
  if (navPages.length >= 2) {
    const [a, b, c] = navPages as [PageInfo, PageInfo, PageInfo?];
    const seq: Action[] = [{ action: 'goto', path: a.path }, { action: 'goto', path: b.path }];
    if (c) seq.push({ action: 'goto', path: c.path });
    seq.push({ action: 'goBack' }, { action: 'goBack' }, { action: 'goForward' }, { action: 'goBack' }, { action: 'goForward' }, { action: 'goForward' });
    add({
      id: 'chaos-rapid-navigation', name: 'Rapid navigation with back/forward', category: 'ui-chaos', risk: 'low', target: a.path,
      description: 'Navigates quickly between pages and hammers back/forward.', steps: seq,
      expected: [...BASE_EXPECT, { type: 'stillInteractive' }, { type: 'noRedirectLoop' }],
    }, 2);
  }
  for (const p of navPages.slice(0, thorough ? 6 : 2)) {
    add({
      id: `chaos-reload-${slug(p.path)}`, name: `Unexpected reloads on ${p.path}`, category: 'ui-chaos', risk: 'low', target: p.path,
      steps: [{ action: 'goto', path: p.path }, { action: 'reload' }, { action: 'reload' }, { action: 'goBack' }, { action: 'goForward' }],
      expected: [...BASE_EXPECT, { type: 'stillInteractive' }],
    }, 3);
  }

  // ---------- UI chaos: viewports ----------
  for (const p of pages.slice(0, thorough ? 10 : 3)) {
    add({
      id: `chaos-narrow-${slug(p.path)}`, name: `Very narrow viewport (320px) on ${p.path}`, category: 'ui-chaos', risk: 'low', target: p.path,
      steps: [{ action: 'setViewport', width: 320, height: 568 }, { action: 'goto', path: p.path }],
      expected: [...BASE_EXPECT, { type: 'noHorizontalOverflow' }],
    }, 3);
    add({
      id: `chaos-wide-${slug(p.path)}`, name: `Very wide viewport (2560px) on ${p.path}`, category: 'ui-chaos', risk: 'low', target: p.path,
      steps: [{ action: 'setViewport', width: 2560, height: 1440 }, { action: 'goto', path: p.path }],
      expected: [...BASE_EXPECT, { type: 'noHorizontalOverflow' }],
    }, 4);
  }

  // ---------- UI chaos: buttons ----------
  for (const p of pages) {
    for (const [i, b] of p.buttons.slice(0, thorough ? 8 : 4).entries()) {
      const sens = classifySensitivity(b.text);
      add({
        id: `chaos-click-${slug(p.path)}-${i}`, name: `Click "${b.text || 'button'}" on ${p.path}`, category: 'ui-chaos',
        risk: sens ? 'high' : 'low', target: p.path, component: `button "${b.text}"`,
        description: sens ? `Button text suggests a ${sens} action; blocked unless approved.` : 'Clicks a standalone button and watches for crashes.',
        requiresApproval: !!sens, sensitivity: sens,
        steps: [{ action: 'goto', path: p.path }, { action: 'click', selector: b.selector }, { action: 'wait', ms: 300 }],
        expected: [...BASE_EXPECT, { type: 'stillInteractive' }, { type: 'noServerErrors' }],
      }, sens ? 6 : 2);
    }
  }

  // ---------- Forms ----------
  let formCount = 0;
  for (const p of pages) {
    for (const f of p.forms.slice(0, 5)) {
      if (formCount++ >= (thorough ? 40 : 12)) break;
      generateFormScenarios(p, f, config, add);
    }
  }

  // ---------- Network failures at page load ----------
  for (const p of pages.filter((x) => x.apiCalls.length > 0).slice(0, thorough ? 8 : 3)) {
    const modes: Array<[string, Action, number]> = [
      ['http500', { action: 'setNetwork', mode: 'http500' }, 2],
      ['http429', { action: 'setNetwork', mode: 'http429' }, 3],
      ['timeout', { action: 'setNetwork', mode: 'timeout', delayMs: 3500 }, 5],
      ['slow', { action: 'setNetwork', mode: 'slow', delayMs: 2500 }, 5],
    ];
    for (const [name, step, pr] of modes) {
      add({
        id: `network-${name}-load-${slug(p.path)}`, name: `API ${name === 'http500' ? 'returns HTTP 500' : name === 'http429' ? 'returns HTTP 429' : name === 'timeout' ? 'times out' : 'responds slowly'} while loading ${p.path}`,
        category: 'network-failure', risk: 'low', target: p.path, component: p.path,
        description: `Page issues ${p.apiCalls.length} fetch/XHR request(s) on load; FThisUp injects the failure in the browser only (no external system is touched).`,
        steps: [step, { action: 'goto', path: p.path }, { action: 'wait', ms: name === 'timeout' ? 4000 : 500 }],
        expected: [...BASE_EXPECT, { type: 'stillInteractive' }, ...(name === 'slow' ? [] : [{ type: 'visibleFeedbackOnFailure' } as Expectation])],
      }, pr);
    }
  }

  // ---------- Authentication ----------
  if (config.auth) generateAuth(config, add);

  return interleave(out);
}

function fieldSel(form: FormInfo, i: number) { return `${form.selector} >> :is(input,textarea,select) >> nth=${i}`; }

function generateFormScenarios(p: PageInfo, f: FormInfo, config: FThisUpConfig, add: (s: any, pr: number) => void) {
  if (!f.submit) return; // cannot submit without a visible submit control
  const fid = `${slug(p.path)}-${f.id}`;
  const sens = f.hasFile ? 'upload' as const : classifySensitivity(f.action, f.text, f.submit.text, ...f.fields.map((x) => `${x.name} ${x.label ?? ''}`));
  const common = {
    target: p.path, component: `form ${f.id} on ${p.path} (${f.method.toUpperCase()} ${f.action || 'same page'})`,
    requiresApproval: !!sens, sensitivity: sens ?? undefined,
  };
  const goto: Action = { action: 'goto', path: p.path };
  const submit: Action = { action: 'submit', selector: f.submit.selector };
  const risk = sens ? ('high' as const) : ('medium' as const);

  add({
    ...common, id: `form-${fid}-empty-submit`, name: `Submit ${f.id} on ${p.path} with empty fields`, category: 'form-validation', risk: sens ? 'high' : 'low',
    description: f.hasConstraints ? 'The form declares validation rules (required/type/pattern); an empty submission must not reach the server.' : 'The form declares no validation rules; an empty submission is reported only as a suspicion.',
    steps: [goto, submit],
    expected: [...BASE_EXPECT, { type: 'noRequestWhenInvalid', hard: f.hasConstraints }, { type: 'visibleFeedbackOnFailure' }],
  }, 1);
  if (f.hasPassword) return; // never send credential-shaped input to login forms beyond the empty case

  const emailIdx = f.fields.findIndex((x) => x.type === 'email' || /e-?mail/i.test(`${x.name} ${x.id}`));
  if (emailIdx >= 0) {
    add({
      ...common, id: `form-${fid}-invalid-email`, name: `Invalid email format in ${f.id} on ${p.path}`, category: 'form-validation', risk,
      steps: [goto, { action: 'fillAll', scope: f.selector, kind: 'valid' }, { action: 'fill', selector: fieldSel(f, emailIdx), value: 'not-an-email@@' }, submit],
      expected: [...BASE_EXPECT, { type: 'noRequestWhenInvalid', hard: f.fields[emailIdx]!.type === 'email' || f.fields[emailIdx]!.required }, { type: 'visibleFeedbackOnFailure' }],
    }, 3);
  }
  const numIdx = f.fields.findIndex((x) => x.type === 'number');
  if (numIdx >= 0) {
    const nf = f.fields[numIdx]!;
    const bad = nf.max !== undefined ? String(Number(nf.max) + 1000) : nf.min !== undefined ? String(Number(nf.min) - 1000) : '-99999';
    add({
      ...common, id: `form-${fid}-invalid-number`, name: `Out-of-range number in ${f.id} on ${p.path}`, category: 'form-validation', risk,
      steps: [goto, { action: 'fillAll', scope: f.selector, kind: 'valid' }, { action: 'fill', selector: fieldSel(f, numIdx), value: bad }, submit],
      expected: [...BASE_EXPECT, { type: 'noRequestWhenInvalid', hard: nf.min !== undefined || nf.max !== undefined }, { type: 'visibleFeedbackOnFailure' }],
    }, 3);
  }
  const variants: Array<[string, string, Extract<Action, { action: 'fillAll' }>['kind'], Expectation[], number]> = [
    ['long-text', 'Extremely long text (10,000 chars)', 'long', [...BASE_EXPECT, { type: 'noServerErrors' }], 3],
    ['special-chars', 'Special characters', 'special', [...BASE_EXPECT, { type: 'noServerErrors' }], 4],
    ['unicode-emoji', 'Unicode and emoji', 'unicode', [...BASE_EXPECT, { type: 'noServerErrors' }], 4],
  ];
  for (const [id, label, kind, expected, pr] of variants) {
    add({
      ...common, id: `form-${fid}-${id}`, name: `${label} in ${f.id} on ${p.path}`, category: 'form-validation', risk,
      steps: [goto, { action: 'fillAll', scope: f.selector, kind }, submit],
      expected, 
    }, pr);
  }
  add({
    ...common, id: `form-${fid}-xss-marker`, name: `HTML/script marker input in ${f.id} on ${p.path}`, category: 'form-validation', risk,
    description: 'Submits a harmless <img onerror> marker and checks whether it executes (stored or reflected XSS). The marker only sets an internal flag.',
    steps: [goto, { action: 'fillAll', scope: f.selector, kind: 'xss-marker' }, submit, { action: 'wait', ms: 300 }, { action: 'reload' }],
    expected: [{ type: 'noScriptInjection' }, ...BASE_EXPECT],
  }, 4);
  add({
    ...common, id: `form-${fid}-duplicate-submit`, name: `Rapid repeated submit of ${f.id} on ${p.path}`, category: 'form-validation', risk,
    description: 'Fills the form with valid data and clicks submit 3 times in quick succession against a slowed response. A well-behaved form sends one request.',
    steps: [goto, { action: 'fillAll', scope: f.selector, kind: 'valid' }, { action: 'setNetwork', mode: 'slow', delayMs: 600 }, { action: 'repeatClick', selector: f.submit.selector, times: 3, delayMs: 30 }],
    expected: [{ type: 'maxMutatingRequests', max: 1 }, ...BASE_EXPECT],
  }, 1);
  for (const [mode, label, pr] of [['http500', 'returns HTTP 500', 1], ['offline', 'is offline', 2], ['http429', 'returns HTTP 429', 3], ['timeout', 'times out', 5]] as const) {
    add({
      ...common, id: `network-${mode}-form-${fid}`, name: `API ${label} when submitting ${f.id} on ${p.path}`, category: 'network-failure', risk,
      steps: [goto, { action: 'fillAll', scope: f.selector, kind: 'valid' }, mode === 'timeout' ? { action: 'setNetwork', mode, delayMs: 3500 } : { action: 'setNetwork', mode }, submit, { action: 'wait', ms: mode === 'timeout' ? 4000 : 500 }],
      expected: [...BASE_EXPECT, { type: 'stillInteractive' }, { type: 'visibleFeedbackOnFailure' }],
    }, pr);
  }
}

function generateAuth(config: FThisUpConfig, add: (s: any, pr: number) => void) {
  const a = config.auth!;
  const gate = { type: 'gatedContent', loginPathPattern: 'login|signin|sign-in|auth', hard: true } as const;
  for (const r of a.protectedRoutes) {
    add({
      id: `auth-protected-${slug(r)}`, name: `Unauthenticated access to ${r} is rejected`, category: 'authentication', risk: 'low', target: r, component: r,
      steps: [{ action: 'goto', path: r }], expected: [gate, ...BASE_EXPECT],
    }, 1);
  }
  const first = a.protectedRoutes[0];
  if (first) {
    add({
      id: 'auth-session-expiry', name: 'Expired session no longer grants access', category: 'authentication', risk: 'medium', target: first,
      steps: [{ action: 'login' }, { action: 'goto', path: first }, { action: 'expireSession' }, { action: 'reload' }],
      expected: [gate, ...BASE_EXPECT],
    }, 2);
    if (a.logoutSelector) {
      add({
        id: 'auth-logout', name: 'Logout invalidates access', category: 'authentication', risk: 'medium', target: first,
        steps: [{ action: 'login' }, { action: 'goto', path: first }, { action: 'logout' }, { action: 'goto', path: first }],
        expected: [gate, ...BASE_EXPECT],
      }, 2);
      add({
        id: 'auth-logout-back', name: 'Back button after logout does not reveal protected content', category: 'authentication', risk: 'medium', target: first,
        steps: [{ action: 'login' }, { action: 'goto', path: first }, { action: 'logout' }, { action: 'goBack' }],
        expected: [{ ...gate, hard: false }, ...BASE_EXPECT],
      }, 3);
    }
  }
  if (a.restrictedSelectors.length) {
    add({
      id: 'auth-restricted-ui', name: 'Restricted UI is hidden from the test account', category: 'authentication', risk: 'medium', target: first ?? '/',
      steps: [{ action: 'login' }, { action: 'goto', path: first ?? '/' }],
      expected: a.restrictedSelectors.map((selector) => ({ type: 'selectorNotVisible' as const, selector })),
    }, 3);
  }
  add({
    id: 'auth-bad-login', name: 'A failed login does not crash the app', category: 'authentication', risk: 'medium', target: a.loginUrl,
    description: 'Exactly ONE login attempt with a wrong password for the supplied test account. Never repeated (no brute force, no lockout risk).',
    steps: [{ action: 'loginWithBadPassword' }], expected: [...BASE_EXPECT, { type: 'visibleFeedbackOnFailure' }],
  }, 2);
}

/** Round-robin across categories by priority so a --max-tests cap never drops a whole category. */
function interleave(all: Ranked[]): Scenario[] {
  const byCat = new Map<Category, Ranked[]>();
  for (const r of all) (byCat.get(r.s.category) ?? byCat.set(r.s.category, []).get(r.s.category)!).push(r);
  for (const list of byCat.values()) list.sort((a, b) => a.priority - b.priority);
  const lists = [...byCat.values()];
  const out: Scenario[] = [];
  const seen = new Set<string>();
  while (lists.some((l) => l.length)) {
    for (const l of lists) {
      const r = l.shift();
      if (r && !seen.has(r.s.id)) { seen.add(r.s.id); out.push(r.s); }
    }
  }
  return out;
}
