import type { Finding } from '../core/types.js';
export declare function analyzeStatic(root: string): {
    findings: Finding[];
    filesScanned: number;
    truncated: boolean;
};
