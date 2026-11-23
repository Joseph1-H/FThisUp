import type { Browser } from 'playwright';
import type { FThisUpConfig } from '../../core/config.js';
import type { Evidence, ExpectationResult } from '../../core/types.js';
import { type SafetyGuard } from '../../safety/policy.js';
import type { Scenario } from '../../scenarios/schema.js';
export declare class SkipScenario extends Error {
}
export declare class SafetyViolation extends Error {
}
export interface TestAccount {
    username: string;
    password: string;
}
export interface ExecEnv {
    browser: Browser;
    guard: SafetyGuard;
    config: FThisUpConfig;
    account?: TestAccount;
}
export interface ExecOutcome {
    skipped?: string;
    violation?: string;
    expectations: ExpectationResult[];
    evidence: Evidence;
    screenshot?: Buffer;
    durationMs: number;
}
export declare function executeScenario(s: Scenario, env: ExecEnv, opts: {
    screenshot: boolean;
}): Promise<ExecOutcome>;
