import type { FThisUpConfig } from '../core/config.js';
import type { Capability, Category, Confidence, Finding, TestResult } from '../core/types.js';
import type { Component, ProjectManifest } from '../detect/manifest.js';

export interface Target {
  url: string | null;
  /** cli = --url flag, config = fthisup.config.json, auto = found on a local port, none */
  source: 'cli' | 'config' | 'auto' | 'none';
}

export interface ProjectContext {
  root: string;
  manifest: ProjectManifest;
  config: FThisUpConfig;
  /** the web/API network target, if any (already ownership-checked by the CLI for cli/auto sources) */
  target: Target;
  /** explicit API base URL (--api-url / config api.url); falls back to target.url */
  apiUrl: string | null;
}

export interface DetectionResult {
  applicable: boolean;
  confidence: Confidence;
  /** component ids this adapter would test */
  components: string[];
  reason: string;
}

export interface TestOptions {
  mode: 'safe' | 'thorough';
  maxTests: number;
  timeoutMs: number;
  /** the user named this adapter explicitly (--adapter) */
  explicit: boolean;
  scenariosFile?: string;
  dryRun?: boolean;
  skipStatic?: boolean;
  outDir: string;
}

export interface PlannedTest {
  id: string;
  name: string;
  category: Category;
  component: string;
  risk: 'low' | 'medium' | 'high';
  requiresApproval?: boolean;
  description?: string;
}

export interface TestPlan {
  adapterId: string;
  /** ready: can execute; unavailable: applicable but a prerequisite is missing; unsupported: detected but no capability exists */
  status: 'ready' | 'unavailable' | 'unsupported';
  reason?: string;
  missing: Array<{ what: string; setup?: string }>;
  capabilities: Capability[];
  components: string[];
  tests: PlannedTest[];
  notes: string[];
  droppedByCap?: number;
  /** adapter-private data carried from plan() to execute() */
  state?: unknown;
}

export interface ExecutionContext {
  project: ProjectContext;
  options: TestOptions;
  onProgress?: (r: TestResult) => void;
  onStage?: (s: string) => void;
}

export interface AdapterOutcome {
  results: TestResult[];
  findings: Finding[];
  notes: string[];
  /** adapter-specific artefacts the orchestrator should persist (name → JSON-able) */
  artifacts?: Record<string, unknown>;
  coverage?: Partial<{ routesDiscovered: number; routesTested: number; formsDiscovered: number; formsTested: number }>;
  safety?: { targetClass: string; environment: string; notes: string[] };
  environment?: { browser?: string; browserVersion?: string; headless?: boolean };
  /** set when the adapter refuses/aborts for a policy reason */
  blocked?: string;
}

export interface TestAdapter {
  id: string;
  name: string;
  description: string;
  /** human-readable dependencies / environment requirements */
  requirements: string[];
  categories: Category[];
  /** the safety constraints this adapter enforces at runtime */
  safety: string[];
  /** off by default: only runs when enabled in config, --adapter, or --all */
  optIn?: boolean;
  /** adapters in the same group never run concurrently (e.g. everything that sends network traffic) */
  resourceGroup: 'network' | 'cpu' | 'exclusive';
  detect(ctx: ProjectContext): Promise<DetectionResult>;
  capabilities(ctx: ProjectContext): Promise<Capability[]>;
  plan(ctx: ProjectContext, options: TestOptions): Promise<TestPlan>;
  execute(plan: TestPlan, exec: ExecutionContext): Promise<AdapterOutcome>;
}

export function componentsOf(ctx: ProjectContext, ids: string[]): Component[] {
  return ids.map((id) => ctx.manifest.components.find((c) => c.id === id)).filter((c): c is Component => !!c);
}

export function emptyEvidence() {
  return { consoleErrors: [], pageErrors: [], networkFailures: [], mutatingRequests: [], blockedRequests: [], notes: [] as string[], logs: [] as string[], commands: [] as string[] };
}
