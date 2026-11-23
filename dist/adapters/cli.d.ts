import type { Component } from '../detect/manifest.js';
import { type RunOutcome } from '../exec/run.js';
import { type CliExpectation, type CliScenario } from '../scenarios/cli-schema.js';
import type { ProjectContext, TestAdapter } from './types.js';
export interface CliTarget {
    name: string;
    file: string;
    args: string[];
    component: string;
    source: string;
}
export declare function discoverCliTargets(ctx: ProjectContext): {
    targets: CliTarget[];
    notes: string[];
};
export declare function findStackTrace(text: string): string | null;
/** The program could not even be started (missing entry file, bad interpreter): an environment problem, never a finding. */
export declare function launchFailure(out: RunOutcome, t: CliTarget): string | null;
export declare function didCrash(out: RunOutcome): boolean;
type Exp = CliExpectation & {
    hard?: boolean;
};
interface Spec {
    id: string;
    name: string;
    argv: string[];
    stdin?: CliScenario['stdin'];
    signal?: CliScenario['signal'];
    timeoutMs?: number;
    expect: Exp[];
    risk: 'low' | 'medium' | 'high';
    requiresApproval?: boolean;
    sensitivity?: CliScenario['sensitivity'];
    origin: 'heuristic' | 'agent';
    /** scratch files to create before the run: name → content (relative to scratch) */
    files?: Record<string, string>;
    description?: string;
    /** args that reference a scratch file by name are rewritten to absolute scratch paths */
    scratchArgs?: boolean;
}
/** Deterministic adversarial scenarios. Help-derived ones are appended after probing --help. */
export declare function baseScenarios(): Spec[];
/** Derive extra scenarios from the program's own --help text (flags that take values / config files). */
export declare function helpDerived(help: string): Spec[];
export interface CliRun {
    out: RunOutcome;
    command: string;
    sandboxed: boolean;
}
export declare const cliAdapter: TestAdapter;
export declare function loadSection(ctx: ProjectContext, file: string, key: 'cliScenarios' | 'apiScenarios'): unknown;
export type { Component };
