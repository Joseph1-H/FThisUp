import type { ProjectContext, TestAdapter, TestOptions, TestPlan } from '../adapters/types.js';
import type { FThisUpConfig } from './config.js';
import type { AdapterStatus, RunResults, TestResult } from './types.js';
export interface OrchestratorOptions {
    root: string;
    config: FThisUpConfig;
    explicitUrl?: string;
    apiUrl?: string;
    /** adapters named with --adapter (empty = automatic selection) */
    adapters?: string[];
    all?: boolean;
    scenariosFile?: string;
    dryRun?: boolean;
    skipStatic?: boolean;
    /** concurrency across adapters (default 2) */
    parallel?: number;
    onStage?: (s: string) => void;
    onProgress?: (adapterId: string, r: TestResult) => void;
    /** called once, after planning and before any execution */
    onPlan?: (p: PlannedRun) => void;
}
export interface Selection {
    adapter: TestAdapter;
    explicit: boolean;
    status: AdapterStatus;
    reason?: string;
    components: string[];
    plan?: TestPlan;
}
export declare class UnknownAdapterError extends Error {
}
export interface PlannedRun {
    ctx: ProjectContext;
    options: TestOptions;
    selections: Selection[];
}
export declare function planRun(opts: OrchestratorOptions): Promise<PlannedRun>;
export interface OrchestrationResult {
    results: RunResults;
    planned: PlannedRun;
    artifacts: Record<string, unknown>;
    /** an explicitly requested adapter could not run (exit code 4) */
    explicitProblems: Array<{
        id: string;
        reason: string;
    }>;
    blocked: Array<{
        id: string;
        reason: string;
    }>;
}
export declare function orchestrate(opts: OrchestratorOptions): Promise<OrchestrationResult>;
