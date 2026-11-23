import { z } from 'zod';
/**
 * Why a generated test is allowed to claim the application is wrong:
 *  - invariant:  universal rule that needs no requirement (no uncaught exception, no layout overflow, no use-after-dispose)
 *  - documented: a requirement written in the project's docs (reference + quote are VERIFIED against the file)
 *  - code:       a contract visible in the source (validator, assert, comment) that the behaviour contradicts (verified the same way)
 *  - test:       an existing project test establishes the expectation (verified the same way)
 *  - assumption: the agent's own expectation; can never be more than "suspected"
 */
export const BASES = ['invariant', 'documented', 'code', 'test', 'assumption'];
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
export const emptyCounts = () => ({ generated: 0, validated: 0, rejected: 0, executed: 0, skipped: 0, passed: 0, confirmed: 0, suspected: 0, notReproducible: 0, invalid: 0, environment: 0 });
