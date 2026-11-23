export declare class ProjectScopeError extends Error {
}
/** Nearest ancestor of `start` that looks like a project. Never returns the home directory or a filesystem root. */
export declare function findProjectRoot(start: string): string;
/** True if `child` is `root` or inside it (symlinks resolved, for paths that may not exist yet). */
export declare function isInside(root: string, child: string): boolean;
/** Resolve a user-supplied path against the project root and refuse anything outside it. */
export declare function confine(root: string, p: string, label: string): string;
