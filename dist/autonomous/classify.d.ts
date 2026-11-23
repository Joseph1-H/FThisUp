import type { FailureType, Severity } from '../core/types.js';
import type { RawPayload, RawRun } from './flutter/execute.js';
/** Failures of the isolated test environment, not of the application. Anything matching is never reported as a bug. */
export declare const ENVIRONMENT_PATTERNS: Array<[RegExp, string]>;
export declare function environmentReason(texts: string[]): string | undefined;
export type Verdict = {
    kind: 'pass';
} | {
    kind: 'invalid';
    reason: string;
} | {
    kind: 'environment';
    reason: string;
} | {
    kind: 'fail';
    hard: boolean;
    items: string[];
    sig: string;
    payload?: RawPayload;
    framework: string[];
};
/** Turn one raw run into a verdict. Order matters: test-validity problems are ruled out BEFORE anything can be called a failure. */
export declare function judge(run: RawRun | undefined, timedOut: boolean): Verdict;
export declare function classifyFailure(items: string[], feature: string): {
    failureType: FailureType;
    severity: Severity;
};
