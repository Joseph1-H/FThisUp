import { type Scenario } from './schema.js';
export interface Rejected {
    index: number;
    id?: string;
    errors: string[];
}
export interface ValidationOutcome {
    valid: Scenario[];
    rejected: Rejected[];
}
export declare const MAX_SCENARIOS = 300;
export declare const MAX_SCENARIO_FILE_BYTES = 1000000;
/**
 * Validate untrusted scenarios (typically AI-proposed). Zod enforces the typed action
 * vocabulary; this adds semantic checks. Nothing here ever evaluates scenario content.
 */
export declare function validateScenarios(input: unknown, opts?: {
    forceOrigin?: 'agent' | 'heuristic';
}): ValidationOutcome;
