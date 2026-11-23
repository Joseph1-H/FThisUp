/** Best effort: working directory of the process LISTENing on a local TCP port. null = unknown (Windows, no ss/lsof, no permission). */
export declare function portOwnerCwd(port: number): string | null;
/** Is a server started from `ownerCwd` plausibly part of the project at `root`? */
export declare function ownerBelongsToProject(ownerCwd: string, root: string): boolean;
/** true only when the port's owner is KNOWN and belongs to a different project. */
export declare function isForeignPort(port: number, root: string): boolean;
export declare function foreignPortChecker(root: string): (port: number) => boolean;
export declare function checkTargetOwnership(url: string, root: string): {
    ok: boolean;
    reason?: string;
};
