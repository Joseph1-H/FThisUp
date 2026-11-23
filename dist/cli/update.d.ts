export declare const REPO_URL = "https://github.com/Joseph1-H/FThisUp";
export type UpdateState = 'up-to-date' | 'updated' | 'available' | 'skipped' | 'error';
export interface UpdateOutcome {
    dir: string;
    state: UpdateState;
    from?: string;
    to?: string;
    message: string;
}
/** Is `dir` a git checkout of FThisUp? (we never touch any other repository) */
export declare function isFThisUpCheckout(dir: string): boolean;
/** Update one git checkout of FThisUp to the newest commit on its tracked branch. */
export declare function updateCheckout(dir: string, opts?: {
    checkOnly?: boolean;
}): UpdateOutcome;
/** Where FThisUp copies live: the running install plus any skill clones the user has. Never any other directory. */
export declare function findInstalls(opts: {
    selfRoot: string;
    cwd: string;
    home?: string;
}): {
    checkouts: string[];
    copies: string[];
};
export declare function selfRoot(): string;
export declare const INSTALL_SPEC = "git+https://github.com/Joseph1-H/FThisUp.git";
/** Is this a copy that `npm install -g <git url>` put in a global node_modules (and not a throwaway npx cache)? */
export declare function isGlobalNpmInstall(root: string): boolean;
/** Update an `npm install -g` copy: compare with the version on GitHub, then reinstall from GitHub. */
export declare function updateGlobalInstall(root: string, opts?: {
    checkOnly?: boolean;
}): Promise<UpdateOutcome>;
