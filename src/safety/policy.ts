import net from 'node:net';
import type { FThisUpConfig } from '../core/config.js';
import type { Scenario } from '../scenarios/schema.js';

export type TargetClass = 'loopback' | 'private-network' | 'remote' | 'invalid';
export type TargetEnvironment = 'local' | 'staging' | 'production';

export interface TargetDecision {
  allowed: boolean;
  reason: string;
  /** actionable guidance when blocked */
  hint?: string;
  targetClass: TargetClass;
  environment: TargetEnvironment;
  origin?: string;
  hostname?: string;
  /** production targets are strictly read-only */
  readOnly: boolean;
  notes: string[];
}

export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '::1' || h === '0:0:0:0:0:0:0:1') return true;
  if (net.isIPv4(h)) return h.startsWith('127.') || h === '0.0.0.0';
  // IPv4-mapped IPv6 loopback
  if (/^::ffff:127\./i.test(h)) return true;
  return false;
}

export function isLinkLocalOrMetadata(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (net.isIPv4(h) && h.startsWith('169.254.')) return true;
  if (/^fe80:/i.test(h)) return true;
  return h === 'metadata.google.internal';
}

export function isPrivateNetworkHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (net.isIPv4(h)) {
    const [a, b] = h.split('.').map(Number) as [number, number];
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (net.isIPv6(h)) return /^f[cd]/i.test(h);
  return h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan');
}

/** Decide whether FThisUp may test this target at all. Pure function: easy to unit test. */
export function evaluateTarget(rawUrl: string, config: Pick<FThisUpConfig, 'safety'>): TargetDecision {
  const base: TargetDecision = { allowed: false, reason: '', targetClass: 'invalid', environment: 'local', readOnly: false, notes: [] };
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ...base, reason: `Not a valid URL: ${rawUrl}` };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ...base, reason: `Unsupported protocol ${url.protocol} (only http and https)` };
  }
  if (url.username || url.password) {
    return { ...base, reason: 'URLs with embedded credentials are refused (credentials must come from environment variables).' };
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const common = { origin: url.origin, hostname };

  if (isLinkLocalOrMetadata(hostname)) {
    return { ...base, ...common, reason: `${hostname} is a link-local / cloud-metadata address and is never tested.` };
  }
  if (isLoopbackHost(hostname)) {
    return { ...base, ...common, allowed: true, reason: 'Loopback target (local development).', targetClass: 'loopback', environment: 'local', readOnly: false };
  }

  const s = config.safety;
  const targetClass: TargetClass = isPrivateNetworkHost(hostname) ? 'private-network' : 'remote';
  const hostPort = url.host.toLowerCase();
  const listed = s.allowedHosts.map((h) => h.toLowerCase()).some((h) => h === hostname.toLowerCase() || h === hostPort);
  if (!listed) {
    return {
      ...base, ...common, targetClass,
      reason: `${hostname} is not a loopback address and is not in safety.allowedHosts.`,
      hint: `FThisUp only tests localhost by default. If you own or are authorized to test this host, add it to "safety.allowedHosts", set "safety.authorized": true and "safety.environment" to "staging" (or "production" for read-only checks) in fthisup.config.json.`,
    };
  }
  if (!s.authorized) {
    return {
      ...base, ...common, targetClass,
      reason: `${hostname} is allow-listed but "safety.authorized" is not true.`,
      hint: 'Set "safety.authorized": true only if you own this system or have explicit written authorization to test it.',
    };
  }
  if (s.environment === 'local') {
    return {
      ...base, ...common, targetClass,
      reason: `${hostname} is not a local address, but safety.environment is "local".`,
      hint: 'Declare the real environment: "safety.environment": "staging" or "production".',
    };
  }
  const readOnly = s.environment === 'production';
  return {
    ...base, ...common, targetClass, allowed: true, environment: s.environment, readOnly,
    reason: `Authorized ${s.environment} target ${hostname}.`,
    notes: readOnly
      ? ['Production target: running READ-ONLY. Form submission, login and every mutating request are blocked.']
      : ['Staging target: form submission is OFF unless safety.allowFormSubmission is true.'],
  };
}

