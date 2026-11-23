import type { Category, Confidence, Evidence, FailureType, Finding, FindingStatus, Severity, TestResult } from '../core/types.js';
import { type ProjectContext } from './types.js';
/** The (deepest) component whose directory contains this file. */
export declare function owningComponent(ctx: ProjectContext, file: string): string | undefined;
export declare function tail(text: string, lines?: number, maxChars?: number): string;
export declare function mkResult(r: Partial<TestResult> & Pick<TestResult, 'scenarioId' | 'name' | 'category' | 'outcome' | 'adapter' | 'component'>): TestResult;
export interface FindingInput {
    id: string;
    title: string;
    category: Category;
    adapter: string;
    component: string;
    route: string;
    status: FindingStatus;
    severity: Severity;
    confidence: Confidence;
    failureType: FailureType;
    evidenceKind: 'observed-defect' | 'failed-assertion' | 'static-heuristic';
    expected: string;
    actual: string;
    steps: string[];
    attempts: number;
    reproduced: boolean;
    scope: string;
    fix: string;
    evidence?: Partial<Evidence>;
    scenarioId?: string;
}
export declare function mkFinding(f: FindingInput): Finding;
export declare const slugify: (s: string) => string;
/** Decide a finding's status from a reproduction attempt. `hard` = objectively measurable evidence. */
export declare function statusFrom(reproduced: boolean, attempted: boolean, hard: boolean): {
    status: FindingStatus;
    confidence: Confidence;
};
