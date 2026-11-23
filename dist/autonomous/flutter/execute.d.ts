import { type CodegenContext } from './codegen.js';
import type { FlutterScenario } from './schema.js';
export interface Workspace {
    dir: string;
    root: string;
    copied: string[];
    generatedDir: string;
}
export declare function treeHash(dir: string, include: (rel: string) => boolean): string;
export declare function createWorkspace(compDir: string): Workspace;
export declare function destroyWorkspace(ws: Workspace): boolean;
export interface RawPayload {
    status: 'ok' | 'failed' | 'setup' | 'baseline';
    observed: Array<{
        where: string;
        type: string;
        message: string;
        stack: string[];
    }>;
    failed: Array<{
        where: string;
        message: string;
    }>;
    network: string[];
    extra?: unknown;
}
export interface RawRun {
    payload?: RawPayload;
    frameworkErrors: string[];
    loadError?: string;
    ran: boolean;
}
/** Parse `flutter test --reporter json` output into a per-scenario view. */
export declare function parseGenerated(stdout: string, ids: string[]): Map<string, RawRun>;
export interface RunBatch {
    stdout: string;
    stderr: string;
    exitCode: number | null;
    timedOut: boolean;
    spawnError?: string;
    durationMs: number;
    command: string;
}
export declare function flutterPubGet(ws: Workspace, timeoutMs: number): Promise<RunBatch>;
export declare function runGeneratedTests(ws: Workspace, files: string[], perTestSeconds: number, totalTimeoutMs: number): Promise<RunBatch>;
export declare function writeScenarioTests(ws: Workspace, scenarios: FlutterScenario[], cg: CodegenContext): Array<{
    id: string;
    file: string;
    source: string;
}>;
