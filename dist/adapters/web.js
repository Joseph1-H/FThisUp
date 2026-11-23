import fs from 'node:fs';
import { chromium } from 'playwright';
import { runTests, probeUrl } from '../core/runner.js';
import { TargetBlockedError, TargetUnreachableError } from '../core/errors.js';
import { evaluateTarget } from '../safety/policy.js';
function chromiumInstalled(ctx) {
    if (ctx.config.browserChannel)
        return true;
    try {
        const e = chromium.executablePath();
        return !!e && fs.existsSync(e);
    }
    catch {
        return false;
    }
}
async function rootKind(url) {
    try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 4000);
        const r = await fetch(url, { signal: ctl.signal, redirect: 'manual', headers: { accept: 'text/html' } });
        clearTimeout(t);
        return /text\/html/i.test(r.headers.get('content-type') ?? '') || (r.status >= 300 && r.status < 400) ? 'html' : 'other';
    }
    catch {
        return 'unreachable';
    }
}
const webComponent = (ctx) => ctx.manifest.components.find((c) => c.roles.includes('web-app')) ?? ctx.manifest.components[0];
export const webAdapter = {
    id: 'web',
    name: 'Web application (Playwright)',
    description: 'Drives a real Chromium against your running web app: navigation, forms, network failures, viewports, auth.',
    requirements: ['a running web app on localhost (or an authorized target)', 'Playwright Chromium (npx playwright install chromium)'],
    categories: ['navigation', 'form-validation', 'ui-chaos', 'network-failure', 'authentication'],
    safety: ['target allow-list + loopback default', 'every browser request passes the SafetyGuard', 'third-party origins never contacted', 'destructive actions need approval', 'request-rate and budget caps', 'production is read-only'],
    resourceGroup: 'network',
    async detect(ctx) {
        const comp = ctx.manifest.components.filter((c) => c.roles.includes('web-app'));
        const ids = comp.map((c) => c.id);
        if (!ctx.target.url) {
            return { applicable: comp.length > 0, confidence: comp.length ? 'medium' : 'low', components: ids, reason: comp.length ? 'web app detected in the project, but no running server was found' : 'no web app detected and no running server found' };
        }
        // the safety policy decides BEFORE any request is made: an unauthorized host is never even probed
        const policy = evaluateTarget(ctx.target.url, ctx.config);
        if (!policy.allowed) {
            return ctx.target.source === 'cli'
                ? { applicable: true, confidence: 'high', components: ids, reason: 'target URL supplied with --url (blocked by the safety policy; nothing will be contacted)' }
                : { applicable: false, confidence: 'low', components: ids, reason: `target blocked by the safety policy: ${policy.reason}` };
        }
        if (comp.length)
            return { applicable: true, confidence: 'high', components: ids, reason: 'web framework detected and a server is running' };
        const kind = await rootKind(ctx.target.url);
        // an explicit --url that cannot be reached stays applicable so the user gets the familiar "could not reach" error
        if (ctx.target.source === 'cli' && kind !== 'other')
            return { applicable: true, confidence: 'high', components: ids, reason: 'target URL supplied with --url' };
        return { applicable: kind === 'html', confidence: kind === 'html' ? 'medium' : 'low', components: ids, reason: kind === 'html' ? 'the running server serves HTML at /' : 'the running server does not serve HTML at / (looks like an API; see the api adapter)' };
    },
    async capabilities(ctx) {
        const installed = chromiumInstalled(ctx);
        return [
            { id: 'browser', label: 'Playwright Chromium', available: installed, reason: installed ? undefined : 'Chromium is not installed', setup: installed ? undefined : 'npx playwright install chromium' },
            { id: 'running-app', label: 'Running web app', available: !!ctx.target.url, reason: ctx.target.url ? ctx.target.url : 'no URL given and nothing found on common local ports', setup: ctx.target.url ? undefined : 'start your dev server, or pass --url http://localhost:PORT' },
        ];
    },
    async plan(ctx, options) {
        const caps = await this.capabilities(ctx);
        const missing = caps.filter((c) => !c.available).map((c) => ({ what: c.label + ': ' + (c.reason ?? ''), setup: c.setup }));
        const base = { adapterId: 'web', capabilities: caps, components: (await this.detect(ctx)).components, notes: [], tests: [] };
        if (missing.length)
            return { ...base, status: 'unavailable', reason: missing.map((m) => m.what).join('; '), missing };
        const plan = { ...base, status: 'ready', missing: [], notes: ['Scenarios are generated after live discovery (crawl) of the running app.'] };
        if (options.dryRun) {
            const r = await runTests({ cwd: ctx.root, config: ctx.config, url: ctx.target.url, scenariosFile: options.scenariosFile, dryRun: true, skipStatic: true });
            plan.tests = r.plan.scenarios.map((s) => ({ id: s.id, name: s.name, category: s.category, component: base.components[0] ?? '', risk: s.risk, requiresApproval: s.requiresApproval, description: s.description }));
            plan.droppedByCap = r.plan.droppedByCap;
            plan.state = { rejected: r.plan.rejected };
        }
        return plan;
    },
    async execute(plan, exec) {
        const { project, options } = exec;
        const url = project.target.url;
        const comp = webComponent(project)?.id;
        const strict = project.target.source === 'cli'; // preserve v0.1 behaviour: errors for an explicit --url abort the run
        try {
            const d = evaluateTarget(url, project.config);
            if (!d.allowed)
                throw new TargetBlockedError(d);
            const probe = await probeUrl(url);
            if (!probe.ok)
                throw new TargetUnreachableError(url, probe.detail);
            const { results, manifest, plan: wp } = await runTests({
                cwd: project.root, config: project.config, url, scenariosFile: options.scenariosFile, skipStatic: true,
                onStage: exec.onStage, onProgress: (p) => exec.onProgress?.({ ...p.result, adapter: 'web', component: comp }),
            });
            const tag = (x) => ({ ...x, adapter: 'web', component: comp });
            return {
                results: results.results.map(tag),
                findings: results.findings.map((f) => tag(f)),
                notes: results.coverage.notes,
                artifacts: { 'discovery.json': manifest, 'rejected-scenarios': wp.rejected.length },
                coverage: results.coverage,
                safety: results.safety,
                environment: { browser: results.environment.browser, browserVersion: results.environment.browserVersion, headless: results.environment.headless },
            };
        }
        catch (e) {
            if (strict)
                throw e;
            if (e instanceof TargetBlockedError)
                return { results: [], findings: [], notes: [], blocked: e.decision.reason };
            if (e instanceof TargetUnreachableError)
                return { results: [], findings: [], notes: [`Web target not reachable: ${e.message}`], blocked: undefined, artifacts: { unreachable: e.message } };
            throw e;
        }
    },
};
