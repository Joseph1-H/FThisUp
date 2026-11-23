import { z } from 'zod';

/** Typed API scenarios (agent-proposed). The host is ALWAYS the authorized API target; only a path is supplied. */
const o = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();
const apiPath = z.string().min(1).max(500).refine((p) => p.startsWith('/') && !p.startsWith('//') && !/[\r\n\0]/.test(p), 'must be an absolute path starting with a single "/"');

export const apiExpectationSchema = z.discriminatedUnion('type', [
  o({ type: z.literal('no5xx') }),
  o({ type: z.literal('statusIn'), codes: z.array(z.number().int().min(100).max(599)).min(1).max(10) }),
  o({ type: z.literal('rejects') }), // 4xx expected
  o({ type: z.literal('respondsWithinMs'), ms: z.number().int().min(50).max(30_000) }),
  o({ type: z.literal('jsonBody') }),
  o({ type: z.literal('bodyContains'), text: z.string().min(1).max(200) }),
]);
export type ApiExpectation = z.infer<typeof apiExpectationSchema>;

export const apiScenarioSchema = o({
  id: z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,120}$/i),
  name: z.string().min(1).max(200),
  method: z.enum(['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE']),
  path: apiPath,
  query: z.record(z.string().max(2000)).optional(),
  headers: z.record(z.string().max(500)).optional(),
  /** JSON value, or raw string to send as-is (use rawBody to send deliberately malformed JSON) */
  json: z.unknown().optional(),
  rawBody: z.string().max(1_100_000).optional(),
  contentType: z.string().max(100).optional(),
  expect: z.array(apiExpectationSchema).min(1).max(8),
  risk: z.enum(['low', 'medium', 'high']).default('low'),
  requiresApproval: z.boolean().default(false),
  sensitivity: z.enum(['deletion', 'purchase', 'account-creation', 'messaging', 'upload', 'irreversible']).optional(),
});
export type ApiScenario = z.infer<typeof apiScenarioSchema>;

const FORBIDDEN_HEADERS = /^(host|content-length|connection|transfer-encoding|cookie|authorization|proxy-.*|x-forwarded-.*)$/i;

export function validateApiScenarios(input: unknown): { valid: ApiScenario[]; rejected: Array<{ id?: string; errors: string[] }> } {
  const raw = Array.isArray(input) ? input.slice(0, 300) : [];
  const valid: ApiScenario[] = [];
  const rejected: Array<{ id?: string; errors: string[] }> = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const id = item && typeof item === 'object' ? String((item as { id?: unknown }).id ?? '') : undefined;
    const p = apiScenarioSchema.safeParse(item);
    if (!p.success) { rejected.push({ id, errors: p.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) }); continue; }
    const errs: string[] = [];
    if (seen.has(p.data.id)) errs.push(`duplicate id "${p.data.id}"`);
    for (const h of Object.keys(p.data.headers ?? {})) if (FORBIDDEN_HEADERS.test(h)) errs.push(`header "${h}" cannot be set by a scenario`);
    if (p.data.json !== undefined && p.data.rawBody !== undefined) errs.push('use either json or rawBody, not both');
    if (errs.length) rejected.push({ id: p.data.id, errors: errs }); else { seen.add(p.data.id); valid.push(p.data); }
  }
  return { valid, rejected };
}
