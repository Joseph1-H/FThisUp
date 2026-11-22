import type { Browser, BrowserContext, Page, Request, Route } from 'playwright';
import type { SafetyGuard } from '../../safety/policy.js';
import type { ConsoleEntry, Evidence, NetworkEntry } from '../../core/types.js';

export type NetMode = 'offline' | 'http500' | 'http429' | 'slow' | 'timeout';
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export class Recorder {
  consoleErrors: ConsoleEntry[] = [];
  pageErrors: string[] = [];
  failures: NetworkEntry[] = [];
  responses: NetworkEntry[] = [];
  mutating: NetworkEntry[] = [];
  blocked: NetworkEntry[] = [];
  apiCalls: NetworkEntry[] = [];
  injectedHits = 0;
  navigations: string[] = [];
  redirectLoop = false;
  xssTriggered = false;
  budgetExceeded = false;
  mainStatus: number | null = null;
  notes: string[] = [];

  toEvidence(): Evidence {
    return {
      consoleErrors: this.consoleErrors.slice(0, 20),
      pageErrors: [...new Set(this.pageErrors)].slice(0, 20),
      networkFailures: this.failures.slice(0, 30),
      mutatingRequests: this.mutating.slice(0, 30),
      blockedRequests: this.blocked.slice(0, 30),
      notes: this.notes.slice(0, 20),
    };
  }
}

export class Session {
  net: { mode: NetMode | null; delayMs?: number } = { mode: null };
  readonly injected = new WeakSet<Request>();
  constructor(readonly context: BrowserContext, readonly page: Page, readonly recorder: Recorder, readonly guard: SafetyGuard) {}

  setNetwork(mode: NetMode, delayMs?: number): Promise<void> {
    this.net = { mode, delayMs };
    return mode === 'offline' ? this.context.setOffline(true) : Promise.resolve();
  }
  async clearNetwork(): Promise<void> {
    this.net = { mode: null };
    await this.context.setOffline(false);
  }
  async close(): Promise<void> {
    await this.context.close().catch(() => undefined);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isIgnorableUrl = (u: string) => /\/favicon\.ico(\?|$)/.test(u);

export async function createSession(
  browser: Browser,
  guard: SafetyGuard,
  opts: { viewport?: { width: number; height: number }; secrets?: string[] } = {},
): Promise<Session> {
  const context = await browser.newContext({
    viewport: opts.viewport ?? { width: 1280, height: 800 },
    serviceWorkers: 'block',
    acceptDownloads: false,
    permissions: [],
    ignoreHTTPSErrors: false,
  });
  const page = await context.newPage();
  const recorder = new Recorder();
  const session = new Session(context, page, recorder, guard);

  await page.exposeFunction('__fthisupXss', () => { recorder.xssTriggered = true; });
  await page.exposeFunction('__fthisupRejection', (msg: string) => { recorder.pageErrors.push(`Unhandled promise rejection: ${String(msg).slice(0, 400)}`); });
  await page.addInitScript(() => {
    window.addEventListener('unhandledrejection', (e) => {
      const r = e.reason as { stack?: string; message?: string } | string | undefined;
      const msg = typeof r === 'string' ? r : r?.stack ?? r?.message ?? String(r);
      (window as unknown as { __fthisupRejection?: (m: string) => void }).__fthisupRejection?.(msg);
    });
  });

  // Enforcement point: EVERY request from this context passes through the safety guard.
  await context.route('**/*', async (route: Route) => {
    const req = route.request();
    const method = req.method();
    const type = req.resourceType();
    const verdict = await guard.checkRequest(req.url(), method, type);
    if (!verdict.allow) {
      recorder.blocked.push({ method, url: req.url(), failure: verdict.reason, resourceType: type, injected: true });
      if (verdict.kind === 'budget') recorder.budgetExceeded = true;
      session.injected.add(req);
      await route.abort('blockedbyclient').catch(() => undefined);
      return;
    }
    const sameApp = new URL(req.url()).origin === guard.origin;
    const faultable = (type === 'fetch' || type === 'xhr') && sameApp;
    if (faultable) recorder.apiCalls.push({ method, url: req.url(), resourceType: type });
    if (faultable && session.net.mode && session.net.mode !== 'offline') {
      recorder.injectedHits++;
      session.injected.add(req);
      const mode = session.net.mode;
      try {
        if (mode === 'http500') await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"fthisup injected failure"}' });
        else if (mode === 'http429') await route.fulfill({ status: 429, contentType: 'application/json', headers: { 'retry-after': '1' }, body: '{"error":"fthisup injected rate limit"}' });
        else if (mode === 'timeout') { await sleep(session.net.delayMs ?? 5000); await route.abort('timedout'); }
        else if (mode === 'slow') { await sleep(session.net.delayMs ?? 3000); session.injected.delete(req); await route.continue(); }
      } catch { /* page closed mid-flight */ }
      return;
    }
    if (faultable && session.net.mode === 'offline') recorder.injectedHits++;
    await route.continue().catch(() => undefined);
  });

  page.on('pageerror', (e) => recorder.pageErrors.push(`${e.name}: ${e.message}`.slice(0, 500)));
  page.on('crash', () => recorder.pageErrors.push('Page crashed'));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (/^Failed to load resource/i.test(text)) return; // represented as a network entry instead
    recorder.consoleErrors.push({ type: 'error', text: text.slice(0, 500), url: m.location().url });
  });
  page.on('request', (r) => {
    if (MUTATING.has(r.method()) && !isIgnorableUrl(r.url())) {
      recorder.mutating.push({ method: r.method(), url: r.url(), resourceType: r.resourceType(), injected: false });
    }
  });
  page.on('requestfailed', (r) => {
    if (session.injected.has(r) || isIgnorableUrl(r.url())) return;
    const failure = r.failure()?.errorText ?? 'failed';
    if (/ERR_ABORTED/.test(failure)) return; // navigations cancelled by newer navigations
    recorder.failures.push({ method: r.method(), url: r.url(), failure, resourceType: r.resourceType() });
  });
  page.on('response', (resp) => {
    const r = resp.request();
    const entry: NetworkEntry = { method: r.method(), url: resp.url(), status: resp.status(), resourceType: r.resourceType(), injected: session.injected.has(r) };
    recorder.responses.push(entry);
    if (entry.injected || isIgnorableUrl(resp.url())) return;
    if (resp.status() >= 400) recorder.failures.push(entry);
  });
  page.on('framenavigated', (f) => {
    if (f !== page.mainFrame()) return;
    recorder.navigations.push(f.url());
  });
  return session;
}

/** Wait for the page to be reasonably quiet without hanging on long-polling apps. */
export async function settle(page: Page, ms = 250): Promise<void> {
  await page.waitForLoadState('load', { timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(ms).catch(() => undefined);
}
