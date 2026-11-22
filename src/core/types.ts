export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type Confidence = 'high' | 'medium' | 'low';
export type FindingStatus = 'confirmed' | 'suspected' | 'not-reproducible' | 'skipped' | 'blocked';
export type Outcome = 'passed' | 'failed' | 'skipped' | 'blocked';

export const CATEGORIES = [
  'navigation',
  'form-validation',
  'ui-chaos',
  'network-failure',
  'authentication',
  'code-analysis',
] as const;
export type Category = (typeof CATEGORIES)[number];

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
}
