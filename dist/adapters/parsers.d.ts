/** Pure parsers for the output of existing test runners. Each returns individual test outcomes; no I/O here. */
export type ParsedStatus = 'passed' | 'failed' | 'errored' | 'skipped';
export interface ParsedTest {
    name: string;
    status: ParsedStatus;
    message?: string;
    durationMs?: number;
    file?: string;
}
export interface Parsed {
    tests: ParsedTest[];
    /** true when the runner printed a final summary (so an empty list really means "no tests") */
    summarySeen: boolean;
}
export declare function parseTap(out: string): Parsed;
export declare function parseUnittest(out: string): Parsed;
export declare function parseJUnit(xml: string): Parsed;
export declare function parseCargo(out: string): Parsed;
/** Build/dependency failures that happen before any test runs (all runners). */
export declare function classifyBuildFailure(out: string): 'build-failure' | 'dependency-failure' | null;
export declare function parseGoJson(out: string): Parsed;
export declare function parseDartJson(out: string): Parsed;
export declare function parseCtest(out: string): Parsed;
export declare function parseSwift(out: string): Parsed;
export declare function parseJestJson(json: string): Parsed;
export interface Diagnostics {
    errors: string[];
    warnings: number;
    infos: number;
}
export declare function parseDartAnalyze(out: string): Diagnostics;
export declare function parseTsc(out: string): Diagnostics;
export declare function parseCargoDiag(out: string): Diagnostics;
export declare function parseGoVet(out: string): Diagnostics;
