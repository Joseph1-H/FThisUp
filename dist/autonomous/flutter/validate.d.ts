import type { Basis } from '../types.js';
import { type FlutterScenario } from './schema.js';
import type { FlutterAppMap } from './map.js';
export interface Validated {
    scenario: FlutterScenario;
    method: 'agent' | 'engine-heuristic';
    effectiveBasis: Basis;
    referenceVerified?: boolean;
    referenceText?: string;
    notes: string[];
}
export interface Rejected {
    id?: string;
    index: number;
    errors: string[];
}
/** A reference is only trusted when the file is inside the project and the quote really occurs in it. */
export declare function verifyReference(root: string, ref: {
    file: string;
    line?: number;
    quote: string;
}): {
    ok: boolean;
    reason?: string;
    text: string;
};
export declare function validateFlutterScenarios(raw: unknown[], map: FlutterAppMap, root: string, defaultMethod: 'agent' | 'engine-heuristic'): {
    valid: Validated[];
    rejected: Rejected[];
    skipped: Array<{
        id: string;
        name: string;
        reason: string;
        scenario: FlutterScenario;
    }>;
};
