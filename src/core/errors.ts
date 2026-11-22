import type { TargetDecision } from '../safety/policy.js';

export class TargetBlockedError extends Error {
  constructor(readonly decision: TargetDecision) { super(decision.reason); }
}
export class TargetUnreachableError extends Error {
  constructor(readonly url: string, readonly detail: string) { super(`Could not reach ${url}: ${detail}`); }
}
export class BrowserMissingError extends Error {}
export class SafetyEnforcementError extends Error {}
