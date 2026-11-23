import type { Scenario } from '../scenarios/schema.js';
type Sensitivity = NonNullable<Scenario['sensitivity']>;
/** Keyword classification of what a form/button would do. Conservative: when matched, the scenario needs approval. */
export declare function classifySensitivity(...texts: Array<string | undefined>): Sensitivity | undefined;
export {};
