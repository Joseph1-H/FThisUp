export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type Confidence = 'high' | 'medium' | 'low';
export type FindingStatus = 'confirmed' | 'suspected' | 'not-reproducible' | 'skipped' | 'blocked';
export type Outcome = 'passed' | 'failed' | 'skipped' | 'blocked';

export const WEB_CATEGORIES = ['navigation', 'form-validation', 'ui-chaos', 'network-failure', 'authentication', 'code-analysis'] as const;
export const CATEGORIES = [
  ...WEB_CATEGORIES,
  'api',
  'cli',
  'unit-tests',
  'fuzzing',
  'build',
  'startup',
  'static-analysis',
  'project-validation',
] as const;
export type Category = (typeof CATEGORIES)[number];

/** Shared failure taxonomy used by every adapter. */
export const FAILURE_TYPES = [
  'crash',
  'unhandled-exception',
  'hang',
  'incorrect-output',
  'invalid-state-transition',
  'data-corruption',
  'input-validation',
  'resource-usage',
  'build-failure',
  'dependency-failure',
  'auth-error',
  'network-error-handling',
  'ui-interaction',
  'regression',
  'incomplete-functionality',
  'broken-navigation',
  'security-weakness',
  'layout-defect',
] as const;
export type FailureType = (typeof FAILURE_TYPES)[number];

/**
 * What kind of evidence backs a finding:
 *  - observed-defect:  FThisUp itself provoked and observed misbehaviour
 *  - failed-assertion: an EXISTING project test failed (could be a bug OR an outdated test)
 *  - static-heuristic: pattern match in source, unconfirmed
 */
export type EvidenceKind = 'observed-defect' | 'failed-assertion' | 'static-heuristic';

export interface ConsoleEntry {
  type: string;
  text: string;
  url?: string;
}
export interface NetworkEntry {
  method: string;
  url: string;
  status?: number;
  failure?: string;
  resourceType?: string;
  /** true when FThisUp itself injected the failure (never counted as an app bug) */
  injected?: boolean;
}

export interface Evidence {
  screenshot?: string;
  consoleErrors: ConsoleEntry[];
  pageErrors: string[];
  networkFailures: NetworkEntry[];
  mutatingRequests: NetworkEntry[];
  blockedRequests: NetworkEntry[];
  notes: string[];
  /** command output / log excerpts (already size-capped; redacted before writing) */
  logs?: string[];
  /** exact commands or requests that were executed */
  commands?: string[];
}

export interface ExpectationResult {
  type: string;
  passed: boolean;
  /** hard = objectively measurable failure; soft = heuristic */
  hard: boolean;
  message: string;
  severity: Severity;
}

export interface Reproduction {
  attempted: boolean;
  attempts: number;
  reproduced: boolean;
}

export interface Finding {
  id: string;
  scenarioId?: string;
  title: string;
  category: Category;
  status: FindingStatus;
  severity: Severity;
  confidence: Confidence;
  route: string;
  expected: string;
  actual: string;
  reproductionSteps: string[];
  reproduction: Reproduction;
  evidence: Evidence;
  suggestedFix: string;
  /** static-analysis warnings are never counted as executed tests */
  source: 'execution' | 'static-analysis';
  file?: string;
  line?: number;
  adapter?: string;
  /** project component this finding affects (id from the project manifest) */
  component?: string;
  failureType?: FailureType;
  evidenceKind?: EvidenceKind;
  /** human-readable scope, e.g. "api GET /users", "cli: mytool --help", "test tests/test_x.py::test_y" */
  scope?: string;
}

export interface TestResult {
  scenarioId: string;
  name: string;
  category: Category;
  risk: 'low' | 'medium' | 'high';
  target: string;
  outcome: Outcome;
  durationMs: number;
  reason?: string;
  expectations: ExpectationResult[];
  findingId?: string;
  origin: 'heuristic' | 'agent';
  adapter?: string;
  component?: string;
}

export interface EnvironmentInfo {
  fthisupVersion: string;
  node: string;
  platform: string;
  browser: string;
  browserVersion: string;
  headless: boolean;
}

export interface RunSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  blocked: number;
  confirmed: number;
  suspected: number;
  notReproducible: number;
  bySeverity: Record<Severity, number>;
  byCategory: Record<string, { total: number; passed: number; failed: number }>;
}

export interface Capability {
  id: string;
  label: string;
  available: boolean;
  /** why it is (un)available */
  reason?: string;
  /** optional, user-run command that would enable it; FThisUp never installs anything itself */
  setup?: string;
}

export type AdapterStatus = 'ran' | 'skipped' | 'unsupported' | 'unavailable' | 'not-applicable' | 'blocked' | 'error';

export interface AdapterReport {
  id: string;
  name: string;
  status: AdapterStatus;
  reason?: string;
  components: string[];
  capabilities: Capability[];
  /** missing prerequisites with a suggested (user-run) setup command */
  missing: Array<{ what: string; setup?: string }>;
  executed: number;
  passed: number;
  failed: number;
  skipped: number;
  blocked: number;
  durationMs: number;
  notes: string[];
}

export interface ComponentInfo {
  id: string;
  path: string;
  kind: string;
  languages: string[];
  frameworks: string[];
  confidence: Confidence;
}

export interface RunResults {
  schemaVersion: 1;
  tool: 'fthisup';
  project: string;
  target: string;
  mode: string;
  startedAt: string;
  durationMs: number;
  environment: EnvironmentInfo;
  safety: { targetClass: string; environment: string; notes: string[] };
  summary: RunSummary;
  results: TestResult[];
  findings: Finding[];
  /** honest statement about what was and was not covered */
  coverage: { routesDiscovered: number; routesTested: number; formsDiscovered: number; formsTested: number; notes: string[] };
  /** universal (multi-adapter) additions; absent in results written by v0.1 */
  adapters?: AdapterReport[];
  components?: ComponentInfo[];
  sandbox?: { kind: string; note: string };
}
