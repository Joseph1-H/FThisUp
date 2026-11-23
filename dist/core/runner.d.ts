import { type Browser } from 'playwright';
import type { FThisUpConfig } from './config.js';
import type { Finding, RunResults, TestResult } from './types.js';
import type { LiveDiscovery, Manifest, ProjectDiscovery } from '../discovery/types.js';
import { type TargetDecision } from '../safety/policy.js';
import type { Scenario } from '../scenarios/schema.js';
import { type Rejected } from '../scenarios/validate.js';
export interface Progress {
    index: number;
    total: number;
    result: TestResult;
}
export interface RunOptions {
    cwd: string;
    config: FThisUpConfig;
    url: string;
    scenariosFile?: string;
    dryRun?: boolean;
    skipStatic?: boolean;
    onStage?: (stage: string) => void;
    onProgress?: (p: Progress) => void;
}
export declare function probeUrl(url: string, timeoutMs?: number): Promise<{
    ok: boolean;
    detail: string;
}>;
export declare function launchBrowser(config: FThisUpConfig): Promise<Browser>;
export interface Plan {
    decision: TargetDecision;
    project: ProjectDiscovery;
    live: LiveDiscovery;
    scenarios: Scenario[];
    rejected: Rejected[];
    droppedByCap: number;
    staticFindings: Finding[];
}
export declare function plan(opts: RunOptions, browser: Browser, decision: TargetDecision): Promise<Plan>;
export declare function runTests(opts: RunOptions): Promise<{
    results: RunResults;
    manifest: Manifest;
    plan: Plan;
}>;
