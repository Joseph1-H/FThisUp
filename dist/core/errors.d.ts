import type { TargetDecision } from '../safety/policy.js';
export declare class TargetBlockedError extends Error {
    readonly decision: TargetDecision;
    constructor(decision: TargetDecision);
}
export declare class TargetUnreachableError extends Error {
    readonly url: string;
    readonly detail: string;
    constructor(url: string, detail: string);
}
export declare class BrowserMissingError extends Error {
}
export declare class SafetyEnforcementError extends Error {
}
