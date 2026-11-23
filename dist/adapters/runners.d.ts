import type { Capability, Finding, TestResult } from '../core/types.js';
import type { Component, Ecosystem, TestCommand } from '../detect/manifest.js';
import { type RunOutcome } from '../exec/run.js';
import * as P from './parsers.js';
import type { ExecutionContext, PlannedTest, ProjectContext, TestAdapter } from './types.js';
export interface RunnerAdapterSpec {
    id: string;
    name: string;
    description: string;
    ecosystems: Ecosystem[];
    requirements: string[];
    /** extra step run after the existing tests (adversarial fuzzing etc.) */
    extra?: {
        capability: (ctx: ProjectContext, comp: Component) => Capability;
        plan: (ctx: ProjectContext, comp: Component) => PlannedTest[];
        run: (comp: Component, ctx: ExecutionContext, nextId: () => string) => Promise<{
            results: TestResult[];
            findings: Finding[];
            notes: string[];
        }>;
    };
}
export declare const suiteTimeout: (ctx: ProjectContext) => number;
export interface CommandRun {
    out: RunOutcome;
    parsed: P.Parsed;
    /** all console output for classification */
    text: string;
    commands: string[];
    buildStepFailed?: string;
}
/** Run one detected test command and parse its structured output. Never installs anything. */
export declare function runTestCommand(ctx: ProjectContext, comp: Component, tc: TestCommand, timeoutMs: number): Promise<CommandRun>;
/** Runs the command (with one reproduction re-run on failure) and turns it into results + findings. */
export declare function executeCommand(adapterId: string, ctx: ProjectContext, comp: Component, tc: TestCommand, nextId: () => string, timeoutMs: number): Promise<{
    results: TestResult[];
    findings: Finding[];
    notes: string[];
}>;
/** Static analyzers (flutter analyze, tsc, clippy, go vet). Only objective ERRORS become findings. */
export declare function executeAnalyzer(adapterId: string, ctx: ProjectContext, comp: Component, tc: TestCommand, nextId: () => string, timeoutMs: number): Promise<{
    results: TestResult[];
    findings: Finding[];
    notes: string[];
}>;
export declare function makeRunnerAdapter(spec: RunnerAdapterSpec): TestAdapter;
export declare const hasTool: (t: string) => boolean;
export declare const pythonAdapter: TestAdapter;
export declare const javascriptAdapter: TestAdapter;
export declare const rustAdapter: TestAdapter;
export declare const goAdapter: TestAdapter;
export declare const flutterAdapter: TestAdapter;
export declare const javaAdapter: TestAdapter;
export declare const cppAdapter: TestAdapter;
export declare const swiftAdapter: TestAdapter;
