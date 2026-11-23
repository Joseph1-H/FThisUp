import { z } from 'zod';

/**
 * Why a generated test is allowed to claim the application is wrong:
 *  - invariant:  universal rule that needs no requirement (no uncaught exception, no layout overflow, no use-after-dispose)
 *  - documented: a requirement written in the project's docs (reference + quote are VERIFIED against the file)
 *  - code:       a contract visible in the source (validator, assert, comment) that the behaviour contradicts (verified the same way)
 *  - test:       an existing project test establishes the expectation (verified the same way)
 *  - assumption: the agent's own expectation; can never be more than "suspected"
 */
export const BASES = ['invariant', 'documented', 'code', 'test', 'assumption'] as const;
export type Basis = (typeof BASES)[number];

export const referenceSchema = z
  .object({
    file: z.string().min(1).max(300),
    line: z.number().int().min(1).max(1_000_000).optional(),
    /** a short verbatim excerpt of the file that states the requirement; it must really occur in the file */
    quote: z.string().min(6).max(300),
  })
  .strict();

export const expectationSchema = z
  .object({
    /** the behaviour that is expected, in one sentence */
    statement: z.string().min(5).max(400),
    basis: z.enum(BASES),
    reference: referenceSchema.optional(),
  })
  .strict();
export type Expectation = z.infer<typeof expectationSchema>;

/** Fields every generated scenario has, whichever adapter executes it. */
export const scenarioMetaShape = {
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,60}$/, 'id: lowercase letters, digits, - or _ (2-61 chars)'),
  name: z.string().min(3).max(160),
  /** the application feature this scenario targets, e.g. "Workout logging" */
  feature: z.string().min(2).max(120),
  /** the risk it addresses, e.g. "duplicate submission creates two records" */
  risk: z.string().min(5).max(300),
  expectation: expectationSchema,
  /** unverified idea about the cause; reported as a hypothesis, never as a fact */
  hypothesis: z.string().max(500).optional(),
  priority: z.enum(['high', 'medium', 'low']).default('medium'),
};

export type GenerationMethod = 'agent' | 'engine-heuristic';

/**
 * Lifecycle of one generated scenario (every state is reported; none is silently dropped):
 *  rejected    failed schema/semantic validation, never executed
 *  skipped     valid but not executed (budget, unsupported, environment cannot run it)
 *  invalid     executed, but the TEST is wrong (setup failed, target missing, compile error): proves nothing about the app
 *  environment executed, but the failure is the isolated environment's (backend/plugin/network unavailable), not the app's
 *  passed      executed, everything held
 *  confirmed   failed, reproduced independently, and the expectation is supported (invariant / verified reference)
 *  suspected   failed but the expectation is unsupported (assumption) or the failure is heuristic
 *  not-reproducible failed once, did not fail again
 */
export type GeneratedStatus = 'passed' | 'confirmed' | 'suspected' | 'not-reproducible' | 'invalid' | 'environment' | 'skipped' | 'rejected';

export interface GeneratedRecord {
  id: string;
  name: string;
  adapter: string;
  component: string;
  feature: string;
  risk: string;
  expectation: { statement: string; basis: Basis; effectiveBasis: Basis; referenceVerified?: boolean; reference?: string };
  method: GenerationMethod;
  status: GeneratedStatus;
  /** why the status is what it is (always set for anything but a clean pass) */
  reason?: string;
  executed: boolean;
  reproduction?: { attempts: number; reproduced: number };
  confidence?: 'high' | 'medium' | 'low';
  evidence?: { observed: string[]; files?: Array<{ file: string; line: number }>; testFile?: string; durationMs?: number };
  findingId?: string;
}

export interface DiscoveryCounts {
  /** scenarios that entered the pipeline (agent-supplied + engine-seeded) */
  generated: number;
  /** passed schema + semantic validation */
  validated: number;
  rejected: number;
  /** actually run by the test framework (passed + failed + invalid + environment); skipped/rejected are NOT included */
  executed: number;
  skipped: number;
  passed: number;
  confirmed: number;
  suspected: number;
  notReproducible: number;
  invalid: number;
  environment: number;
}

export interface DiscoveryReport {
  requested: boolean;
  /** per adapter: can autonomous discovery run, and if not, why not */
  support: Array<{ adapter: string; component?: string; supported: boolean; implemented: boolean; reason: string }>;
  counts: DiscoveryCounts;
  records: GeneratedRecord[];
  /** summary of the structure FThisUp found in the app (full map is in app-map.json) */
  appMap?: Array<{ adapter: string; component: string; summary: Record<string, number | string>; }>;
  existingTests?: Array<{ component: string; passed: number; failed: number }>;
  budget: { maxScenarios: number; maxExecuted: number; reproAttempts: number; testTimeoutSeconds: number; mode: string };
  isolation?: { workspace: string; sourceModified: boolean; networkBlocked: boolean; networkAttempts: string[]; sandbox: string; cleanedUp: boolean; files: string[] };
  /** things that were not or could not be tested, stated plainly */
  limitations: string[];
  durationMs: number;
  agentScenarioFiles: string[];
}

export const emptyCounts = (): DiscoveryCounts => ({ generated: 0, validated: 0, rejected: 0, executed: 0, skipped: 0, passed: 0, confirmed: 0, suspected: 0, notReproducible: 0, invalid: 0, environment: 0 });
