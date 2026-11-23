export declare function isEnvFile(name: string): boolean;
export interface SourceFile {
    rel: string;
    abs: string;
    text: string;
}
/** Walk source files. Never opens .env files, keys or credentials — they are skipped before any read. */
export declare function walkSources(root: string, opts?: {
    maxFiles?: number;
}): {
    files: SourceFile[];
    truncated: boolean;
};
export declare function readJsonSafe<T = Record<string, unknown>>(file: string): T | null;
export declare function lineOf(text: string, index: number): number;
