import { scenarioSchema, type Scenario } from './schema.js';
import { resolveSameOrigin } from '../safety/policy.js';

export interface Rejected {
  index: number;
  id?: string;
  errors: string[];
}
export interface ValidationOutcome {
  valid: Scenario[];
  rejected: Rejected[];
}

const FORBIDDEN_SELECTOR = /(javascript:|<\s*script|\bon\w+\s*=|[\r\n\0])/i;
export const MAX_SCENARIOS = 300;
export const MAX_SCENARIO_FILE_BYTES = 1_000_000;
const DUMMY_ORIGIN = 'http://fthisup.invalid';

/**
 * Validate untrusted scenarios (typically AI-proposed). Zod enforces the typed action
 * vocabulary; this adds semantic checks. Nothing here ever evaluates scenario content.
 */
export function validateScenarios(input: unknown, opts: { forceOrigin?: 'agent' | 'heuristic' } = {}): ValidationOutcome {
  const sectionsOnly = !!input && typeof input === 'object' && !Array.isArray(input) && !('scenarios' in (input as object)) && ('cliScenarios' in (input as object) || 'apiScenarios' in (input as object));
  if (sectionsOnly) return { valid: [], rejected: [] };
  const raw: unknown[] = Array.isArray(input)
    ? input
    : input && typeof input === 'object' && Array.isArray((input as { scenarios?: unknown }).scenarios)
      ? (input as { scenarios: unknown[] }).scenarios
      : [];
  if (raw.length === 0 && !Array.isArray(input) && !(input && typeof input === 'object' && 'scenarios' in (input as object))) {
    return { valid: [], rejected: [{ index: -1, errors: ['Expected an array of scenarios or an object with a "scenarios" array'] }] };
  }
  const valid: Scenario[] = [];
  const rejected: Rejected[] = [];
  // Bound input before schema validation (zod 3 can use a lot of memory on huge collections).
  if (raw.length > MAX_SCENARIOS) {
    rejected.push({ index: MAX_SCENARIOS, errors: [`only the first ${MAX_SCENARIOS} scenarios are accepted; ${raw.length - MAX_SCENARIOS} were ignored`] });
    raw.length = MAX_SCENARIOS;
  }
  const seen = new Set<string>();
  raw.forEach((item, index) => {
    const id = item && typeof item === 'object' ? String((item as { id?: unknown }).id ?? '') : undefined;
    const parsed = scenarioSchema.safeParse(item);
    if (!parsed.success) {
      rejected.push({ index, id, errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) });
      return;
    }
    const s = parsed.data;
    const errors: string[] = [];
    if (opts.forceOrigin) s.origin = opts.forceOrigin;
    if (seen.has(s.id)) errors.push(`duplicate scenario id "${s.id}"`);
    if (resolveSameOrigin(DUMMY_ORIGIN, s.target) === null) errors.push(`target "${s.target}" must be a path on the target origin`);
    if (/^\/\//.test(s.target)) errors.push('protocol-relative targets are not allowed');
    s.steps.forEach((st, i) => {
      if (st.action === 'goto' && (resolveSameOrigin(DUMMY_ORIGIN, st.path) === null || /^\/\//.test(st.path))) {
        errors.push(`steps[${i}].path "${st.path}" must be a same-origin path`);
      }
      if ('selector' in st && FORBIDDEN_SELECTOR.test(st.selector)) errors.push(`steps[${i}].selector contains a forbidden pattern`);
    });
    s.expected.forEach((ex, i) => {
      if ('selector' in ex && FORBIDDEN_SELECTOR.test(ex.selector)) errors.push(`expected[${i}].selector contains a forbidden pattern`);
      if ('pattern' in ex) {
        try { new RegExp(ex.pattern); } catch { errors.push(`expected[${i}].pattern is not a valid regular expression`); }
      }
    });
    if (s.steps.some((st) => st.action === 'login' || st.action === 'loginWithBadPassword') && s.category !== 'authentication') {
      errors.push('login actions are only allowed in "authentication" scenarios');
    }
    if (errors.length) rejected.push({ index, id: s.id, errors });
    else { seen.add(s.id); valid.push(s); }
  });
  return { valid, rejected };
}
