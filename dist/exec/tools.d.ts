/** Locate an executable on PATH (no shell). */
export declare function which(exe: string): string | null;
/** First line of `exe --version`, or null if it cannot run. Bounded to 8s. */
export declare function toolVersion(exe: string, args?: string[]): string | null;
export declare function pythonExe(): string | null;
export declare function pythonHasModule(mod: string, cwd?: string): boolean;
