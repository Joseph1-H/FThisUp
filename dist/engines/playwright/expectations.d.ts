import type { Page } from 'playwright';
import type { Recorder } from './session.js';
import type { ExpectationResult, Severity } from '../../core/types.js';
import type { Expectation, Scenario } from '../../scenarios/schema.js';
export interface EvalState {
    page: Page;
    recorder: Recorder;
    scenario: Scenario;
    origin: string;
    requestedPath: string;
    finalStatus: number | null;
    navError: string | null;
    textBefore: string | null;
    urlBefore: string | null;
    protectedRoutes: string[];
}
export declare const maxSeverity: (a: Severity, b: Severity) => Severity;
export declare function evaluateExpectation(ex: Expectation, st: EvalState): Promise<ExpectationResult>;
