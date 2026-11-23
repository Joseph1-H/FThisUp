import { CATEGORIES } from './types.js';
import { maxSeverity } from '../engines/playwright/expectations.js';
const EXPECTED_TEXT = {
    noUncaughtExceptions: 'The page runs without uncaught JavaScript exceptions or unhandled promise rejections.',
    noBlankPage: 'The page always renders visible content.',
    pageStatusOk: 'The route responds successfully (HTTP < 400).',
    noRedirectLoop: 'Navigation completes without redirect loops.',
    noMissingResources: 'All same-origin scripts, styles and images load.',
    noServerErrors: 'Unusual input is rejected with a handled 4xx response, never a 5xx crash.',
    noHorizontalOverflow: 'Layout adapts to the viewport without horizontal overflow.',
    noScriptInjection: 'User input is escaped and never executes as HTML/JavaScript.',
    noUnexpectedAuthRedirect: 'Public routes do not redirect to a login page.',
    maxMutatingRequests: 'Rapid repeated submits result in a single request (duplicate submission is prevented).',
    noRequestWhenInvalid: 'Invalid or incomplete input is blocked client-side before any request is sent.',
    visibleFeedbackOnFailure: 'When something fails, the user sees an error, validation message, or status change.',
    stillInteractive: 'The page stays responsive.',
    urlNotMatches: 'The URL does not end up somewhere unexpected.',
    gatedContent: 'Protected content is not shown without valid authentication.',
    selectorNotVisible: 'Restricted UI is hidden from this account.',
    selectorVisible: 'The expected element is visible.',
    loginFormVisible: 'The login form is shown.',
};
const FIX_TEXT = {
    noUncaughtExceptions: 'Find the throwing code path from the stack trace in the evidence. Guard against undefined/null values, wrap async calls in try/catch, and add an error boundary (or global handler) so one failure cannot take the page down.',
    noBlankPage: 'Render a fallback UI (error boundary / empty state) for failures instead of nothing, and check the page bundle loads without errors.',
    pageStatusOk: 'Fix or remove the link/route, or implement the missing page. Add a real 404 page for unknown routes.',
    noRedirectLoop: 'Check redirect rules (auth guards, trailing-slash and locale redirects) for conditions that redirect back to themselves.',
    noMissingResources: 'Fix the asset path or build output; confirm the file is actually deployed.',
    noServerErrors: 'Validate and bound input (length, type, encoding) on the server and return 400/413/422 instead of failing with 500.',
    noHorizontalOverflow: 'Use fluid widths (max-width: 100%, flex-wrap), avoid fixed pixel widths, and test at 320px.',
    noScriptInjection: 'Render user data with textContent / framework escaping instead of innerHTML; sanitize anywhere HTML is truly required.',
    maxMutatingRequests: 'Disable the submit control (and ignore further submits) while a request is in flight; make the server endpoint idempotent (idempotency key / unique constraint).',
    noRequestWhenInvalid: 'Validate on the client before sending (required, type, pattern), keep native validation enabled (no `novalidate` without replacement checks), and ALSO validate on the server.',
    visibleFeedbackOnFailure: 'Handle failed requests: catch rejections, check response.ok, and show an error/retry message; add validation messages next to invalid fields.',
    stillInteractive: 'Look for long synchronous work or infinite loops triggered by this flow.',
    gatedContent: 'Enforce authentication on the server for this route/API (not only in client-side routing) and redirect or return 401/403 for anonymous users.',
    selectorNotVisible: 'Hide/omit restricted UI based on the user role on the server-rendered output, and enforce the same permission on the API.',
    noUnexpectedAuthRedirect: 'Confirm the route is meant to be public; remove the redirect or add it to the protected routes list.',
};
function prettySel(sel) {
    let m;
    if ((m = sel.match(/^form >> nth=(\d+) >> :is\(button.*\) >> nth=\d+$/)))
        return `the submit button of form #${Number(m[1]) + 1}`;
    if ((m = sel.match(/^form >> nth=(\d+) >> :is\(input,textarea,select\) >> nth=(\d+)$/)))
        return `field #${Number(m[2]) + 1} of form #${Number(m[1]) + 1}`;
    if ((m = sel.match(/^form >> nth=(\d+)$/)))
        return `form #${Number(m[1]) + 1}`;
    if ((m = sel.match(/^:is\(button,\[role=button\]\) >> nth=(\d+)$/)))
        return `button #${Number(m[1]) + 1} on the page`;
    return sel;
}
const FAILURE_BY_EXPECTATION = {
    noUncaughtExceptions: 'unhandled-exception', noBlankPage: 'ui-interaction', pageStatusOk: 'broken-navigation', noRedirectLoop: 'broken-navigation',
    noMissingResources: 'broken-navigation', noServerErrors: 'input-validation', noHorizontalOverflow: 'layout-defect', noScriptInjection: 'security-weakness',
    noUnexpectedAuthRedirect: 'auth-error', maxMutatingRequests: 'invalid-state-transition', noRequestWhenInvalid: 'input-validation', visibleFeedbackOnFailure: 'network-error-handling',
    stillInteractive: 'hang', urlNotMatches: 'broken-navigation', gatedContent: 'auth-error', selectorNotVisible: 'auth-error', selectorVisible: 'ui-interaction', loginFormVisible: 'auth-error',
};
const SEV_RANK = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
/** failure type of the most severe failing expectation; network scenarios about API failures are network-error-handling. */
export function failureTypeFor(s, failing) {
    const worst = [...failing].sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity])[0];
    const t = FAILURE_BY_EXPECTATION[(worst?.type ?? 'noUncaughtExceptions')];
    if (s.category === 'network-failure' && (t === 'unhandled-exception' || t === 'ui-interaction' || t === 'hang'))
        return 'network-error-handling';
    return t;
}
export function humanizeSteps(s, origin) {
    const steps = [];
    const url = (p) => new URL(p, origin).toString();
    const describe = (a) => {
        switch (a.action) {
            case 'goto': return `Open ${url(a.path)}`;
            case 'click': return `Click ${prettySel(a.selector)}`;
            case 'submit': return `Click ${prettySel(a.selector)}`;
            case 'repeatClick': return `Click ${prettySel(a.selector)} ${a.times} times in quick succession`;
            case 'fill': return `Type ${JSON.stringify(a.value.length > 60 ? `${a.value.slice(0, 60)}… (${a.value.length} chars)` : a.value)} into ${prettySel(a.selector)}`;
            case 'fillAll': return a.kind === 'empty' ? 'Leave all fields empty' : `Fill every field in ${a.scope ? prettySel(a.scope) : 'the page'} with ${a.kind === 'valid' ? 'valid' : a.kind === 'xss-marker' ? 'a harmless <img onerror> marker' : a.kind} values`;
            case 'press': return `Press ${a.key}`;
            case 'reload': return 'Reload the page';
            case 'goBack': return 'Press the browser Back button';
            case 'goForward': return 'Press the browser Forward button';
            case 'setViewport': return `Resize the viewport to ${a.width}×${a.height}`;
            case 'setNetwork': return `Make same-origin fetch/XHR requests ${{ offline: 'fail (offline)', http500: 'return HTTP 500', http429: 'return HTTP 429', slow: `respond after ${a.delayMs ?? 3000}ms`, timeout: 'time out' }[a.mode]}`;
            case 'clearNetwork': return 'Restore normal network behavior';
            case 'wait': return null;
            case 'login': return 'Log in with the configured test account';
            case 'logout': return 'Click the configured logout control';
            case 'expireSession': return 'Clear cookies and local/session storage (simulate session expiry)';
            case 'loginWithBadPassword': return 'Attempt ONE login with the test account username and a wrong password';
        }
    };
    for (const a of s.steps) {
        const d = describe(a);
        if (d)
            steps.push(d);
    }
    return steps;
}
export function buildFinding(args) {
    const { scenario: s, failing } = args;
    let severity = 'info';
    for (const f of failing)
        severity = maxSeverity(severity, f.severity);
    const hardReproduced = failing.some((f) => f.hard && args.reproducedTypes.has(f.type));
    let status;
    let confidence;
    if (args.reproductionSkipped) {
        status = 'suspected';
        confidence = failing.some((f) => f.hard) ? 'medium' : 'low';
    }
    else if (!args.reproduced) {
        status = 'not-reproducible';
        confidence = 'low';
    }
    else if (hardReproduced) {
        status = 'confirmed';
        confidence = 'high';
    }
    else {
        status = 'suspected';
        confidence = 'medium';
    }
    const evidence = { ...args.evidence, screenshot: args.screenshot, notes: [...args.evidence.notes] };
    if (args.reproductionSkipped)
        evidence.notes.push(args.reproductionSkipped);
    const expected = [...new Set(failing.map((f) => EXPECTED_TEXT[f.type] ?? f.type))].join(' ');
    const fix = [...new Set(failing.map((f) => FIX_TEXT[f.type]).filter(Boolean))].join(' ') || 'Investigate the evidence and the affected route.';
    return {
        id: `F${String(args.seq).padStart(3, '0')}`,
        scenarioId: s.id,
        title: s.name,
        category: s.category,
        status, severity, confidence,
        route: s.target,
        expected,
        actual: failing.map((f) => f.message).join(' '),
        reproductionSteps: humanizeSteps(s, args.origin),
        reproduction: { attempted: args.attempts > 1, attempts: args.attempts, reproduced: args.reproduced },
        evidence,
        suggestedFix: fix,
        source: 'execution',
        adapter: 'web',
        failureType: failureTypeFor(s, failing),
        evidenceKind: 'observed-defect',
        scope: `web ${s.component ?? s.target}`,
    };
}
export function summarize(results, findings) {
    const bySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    const byCategory = {};
    for (const c of CATEGORIES)
        byCategory[c] = { total: 0, passed: 0, failed: 0 };
    for (const r of results) {
        const c = (byCategory[r.category] ??= { total: 0, passed: 0, failed: 0 });
        if (r.outcome === 'passed') {
            c.total++;
            c.passed++;
        }
        if (r.outcome === 'failed') {
            c.total++;
            c.failed++;
        }
    }
    for (const f of findings)
        if (f.status === 'confirmed' || f.status === 'suspected')
            bySeverity[f.severity]++;
    return {
        total: results.filter((r) => r.outcome === 'passed' || r.outcome === 'failed').length,
        passed: results.filter((r) => r.outcome === 'passed').length,
        failed: results.filter((r) => r.outcome === 'failed').length,
        skipped: results.filter((r) => r.outcome === 'skipped').length,
        blocked: results.filter((r) => r.outcome === 'blocked').length,
        confirmed: findings.filter((f) => f.status === 'confirmed').length,
        suspected: findings.filter((f) => f.status === 'suspected').length,
        notReproducible: findings.filter((f) => f.status === 'not-reproducible').length,
        bySeverity, byCategory,
    };
}
