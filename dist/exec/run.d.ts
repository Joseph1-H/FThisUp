import { type SandboxMode } from './sandbox.js';
export declare class ExecBlockedError extends Error {
}
/** Child processes never inherit secrets, even if the user's shell has them. */
export declare function cleanEnv(extra?: Record<string, string>): Record<string, string>;
/** Allowed = a known tool on the allowlist, or a binary located inside the project. Shells are never allowed. */
export declare function assertAllowed(file: string, projectRoot: string): void;
export interface RunSpec {
    file: string;
    args: string[];
    cwd: string;
    projectRoot: string;
    timeoutMs: number;
    stdin?: string | Buffer | null;
    env?: Record<string, string>;
    maxOutputBytes?: number;
    /** send a signal after N ms (tests graceful shutdown) */
    signalAfterMs?: {
        ms: number;
        signal: NodeJS.Signals;
    };
    sandbox?: SandboxMode;
    /** writable scratch dir when sandboxed (created if missing) */
    scratch?: string;
    /** apply prlimit CPU/file-size limits where available */
    limits?: boolean;
    /** keep stdin open (no EOF) until the process exits, e.g. to test interruption of an input-waiting program */
    keepStdinOpen?: boolean;
}
export interface RunOutcome {
    exitCode: number | null;
    signal: string | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    truncated: boolean;
    durationMs: number;
    spawnError?: string;
    sandboxed: boolean;
    command: string;
}
export declare function newScratch(root: string): string;
export declare function cleanupScratch(dir: string): void;
export declare function killTree(pid: number, signal: NodeJS.Signals): void;
export declare function runProcess(spec: RunSpec): Promise<RunOutcome>;
