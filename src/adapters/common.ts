import type { Category, Confidence, Evidence, FailureType, Finding, FindingStatus, Severity, TestResult } from '../core/types.js';
import path from 'node:path';
import { emptyEvidence, type ProjectContext } from './types.js';

/** The (deepest) component whose directory contains this file. */
export function owningComponent(ctx: ProjectContext, file: string): string | undefined {
  const rel = (path.isAbsolute(file) ? path.relative(ctx.root, file) : file).split(path.sep).join('/');
  return [...ctx.manifest.components].sort((a, b) => b.path.length - a.path.length).find((c) => c.path === '.' || rel === c.path || rel.startsWith(`${c.path}/`))?.id;
}

export function tail(text: string, lines = 30, maxChars = 3000): string {
  const t = text.split('\n').slice(-lines).join('\n');
  return t.length > maxChars ? `…${t.slice(-maxChars)}` : t;
}

export function mkResult(r: Partial<TestResult> & Pick<TestResult, 'scenarioId' | 'name' | 'category' | 'outcome' | 'adapter' | 'component'>): TestResult {
  return { risk: 'low', target: r.component, durationMs: 0, expectations: [], origin: 'heuristic', ...r } as TestResult;
}

export interface FindingInput {
  id: string;
  title: string;
  category: Category;
  adapter: string;
  component: string;
  route: string;
  status: FindingStatus;
  severity: Severity;
  confidence: Confidence;
  failureType: FailureType;
  evidenceKind: 'observed-defect' | 'failed-assertion' | 'static-heuristic';
  expected: string;
  actual: string;
  steps: string[];
  attempts: number;
  reproduced: boolean;
  scope: string;
  fix: string;
  evidence?: Partial<Evidence>;
  scenarioId?: string;
}

export function mkFinding(f: FindingInput): Finding {
  return {
    id: f.id, scenarioId: f.scenarioId, title: f.title, category: f.category, status: f.status, severity: f.severity, confidence: f.confidence,
    route: f.route, expected: f.expected, actual: f.actual, reproductionSteps: f.steps,
    reproduction: { attempted: f.attempts > 1, attempts: f.attempts, reproduced: f.reproduced },
    evidence: { ...emptyEvidence(), ...f.evidence } as Evidence,
    suggestedFix: f.fix, source: 'execution', adapter: f.adapter, component: f.component, failureType: f.failureType, evidenceKind: f.evidenceKind, scope: f.scope,
  };
}

export const slugify = (s: string) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 80);

/** Decide a finding's status from a reproduction attempt. `hard` = objectively measurable evidence. */
export function statusFrom(reproduced: boolean, attempted: boolean, hard: boolean): { status: FindingStatus; confidence: Confidence } {
  if (!attempted) return { status: 'suspected', confidence: hard ? 'medium' : 'low' };
  if (!reproduced) return { status: 'not-reproducible', confidence: 'low' };
  return hard ? { status: 'confirmed', confidence: 'high' } : { status: 'suspected', confidence: 'medium' };
}