export function resolveSameOrigin(origin: string, p: string): string | null {
  if (/^\s*(javascript|data|file|blob):/i.test(p)) return null;
  try {
    const u = new URL(p, origin);
    if (u.origin !== origin) return null;
    return u.toString();
  } catch {
    return null;
  }
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const STATIC_TYPES = new Set(['script', 'stylesheet', 'font', 'image', 'media']);

export type RequestVerdict = { allow: true } | { allow: false; reason: string; kind: 'external' | 'mutation' | 'budget' };

/**
 * Enforcement object used by the executor for EVERY scenario and EVERY browser request.
 * Nothing in the scenario file can switch these checks off.
 */
export class SafetyGuard {
  private readonly allowedOrigins = new Set<string>();
  private readonly allowedHostnames: Set<string>;
  private tokens: number;
  private lastRefill = Date.now();
  private scenarioRequests = 0;
  constructor(
    readonly decision: TargetDecision,
    private readonly config: Pick<FThisUpConfig, 'safety'>,
    private readonly scope: { isForeignPort?: (port: number) => boolean } = {},
  ) {
    if (!decision.allowed || !decision.origin) throw new Error('SafetyGuard requires an allowed target decision');
    this.allowedOrigins.add(decision.origin);
    this.allowedHostnames = new Set(config.safety.allowedHosts.map((h) => h.toLowerCase()));
    this.tokens = config.safety.maxRequestsPerSecond;
  }

  get origin(): string { return this.decision.origin!; }

  get mutationsAllowed(): boolean {
    if (this.decision.readOnly) return false;
    const configured = this.config.safety.allowFormSubmission;
    if (configured !== undefined) return configured;
    return this.decision.targetClass === 'loopback';
  }

  beginScenario(): void { this.scenarioRequests = 0; }

  private isAllowedOrigin(u: URL): boolean {
    if (this.allowedOrigins.has(u.origin)) return true;
    // Local development commonly splits UI and API across loopback ports.
    // ...but never a local server that belongs to a DIFFERENT project (when its owner can be determined).
    if (this.decision.targetClass === 'loopback' && isLoopbackHost(u.hostname)) return !this.scope.isForeignPort?.(Number(u.port));
    return this.allowedHostnames.has(u.hostname.toLowerCase()) || this.allowedHostnames.has(u.host.toLowerCase());
  }

  /** Static, pre-flight decision for a whole scenario. */
  checkScenario(s: Scenario): { allowed: boolean; reason?: string } {
    const approved = new Set(this.config.safety.approvedActions);
    if (resolveSameOrigin(this.origin, s.target) === null) return { allowed: false, reason: `target "${s.target}" is outside the authorized origin` };
    for (const step of s.steps) {
      if (step.action === 'goto' && resolveSameOrigin(this.origin, step.path) === null) {
        return { allowed: false, reason: `step goto "${step.path}" leaves the authorized origin` };
      }
    }
    if (s.requiresApproval) {
      const need = s.sensitivity ?? 'irreversible';
      if (!approved.has(need)) return { allowed: false, reason: `scenario involves a "${need}" action and needs approval (add "${need}" to safety.approvedActions)` };
    } else if (s.risk === 'high' && !approved.has('irreversible')) {
      return { allowed: false, reason: 'high-risk scenario requires "irreversible" in safety.approvedActions' };
    }
    const mutates = s.steps.some((st) => ['submit', 'repeatClick', 'login', 'loginWithBadPassword', 'logout'].includes(st.action));
    if (mutates && !this.mutationsAllowed) {
      return {
        allowed: false,
        reason: this.decision.readOnly
          ? 'production targets are read-only; scenarios that submit forms or log in are blocked'
          : 'form submission is disabled for this target (set safety.allowFormSubmission to true to allow it)',
      };
    }
    return { allowed: true };
  }

  /** Runtime decision for every request the browser makes. */
  async checkRequest(urlStr: string, method: string, resourceType: string): Promise<RequestVerdict> {
    let u: URL;
    try { u = new URL(urlStr); } catch { return { allow: true }; } // data:, blob:, about: have no network effect
    if (u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'about:') return { allow: true };
    if (u.protocol === 'ws:' || u.protocol === 'wss:') {
      return this.isAllowedOrigin(new URL(u.href.replace(/^ws/, 'http'))) ? { allow: true } : { allow: false, kind: 'external', reason: 'external websocket' };
    }
    if (isLinkLocalOrMetadata(u.hostname)) return { allow: false, kind: 'external', reason: 'link-local/metadata address' };
    const m = method.toUpperCase();
    if (!this.isAllowedOrigin(u)) {
      const okAsset = this.config.safety.allowThirdPartyAssets && m === 'GET' && STATIC_TYPES.has(resourceType);
      if (!okAsset) return { allow: false, kind: 'external', reason: `third-party origin ${u.origin} is never contacted` };
    }
    if (MUTATING.has(m) && !this.mutationsAllowed) {
      return { allow: false, kind: 'mutation', reason: `${m} blocked: mutations are disabled for this target` };
    }
    if (++this.scenarioRequests > this.config.safety.maxRequestsPerScenario) {
      return { allow: false, kind: 'budget', reason: `request budget (${this.config.safety.maxRequestsPerScenario}/scenario) exhausted` };
    }
    await this.throttle();
    return { allow: true };
  }

  get budgetExceeded(): boolean { return this.scenarioRequests > this.config.safety.maxRequestsPerScenario; }

  /** Token bucket: caps request rate regardless of how fast scenarios run. */
  private async throttle(): Promise<void> {
    const rate = this.config.safety.maxRequestsPerSecond;
    for (;;) {
      const now = Date.now();
      this.tokens = Math.min(rate, this.tokens + ((now - this.lastRefill) / 1000) * rate);
      this.lastRefill = now;
      if (this.tokens >= 1) { this.tokens -= 1; return; }
      await new Promise((r) => setTimeout(r, Math.ceil(1000 / rate)));
    }
  }
}
