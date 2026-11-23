import type { RunResults } from '../core/types.js';
export declare function headlineFor(r: RunResults): {
    headline: string;
    sub: string;
    tone: 'bad' | 'ok' | 'idle';
};
export declare function renderReport(results: RunResults, resultsDir: string): string;
export declare function writeReport(resultsDir: string, results: RunResults): string;
