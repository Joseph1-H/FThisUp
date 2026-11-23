import type { ProjectContext } from '../adapters/types.js';
import type { Finding, TestResult } from '../core/types.js';
import { type FlutterAppMap } from './flutter/map.js';
import { type DiscoveryReport } from './types.js';
export interface DiscoveryRunOptions {
    ctx: ProjectContext;
    mode: 'safe' | 'thorough';
    dryRun?: boolean;
    outDir: string;
    /** adapters named with --adapter; when set and not containing "flutter", Flutter discovery is skipped */
    adapters?: string[];
    onStage?: (s: string) => void;
    /** baseline (existing test) results per component, for the report */
    baseline?: Array<{
        component: string;
        passed: number;
        failed: number;
    }>;
}
export interface DiscoveryOutcome {
    report: DiscoveryReport;
    results: TestResult[];
    findings: Finding[];
    artifacts: Record<string, unknown>;
    notes: string[];
    /** generated Dart test sources worth keeping as evidence: relative path → text */
    testFiles: Record<string, string>;
}
/** What autonomous discovery can and cannot do for each detected component. Never claims more than is implemented. */
export declare function supportMatrix(ctx: ProjectContext): DiscoveryReport['support'];
export declare function buildMaps(ctx: ProjectContext): FlutterAppMap[];
export declare function loadAgentFiles(ctx: ProjectContext): {
    files: string[];
    flutter: Array<{
        file: string;
        component?: string;
        scenarios: unknown[];
    }>;
    errors: string[];
};
export declare function runDiscovery(opts: DiscoveryRunOptions): Promise<DiscoveryOutcome>;
