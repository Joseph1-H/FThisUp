/** Failures of the isolated test environment, not of the application. Anything matching is never reported as a bug. */
export const ENVIRONMENT_PATTERNS = [
    [/FTHISUP_NETWORK_BLOCKED|SocketException|HandshakeException|HttpException|Failed host lookup/i, 'the app tried to use the network; generated tests run with the network blocked (no test double for the backend)'],
    [/MissingPluginException|No implementation found for method/i, 'a platform plugin is not available in a plain widget test'],
    [/PlatformException/i, 'a platform channel call failed in a plain widget test'],
    [/You must initialize the supabase|Supabase\.instance|supabase.*not.*initiali[sz]ed|Firebase.*not.*initiali[sz]ed|No Firebase App/i, 'the screen needs an initialised backend (Supabase/Firebase) which does not exist in an isolated test'],
    [/Could not find the correct Provider|ProviderNotFoundException|No ProviderScope found|ProviderScope|Bad state: No (?:BlocProvider|\w+) found|GetIt|Get\.find/i, 'the screen needs dependency-injection providers that the isolated test does not set up'],
    [/No MediaQuery widget|No Directionality widget|No Material widget found|No Overlay widget found|Navigator operation requested with a context that does not include a Navigator|No (?:Scaffold|Theme|Localizations) widget/i, 'the screen needs an ancestor widget the test harness did not provide'],
    [/Binding has not yet been initialized|LateInitializationError.*(?:supabase|client|prefs|database)/i, 'a required service was not initialised in the isolated test'],
];
export function environmentReason(texts) {
    for (const t of texts)
        for (const [re, why] of ENVIRONMENT_PATTERNS)
            if (re.test(t))
                return why;
    return undefined;
}
const flat = (s) => s.replace(/#[0-9a-f]{4,}/gi, '#').replace(/\d+(?:\.\d+)?/g, 'N').replace(/\s+/g, ' ').slice(0, 140);
const NOISE = /overrode FlutterError\.onError/;
/** Turn one raw run into a verdict. Order matters: test-validity problems are ruled out BEFORE anything can be called a failure. */
export function judge(run, timedOut) {
    if (!run || !run.ran) {
        if (run?.loadError)
            return { kind: 'invalid', reason: `the generated test did not compile/load: ${run.loadError.slice(0, 300)}` };
        return timedOut ? { kind: 'environment', reason: 'the test run hit the time budget before this test started' } : { kind: 'invalid', reason: 'the test never started' };
    }
    const framework = run.frameworkErrors.filter((e) => !NOISE.test(e));
    const p = run.payload;
    if (!p) {
        if (timedOut)
            return { kind: 'environment', reason: 'the test run hit the time budget' };
        if (framework.some((e) => /TimeoutException|timed out/i.test(e)))
            return { kind: 'fail', hard: false, items: [`test timed out (possible hang): ${framework[0]}`], sig: 'timeout', framework };
        if (framework.length) {
            const env = environmentReason(framework);
            if (env)
                return { kind: 'environment', reason: env };
            return { kind: 'fail', hard: false, items: framework.map((e) => `uncaught error outside the widget tree: ${e}`), sig: framework.map(flat).join('|'), framework };
        }
        return { kind: 'invalid', reason: 'the test produced no result record' };
    }
    if (p.status === 'setup')
        return { kind: 'invalid', reason: `test setup/precondition failed: ${String(p.extra ?? 'unknown')}` };
    const texts = [...p.observed.map((o) => `${o.type}: ${o.message}`), ...p.failed.map((f) => f.message), ...framework];
    const env = environmentReason(texts);
    if (p.status === 'baseline')
        return { kind: 'environment', reason: `the screen already threw while being built, before any interaction (${env ?? 'it probably needs providers, a backend or arguments that an isolated test cannot supply'}): ${texts[0]?.slice(0, 220) ?? ''}` };
    if (p.status === 'ok' && !framework.length)
        return { kind: 'pass' };
    if (env)
        return { kind: 'environment', reason: env };
    const items = [...p.observed.map((o) => `[${o.where}] ${o.type}: ${o.message}`), ...p.failed.map((f) => `[${f.where}] ${f.message}`), ...framework.map((e) => `[framework] ${e}`)];
    const sig = [...p.observed.map((o) => `${o.type}:${flat(o.message)}`), ...p.failed.map((f) => `${f.where}:${flat(f.message)}`), ...framework.map(flat)].join('|');
    return { kind: 'fail', hard: p.status === 'failed', items, sig, payload: p, framework };
}
export function classifyFailure(items, feature) {
    const t = items.join(' ');
    if (/overflowed/i.test(t))
        return { failureType: 'layout-defect', severity: 'low' };
    if (/setState\(\) called after dispose|used after being disposed|was disposed|dispose\(\) called more than once|Looking up a deactivated widget/i.test(t))
        return { failureType: 'invalid-state-transition', severity: 'medium' };
    if (/Null check operator|type 'Null' is not a subtype|RangeError|NoSuchMethodError|StateError|Bad state|FormatException|Unhandled Exception/i.test(t))
        return { failureType: 'unhandled-exception', severity: 'high' };
    if (/Timer is still pending/i.test(t))
        return { failureType: 'resource-usage', severity: 'low' };
    if (/timed out|TimeoutException/i.test(t))
        return { failureType: 'hang', severity: 'medium' };
    if (/exception|error/i.test(t) && !/expected /i.test(t))
        return { failureType: 'unhandled-exception', severity: 'medium' };
    if (/duplicate|twice|double|rapid|repeated|pending/i.test(`${feature} ${t}`))
        return { failureType: 'invalid-state-transition', severity: 'medium' };
    if (/negative|invalid|empty|reject|validat|bound|positive/i.test(`${feature} ${t}`))
        return { failureType: 'input-validation', severity: 'medium' };
    return { failureType: 'incorrect-output', severity: 'medium' };
}
