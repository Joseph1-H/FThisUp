import type { ProjectContext } from './types.js';
import type { RunnerAdapterSpec } from './runners.js';
type Lang = 'node' | 'python';
export interface Obs {
    fn: string;
    key: string;
    desc: string;
    edge: boolean;
    size: number;
    outcome: 'returned' | 'threw' | 'hang' | 'crash';
    name?: string;
    message?: string; /** the PROJECT's own code recursed (not an engine-internal toString/JSON recursion) */
    recursion?: boolean;
}
export interface HarnessRun {
    obs: Obs[];
    functions: string[];
    skipped: Array<{
        fn: string;
        reason: string;
    }>;
    loadErrors: string[];
    restarts: number;
    calls: number;
    sandboxed: boolean;
    command: string;
}
export type Kind = 'crash' | 'hang' | 'resource' | 'boundary-error';
export interface Flag {
    kind: Kind;
    hard: boolean;
    obs: Obs;
}
/** Which observations count as findings. Throwing on type-confused input (None, wrong types) is NOT a finding: that is a type-contract question. */
export declare function flagFor(lang: Lang, o: Obs): Flag | null;
export declare function fuzzAllowed(ctx: ProjectContext): {
    ok: boolean;
    reason: string;
    sandboxed: boolean;
};
export declare function runHarness(ctx: ProjectContext, lang: Lang, targets: string[], only?: string[], skipInit?: string[]): Promise<HarnessRun>;
export declare function fuzzExtra(lang: Lang): NonNullable<RunnerAdapterSpec['extra']>;
export {};
