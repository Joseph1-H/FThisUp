import type { Scenario } from '../scenarios/schema.js';
import type { ExpectationResult, FailureType, Finding, Evidence, RunSummary, TestResult } from './types.js';
/** failure type of the most severe failing expectation; network scenarios about API failures are network-error-handling. */
export declare function failureTypeFor(s: Scenario, failing: ExpectationResult[]): FailureType;
export declare function humanizeSteps(s: Scenario, origin: string): string[];
export declare function buildFinding(args: {
    scenario: Scenario;
    origin: string;
    failing: ExpectationResult[];
    evidence: Evidence;
    screenshot?: string;
    attempts: number;
    reproduced: boolean;
    reproductionSkipped?: string;
    seq: number;
    reproducedTypes: Set<string>;
}): Finding;
export declare function summarize(results: TestResult[], findings: Finding[]): RunSummary;
