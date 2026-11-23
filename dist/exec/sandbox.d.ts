export type SandboxMode = 'auto' | 'require' | 'off';
export interface SandboxInfo {
    available: boolean;
    kind: 'bwrap' | null;
    reason: string;
}
/** OS sandbox availability. Linux: bubblewrap (read-only filesystem, scratch dir only writable, no network). */
export declare function sandboxInfo(): SandboxInfo;
export interface SandboxPlan {
    file: string;
    args: string[];
    sandboxed: boolean;
}
/**
 * Wrap a command so that: the whole filesystem is READ-ONLY, only `scratch` is writable,
 * there is no network, no access to other processes, and it dies with FThisUp.
 */
export declare function wrapInSandbox(file: string, args: string[], opts: {
    scratch: string;
    cwd: string;
    projectRoot: string;
}): SandboxPlan;
