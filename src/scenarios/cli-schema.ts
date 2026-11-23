import { z } from 'zod';

/**
 * Typed scenarios for the CLI adapter. The EXECUTABLE is never part of a scenario: it is always one of the
 * discovered/configured targets, referenced by name. argv elements are plain strings (no shell, no expansion).
 */
const o = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();

export const cliStdinSchema = z.discriminatedUnion('kind', [
  o({ kind: z.literal('empty') }),
  o({ kind: z.literal('text'), text: z.string().max(100_000) }),
  o({ kind: z.literal('unicode') }),
  o({ kind: z.literal('binary'), bytes: z.number().int().min(1).max(1_000_000) }),
  o({ kind: z.literal('long'), bytes: z.number().int().min(1).max(5_000_000) }),
]);

export const cliExpectationSchema = z.discriminatedUnion('type', [
  o({ type: z.literal('noCrash') }),
  o({ type: z.literal('noStackTrace') }),
  o({ type: z.literal('terminates') }),
  o({ type: z.literal('exitCode'), oneOf: z.array(z.number().int().min(0).max(255)).min(1).max(8) }),
  o({ type: z.literal('nonZeroExit') }),
  o({ type: z.literal('stderrEmpty') }),
  o({ type: z.literal('stdoutContains'), text: z.string().min(1).max(200) }),
  o({ type: z.literal('stderrContains'), text: z.string().min(1).max(200) }),
  o({ type: z.literal('exitsWithinMs'), ms: z.number().int().min(50).max(30_000) }),
]);
export type CliExpectation = z.infer<typeof cliExpectationSchema>;

export const cliScenarioSchema = o({
  id: z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,120}$/i),
  name: z.string().min(1).max(200),
  /** name of a discovered/configured CLI target */
  target: z.string().min(1).max(60),
  argv: z.array(z.string().max(5000)).max(30),
  stdin: cliStdinSchema.optional(),
  signal: o({ afterMs: z.number().int().min(50).max(5000), name: z.enum(['SIGINT', 'SIGTERM']) }).optional(),
  timeoutMs: z.number().int().min(200).max(30_000).optional(),
  expect: z.array(cliExpectationSchema).min(1).max(10),
  risk: z.enum(['low', 'medium', 'high']).default('low'),
  requiresApproval: z.boolean().default(false),
  sensitivity: z.enum(['deletion', 'purchase', 'account-creation', 'messaging', 'upload', 'irreversible']).optional(),
  description: z.string().max(500).optional(),
});
export type CliScenario = z.infer<typeof cliScenarioSchema>;

export function validateCliScenarios(input: unknown, targets: string[]): { valid: CliScenario[]; rejected: Array<{ id?: string; errors: string[] }> } {
  const raw = Array.isArray(input) ? input.slice(0, 300) : [];
  const valid: CliScenario[] = [];
  const rejected: Array<{ id?: string; errors: string[] }> = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const id = item && typeof item === 'object' ? String((item as { id?: unknown }).id ?? '') : undefined;
    const p = cliScenarioSchema.safeParse(item);
    if (!p.success) { rejected.push({ id, errors: p.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) }); continue; }
    const errs: string[] = [];
    if (!targets.includes(p.data.target)) errs.push(`unknown target "${p.data.target}" (known: ${targets.join(', ') || 'none'})`);
    if (seen.has(p.data.id)) errs.push(`duplicate id "${p.data.id}"`);
    if (p.data.argv.some((a) => a.includes('\0'))) errs.push('argv must not contain NUL bytes');
    if (errs.length) rejected.push({ id: p.data.id, errors: errs }); else { seen.add(p.data.id); valid.push(p.data); }
  }
  return { valid, rejected };
}
