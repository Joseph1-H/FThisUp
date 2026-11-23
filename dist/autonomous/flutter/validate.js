import fs from 'node:fs';
import path from 'node:path';
import { isInside } from '../../utils/project-root.js';
import { flutterScenarioSchema, isFrameworkWidget } from './schema.js';
const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();
/** A reference is only trusted when the file is inside the project and the quote really occurs in it. */
export function verifyReference(root, ref) {
    const text = `${ref.file}${ref.line ? `:${ref.line}` : ''}`;
    const abs = path.resolve(root, ref.file);
    if (!isInside(root, abs))
        return { ok: false, reason: 'reference points outside the project', text };
    let src;
    try {
        src = fs.readFileSync(abs, 'utf8');
    }
    catch {
        return { ok: false, reason: `reference file ${ref.file} does not exist`, text };
    }
    if (src.length > 2_000_000)
        return { ok: false, reason: 'reference file is too large to verify', text };
    if (!norm(src).includes(norm(ref.quote)))
        return { ok: false, reason: `the quote does not occur in ${ref.file}`, text };
    if (ref.line) {
        const lines = src.split('\n');
        if (ref.line > lines.length)
            return { ok: false, reason: `${ref.file} has only ${lines.length} lines`, text };
        const window = lines.slice(Math.max(0, ref.line - 4), ref.line + 3).join('\n');
        if (!norm(window).includes(norm(ref.quote).slice(0, Math.min(40, norm(ref.quote).length))))
            return { ok: false, reason: `the quote is not near line ${ref.line} of ${ref.file}`, text };
    }
    return { ok: true, text };
}
function stepsWalk(steps, fn) { for (const s of steps) {
    fn(s);
    if (s.do === 'repeat')
        stepsWalk(s.steps, fn);
} }
export function validateFlutterScenarios(raw, map, root, defaultMethod) {
    const valid = [];
    const rejected = [];
    const skipped = [];
    const seen = new Set();
    const known = new Map(map.screens.map((s) => [s.class, s]));
    const keySet = new Set(map.keysInSource);
    const keyPatterns = map.keysInSource.filter((k) => k.includes('$')).map((k) => new RegExp(`^${k.split(/\$\{[^}]*\}|\$\w+/).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+')}$`));
    const libText = (() => { try {
        return fs.readdirSync(path.join(root, map.component === '.' ? '' : map.component));
    }
    catch {
        return [];
    } })();
    void libText;
    raw.forEach((item, index) => {
        const parsed = flutterScenarioSchema.safeParse(item);
        const idOf = item?.id;
        if (!parsed.success) {
            rejected.push({ id: typeof idOf === 'string' ? idOf : undefined, index, errors: parsed.error.issues.slice(0, 6).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) });
            return;
        }
        const sc = parsed.data;
        const errors = [];
        if (seen.has(sc.id))
            errors.push(`duplicate scenario id "${sc.id}"`);
        seen.add(sc.id);
        const screen = known.get(sc.screen.widget);
        if (!screen)
            errors.push(`screen.widget "${sc.screen.widget}" is not a widget class in this project's app map`);
        if (screen) {
            const names = new Set(screen.constructor.namedParams.map((p) => p.name));
            for (const a of Object.keys(sc.screen.args))
                if (!names.has(a))
                    errors.push(`screen.args.${a}: ${sc.screen.widget} has no named constructor parameter "${a}" (known: ${[...names].join(', ') || 'none'})`);
        }
        const checkTarget = (t, where) => {
            if (t.by === 'type' && !isFrameworkWidget(t.value) && !known.has(t.value))
                errors.push(`${where}: type "${t.value}" is neither a supported Flutter widget nor a widget of this project`);
            if (t.by === 'type' && !/^[A-Z][A-Za-z0-9_]*$/.test(t.value))
                errors.push(`${where}: "${t.value}" is not a valid class name`);
            if (t.by === 'key' && !keySet.has(t.value) && !keyPatterns.some((r) => r.test(t.value)))
                errors.push(`${where}: key "${t.value}" does not appear as a literal Key in the source (keys in source: ${map.keysInSource.slice(0, 12).join(', ') || 'none'})`);
        };
        stepsWalk(sc.steps, (s) => { if ('target' in s)
            checkTarget(s.target, `steps (${s.do})`); if (s.do === 'expect')
            checkTarget(s.assert.target, 'steps (expect)'); });
        sc.assertions.forEach((a, i) => checkTarget(a.target, `assertions[${i}]`));
        if (errors.length) {
            rejected.push({ id: sc.id, index, errors });
            return;
        }
        // expectation support
        const notes = [];
        let effective = sc.expectation.basis;
        let verified;
        let refText;
        const hasAssertions = sc.assertions.length > 0 || (() => { let any = false; stepsWalk(sc.steps, (s) => { if (s.do === 'expect')
            any = true; }); return any; })();
        if (effective === 'invariant' && hasAssertions) {
            effective = 'assumption';
            notes.push('basis "invariant" only covers "no uncaught exception / overflow / use-after-dispose"; scenarios with extra assertions are treated as assumptions unless a reference supports them');
        }
        if (effective === 'documented' || effective === 'code' || effective === 'test') {
            if (!sc.expectation.reference) {
                effective = 'assumption';
                notes.push(`basis "${sc.expectation.basis}" needs a reference (file + verbatim quote); none given, so it is treated as an assumption`);
            }
            else {
                const v = verifyReference(root, sc.expectation.reference);
                verified = v.ok;
                refText = v.text;
                if (!v.ok) {
                    effective = 'assumption';
                    notes.push(`reference not verified: ${v.reason}; treated as an assumption`);
                }
            }
        }
        if (effective === 'assumption')
            notes.push('an assumption can never produce a confirmed bug (at most "suspected")');
        // pumpability
        if (screen && !screen.constructor.pumpable) {
            const required = screen.constructor.namedParams.filter((p) => p.required).map((p) => p.name);
            const missing = required.filter((r) => !(r in sc.screen.args));
            if (screen.constructor.positionalRequired || missing.length) {
                skipped.push({ id: sc.id, name: sc.name, reason: `${sc.screen.widget} cannot be constructed: ${screen.constructor.positionalRequired ? 'positional constructor arguments are not supported' : `missing required argument(s) ${missing.join(', ')}`}`, scenario: sc });
                return;
            }
        }
        valid.push({ scenario: { ...sc, method: sc.method ?? defaultMethod }, method: sc.method ?? defaultMethod, effectiveBasis: effective, referenceVerified: verified, referenceText: refText, notes });
    });
    return { valid, rejected, skipped };
}
