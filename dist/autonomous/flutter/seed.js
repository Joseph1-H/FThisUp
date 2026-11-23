/**
 * Engine-seeded scenarios: deterministic, derived from the app map, and ONLY ever based on universal invariants
 * (no uncaught exception, no layout overflow, no use-after-dispose). They are the floor of autonomous discovery when no
 * agent supplies project-specific scenarios; the agent's own scenarios (with documented expectations) go beyond them.
 */
const SUBMIT = /save|submit|add|create|send|log|confirm|done|ok|login|sign|post|update|record|finish/i;
const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase().replace(/^-|-$/g, '');
function fieldFinder(f, index) {
    if (f.key)
        return { by: 'key', value: f.key };
    if (f.label)
        return { by: 'label', value: f.label };
    return { by: 'type', value: f.widget, index };
}
function actionFinder(a, index) {
    if (a.key)
        return { by: 'key', value: a.key };
    if (a.label)
        return { by: 'text', value: a.label };
    if (a.tooltip)
        return { by: 'tooltip', value: a.tooltip };
    return { by: 'type', value: a.widget, index };
}
export function primaryAction(s) {
    const btns = s.actions.filter((a) => a.kind === 'button' && /Button$/.test(a.widget));
    if (!btns.length)
        return undefined;
    const score = (a) => {
        const h = s.handlers.find((x) => x.name === a.handler);
        return (h?.async ? 3 : 0) + (h?.persistence.length ? 3 : 0) + (h?.validates ? 1 : 0) + (SUBMIT.test(`${a.label ?? ''} ${a.key ?? ''} ${a.tooltip ?? ''}`) ? 4 : 0) + (a.widget === 'IconButton' ? -2 : 0);
    };
    const best = [...btns].sort((a, b) => score(b) - score(a))[0];
    const sameType = btns.filter((b) => b.widget === best.widget);
    return { action: best, finder: actionFinder(best, Math.max(0, sameType.indexOf(best))) };
}
function typed(s) { return s.fields.filter((f) => f.kind === 'text-field'); }
const isNumeric = (f) => /number|phone|datetime/.test(f.keyboard ?? '') || /weight|reps|age|count|amount|price|qty|quantity|sets|minutes|calories|height/i.test(`${f.key ?? ''} ${f.label ?? ''}`);
function fillAll(s, text) {
    return typed(s).slice(0, 8).map((f, i) => ({ do: 'enterText', target: fieldFinder(f, i), text: text(f) }));
}
export function seedScenarios(map, max = 40) {
    const scenarios = [];
    const skipped = [];
    const base = (s) => ({ widget: s.class, args: {}, wrap: 'materialApp', viewport: { width: 390, height: 844 } });
    const meta = (s, kind, name, risk, statement, priority) => ({
        id: `seed-${kebab(s.class)}-${kind}`, name: `${name} (${s.class})`, feature: `${s.class} (${s.file})`, risk, priority, method: 'engine-heuristic',
        expectation: { statement, basis: 'invariant' },
    });
    const interactive = map.screens.filter((s) => s.fields.length || s.actions.length);
    for (const s of interactive) {
        if (!s.constructor.pumpable) {
            skipped.push({ screen: s.class, reason: `cannot be constructed without arguments (${s.constructor.reason}); an agent scenario can supply them via screen.args` });
            continue;
        }
        if (s.dependsOn.length) {
            skipped.push({ screen: s.class, reason: `depends on ${s.dependsOn.join(', ')}, which does not exist in an isolated widget test (no test double is available); an agent scenario can wrap it` });
            continue;
        }
        const pri = primaryAction(s);
        const pr = s.risk >= 8 ? 'high' : s.risk >= 4 ? 'medium' : 'low';
        const fields = typed(s);
        const benign = (f) => (isNumeric(f) ? '5' : 'Test');
        const submit = pri ? [{ do: 'tap', target: pri.finder }] : [];
        const settle = [{ do: 'pump', ms: 600 }, { do: 'settle' }];
        const mk = (m, steps) => ({ ...m, screen: base(s), steps, assertions: [] });
        if (fields.length) {
            scenarios.push(mk(meta(s, 'long-text', 'Very long unbreakable text in every text field, then submit', 'Layout overflow or crash when users enter or the app displays very long values', 'The screen keeps rendering without layout overflow or exceptions for long input', pr), [...fillAll(s, (f) => (isNumeric(f) ? '5' : { preset: 'long' })), ...submit, ...settle]));
            scenarios.push(mk(meta(s, 'unicode', 'Unicode, emoji and right-to-left text in every text field, then submit', 'Crash or garbled state on non-ASCII input', 'The screen handles any Unicode input without exceptions', 'low'), [...fillAll(s, (f) => (isNumeric(f) ? '5' : { preset: 'unicode' })), ...submit, ...settle]));
            if (fields.some(isNumeric))
                scenarios.push(mk(meta(s, 'hostile-numbers', 'Negative, zero and enormous numbers in numeric fields, then submit', 'Unhandled parse/overflow errors for out-of-range numbers', 'Out-of-range numeric input never raises an uncaught exception', pr), [...fillAll(s, (f) => (isNumeric(f) ? { preset: 'huge-number' } : 'Test')), ...submit, ...settle, ...fillAll(s, (f) => (isNumeric(f) ? { preset: 'negative' } : 'Test')), ...submit, ...settle]));
        }
        if (pri) {
            scenarios.push(mk(meta(s, 'empty-submit', 'Submit with every field empty', 'Unhandled error or crash when the form is submitted empty', 'Submitting an empty form never raises an uncaught exception', pr), [...submit, ...settle]));
            if (fields.length) {
                const h = s.handlers.find((x) => x.name === pri.action.handler);
                const async = !!h?.async;
                scenarios.push(mk(meta(s, 'rapid-submit', 'Submit with valid input, hammering the primary button', 'Repeated rapid taps while an operation is pending cause errors', 'Rapid repeated taps never raise an uncaught exception', async ? 'high' : 'medium'), [...fillAll(s, benign), { do: 'rapidTap', target: pri.finder, times: 6, gapMs: 0 }, ...settle]));
                if (async || h?.setStateAfterAwait)
                    scenarios.push(mk(meta(s, 'dispose-pending', 'Leave the screen while the submit operation is still running', 'setState/navigation after the screen is gone (use after dispose) during async work', 'Leaving a screen mid-operation never raises an uncaught exception', 'high'), [...fillAll(s, benign), ...submit, { do: 'pump', ms: 50 }, { do: 'dispose', ms: 2000 }]));
            }
        }
        if (s.gestures.length || s.scrollables) {
            const steps = [];
            if (s.scrollables)
                steps.push({ do: 'fling', target: { by: 'type', value: 'Scaffold' }, dx: 0, dy: -400 }, { do: 'fling', target: { by: 'type', value: 'Scaffold' }, dx: 0, dy: 600 });
            s.actions.filter((a) => a.kind === 'gesture').slice(0, 3).forEach((a, i) => steps.push({ do: 'longPress', target: actionFinder(a, i) }, { do: 'doubleTap', target: actionFinder(a, i) }, { do: 'drag', target: actionFinder(a, i), dx: 300, dy: 0 }));
            if (steps.length)
                scenarios.push(mk(meta(s, 'gestures', 'Scroll, long-press, double-tap and swipe interactive elements', 'Unhandled gesture combinations', 'Gestures never raise an uncaught exception', 'low'), [...steps, ...settle]));
        }
    }
    const rank = { high: 0, medium: 1, low: 2 };
    scenarios.sort((a, b) => rank[a.priority] - rank[b.priority]);
    return { scenarios: scenarios.slice(0, max), skipped };
}
