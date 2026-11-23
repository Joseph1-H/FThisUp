import path from 'node:path';
import { emptyEvidence } from './types.js';
/** The (deepest) component whose directory contains this file. */
export function owningComponent(ctx, file) {
    const rel = (path.isAbsolute(file) ? path.relative(ctx.root, file) : file).split(path.sep).join('/');
    return [...ctx.manifest.components].sort((a, b) => b.path.length - a.path.length).find((c) => c.path === '.' || rel === c.path || rel.startsWith(`${c.path}/`))?.id;
}
export function tail(text, lines = 30, maxChars = 3000) {
    const t = text.split('\n').slice(-lines).join('\n');
    return t.length > maxChars ? `…${t.slice(-maxChars)}` : t;
}
export function mkResult(r) {
    return { risk: 'low', target: r.component, durationMs: 0, expectations: [], origin: 'heuristic', ...r };
}
export function mkFinding(f) {
    return {
        id: f.id, scenarioId: f.scenarioId, title: f.title, category: f.category, status: f.status, severity: f.severity, confidence: f.confidence,
        route: f.route, expected: f.expected, actual: f.actual, reproductionSteps: f.steps,
        reproduction: { attempted: f.attempts > 1, attempts: f.attempts, reproduced: f.reproduced },
        evidence: { ...emptyEvidence(), ...f.evidence },
        suggestedFix: f.fix, source: 'execution', adapter: f.adapter, component: f.component, failureType: f.failureType, evidenceKind: f.evidenceKind, scope: f.scope,
    };
}
export const slugify = (s) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 80);
/** Decide a finding's status from a reproduction attempt. `hard` = objectively measurable evidence. */
export function statusFrom(reproduced, attempted, hard) {
    if (!attempted)
        return { status: 'suspected', confidence: hard ? 'medium' : 'low' };
    if (!reproduced)
        return { status: 'not-reproducible', confidence: 'low' };
    return hard ? { status: 'confirmed', confidence: 'high' } : { status: 'suspected', confidence: 'medium' };
}
