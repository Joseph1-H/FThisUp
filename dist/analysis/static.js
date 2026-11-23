import { walkSources, lineOf } from '../utils/files.js';
const TEST_PATH = /(^|\/)(tests?|__tests__|__mocks__|fixtures?|e2e|examples?|docs?)\/|\.(test|spec|stories)\.[jt]sx?$/i;
const CRITICAL_PATH = /(auth|login|signin|signup|payment|checkout|billing|security|session|permission|middleware|server|api|db|database)/i;
const MAX_PER_RULE = 8;
const RULES = [
    {
        id: 'placeholder-impl', title: 'Placeholder implementation', severity: 'low', skipTests: true,
        re: /(throw new Error\(\s*['"`](?:not implemented|todo|unimplemented)[^'"`]*['"`]\s*\)|raise NotImplementedError|\/\/\s*(?:placeholder|stub)\b[^\n]*|#\s*(?:placeholder|stub)\b[^\n]*|return\s+(?:null|undefined);?\s*\/\/\s*(?:todo|placeholder|stub)[^\n]*)/gi,
        expected: 'Code paths reachable by users are fully implemented.', fix: 'Implement the function, or remove the entry point that leads to it.',
        describe: (m) => `Placeholder code: \`${m[0].slice(0, 80)}\``,
    },
    {
        id: 'hardcoded-mock', title: 'Hard-coded mock data', severity: 'low', skipTests: true,
        re: /\b(?:const|let|var)\s+(?:mock|fake|dummy|sample)[A-Z_]\w*\s*=\s*[\[{]|lorem ipsum|\bjohn\.?doe@example\.com\b/gi,
        expected: 'Production code paths read real data rather than inline mock fixtures.', fix: 'Replace the mock with a real data source (or gate it behind a dev-only flag) and confirm the UI shows live data.',
        describe: (m) => `Mock/fixture data in application code: \`${m[0].slice(0, 60)}\``,
    },
    {
        id: 'empty-handler', title: 'Empty event handler', severity: 'low', skipTests: true,
        re: /\bon(?:Click|Submit|Change|Press|Input)\s*=\s*\{\s*\(\s*[\w,\s]*\)\s*=>\s*(?:\{\s*\}|null|undefined)\s*\}|addEventListener\(\s*['"][a-z]+['"]\s*,\s*(?:\(\s*[\w,\s]*\)|function\s*\([^)]*\))\s*(?:=>)?\s*\{\s*\}\s*\)|\bon(?:click|submit)=["']{2}/g,
        expected: 'Every interactive control performs an action.', fix: 'Implement the handler or remove/disable the control so users are not offered a dead action.',
        describe: (m) => `Handler that does nothing: \`${m[0].slice(0, 70)}\``,
    },
    {
        id: 'todo-critical', title: 'TODO/FIXME in a critical path', severity: 'info', skipTests: true, fileFilter: CRITICAL_PATH,
        re: /(?:\/\/|#|\/\*)\s*(?:TODO|FIXME|HACK|XXX)\b[^\n]{0,100}/g,
        expected: 'Auth, payment, session and data-layer code has no unresolved TODO/FIXME markers.', fix: 'Resolve the marker or open an issue and link it in the comment.',
        describe: (m) => `Unresolved marker in a critical-path file: \`${m[0].trim().slice(0, 90)}\``,
    },
    {
        id: 'swallowed-error', title: 'Silently swallowed error', severity: 'low', skipTests: true,
        re: /catch\s*(?:\(\s*\w*\s*\))?\s*\{\s*(?:\/\*[^*]*\*\/|\/\/[^\n]*)?\s*\}|\.catch\(\s*\(\s*\w*\s*\)\s*=>\s*(?:\{\s*\}|null|undefined)\s*\)|except\s*(?:\w+\s*)?:\s*pass\b/g,
        expected: 'Errors are surfaced to the user or logged, not discarded.', fix: 'Handle the error (show feedback, retry, or log) or rethrow it.',
        describe: (m) => `Error swallowed: \`${m[0].replace(/\s+/g, ' ').slice(0, 70)}\``,
    },
    {
        id: 'fake-api', title: 'Simulated API call', severity: 'medium', skipTests: true,
        re: /setTimeout\(\s*\(?\s*\)?\s*=>?\s*\{?\s*(?:resolve|res)\([^)]*\)[^\n]{0,60}\n?[^\n]*|(?:simulate|fake|mock)\w*\s*(?:api|request|fetch|login|submit)\w*\s*\(/gi,
        expected: 'Integrations call a real backend.', fix: 'Replace the simulated latency/response with the real API call and handle its failures.',
        describe: (m) => `Looks like a simulated network call: \`${m[0].replace(/\s+/g, ' ').slice(0, 70)}\``,
    },
    {
        id: 'api-placeholder', title: 'Placeholder API configuration', severity: 'medium', skipTests: true,
        re: /['"`](?:YOUR[_-][A-Z_]*(?:KEY|TOKEN|URL)|https?:\/\/(?:api\.)?example\.com[^'"`]*|<your[^>]*>|REPLACE[_-]ME|xxx+)['"`]/g,
        expected: 'Integration endpoints and keys come from configuration, not placeholders.', fix: 'Wire the integration to real configuration and verify the request succeeds.',
        describe: (m) => `Placeholder endpoint/key: \`${m[0].slice(0, 60)}\``,
    },
    {
        id: 'button-no-action', title: 'Button without an apparent action', severity: 'info', skipTests: true, fileFilter: /\.(jsx|tsx|html?|vue|svelte)$/,
        re: /<button\b(?![^>]*(?:onClick|onclick|@click|v-on:|on:click|type=|href|formAction|\{\.\.\.|data-|id=|disabled))[^>]*>/g,
        expected: 'Buttons trigger an action or are inside a form.', fix: 'Attach a handler, give the button a type, or remove it. Confirm with a real click test.',
        describe: (m) => `Button with no handler/type attribute: \`${m[0].slice(0, 60)}\``,
    },
];
const wrap = (rule, f, m, n) => {
    const line = lineOf(f.text, m.index);
    return {
        id: `static-${rule.id}-${n}`,
        title: `${rule.title} (${f.rel}:${line})`,
        category: 'code-analysis',
        status: 'suspected',
        severity: rule.severity,
        confidence: 'low',
        route: f.rel,
        expected: rule.expected,
        actual: `${rule.describe(m)} — heuristic match, NOT confirmed by execution.`,
        reproductionSteps: [`Open ${f.rel}:${line} and review the flagged code.`, 'Exercise the related UI flow to confirm whether it is reachable and broken.'],
        reproduction: { attempted: false, attempts: 0, reproduced: false },
        evidence: { consoleErrors: [], pageErrors: [], networkFailures: [], mutatingRequests: [], blockedRequests: [], notes: ['Static heuristic: treat as a warning until confirmed.'] },
        suggestedFix: rule.fix,
        source: 'static-analysis',
        file: f.rel,
        line,
    };
};
export function analyzeStatic(root) {
    const { files, truncated } = walkSources(root);
    const findings = [];
    const counts = new Map();
    const overflow = new Map();
    for (const rule of RULES) {
        for (const f of files) {
            if (rule.skipTests && TEST_PATH.test(f.rel))
                continue;
            if (rule.fileFilter && !rule.fileFilter.test(rule.id === 'todo-critical' ? f.rel : f.rel))
                continue;
            const re = new RegExp(rule.re.source, rule.re.flags);
            for (let m; (m = re.exec(f.text));) {
                if (m[0].length === 0) {
                    re.lastIndex++;
                    continue;
                }
                const n = (counts.get(rule.id) ?? 0) + 1;
                if (n > MAX_PER_RULE) {
                    overflow.set(rule.id, (overflow.get(rule.id) ?? 0) + 1);
                    continue;
                }
                counts.set(rule.id, n);
                findings.push(wrap(rule, f, m, n));
            }
        }
    }
    findings.push(...unusedFunctions(files));
    for (const [id, extra] of overflow) {
        const rule = RULES.find((r) => r.id === id);
        findings.push({
            ...wrap(rule, { rel: '(multiple files)', abs: '', text: '' }, Object.assign([''], { index: 0 }), 99),
            id: `static-${id}-more`, title: `${rule.title}: ${extra} more matches not listed`, actual: `${extra} additional heuristic matches were omitted to keep the report readable.`, line: undefined,
        });
    }
    return { findings, filesScanned: files.length, truncated };
}
/** Functions that are declared (not exported) and never mentioned anywhere else in the scanned sources. */
function unusedFunctions(files) {
    const words = new Map();
    for (const f of files)
        for (const w of f.text.match(/[A-Za-z_$][\w$]{3,}/g) ?? [])
            words.set(w, (words.get(w) ?? 0) + 1);
    const out = [];
    for (const f of files) {
        if (TEST_PATH.test(f.rel) || !/\.(jsx?|tsx?|mjs|cjs|vue|svelte)$/.test(f.rel))
            continue;
        const re = /^(?!\s*export\b)\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]{3,})\s*\(|^(?!\s*export\b)\s*(?:const|let)\s+([A-Za-z_$][\w$]{3,})\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>/gm;
        for (let m; (m = re.exec(f.text));) {
            const name = (m[1] ?? m[2]);
            if (words.get(name) !== 1 || /^(main|default|handler|GET|POST|PUT|DELETE|PATCH)$/.test(name))
                continue;
            if (out.length >= MAX_PER_RULE)
                return out;
            const line = lineOf(f.text, m.index);
            out.push({
                id: `static-unused-${out.length + 1}`, title: `Possibly unused function "${name}" (${f.rel}:${line})`, category: 'code-analysis', status: 'suspected',
                severity: 'info', confidence: 'low', route: f.rel,
                expected: 'Declared functionality is reachable from the UI or API.',
                actual: `"${name}" is declared but never referenced elsewhere in the scanned source — heuristic match, NOT confirmed by execution. It may be dead code or an unfinished feature (or used via a mechanism this scan cannot see).`,
                reproductionSteps: [`Search the project for "${name}" to confirm it is unreferenced.`],
                reproduction: { attempted: false, attempts: 0, reproduced: false },
                evidence: { consoleErrors: [], pageErrors: [], networkFailures: [], mutatingRequests: [], blockedRequests: [], notes: ['Static heuristic.'] },
                suggestedFix: 'Wire the function into the feature it was meant for, or delete it.', source: 'static-analysis', file: f.rel, line,
            });
        }
    }
    return out;
}
